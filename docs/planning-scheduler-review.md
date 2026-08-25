# Planning scheduler review

## Current controls

- The cron route requires an exact bearer `CRON_SECRET`, runs in the Node.js runtime, and has a 60-second maximum duration.
- A worker claims a bounded 1–20 source batch through an atomic database RPC and gives each source a 90-second lease.
- Source cadence comes from `scan_every_minutes`; success clears failure state and schedules the next normal scan.
- Failures are isolated per source, recorded safely, and use capped exponential backoff. Three consecutive failures can degrade an authority.
- Primary/fallback orchestration suppresses a fallback until all primaries meet the configured failure threshold.
- The claim RPC is configured to limit PlanIt work per invocation, preventing the common fallback host from consuming the whole batch.

## Recommendation for national scale

Keep the existing scheduler behaviour for the current production set. Before increasing the active official-source count materially:

1. keep source cadences staggered over the day rather than aligning all authorities;
2. retain one PlanIt claim per invocation and introduce a persistent per-host lease before scheduling multiple same-vendor official sources together;
3. keep the batch size at five while the route has a 60-second ceiling; adapter detail concurrency is not a substitute for cross-source host throttling;
4. add alerting on stale `last_success_at`, repeated `consecutive_failures`, expired leases, and fallback takeover;
5. classify transport/WAF/TLS blocks as long-lived disabled primaries rather than retrying them every cron run;
6. canary each new official source with a seven-day official-versus-fallback comparison before promotion.

No cron, Vault, environment, cadence, or production source changes were made as part of this review.
