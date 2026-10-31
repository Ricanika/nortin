"use client";

import { useState } from "react";
import Popover from "./Popover";
import { memberName, PRIORITIES, type Member, type Priority } from "@/lib/types";

const AVATAR_COLORS = ["#7c3aed", "#2563eb", "#059669", "#d97706", "#db2777", "#0891b2", "#4f46e5", "#65a30d"];

function colorFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function Avatar({ member, size = 22 }: { member: Member; size?: number }) {
  const name = memberName(member);
  const initials = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <span
      title={name}
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-white"
      style={{ width: size, height: size, fontSize: size * 0.42, background: colorFor(member.user_id) }}
    >
      {initials}
    </span>
  );
}

export function AvatarStack({ ids, members, max = 3 }: { ids: string[]; members: Member[]; max?: number }) {
  const list = ids.map((id) => members.find((m) => m.user_id === id)).filter((m): m is Member => !!m);
  if (list.length === 0) return <span className="text-slate-300">—</span>;
  return (
    <span className="flex -space-x-1.5">
      {list.slice(0, max).map((m) => (
        <Avatar key={m.user_id} member={m} />
      ))}
      {list.length > max && (
        <span className="inline-flex h-[22px] items-center rounded-full bg-slate-200 px-1.5 text-[10px] font-semibold text-slate-600 ring-2 ring-white">
          +{list.length - max}
        </span>
      )}
    </span>
  );
}

/** Avatares clicáveis que abrem uma lista de membros para marcar/desmarcar. */
export function AssigneePicker({
  value,
  members,
  onToggle,
}: {
  value: string[];
  members: Member[];
  onToggle: (userId: string, assigned: boolean) => void;
}) {
  return (
    <Popover
      label="Responsáveis"
      width={240}
      triggerClassName="flex min-h-[26px] items-center gap-1 rounded px-1 hover:bg-slate-100"
      trigger={
        value.length ? (
          <AvatarStack ids={value} members={members} />
        ) : (
          <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border border-dashed border-slate-300 text-xs text-slate-400">
            +
          </span>
        )
      }
    >
      {() => (
        <>
          {members.map((m) => {
            const on = value.includes(m.user_id);
            return (
              <button
                key={m.user_id}
                type="button"
                onClick={() => onToggle(m.user_id, !on)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50"
              >
                <Avatar member={m} />
                <span className="flex-1 truncate">{memberName(m)}</span>
                {on && <span className="text-violet-600">✓</span>}
              </button>
            );
          })}
          {members.length <= 1 && (
            <p className="px-3 py-2 text-xs text-slate-400">Adicione pessoas em Membros para poder marcá-las.</p>
          )}
        </>
      )}
    </Popover>
  );
}

export function PriorityFlag({ priority }: { priority: Priority | null }) {
  const p = PRIORITIES.find((x) => x.value === priority);
  if (!p) return <span className="text-slate-300">⚑</span>;
  return (
    <span title={p.label} className="whitespace-nowrap text-xs" style={{ color: p.color }}>
      ⚑ {p.label}
    </span>
  );
}

export function DueDate({ date }: { date: string | null }) {
  if (!date) return <span className="text-slate-300">—</span>;
  const today = new Date().toISOString().slice(0, 10);
  const [y, m, d] = date.split("-");
  return (
    <span className={`whitespace-nowrap text-xs ${date < today ? "text-red-600" : "text-slate-600"}`}>
      {d}/{m}/{y.slice(2)}
    </span>
  );
}

export function NewTaskInput({
  onCreate,
  className = "",
}: {
  onCreate: (title: string) => Promise<void>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`text-left text-sm text-slate-400 hover:text-violet-600 ${className}`}
      >
        + Nova tarefa
      </button>
    );
  }

  return (
    <form
      className={className}
      onSubmit={async (e) => {
        e.preventDefault();
        const t = title.trim();
        if (!t) return;
        setTitle("");
        await onCreate(t);
      }}
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setTitle("");
            setOpen(false);
          }
        }}
        placeholder="Ex.: Ligar pro Assaí @bia amanhã — Enter cria"
        className="w-full rounded border border-violet-400 px-2 py-1 text-sm outline-none"
      />
    </form>
  );
}
