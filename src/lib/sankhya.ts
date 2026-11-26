import "server-only";

/**
 * Leitura do Sankhya pelo MCP da Nitron (o TI libera só views; nada de escrita).
 * Na Vercel: SANKHYA_MCP_URL (endereço do MCP) e SANKHYA_MCP_TOKEN (chave do app).
 * Opcional: SANKHYA_MCP_HEADER, se a chave não for enviada como "Authorization: Bearer".
 */
export class SankhyaError extends Error {}

export function sankhyaConfigured() {
  return Boolean(process.env.SANKHYA_MCP_URL && process.env.SANKHYA_MCP_TOKEN);
}

function headers(session?: string): Record<string, string> {
  const token = process.env.SANKHYA_MCP_TOKEN!;
  const custom = process.env.SANKHYA_MCP_HEADER;
  return {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
    ...(custom ? { [custom]: token } : { Authorization: `Bearer ${token}` }),
    ...(session ? { "mcp-session-id": session } : {}),
  };
}

let rpcId = 0;
let session: { id: string | undefined; at: number } | null = null;

/** Lê a resposta do MCP: JSON puro ou eventos (SSE) com "data: {...}". */
async function readRpc(res: Response, id: number) {
  const text = await res.text();
  const type = res.headers.get("content-type") ?? "";
  const messages = type.includes("text/event-stream")
    ? text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => {
          try {
            return JSON.parse(l.slice(5).trim());
          } catch {
            return null;
          }
        })
    : [(() => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })()];
  const msg = messages.find((m) => m && m.id === id) ?? messages.find(Boolean);
  if (!msg) throw new SankhyaError(`MCP respondeu sem conteúdo (HTTP ${res.status})`);
  if (msg.error) throw new SankhyaError(`MCP: ${msg.error.message ?? "erro"}`);
  return msg.result;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rpc(method: string, params: unknown, sessionId?: string) {
  const id = ++rpcId;
  // O MCP do TI limita a velocidade (HTTP 429): espera o tempo pedido e tenta de novo
  let res: Response | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(process.env.SANKHYA_MCP_URL!, {
      method: "POST",
      headers: headers(sessionId),
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      cache: "no-store",
    });
    if (res.status !== 429) break;
    const after = Number(res.headers.get("retry-after"));
    await wait(Number.isFinite(after) && after > 0 ? Math.min(after, 15) * 1000 : 2000 * (attempt + 1));
  }
  if (!res) throw new SankhyaError("MCP sem resposta");
  if (res.status === 429) throw Object.assign(new SankhyaError("O Sankhya está limitando as consultas agora (muitas em pouco tempo). Tente de novo em 1 minuto."), { status: 429 });
  if (res.status === 401 || res.status === 403) throw new SankhyaError(`O MCP recusou a chave do app (HTTP ${res.status})`);
  if (!res.ok) throw Object.assign(new SankhyaError(`MCP HTTP ${res.status}`), { status: res.status });
  return { result: await readRpc(res, id), session: res.headers.get("mcp-session-id") ?? undefined };
}

async function openSession() {
  if (session && Date.now() - session.at < 10 * 60 * 1000) return session.id;
  if (!sankhyaConfigured()) throw new SankhyaError("Conexão com o MCP do Sankhya ainda não configurada (faltam SANKHYA_MCP_URL e SANKHYA_MCP_TOKEN na Vercel).");
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "hyakgroup-app", version: "1.0" },
  });
  // avisa que a sessão está pronta (sem resposta esperada)
  await fetch(process.env.SANKHYA_MCP_URL!, {
    method: "POST",
    headers: headers(init.session),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    cache: "no-store",
  }).catch(() => undefined);
  session = { id: init.session, at: Date.now() };
  return session.id;
}

/** Executa um SELECT pelo MCP e devolve as linhas como objetos { COLUNA: valor }. */
export async function sankhyaQuery<T = Record<string, unknown>>(sql: string, objetivo = "App Hyak: Gestão de PDV (visitas de merchandising)"): Promise<T[]> {
  if (!/^\s*(select|with)\b/i.test(sql)) throw new SankhyaError("Só consultas de leitura");
  const call = async () =>
    rpc("tools/call", { name: "sankhya_query", arguments: { sql, objetivo, response_format: "json" } }, await openSession());
  let out;
  try {
    out = await call();
  } catch (e) {
    // sessão expirada no servidor: abre outra e tenta de novo
    if ((e as { status?: number }).status === 404 || (e as { status?: number }).status === 400) {
      session = null;
      out = await call();
    } else throw e;
  }
  const result = out.result as { isError?: boolean; content?: { type: string; text?: string }[]; structuredContent?: { rows?: T[] } };
  const text = result.content?.find((c) => c.type === "text")?.text ?? "";
  if (result.isError) throw new SankhyaError(text || "Erro na consulta");
  if (result.structuredContent?.rows) return result.structuredContent.rows;
  try {
    return ((JSON.parse(text) as { rows?: T[] }).rows ?? []) as T[];
  } catch {
    throw new SankhyaError(`Resposta inesperada do MCP: ${text.slice(0, 200)}`);
  }
}

/** Foto do produto: o MCP só devolve dados de views (sem imagens). O promotor fotografa na loja. */
export async function sankhyaProductImage(_codprod: number): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  return null;
}
