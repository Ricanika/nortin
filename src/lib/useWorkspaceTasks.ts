"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isDoneType, toggleTarget } from "@/lib/tasks";
import type { Priority, Status, StatusType } from "@/lib/types";
import { useToast } from "@/components/Toast";

export interface WsTask {
  id: string;
  title: string;
  priority: Priority | null;
  due_date: string | null;
  list_id: string;
  parent_task_id: string | null;
  status_id: string | null;
  created_at: string;
  updated_at: string;
  assignees: string[];
  status: { name: string; color: string; type: StatusType } | null;
  list: { name: string; space_id: string; space: { name: string; color: string } | null } | null;
}

export const wsDone = (t: WsTask) => isDoneType(t.status?.type);

type Row = Omit<WsTask, "assignees" | "status" | "list"> & {
  task_assignees: { user_id: string }[];
  statuses: WsTask["status"];
  lists: { name: string; space_id: string; spaces: { name: string; color: string } | null } | null;
};

/** Todas as tarefas do workspace, com tempo real e ações em uma ou várias tarefas. */
export function useWorkspaceTasks(workspaceId: string) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [tasks, setTasks] = useState<WsTask[] | null>(null);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([
      supabase
        .from("tasks")
        .select(
          "id, title, priority, due_date, list_id, parent_task_id, status_id, created_at, updated_at, task_assignees(user_id), statuses(name, color, type), lists(name, space_id, spaces(name, color))",
        )
        .eq("workspace_id", workspaceId)
        .limit(5000),
      supabase.from("statuses").select("*").eq("workspace_id", workspaceId),
    ]);
    if (t.error) return setError(t.error.message);
    setTasks(
      ((t.data ?? []) as unknown as Row[]).map(({ task_assignees, statuses: st, lists, ...rest }) => ({
        ...rest,
        assignees: (task_assignees ?? []).map((a) => a.user_id),
        status: st,
        list: lists ? { name: lists.name, space_id: lists.space_id, space: lists.spaces } : null,
      })),
    );
    setStatuses((s.data ?? []) as Status[]);
  }, [supabase, workspaceId]);

  useEffect(() => {
    load();
    let timer: ReturnType<typeof setTimeout>;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 500);
    };
    const channel = supabase
      .channel(`ws-tasks:${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `workspace_id=eq.${workspaceId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_assignees" }, reload)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [load, supabase, workspaceId]);

  const patchLocal = (ids: string[], fn: (t: WsTask) => WsTask) =>
    setTasks((prev) => prev?.map((t) => (ids.includes(t.id) ? fn(t) : t)) ?? prev);

  const fail = (msg: string) => {
    setError(msg);
    load();
  };

  async function update(ids: string[], patch: { due_date?: string | null; priority?: Priority | null }) {
    patchLocal(ids, (t) => ({ ...t, ...patch }));
    const { error } = await supabase.from("tasks").update(patch).in("id", ids);
    if (error) fail(error.message);
  }

  async function setStatus(id: string, statusId: string) {
    const s = statuses.find((x) => x.id === statusId);
    patchLocal([id], (t) => ({ ...t, status_id: statusId, status: s ? { name: s.name, color: s.color, type: s.type } : t.status }));
    const { error } = await supabase.from("tasks").update({ status_id: statusId }).eq("id", id);
    if (error) fail(error.message);
  }

  /** Conclui (ou reabre, se todas já estiverem concluídas) cada tarefa no status certo da lista dela. */
  async function toggleDone(ids: string[]) {
    const list = (tasks ?? []).filter((t) => ids.includes(t.id));
    const reopen = list.length > 0 && list.every(wsDone);
    const previous = list.map((t) => [t.id, t.status_id] as const);
    for (const t of list) {
      if (wsDone(t) !== reopen) continue;
      const target = toggleTarget(statuses.filter((s) => s.list_id === t.list_id), t.status_id);
      if (target) await setStatus(t.id, target.id);
    }
    const n = list.length;
    toast(reopen ? (n === 1 ? "Tarefa reaberta" : `${n} tarefas reabertas`) : n === 1 ? "Tarefa concluída ✓" : `${n} tarefas concluídas ✓`, {
      undo: () => previous.forEach(([id, sid]) => sid && void setStatus(id, sid)),
    });
  }

  async function assign(ids: string[], userId: string, on: boolean) {
    patchLocal(ids, (t) => ({
      ...t,
      assignees: on ? [...new Set([...t.assignees, userId])] : t.assignees.filter((u) => u !== userId),
    }));
    const { error } = on
      ? await supabase
          .from("task_assignees")
          .upsert(ids.map((task_id) => ({ task_id, user_id: userId })), { ignoreDuplicates: true })
      : await supabase.from("task_assignees").delete().in("task_id", ids).eq("user_id", userId);
    if (error) fail(error.message);
  }

  return { tasks, statuses, error, setError, update, setStatus, toggleDone, assign };
}
