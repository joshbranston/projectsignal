import { NextResponse } from "next/server";
import { syncEnglandAuthorityRegistry } from "@/lib/planning/authority-registry";
import { createAdminClient } from "@/lib/supabase/admin";

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
    const admin = createAdminClient();
    const result = await syncEnglandAuthorityRegistry(admin);

    return NextResponse.json({
      worker: "authority-registry",
      ...result
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authority registry sync failed";
    console.error("Authority registry sync error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
