# Priority Counties Fallback Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate safe fallback planning coverage for every authority mapped to Leicestershire, Staffordshire and Warwickshire using the existing PlanIt adapter and national scheduler.

**Architecture:** This phase is a data/configuration rollout only. Insert one active PlanIt `fallback` source for each authority in the three priority counties that does not already have a PlanIt source, preserve all current and future primary sources, stagger first scans at ten-minute intervals, and mark newly covered authorities as `testing` until their feeds are verified.

**Tech Stack:** PostgreSQL/Supabase, existing `planning_sources` orchestration, existing PlanIt adapter, existing pg_cron/pg_net scheduler.

**Spec:** `docs/superpowers/specs/2026-08-23-projectsignal-england-rollout-design.md`

## Global Constraints

- PlanIt remains fallback-only.
- Do not overwrite or deactivate official/primary planning sources.
- Do not create duplicate PlanIt sources for an authority.
- Automated PlanIt traffic remains capped by Phase B at one request per worker run.
- Existing customer leads and county entitlements must remain unchanged.

---

### Task 1: Seed priority-county PlanIt fallbacks

**Files:**
- Create: `supabase/migrations/20260824_priority_county_planit_fallbacks.sql`

**Interfaces:**
- Consumes: `counties`, `planning_authority_counties`, `councils`, `planning_sources`.
- Produces: active `custom`/`planit` fallback sources with 7-day lookback and daily cadence.

- [ ] Select distinct current authorities mapped to `leicestershire`, `staffordshire`, or `warwickshire`.
- [ ] Exclude any council that already has a PlanIt source.
- [ ] Insert `source_role='fallback'`, `scan_every_minutes=1440`, `pageSize=100`, `maxPages=1`.
- [ ] Stagger `next_scan_at` in 10-minute increments, with Leicestershire first, then Staffordshire, then Warwickshire.
- [ ] Update only `discovery`/`configured` councils to `testing`.
- [ ] Verify source counts and that Wigan/North West Leicestershire remain unchanged.

### Task 2: Verify rollout safety

**Files:** none

**Interfaces:**
- Consumes: live Supabase state.
- Produces: verified counts and scheduler-ready fallback queue.

- [ ] Confirm 8/8 Leicestershire, 10/10 Staffordshire and 5/5 Warwickshire authorities have an active PlanIt fallback or an existing source.
- [ ] Confirm only PlanIt fallback rows were added and active source count increased by exactly 22.
- [ ] Confirm customer lead count and existing Wigan/NWL source configuration remain unchanged.
- [ ] Let the 10-minute scheduler process the queue rather than manually bursting PlanIt requests.
