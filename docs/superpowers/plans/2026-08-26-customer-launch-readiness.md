# ProjectSignal customer launch readiness implementation plan

**Scope:** Fix evidenced launch-critical gaps without changing planning-source orchestration, fallbacks, scheduler configuration, or live commercial records.

## 1. Initial opportunity delivery

- Add a service-role-only, fixed 30-day backfill RPC.
- Reuse active subscription, active county, trade, territory score/value, authority/county mapping, and existing scored-opportunity data.
- Insert with the existing company/application/trade uniqueness constraint and return only the inserted count.
- Call it only when a Stripe event activates at least one previously scheduled county, so existing customer feeds are not retrospectively changed.
- Treat activation, subscription updates, and backfill database errors as webhook failures so Stripe can retry.

## 2. Opportunity quality

- Add regression tests for administrative follow-on applications, advertising-only applications, garage-only replacements, and common multi-dwelling wording.
- Exclude evidenced administrative/non-sales records before qualification.
- Recognise numbered multi-dwelling descriptions that include `no.` or a bedroom count.

## 3. Customer journey and billing clarity

- Rewrite homepage and pricing copy around opportunity discovery plus lightweight CRM, with the verified live £79/month and three-county allowance.
- Keep onboarding limited to the supported fenestration trade and replace numeric scoring language with customer-facing priority language.
- Remove unexplained numeric scores from customer opportunity cards/details.
- Add billing-period/cancellation information already stored from trusted Stripe webhooks.
- Require the server-configured Stripe price rather than silently falling back to a hard-coded live price; return sanitized checkout/portal errors.

## 4. Daily digest safety

- Extract and test bounded digest rendering (top five), opportunity links, HTML escaping, and no numeric score.
- Keep production sending disabled while Resend configuration is absent.

## 5. Trust, mobile, and release verification

- Add factual privacy/terms/contact placeholders only where the repository contains enough verified business information; otherwise keep legal/support identity as an explicit launch dependency.
- Exercise public, authenticated disposable, mobile, billing, CRM, tenant, and entitlement flows.
- Apply the reviewed additive migration, run Supabase advisors, clean disposable data, run all repository checks, commit, push, deploy, and smoke-test.
