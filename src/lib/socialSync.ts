import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { errorText, getPost, ghlConfig, listPosts, type GhlPost, type GhlSpace } from "./ghl";
import { nextSyncAt } from "./social";

interface TaskRow {
  id: string;
  list_id: string;
  status_id: string | null;
  description: string | null;
  publish_at: string | null;
  ghl_parent_id: string | null;
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
    .select("id, list_id, status_id, description, publish_at, ghl_parent_id, lists(space_id, spaces(ghl_location_id, ghl_token_env, ghl_user_id))")
    .eq("id", taskId)
    .single();
  if (!task) return { updated: 0 };
  const space = (task.lists as unknown as { spaces: GhlSpace } | null)?.spaces ?? null;
  const { locationId, token } = ghlConfig(space);

  const { data: channels } = await db.from("social_channels").select("*").eq("task_id", taskId);
  if (!channels?.length) return { updated: 0 };

  // Redes ainda sem o código do post no GHL: procura no período da publicação
  const missing = (channels as ChannelRow[]).filter((c) => !c.ghl_post_id);
  let found: GhlPost[] = [];
  if (missing.length) {
    const t = task as TaskRow;
    const at = t.publish_at ? new Date(t.publish_at) : new Date();
    const posts = await listPosts(token, locationId, new Date(at.getTime() - 864e5), new Date(at.getTime() + 3 * 864e5));
    found = posts.filter(
      (p) =>
        (t.ghl_parent_id && (p.parentPostId === t.ghl_parent_id || p._id === t.ghl_parent_id)) ||
        (!t.ghl_parent_id && p.summary === t.description),
    );
  }

  const now = new Date();
  let updated = 0;
  for (const c of channels as ChannelRow[]) {
    let post: GhlPost | null = null;
    if (c.ghl_post_id) post = await getPost(token, locationId, c.ghl_post_id).catch(() => null);
    post ??= found.find((p) => p.accountId === c.ghl_account_id || p.platform === c.platform) ?? null;
    if (!post) continue;

    const status = ghlStatus(post.status);
    const publishedAt = post.publishedAt ? new Date(post.publishedAt) : null;
    const m = { likes: post.insights?.like ?? 0, comments: post.insights?.comment ?? 0, shares: post.insights?.share ?? 0 };
    await db
      .from("social_channels")
      .update({
        ghl_post_id: post._id,
        status,
        link: post.previewLink || null,
        error: status === "failed" ? errorText(post.error) ?? "Falha ao publicar" : null,
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
