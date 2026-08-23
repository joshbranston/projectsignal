import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

function money(min?: number | null, max?: number | null) {
  const fmt = (n: number) => n >= 1000 ? `£${Math.round(n/1000)}k` : `£${n}`;
  if (min && max) return `${fmt(min)}–${fmt(max)}`;
  if (min || max) return fmt((min || max)!);
  return "Value not estimated";
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
      .limit(10);

    if (!leads?.length) continue;

    const cards = leads.map((lead: any) => `
      <div style="border:1px solid #e4e7ec;border-radius:12px;padding:16px;margin:0 0 12px">
        <strong>${lead.score}/10 · ${lead.priority}</strong>
        <h2 style="font-size:18px;margin:7px 0">${lead.address || lead.postcode || "Planning opportunity"}</h2>
        <div><b>${money(lead.estimated_value_min_gbp, lead.estimated_value_max_gbp)}</b> estimated opportunity</div>
        <p>${lead.proposal || ""}</p>
        <p style="color:#667085">${lead.why_it_matches || ""}</p>
      </div>
    `).join("");

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "";
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:auto;color:#111827">
        <div style="font-weight:800">ProjectSignal</div>
        <h1>${leads.length} new opportunities for ${company.name}</h1>
        ${cards}
        <p><a href="${siteUrl}/dashboard">Open your ProjectSignal dashboard</a></p>
      </div>
    `;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${resendKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from,
        to: [company.billing_email],
        subject: `ProjectSignal: ${leads.length} new opportunities`,
        html
      })
    });

    const result = await res.json().catch(() => ({}));
    const now = new Date().toISOString();

    if (res.ok) {
      await admin
        .from("customer_leads")
        .update({ first_delivered_at: now, last_delivered_at: now })
        .in("id", leads.map((l: any) => l.id));

      await admin.from("email_deliveries").upsert({
        company_id: company.id,
        recipient_email: company.billing_email,
        delivery_date: now.slice(0,10),
        lead_count: leads.length,
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
        lead_count: leads.length,
        status: "failed",
        error_message: result.message ?? "Email provider error"
      }, { onConflict: "company_id,recipient_email,delivery_date" });
    }
  }

  return NextResponse.json({ digests_sent: sent });
}
