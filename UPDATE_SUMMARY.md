# ProjectSignal England Territory Update

This package is based on the ProjectSignal repo uploaded on 23 August 2026.

## Included

- England ceremonial county entitlement schema and 3-county Pro allowance.
- New onboarding address + county selection flow.
- Interactive England county map with business postcode pin.
- One-time county claim screen for existing active customers.
- Locked county territory display after selection.
- Active-only lead eligibility (`trialing` no longer receives new leads).
- Stripe period-end helper and initial county activation from verified Stripe events.
- Generic planning source registry architecture.
- Generic configurable CSV adapter.
- Normalised planning ingestion, scoring, county matching and source scheduler.
- Central `/api/cron/scan-planning` route.
- Wigan compatibility route moved onto the generic engine.
- Supabase migrations retained in source control.
- 25 automated dependency-free tests.

## Verification completed in the build sandbox

- `npm test`: 25 passed, 0 failed.
- TypeScript syntax transpilation: 0 syntax diagnostics.
- Secret scan of returned source files: no live Stripe/Supabase/webhook/private-key patterns detected.

## Verification still required locally

The build sandbox cannot resolve npmjs.org, so dependencies could not be installed here. Run the commands in `DEPLOY_STEPS.md` locally before deployment, especially `npm run typecheck` and `npm run build`.

## Security

The returned ZIP intentionally excludes `.env.production.check`, `.env.local`, `.vercel`, `.next`, and `node_modules`. Do not commit any local environment files or secrets.
