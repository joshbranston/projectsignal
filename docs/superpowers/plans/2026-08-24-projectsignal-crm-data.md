# ProjectSignal Customer Opportunity Manager Data Plan

**Goal:** Extend the existing customer lead model into a secure customer-specific opportunity manager with canonical stages, notes, activities, follow-ups, quotes, outcomes, and ROI metrics.

**Architecture:** Preserve `customer_leads` as the customer-owned opportunity record and `lead_events` as its audit timeline. Add opportunity state fields and a dedicated notes table in a local migration. Authenticated mutation RPCs validate membership and active county/subscription entitlement before writing, execute atomically, use a fixed empty search path, and never expose service credentials. TypeScript domain functions validate form inputs and calculate pipeline metrics independently of the UI.

**Tech stack:** Supabase/Postgres migrations and RLS, TypeScript, Zod, Node test runner.

1. Add failing tests for canonical stage normalization, mutation validation, search/filter behavior, follow-up state, quote/outcome rules, and ROI metrics.
2. Implement the CRM domain types, validation, filtering, and metrics.
3. Create a local migration that extends legacy stages compatibly, adds state fields and notes, adds indexes/RLS, and creates narrowly granted authenticated RPCs with entitlement checks and audit events.
4. Add a server-only repository/service that reads RLS-scoped opportunities and invokes the validated RPC boundary, propagating persistence errors.
5. Verify migration text with the Supabase CLI when locally available; otherwise document the unavailable local database check.

