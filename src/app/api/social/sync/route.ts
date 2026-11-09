import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncTask } from "@/lib/socialSync";
import { GhlError } from "@/lib/ghl";

export const maxDuration = 60;

// Botão "Atualizar agora" de um post (usuário logado, com as permissões dele)
export async function POST(request: NextRequest) {
  const { taskId } = (await request.json()) as { taskId?: string };
  if (!taskId) return NextResponse.json({ error: "Informe o post" }, { status: 400 });
  try {
    const r = await syncTask(await createClient(), taskId);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const err = e instanceof GhlError ? e : new GhlError("Falha ao falar com o GHL");
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}

// Robô diário (Vercel Cron): atualiza os posts cujo next_sync_at já chegou
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const db = createAdminClient();
  const { data: due } = await db
    .from("social_channels")
    .select("task_id")
    .lte("next_sync_at", new Date().toISOString())
    .order("next_sync_at")
    .limit(500);
  const tasks = [...new Set((due ?? []).map((d) => d.task_id))].slice(0, 100);
  const report = { tasks: tasks.length, updated: 0, errors: [] as string[] };
  for (const id of tasks) {
    try {
      report.updated += (await syncTask(db, id)).updated;
    } catch (e) {
      report.errors.push(`${id}: ${(e as Error).message}`);
    }
  }
  return NextResponse.json(report);
}
