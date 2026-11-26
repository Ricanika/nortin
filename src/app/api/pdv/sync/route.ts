import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cronAuthorized } from "@/lib/cronAuth";
import { sankhyaConfigured } from "@/lib/sankhya";
import { addAddressComments, refreshBase, refreshPartner } from "@/lib/pdvSync";

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
  // Primeiro as lojas que ainda não têm dados; depois as atualizadas há mais tempo
  const { data: have } = codes.length
    ? await db.from("pdv_partners").select("codparc, updated_at").in("codparc", codes)
    : { data: [] as { codparc: number; updated_at: string }[] };
  const updated = new Map((have ?? []).map((h) => [h.codparc, h.updated_at]));
  codes.sort((a, b) => (updated.get(a) ?? "").localeCompare(updated.get(b) ?? ""));
  const onlyMissing = request.nextUrl.searchParams.get("faltando") === "1";
  const queue = onlyMissing ? codes.filter((c) => !updated.has(c)) : codes;

  const report = { base: 0, lojas: 0, faltavam: codes.filter((c) => !updated.has(c)).length, erros: [] as string[] };
  if (!onlyMissing) report.base = await refreshBase(db).catch((e) => (report.erros.push(`base: ${(e as Error).message}`), 0));
  const started = Date.now();
  for (const c of queue) {
    if (Date.now() - started > 50_000) break; // limite de 60s da Vercel; o resto fica para amanhã
    try {
      const partner = await refreshPartner(db, c);
      if (!updated.has(c)) await addAddressComments(db, partner).catch(() => 0);
      report.lojas++;
    } catch (e) {
      report.erros.push(`${c}: ${(e as Error).message}`);
      // limite de velocidade do MCP: para aqui e deixa o resto para a próxima rodada
      if ((e as { status?: number }).status === 429) break;
    }
    await new Promise((r) => setTimeout(r, 800)); // ritmo leve com o Sankhya
  }
  return NextResponse.json(report);
}
