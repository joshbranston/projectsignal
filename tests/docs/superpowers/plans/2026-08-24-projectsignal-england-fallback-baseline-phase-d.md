# England Fallback Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every current England planning authority a safe PlanIt fallback source while preserving the hybrid primary/fallback architecture.

**Architecture:** Seed one PlanIt fallback per active England authority that does not already have one. Priority-county fallbacks keep their daily cadence; all newly seeded national fallbacks use a 3-day cadence and lower priority, so the existing 10-minute scheduler remains below provider-rate guidance and official sources can supersede fallbacks at any time.

**Tech Stack:** PostgreSQL/Supabase, existing PlanIt adapter, Phase B source orchestration, pg_cron/pg_net scheduler.

**Spec:** `docs/superpowers/specs/2026-08-23-projectsignal-england-rollout-design.md`

## Global Constraints

- PlanIt is fallback-only; official sources remain preferred primaries.
- Existing priority-county fallback cadence remains 1440 minutes.
- New national fallbacks use 4320-minute cadence.
- One PlanIt request maximum per 10-minute worker run remains enforced by Phase B.
- Do not overwrite any existing planning source.
- Existing customer leads and entitlements must remain unchanged.

---

### Task 1: Seed remaining England fallbacks

**Files:**
- Create: `supabase/migrations/20260824_england_planit_fallback_baseline.sql`

- [ ] Select every active England council with no existing PlanIt source.
- [ ] Insert `custom` + `provider=planit` sources as `fallback` only.
- [ ] Use 7-day lookback, 100-record page size, one page per run, and 4320-minute cadence.
- [ ] Give national fallbacks priority 900 so priority-county daily feeds win when both are due.
- [ ] Mark only discovery/configured councils as testing; do not downgrade live councils.
- [ ] Verify exactly one PlanIt fallback exists per active England authority.

### Task 2: Verify capacity and safety

- [ ] Confirm 337 active England authorities and 337 PlanIt fallback sources.
- [ ] Confirm Wigan primary remains active and suppresses its fallback while healthy.
- [ ] Confirm total active sources are 338 (337 fallbacks + Wigan primary).
- [ ] Confirm the customer lead count remains unchanged immediately after seeding.
- [ ] Leave first-pass scanning to the scheduler rather than manually bursting requests.
