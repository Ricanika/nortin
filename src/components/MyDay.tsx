"use client";

import { useState } from "react";
import { addDays, todayISO, ymd } from "@/lib/dates";
import { memberName } from "@/lib/types";
import { rowDone, useAssignedTasks, type AssignedRow } from "@/lib/useAssignedTasks";
import AssignedTaskRow from "./AssignedTaskRow";
import { useQuickAdd } from "./QuickAdd";
import { useWorkspace } from "./WorkspaceContext";

type SectionKey = "late" | "today" | "week" | "later" | "nodate";

const SECTIONS: { key: SectionKey; title: string; tone: string; tile: string }[] = [
  { key: "late", title: "Atrasadas", tone: "text-red-600", tile: "bg-red-50 text-red-700 ring-red-200" },
  { key: "today", title: "Hoje", tone: "text-amber-600", tile: "bg-amber-50 text-amber-700 ring-amber-200" },
  { key: "week", title: "Próximos 7 dias", tone: "text-violet-700", tile: "bg-violet-50 text-violet-700 ring-violet-200" },
  { key: "later", title: "Mais adiante", tone: "text-slate-700", tile: "" },
  { key: "nodate", title: "Sem prazo", tone: "text-slate-500", tile: "" },
];

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

export default function MyDay() {
  const { workspace, members, me } = useWorkspace();
  const openQuickAdd = useQuickAdd();
  const { rows, error, update, toggleDone } = useAssignedTasks(workspace.id, me);
  const [showLater, setShowLater] = useState(false);
  // Concluídas nesta sessão continuam visíveis (riscadas) até recarregar, para dar a sensação de progresso.
  const [doneHere, setDoneHere] = useState<Set<string>>(new Set());

  const today = todayISO();
  const week = ymd(addDays(new Date(), 7));
  const meMember = members.find((m) => m.user_id === me);
  const firstName = memberName(meMember).split(" ")[0];

  const all = rows ?? [];
  const visible = all.filter((r) => !rowDone(r) || doneHere.has(r.id));
  const bucket = (r: AssignedRow): SectionKey =>
    !r.due_date ? "nodate" : r.due_date < today ? "late" : r.due_date === today ? "today" : r.due_date <= week ? "week" : "later";
  const groups = Object.fromEntries(SECTIONS.map((s) => [s.key, [] as AssignedRow[]])) as Record<SectionKey, AssignedRow[]>;
  for (const r of [...visible].sort((a, b) => (a.due_date ?? "9999") < (b.due_date ?? "9999") ? -1 : 1)) groups[bucket(r)].push(r);

  const openCount = (k: SectionKey) => groups[k].filter((r) => !rowDone(r)).length;
  const todayTotal = all.filter((r) => r.due_date === today).length;
  const todayDone = all.filter((r) => r.due_date === today && rowDone(r)).length;
  const pct = todayTotal ? Math.round((todayDone / todayTotal) * 100) : 0;
  const nothingPending = rows && SECTIONS.every((s) => openCount(s.key) === 0);

  const longDate = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const dateLabel = longDate[0].toUpperCase() + longDate.slice(1);

  const toggle = (r: AssignedRow) => {
    setDoneHere((prev) => new Set(prev).add(r.id));
    void toggleDone(r);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 px-4 pb-28 pt-6 sm:px-8">
        <header className="space-y-1">
          <p className="text-sm text-slate-500">{dateLabel}</p>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
            {greeting()}, {firstName} 👋
          </h1>
        </header>

        {/* Caixa de criação: 1 clique para digitar ou falar */}
        <div className="flex items-center gap-2 rounded-xl border bg-white p-2 shadow-sm focus-within:border-violet-400">
          <button
            onClick={() => openQuickAdd()}
            className="min-w-0 flex-1 truncate px-3 py-2 text-left text-slate-400"
          >
            O que precisa ser feito? Ex.: <i>Ligar pro Assaí @bia amanhã</i>
          </button>
          <button
            onClick={() => openQuickAdd({ voice: true })}
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-sm font-semibold text-white hover:bg-violet-700"
          >
            🎤 <span className="hidden sm:inline">Falar</span>
          </button>
        </div>

        {/* Resumo grande e clicável */}
        <div className="grid grid-cols-3 gap-3">
          {SECTIONS.slice(0, 3).map((s) => (
            <a
              key={s.key}
              href={`#sec-${s.key}`}
              className={`rounded-xl px-4 py-3 ring-1 transition hover:scale-[1.02] ${s.tile}`}
            >
              <div className="text-3xl font-bold tabular-nums">{rows ? openCount(s.key) : "…"}</div>
              <div className="text-xs font-medium sm:text-sm">{s.title}</div>
            </a>
          ))}
        </div>

        {todayTotal > 0 && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-500">
              <span>Progresso de hoje</span>
              <span className="tabular-nums">
                {todayDone} de {todayTotal}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {nothingPending && (
          <div className="rounded-xl border border-dashed px-6 py-10 text-center">
            <div className="text-4xl">🎉</div>
            <p className="mt-2 font-semibold text-slate-700">Tudo em dia!</p>
            <p className="text-sm text-slate-500">Nada marcado para você está pendente.</p>
          </div>
        )}

        {SECTIONS.map((s) => {
          const list = groups[s.key];
          if (list.length === 0) return null;
          const collapsible = s.key === "later" || s.key === "nodate";
          const open = !collapsible || showLater;
          return (
            <section key={s.key} id={`sec-${s.key}`} className="scroll-mt-4">
              <button
                disabled={!collapsible}
                onClick={() => setShowLater(!showLater)}
                className={`mb-1 flex items-center gap-2 text-sm font-semibold ${s.tone}`}
              >
                {collapsible && <span className="w-3 text-slate-400">{open ? "▾" : "▸"}</span>}
                {s.title}
                <span className="font-normal text-slate-400">{list.length}</span>
              </button>
              {open &&
                list.map((r) => (
                  <AssignedTaskRow
                    key={r.id}
                    row={r}
                    href={`/w/${workspace.id}/l/${r.list_id}?t=${r.parent_task_id ?? r.id}`}
                    onToggle={() => toggle(r)}
                    onUpdate={(patch) => void update(r.id, patch)}
                  />
                ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
