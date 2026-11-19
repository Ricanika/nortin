import "server-only";

/**
 * Leitura de alcance na Meta (Instagram e Facebook) com a chave do usuário do sistema (META_TOKEN).
 * Só leitura: insights dos posts que o GHL publicou, pelo código do post na rede.
 */
const VERSION = process.env.META_GRAPH_VERSION || "v23.0";
const BASE = `https://graph.facebook.com/${VERSION}`;

export const metaToken = () => process.env.META_TOKEN || null;

export class MetaError extends Error {}

async function graph<T>(path: string, params: Record<string, string>, token: string): Promise<T> {
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; type?: string; code?: number; error_subcode?: number; error_user_msg?: string };
  } & T;
  if (!res.ok || json.error) {
    const e = json.error;
    const detail = [e?.type, e?.code && `código ${e.code}`, e?.error_subcode && `subcódigo ${e.error_subcode}`, e?.error_user_msg]
      .filter(Boolean)
      .join(" · ");
    throw new MetaError(`${e?.message ?? `Meta ${res.status}`}${detail ? ` (${detail})` : ""} [HTTP ${res.status}]`);
  }
  return json;
}

interface InsightsResponse {
  data?: { name: string; values?: { value: number }[]; total_value?: { value: number } }[];
}

const valueOf = (r: InsightsResponse, name: string) => {
  const m = r.data?.find((d) => d.name === name);
  return m?.total_value?.value ?? m?.values?.[0]?.value ?? null;
};

/** Tenta as métricas em ordem (a Meta troca nomes entre versões) e devolve a primeira que vier. */
async function firstMetric(id: string, metrics: string[], token: string): Promise<number | null> {
  for (const metric of metrics) {
    try {
      const r = await graph<InsightsResponse>(`${id}/insights`, { metric }, token);
      const v = valueOf(r, metric);
      if (typeof v === "number") return v;
    } catch {
      // métrica não existe para esse tipo de post ou versão: tenta a próxima
    }
  }
  return null;
}

/** Diagnóstico: resposta da Meta para cada métrica de um post (valor ou erro). */
export async function probeMetrics(id: string, metrics: string[], token: string) {
  const out: Record<string, unknown> = {};
  for (const metric of metrics) {
    try {
      const r = await graph<InsightsResponse>(`${id}/insights`, { metric }, token);
      out[metric] = valueOf(r, metric);
    } catch (e) {
      out[metric] = `erro: ${(e as Error).message}`;
    }
  }
  return out;
}

/** Stories no ar agora numa conta do Instagram, com as views de cada um (teste). */
export async function liveStories(igUserId: string, token: string) {
  const r = await graph<{ data?: { id: string; timestamp?: string; permalink?: string }[] }>(
    `${igUserId}/stories`,
    { fields: "id,timestamp,permalink" },
    token,
  );
  const out = [];
  for (const st of r.data ?? []) {
    out.push({ id: st.id, publicado: st.timestamp, ...(await probeMetrics(st.id, ["views", "reach"], token)) });
  }
  return out;
}

/** Instagram: alcance de post/Reels; nos stories, as views (o que combinamos como "alcance"). */
export function instagramReach(mediaId: string, isStory: boolean, token: string) {
  return firstMetric(mediaId, isStory ? ["views", "reach", "impressions"] : ["reach", "views"], token);
}

/** Código do link do Instagram (".../reel/DfnGrxfDC52/" → "DfnGrxfDC52"). */
const shortcode = (link: string) => link.match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([^/?#]+)/)?.[1] ?? null;

/**
 * Plano B: quando o código do post que o GHL guardou não existe na Meta, procura o post
 * na lista da própria conta do Instagram pelo link e devolve o código certo.
 */
export async function instagramMediaByLink(igUserId: string, link: string, token: string): Promise<string | null> {
  const code = shortcode(link);
  if (!code) return null;
  let path = `${igUserId}/media`;
  let params: Record<string, string> = { fields: "id,permalink", limit: "50" };
  for (let page = 0; page < 4; page++) {
    const r = await graph<{ data?: { id: string; permalink?: string }[]; paging?: { cursors?: { after?: string }; next?: string } }>(path, params, token);
    const hit = r.data?.find((m) => m.permalink && shortcode(m.permalink) === code);
    if (hit) return hit.id;
    const after = r.paging?.cursors?.after;
    if (!after || !r.paging?.next) return null;
    params = { ...params, after };
    path = `${igUserId}/media`;
  }
  return null;
}

const pageTokens = new Map<string, string>();

/** Facebook: insights de post exigem a chave da Página, obtida com a chave do usuário do sistema. */
async function pageToken(pageId: string, token: string) {
  const cached = pageTokens.get(pageId);
  if (cached) return cached;
  const r = await graph<{ access_token?: string }>(pageId, { fields: "access_token" }, token);
  if (!r.access_token) throw new MetaError(`Sem acesso à página ${pageId}`);
  pageTokens.set(pageId, r.access_token);
  return r.access_token;
}

/** Facebook: alcance (pessoas únicas) do post da Página; stories da Página não têm insights por API. */
export async function facebookReach(pageId: string, postId: string, isStory: boolean, token: string) {
  if (isStory) return null;
  const pt = await pageToken(pageId, token);
  const id = postId.includes("_") ? postId : `${pageId}_${postId}`;
  return firstMetric(id, ["post_total_media_view_unique", "post_impressions_unique"], pt);
}

/** Página do Facebook a partir do código de conta do GHL ("..._106244905423649_page"). */
export function pageIdFromAccount(ghlAccountId: string) {
  return ghlAccountId.match(/_(\d+)_page$/)?.[1] ?? null;
}

/** Diagnóstico: quem é a chave, quais permissões tem e as páginas/Instagram que ela enxerga. */
export async function metaDiagnostics(token: string) {
  const me = await graph<{ id: string; name?: string }>("me", { fields: "id,name" }, token);
  const perms = await graph<{ data?: { permission: string; status: string }[] }>("me/permissions", {}, token).catch(() => ({ data: [] }));
  const pages = await graph<{ data?: { id: string; name: string; instagram_business_account?: { id: string; username?: string } }[] }>(
    "me/accounts",
    { fields: "id,name,instagram_business_account{id,username}", limit: "50" },
    token,
  ).catch(() => ({ data: [] }));
  return {
    usuario: me.name ?? me.id,
    permissoes: (perms.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission),
    paginas: (pages.data ?? []).map((p) => ({
      pagina: p.name,
      id: p.id,
      instagram: p.instagram_business_account?.username ?? (p.instagram_business_account ? p.instagram_business_account.id : null),
    })),
  };
}
