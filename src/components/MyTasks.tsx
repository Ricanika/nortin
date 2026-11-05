"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { todayISO } from "@/lib/dates";
import { memberName } from "@/lib/types";
import { rowDone, useAssignedTasks, type AssignedRow } from "@/lib/useAssignedTasks";
import { Avatar } from "./TaskBits";
import AssignedTaskRow from "./AssignedTaskRow";
import CalendarView from "./CalendarView";
import { useWorkspace } from "./WorkspaceContext";

type GroupBy = "due" | "list";

const PRIORITY_ORDER: Record<string, number> = { urgent: 0, high: 1 };
const DUE_ORDER = ["Atrasadas", "Hoje", "Próximos 7 dias", "Mais adiante", "Sem prazo", "Concluídas"];

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

export default function MyTasks() {
  const { workspace, members, me } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const person = searchParams.get("p") ?? me;
  const mode = searchParams.get("m") === "cal" ? "cal" : "list";

  const { rows, error, update, toggleDone } = useAssignedTasks(workspace.id, person);
  const [groupBy, setGroupBy] = useState<GroupBy>("due");
  const [showDone, setShowDone] = useState(false);

  const all = rows ?? [];
  const open = all.filter((r) => !rowDone(r));
  const visible = (showDone ? all : open).slice().sort((a, b) => {
    const da = a.due_date ?? "9999-12-31";
    const db = b.due_date ?? "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    return (PRIORITY_ORDER[a.priority ?? ""] ?? 9) - (PRIORITY_ORDER[b.priority ?? ""] ?? 9);
  });

  const groups = new Map<string, AssignedRow[]>();
  for (const r of visible) {
    const key =
      groupBy === "due"
        ? rowDone(r)
          ? "Concluídas"
          : dueBucket(r.due_date)
        : `${r.lists?.spaces?.name ?? "—"} / ${r.lists?.name ?? "—"}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const dueRank = (k: string) => (DUE_ORDER.includes(k) ? DUE_ORDER.indexOf(k) : DUE_ORDER.length);
  const groupKeys = [...groups.keys()].sort((a, b) => (groupBy === "due" ? dueRank(a) - dueRank(b) : a.localeCompare(b)));

  const today = todayISO();
  const stats = [
    { label: "Em aberto", value: open.length, tone: "text-slate-800" },
    { label: "Atrasadas", value: open.filter((r) => r.due_date && r.due_date < today).length, tone: "text-red-600" },
    { label: "Vencem hoje", value: open.filter((r) => r.due_date === today).length, tone: "text-amber-600" },
    { label: "Concluídas", value: all.length - open.length, tone: "text-emerald-600" },
  ];

  const personMember = members.find((m) => m.user_id === person);
  const setParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.replace(`${pathname}?${params}`, { scroll: false });
  };
  const taskHref = (r: AssignedRow) => `/w/${workspace.id}/l/${r.list_id}?t=${r.parent_task_id ?? r.id}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b px-4 py-4 sm:px-6">
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
            <div className="flex overflow-hidden rounded-md border">
              {(["list", "cal"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setParam("m", m === "cal" ? "cal" : null)}
                  className={`px-3 py-1 ${mode === m ? "bg-violet-600 text-white" : "hover:bg-slate-50"}`}
                >
                  {m === "list" ? "☰ Lista" : "▣ Calendário"}
                </button>
              ))}
            </div>
            {mode === "list" && (
              <>
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
                  Concluídas
                </label>
              </>
            )}
          </div>
        </div>

        {/* Pessoas em 1 clique */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {members.map((m) => (
            <button
              key={m.user_id}
              onClick={() => setParam("p", m.user_id === me ? null : m.user_id)}
              className={`flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-3 text-xs ${
                m.user_id === person ? "border-violet-500 bg-violet-50 font-semibold text-violet-700" : "hover:bg-slate-50"
              }`}
            >
              <Avatar member={m} size={22} />
              {m.user_id === me ? "Eu" : memberName(m).split(" ")[0]}
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border px-4 py-2">
              <div className={`text-2xl font-semibold tabular-nums ${s.tone}`}>{rows ? s.value : "…"}</div>
              <div className="text-xs text-slate-500">{s.label}</div>
            </div>
          ))}
        </div>
      </header>

      {error && <div className="bg-red-50 px-6 py-2 text-sm text-red-700">{error}</div>}

      {mode === "cal" ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <CalendarView
            items={all.map((r) => ({
              id: r.id,
              title: r.parent_task_id ? `↳ ${r.title}` : r.title,
              due_date: r.due_date,
              color: r.statuses?.color ?? "#94a3b8",
              done: rowDone(r),
              priority: r.priority,
              assignees: [],
              subtitle: `${r.lists?.spaces?.name ?? ""} / ${r.lists?.name ?? ""}`,
            }))}
            members={members}
            onOpen={(id) => {
              const r = all.find((x) => x.id === id);
              if (r) router.push(taskHref(r));
            }}
            onMove={(id, date) => void update(id, { due_date: date })}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-6 overflow-auto px-4 pb-28 pt-4 sm:px-6">
          {rows && visible.length === 0 && (
            <p className="text-sm text-slate-500">
              Nenhuma tarefa {showDone ? "" : "em aberto "}marcada para {person === me ? "você" : memberName(personMember)}.
            </p>
          )}

          {groupKeys.map((key) => (
            <section key={key}>
              <h2 className={`mb-1 text-sm font-semibold ${key === "Atrasadas" ? "text-red-600" : "text-slate-700"}`}>
                {key} <span className="font-normal text-slate-400">{groups.get(key)!.length}</span>
              </h2>
              {groups.get(key)!.map((r) => (
                <AssignedTaskRow
                  key={r.id}
                  row={r}
                  href={taskHref(r)}
                  onToggle={() => void toggleDone(r)}
                  onUpdate={(patch) => void update(r.id, patch)}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
