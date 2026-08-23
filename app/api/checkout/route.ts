import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripeClient } from "@/lib/stripe";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const { data: claimsData } = await supabase.auth.getClaims();
    const claims = claimsData?.claims;

    if (!claims?.sub) {
      return NextResponse.redirect(new URL("/login", request.url), 303);
    }

    const { data: membership } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("user_id", claims.sub)
      .maybeSingle();

    if (!membership) {
      return NextResponse.redirect(new URL("/onboarding", request.url), 303);
    }

    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("company_id", membership.company_id)
      .single();

    if (subscription?.status === "active") {
      return NextResponse.redirect(new URL("/dashboard", request.url), 303);
    }

    const stripe = stripeClient();

    const priceId =
      process.env.STRIPE_PRICE_ID?.trim() ||
      "price_1U7WrIDIbWZDEkGRmC5yqD9s";

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",

      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],

      success_url: `${siteUrl}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/dashboard?checkout=cancelled`,

      client_reference_id: membership.company_id,

      customer: subscription?.provider_customer_id || undefined,

      customer_email: subscription?.provider_customer_id
        ? undefined
        : (claims.email as string | undefined),

      allow_promotion_codes: true,

      metadata: {
        company_id: membership.company_id,
        user_id: claims.sub,
        plan_code: "pro",
      },

      subscription_data: {
        metadata: {
          company_id: membership.company_id,
          plan_code: "pro",
        },
      },

      integration_identifier: "projectsignal_checkout_qkzpmvta",
    });

    if (!session.url) {
      throw new Error("Stripe did not return a Checkout URL");
    }

    return NextResponse.redirect(session.url, 303);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Checkout unavailable";

    console.error("Stripe checkout error:", error);

    return NextResponse.json({ error: message }, { status: 503 });
  }
}