"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isDoneType, STRUCTURE_EVENT, toggleTarget } from "@/lib/tasks";
import type { Priority, Recurrence, Status, StatusType } from "@/lib/types";
import { useToast } from "@/components/Toast";

export interface AssignedRow {
  id: string;
  title: string;
  priority: Priority | null;
  due_date: string | null;
  list_id: string;
  parent_task_id: string | null;
  status_id: string | null;
  updated_at: string;
  recurrence: Recurrence | null;
  statuses: { name: string; color: string; type: StatusType } | null;
  lists: {
    name: string;
    archived_at: string | null;
    spaces: { name: string; color: string; archived_at: string | null } | null;
  } | null;
}

/** Lista ou Space arquivado: a tarefa sai das visões. */
const inArchive = (r: AssignedRow) => Boolean(r.lists?.archived_at || r.lists?.spaces?.archived_at);

export const rowDone = (r: AssignedRow) => isDoneType(r.statuses?.type);

/** Tarefas marcadas para uma pessoa em todo o workspace, com tempo real e ações rápidas. */
export function useAssignedTasks(workspaceId: string, person: string) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [rows, setRows] = useState<AssignedRow[] | null>(null);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([
      supabase
        .from("tasks")
        .select(
          "id, title, priority, due_date, list_id, parent_task_id, status_id, updated_at, recurrence, task_assignees!inner(user_id), statuses(name, color, type), lists(name, archived_at, spaces(name, color, archived_at))",
        )
        .eq("workspace_id", workspaceId)
        .eq("task_assignees.user_id", person),
      supabase.from("statuses").select("*").eq("workspace_id", workspaceId),
    ]);
    if (t.error) return setError(t.error.message);
    setRows(((t.data ?? []) as unknown as AssignedRow[]).filter((r) => !inArchive(r)));
    setStatuses((s.data ?? []) as Status[]);
  }, [supabase, workspaceId, person]);

  useEffect(() => {
    load();
    let timer: ReturnType<typeof setTimeout>;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 400);
    };
    const channel = supabase
      .channel(`assigned:${workspaceId}:${person}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `workspace_id=eq.${workspaceId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_assignees" }, reload)
      .subscribe();
    window.addEventListener(STRUCTURE_EVENT, reload);
    return () => {
      window.removeEventListener(STRUCTURE_EVENT, reload);
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [load, supabase, workspaceId, person]);

  const patchLocal = (id: string, patch: Partial<AssignedRow>) =>
    setRows((prev) => prev?.map((r) => (r.id === id ? { ...r, ...patch } : r)) ?? prev);

  async function update(id: string, patch: { due_date?: string | null; priority?: Priority | null; recurrence?: Recurrence | null }) {
    patchLocal(id, patch);
    const { error } = await supabase.from("tasks").update(patch).eq("id", id);
    if (error) {
      setError(error.message);
      load();
    }
  }

  async function setStatus(row: AssignedRow, statusId: string) {
    const s = statuses.find((x) => x.id === statusId);
    patchLocal(row.id, { status_id: statusId, statuses: s ? { name: s.name, color: s.color, type: s.type } : row.statuses });
    const { error } = await supabase.from("tasks").update({ status_id: statusId }).eq("id", row.id);
    if (error) {
      setError(error.message);
      load();
    }
  }

  async function toggleDone(row: AssignedRow) {
    const target = toggleTarget(
      statuses.filter((s) => s.list_id === row.list_id),
      row.status_id,
    );
    if (!target || !row.status_id) return;
    const previous = row.status_id;
    const wasDone = rowDone(row);
    await setStatus(row, target.id);
    const repeats = !wasDone && target.type === "done" && row.recurrence;
    toast(wasDone ? "Tarefa reaberta" : repeats ? "Concluída ✓ · 🔁 a próxima já foi criada" : "Tarefa concluída ✓", {
      undo: () => void setStatus({ ...row, status_id: target.id }, previous),
    });
  }

  return { rows, statuses, error, reload: load, update, toggleDone };
}
