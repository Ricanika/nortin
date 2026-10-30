"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { memberName, toTask, type List, type Status, type Task } from "@/lib/types";
import { useWorkspace } from "./WorkspaceContext";
import ListView from "./ListView";
import BoardView from "./BoardView";
import TaskDrawer from "./TaskDrawer";

export type TaskPatch = Partial<
  Pick<Task, "title" | "description" | "status_id" | "priority" | "due_date" | "position">
>;

export interface TaskActions {
  create: (title: string, statusId: string) => Promise<void>;
  update: (id: string, patch: TaskPatch) => Promise<void>;
  remove: (id: string) => Promise<void>;
  open: (id: string) => void;
  assign: (taskId: string, userId: string, assigned: boolean) => Promise<void>;
}

const TASK_SELECT = "*, task_assignees(user_id)";

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

export default function ListScreen({ listId }: { listId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = searchParams.get("v") === "board" ? "board" : "list";
  const openTaskId = searchParams.get("t");
  const assigneeFilter = searchParams.get("p");
  const { workspace, members, me } = useWorkspace();

  const supabase = useMemo(() => createClient(), []);
  const [list, setList] = useState<List | null>(null);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      router.replace(`${pathname}?${params}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Carga inicial
  useEffect(() => {
    Promise.all([
      supabase.from("lists").select("*").eq("id", listId).single(),
      supabase.from("statuses").select("*").eq("list_id", listId).order("position"),
      supabase
        .from("tasks")
        .select(TASK_SELECT)
        .eq("list_id", listId)
        .is("parent_task_id", null)
        .order("position"),
    ]).then(([l, s, t]) => {
      if (l.error) return setError(l.error.message);
      setList(l.data as List);
      setStatuses((s.data as Status[]) ?? []);
      setTasks((t.data ?? []).map(toTask));
    });
  }, [listId, supabase]);

  // Realtime: mudanças feitas por outras pessoas aparecem na hora
  useEffect(() => {
    const upsert = <T extends { id: string }>(rows: T[], row: T) =>
      rows.some((r) => r.id === row.id) ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row];

    const channel = supabase
      .channel(`list:${listId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `list_id=eq.${listId}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          // O payload não traz os responsáveis: preserva os que já temos.
          const row = payload.new as Omit<Task, "assignees">;
          setTasks((prev) => {
            if (row.parent_task_id) return prev;
            if (row.list_id !== listId) return prev.filter((t) => t.id !== row.id);
            const old = prev.find((t) => t.id === row.id);
            return upsert(prev, { ...row, assignees: old?.assignees ?? [] });
          });
        },
      )
      // DELETE não aceita filtro no Supabase Realtime
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, (payload) => {
        const id = (payload.old as { id: string }).id;
        setTasks((prev) => prev.filter((t) => t.id !== id));
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "statuses", filter: `list_id=eq.${listId}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          setStatuses((prev) => upsert(prev, payload.new as Status));
        },
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "statuses" }, (payload) => {
        const id = (payload.old as { id: string }).id;
        setStatuses((prev) => prev.filter((s) => s.id !== id));
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "task_assignees", filter: `workspace_id=eq.${workspace.id}` },
        (payload) => {
          const { task_id, user_id } = payload.new as { task_id: string; user_id: string };
          setTasks((prev) =>
            prev.map((t) =>
              t.id === task_id && !t.assignees.includes(user_id) ? { ...t, assignees: [...t.assignees, user_id] } : t,
            ),
          );
        },
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "task_assignees" }, (payload) => {
        const { task_id, user_id } = payload.old as { task_id: string; user_id: string };
        setTasks((prev) =>
          prev.map((t) => (t.id === task_id ? { ...t, assignees: t.assignees.filter((u) => u !== user_id) } : t)),
        );
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [listId, supabase, workspace.id]);

  const actions: TaskActions = {
    async create(title, statusId) {
      const last = tasks.filter((t) => t.status_id === statusId).sort(byPosition).at(-1);
      const { data, error } = await supabase
        .from("tasks")
        .insert({ list_id: listId, status_id: statusId, title, position: (last?.position ?? 0) + 1000 })
        .select(TASK_SELECT)
        .single();
      if (error) return setError(error.message);
      const created = toTask(data);
      // Com o filtro "pessoa" ativo, a tarefa nova já nasce marcada para ela.
      if (assigneeFilter) {
        await supabase.from("task_assignees").insert({ task_id: created.id, user_id: assigneeFilter });
        created.assignees = [assigneeFilter];
      }
      setTasks((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created]));
    },
    async update(id, patch) {
      const before = tasks;
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      const { error } = await supabase.from("tasks").update(patch).eq("id", id);
      if (error) {
        setTasks(before);
        setError(error.message);
      }
    },
    async remove(id) {
      setTasks((prev) => prev.filter((t) => t.id !== id));
      if (openTaskId === id) setParam("t", null);
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) setError(error.message);
    },
    open: (id) => setParam("t", id),
    async assign(taskId, userId, assigned) {
      const apply = (on: boolean) =>
        setTasks((prev) =>
          prev.map((t) =>
            t.id !== taskId
              ? t
              : { ...t, assignees: on ? [...new Set([...t.assignees, userId])] : t.assignees.filter((u) => u !== userId) },
          ),
        );
      apply(assigned);
      const { error } = assigned
        ? await supabase.from("task_assignees").insert({ task_id: taskId, user_id: userId })
        : await supabase.from("task_assignees").delete().eq("task_id", taskId).eq("user_id", userId);
      if (error && error.code !== "23505") {
        apply(!assigned);
        setError(error.message);
      }
    },
  };

  async function addStatus(name: string) {
    const { data, error } = await supabase
      .from("statuses")
      .insert({
        list_id: listId,
        name,
        color: "#a855f7",
        position: (statuses.at(-1)?.position ?? 0) + 1000,
      })
      .select()
      .single();
    if (error) return setError(error.message);
    setStatuses((prev) => (prev.some((s) => s.id === data.id) ? prev : [...prev, data as Status]));
  }

  async function removeStatus(id: string) {
    if (tasks.some((t) => t.status_id === id)) {
      return setError("Mova as tarefas para outro status antes de excluir este.");
    }
    if (statuses.length <= 1) return setError("A lista precisa de pelo menos um status.");
    setStatuses((prev) => prev.filter((s) => s.id !== id));
    const { error } = await supabase.from("statuses").delete().eq("id", id);
    if (error) setError(error.message);
  }

  const sortedStatuses = [...statuses].sort(byPosition);
  const q = query.trim().toLowerCase();
  const visibleTasks = [...tasks]
    .filter((t) => !q || t.title.toLowerCase().includes(q))
    .filter((t) => !assigneeFilter || t.assignees.includes(assigneeFilter))
    .sort(byPosition);
  const openTask = tasks.find((t) => t.id === openTaskId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b px-6 pt-4">
        <h1 className="text-lg font-semibold">{list?.name ?? "…"}</h1>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div className="flex gap-1 text-sm">
            {(["list", "board"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setParam("v", v === "list" ? null : v)}
                className={`border-b-2 px-3 pb-2 ${
                  view === v
                    ? "border-violet-600 font-medium text-violet-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {v === "list" ? "☰ Lista" : "▦ Quadro"}
              </button>
            ))}
          </div>
          <div className="mb-2 flex flex-wrap gap-2">
            <select
              value={assigneeFilter ?? ""}
              onChange={(e) => setParam("p", e.target.value || null)}
              className="rounded-md border px-2 py-1 text-sm outline-none focus:border-violet-500"
              aria-label="Filtrar por responsável"
            >
              <option value="">Todos os responsáveis</option>
              <option value={me}>Só as minhas</option>
              {members
                .filter((m) => m.user_id !== me)
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {memberName(m)}
                  </option>
                ))}
            </select>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar tarefas…"
              className="w-56 rounded-md border px-3 py-1 text-sm outline-none focus:border-violet-500"
            />
          </div>
        </div>
      </header>

      {error && (
        <div className="flex items-center justify-between bg-red-50 px-6 py-2 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto bg-white">
        {view === "list" ? (
          <ListView statuses={sortedStatuses} tasks={visibleTasks} actions={actions} />
        ) : (
          <BoardView
            statuses={sortedStatuses}
            tasks={visibleTasks}
            actions={actions}
            onAddStatus={addStatus}
            onRemoveStatus={removeStatus}
          />
        )}
      </div>

      {openTask && (
        <TaskDrawer
          key={openTask.id}
          task={openTask}
          statuses={sortedStatuses}
          actions={actions}
          onClose={() => setParam("t", null)}
        />
      )}
    </div>
  );
}
