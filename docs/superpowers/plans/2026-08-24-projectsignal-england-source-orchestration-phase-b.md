# England Source Orchestration Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ProjectSignal safely schedule and claim planning-source work across England, prefer primary/official sources, use fallback sources only when needed, and bootstrap a 10-minute Supabase scheduler without exposing CRON_SECRET.

**Architecture:** `planning_sources` gains primary/fallback role and short worker leases. A service-only Postgres RPC atomically claims due sources with one source per council and at most one PlanIt source per batch. The existing Vercel worker scans claimed sources and clears leases on success/failure. A one-time authenticated bootstrap endpoint stores the existing Vercel cron secret in Supabase Vault and schedules `pg_net` to invoke the planning worker every 10 minutes.

**Tech Stack:** Next.js 16, TypeScript, Supabase/Postgres, pg_cron, pg_net, Supabase Vault, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-23-projectsignal-england-rollout-design.md`

## Global Constraints

- Official/primary sources take precedence over PlanIt fallback sources.
- PlanIt must not become the national commercial backbone.
- At most one PlanIt source may be claimed in each scheduler run.
- Scheduler cadence is every 10 minutes.
- Source failures remain isolated and use existing exponential backoff.
- Existing Wigan and North West Leicestershire feeds and customer lead must remain intact.
- No secret may be written to source control, application logs, or plaintext migration SQL.

---

### Task 1: Source role and fallback policy

**Files:**
- Modify: `lib/planning/types.ts`
- Create: `lib/planning/source-orchestration.ts`
- Create: `tests/planning/source-orchestration.test.ts`

**Interfaces:**
- Produces: `isPlanItSource(source)`, `sourceCanFallback(source, primarySources)`, expanded `PlanningSourceRecord` role/lease fields.

- [ ] Write tests proving primary sources are preferred, fallback is eligible only without a healthy primary, and PlanIt is identifiable from config.
- [ ] Run focused test and verify RED.
- [ ] Implement minimum pure policy helpers and types.
- [ ] Run focused test and verify GREEN.

### Task 2: Atomic source claiming and leases

**Files:**
- Create: `supabase/migrations/20260824_planning_source_orchestration.sql`
- Modify: `lib/planning/scanner.ts`
- Modify: `tests/planning/scanner.test.ts`

**Interfaces:**
- Consumes RPC: `claim_due_planning_sources(p_limit integer, p_worker_token uuid, p_lease_seconds integer, p_planit_limit integer)`.
- Produces: claimed `PlanningSourceRecord[]` including `leaseToken` and `leaseExpiresAt`.

- [ ] Write scanner tests for RPC claiming and lease-aware source rows.
- [ ] Run focused tests and verify RED.
- [ ] Add source-role/lease columns and service-only claim RPC using `FOR UPDATE SKIP LOCKED`.
- [ ] Change scanner loading to claim via RPC with a UUID worker token.
- [ ] Clear the lease on both success and failure, guarded by the worker token.
- [ ] Run scanner tests and verify GREEN.

### Task 3: PlanIt safety policy

**Files:**
- Modify: `lib/planning/adapters/planit.ts`
- Modify: `tests/planning/planit-adapter.test.ts`

**Interfaces:**
- PlanIt fallback scan performs at most one HTTP page request per source run.

- [ ] Add a failing test proving `maxPages > 1` cannot cause a second PlanIt request.
- [ ] Implement the one-page safety cap while retaining up to 300 rows per call.
- [ ] Run focused tests and verify GREEN.

### Task 4: Supabase scheduler bootstrap

**Files:**
- Extend: `supabase/migrations/20260824_planning_source_orchestration.sql`
- Create: `app/api/cron/bootstrap-planning-scheduler/route.ts`
- Create: `tests/planning/scheduler-bootstrap.test.ts`

**Interfaces:**
- RPC: `bootstrap_projectsignal_planning_scheduler(p_cron_secret text, p_base_url text)` service-role only.
- Route: authenticated GET stores/updates Vault secrets and schedules one cron named `projectsignal-planning-scan-10m`.

- [ ] Write tests for base URL normalization and the service RPC call contract.
- [ ] Run focused test and verify RED.
- [ ] Implement service-only Vault bootstrap RPC using `vault.create_secret`/`vault.update_secret` and `cron.schedule` + `net.http_get` every 10 minutes.
- [ ] Implement authenticated bootstrap route without returning or logging secrets.
- [ ] Run focused test and verify GREEN.

### Task 5: Verification and production safety

**Files:**
- No new production files beyond prior tasks.

- [ ] Run `npm test` and require zero failures.
- [ ] Run `npm run typecheck` when dependencies are available.
- [ ] Run `npm run build` when dependencies are available.
- [ ] Apply the additive migration to Supabase.
- [ ] Verify Wigan and North West Leicestershire source rows are preserved and only two sources remain active.
- [ ] Run Supabase security advisor; confirm new orchestration/bootstrapping RPCs are not executable by anon/authenticated roles.
- [ ] Package only Phase B files for the user's repo.
