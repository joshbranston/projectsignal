import Stripe from "stripe";

export function stripeClient() {
  const key = process.env.STRIPE_RESTRICTED_KEY;
  if (!key) {
    throw new Error("STRIPE_RESTRICTED_KEY is not configured");
  }

  return new Stripe(key, {
    apiVersion: "2026-07-29.dahlia",
    appInfo: {
      name: "ProjectSignal",
      version: "0.1.0"
    }
  });
}
