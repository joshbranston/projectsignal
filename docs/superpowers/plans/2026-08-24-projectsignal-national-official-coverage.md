# ProjectSignal National Official Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify all 337 ProjectSignal planning authorities with zero unexplained entries and maximize bounded, safe official-source readiness.

**Architecture:** A static canonical catalogue is generated from reproducible discovery evidence and validated independently from runtime source activation. Discovery combines official Planning Data identities/websites, public platform/portal hints, and live Node 22 response signatures; only bounded complete source runs qualify as ready.

**Tech Stack:** TypeScript, Node 22 native fetch, Next.js 16, Cheerio, node:test.

**Spec:** `docs/superpowers/specs/2026-08-24-projectsignal-national-official-coverage-design.md`

## Global Constraints

- Never mutate Supabase, activate sources, remove PlanIt, apply migrations, deploy, push, bypass TLS/WAF, or fetch documents.
- Global live concurrency is 2 and per-host concurrency is 1.
- Default lookback is 7 days; maximum is 31.
- Default page cap is 10; absolute maximum is 25.
- Detail concurrency defaults to 4 and never exceeds 5.
- Preserve all existing CRM and earlier uncommitted planning work.

---

### Task 1: Exact classification model

**Files:**
- Modify: `lib/planning/coverage.ts`
- Modify: `lib/planning/coverage-report.ts`
- Test: `tests/planning/coverage.test.ts`
- Test: `tests/planning/coverage-report.test.ts`

**Interfaces:**
- Produces: `OfficialSourceClassification`, expanded `OfficialPlanningSourceDefinition`, exact national/county summary counters.

- [ ] Add failing tests requiring exact taxonomy, HTTPS portal URLs, evidence, investigation date, and zero-unclassified validation.
- [ ] Run focused tests and confirm the missing fields/counters fail.
- [ ] Implement the minimal typed model and validation without changing runtime source activation.
- [ ] Run focused tests to green.

### Task 2: Reproducible discovery parser

**Files:**
- Create: `lib/planning/coverage-discovery.ts`
- Create: `tests/planning/coverage-discovery.test.ts`
- Create: `scripts/investigate-planning-coverage.ts`

**Interfaces:**
- Produces: `discoverPlanningAuthorities(options): Promise<DiscoveredAuthority[]>` and safe platform-signature helpers.
- Consumes: Planning Data LPA/local-authority JSON, GDS planning-service CSV, PlanNexus coverage/detail HTML, injected `fetch` in tests.

- [ ] Write fixture tests for registry joins, current portal extraction, platform parsing, abolished-authority handling, transport classification, redirect/protocol rejection, nested cause codes, and redaction.
- [ ] Run tests and confirm discovery APIs are missing.
- [ ] Implement pure parsers first, then the concurrency-2/per-host-1 orchestrator with timeout and no response-body persistence.
- [ ] Run focused tests to green.

### Task 3: Full static classification catalogue

**Files:**
- Modify: `lib/planning/coverage-catalogue.ts`
- Create: `lib/planning/coverage-catalogue.generated.ts`
- Modify: `tests/planning/coverage-catalogue.test.ts`

**Interfaces:**
- Produces: exactly 337 unique definitions, each with a terminal classification and evidence.

- [ ] Add failing catalogue tests for 337 unique authority slugs, zero unclassified, exact status totals, HTTPS rules, and mandatory blocker/evidence fields.
- [ ] Run discovery in conservative classification mode and review unmatched/ambiguous rows.
- [ ] Research ambiguous rows from official council pages and update only evidence-backed generated records.
- [ ] Run catalogue tests to green.

### Task 4: Existing-adapter mass verification

**Files:**
- Modify: `lib/planning/coverage-runner.ts`
- Modify: `lib/planning/coverage-cli.ts`
- Modify: `tests/planning/coverage-runner.test.ts`
- Modify: `tests/planning/coverage-cli.test.ts`

**Interfaces:**
- Produces: platform filter, classification-mode detail suppression, terminal result categories, JSON verification artifact.

- [ ] Add failing tests for `--platform`, exclusion of blocked/unsupported entries, global/per-host limits, details-off classification mode, and bounded retries.
- [ ] Implement minimal runner/CLI changes.
- [ ] Run every supported candidate with seven-day bounds and record count/completeness evidence.
- [ ] Promote only passing candidates to `OFFICIAL_READY`; classify failures by observed cause.

### Task 5: New platform families where justified

**Files:**
- Create only evidenced `lib/planning/adapters/<platform>.ts` files.
- Modify: `lib/planning/scanner.ts`
- Modify: `lib/planning/source-test-cli.ts`
- Add corresponding `tests/planning/<platform>-adapter.test.ts` files.

**Interfaces:**
- Produces: `fetch<Platform>Applications(source, options)` returning the normal planning contract.

- [ ] For each candidate family, write fixture tests for date bounds, pagination, totals, dedupe, malformed responses, safe redirects, details, mismatch, timeout and redaction.
- [ ] Confirm each test fails because the provider is absent.
- [ ] Implement the smallest generic adapter that proves complete bounded retrieval.
- [ ] Verify on at least two authorities where practical; otherwise classify unsupported/incomplete.

### Task 6: National matrices and platform documentation

**Files:**
- Modify: `docs/planning-source-platforms.md`
- Regenerate: `docs/planning-authority-coverage.md`
- Regenerate: `docs/planning-authority-coverage.json`
- Modify: `docs/planning-live-verification-2026-08-24.md`

**Interfaces:**
- Produces: all 337 authority rows and all 48 county aggregates with exact classification totals.

- [ ] Add failing report assertions for council page, portal, classification, verification, blocker and investigation date.
- [ ] Regenerate both artifacts from the validated catalogue.
- [ ] Assert 337 unique authorities, 48 counties and zero unclassified.
- [ ] Document every discovered platform family and blocked class.

### Task 7: Security and performance audit

**Files:**
- Test/modify only new discovery/adapter/runner files as findings require.

- [ ] Search for insecure TLS agents, unsafe protocols, unrestricted redirects/bootstrap hosts, secret/body logging, document crawling, unbounded loops and concurrency.
- [ ] Write a failing regression test for every concrete issue found before fixing it.
- [ ] Run focused and planning test suites to green.

### Task 8: Final verification and handoff

**Files:**
- Restore only: `tsconfig.tsbuildinfo` if generated.

- [ ] Run `npm test` and record exact totals.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Restore `tsconfig.tsbuildinfo` if changed.
- [ ] Run `git diff --check`, `git status`, and `git diff --stat`.
- [ ] Confirm no secrets, production mutations, source activations, deployment, push, scheduler/CRM drift, TLS bypass, or WAF bypass.
