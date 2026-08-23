# ProjectSignal England Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert ProjectSignal from a Wigan/radius MVP into an England-ready county-entitlement product with an interactive county map, locked subscription territory, a reusable planning-source engine, and council-by-council rollout.

**Architecture:** Customer-facing territory is ceremonial counties. Planning authorities map to counties beneath the UI. A central source registry feeds reusable adapters into one normalised planning application store, one trade scoring layer, and county/subscription matching. Existing radius fields remain temporarily for compatibility but stop being the primary entitlement rule for new county-enabled accounts.

**Tech Stack:** Next.js 16 App Router, TypeScript, React, Supabase/Postgres/Auth/RLS, Stripe Billing/Checkout, Vercel, MapLibre GL, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-projectsignal-england-territory-design.md`

## Global Constraints

- Existing ProjectSignal Pro price remains £79/month.
- Pro includes 3 counties.
- County selection is locked after activation; free mid-cycle swapping is forbidden.
- Additional counties require paid territory; pricing remains configurable until a Stripe add-on price is intentionally created.
- Replacements/removals become effective at the next billing renewal.
- Newly added counties must not unlock historic opportunities from before `company_counties.starts_at`.
- Only `active` subscriptions receive new leads; `trialing` is not eligible.
- Internal planning tables remain server-only under RLS.
- Existing Wigan ingestion must continue to work after refactor.
- Phase A is England first; data structures remain nation-aware for Phase B.
- Never expose Supabase secret keys, Stripe restricted keys, webhook secrets, or CRON secrets client-side.

---

## File Structure

### Geography and entitlement
- Create `lib/territory/entitlements.ts` — pure county-limit/status rules.
- Create `lib/territory/types.ts` — shared county/coverage types.
- Create `lib/territory/queries.ts` — server-side county/coverage queries.
- Create `lib/territory/geo.ts` — GeoJSON helpers and map bounds.
- Create `app/components/county-map.tsx` — client-side MapLibre selector/viewer.
- Create `app/api/territory/initial/route.ts` — controlled initial county selection endpoint if needed after onboarding.
- Create `supabase/migrations/20260823_county_entitlements.sql` — schema/RLS/functions/seeds.

### Onboarding/dashboard
- Modify `app/onboarding/actions.ts` — create company with selected counties and address.
- Modify `app/onboarding/page.tsx` — address fields + county selector + hidden county values.
- Modify `app/dashboard/page.tsx` — selected county summary, map and active-only lead access.
- Modify `app/dashboard/settings/page.tsx` — locked territory display and change/add actions.
- Modify `lib/auth.ts` — load county entitlements and make lead gating active-only.
- Modify `app/globals.css` — map/territory states.
- Modify `app/layout.tsx` — import MapLibre CSS.
- Modify `package.json` — MapLibre + test harness.
- Create `public/data/england-ceremonial-counties.geojson` — simplified England ceremonial county polygons with attribution metadata.

### Planning engine
- Create `lib/planning/types.ts` — normalised planning application/source contracts.
- Create `lib/planning/adapters/csv.ts` — generic CSV adapter with configurable field mapping.
- Create `lib/planning/adapters/arcgis.ts` — ArcGIS FeatureServer adapter.
- Create `lib/planning/adapters/json.ts` — configurable JSON adapter.
- Create `lib/planning/adapters/planning-data.ts` — planning.data.gov.uk adapter.
- Create `lib/planning/ingest.ts` — application upsert and enrichment.
- Create `lib/planning/scoring.ts` — shared trade opportunity creation.
- Create `lib/planning/matching.ts` — county/subscription lead matching.
- Create `lib/planning/scanner.ts` — one-source scanner orchestration and failure isolation.
- Create `app/api/cron/scan-planning/route.ts` — central due-source worker.
- Keep `app/api/cron/scan-wigan/route.ts` only as a temporary compatibility shim, then remove after cron migration.
- Modify `vercel.json` — switch scheduled scanner to central route when verified.

### Tests
- Create `vitest.config.ts`.
- Create `tests/territory/entitlements.test.ts`.
- Create `tests/planning/csv-adapter.test.ts`.
- Create `tests/planning/matching.test.ts`.
- Create `tests/planning/scanner.test.ts`.

---

### Task 1: Test harness and pure entitlement rules

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `lib/territory/types.ts`
- Create: `lib/territory/entitlements.ts`
- Test: `tests/territory/entitlements.test.ts`

**Interfaces:**
- Produces: `subscriptionAllowsNewLeads(status: string | null | undefined): boolean`
- Produces: `validateInitialCountySelection(selectedCountySlugs: string[], countyLimit: number): { ok: true; countySlugs: string[] } | { ok: false; error: string }`
- Produces: `countySelectionUsage(activeCount: number, scheduledCount: number, countyLimit: number): { used: number; remaining: number; atLimit: boolean }`

- [ ] **Step 1: Add a failing entitlement test**

```ts
import { describe, expect, it } from "vitest";
import {
  subscriptionAllowsNewLeads,
  validateInitialCountySelection,
  countySelectionUsage
} from "@/lib/territory/entitlements";

