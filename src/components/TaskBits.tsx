"use client";

import { useState } from "react";
import { PRIORITIES, type Priority } from "@/lib/types";

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
        placeholder="Nome da tarefa e Enter"
        className="w-full rounded border border-violet-400 px-2 py-1 text-sm outline-none"
      />
    </form>
  );
}
