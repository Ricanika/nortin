"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { addDays, friendlyDate, nextWeekday, todayISO, ymd } from "@/lib/dates";
import { memberName, type Member, type Priority, type Recurrence, type Status } from "@/lib/types";
import { useWorkspaceTasks, wsDone, type WsTask } from "@/lib/useWorkspaceTasks";
import { CompleteToggle, DuePicker, PriorityPicker, StatusPicker } from "./InlineEditors";
import { AssigneePicker, Avatar } from "./TaskBits";
import { useWorkspace } from "./WorkspaceContext";

type Tab = "todas" | "membros" | "semprazo";
type Situation = "open" | "late" | "today" | "all" | "done";
type Sort = "due" | "priority" | "recent";

const TABS: { key: Tab; label: string }[] = [
  { key: "todas", label: "Todas as tarefas" },
  { key: "membros", label: "Por membro" },
  { key: "semprazo", label: "Sem prazo" },
];

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1 };
const NOBODY = "__nobody__";

// Faixas de prazo usadas nas barras de carga por membro
const BANDS = [
  { key: "late", label: "Atrasadas", color: "#ef4444" },
  { key: "today", label: "Hoje", color: "#f59e0b" },
  { key: "week", label: "7 dias", color: "#8b5cf6" },
  { key: "later", label: "Depois", color: "#60a5fa" },
  { key: "nodate", label: "Sem prazo", color: "#cbd5e1" },
] as const;
type Band = (typeof BANDS)[number]["key"];

function bandOf(t: WsTask, today: string, week: string): Band {
  if (!t.due_date) return "nodate";
  if (t.due_date < today) return "late";
  if (t.due_date === today) return "today";
  if (t.due_date <= week) return "week";
  return "later";
}

