import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorText, ghlConfig, listPosts, type GhlPost, type GhlSpace } from "./ghl";
import { nextSyncAt } from "./social";

interface TaskRow {
  id: string;
  list_id: string;
  status_id: string | null;
  description: string | null;
  publish_at: string | null;
  ghl_parent_id: string | null;
  ghl_parent_ids: string[] | null;
}

interface ChannelRow {
  task_id: string;
  platform: string;
  ghl_account_id: string;
  ghl_post_id: string | null;
  status: string;
  likes: number;
  comments: number;
  shares: number;
}

const ghlStatus = (s: string) => (s === "published" ? "published" : s === "failed" ? "failed" : "scheduled");

/**
 * Atualiza status, link e métricas de cada rede de um post a partir do GHL.
 * Serve tanto para o botão "Atualizar agora" quanto para o robô diário.
 */
export async function syncTask(db: SupabaseClient, taskId: string) {
  const { data: task } = await db
    .from("tasks")
    .select("id, list_id, status_id, description, publish_at, ghl_parent_id, ghl_parent_ids, lists(space_id, spaces(ghl_location_id, ghl_token_env, ghl_user_id))")
    .eq("id", taskId)
    .single();
  if (!task) return { updated: 0 };
  const space = (task.lists as unknown as { spaces: GhlSpace } | null)?.spaces ?? null;
  const { locationId, token } = ghlConfig(space);

  const { data: channels } = await db.from("social_channels").select("*").eq("task_id", taskId);
  if (!channels?.length) return { updated: 0 };

  // Um post do app pode virar vários no GHL (um por story, ou Instagram separado por causa do link):
  // busca todos pelo período e pelos códigos guardados no envio
  const t = task as TaskRow;
  const parents = new Set([...(t.ghl_parent_ids ?? []), ...(t.ghl_parent_id ? [t.ghl_parent_id] : [])]);
  const at = t.publish_at ? new Date(t.publish_at) : new Date();
  const posts = await listPosts(token, locationId, new Date(at.getTime() - 864e5), new Date(at.getTime() + 3 * 864e5));
  const mine = posts.filter((p) =>
    parents.size ? parents.has(p.parentPostId ?? "") || parents.has(p._id) : p.summary === t.description,
  );

  const now = new Date();
  let updated = 0;
  for (const c of channels as ChannelRow[]) {
    // Depois de publicado, cada rede vira um post com accountId; antes, o agendamento traz accountIds
    const ofChannel = mine.filter(
      (p) => p.accountId === c.ghl_account_id || (!p.accountId && (p as GhlPost & { accountIds?: string[] }).accountIds?.includes(c.ghl_account_id)),
    );
    if (!ofChannel.length) continue;

    const statuses = ofChannel.map((p) => ghlStatus(p.status));
    const status = statuses.includes("failed") ? "failed" : statuses.every((x) => x === "published") ? "published" : "scheduled";
    const dates = ofChannel.map((p) => (p.publishedAt ? new Date(p.publishedAt).getTime() : NaN)).filter((n) => !Number.isNaN(n));
    const publishedAt = dates.length ? new Date(Math.min(...dates)) : null;
    const m = ofChannel.reduce(
      (acc, p) => ({
        likes: acc.likes + (p.insights?.like ?? 0),
        comments: acc.comments + (p.insights?.comment ?? 0),
        shares: acc.shares + (p.insights?.share ?? 0),
      }),
      { likes: 0, comments: 0, shares: 0 },
    );
    const failed = ofChannel.find((p) => ghlStatus(p.status) === "failed");
    await db
      .from("social_channels")
      .update({
        ghl_post_id: ofChannel.length === 1 ? ofChannel[0]._id : null,
        status,
        link: ofChannel.find((p) => p.previewLink)?.previewLink ?? null,
        error: failed ? errorText(failed.error) ?? "Falha ao publicar" : null,
        published_at: publishedAt?.toISOString() ?? null,
        ...(status === "published" ? { ...m, metrics_at: now.toISOString() } : {}),
        next_sync_at: (status === "published" && publishedAt
          ? nextSyncAt(publishedAt, now)
          : new Date(now.getTime() + 60 * 60 * 1000)
        ).toISOString(),
      })
      .eq("task_id", c.task_id)
      .eq("platform", c.platform);
    if (status === "published") {
      await db
        .from("social_metrics")
        .insert({ task_id: c.task_id, platform: c.platform, ...m, impressions: (c as ChannelRow & { impressions?: number }).impressions ?? null });
    }
    updated++;
  }

  // Todas as redes publicadas: o post vai para a etapa "Publicado"
  const { data: after } = await db.from("social_channels").select("status").eq("task_id", taskId);
  if (after?.length && after.every((c) => c.status === "published")) {
    const { data: done } = await db
      .from("statuses")
      .select("id")
      .eq("list_id", (task as TaskRow).list_id)
      .eq("type", "done")
      .order("position")
      .limit(1)
      .maybeSingle();
    if (done && done.id !== (task as TaskRow).status_id) await db.from("tasks").update({ status_id: done.id }).eq("id", taskId);
  }
  return { updated };
}
