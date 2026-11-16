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
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
  if (!res.ok || json.error) throw new MetaError(json.error?.message ?? `Meta ${res.status}`);
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

/** Instagram: alcance de post/Reels; nos stories, as views (o que combinamos como "alcance"). */
export function instagramReach(mediaId: string, isStory: boolean, token: string) {
  return firstMetric(mediaId, isStory ? ["views", "reach", "impressions"] : ["reach", "views"], token);
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