export default function Gestao() {
  const { workspace, members, role } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: Tab = tabParam === "membros" || tabParam === "semprazo" ? tabParam : "todas";

  const { tasks, statuses, error, setError, update, setStatus, toggleDone, assign } = useWorkspaceTasks(workspace.id);

  const [query, setQuery] = useState("");
  const [space, setSpace] = useState("");
  const [person, setPerson] = useState("");
  const [priority, setPriority] = useState("");
  const [situation, setSituation] = useState<Situation>("open");
  const [sort, setSort] = useState<Sort>("due");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openMember, setOpenMember] = useState<string | null>(null);

  if (role !== "owner" && role !== "admin") {
    return <p className="p-6 text-sm text-slate-500">A visão de gestão é do dono e dos administradores do workspace.</p>;
  }

  const today = todayISO();
  const week = ymd(addDays(new Date(), 7));
  const all = tasks ?? [];
  const open = all.filter((t) => !wsDone(t));

  const spaces = [...new Map(all.filter((t) => t.list).map((t) => [t.list!.space_id, t.list!.space?.name ?? ""])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1]),
  );

  // Filtros comuns às abas de lista
  const q = query.trim().toLowerCase();
  const filtered = all.filter((t) => {
    if (q && !t.title.toLowerCase().includes(q) && !(t.list?.name ?? "").toLowerCase().includes(q)) return false;
    if (space && t.list?.space_id !== space) return false;
    if (person === NOBODY ? t.assignees.length > 0 : person && !t.assignees.includes(person)) return false;
    if (priority && (t.priority ?? "none") !== priority) return false;
    const done = wsDone(t);
    if (situation === "open" && done) return false;
    if (situation === "done" && !done) return false;
    if (situation === "late" && (done || !t.due_date || t.due_date >= today)) return false;
    if (situation === "today" && (done || t.due_date !== today)) return false;
    return true;
  });
  const sorted = [...filtered].sort((a, b) => {
    if (sort === "recent") return b.created_at.localeCompare(a.created_at);
    if (sort === "priority") {
      const d = (PRIORITY_RANK[a.priority ?? ""] ?? 9) - (PRIORITY_RANK[b.priority ?? ""] ?? 9);
      if (d) return d;
    }
    return (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
  });
  const noDate = sorted.filter((t) => !t.due_date);

  const kpis: { label: string; value: number; tone: string; apply: () => void }[] = [
    { label: "Em aberto", value: open.length, tone: "text-slate-800", apply: () => go("todas", { situation: "open" }) },
    {
      label: "Atrasadas",
      value: open.filter((t) => t.due_date && t.due_date < today).length,
      tone: "text-red-600",
      apply: () => go("todas", { situation: "late" }),
    },
    {
      label: "Vencem hoje",
      value: open.filter((t) => t.due_date === today).length,
      tone: "text-amber-600",
      apply: () => go("todas", { situation: "today" }),
    },
    { label: "Sem prazo", value: open.filter((t) => !t.due_date).length, tone: "text-slate-500", apply: () => go("semprazo") },
    {
      label: "Sem responsável",
      value: open.filter((t) => t.assignees.length === 0).length,
      tone: "text-violet-700",
      apply: () => go("todas", { situation: "open", person: NOBODY }),
    },
  ];

  function go(next: Tab, f?: { situation?: Situation; person?: string }) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "todas") params.delete("tab");
    else params.set("tab", next);
    router.replace(`${pathname}?${params}`, { scroll: false });
    if (f?.situation) setSituation(f.situation);
    setPerson(f?.person ?? "");
    setSelected(new Set());
  }

  const ids = [...selected];
  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const listForSelectAll = tab === "semprazo" ? noDate : sorted;
  const allSelected = listForSelectAll.length > 0 && listForSelectAll.every((t) => selected.has(t.id));

  const rowProps = {
    members,
    statuses,
    workspaceId: workspace.id,
    selected,
    onSelect: toggleSel,
    onSelectMany: (list: string[], on: boolean) =>
      setSelected((prev) => {
        const n = new Set(prev);
        list.forEach((id) => (on ? n.add(id) : n.delete(id)));
        return n;
      }),
    onToggle: (id: string) => void toggleDone([id]),
    onUpdate: (id: string, patch: { due_date?: string | null; priority?: Priority | null; recurrence?: Recurrence | null }) => void update([id], patch),
    onStatus: (id: string, sid: string) => void setStatus(id, sid),
    onAssign: (id: string, uid: string, on: boolean) => void assign([id], uid, on),
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="space-y-4 border-b px-4 pt-5 sm:px-6">
        <div>
          <h1 className="text-xl font-bold">📊 Gestão</h1>
          <p className="text-sm text-slate-500">Todas as demandas de {workspace.name}, de todas as listas e pessoas.</p>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 sm:gap-3">
          {kpis.map((k) => (
            <button
              key={k.label}
              onClick={k.apply}
              className="rounded-xl border px-4 py-2.5 text-left transition hover:border-violet-300 hover:bg-violet-50/40"
            >
              <div className={`text-2xl font-bold tabular-nums ${k.tone}`}>{tasks ? k.value : "…"}</div>
              <div className="text-xs text-slate-500">{k.label}</div>
            </button>
          ))}
        </div>

        <nav className="-mb-px flex gap-1 overflow-x-auto text-sm">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => go(t.key)}
              className={`whitespace-nowrap border-b-2 px-3 pb-2.5 ${
                tab === t.key ? "border-violet-600 font-semibold text-violet-700" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {t.label}
              {t.key === "semprazo" && tasks && (
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{open.filter((x) => !x.due_date).length}</span>
              )}
            </button>
          ))}
        </nav>
      </header>

      {error && (
        <div className="flex justify-between bg-red-50 px-6 py-2 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-32 pt-4 sm:px-6">
        {tab !== "membros" && (
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar tarefa ou lista…"
              className="w-full rounded-md border px-3 py-1.5 outline-none focus:border-violet-500 sm:w-56"
              aria-label="Buscar"
            />
            <select value={space} onChange={(e) => setSpace(e.target.value)} className="rounded-md border px-2 py-1.5" aria-label="Space">
              <option value="">Todos os Spaces</option>
              {spaces.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <select value={person} onChange={(e) => setPerson(e.target.value)} className="rounded-md border px-2 py-1.5" aria-label="Responsável">
              <option value="">Todos os responsáveis</option>
              <option value={NOBODY}>Sem responsável</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {memberName(m)}
                </option>
              ))}
            </select>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="rounded-md border px-2 py-1.5" aria-label="Prioridade">
              <option value="">Qualquer prioridade</option>
              <option value="urgent">Urgente</option>
              <option value="high">Importante</option>
              <option value="none">Sem prioridade</option>
            </select>
            {tab === "todas" && (
              <>
                <select
                  value={situation}
                  onChange={(e) => setSituation(e.target.value as Situation)}
                  className="rounded-md border px-2 py-1.5"
                  aria-label="Situação"
                >
                  <option value="open">Em aberto</option>
                  <option value="late">Atrasadas</option>
                  <option value="today">Vencem hoje</option>
                  <option value="done">Concluídas</option>
                  <option value="all">Todas</option>
                </select>
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="rounded-md border px-2 py-1.5" aria-label="Ordenar">
                  <option value="due">Ordenar por prazo</option>
                  <option value="priority">Ordenar por prioridade</option>
                  <option value="recent">Mais recentes primeiro</option>
                </select>
              </>
            )}
            <span className="ml-auto text-xs text-slate-400">
              {tab === "semprazo" ? noDate.length : sorted.length} tarefas
            </span>
          </div>
        )}

        {tasks === null && <p className="text-sm text-slate-400">Carregando…</p>}

        {tasks && tab === "todas" && (
          <TaskTable
            tasks={sorted}
            allSelected={allSelected}
            onSelectAll={() => setSelected(allSelected ? new Set() : new Set(sorted.map((t) => t.id)))}
            empty="Nenhuma tarefa com esses filtros."
            {...rowProps}
          />
        )}

        {tasks && tab === "semprazo" && (
          <>
            <p className="mb-3 text-sm text-slate-500">
              Tarefas em aberto sem data. Defina o prazo em 1 clique, ou selecione várias e defina de uma vez.
            </p>
            <TaskTable
              tasks={noDate.filter((t) => !wsDone(t))}
              allSelected={allSelected}
              onSelectAll={() => setSelected(allSelected ? new Set() : new Set(noDate.map((t) => t.id)))}
              empty="Todas as tarefas em aberto têm prazo. 🎉"
              quickDue
              {...rowProps}
            />
          </>
        )}

        {tasks && tab === "membros" && (
          <MembersBoard
            tasks={open}
            all={all}
            members={members}
            today={today}
            week={week}
            openMember={openMember}
            setOpenMember={setOpenMember}
            rowProps={rowProps}
          />
        )}
      </div>

      {/* Ações em massa */}
      {selected.size > 0 && (
        <div
          className="fixed inset-x-0 z-40 flex justify-center px-4"
          style={{ bottom: "max(5rem, calc(env(safe-area-inset-bottom) + 4.5rem))" }}
        >
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm text-white shadow-2xl">
            <span className="font-semibold">
              {selected.size} {selected.size === 1 ? "selecionada" : "selecionadas"}
            </span>
            <span className="mx-1 h-5 w-px bg-slate-700" />
            <span className="rounded bg-white/10 [&_button]:text-white">
              <DuePicker value={null} onChange={(due_date) => void update(ids, { due_date })} />
            </span>
            <span className="rounded bg-white/10 px-1 [&_button]:text-white">
              <PriorityPicker value={null} onChange={(p) => void update(ids, { priority: p })} />
            </span>
            <span className="rounded bg-white/10">
              <AssigneePicker value={[]} members={members} onToggle={(uid) => void assign(ids, uid, true)} />
            </span>
            <button onClick={() => void toggleDone(ids).then(() => setSelected(new Set()))} className="rounded bg-emerald-600 px-3 py-1 font-medium hover:bg-emerald-500">
              ✓ Concluir
            </button>
            <button onClick={() => setSelected(new Set())} className="px-2 text-slate-400 hover:text-white">
              Limpar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface RowProps {
  members: Member[];
  statuses: Status[];
  workspaceId: string;
  selected: Set<string>;
  onSelect: (id: string) => void;
  onSelectMany: (ids: string[], on: boolean) => void;
  onToggle: (id: string) => void;
  onUpdate: (id: string, patch: { due_date?: string | null; priority?: Priority | null; recurrence?: Recurrence | null }) => void;
  onStatus: (id: string, statusId: string) => void;
  onAssign: (id: string, userId: string, on: boolean) => void;
}

const COLS = "grid-cols-[28px_minmax(220px,1fr)_180px_96px_130px_96px_104px] min-w-[880px]";
// Na aba "Sem prazo" a última coluna leva os botões Hoje / Amanhã / Seg
const COLS_QUICK = "grid-cols-[28px_minmax(220px,1fr)_180px_96px_130px_96px_230px] min-w-[1000px]";

function TaskTable({
  tasks,
  allSelected,
  onSelectAll,
  empty,
  quickDue = false,
  ...p
}: RowProps & { tasks: WsTask[]; allSelected: boolean; onSelectAll: () => void; empty: string; quickDue?: boolean }) {
  if (tasks.length === 0) return <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <div className={`grid ${quickDue ? COLS_QUICK : COLS} items-center gap-2 border-b px-2 pb-1.5 text-xs text-slate-400`}>
        <input type="checkbox" checked={allSelected} onChange={onSelectAll} aria-label="Selecionar todas" className="h-4 w-4 accent-violet-600" />
        <span className="pl-7">Tarefa</span>
        <span>Space / Lista</span>
        <span>Responsáveis</span>
        <span>Status</span>
        <span>Prioridade</span>
        <span>Prazo</span>
      </div>
      {tasks.map((t) => (
        <TaskRow key={t.id} t={t} quickDue={quickDue} {...p} />
      ))}
    </div>
  );
}

function TaskRow({
  t,
  quickDue,
  members,
  statuses,
  workspaceId,
  selected,
  onSelect,
  onToggle,
  onUpdate,
  onStatus,
  onAssign,
}: RowProps & { t: WsTask; quickDue?: boolean }) {
  const done = wsDone(t);
  const base = new Date();
  return (
    <div
      className={`grid ${quickDue ? COLS_QUICK : COLS} items-center gap-2 border-b px-2 py-1.5 text-sm hover:bg-slate-50 ${
        selected.has(t.id) ? "bg-violet-50/60" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={selected.has(t.id)}
        onChange={() => onSelect(t.id)}
        aria-label={`Selecionar ${t.title}`}
        className="h-4 w-4 accent-violet-600"
      />
      <div className="flex min-w-0 items-center gap-2">
        <CompleteToggle done={done} color={t.status?.color} onToggle={() => onToggle(t.id)} />
        <Link
          href={`/w/${workspaceId}/l/${t.list_id}?t=${t.parent_task_id ?? t.id}`}
          className={`truncate hover:text-violet-700 ${done ? "text-slate-400 line-through" : ""}`}
          title={t.title}
        >
          {t.parent_task_id && <span className="mr-1 text-xs text-slate-400">↳</span>}
          {t.title}
        </Link>
      </div>
      <span className="flex min-w-0 items-center gap-1.5 text-xs text-slate-500">
        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: t.list?.space?.color ?? "#94a3b8" }} />
        <span className="truncate">
          {t.list?.space?.name} / {t.list?.name}
        </span>
      </span>
      <AssigneePicker value={t.assignees} members={members} onToggle={(uid, on) => onAssign(t.id, uid, on)} />
      <div className="min-w-0 pr-2">
        <StatusPicker statuses={statuses.filter((s) => s.list_id === t.list_id).sort((a, b) => a.position - b.position)} value={t.status_id} onChange={(sid) => onStatus(t.id, sid)} />
      </div>
      <PriorityPicker value={t.priority} onChange={(priority) => onUpdate(t.id, { priority })} />
      {quickDue ? (
        <span className="flex items-center gap-1">
          {[
            ["Hoje", ymd(base)],
            ["Amanhã", ymd(addDays(base, 1))],
            ["Seg", ymd(nextWeekday(base, 1))],
          ].map(([label, date]) => (
            <button
              key={label}
              onClick={() => onUpdate(t.id, { due_date: date })}
              title={friendlyDate(date)}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-violet-100 hover:text-violet-700"
            >
              {label}
            </button>
          ))}
          <DuePicker value={null} onChange={(due_date) => onUpdate(t.id, { due_date })} />
        </span>
      ) : (
        <DuePicker
          value={t.due_date}
          done={done}
          onChange={(due_date) => onUpdate(t.id, { due_date })}
          recurrence={t.recurrence}
          onRecurrenceChange={(recurrence) => onUpdate(t.id, { recurrence })}
        />
      )}
    </div>
  );
}

