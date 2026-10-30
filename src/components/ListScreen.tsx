"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { List, Status, Task } from "@/lib/types";
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
}

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

export default function ListScreen({ listId }: { listId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = searchParams.get("v") === "board" ? "board" : "list";
  const openTaskId = searchParams.get("t");

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
        .select("*")
        .eq("list_id", listId)
        .is("parent_task_id", null)
        .order("position"),
    ]).then(([l, s, t]) => {
      if (l.error) return setError(l.error.message);
      setList(l.data as List);
      setStatuses((s.data as Status[]) ?? []);
      setTasks((t.data as Task[]) ?? []);
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
          const row = payload.new as Task;
          setTasks((prev) =>
            row.parent_task_id
              ? prev
              : row.list_id === listId
                ? upsert(prev, row)
                : prev.filter((t) => t.id !== row.id),
          );
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [listId, supabase]);

  const actions: TaskActions = {
    async create(title, statusId) {
      const last = tasks.filter((t) => t.status_id === statusId).sort(byPosition).at(-1);
      const { data, error } = await supabase
        .from("tasks")
        .insert({ list_id: listId, status_id: statusId, title, position: (last?.position ?? 0) + 1000 })
        .select()
        .single();
      if (error) return setError(error.message);
      setTasks((prev) => (prev.some((t) => t.id === data.id) ? prev : [...prev, data as Task]));
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
    .sort(byPosition);
  const openTask = tasks.find((t) => t.id === openTaskId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b px-6 pt-4">
        <h1 className="text-lg font-semibold">{list?.name ?? "…"}</h1>
        <div className="mt-3 flex items-end justify-between gap-4">
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
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar tarefas…"
            className="mb-2 w-56 rounded-md border px-3 py-1 text-sm outline-none focus:border-violet-500"
          />
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
