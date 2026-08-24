# ProjectSignal England Planning Coverage — Design

Date: 2026-08-23
Status: Approved architecture, implementation spec pending user review

## 1. Goal

Expand ProjectSignal from the current local proof-of-concept to commercial-grade planning coverage across all of England while preserving the customer-facing 48-county entitlement model.

The system must:
- maintain an authoritative registry of England's Local Planning Authorities (LPAs);
- map each LPA to one or more customer-facing ceremonial counties;
- support multiple planning-source adapters without bespoke code per council;
- prefer official/authoritative sources;
- use PlanIt only as a controlled fallback;
- ingest incrementally and safely;
- isolate failing sources so one council cannot stop national scanning;
- keep existing ProjectSignal scoring, county entitlement, lead matching and CRM direction intact;
- expose coverage health per county so the product never overstates coverage.

## 2. Source of truth

### Authority registry
Use MHCLG Planning Data's `local-planning-authority` dataset as the authoritative registry seed.

Current Planning Data documentation states there are 337 LPAs in England and exposes them through the Planning Data API. Registry imports must be idempotent and keyed by a stable external authority reference/entity ID, not only authority name.

Store/maintain:
- ProjectSignal council UUID
- slug
- official name
- England region where available
- authoritative external LPA/entity reference
- official planning-register URL where discovered
- coverage status
- active flag

Existing hand-configured councils must be preserved and reconciled rather than overwritten.

### County layer
Keep the existing 48 England ceremonial counties as the customer-facing territory model.

Map LPAs to counties using authoritative spatial boundaries rather than name matching. The mapping remains many-to-many in `planning_authority_counties` so edge cases can be represented safely.

No customer-facing planning-authority terminology is required in the normal territory purchase journey.

## 3. Coverage lifecycle

Every authority follows:

`discovery -> testing -> live`

Optional failure state:
`live -> degraded`

Rules:
- `discovery`: authority exists but no verified source.
- `testing`: source configured but not counted as production coverage.
- `live`: source successfully imports current records and passes verification.
- `degraded`: previously live source is stale or repeatedly failing; existing data stays visible but coverage UI must show reduced health.

An authority cannot be marked `live` until:
1. source responds;
2. at least one current application can be normalised, or a valid zero-result window is independently confirmed;
3. duplicate/upsert behaviour is verified;
4. authority-to-county mapping is verified;
5. ProjectSignal scoring runs without error.

## 4. Source strategy

For each LPA, sources are ordered by preference.

### Tier 1 — official structured sources
Preferred:
- council open-data CSV/JSON;
- council ArcGIS/FeatureServer;
- official government/API feed where sufficiently current;
- other documented official machine-readable feeds.

### Tier 2 — reusable council portal adapters
Examples:
- Idox Public Access;
- StatMap/HorizoNext;
- other repeated vendor platforms discovered during rollout.

Adapters must implement one normalised contract:

```ts
{
  externalReference
  address
  postcode
  latitude
  longitude
  proposal
  applicationType
  stage
  submittedAt
  validatedAt
  decisionAt
  decision
  applicantName
  agentName
  agentContact
  sourceUrl
  rawPayload
}
```

### Tier 3 — PlanIt fallback
PlanIt may be used only when:
- the official source is not yet integrated;
- the official portal is technically broken for server-side retrieval;
- the authority is in temporary degraded state.

PlanIt is not the permanent national backbone.

Each fallback record must retain the official council application URL where available.

## 5. Planning source model

Keep `planning_sources` as the source registry. Add only the minimum metadata required for reliable fallback selection.

Recommended additions:
- `source_role`: `primary | fallback`
- `health_status`: `unknown | healthy | degraded | failed`
- `last_record_seen_at timestamptz`
- `verified_at timestamptz`

Existing fields remain authoritative for scheduling and diagnostics:
- `priority`
- `scan_every_minutes`
- `active`
- `last_cursor`
- `last_scanned_at`
- `last_success_at`
- `next_scan_at`
- `last_error`
- `consecutive_failures`

One council may have multiple source rows, but only one source should normally ingest at a time. Primary wins when healthy. Fallback is eligible only when the primary is absent, disabled, stale, or exceeds the failure threshold.

## 6. Scanner scheduling

Do not attempt to scan all 337 authorities inside one daily Vercel invocation.

Current infrastructure already has Supabase `pg_cron` and `pg_net`. Use Supabase as the scheduler and Vercel as the worker.

### Scheduler
A Supabase cron job calls the protected ProjectSignal scanner endpoint on a frequent incremental cadence.

The scanner:
1. selects only due sources;
2. orders by priority and oldest `next_scan_at`;
3. enforces a per-run source limit and wall-clock budget;
4. processes sources independently;
5. updates success/failure/next-run state;
6. exits cleanly before platform timeout.

