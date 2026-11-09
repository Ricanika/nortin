import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Diagnóstico para o dono/administradores: diz SE cada variável existe no servidor, nunca o valor.
const VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "GHL_TOKEN_NITRON",
  "GHL_TOKEN_TEAK",
  "GHL_TOKEN_ROGA",
  "GEMINI_API_KEY",
];

export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Entre no app primeiro." }, { status: 401 });
  const { data: admin } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("user_id", auth.user.id)
    .in("role", ["owner", "admin"])
    .limit(1);
  if (!admin?.length) return NextResponse.json({ error: "Só dono ou administradores." }, { status: 403 });

  const variaveis = Object.fromEntries(VARS.map((v) => [v, process.env[v] ? "✅ configurada" : "❌ faltando"]));
  return NextResponse.json({ deploy: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local", variaveis });
}
