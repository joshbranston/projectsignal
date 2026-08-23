# ProjectSignal Phase A — England Territory & Planning Data Engine Design

Date: 2026-08-23
Status: Approved architecture; ready for implementation planning after review

## 1. Purpose

ProjectSignal will evolve from a single-source Wigan planning scanner into an England-wide planning opportunity platform for trades.

Phase A will cover England first. The architecture must remain UK-ready so Wales, Scotland and Northern Ireland can later plug into the same ingestion, scoring, entitlement and lead-delivery engine without rebuilding the core product.

The first commercial niche remains Windows, Doors & Bifolds.

## 2. Product model

ProjectSignal Pro currently costs £79/month.

For Phase A, the plan includes 3 selectable counties. Counties are chosen during onboarding and become part of the subscriber's paid territory entitlement.

Key commercial rules:

- £79/month includes 3 counties.
- County selection is locked once onboarding/subscription activation completes.
- Customers cannot freely swap counties during a billing period.
- Adding counties beyond the included allowance requires additional paid subscription territory.
- Replacing or removing a county takes effect at the next billing renewal.
- Newly added counties do not unlock historic lead data from before the county entitlement began.
- Only active subscriptions receive new leads.

Additional county pricing is intentionally left configurable and will be decided separately.

## 3. Customer geography model

### 3.1 Customer-facing geography

Customers select familiar counties on an interactive map rather than planning authority names.

The initial map is England-only and uses ceremonial county polygons. The future UK version will extend the same model across all four nations.

The customer sees:

- their business address as a pin;
- selectable counties;
- selected counties;
- locked counties once their plan allowance is used;
- coverage status per county;
- matched project markers on the dashboard map.

### 3.2 Business location

The `companies` record will be extended with:

- `address_line_1`
- `address_line_2`
- `town_city`
- `county_text`
- `postcode`
- `latitude`
- `longitude`

The business address is geocoded once. Coordinates are used for map display and optional distance-to-opportunity information, not as the primary entitlement rule.

### 3.3 County entitlement

The existing radius-based territory model will be retained temporarily for backward compatibility but will no longer be the primary matching rule for new customers.

New core tables:

#### `counties`

- `id uuid primary key`
- `slug text unique`
- `name text`
- `nation text`
- `geometry jsonb` or external static geometry reference
- `active boolean`
- `created_at timestamptz`
- `updated_at timestamptz`

#### `planning_authority_counties`

Many-to-many mapping between internal planning authorities (`councils`) and customer-facing counties.

- `council_id uuid`
- `county_id uuid`
- unique `(council_id, county_id)`

#### `company_counties`

Stores paid county entitlement over time.

- `id uuid primary key`
- `company_id uuid`
- `county_id uuid`
- `status text` (`active`, `scheduled`, `ending`, `expired`)
- `starts_at timestamptz`
- `ends_at timestamptz null`
- `locked_until timestamptz null`
- `created_at timestamptz`
- `updated_at timestamptz`

The model must preserve history instead of overwriting prior territory.

#### `territory_change_events`

Audit trail for county changes.

- `id bigint/uuid`
- `company_id uuid`
- `county_id uuid`
- `action text`
- `requested_at timestamptz`
- `effective_at timestamptz`
- `stripe_event_id text null`
- `previous_state jsonb`
- `new_state jsonb`
- `created_at timestamptz`

Actions include:

- `county_added`
- `county_removal_scheduled`
- `county_replacement_scheduled`
- `county_activated`
- `county_expired`

## 4. Subscription entitlements

`billing_plans` will gain configurable territory fields:

- `county_limit integer`
- `additional_county_price_id text null`
- optional future `additional_county_price_gbp_pence integer null`

Initial Pro configuration:

- plan code: `pro`
- price: £79/month
- included county limit: 3

### 4.1 Server-side enforcement

The browser is never the source of truth for entitlements.

Any county selection or change API must verify:

1. subscription status is active;
2. billing plan county allowance;
3. active + scheduled county count;
4. requested change timing;
5. any required Stripe payment/subscription change has succeeded.

Forged client requests must not bypass county limits.

### 4.2 Territory replacement

A customer may request a county replacement during a billing period, but the replacement becomes effective at the next billing renewal.

Example:

- current: Leicestershire, Derbyshire, Staffordshire
- requested: Staffordshire → Nottinghamshire
- current entitlement remains until renewal
- Nottinghamshire begins at renewal
- Staffordshire expires at renewal

### 4.3 Additional counties

Adding a county above the included allowance requires a paid subscription change.

The architecture should support a recurring Stripe add-on price so a single subscription can contain:

- ProjectSignal Pro × 1
- Additional County × N

Additional territory becomes active only after Stripe confirms the subscription/payment change.

### 4.4 Historical data restriction

A county entitlement only grants leads for opportunities first seen on or after `company_counties.starts_at`.

Historic market intelligence can become a separate future product instead of being automatically exposed when territory is added.

## 5. Customer map experience

### 5.1 Onboarding

New onboarding flow:

