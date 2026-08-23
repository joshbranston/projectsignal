import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { geocodePostcode } from "@/lib/postcodes";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (!data?.claims?.sub) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const postcode = new URL(request.url).searchParams.get("postcode")?.trim();
  if (!postcode) {
    return NextResponse.json({ error: "Postcode is required" }, { status: 400 });
  }

  const coords = await geocodePostcode(postcode);
  if (!coords) {
    return NextResponse.json({ error: "Postcode not found" }, { status: 404 });
  }

  return NextResponse.json(coords);
}
