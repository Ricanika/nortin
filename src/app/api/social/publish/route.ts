import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deletePost, ghl, GhlError, ghlConfig, listAccounts, type GhlAccount, type GhlSpace } from "@/lib/ghl";
import type { MediaItem } from "@/lib/social";

/**
 * Envia o post ao GHL, que publica ou agenda em cada rede escolhida.
 *
 * - "Publicar agora" agenda para daqui a 5 minutos: o GHL recusa horários muito próximos
 *   ("Schedule Date must be after current date"); se ainda recusar, tenta com 15 minutos.
 * - Stories com várias mídias: um story por mídia, 1 minuto de diferença para manter a ordem.
 * - Link de CTA: no fim do texto (clicável no Facebook, LinkedIn e YouTube); no Instagram (feed)
 *   vai como 1º comentário, num envio separado, porque a legenda do Instagram não tem link clicável.
 *   Adesivo de link em story não existe por integração: só pelo app no celular.
 */

const STORY_NETWORKS = ["instagram", "facebook"];

interface Batch {
  accounts: GhlAccount[];
  summary: string;
  media: MediaItem[];
  type: string;
  offsetMin: number;
  followUpComment?: string;
}

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
    .select("id, list_id, title, description, media, post_type, cta_url, lists(kind, spaces(ghl_location_id, ghl_token_env, ghl_user_id))")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) return NextResponse.json({ error: "Post não encontrado" }, { status: 404 });
  const list = task.lists as unknown as { kind: string; spaces: GhlSpace } | null;
  if (list?.kind !== "content") return NextResponse.json({ error: "Só listas de conteúdo publicam." }, { status: 400 });

  const { count } = await supabase.from("social_channels").select("*", { count: "exact", head: true }).eq("task_id", taskId);
  if (count) return NextResponse.json({ error: "Este post já foi enviado ao GHL." }, { status: 409 });

  const text = (task.description ?? "").trim();
  const media = (task.media ?? []) as MediaItem[];
  const cta = (task.cta_url ?? "").trim();
  const isStory = task.post_type === "story";
  if (!text && !media.length) return NextResponse.json({ error: "Escreva o texto ou adicione uma imagem ou vídeo." }, { status: 400 });

  const NOW_MARGIN_MIN = [5, 15];
  let date = when === "schedule" && publishAt ? new Date(publishAt) : new Date(Date.now() + NOW_MARGIN_MIN[0] * 60 * 1000);
  if (Number.isNaN(date.getTime()) || date.getTime() < Date.now() + 60 * 1000) {
    return NextResponse.json({ error: "Escolha um horário pelo menos 1 minuto no futuro." }, { status: 400 });
  }

  let token = "";
  let locationId = "";
  const createdIds: string[] = []; // "pai" de cada envio: acha as redes depois
  const createdPostIds: string[] = []; // código do post no GHL: para desfazer se algo falhar no meio
  try {
    const cfg = ghlConfig(list.spaces);
    token = cfg.token;
    locationId = cfg.locationId;
    if (!cfg.userId) throw new GhlError("Falta o usuário do GHL neste Space.", 400);

    const accounts = (await listAccounts(token, locationId)).filter((a) => accountIds.includes(a.id));
    const off = accounts.filter((a) => !a.active || a.isExpired);
    if (off.length) throw new GhlError(`Reconecte no GHL: ${off.map((a) => `${a.platform} (${a.name})`).join(", ")}.`, 400);
    if (accounts.length !== accountIds.length) throw new GhlError("Alguma rede escolhida não está mais no GHL.", 400);

    // Regras das redes
    const hasVideo = media.some((m) => m.type.startsWith("video/"));
    const platforms = accounts.map((a) => a.platform);
    if (platforms.includes("instagram") && !media.length) throw new GhlError("O Instagram precisa de imagem ou vídeo.", 400);
    const needVideo = platforms.filter((p) => p === "youtube" || p === "tiktok");
    if (needVideo.length && !hasVideo) throw new GhlError(`${needVideo.join(" e ")} precisa(m) de vídeo.`, 400);
    if (isStory) {
      const notStory = accounts.filter((a) => !STORY_NETWORKS.includes(a.platform));
      if (notStory.length) throw new GhlError("Stories só no Instagram e no Facebook. Desmarque as outras redes ou mude o tipo para Post.", 400);
      if (!media.length) throw new GhlError("Story precisa de imagem ou vídeo.", 400);
    }

    // Monta os envios ao GHL
    const batches: Batch[] = [];
    if (isStory) {
      // Um story por mídia, em sequência
      media.forEach((m, i) => batches.push({ accounts, summary: text, media: [m], type: "story", offsetMin: i }));
    } else {
      const withLink = cta ? `${text}${text ? "\n\n" : ""}🔗 ${cta}` : text;
      const instagram = accounts.filter((a) => a.platform === "instagram");
      const others = accounts.filter((a) => a.platform !== "instagram");
      if (cta && instagram.length) {
        // Instagram: link no 1º comentário (legenda não tem link clicável)
        batches.push({
          accounts: instagram,
          summary: `${text}${text ? "\n\n" : ""}🔗 Link no primeiro comentário`,
          media,
          type: task.post_type ?? "post",
          offsetMin: 0,
          followUpComment: `🔗 ${cta}`,
        });
        if (others.length) batches.push({ accounts: others, summary: withLink, media, type: task.post_type ?? "post", offsetMin: 0 });
      } else {
        batches.push({ accounts, summary: withLink, media, type: task.post_type ?? "post", offsetMin: 0 });
      }
    }

    const send = (b: Batch, base: Date) =>
      ghl<Record<string, unknown>>(token, `/social-media-posting/${locationId}/posts`, {
        method: "POST",
        body: {
          accountIds: b.accounts.map((a) => a.id),
          summary: b.summary,
          media: b.media.map((m) => ({ url: m.url, type: m.type })),
          type: b.type,
          status: "scheduled",
          scheduleDate: new Date(base.getTime() + b.offsetMin * 60 * 1000).toISOString(),
          userId: cfg.userId,
          ...(b.followUpComment ? { followUpComment: b.followUpComment } : {}),
          ...(b.accounts.some((a) => a.platform === "youtube")
            ? { youtubePostDetails: { title: task.title.slice(0, 100), privacyLevel: "public", type: "video" } }
            : {}),
        },
      });
    const idsOf = (created: Record<string, unknown>) => {
      const results = (created.results ?? created) as Record<string, unknown>;
      const post = (results.post ?? results) as { _id?: string; id?: string; parentPostId?: string };
      return { parent: post.parentPostId ?? post._id ?? post.id ?? null, post: post._id ?? post.id ?? null };
    };

    for (const [i, b] of batches.entries()) {
      let created: Record<string, unknown>;
      try {
        created = await send(b, date);
      } catch (e) {
        const tooSoon = e instanceof GhlError && e.status === 422 && /schedule date/i.test(e.message);
        if (i > 0 || when === "schedule" || !tooSoon) throw e;
        date = new Date(Date.now() + NOW_MARGIN_MIN[1] * 60 * 1000);
        created = await send(b, date);
      }
      const ids = idsOf(created);
      if (ids.parent) createdIds.push(ids.parent);
      if (ids.post) createdPostIds.push(ids.post);
    }

    await supabase.from("social_channels").insert(
      accounts.map((a) => ({
        task_id: taskId,
        platform: a.platform,
        ghl_account_id: a.id,
        account_name: a.name,
        status: "scheduled",
        next_sync_at: new Date(date.getTime() + (batches.length + 5) * 60 * 1000).toISOString(),
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
        ghl_parent_id: createdIds[0] ?? null,
        ghl_parent_ids: createdIds,
        due_date: date.toISOString().slice(0, 10),
        ...(scheduledStatus ? { status_id: scheduledStatus.id } : {}),
      })
      .eq("id", taskId);

    return NextResponse.json({ ok: true, publishAt: date.toISOString(), posts: createdIds.length });
  } catch (e) {
    // Falhou no meio de vários envios: desfaz os que já foram, para não sobrar agendamento pela metade
    await undoCreated(token, locationId, createdPostIds);
    const err = e instanceof GhlError ? e : new GhlError("Falha ao enviar ao GHL. Tente de novo.");
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}

async function undoCreated(token: string, locationId: string, ids: string[]) {
  if (!token || !ids.length) return;
  for (const id of ids) {
    await deletePost(token, locationId, id).catch(() => undefined);
  }
}