1. Create account
2. Confirm email
3. Enter company details
4. Enter business address
5. Geocode address and show business pin
6. Select up to plan county limit
7. Select trade(s)
8. Set minimum opportunity value / score preferences
9. Subscribe
10. Activate county entitlement after successful Stripe confirmation
11. Enter dashboard

The county containing the business address should be suggested/highlighted but not auto-selected.

### 5.2 County visual states

The map supports:

- `LIVE`
- `PARTIAL`
- `COMING SOON`
- `DEGRADED`
- `SELECTED`
- `PLAN LIMIT / LOCKED`

Coverage should be derived from the status of underlying planning authorities rather than manually claimed.

### 5.3 Dashboard

The dashboard shows:

- selected county summary;
- current allowance usage (e.g. 3 of 3);
- View Territory Map;
- Change Territory;
- Add Territory;
- business HQ pin;
- lead/project markers;
- optional straight-line distance from business HQ.

Territory editing after activation follows billing rules rather than acting as a simple filter.

## 6. Planning authority and source architecture

### 6.1 Authority model

The existing `councils` table remains the canonical planning authority record.

It should hold additional operational metadata such as:

- nation
- region
- coverage_status
- planning_register_url

Coverage states:

- `discovery`
- `testing`
- `live`
- `degraded`
- `disabled`

### 6.2 Source model

A new `planning_sources` table sits beneath `councils`.

A planning authority may have multiple sources, for example:

- a government Planning Data source;
- an ArcGIS feed;
- a CSV feed;
- a JSON API;
- an Idox/Public Access integration;
- a StatMap portal integration;
- a custom fallback.

Core source fields:

- `id uuid`
- `council_id uuid`
- `name text`
- `adapter_type text`
- `source_url text`
- `enabled boolean`
- `priority integer`
- `scan_frequency_minutes integer`
- `next_scan_at timestamptz`
- `last_scanned_at timestamptz`
- `last_success_at timestamptz`
- `consecutive_failures integer`
- `last_error text`
- `config jsonb`
- `licence_name text`
- `licence_url text`

Every imported planning application should reference the exact source that produced it where possible.

## 7. Reusable planning adapters

Target adapter families:

- `planning-data`
- `arcgis`
- `csv`
- `json`
- `idox`
- `statmap`
- `custom`

Each adapter must return the same normalised application contract:

```ts
interface NormalisedPlanningApplication {
  externalReference: string;
  address: string | null;
  postcode: string | null;
  latitude: number | null;
  longitude: number | null;
  proposal: string;
  applicationType: string | null;
  stage: string | null;
  submittedAt: string | null;
  validatedAt: string | null;
  decisionAt: string | null;
  decision: string | null;
  applicantName: string | null;
  agentName: string | null;
  agentContact: string | null;
  sourceUrl: string | null;
  rawPayload: unknown;
}
```

Council-specific field names must stop leaking into the rest of the application.

## 8. Scanner refactor

The existing Wigan route currently combines source fetching, CSV parsing, Wigan-specific field mapping, scoring, geocoding, persistence, customer entitlement checks and lead creation.

It will be refactored into focused modules:

```text
lib/planning/
  adapters/
    planning-data.ts
    csv.ts
    arcgis.ts
    json.ts
    idox.ts
    statmap.ts
  normalise.ts
  ingest.ts
  scoring.ts
  matching.ts
  coverage.ts
  scanner.ts

app/api/cron/scan-planning/route.ts
```

Wigan becomes the first configured CSV source using the generic engine rather than retaining its own bespoke pipeline.

## 9. Scanner scheduling

Do not create one cron per authority.

A central worker should:

1. authenticate using the existing cron secret;
2. query enabled sources with `next_scan_at <= now()`;
3. process a bounded batch;
4. isolate failures per source;
5. update scan metadata;
6. schedule the next scan;
7. return run statistics.

One failed council must not stop other councils in the batch.

Repeated failures should increment `consecutive_failures` and may move an authority/source to `degraded` after a threshold.

## 10. Ingestion and deduplication

Existing uniqueness on `(council_id, external_reference)` remains the main application deduplication rule.

Scanning the same application repeatedly must update `last_seen_at` and mutable fields without creating duplicates.

Ingestion flow:

1. fetch source;
2. parse via adapter;
3. normalise;
4. validate reference + proposal;
5. enrich postcode/coordinates when needed;
6. upsert `planning_applications`;
7. score only when needed;
8. upsert trade opportunities;
9. match eligible customers.

## 11. Scoring

Phase A continues using the Windows, Doors & Bifolds scoring engine.

Scoring must be decoupled from council ingestion so the same application can later be evaluated for multiple trades without re-fetching source data.

The system should preserve the existing pattern of one shared trade opportunity row per planning application/trade combination.

## 12. County-based lead matching

Primary entitlement logic changes from radius to county.

Matching flow:

