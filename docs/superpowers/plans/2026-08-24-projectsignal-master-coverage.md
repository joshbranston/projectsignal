# ProjectSignal National Planning Coverage Implementation Plan

**Goal:** Produce an honest, machine-readable 48-county/337-authority coverage inventory, bounded source-test automation, reviewed scoring, and operational documentation without changing production configuration.

**Architecture:** Build the inventory from the existing canonical Planning Data authority registry and entity-to-county map. Overlay a small data-only catalogue of evidenced official sources and blockers; every other authority keeps its existing PlanIt fallback and an explicit unclassified-official status. A batch runner consumes only explicitly testable official definitions, limits global and per-host concurrency, and reports sanitized results without database writes.

**Tech stack:** TypeScript, Node 22 native fetch/test runner, existing planning adapters and CLI.

1. Add failing behavior tests for inventory completeness, 48-county mapping, fallback transparency, and official-source overlays.
2. Implement coverage types, evidenced source catalogue, and inventory builder.
3. Add failing behavior tests for global concurrency two, per-host concurrency one, bounded options, failure isolation, and secret redaction.
4. Implement the reusable batch runner and CLI wrapper.
5. Add scoring/value fixtures for the required residential and negative-signal cases, verify failures, then make the smallest scoring changes.
6. Generate the complete authority/county inventory and platform/scheduler documentation from public registry data.
7. Run focused tests, then the complete Phase 1 verification suite.