function MembersBoard({
  tasks,
  all,
  members,
  today,
  week,
  openMember,
  setOpenMember,
  rowProps,
}: {
  tasks: WsTask[];
  all: WsTask[];
  members: Member[];
  today: string;
  week: string;
  openMember: string | null;
  setOpenMember: (id: string | null) => void;
  rowProps: RowProps;
}) {
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  const people = [
    ...members.map((m) => ({ id: m.user_id, member: m as Member | null, name: memberName(m) })),
    { id: NOBODY, member: null, name: "Sem responsável" },
  ]
    .map((p) => {
      const mine = tasks.filter((t) => (p.id === NOBODY ? t.assignees.length === 0 : t.assignees.includes(p.id)));
      const bands = Object.fromEntries(BANDS.map((b) => [b.key, 0])) as Record<Band, number>;
      for (const t of mine) bands[bandOf(t, today, week)]++;
      const doneWeek =
        p.id === NOBODY
          ? 0
          : all.filter((t) => wsDone(t) && t.assignees.includes(p.id) && t.updated_at >= weekAgo).length;
      return { ...p, mine, bands, doneWeek };
    })
    .filter((p) => p.id !== NOBODY || p.mine.length > 0)
    .sort((a, b) => b.mine.length - a.mine.length);

  const max = Math.max(1, ...people.map((p) => p.mine.length));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs text-slate-500">
        {BANDS.map((b) => (
          <span key={b.key} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: b.color }} />
            {b.label}
          </span>
        ))}
      </div>

      {people.map((p) => {
        const isOpen = openMember === p.id;
        return (
          <section key={p.id} className="rounded-xl border">
            <button
              onClick={() => setOpenMember(isOpen ? null : p.id)}
              className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
              aria-expanded={isOpen}
            >
              {p.member ? (
                <Avatar member={p.member} size={36} />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed border-slate-300 text-slate-400">?</span>
              )}
              <div className="w-36 min-w-0">
                <div className="truncate font-semibold">{p.name}</div>
                <div className="text-xs text-slate-500">
                  {p.mine.length} em aberto
                  {p.id !== NOBODY && <> · {p.doneWeek} feitas em 7 dias</>}
                </div>
              </div>

              {/* Barra de carga, proporcional à pessoa mais carregada */}
              <div className="min-w-[160px] flex-1">
                <div className="flex h-3.5 overflow-hidden rounded-full bg-slate-100" style={{ width: `${Math.max(4, (p.mine.length / max) * 100)}%` }}>
                  {BANDS.map((b) =>
                    p.bands[b.key] ? (
                      <span key={b.key} title={`${b.label}: ${p.bands[b.key]}`} style={{ flexGrow: p.bands[b.key], background: b.color }} />
                    ) : null,
                  )}
                </div>
              </div>

              <div className="flex gap-1.5 text-xs">
                {p.bands.late > 0 && <span className="rounded-full bg-red-50 px-2 py-0.5 font-semibold text-red-600">{p.bands.late} atrasadas</span>}
                {p.bands.today > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">{p.bands.today} hoje</span>}
                {p.bands.nodate > 0 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{p.bands.nodate} sem prazo</span>}
              </div>
              <span className="text-slate-400">{isOpen ? "▾" : "▸"}</span>
            </button>

            {isOpen && (
              <div className="border-t px-2 pb-2 pt-1">
                {p.mine.length === 0 ? (
                  <p className="px-2 py-4 text-sm text-slate-500">Nada em aberto. 🎉</p>
                ) : (
                  <TaskTable
                    tasks={[...p.mine].sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))}
                    allSelected={p.mine.every((t) => rowProps.selected.has(t.id))}
                    onSelectAll={() =>
                      rowProps.onSelectMany(
                        p.mine.map((t) => t.id),
                        !p.mine.every((t) => rowProps.selected.has(t.id)),
                      )
                    }
                    empty=""
                    {...rowProps}
                  />
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
