import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { metaDiagnostics, metaToken, MetaError } from "@/lib/meta";

// Verificação da chave da Meta (só dono/administradores): permissões, páginas visíveis e um teste
// de alcance no último post publicado no Instagram. Nunca mostra a chave.
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Entre no app primeiro." }, { status: 401 });
  const { data: admin } = await supabase.from("workspace_members").select("role").eq("user_id", auth.user.id).in("role", ["owner", "admin"]).limit(1);
  if (!admin?.length) return NextResponse.json({ error: "Só dono ou administradores." }, { status: 403 });

  const token = metaToken();
  if (!token) return NextResponse.json({ META_TOKEN: "❌ faltando na Vercel (ou falta o Redeploy)" });

  try {
    const diag = await metaDiagnostics(token);
    const precisa = ["pages_show_list", "pages_read_engagement", "read_insights", "instagram_basic", "instagram_manage_insights"];
    const faltando = precisa.filter((p) => !diag.permissoes.includes(p));

    // Teste real: alcance do post de Instagram publicado mais recente que o app conhece
    const { data: ch } = await supabase
      .from("social_channels")
      .select("task_id, link, published_at, tasks(title, post_type)")
      .eq("platform", "instagram")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return NextResponse.json({
      META_TOKEN: "✅ configurada",
      ...diag,
      permissoes_faltando: faltando.length ? faltando : "nenhuma ✅",
      ultimo_post_instagram: ch
        ? { titulo: (ch.tasks as unknown as { title: string } | null)?.title, link: ch.link, publicado: ch.published_at }
        : "nenhum post publicado ainda",
      observacao: "O alcance dos posts é preenchido na próxima atualização (🔄 Atualizar agora no post, ou sozinho a cada hora no 1º dia).",
    });
  } catch (e) {
    return NextResponse.json({ META_TOKEN: "⚠️ configurada, mas a Meta recusou", erro: e instanceof MetaError ? e.message : String(e) }, { status: 200 });
  }
}
