"use client";

import Link from "next/link";
import { rowDone, type AssignedRow } from "@/lib/useAssignedTasks";
import type { Priority } from "@/lib/types";
import { CompleteToggle, DuePicker, PriorityPicker } from "./InlineEditors";

/** Linha de tarefa para as visões de pessoa (Meu dia, Minhas tarefas): concluir, prazo e prioridade sem abrir nada. */
export default function AssignedTaskRow({
  row,
  href,
  onToggle,
  onUpdate,
}: {
  row: AssignedRow;
  href: string;
  onToggle: () => void;
  onUpdate: (patch: { due_date?: string | null; priority?: Priority | null }) => void;
}) {
  const done = rowDone(row);
  return (
    <div className="group flex items-center gap-3 border-b px-2 py-2 text-sm hover:bg-slate-50">
      <CompleteToggle done={done} color={row.statuses?.color} onToggle={onToggle} size={20} />
      <Link href={href} className="min-w-0 flex-1">
        <span className={`block truncate ${done ? "text-slate-400 line-through" : "text-slate-800"}`}>
          {row.parent_task_id && <span className="mr-1 text-xs text-slate-400">↳</span>}
          {row.title}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-400">
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: row.lists?.spaces?.color ?? "#94a3b8" }} />
          <span className="truncate">
            {row.lists?.spaces?.name} / {row.lists?.name}
          </span>
          <span
            className="ml-1 hidden shrink-0 rounded px-1.5 text-[10px] font-semibold uppercase text-white sm:inline"
            style={{ background: row.statuses?.color ?? "#94a3b8" }}
          >
            {row.statuses?.name}
          </span>
        </span>
      </Link>
      <PriorityPicker value={row.priority} onChange={(priority) => onUpdate({ priority })} />
      <DuePicker value={row.due_date} done={done} onChange={(due_date) => onUpdate({ due_date })} />
    </div>
  );
}
