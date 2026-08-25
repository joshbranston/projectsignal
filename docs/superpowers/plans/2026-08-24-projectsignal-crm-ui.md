# ProjectSignal Customer Opportunity Manager UI Plan

**Goal:** Deliver a responsive, accessible opportunity list, detail workflow, dashboard metrics, and source-health admin view on the existing Next.js App Router application.

**Architecture:** Keep data loading in async Server Components and mutations in Server Actions. Query filters are URL-backed and share pure filter parsing with tests. Small forms submit to validated server actions; no optimistic success is shown until the database RPC succeeds. The dashboard and detail pages reuse server-side metrics and entitlement-scoped queries.

**Tech stack:** Next.js 16 App Router, React Server Components/Actions, existing CSS, Supabase SSR.

1. Add tested pure view models for query filters, stages, labels, and money/date formatting.
2. Implement `/dashboard/opportunities` with quick views, filters, search, pagination, and mobile card layout.
3. Implement `/dashboard/opportunities/[leadId]` with planning facts, official link, CRM state, notes, and activity timeline.
4. Replace the dashboard feed with pipeline KPIs, overdue/follow-up summaries, won value, and recent opportunities.
5. Add source-health read-only admin presentation using existing source health fields and scheduler recommendations.
6. Add error/empty states and responsive/accessibility CSS.
7. Run React best-practices review, focused tests, typecheck, build, complete tests, and diff checks.
