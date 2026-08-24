# ProjectSignal England Registry Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed and maintain the authoritative England Local Planning Authority registry, map every Planning Data LPA entity to ProjectSignal's 48 ceremonial counties, and expose accurate county coverage summaries without activating new planning sources.

**Architecture:** Planning Data's `local-planning-authority` API is the registry source of truth. ProjectSignal stores the stable Planning Data entity ID on each `councils` row and uses a deterministic, version-controlled entity-to-county mapping that supports many-to-many authorities such as national parks. A protected registry-sync worker fetches the 337 records and calls a service-only Postgres RPC that reconciles metadata without overwriting existing source configuration or coverage state.

**Tech Stack:** Next.js 16 App Router, TypeScript, Node test runner, Supabase/Postgres/RLS, Planning Data API.

**Spec:** `docs/superpowers/specs/2026-08-23-projectsignal-england-rollout-design.md`

## Global Constraints

- Preserve all existing council source configuration, planning sources and coverage status.
- Seed all 337 Planning Data LPA entities, including historical entities; historical/end-dated LPAs remain in the registry with `active = false`.
- Customer-facing territory remains the existing 48 England ceremonial counties.
- County mapping is many-to-many and keyed by stable Planning Data entity ID.
- Coverage percentages/counts include only active/current councils.
- Do not activate any new planning source in Phase A.
- The sync endpoint must require `CRON_SECRET` and never expose secrets client-side.
- Registry sync must be idempotent.
- Existing pilot council UUIDs must be preserved.

---

### Task 1: Add stable Planning Data identity and safe registry RPC

**Files:**
- Create: `supabase/migrations/20260823_england_lpa_registry.sql`

**Interfaces:**
- Adds: `councils.planning_data_entity bigint UNIQUE`
- Adds: `councils.authority_start_date date`
- Adds: `councils.authority_end_date date`
- Produces RPC: `sync_england_lpa_registry(p_authorities jsonb) RETURNS jsonb`

- [ ] **Step 1: Write migration SQL**

The RPC accepts a JSON array containing `entity`, `name`, `reference`, `startDate`, `endDate`, and `slug`. It inserts new authorities with `source_type='registry'`, `source_url=''`, `coverage_status='discovery'`, and never modifies source fields or coverage status on conflict. It updates only authority metadata and `active` based on end date.

The migration pre-links pilot rows to Planning Data IDs before creating/using the unique identity:
- Wigan `626034`
- Erewash `626081`
- South Derbyshire `626084`
- Charnwood `626086`
- Hinckley and Bosworth `626088`
- North West Leicestershire `626090`
- East Staffordshire `626118`

- [ ] **Step 2: Verify migration is additive and idempotent**

Run the SQL in a transaction in a disposable/local context where available, or inspect it for `IF NOT EXISTS`, conflict handling and non-destructive updates.

- [ ] **Step 3: Apply to live Supabase**

Expected: seven existing pilot UUIDs preserved; no planning sources modified.

- [ ] **Step 4: Verify pilot identity links**

Query `slug, planning_data_entity, coverage_status, source_type, source_url` and confirm existing operational metadata is unchanged.

---

### Task 2: Deterministic England LPA-to-county mapping

**Files:**
- Create: `lib/territory/england-authority-counties.ts`
- Test: `tests/territory/england-authority-counties.test.ts`

**Interfaces:**
- Produces: `countySlugsForPlanningDataEntity(entity: number): string[]`
- Produces: `allEnglandPlanningDataEntities(): number[]`
- Produces: `buildEnglandAuthorityCountyMappings(): Array<{ planningDataEntity: number; countySlug: string }>`

- [ ] **Step 1: Write failing tests**

Tests must assert:
- exactly 337 Planning Data entity IDs are covered, `626001..626337`;
- no entity maps to zero counties;
- every county slug belongs to the existing 48-slug allowlist;
- `626090` maps to `leicestershire`;
- `626118` maps to `staffordshire`;
- `626125..626129` map to `warwickshire`;
- Stockton-on-Tees (`626007`) maps to both `durham` and `north-yorkshire`;
- Peak District (`626324`) maps to Derbyshire, Cheshire, Greater Manchester, Staffordshire, South Yorkshire and West Yorkshire;
- South Downs (`626325`) maps to East Sussex, Hampshire and West Sussex;
- Broads (`626326`) maps to Norfolk and Suffolk;
- Yorkshire Dales (`626327`) maps to North Yorkshire, Cumbria and Lancashire.

- [ ] **Step 2: Run focused test and confirm failure**

Run: `npm test -- tests/territory/england-authority-counties.test.ts`
Expected: FAIL because mapping module is absent.

