import "server-only";

/**
 * Leitura do Sankhya pela API oficial (gateway), só consultas (DbExplorerSP.executeQuery).
 * Chaves só na Vercel: SANKHYA_APPKEY, SANKHYA_TOKEN, SANKHYA_USER, SANKHYA_PASSWORD
 * (opcional SANKHYA_URL, padrão https://api.sankhya.com.br).
 */
const BASE = () => (process.env.SANKHYA_URL || "https://api.sankhya.com.br").replace(/\/$/, "");

export class SankhyaError extends Error {}

export function sankhyaConfigured() {
  return Boolean(process.env.SANKHYA_APPKEY && process.env.SANKHYA_TOKEN && process.env.SANKHYA_USER && process.env.SANKHYA_PASSWORD);
}

let session: { bearer: string; at: number } | null = null;

async function login(): Promise<string> {
  if (session && Date.now() - session.at < 15 * 60 * 1000) return session.bearer;
  if (!sankhyaConfigured()) throw new SankhyaError("Integração com o Sankhya ainda não configurada (faltam as chaves na Vercel).");
  const res = await fetch(`${BASE()}/login`, {
    method: "POST",
    headers: {
      token: process.env.SANKHYA_TOKEN!,
      appkey: process.env.SANKHYA_APPKEY!,
      username: process.env.SANKHYA_USER!,
      password: process.env.SANKHYA_PASSWORD!,
    },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { bearerToken?: string; error?: { descricao?: string } };
  if (!res.ok || !json.bearerToken) throw new SankhyaError(`Login no Sankhya recusado${json.error?.descricao ? `: ${json.error.descricao}` : ""} (HTTP ${res.status})`);
  session = { bearer: json.bearerToken, at: Date.now() };
  return session.bearer;
}

/** Executa um SELECT e devolve as linhas como objetos { COLUNA: valor }. */
export async function sankhyaQuery<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  if (!/^\s*(select|with)\b/i.test(sql)) throw new SankhyaError("Só consultas de leitura");
  const run = async (bearer: string) =>
    fetch(`${BASE()}/gateway/v1/mge/service.sbr?serviceName=DbExplorerSP.executeQuery&outputType=json`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
      body: JSON.stringify({ serviceName: "DbExplorerSP.executeQuery", requestBody: { sql } }),
      cache: "no-store",
    });
  let res = await run(await login());
  if (res.status === 401) {
    session = null;
    res = await run(await login());
  }
  const json = (await res.json().catch(() => ({}))) as {
    status?: string;
    statusMessage?: string;
    responseBody?: { fieldsMetadata?: { name: string }[]; rows?: unknown[][] };
  };
  if (!res.ok || json.status !== "1") throw new SankhyaError(`Sankhya: ${json.statusMessage ?? `HTTP ${res.status}`}`);
  const cols = (json.responseBody?.fieldsMetadata ?? []).map((f) => f.name);
  return (json.responseBody?.rows ?? []).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i]])) as T);
}

/** Foto do produto guardada no Sankhya (campo IMAGEM). Devolve os bytes ou null. */
export async function sankhyaProductImage(codprod: number): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  const res = await fetch(`${BASE()}/gateway/v1/mge/Produto@IMAGEM@CODPROD=${codprod}.dbimage`, {
    headers: { Authorization: `Bearer ${await login()}` },
    cache: "no-store",
  }).catch(() => null);
  const type = res?.headers.get("content-type") ?? "";
  if (!res?.ok || !type.startsWith("image/")) return null;
  return { bytes: await res.arrayBuffer(), type };
}
