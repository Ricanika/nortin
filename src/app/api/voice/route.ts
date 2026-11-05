import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Áudio -> tarefas com o Gemini. Sem GEMINI_API_KEY, o app usa o ditado do navegador.
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
// A Vercel limita o corpo da requisição em ~4,5 MB (uns 10 min de voz em opus).
const MAX_BYTES = 4 * 1024 * 1024;

export async function GET() {
  return NextResponse.json({ ai: Boolean(process.env.GEMINI_API_KEY) });
}

interface VoiceTask {
  title: string;
  assignee_ids: string[];
  due_date: string | null;
  priority: "urgent" | "high" | null;
  recurrence: "daily" | "weekdays" | "weekly" | "monthly" | "yearly" | null;
  list_id: string | null;
}

export async function POST(request: NextRequest) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: "IA de voz não configurada" }, { status: 501 });

  const form = await request.formData();
  const audio = form.get("audio");
  const workspaceId = String(form.get("workspaceId") ?? "");
  const today = String(form.get("today") ?? new Date().toISOString().slice(0, 10));
  if (!(audio instanceof Blob) || !workspaceId) {
    return NextResponse.json({ error: "Envie o áudio e o workspace" }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json({ error: "Áudio longo demais. Grave até uns 2 minutos." }, { status: 413 });
  }

  // RLS garante que só membros do workspace enxergam membros e listas.
  const supabase = await createClient();
  const [{ data: members }, { data: lists }] = await Promise.all([
    supabase.from("workspace_members").select("user_id, profiles(email, full_name)").eq("workspace_id", workspaceId),
    supabase.from("lists").select("id, name, spaces(name)").eq("workspace_id", workspaceId),
  ]);
  if (!members?.length) return NextResponse.json({ error: "Workspace não encontrado" }, { status: 404 });

  const people = members.map((m) => {
    const p = m.profiles as unknown as { email: string | null; full_name: string | null } | null;
    return { id: m.user_id, nome: p?.full_name || p?.email?.split("@")[0] || "", email: p?.email };
  });
  const listas = (lists ?? []).map((l) => ({
    id: l.id,
    nome: `${(l.spaces as unknown as { name: string } | null)?.name ?? ""} / ${l.name}`,
  }));

  const prompt = `Você recebe um áudio em português de um gestor criando tarefas para a equipe.
Hoje é ${today} (formato AAAA-MM-DD). Transcreva o áudio e extraia CADA tarefa mencionada.

Pessoas da equipe (use o id): ${JSON.stringify(people)}
Listas disponíveis (use o id): ${JSON.stringify(listas)}

Regras:
- title: curto e no imperativo, sem o nome do responsável, sem a data e sem a prioridade.
- assignee_ids: ids das pessoas citadas como responsáveis ("Bia, faz...", "pra Ana", "o Rafael vai..."). Vazio se ninguém.
- due_date: AAAA-MM-DD a partir de expressões como "amanhã", "sexta", "dia 15", "semana que vem" (= próxima segunda). null se não houver prazo.
- priority: "urgent" para urgente/pra ontem/prioridade máxima, "high" para importante/prioridade alta, senão null.
- recurrence: "daily" (todo dia), "weekdays" (dias úteis), "weekly" (toda semana, toda segunda...), "monthly" (todo mês), "yearly" (todo ano); null se não repete. Se repete e não há data, due_date é hoje; "toda sexta" leva due_date para a próxima sexta.
- list_id: só se o áudio citar claramente uma lista; senão null.`;

  const body = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: audio.type || "audio/webm", data: Buffer.from(await audio.arrayBuffer()).toString("base64") } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          transcript: { type: "STRING" },
          tasks: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                title: { type: "STRING" },
                assignee_ids: { type: "ARRAY", items: { type: "STRING" } },
                due_date: { type: "STRING", nullable: true },
                priority: { type: "STRING", enum: ["urgent", "high"], nullable: true },
                recurrence: { type: "STRING", enum: ["daily", "weekdays", "weekly", "monthly", "yearly"], nullable: true },
                list_id: { type: "STRING", nullable: true },
              },
              required: ["title", "assignee_ids"],
            },
          },
        },
        required: ["transcript", "tasks"],
      },
    },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) },
  );
  if (!res.ok) {
    console.error("gemini", res.status, await res.text());
    return NextResponse.json({ error: "Não consegui entender o áudio agora. Tente de novo ou digite." }, { status: 502 });
  }

  const json = await res.json();
  const raw = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  let parsed: { transcript?: string; tasks?: VoiceTask[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Não consegui entender o áudio. Tente falar de novo." }, { status: 502 });
  }

  // Nunca confiar cegamente: só ids que existem, só datas válidas.
  const memberIds = new Set(people.map((p) => p.id));
  const listIds = new Set(listas.map((l) => l.id));
  const tasks = (parsed.tasks ?? [])
    .filter((t) => t.title?.trim())
    .map((t) => ({
      title: t.title.trim().slice(0, 300),
      assignees: (t.assignee_ids ?? []).filter((id) => memberIds.has(id)),
      due: t.due_date && /^\d{4}-\d{2}-\d{2}$/.test(t.due_date) ? t.due_date : null,
      priority: ["urgent", "high"].includes(t.priority ?? "") ? t.priority : null,
      recurrence: ["daily", "weekdays", "weekly", "monthly", "yearly"].includes(t.recurrence ?? "") ? t.recurrence : null,
      listId: t.list_id && listIds.has(t.list_id) ? t.list_id : null,
    }));

  return NextResponse.json({ transcript: parsed.transcript ?? "", tasks });
}
