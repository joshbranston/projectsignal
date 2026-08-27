import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripeClient } from "@/lib/stripe";
import { safeBillingDiagnostic } from "@/lib/billing/checkout";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (!claims?.sub) return NextResponse.redirect(new URL("/login", request.url), 303);

  const { data: membership } = await supabase
    .from("company_members")
    .select("company_id")
    .eq("user_id", claims.sub)
    .maybeSingle();

  if (!membership) return NextResponse.redirect(new URL("/onboarding", request.url), 303);

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("provider_customer_id")
    .eq("company_id", membership.company_id)
    .maybeSingle();

  if (!subscription?.provider_customer_id) {
    return NextResponse.redirect(new URL("/dashboard", request.url), 303);
  }

  try {
    const stripe = stripeClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.provider_customer_id,
      return_url: `${siteUrl}/dashboard/settings`
    });

    return NextResponse.redirect(session.url, 303);
  } catch (error) {
    console.error("Stripe billing portal unavailable", safeBillingDiagnostic(error));
    return NextResponse.redirect(new URL("/dashboard/settings?billing=unavailable", request.url), 303);
  }
}
