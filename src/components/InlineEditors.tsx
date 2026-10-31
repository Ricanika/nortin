"use client";

import { friendlyDate, shortcutDates, todayISO } from "@/lib/dates";
import { PRIORITIES, type Priority, type Status } from "@/lib/types";
import Popover from "./Popover";

const itemClass = "flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50";

/** Círculo de concluir: 1 clique. */
export function CompleteToggle({
  done,
  color,
  onToggle,
  size = 18,
}: {
  done: boolean;
  color?: string;
  onToggle: () => void;
  size?: number;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? "Reabrir tarefa" : "Concluir tarefa"}
      title={done ? "Reabrir" : "Concluir"}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ width: size, height: size, borderColor: done ? "#22c55e" : color ?? "#cbd5e1" }}
      className={`group/check flex shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
        done ? "bg-emerald-500" : "bg-white hover:bg-emerald-50"
      }`}
    >
      <svg
        viewBox="0 0 12 12"
        className={`h-2.5 w-2.5 ${done ? "text-white" : "text-emerald-500 opacity-0 group-hover/check:opacity-100"}`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M2.5 6.5l2.2 2.2L9.5 3.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** Prazo com atalhos: Hoje, Amanhã, Próx. segunda, Em 1 semana. */
export function DuePicker({
  value,
  onChange,
  done = false,
}: {
  value: string | null;
  onChange: (date: string | null) => void;
  done?: boolean;
}) {
  const late = !!value && !done && value < todayISO();
  const isToday = value === todayISO();
  return (
    <Popover
      label="Prazo"
      width={220}
      triggerClassName={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs hover:bg-slate-100 ${
        late ? "font-medium text-red-600" : isToday ? "font-medium text-amber-600" : value ? "text-slate-600" : "text-slate-300"
      }`}
      trigger={value ? friendlyDate(value) : "📅 Prazo"}
    >
      {(close) => (
        <>
          {shortcutDates().map((s) => (
            <button
              key={s.label}
              className={`${itemClass} justify-between`}
              onClick={() => {
                onChange(s.date);
                close();
              }}
            >
              {s.label}
              <span className="text-xs tabular-nums text-slate-400">
                {s.date.slice(8)}/{s.date.slice(5, 7)}
              </span>
            </button>
          ))}
          <div className="border-t px-3 py-2">
            <input
              type="date"
              defaultValue={value ?? ""}
              onChange={(e) => {
                if (e.target.value) {
                  onChange(e.target.value);
                  close();
                }
              }}
              className="w-full rounded border px-2 py-1 text-sm"
              aria-label="Escolher data"
            />
          </div>
          {value && (
            <button
              className={`${itemClass} text-slate-500`}
              onClick={() => {
                onChange(null);
                close();
              }}
            >
              Tirar prazo
            </button>
          )}
        </>
      )}
    </Popover>
  );
}

export function PriorityPicker({ value, onChange }: { value: Priority | null; onChange: (p: Priority | null) => void }) {
  const current = PRIORITIES.find((p) => p.value === value);
  return (
    <Popover
      label="Prioridade"
      width={180}
      triggerClassName="whitespace-nowrap rounded px-1.5 py-0.5 text-xs hover:bg-slate-100"
      trigger={
        current ? <span style={{ color: current.color }}>⚑ {current.label}</span> : <span className="text-slate-300">⚑</span>
      }
    >
      {(close) => (
        <>
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              className={itemClass}
              onClick={() => {
                onChange(p.value);
                close();
              }}
            >
              <span style={{ color: p.color }}>⚑</span>
              <span className="flex-1">{p.label}</span>
              {p.value === value && <span className="text-violet-600">✓</span>}
            </button>
          ))}
          {value && (
            <button
              className={`${itemClass} border-t text-slate-500`}
              onClick={() => {
                onChange(null);
                close();
              }}
            >
              Sem prioridade
            </button>
          )}
        </>
      )}
    </Popover>
  );
}

export function StatusPicker({
  statuses,
  value,
  onChange,
}: {
  statuses: Status[];
  value: string | null;
  onChange: (statusId: string) => void;
}) {
  const current = statuses.find((s) => s.id === value);
  return (
    <Popover
      label="Status"
      width={200}
      triggerClassName="max-w-full"
      trigger={
        <span
          className="block truncate rounded px-2 py-0.5 text-[11px] font-semibold uppercase text-white"
          style={{ background: current?.color ?? "#94a3b8" }}
        >
          {current?.name ?? "—"}
        </span>
      }
    >
      {(close) =>
        statuses.map((s) => (
          <button
            key={s.id}
            className={itemClass}
            onClick={() => {
              onChange(s.id);
              close();
            }}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
            <span className="flex-1">{s.name}</span>
            {s.id === value && <span className="text-violet-600">✓</span>}
          </button>
        ))
      }
    </Popover>
  );
}
