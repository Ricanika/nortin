import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPublicForm } from "@/lib/briefingForm";

/**
 * Envio do formulário público de briefing: cria a tarefa na lista, com prazo, prioridade e responsável.
 * Sem login, então tudo é validado aqui; o campo "website" é uma isca para robôs (pessoas não o veem).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = await loadPublicForm(token);
  if (!form) return NextResponse.json({ error: "Este formulário não está mais disponível." }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, string | undefined>;
  if (body.website) return NextResponse.json({ ok: true }); // robô: finge que deu certo e ignora

  const clean = (v: string | undefined, max: number) => (v ?? "").trim().slice(0, max);
  const name = clean(body.name, 120);
  const email = clean(body.email, 200);
  const title = clean(body.title, 200);
  const description = clean(body.description, 5000);
  const due = clean(body.due, 10);
  const priority = body.priority === "urgent" || body.priority === "high" ? body.priority : null;
  const assignee = clean(body.assignee, 40);

  const errors: string[] = [];
  if (!name) errors.push("Informe seu nome.");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("Informe um e-mail válido.");
  if (!title) errors.push("Dê um nome para a demanda.");
  if (!description) errors.push("Descreva o que você precisa.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due < new Date().toISOString().slice(0, 10)) errors.push("Escolha um deadline de hoje em diante.");
  if (!priority) errors.push("Escolha a prioridade.");
  if (assignee && assignee !== "none" && !form.members.some((m) => m.id === assignee)) errors.push("Responsável inválido.");
  if (errors.length) return NextResponse.json({ error: errors.join(" ") }, { status: 400 });

  const db = createAdminClient();
  const { data: task, error } = await db
    .from("tasks")
    .insert({
      list_id: form.listId,
      title,
      description,
      due_date: due,
      priority,
      source: "form",
      requester_name: name,
      requester_email: email,
      created_by: null,
      position: Math.round(Date.now() / 1000),
    })
    .select("id")
    .single();
  if (error || !task) return NextResponse.json({ error: "Não deu para enviar agora. Tente de novo em instantes." }, { status: 500 });

  if (assignee && assignee !== "none") {
    await db.from("task_assignees").insert({ task_id: task.id, user_id: assignee });
  }
  return NextResponse.json({ ok: true });
}