1. planning application belongs to a planning authority;
2. planning authority maps to one or more counties;
3. find active `company_counties` for those counties;
4. require active subscription;
5. require matching trade;
6. require score >= customer threshold;
7. require opportunity value >= customer minimum;
8. require `planning_application.first_seen_at >= company_counties.starts_at`;
9. upsert `customer_leads`.

Only subscription status `active` receives new leads. Existing `trialing` eligibility is removed because ProjectSignal does not offer a free trial.

The unique lead constraint remains company + planning application + trade.

## 13. England rollout process

Authorities are activated one after another.

Each authority follows:

1. Discovery
2. Source found
3. Connector configured/built
4. Import verified
5. Scoring verified
6. County mapping verified
7. Live

An authority does not count toward county coverage until it is live.

Initial rollout order:

1. North West Leicestershire
2. South Derbyshire
3. East Staffordshire
4. Hinckley & Bosworth
5. Charnwood
6. Erewash
7. complete Leicestershire
8. complete Derbyshire
9. complete Staffordshire
10. complete Nottinghamshire
11. expand across the Midlands
12. expand region by region until England coverage is complete

Reusable platform adapters should accelerate rollout as more authorities are found on the same technology.

## 14. Coverage calculation

County coverage is calculated from mapped planning authorities.

Example:

- 0 live authorities → Coming Soon
- some live authorities → Partial
- all required authorities live → Live
- formerly live authority with repeated source failures → county may show degraded/partial status

Coverage percentage may be shown to users where it can be calculated accurately.

## 15. Payment failure and cancellation behaviour

### Past due

If Stripe moves the subscription to `past_due`:

- stop creating/delivering new leads;
- keep the account accessible;
- retain existing leads;
- show a payment-required banner;
- resume new lead delivery after Stripe confirms recovery to `active`.

### Cancel at period end

If `cancel_at_period_end = true`:

- retain active territory and lead delivery until the paid period ends;
- stop new lead delivery once subscription status reaches canceled/entitlement expiry.

## 16. Security

Customer clients must not have direct write access to internal planning infrastructure tables, including:

- `planning_sources`
- `councils`
- `planning_applications`
- `application_analyses`
- `application_trade_opportunities`

Server-only/admin access remains the intended RLS pattern for these tables.

County entitlement writes must go through controlled server-side actions/RPCs that validate subscription state and plan limits.

Cron endpoints continue to require `Authorization: Bearer <CRON_SECRET>`.

Stripe webhooks continue to require signature verification.

## 17. Migration strategy for existing users

The existing radius territory data remains in place during rollout.

Existing customer accounts are not broken or forced through signup again.

A one-time migration/setup flow will ask an existing customer to confirm their county territory.

The first test account based at LE65 can be migrated to up to 3 counties after the county model is live.

Radius fields can later become legacy/internal once county matching is fully proven.

## 18. Launch test criteria

The following scenarios must pass before the England territory system is considered production-ready:

1. New customer selects up to 3 counties — allowed.
2. New customer attempts a fourth included county — blocked.
3. Active 3-county subscriber adds a fourth — paid subscription change required.
4. Added county activates only after Stripe confirms the billing change.
5. Mid-period county replacement is scheduled for renewal, not applied immediately.
6. Forged browser/API requests cannot exceed entitlement.
7. Newly added county does not expose historical leads from before entitlement start.
8. One planning source failure does not stop other sources.
9. Repeated ingestion of the same application does not duplicate applications.
10. Repeated scoring does not duplicate application/trade opportunities.
11. Two customers entitled to the same county can each receive a lead from one shared analysis.
12. Customer without county entitlement receives no lead.
13. Trade mismatch receives no lead.
14. Score below customer threshold receives no lead.
15. Value below customer minimum receives no lead.
16. `past_due` stops new lead creation/delivery while preserving account access.
17. Payment recovery resumes new lead delivery.
18. Cancellation at period end preserves service until entitlement expiry.
19. Map coverage matches actual live planning-authority coverage.
20. Wigan continues to ingest successfully through the generic engine after refactor.

## 19. Phase B — rest of UK

After England is operational, add Wales, Scotland and Northern Ireland by extending:

- nation geography;
- boundary datasets;
- planning authority catalogue;
- source adapters/configuration.

The following components should remain unchanged:

- normalised planning application model;
- trade scoring;
- entitlement model;
- lead matching;
- dashboard lead model;
- Stripe billing architecture.

## 20. Explicit non-goals for Phase A

To keep the build focused, Phase A does not require:

- all trades at launch;
- historical market intelligence sales;
- enterprise England-wide pricing;
- mobile apps;
- customer-created custom polygons;
- per-postcode territory sales;
- AI-generated outreach automation;
- Scotland/Wales/NI live coverage before England is proven.

## 21. Success definition

Phase A is successful when:

- the existing Wigan source runs through the generic scanner;
- the first LE65-region planning authorities are live one by one;
- the test customer can select counties on an interactive map;
- county selection is enforced by subscription entitlements;
- real nearby planning applications create qualified Windows/Doors leads;
- customers cannot gain extra county data without paying or waiting for renewal;
- the same architecture can expand authority by authority across England.