Initial production target:
- small batches every 5–10 minutes;
- official sources may scan daily or several times daily based on source cost;
- PlanIt fallbacks must respect its published rate limits and be globally throttled.

The exact interval and batch size are runtime configuration, not hard-coded business logic.

### Authentication
Never expose `CRON_SECRET` in client code or git.

Use a server-only mechanism for the Supabase scheduled HTTP call. If secure secret storage is not available in the existing database configuration, add an appropriate secure secret facility before enabling the scheduled call. Do not store the bearer secret in a customer-readable table.

## 7. Ingestion and deduplication

Application uniqueness remains source-aware:
- primary key/business key should ultimately resolve council + stable external reference;
- source URL/PlanIt UID may be used as fallback identity when reference is blank;
- importing the same record repeatedly must update, not duplicate;
- switching a council from fallback to primary must not create duplicate customer opportunities for the same planning application.

For source migration, use deterministic reconciliation:
1. exact planning reference;
2. authority + normalised reference;
3. controlled fallback using address/date/proposal only when reference is unavailable.

Do not auto-merge ambiguous records.

## 8. Scoring and customer visibility

The national rollout reuses the current glazing scoring engine.

Current principles remain:
- explicit glazing work scores strongest;
- implied building work can qualify;
- irrelevant categories stay suppressed;
- active subscription required for customer lead creation;
- county entitlement start date prevents historical entitlement dumps;
- customer minimum score and minimum opportunity value still apply.

The future CRM feature will allow customers to inspect broader opportunity inventory. That is deliberately separate from this England-coverage rollout and must not block national ingestion.

## 9. Coverage UI

Add a computable county coverage summary:

- total mapped planning authorities;
- live authorities;
- testing authorities;
- degraded authorities;
- last successful refresh.

Example:
`Leicestershire — 8/8 authorities live`

Do not label a county “fully covered” until all mapped authorities are live.

Existing county purchase entitlement is independent of coverage status: a customer can own a county while rollout is still progressing, but the UI must disclose coverage.

## 10. Rollout order

### Wave 1 — prove the national framework
1. Leicestershire
2. Staffordshire
3. Warwickshire

These are the current live customer's counties and give direct product feedback.

### Wave 2 — Midlands
Derbyshire, Nottinghamshire, West Midlands, Worcestershire, Northamptonshire, Lincolnshire and neighbouring counties.

### Wave 3 — region-by-region England
Expand systematically rather than enabling all authorities blindly.

The registry for all 337 LPAs can be seeded early, but sources remain inactive until verified.

## 11. Operational safeguards

- Per-source failure isolation.
- Exponential retry/backoff after repeated failures.
- Auto-degrade after configurable consecutive failure/staleness threshold.
- No source deletion on failure.
- Structured diagnostic logging with council/source IDs.
- No global TLS-verification disabling.
- Source-specific workarounds only when secure.
- Conservative external API rate limits.
- No historic bulk lead dump when a source first becomes live.

## 12. Testing

### Registry tests
- imports all authoritative England LPAs;
- repeat import is idempotent;
- existing configured councils are reconciled;
- no duplicate authority codes.

### County mapping tests
- every live LPA has at least one county mapping;
- known authorities map correctly;
- many-to-many mappings are supported.

### Source selection tests
- healthy primary chosen over fallback;
- fallback used when primary is unavailable/degraded;
- two sources do not ingest simultaneously for one authority;
- failed source does not stop other sources.

### Scheduling tests
- only due sources selected;
- batch limit enforced;
- priority ordering deterministic;
- retry/backoff advances `next_scan_at`.

### Ingestion tests
- blank references handled;
- source re-import idempotent;
- primary/fallback switch does not duplicate application/customer lead.

### End-to-end acceptance
For at least one authority in each initial county:
`source -> planning_applications -> scoring -> opportunity -> county entitlement -> customer lead`

## 13. Delivery phases

### Phase A — national registry + county mappings
- seed/reconcile all 337 LPAs;
- create/verify county mappings;
- coverage query/API.

### Phase B — source orchestration
- source-role/health metadata;
- primary/fallback selection;
- incremental scheduler;
- PlanIt global throttle.

### Phase C — first three counties
- complete and verify every authority for Leicestershire;
- Staffordshire;
- Warwickshire.

### Phase D — England rollout
- add reusable portal adapters as patterns emerge;
- activate verified authorities wave-by-wave;
- report coverage status.

## 14. Non-goals for this rollout

Not included yet:
- Wales, Scotland or Northern Ireland;
- opportunity CRM redesign;
- marketing-campaign sending;
- extra-county Stripe billing;
- replacing ProjectSignal scoring with per-record generative AI;
- bulk historical lead unlocking.

Those remain separate product phases.
