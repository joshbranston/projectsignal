# Build status

Implemented:
- Marketing site and £79/month positioning
- Supabase email/password auth
- Secure onboarding via database RPC
- Territory geocoding
- Subscription-gated dashboard
- Lead pipeline status actions
- Stripe Checkout route
- Stripe Customer Portal route
- Stripe signed webhook handler
- Wigan daily planning scanner
- Windows/doors/bifold scoring engine
- Postcode radius matching
- Optional daily Resend lead digest
- Vercel Cron configuration

External secrets still required before all runtime features can operate:
- SUPABASE_SECRET_KEY
- STRIPE_RESTRICTED_KEY
- STRIPE_WEBHOOK_SECRET
- CRON_SECRET
- Optional RESEND_API_KEY / EMAIL_FROM
