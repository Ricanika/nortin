import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sankhyaConfigured } from "@/lib/sankhya";
import { refreshBase, refreshPartner } from "@/lib/pdvSync";
import { fullAddress, mapsUrl, type PdvPartner } from "@/lib/pdv";

export const maxDuration = 60;

/**
 * Liga a visita ao parceiro do Sankhya: busca nome, endereço, vendas e curva de produtos,
 * coloca o nome no título (se o título for só o código) e o endereço como 1ª mensagem do chat.
 */
export async function POST(request: NextRequest) {
  const { taskId, codparc: raw } = (await request.json()) as { taskId?: string; codparc?: number | string };
  const codparc = Number(String(raw ?? "").replace(/\D/g, ""));
  if (!taskId || !Number.isInteger(codparc) || codparc <= 0) {
    return NextResponse.json({ error: "Informe o código do parceiro (só números)." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Entre no app primeiro." }, { status: 401 });
  const { data: task } = await supabase.from("tasks").select("id, title, pdv_codparc").eq("id", taskId).maybeSingle();
  if (!task) return NextResponse.json({ error: "Visita não encontrada" }, { status: 404 });

  const admin = createAdminClient();
  let partner: PdvPartner | null = null;
  let warning: string | null = null;
  if (sankhyaConfigured()) {
    try {
      partner = (await refreshPartner(admin, codparc)) as PdvPartner;
      const { count } = await admin.from("pdv_base_monthly").select("*", { count: "exact", head: true });
      if (!count) await refreshBase(admin).catch(() => undefined);
    } catch (e) {
      warning = (e as Error).message;
    }
  } else {
    warning = "A conexão com o Sankhya ainda não está ligada: o código foi salvo e os dados entram assim que a chave do MCP estiver na Vercel.";
  }
  if (!partner) {
    const { data } = await admin.from("pdv_partners").select("*").eq("codparc", codparc).maybeSingle();
    partner = (data as PdvPartner) ?? null;
  }

  const patch: Record<string, unknown> = { pdv_codparc: codparc };
  const titleIsCode = /^\s*\d+\s*$/.test(task.title) || task.title.trim() === "Nova visita";
  if (partner && titleIsCode) patch.title = partner.nome;
  const { error } = await supabase.from("tasks").update(patch).eq("id", taskId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Endereço no chat (uma vez por parceiro)
  if (partner) {
    const addr = fullAddress(partner);
    const marker = `📍 ${partner.nome} (cód. ${codparc})`;
    const { data: existing } = await supabase.from("comments").select("id").eq("task_id", taskId).ilike("body", `%cód. ${codparc})%`).limit(1);
    if (!existing?.length && addr) {
      const body = [marker, addr, partner.telefone ? `📞 ${partner.telefone}` : null, `🗺️ ${mapsUrl(addr)}`].filter(Boolean).join("\n");
      await supabase.from("comments").insert({ task_id: taskId, body });
    }
  }

  return NextResponse.json({ ok: true, partner, warning });
}
