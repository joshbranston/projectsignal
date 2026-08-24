import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bootstrapPlanningScheduler } from "@/lib/planning/scheduler";

export const runtime = "nodejs";
export const maxDuration = 30;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cronSecret = process.env.CRON_SECRET ?? "";
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(request.url).origin;
    const admin = createAdminClient();
    const result = await bootstrapPlanningScheduler(admin, cronSecret, baseUrl);
    return NextResponse.json({ worker: "planning-scheduler-bootstrap", ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduler bootstrap failed";
    console.error("Planning scheduler bootstrap failed");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