- [ ] **Step 3: Implement range-based mapping plus explicit multi-county overrides**

Use stable Planning Data entity IDs rather than authority-name matching.

- [ ] **Step 4: Run focused test**

Expected: PASS.

---

### Task 3: Registry fetch/normalise/sync service

**Files:**
- Create: `lib/planning/authority-registry.ts`
- Test: `tests/planning/authority-registry.test.ts`

**Interfaces:**
- Produces: `buildPlanningDataAuthorityUrl(): string`
- Produces: `normalisePlanningDataAuthority(input: unknown, today?: Date): EnglandAuthorityRegistryRow`
- Produces: `fetchEnglandAuthorityRegistry(fetchImpl?: typeof fetch): Promise<EnglandAuthorityRegistryRow[]>`
- Produces: `syncEnglandAuthorityRegistry(admin: any, fetchImpl?: typeof fetch): Promise<RegistrySyncResult>`

- [ ] **Step 1: Write failing tests**

Use fixture responses to verify:
- URL requests `dataset=local-planning-authority`, `limit=500` and fields `entity`, `name`, `reference`, `start-date`, `end-date`;
- `"North West Leicestershire LPA"` normalises to name `North West Leicestershire` and slug `north-west-leicestershire`;
- known pilot aliases use existing slugs (`hinckley-bosworth` rather than a duplicate slug);
- an end-dated authority normalises as inactive;
- response must contain exactly 337 unique entity IDs in the expected `626001..626337` range before database sync proceeds;
- mapping payload contains county rows for all 337 entities.

- [ ] **Step 2: Run test and confirm failure**

Run: `npm test -- tests/planning/authority-registry.test.ts`
Expected: FAIL because module is absent.

- [ ] **Step 3: Implement fetcher and strict validation**

Reject partial API responses, duplicate entity IDs or entities outside the expected range. Call `sync_england_lpa_registry` once with the normalised payload, then read council IDs/counties and replace only mappings for councils that have a `planning_data_entity`.

- [ ] **Step 4: Run focused tests**

Expected: PASS.

---

### Task 4: Protected authority-registry sync worker

**Files:**
- Create: `app/api/cron/sync-authority-registry/route.ts`
- Test: `tests/planning/authority-registry.test.ts`

**Interfaces:**
- GET `/api/cron/sync-authority-registry`
- Authorization: `Bearer ${CRON_SECRET}`
- Response: `{ worker: "authority-registry", authoritiesFetched, authoritiesActive, mappingsWritten }`

- [ ] **Step 1: Add pure auth/response helper test where practical**
- [ ] **Step 2: Implement Node runtime route using `createAdminClient()` and `syncEnglandAuthorityRegistry()`**
- [ ] **Step 3: Run test/typecheck**

---

### Task 5: Make county coverage summaries current-authority aware

**Files:**
- Modify: `lib/territory/queries.ts`
- Create: `lib/territory/coverage.ts`
- Test: `tests/territory/coverage.test.ts`

**Interfaces:**
- Produces: `summariseCountyCoverage(statuses: Array<{ active: boolean; coverageStatus: string; lastSuccessAt?: string | null }>): CountyCoverageSummary`
- Extends `CountyOption` with `totalAuthorities`, `liveAuthorities`, `testingAuthorities`, `degradedAuthorities`, `lastSuccessfulRefresh`.

- [ ] **Step 1: Write failing coverage tests**

Verify inactive historical authorities are excluded from denominator and a county with 2 live + 1 discovery reports 67%, not 100%.

- [ ] **Step 2: Implement pure summariser**
- [ ] **Step 3: Update `getEnglandCountyOptions()` to select `councils(active,coverage_status,last_success_at)` and use summariser**
- [ ] **Step 4: Run territory tests**

---

### Task 6: Full verification and live Phase A sync

**Files:**
- Modify: `docs/superpowers/plans/2026-08-23-projectsignal-england-registry-phase-a.md` checkboxes only if desired.

- [ ] **Step 1: Run full tests**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Run TypeScript**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 4: Deploy patch**

After user deploys, call protected registry sync endpoint once.

- [ ] **Step 5: Verify live database**

Expected:
- 337 England LPA registry rows with unique `planning_data_entity` values;
- seven pilot rows preserved rather than duplicated;
- inactive/historical LPAs retained but `active=false`;
- every authority has at least one county mapping;
- no new `planning_sources.active=true` rows created;
- customer leads unchanged by registry sync;
- Leicestershire/Staffordshire/Warwickshire coverage denominators reflect all current mapped authorities.
