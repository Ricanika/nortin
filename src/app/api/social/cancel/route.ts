import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deletePost, GhlError, ghlConfig, listPosts, type GhlSpace } from "@/lib/ghl";

/**
 * Cancela o agendamento no GHL (todas as redes ainda não publicadas) e devolve o post para "Aprovação".
 * O que já foi publicado nas redes fica como está: tirar do ar é na própria rede.
 */
export async function POST(request: NextRequest) {
  const { taskId } = (await request.json()) as { taskId?: string };
  if (!taskId) return NextResponse.json({ error: "Informe o post" }, { status: 400 });

  const supabase = await createClient();
  const { data: task } = await supabase
    .from("tasks")
    .select("id, list_id, publish_at, ghl_parent_id, lists(spaces(ghl_location_id, ghl_token_env, ghl_user_id))")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "Post não encontrado" }, { status: 404 });

  try {
    const space = (task.lists as unknown as { spaces: GhlSpace } | null)?.spaces ?? null;
    const { locationId, token } = ghlConfig(space);

    // No GHL, o agendamento é um post só com várias redes; acha pelo código guardado no envio
    let cancelled = 0;
    if (task.ghl_parent_id) {
      const at = task.publish_at ? new Date(task.publish_at) : new Date();
      const posts = await listPosts(token, locationId, new Date(at.getTime() - 2 * 864e5), new Date(at.getTime() + 2 * 864e5));
      const mine = posts.filter((p) => p.parentPostId === task.ghl_parent_id || p._id === task.ghl_parent_id);
      for (const p of mine.filter((p) => p.status !== "published")) {
        await deletePost(token, locationId, p._id);
        cancelled++;
      }
    }

    const { data: channels } = await supabase.from("social_channels").select("platform, status").eq("task_id", taskId);
    const published = (channels ?? []).filter((c) => c.status === "published").map((c) => c.platform);
    await supabase.from("social_channels").delete().eq("task_id", taskId).neq("status", "published");

    if (!published.length) {
      const { data: back } = await supabase
        .from("statuses")
        .select("id")
        .eq("list_id", task.list_id)
        .ilike("name", "aprova%")
        .maybeSingle();
      await supabase
        .from("tasks")
        .update({ ghl_parent_id: null, publish_at: null, ...(back ? { status_id: back.id } : {}) })
        .eq("id", taskId);
    }
    return NextResponse.json({ ok: true, cancelled, published });
  } catch (e) {
    const err = e instanceof GhlError ? e : new GhlError("Falha ao cancelar no GHL. Tente de novo.");
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
