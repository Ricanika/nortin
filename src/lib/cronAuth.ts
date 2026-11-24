import "server-only";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Robôs: Vercel Cron (CRON_SECRET) ou Supabase pg_cron (chave em app_secrets). */
export async function cronAuthorized(request: NextRequest, db: SupabaseClient) {
  const auth = request.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (secret && auth === `Bearer ${secret}`) return true;
  if (!auth.startsWith("Bearer ") || auth.length <= 20) return false;
  const { data } = await db.from("app_secrets").select("value").eq("name", "hourly_sync").maybeSingle();
  return Boolean(data?.value) && auth === `Bearer ${data!.value}`;
}
