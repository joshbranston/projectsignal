import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scanDuePlanningSources } from "@/lib/planning/scanner";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(
    secret && request.headers.get("authorization") === `Bearer ${secret}`
  );
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const requestedLimit = Number(new URL(request.url).searchParams.get("limit") ?? 5);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.floor(requestedLimit), 20))
      : 5;

    const admin = createAdminClient();
    const result = await scanDuePlanningSources(admin, limit);

    return NextResponse.json({
      worker: "planning",
      ...result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Planning scan failed";
    console.error("Planning scan worker error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
