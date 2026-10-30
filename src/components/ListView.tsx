"use client";

import { useState } from "react";
import type { Status, Task } from "@/lib/types";
import type { TaskActions } from "./ListScreen";
import { DueDate, NewTaskInput, PriorityFlag } from "./TaskBits";

export default function ListView({
  statuses,
  tasks,
  actions,
}: {
  statuses: Status[];
  tasks: Task[];
  actions: TaskActions;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-6 p-6">
      {statuses.map((status) => {
        const group = tasks.filter((t) => t.status_id === status.id);
        return (
          <section key={status.id}>
            <button
              onClick={() => setCollapsed({ ...collapsed, [status.id]: !collapsed[status.id] })}
              className="mb-2 flex items-center gap-2 text-sm"
            >
              <span className="w-3 text-slate-400">{collapsed[status.id] ? "▸" : "▾"}</span>
              <span
                className="rounded px-2 py-0.5 text-xs font-semibold uppercase text-white"
                style={{ background: status.color }}
              >
                {status.name}
              </span>
              <span className="text-slate-400">{group.length}</span>
            </button>

            {!collapsed[status.id] && (
              <div className="ml-5">
                <div className="grid grid-cols-[1fr_160px_110px_90px_32px] border-b px-2 pb-1 text-xs text-slate-400">
                  <span>Nome</span>
                  <span>Status</span>
                  <span>Prioridade</span>
                  <span>Prazo</span>
                  <span />
                </div>
                {group.map((task) => (
                  <div
                    key={task.id}
                    className="group grid grid-cols-[1fr_160px_110px_90px_32px] items-center border-b px-2 py-1.5 text-sm hover:bg-slate-50"
                  >
                    <button
                      onClick={() => actions.open(task.id)}
                      className="flex items-center gap-2 truncate text-left hover:text-violet-700"
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: status.color }}
                      />
                      <span className={`truncate ${status.type === "done" ? "text-slate-400 line-through" : ""}`}>
                        {task.title}
                      </span>
                    </button>
                    <select
                      value={task.status_id ?? ""}
                      onChange={(e) => actions.update(task.id, { status_id: e.target.value })}
                      className="w-36 rounded bg-transparent text-xs outline-none hover:bg-slate-100"
                    >
                      {statuses.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <PriorityFlag priority={task.priority} />
                    <DueDate date={task.due_date} />
                    <button
                      title="Excluir"
                      onClick={() => actions.remove(task.id)}
                      className="invisible text-slate-400 hover:text-red-600 group-hover:visible"
                    >
                      🗑
                    </button>
                  </div>
                ))}
                <NewTaskInput
                  className="block w-full px-2 py-1.5"
                  onCreate={(title) => actions.create(title, status.id)}
                />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
