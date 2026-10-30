"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { memberName, type Priority, type StatusType } from "@/lib/types";
import { Avatar, DueDate, PriorityFlag } from "./TaskBits";
import { useWorkspace } from "./WorkspaceContext";

interface Row {
  id: string;
  title: string;
  priority: Priority | null;
  due_date: string | null;
  list_id: string;
  parent_task_id: string | null;
  statuses: { name: string; color: string; type: StatusType } | null;
  lists: { name: string; spaces: { name: string; color: string } | null } | null;
}

type GroupBy = "due" | "list";

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("sv-SE"); // AAAA-MM-DD no fuso local
}

function dueBucket(due: string | null): string {
  if (!due) return "Sem prazo";
  const today = isoDate();
  if (due < today) return "Atrasadas";
  if (due === today) return "Hoje";
  if (due <= isoDate(7)) return "Próximos 7 dias";
  return "Mais adiante";
}

const DUE_ORDER = ["Atrasadas", "Hoje", "Próximos 7 dias", "Mais adiante", "Sem prazo"];

export default function MyTasks() {
  const { workspace, members, me } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const person = searchParams.get("p") ?? me;
  const supabase = useMemo(() => createClient(), []);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("due");
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("tasks")
      .select(
        "id, title, priority, due_date, list_id, parent_task_id, task_assignees!inner(user_id), statuses(name, color, type), lists(name, spaces(name, color))",
      )
      .eq("workspace_id", workspace.id)
      .eq("task_assignees.user_id", person);
    if (error) return setError(error.message);
    setRows((data ?? []) as unknown as Row[]);
  }, [supabase, workspace.id, person]);

  useEffect(() => {
    load();
    // Qualquer mudança em tarefas ou responsáveis do workspace recarrega a visão.
    let timer: ReturnType<typeof setTimeout>;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 300);
    };
    const channel = supabase
      .channel(`me:${workspace.id}:${person}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `workspace_id=eq.${workspace.id}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "task_assignees" }, reload)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [load, supabase, workspace.id, person]);

  const isDone = (r: Row) => r.statuses?.type === "done" || r.statuses?.type === "closed";
  const all = rows ?? [];
  const open = all.filter((r) => !isDone(r));
  const visible = (showDone ? all : open).slice().sort((a, b) => {
    const da = a.due_date ?? "9999-12-31";
    const db = b.due_date ?? "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    return (PRIORITY_ORDER[a.priority ?? ""] ?? 9) - (PRIORITY_ORDER[b.priority ?? ""] ?? 9);
  });

  const groups = new Map<string, Row[]>();
  for (const r of visible) {
    const key =
      groupBy === "due"
        ? isDone(r)
          ? "Concluídas"
          : dueBucket(r.due_date)
        : `${r.lists?.spaces?.name ?? "—"} / ${r.lists?.name ?? "—"}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const dueRank = (k: string) => (DUE_ORDER.includes(k) ? DUE_ORDER.indexOf(k) : DUE_ORDER.length);
  const groupKeys = [...groups.keys()].sort((a, b) =>
    groupBy === "due" ? dueRank(a) - dueRank(b) : a.localeCompare(b),
  );

  const today = isoDate();
  const stats = [
    { label: "Em aberto", value: open.length, tone: "text-slate-800" },
    { label: "Atrasadas", value: open.filter((r) => r.due_date && r.due_date < today).length, tone: "text-red-600" },
    { label: "Vencem hoje", value: open.filter((r) => r.due_date === today).length, tone: "text-amber-600" },
    { label: "Concluídas", value: all.length - open.length, tone: "text-emerald-600" },
  ];

  const personMember = members.find((m) => m.user_id === person);
  const setPerson = (id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (id === me) params.delete("p");
    else params.set("p", id);
    router.replace(`${pathname}?${params}`, { scroll: false });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {personMember && <Avatar member={personMember} size={32} />}
            <div>
              <h1 className="text-lg font-semibold">
                {person === me ? "Minhas tarefas" : `Tarefas de ${memberName(personMember)}`}
              </h1>
              <p className="text-xs text-slate-500">Tudo que está marcado, em todas as listas do workspace</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <select
              value={person}
              onChange={(e) => setPerson(e.target.value)}
              className="rounded-md border px-2 py-1 outline-none focus:border-violet-500"
              aria-label="Ver tarefas de"
            >
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.user_id === me ? "Eu" : memberName(m)}
                </option>
              ))}
            </select>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              className="rounded-md border px-2 py-1 outline-none focus:border-violet-500"
              aria-label="Agrupar por"
            >
              <option value="due">Agrupar por prazo</option>
              <option value="list">Agrupar por lista</option>
            </select>
            <label className="flex items-center gap-1.5 text-slate-600">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
              Mostrar concluídas
            </label>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border px-4 py-2">
              <div className={`text-2xl font-semibold tabular-nums ${s.tone}`}>{rows ? s.value : "…"}</div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>
      </header>

      {error && <div className="bg-red-50 px-6 py-2 text-sm text-red-700">{error}</div>}

      <div className="min-h-0 flex-1 space-y-6 overflow-auto p-6">
        {rows && visible.length === 0 && (
          <p className="text-sm text-slate-500">
            Nenhuma tarefa {showDone ? "" : "em aberto "}marcada para{" "}
            {person === me ? "você" : memberName(personMember)}. Para marcar, abra uma tarefa e escolha em
            &quot;Responsáveis&quot;.
          </p>
        )}

        {groupKeys.map((key) => (
          <section key={key}>
            <h2
              className={`mb-2 text-sm font-semibold ${key === "Atrasadas" ? "text-red-600" : "text-slate-700"}`}
            >
              {key} <span className="font-normal text-slate-400">{groups.get(key)!.length}</span>
            </h2>
            <div className="overflow-x-auto">
              {groups.get(key)!.map((r) => (
                <Link
                  key={r.id}
                  href={`/w/${workspace.id}/l/${r.list_id}?t=${r.parent_task_id ?? r.id}`}
                  className="grid min-w-[640px] grid-cols-[110px_minmax(200px,1fr)_200px_100px_80px] items-center gap-3 border-b px-2 py-2 text-sm hover:bg-slate-50"
                >
                  <span
                    className="truncate rounded px-2 py-0.5 text-center text-[11px] font-semibold uppercase text-white"
                    style={{ background: r.statuses?.color ?? "#94a3b8" }}
                  >
                    {r.statuses?.name ?? "—"}
                  </span>
                  <span className={`truncate ${isDone(r) ? "text-slate-400 line-through" : ""}`}>
                    {r.parent_task_id && <span className="mr-1 text-xs text-slate-400">↳ subtarefa ·</span>}
                    {r.title}
                  </span>
                  <span className="flex items-center gap-1.5 truncate text-xs text-slate-500">
                    <span
                      className="h-2 w-2 shrink-0 rounded-sm"
                      style={{ background: r.lists?.spaces?.color ?? "#94a3b8" }}
                    />
                    <span className="truncate">
                      {r.lists?.spaces?.name} / {r.lists?.name}
                    </span>
                  </span>
                  <PriorityFlag priority={r.priority} />
                  <DueDate date={r.due_date} />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
