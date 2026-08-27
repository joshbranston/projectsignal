import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripeClient } from "@/lib/stripe";
import {
  billingDatabaseError,
  configuredStripePriceId,
  safeBillingDiagnostic
} from "@/lib/billing/checkout";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
    if (claimsError) throw billingDatabaseError("read_auth_claims", claimsError);
    const claims = claimsData?.claims;

    if (!claims?.sub) {
      return NextResponse.redirect(new URL("/login", request.url), 303);
    }

    const { data: membership, error: membershipError } = await supabase
      .from("company_members")
      .select("company_id")
      .eq("user_id", claims.sub)
      .maybeSingle();
    if (membershipError) throw billingDatabaseError("read_company_membership", membershipError);

    if (!membership) {
      return NextResponse.redirect(new URL("/onboarding", request.url), 303);
    }

    const { data: subscription, error: subscriptionError } = await supabase
      .from("subscriptions")
      .select("*")
      .eq("company_id", membership.company_id)
      .single();
    if (subscriptionError) throw billingDatabaseError("read_subscription", subscriptionError);

    if (subscription?.status === "active") {
      return NextResponse.redirect(new URL("/dashboard", request.url), 303);
    }

    const stripe = stripeClient();

    const priceId = configuredStripePriceId(process.env.STRIPE_PRICE_ID);

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      success_url: `${siteUrl}/dashboard?checkout=success`,
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
        plan_code: "pro"
      },
      subscription_data: {
        metadata: {
          company_id: membership.company_id,
          plan_code: "pro"
        }
      },
      integration_identifier: "projectsignal_checkout_qkzpmvta"
    });

    if (!session.url) {
      throw new Error("Stripe did not return a Checkout URL");
    }

    return NextResponse.redirect(session.url, 303);
  } catch (error) {
    console.error("Stripe checkout unavailable", safeBillingDiagnostic(error));
    return NextResponse.json(
      { error: "Checkout is temporarily unavailable. Please try again." },
      { status: 503 }
    );
  }
}
