import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ghl, GhlError, ghlConfig, listAccounts, type GhlSpace } from "@/lib/ghl";
import type { MediaItem } from "@/lib/social";

/**
 * Envia o post ao GHL, que publica ou agenda em cada rede escolhida.
 * "Publicar agora" agenda para daqui a 2 minutos: o GHL só aceita data futura de forma confiável.
 */
export async function POST(request: NextRequest) {
  const { taskId, accountIds, when, publishAt } = (await request.json()) as {
    taskId?: string;
    accountIds?: string[];
    when?: "now" | "schedule";
    publishAt?: string;
  };
  if (!taskId || !accountIds?.length) {
    return NextResponse.json({ error: "Escolha pelo menos uma rede." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: task } = await supabase
    .from("tasks")
    .select("id, list_id, title, description, media, post_type, ghl_parent_id, lists(kind, spaces(ghl_location_id, ghl_token_env, ghl_user_id))")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "Post não encontrado" }, { status: 404 });
  const list = task.lists as unknown as { kind: string; spaces: GhlSpace } | null;
  if (list?.kind !== "content") return NextResponse.json({ error: "Só listas de conteúdo publicam." }, { status: 400 });

  const { count } = await supabase.from("social_channels").select("*", { count: "exact", head: true }).eq("task_id", taskId);
  if (count) return NextResponse.json({ error: "Este post já foi enviado ao GHL." }, { status: 409 });

  const text = (task.description ?? "").trim();
  const media = (task.media ?? []) as MediaItem[];
  if (!text && !media.length) return NextResponse.json({ error: "Escreva o texto ou adicione uma imagem ou vídeo." }, { status: 400 });

  const date = when === "schedule" && publishAt ? new Date(publishAt) : new Date(Date.now() + 2 * 60 * 1000);
  if (Number.isNaN(date.getTime()) || date.getTime() < Date.now() + 60 * 1000) {
    return NextResponse.json({ error: "Escolha um horário pelo menos 1 minuto no futuro." }, { status: 400 });
  }

  try {
    const { locationId, token, userId } = ghlConfig(list.spaces);
    if (!userId) throw new GhlError("Falta o usuário do GHL neste Space.", 400);

    const accounts = (await listAccounts(token, locationId)).filter((a) => accountIds.includes(a.id));
    const off = accounts.filter((a) => !a.active || a.isExpired);
    if (off.length) throw new GhlError(`Reconecte no GHL: ${off.map((a) => `${a.platform} (${a.name})`).join(", ")}.`, 400);
    if (accounts.length !== accountIds.length) throw new GhlError("Alguma rede escolhida não está mais no GHL.", 400);

    // Regras das redes: Instagram não aceita só texto; YouTube e TikTok precisam de vídeo
    const hasVideo = media.some((m) => m.type.startsWith("video/"));
    const platforms = accounts.map((a) => a.platform);
    if (platforms.includes("instagram") && !media.length) throw new GhlError("O Instagram precisa de imagem ou vídeo.", 400);
    const needVideo = platforms.filter((p) => p === "youtube" || p === "tiktok");
    if (needVideo.length && !hasVideo) throw new GhlError(`${needVideo.join(" e ")} precisa(m) de vídeo.`, 400);

    const created = await ghl<Record<string, unknown>>(token, `/social-media-posting/${locationId}/posts`, {
      method: "POST",
      body: {
        accountIds,
        summary: text,
        media: media.map((m) => ({ url: m.url, type: m.type })),
        type: task.post_type ?? "post",
        status: "scheduled",
        scheduleDate: date.toISOString(),
        userId,
        ...(platforms.includes("youtube") ? { youtubePostDetails: { title: task.title.slice(0, 100), privacyLevel: "public", type: "video" } } : {}),
      },
    });

    // O GHL devolve o post "pai" (ou o primeiro filho); guardamos o que vier para achar cada rede depois
    const results = (created.results ?? created) as Record<string, unknown>;
    const post = (results.post ?? results) as { _id?: string; id?: string; parentPostId?: string };
    const parentId = post.parentPostId ?? post._id ?? post.id ?? null;

    await supabase.from("social_channels").insert(
      accounts.map((a) => ({
        task_id: taskId,
        platform: a.platform,
        ghl_account_id: a.id,
        account_name: a.name,
        status: "scheduled",
        next_sync_at: new Date(date.getTime() + 5 * 60 * 1000).toISOString(),
      })),
    );

    const { data: scheduledStatus } = await supabase
      .from("statuses")
      .select("id")
      .eq("list_id", task.list_id)
      .ilike("name", "agendado")
      .maybeSingle();
    await supabase
      .from("tasks")
      .update({
        publish_at: date.toISOString(),
        ghl_parent_id: parentId,
        due_date: date.toISOString().slice(0, 10),
        ...(scheduledStatus ? { status_id: scheduledStatus.id } : {}),
      })
      .eq("id", taskId);

    return NextResponse.json({ ok: true, publishAt: date.toISOString(), parentId });
  } catch (e) {
    const err = e instanceof GhlError ? e : new GhlError("Falha ao enviar ao GHL. Tente de novo.");
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
