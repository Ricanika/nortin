import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cronAuth";
import { sankhyaConfigured } from "@/lib/sankhya";
import { refreshBase, refreshPartner } from "@/lib/pdvSync";

export const maxDuration = 60;

// Robô diário: atualiza as vendas das lojas com visita (menos as canceladas) e a base de comparação
export async function GET(request: NextRequest) {
  const db = createAdminClient();
  if (!(await cronAuthorized(request, db))) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!sankhyaConfigured()) return NextResponse.json({ skipped: "Sankhya não configurado" });

  const { data } = await db
    .from("tasks")
    .select("pdv_codparc, statuses(type)")
    .not("pdv_codparc", "is", null)
    .limit(1000);
  const codes = [
    ...new Set(
      (data ?? [])
        .filter((t) => (t.statuses as unknown as { type: string } | null)?.type !== "closed")
        .map((t) => t.pdv_codparc as number),
    ),
  ];
  const report = { base: 0, lojas: 0, erros: [] as string[] };
  report.base = await refreshBase(db).catch((e) => (report.erros.push(`base: ${(e as Error).message}`), 0));
  const started = Date.now();
  for (const c of codes) {
    if (Date.now() - started > 50_000) break; // limite de 60s da Vercel; o resto fica para amanhã
    try {
      await refreshPartner(db, c);
      report.lojas++;
    } catch (e) {
      report.erros.push(`${c}: ${(e as Error).message}`);
    }
  }
  return NextResponse.json(report);
}
