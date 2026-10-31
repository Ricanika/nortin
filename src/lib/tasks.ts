import type { SupabaseClient } from "@supabase/supabase-js";
import type { Priority, Status } from "./types";

export interface NewTask {
  listId: string;
  title: string;
  due?: string | null;
  priority?: Priority | null;
  assignees?: string[];
  statusId?: string;
}

/** Cria a tarefa já com prazo, prioridade e responsáveis. Sem status, cai no primeiro da lista. */
export async function createTaskFull(supabase: SupabaseClient, t: NewTask) {
  const { data, error } = await supabase
    .from("tasks")
    .insert({
      list_id: t.listId,
      title: t.title,
      due_date: t.due ?? null,
      priority: t.priority ?? null,
      status_id: t.statusId ?? null,
      // Segundos desde 1970: fica no fim da coluna sem precisar ler as vizinhas.
      position: Math.round(Date.now() / 1000),
    })
    .select("id")
    .single();
  if (error) throw error;
  if (t.assignees?.length) {
    const { error: aErr } = await supabase
      .from("task_assignees")
      .insert(t.assignees.map((user_id) => ({ task_id: data.id, user_id })));
    if (aErr) throw aErr;
  }
  return data.id as string;
}

export const isDoneType = (type?: string) => type === "done" || type === "closed";

/** Status para onde a tarefa vai ao concluir/reabrir, dentro dos status da lista dela. */
export function toggleTarget(listStatuses: Status[], currentStatusId: string | null) {
  const sorted = [...listStatuses].sort((a, b) => a.position - b.position);
  const current = sorted.find((s) => s.id === currentStatusId);
  if (isDoneType(current?.type)) return sorted.find((s) => !isDoneType(s.type)) ?? null;
  return sorted.find((s) => s.type === "done") ?? sorted.find((s) => isDoneType(s.type)) ?? null;
}
