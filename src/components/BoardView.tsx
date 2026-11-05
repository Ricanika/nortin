"use client";

import { useEffect, useMemo, useState } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { positionBetween, type Status, type Task } from "@/lib/types";
import type { TaskActions } from "./ListScreen";
import { parseQuick } from "@/lib/quickParse";
import { AvatarStack, DueDate, NewTaskInput, PriorityFlag } from "./TaskBits";
import { CompleteToggle, DuePicker } from "./InlineEditors";
import { useWorkspace } from "./WorkspaceContext";

type Columns = Record<string, string[]>; // statusId -> taskIds em ordem

function buildColumns(statuses: Status[], tasks: Task[]): Columns {
  const cols: Columns = Object.fromEntries(statuses.map((s) => [s.id, []]));
  for (const t of tasks) if (t.status_id && cols[t.status_id]) cols[t.status_id].push(t.id);
  return cols;
}

export default function BoardView({
  statuses,
  tasks,
  actions,
  onAddStatus,
  onRemoveStatus,
}: {
  statuses: Status[];
  tasks: Task[];
  actions: TaskActions;
  onAddStatus: (name: string) => Promise<void>;
  onRemoveStatus: (id: string) => Promise<void>;
}) {
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const [columns, setColumns] = useState<Columns>(() => buildColumns(statuses, tasks));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState("");

  // Fora de um arraste, as colunas espelham os dados (inclui mudanças via realtime).
  useEffect(() => {
    if (!activeId) setColumns(buildColumns(statuses, tasks));
  }, [statuses, tasks, activeId]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const findColumn = (id: string) =>
    id in columns ? id : Object.keys(columns).find((k) => columns[k].includes(id));

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  // Ao passar para outra coluna, move o card no estado local para dar o preview.
  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const from = findColumn(String(active.id));
    const to = findColumn(String(over.id));
    if (!from || !to || from === to) return;
    setColumns((cols) => {
      const fromItems = cols[from].filter((id) => id !== active.id);
      const toItems = [...cols[to]];
      const overIndex = toItems.indexOf(String(over.id));
      toItems.splice(overIndex >= 0 ? overIndex : toItems.length, 0, String(active.id));
      return { ...cols, [from]: fromItems, [to]: toItems };
    });
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const id = String(active.id);
    const column = findColumn(id);
    if (!over || !column) {
      setActiveId(null);
      return;
    }

    let items = columns[column];
    const oldIndex = items.indexOf(id);
    const overIndex = items.indexOf(String(over.id));
    if (overIndex >= 0 && overIndex !== oldIndex) items = arrayMove(items, oldIndex, overIndex);
    setColumns({ ...columns, [column]: items });

    const index = items.indexOf(id);
    const prev = taskById.get(items[index - 1])?.position;
    const next = taskById.get(items[index + 1])?.position;
    const task = taskById.get(id);
    if (task && (task.status_id !== column || index !== oldIndex)) {
      actions.update(id, { status_id: column, position: positionBetween(prev, next) });
    }
    setActiveId(null);
  }

  const activeTask = activeId ? taskById.get(activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex h-full items-start gap-3 p-6">
        {statuses.map((status) => (
          <Column
            key={status.id}
            status={status}
            taskIds={columns[status.id] ?? []}
            taskById={taskById}
            actions={actions}
            onRemove={() => onRemoveStatus(status.id)}
          />
        ))}

        <form
          className="w-64 shrink-0"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newStatus.trim()) return;
            await onAddStatus(newStatus.trim());
            setNewStatus("");
          }}
        >
          <input
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value)}
            placeholder="+ Novo status"
            className="w-full rounded-md border border-dashed bg-transparent px-3 py-2 text-sm outline-none focus:border-violet-500"
          />
        </form>
      </div>

      <DragOverlay>
        {activeTask ? <Card task={activeTask} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  taskIds,
  taskById,
  actions,
  onRemove,
}: {
  status: Status;
  taskIds: string[];
  taskById: Map<string, Task>;
  actions: TaskActions;
  onRemove: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status.id });
  const { members } = useWorkspace();
  const done = status.type === "done" || status.type === "closed";

  return (
    <div className="flex max-h-full w-72 shrink-0 flex-col rounded-lg bg-slate-100">
      <div className="group flex items-center gap-2 border-t-4 px-3 py-2 text-sm" style={{ borderColor: status.color }}>
        <span className="font-semibold uppercase">{status.name}</span>
        <span className="text-slate-400">{taskIds.length}</span>
        {taskIds.length === 0 && (
          <button
            title="Excluir status"
            onClick={onRemove}
            className="invisible ml-auto text-xs text-slate-400 hover:text-red-600 group-hover:visible"
          >
            ✕
          </button>
        )}
      </div>

      <SortableContext id={status.id} items={taskIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={`min-h-[60px] flex-1 space-y-2 overflow-y-auto px-2 pb-2 ${isOver ? "bg-violet-50" : ""}`}
        >
          {taskIds.map((id) => {
            const task = taskById.get(id);
            return task ? <SortableCard key={id} task={task} done={done} actions={actions} /> : null;
          })}
        </div>
      </SortableContext>

      <NewTaskInput
        className="block w-full px-3 pb-3"
        onCreate={async (text) => {
          const p = parseQuick(text, members);
          if (p.title)
            await actions.create(p.title, status.id, { due_date: p.due, priority: p.priority, recurrence: p.recurrence }, p.assignees);
        }}
      />
    </div>
  );
}

function SortableCard({ task, done, actions }: { task: Task; done: boolean; actions: TaskActions }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "opacity-30" : ""}
      onClick={() => actions.open(task.id)}
      {...attributes}
      {...listeners}
    >
      <Card task={task} done={done} actions={actions} />
    </div>
  );
}

/** Sem `actions` (no arraste), o cartão é só visual. */
function Card({
  task,
  done = false,
  actions,
  dragging = false,
}: {
  task: Task;
  done?: boolean;
  actions?: TaskActions;
  dragging?: boolean;
}) {
  const { members } = useWorkspace();
  return (
    <div
      className={`cursor-pointer rounded-md border bg-white p-3 text-sm shadow-sm hover:border-violet-300 ${
        dragging ? "rotate-2 shadow-lg" : ""
      }`}
    >
      <div className="mb-2 flex items-start gap-2">
        {actions && (
          <span className="pt-px">
            <CompleteToggle done={done} onToggle={() => actions.toggleDone(task.id)} size={16} />
          </span>
        )}
        <p className={`min-w-0 flex-1 break-words ${done ? "text-slate-400 line-through" : ""}`}>{task.title}</p>
      </div>
      <div className="flex items-center justify-between gap-2">
        <PriorityFlag priority={task.priority} />
        <span className="flex items-center gap-2">
          {actions ? (
            <DuePicker
              value={task.due_date}
              done={done}
              onChange={(due_date) => actions.update(task.id, { due_date })}
              recurrence={task.recurrence}
              onRecurrenceChange={(recurrence) => actions.update(task.id, { recurrence })}
            />
          ) : (
            <DueDate date={task.due_date} />
          )}
          {task.assignees.length > 0 && <AvatarStack ids={task.assignees} members={members} />}
        </span>
      </div>
    </div>
  );
}
