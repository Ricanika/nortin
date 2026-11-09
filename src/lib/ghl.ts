import "server-only";

/** Cliente mínimo da API do GoHighLevel (Social Planner). A chave vem da variável da Vercel indicada no Space. */
const BASE = "https://services.leadconnectorhq.com";

export interface GhlSpace {
  ghl_location_id: string | null;
  ghl_token_env: string | null;
  ghl_user_id: string | null;
}

export class GhlError extends Error {
  constructor(
    message: string,
    public status = 500,
  ) {
    super(message);
  }
}

export function ghlConfig(space: GhlSpace | null) {
  if (!space?.ghl_location_id || !space.ghl_token_env) {
    throw new GhlError("Este Space ainda não está ligado a uma subconta do GHL.", 400);
  }
  const token = process.env[space.ghl_token_env];
  if (!token) throw new GhlError(`Falta a variável ${space.ghl_token_env} na Vercel.`, 500);
  return { locationId: space.ghl_location_id, token, userId: space.ghl_user_id };
}

export async function ghl<T = unknown>(token: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const msg = (json as { message?: string | string[] } | null)?.message;
    throw new GhlError(`GHL ${res.status}: ${Array.isArray(msg) ? msg.join("; ") : msg ?? String(text).slice(0, 200)}`, res.status);
  }
  return json as T;
}

export interface GhlAccount {
  id: string;
  name: string;
  platform: string;
  type: string;
  avatar?: string;
  active: boolean;
  isExpired: boolean;
}

export interface GhlPost {
  _id: string;
  platform: string;
  status: string;
  accountId?: string;
  parentPostId?: string;
  previewLink?: string;
  publishedAt?: string;
  error?: unknown;
  summary?: string;
  insights?: { like?: number; comment?: number; share?: number };
}

export async function listAccounts(token: string, locationId: string) {
  const r = await ghl<{ results?: { accounts?: GhlAccount[] } }>(token, `/social-media-posting/${locationId}/accounts`);
  return (r.results?.accounts ?? []).filter((a) => !(a as { deleted?: boolean }).deleted);
}

/** Posts de um período (cada rede vem como um post, ligado pelo parentPostId). */
export async function listPosts(token: string, locationId: string, from: Date, to: Date) {
  const posts: GhlPost[] = [];
  for (let skip = 0; skip < 1000; skip += 100) {
    const r = await ghl<{ results?: { posts?: GhlPost[] } }>(token, `/social-media-posting/${locationId}/posts/list`, {
      method: "POST",
      body: { type: "all", skip: String(skip), limit: "100", fromDate: from.toISOString(), toDate: to.toISOString(), includeUsers: "false" },
    });
    const page = r.results?.posts ?? [];
    posts.push(...page);
    if (page.length < 100) break;
  }
  return posts;
}

export async function getPost(token: string, locationId: string, postId: string) {
  const r = await ghl<{ results?: { post?: GhlPost } }>(token, `/social-media-posting/${locationId}/posts/${postId}`);
  return r.results?.post ?? null;
}

export async function deletePost(token: string, locationId: string, postId: string) {
  await ghl(token, `/social-media-posting/${locationId}/posts/${postId}`, { method: "DELETE" });
}

export function errorText(e: unknown): string | null {
  if (!e) return null;
  if (typeof e === "string") return e;
  const o = e as { message?: string; error?: string };
  return o.message ?? o.error ?? JSON.stringify(e).slice(0, 300);
}
