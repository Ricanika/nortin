"use client";

import { useState } from "react";
import type { Member, Priority } from "@/lib/types";
import { AvatarStack } from "./TaskBits";

export interface CalendarItem {
  id: string;
  title: string;
  due_date: string | null;
  color: string;
  done: boolean;
  priority: Priority | null;
  assignees: string[];
  /** linha extra, ex.: "Comercial / Key accounts" */
  subtitle?: string;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MAX_PER_DAY = 3;

/** AAAA-MM-DD no fuso local */
function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay());
  const lastOfMonth = new Date(year, month + 1, 0);
  const weeks = Math.ceil((first.getDay() + lastOfMonth.getDate()) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

export default function CalendarView({
  items,
  members,
  onOpen,
  onMove,
  onCreate,
}: {
  items: CalendarItem[];
  members: Member[];
  onOpen: (id: string) => void;
  /** Arrastar muda o prazo; date null = sem prazo */
  onMove?: (id: string, date: string | null) => void;
  onCreate?: (date: string, title: string) => Promise<void>;
}) {
  const now = new Date();
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creatingOn, setCreatingOn] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const today = ymd(now);
  const days = monthGrid(cursor.y, cursor.m);
  const byDay = new Map<string, CalendarItem[]>();
  for (const it of items) if (it.due_date) byDay.set(it.due_date, [...(byDay.get(it.due_date) ?? []), it]);
  const unscheduled = items.filter((it) => !it.due_date && !it.done);

  const monthLabel = new Date(cursor.y, cursor.m, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const shift = (delta: number) => {
    const d = new Date(cursor.y, cursor.m + delta, 1);
    setCursor({ y: d.getFullYear(), m: d.getMonth() });
    setExpanded(null);
  };

  const dropProps = (date: string | null) =>
    onMove
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (!dragId) return;
            e.preventDefault();
            setOverDay(date ?? "none");
          },
          onDragLeave: () => setOverDay((d) => (d === (date ?? "none") ? null : d)),
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const item = items.find((i) => i.id === dragId);
            if (item && item.due_date !== date) onMove(item.id, date);
            setDragId(null);
            setOverDay(null);
          },
        }
      : {};

  const chip = (it: CalendarItem) => (
    <button
      key={it.id}
      draggable={!!onMove}
      onDragStart={(e) => {
        setDragId(it.id);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", it.id);
      }}
      onDragEnd={() => {
        setDragId(null);
        setOverDay(null);
      }}
      onClick={() => onOpen(it.id)}
      title={it.subtitle ? `${it.title}\n${it.subtitle}` : it.title}
      className={`flex w-full items-center gap-1.5 rounded border-l-[3px] bg-white px-1.5 py-1 text-left text-xs shadow-sm hover:bg-violet-50 ${
        dragId === it.id ? "opacity-40" : ""
      } ${onMove ? "cursor-grab" : ""}`}
      style={{ borderLeftColor: it.color }}
    >
      <span className={`min-w-0 flex-1 truncate ${it.done ? "text-slate-400 line-through" : ""}`}>{it.title}</span>
      {it.assignees.length > 0 && <AvatarStack ids={it.assignees} members={members} max={2} />}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => shift(-1)} className="rounded-md border px-2.5 py-1 text-sm hover:bg-slate-50" aria-label="Mês anterior">
          ‹
        </button>
        <button onClick={() => shift(1)} className="rounded-md border px-2.5 py-1 text-sm hover:bg-slate-50" aria-label="Próximo mês">
          ›
        </button>
        <button
          onClick={() => setCursor({ y: now.getFullYear(), m: now.getMonth() })}
          className="rounded-md border px-3 py-1 text-sm hover:bg-slate-50"
        >
          Hoje
        </button>
        <h2 className="ml-2 text-lg font-semibold capitalize">{monthLabel}</h2>
      </div>

      {onMove && (
        <div
          {...dropProps(null)}
          className={`flex min-h-[44px] flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs ${
            overDay === "none" ? "border-violet-400 bg-violet-50" : ""
          }`}
        >
          <span className="font-medium text-slate-500">Sem prazo ({unscheduled.length})</span>
          {unscheduled.length === 0 && (
            <span className="text-slate-400">Arraste uma tarefa para cá para tirar o prazo.</span>
          )}
          {unscheduled.map((it) => (
            <span key={it.id} className="w-48">
              {chip(it)}
            </span>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-x-auto">
        <div className="grid min-w-[700px] grid-cols-7 border-l border-t">
          {WEEKDAYS.map((w) => (
            <div key={w} className="border-b border-r bg-slate-50 px-2 py-1 text-xs font-medium uppercase tracking-wide text-slate-500">
              {w}
            </div>
          ))}
          {days.map((day) => {
            const key = ymd(day);
            const inMonth = day.getMonth() === cursor.m;
            const list = byDay.get(key) ?? [];
            const open = expanded === key;
            const shown = open ? list : list.slice(0, MAX_PER_DAY);
            const late = key < today && list.some((i) => !i.done);
            return (
              <div
                key={key}
                {...dropProps(key)}
                className={`group flex min-h-[112px] flex-col gap-1 border-b border-r p-1.5 ${
                  inMonth ? "bg-white" : "bg-slate-50/70"
                } ${overDay === key ? "bg-violet-50 ring-2 ring-inset ring-violet-400" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums ${
                      key === today
                        ? "bg-violet-600 font-semibold text-white"
                        : late
                          ? "font-semibold text-red-600"
                          : inMonth
                            ? "text-slate-700"
                            : "text-slate-400"
                    }`}
                  >
                    {day.getDate()}
                  </span>
                  {onCreate && (
                    <button
                      onClick={() => {
                        setCreatingOn(key);
                        setDraft("");
                      }}
                      className="invisible rounded px-1 text-sm text-slate-400 hover:bg-slate-100 hover:text-violet-600 group-hover:visible"
                      title="Nova tarefa neste dia"
                    >
                      +
                    </button>
                  )}
                </div>

                {shown.map(chip)}

                {list.length > MAX_PER_DAY && (
                  <button
                    onClick={() => setExpanded(open ? null : key)}
                    className="text-left text-[11px] font-medium text-violet-600 hover:underline"
                  >
                    {open ? "mostrar menos" : `+${list.length - MAX_PER_DAY} mais`}
                  </button>
                )}

                {creatingOn === key && onCreate && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const t = draft.trim();
                      if (!t) return;
                      setDraft("");
                      setCreatingOn(null);
                      await onCreate(key, t);
                    }}
                  >
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => !draft.trim() && setCreatingOn(null)}
                      onKeyDown={(e) => e.key === "Escape" && setCreatingOn(null)}
                      placeholder="Nova tarefa"
                      className="w-full rounded border border-violet-400 px-1.5 py-1 text-xs outline-none"
                    />
                  </form>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

