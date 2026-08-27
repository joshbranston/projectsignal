import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildDailyOpportunityDigest } from "@/lib/notifications/digest";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const resendKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!resendKey || !from) {
    return NextResponse.json({ skipped: true, reason: "RESEND_API_KEY / EMAIL_FROM not configured" });
  }

  const admin = createAdminClient();
  const { data: subscriptions } = await admin
    .from("subscriptions")
    .select("company_id")
    .in("status", ["active","trialing"]);

  let sent = 0;
  for (const subscription of subscriptions ?? []) {
    const { data: company } = await admin
      .from("companies")
      .select("id,name,billing_email")
      .eq("id", subscription.company_id)
      .single();

    if (!company?.billing_email) continue;

    const { data: leads } = await admin
      .from("customer_leads")
      .select("*")
      .eq("company_id", company.id)
      .is("first_delivered_at", null)
      .order("score", { ascending: false })
      .limit(5);

    if (!leads?.length) continue;

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const digest = buildDailyOpportunityDigest({ companyName: company.name, leads, siteUrl });
    if (!digest) continue;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${resendKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [company.billing_email],
        subject: digest.subject,
        html: digest.html
      })
    });

    const result = await res.json().catch(() => ({}));
    const now = new Date().toISOString();

    if (res.ok) {
      await admin
        .from("customer_leads")
        .update({ first_delivered_at: now, last_delivered_at: now })
        .in("id", digest.leadIds);

      await admin.from("email_deliveries").upsert({
        company_id: company.id,
        recipient_email: company.billing_email,
        delivery_date: now.slice(0,10),
        lead_count: digest.leadIds.length,
        status: "sent",
        provider_message_id: result.id ?? null,
        sent_at: now
      }, { onConflict: "company_id,recipient_email,delivery_date" });
      sent++;
    } else {
      await admin.from("email_deliveries").upsert({
        company_id: company.id,
        recipient_email: company.billing_email,
        delivery_date: now.slice(0,10),
        lead_count: digest.leadIds.length,
        status: "failed",
        error_message: result.message ?? "Email provider error"
      }, { onConflict: "company_id,recipient_email,delivery_date" });
    }
  }

  return NextResponse.json({ digests_sent: sent });
}
