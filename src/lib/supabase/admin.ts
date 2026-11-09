import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Acesso total ao banco, só no servidor (robô diário de métricas). Nunca usar em resposta a usuário. */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Falta a variável SUPABASE_SERVICE_ROLE_KEY na Vercel.");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false } });
}