describe("county entitlements", () => {
  it("only allows active subscriptions to receive new leads", () => {
    expect(subscriptionAllowsNewLeads("active")).toBe(true);
    expect(subscriptionAllowsNewLeads("trialing")).toBe(false);
    expect(subscriptionAllowsNewLeads("past_due")).toBe(false);
  });

  it("allows up to the configured county limit", () => {
    expect(validateInitialCountySelection(["leicestershire", "derbyshire", "staffordshire"], 3)).toEqual({
      ok: true,
      countySlugs: ["leicestershire", "derbyshire", "staffordshire"]
    });
  });

  it("rejects a fourth included county", () => {
    const result = validateInitialCountySelection(["leicestershire", "derbyshire", "staffordshire", "nottinghamshire"], 3);
    expect(result.ok).toBe(false);
  });

  it("deduplicates county slugs before counting", () => {
    expect(validateInitialCountySelection(["derbyshire", "Derbyshire", " DERBYSHIRE "], 3)).toEqual({
      ok: true,
      countySlugs: ["derbyshire"]
    });
  });

  it("counts active and scheduled territory against the plan", () => {
    expect(countySelectionUsage(2, 1, 3)).toEqual({ used: 3, remaining: 0, atLimit: true });
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- tests/territory/entitlements.test.ts`
Expected: FAIL because the module does not yet exist.

- [ ] **Step 3: Implement the pure rules**

```ts
export function subscriptionAllowsNewLeads(status?: string | null) {
  return status === "active";
}

export function validateInitialCountySelection(selectedCountySlugs: string[], countyLimit: number) {
  const countySlugs = [...new Set(selectedCountySlugs.map((value) => value.trim().toLowerCase()).filter(Boolean))];
  if (countySlugs.length === 0) return { ok: false as const, error: "Select at least one county." };
  if (countySlugs.length > countyLimit) return { ok: false as const, error: `Your plan includes up to ${countyLimit} counties.` };
  return { ok: true as const, countySlugs };
}

export function countySelectionUsage(activeCount: number, scheduledCount: number, countyLimit: number) {
  const used = Math.max(0, activeCount) + Math.max(0, scheduledCount);
  return { used, remaining: Math.max(0, countyLimit - used), atLimit: used >= countyLimit };
}
```

- [ ] **Step 4: Run the entitlement tests**

Run: `npm test -- tests/territory/entitlements.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json vitest.config.ts lib/territory tests/territory
git commit -m "feat: add county entitlement rules"
```

---

### Task 2: County entitlement database foundation

**Files:**
- Create: `supabase/migrations/20260823_county_entitlements.sql`

**Interfaces:**
- Produces tables: `counties`, `planning_authority_counties`, `company_counties`, `territory_change_events`.
- Extends: `companies` with address + coordinates.
- Extends: `billing_plans` with `county_limit`, `additional_county_price_id`, `additional_county_price_gbp_pence`.
- Produces RPC: `create_customer_company_with_counties(...) RETURNS uuid`.
- Produces RPC: `activate_initial_company_counties(p_company_id uuid, p_effective_at timestamptz DEFAULT now()) RETURNS integer` (service/admin intended).

- [ ] **Step 1: Write the migration with constraints and seeds**

The migration must:
- add company address fields idempotently;
- add Pro `county_limit = 3`;
- create the four county/territory tables;
- enable RLS;
- allow authenticated company members to SELECT their `company_counties` and `territory_change_events` only;
- expose read-only `counties` rows to authenticated users;
- keep `planning_authority_counties` customer-read-only or server-only;
- seed all 48 England ceremonial counties by stable slug;
- map the existing pilot authorities to their ceremonial counties;
- create the onboarding RPC that validates selected county count against `billing_plans.county_limit` and inserts initial counties as `scheduled` with `starts_at = null`;
- leave the legacy `create_customer_company` RPC intact for compatibility.

- [ ] **Step 2: Apply migration to the connected Supabase project**

Run through Supabase migration tooling against project `gerthrnlbdmayeuvlczt`.
Expected: success with no destructive operations.

- [ ] **Step 3: Verify schema and Pro allowance**

Run:

```sql
select code, county_limit from public.billing_plans where code = 'pro';
select nation, count(*) from public.counties group by nation;
select c.slug, co.slug as county_slug
from public.planning_authority_counties pac
join public.councils c on c.id = pac.council_id
join public.counties co on co.id = pac.county_id
order by c.slug;
```

Expected: Pro = 3; England county seed present; pilot mappings present.

- [ ] **Step 4: Run Supabase security advisors**

Expected: no new unexpected customer-write exposure. Internal server-only tables may intentionally report RLS-without-policy info notices.

- [ ] **Step 5: Commit migration**

```bash
git add supabase/migrations/20260823_county_entitlements.sql
git commit -m "feat: add county entitlement schema"
```

---

### Task 3: Active-only access and company county context

**Files:**
- Modify: `lib/auth.ts`
- Modify: `app/dashboard/page.tsx`
- Modify: `app/dashboard/settings/page.tsx`
- Test: `tests/territory/entitlements.test.ts`

**Interfaces:**
- `getCompanyContext()` additionally returns `companyCounties` and `countyLimit`.
- `subscriptionAllowsLeads` delegates to `subscriptionAllowsNewLeads` and therefore only accepts `active`.

- [ ] **Step 1: Extend the failing test to assert legacy helper behavior**
- [ ] **Step 2: Run test and verify failure**
- [ ] **Step 3: Update auth context and active-only helper**
- [ ] **Step 4: Render county names when entitlements exist; fall back to radius text for legacy users**
- [ ] **Step 5: Run tests and `npm run typecheck`**
- [ ] **Step 6: Commit**

---

### Task 4: County-aware onboarding RPC and server action

**Files:**
- Modify: `app/onboarding/actions.ts`
- Modify: `app/onboarding/page.tsx`
- Create: `app/components/county-selector.tsx`
- Create: `lib/territory/queries.ts`

**Interfaces:**
- Onboarding submits `county_slugs` as comma-separated stable slugs.
- Server action validates selection with the pure entitlement rule before calling the RPC.
- RPC inserts selected counties as scheduled territory; Stripe confirmation activates them.

- [ ] **Step 1: Add county selection parsing unit test**
- [ ] **Step 2: Verify failing test**
- [ ] **Step 3: Add address fields and county selector UI**
- [ ] **Step 4: Change server action to call `create_customer_company_with_counties`**
- [ ] **Step 5: Geocode the company postcode and save company coordinates plus legacy territory coordinates**
- [ ] **Step 6: Typecheck/build**
- [ ] **Step 7: Commit**

---

### Task 5: Activate initial county entitlement from Stripe

**Files:**
- Modify: `app/api/stripe/webhook/route.ts`
- Test: `tests/territory/entitlements.test.ts` or extracted webhook helper test.

**Interfaces:**
- On `checkout.session.completed` when subscription is paid/active, scheduled initial company counties with `starts_at IS NULL` become `active`, `starts_at = event-created/payment time`, and `locked_until = current_period_end` when available.
- Subscription `current_period_ends_at` reads from root subscription when present, otherwise first subscription item period end for Stripe 2026 schema.

- [ ] **Step 1: Extract/test current-period-end helper**
- [ ] **Step 2: Verify failing test with item-level period end**
- [ ] **Step 3: Implement robust period-end helper**
- [ ] **Step 4: Activate scheduled initial counties after checkout/subscription sync**
- [ ] **Step 5: Build and commit**

---

### Task 6: Interactive England ceremonial county map

**Files:**
- Modify: `package.json`
- Modify: `app/layout.tsx`
- Create: `app/components/county-map.tsx`
- Create: `public/data/england-ceremonial-counties.geojson`
- Modify: `app/onboarding/page.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- `CountyMap` props include `mode: "select" | "view"`, `selectedCountySlugs`, `countyLimit`, `businessLocation`, `coverageByCounty`, and `onSelectionChange` in select mode.
- County identity uses the same stable slugs seeded in Supabase.

- [ ] **Step 1: Add MapLibre dependency**
- [ ] **Step 2: Prepare a simplified England ceremonial county GeoJSON file with source attribution metadata**
- [ ] **Step 3: Render the polygons on a blank MapLibre style with county hover/click handling**
- [ ] **Step 4: Add business postcode marker**
- [ ] **Step 5: Enforce 3-selection visual lock in the component while retaining server enforcement**
- [ ] **Step 6: Add LIVE/PARTIAL/COMING SOON/DEGRADED styles from server data**
- [ ] **Step 7: Build, manually smoke-test interaction, commit**

---

### Task 7: Dashboard territory map and locked-change UX

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify: `app/dashboard/settings/page.tsx`
- Create: `app/dashboard/territory/page.tsx`

**Interfaces:**
- Dashboard map is view-only.
- Settings displays active/scheduled/ending counties and `3 of 3` usage.
- `Change Territory` describes next-renewal behavior; no free immediate mutation endpoint exists.
- `Add Territory` remains disabled/explanatory until `additional_county_price_id` is configured.

- [ ] **Step 1: Render county summary from `company_counties`**
- [ ] **Step 2: Add view-only map with HQ marker and lead markers**
- [ ] **Step 3: Add locked territory/change copy**
- [ ] **Step 4: Typecheck/build and commit**

---

### Task 8: Planning engine contracts and generic CSV adapter

**Files:**
- Create: `lib/planning/types.ts`
- Create: `lib/planning/adapters/csv.ts`
- Test: `tests/planning/csv-adapter.test.ts`

**Interfaces:**
- `NormalisedPlanningApplication` exactly matches the approved spec.
- `PlanningSourceRecord` contains source config and council identity.
- `fetchCsvApplications(source): Promise<NormalisedPlanningApplication[]>` uses field mapping from `source.config`.

- [ ] **Step 1: Write Wigan fixture test using REFVAL/ADDRESS/PROPOSAL/DECSN**
- [ ] **Step 2: Verify failing test**
- [ ] **Step 3: Implement generic CSV adapter**
- [ ] **Step 4: Verify test passes**
- [ ] **Step 5: Commit**

---

### Task 9: Ingestion, scoring and county matching modules

**Files:**
- Create: `lib/planning/ingest.ts`
- Create: `lib/planning/scoring.ts`
- Create: `lib/planning/matching.ts`
- Test: `tests/planning/matching.test.ts`

**Interfaces:**
- `ingestApplications(admin, source, applications)` upserts by `(council_id, external_reference)` and returns saved apps.
- `scoreSavedApplications(admin, savedApps, trade)` upserts one opportunity per app/trade.
- `matchCountyLeads(admin, councilId, savedApps, analyses, trade)` matches only active subscriptions and active county entitlements whose `starts_at <= planning_application.first_seen_at`.

- [ ] **Step 1: Write matching tests for active vs trialing, county mismatch, starts-at history restriction, score/value filters**
- [ ] **Step 2: Verify failures**
- [ ] **Step 3: Implement modules**
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

---

### Task 10: Central scanner and Wigan migration

**Files:**
- Create: `lib/planning/scanner.ts`
- Create: `app/api/cron/scan-planning/route.ts`
- Modify: `app/api/cron/scan-wigan/route.ts`
- Modify: `vercel.json`
- Test: `tests/planning/scanner.test.ts`

**Interfaces:**
- Central route loads a bounded batch of due enabled planning sources.
- One source failure is caught, recorded and does not abort the batch.
- Success sets `last_scanned_at`, `last_success_at`, clears `last_error`, resets failures and advances `next_scan_at`.
- Failure increments failures and advances `next_scan_at`; repeated failures can set council `coverage_status = 'degraded'`.

- [ ] **Step 1: Write failure-isolation test**
- [ ] **Step 2: Verify failure**
- [ ] **Step 3: Implement source scanner orchestration**
- [ ] **Step 4: Configure Wigan source field mapping in `planning_sources.config`**
- [ ] **Step 5: Run Wigan through central worker manually with CRON auth**
- [ ] **Step 6: Verify no duplicate applications/opportunities**
- [ ] **Step 7: Switch Vercel cron to central route**
- [ ] **Step 8: Commit**

---

### Task 11: First LE65 authorities one by one

**Files:**
- Modify database `councils` / `planning_sources` configuration through migrations.
- Add adapter code only where the source technology is not already supported.

**Rollout order:**
1. North West Leicestershire
2. South Derbyshire
3. East Staffordshire
4. Hinckley & Bosworth
5. Charnwood
6. Erewash

For each authority:
- [ ] discover and document official source/licence;
- [ ] configure connector in `testing`;
- [ ] import a bounded recent sample;
- [ ] verify references/proposals/postcodes/dates;
- [ ] verify Windows/Doors scoring;
- [ ] verify county mapping;
- [ ] switch authority/source to live;
- [ ] verify LE65 test account receives only entitled eligible opportunities;
- [ ] commit source configuration/adapter change before moving to the next authority.

---

### Task 12: Territory add-on and renewal-swap billing

**Files:**
- Create: `app/api/territory/add/route.ts`
- Create: `app/api/territory/replace/route.ts`
- Modify: `app/api/stripe/webhook/route.ts`
- Modify: `app/dashboard/settings/page.tsx`

**Interfaces:**
- Add territory route refuses to proceed unless `billing_plans.additional_county_price_id` is configured.
- Stripe subscription quantity represents counties above the included 3.
- New paid county activates only after a corresponding Stripe confirmation event.
- Replace route schedules old county ending/new county scheduled for `current_period_ends_at`; it does not immediately swap access.

- [ ] **Step 1: Write server-side validation tests**
- [ ] **Step 2: Implement add territory request flow behind configured add-on price**
- [ ] **Step 3: Implement next-renewal replacement scheduling**
- [ ] **Step 4: Extend webhook activation/expiry transitions**
- [ ] **Step 5: Test forged fourth-county request, payment failure and renewal swap**
- [ ] **Step 6: Commit**

---

### Task 13: Production verification and packaging

**Files:**
- Modify: `PROJECT_STATUS.md`
- Modify: `README.md`

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Run TypeScript**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: Next.js production build succeeds.

- [ ] **Step 4: Run Supabase security/performance advisors**
- [ ] **Step 5: Verify live Stripe/Supabase subscription flow still works without creating another live test subscription**
- [ ] **Step 6: Verify Wigan central ingestion remains idempotent**
- [ ] **Step 7: Verify at least one LE65-region authority creates a genuine county-matched lead**
- [ ] **Step 8: Package changed project files and provide exact Git commit/deploy commands for the user's local repo**

