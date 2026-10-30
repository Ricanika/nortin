"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PRIORITIES, type Comment, type Priority, type Status, type Task } from "@/lib/types";
import type { TaskActions } from "./ListScreen";

export default function TaskDrawer({
  task,
  statuses,
  actions,
  onClose,
}: {
  task: Task;
  statuses: Status[];
  actions: TaskActions;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [subtasks, setSubtasks] = useState<Task[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState("");

  const doneStatus = statuses.find((s) => s.type === "done" || s.type === "closed");
  const firstStatus = statuses[0];

  useEffect(() => {
    supabase
      .from("tasks")
      .select("*")
      .eq("parent_task_id", task.id)
      .order("position")
      .then(({ data }) => setSubtasks((data as Task[]) ?? []));
    supabase
      .from("comments")
      .select("*, profiles(email, full_name)")
      .eq("task_id", task.id)
      .order("created_at")
      .then(({ data }) => setComments((data as Comment[]) ?? []));
  }, [task.id, supabase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function addSubtask(e: React.FormEvent) {
    e.preventDefault();
    const t = newSubtask.trim();
    if (!t) return;
    setNewSubtask("");
    const { data } = await supabase
      .from("tasks")
      .insert({
        list_id: task.list_id,
        parent_task_id: task.id,
        title: t,
        status_id: firstStatus?.id,
        position: (subtasks.at(-1)?.position ?? 0) + 1000,
      })
      .select()
      .single();
    if (data) setSubtasks([...subtasks, data as Task]);
  }

  async function toggleSubtask(sub: Task) {
    const isDone = sub.status_id === doneStatus?.id;
    const status_id = isDone ? firstStatus?.id : doneStatus?.id;
    if (!status_id) return;
    setSubtasks(subtasks.map((s) => (s.id === sub.id ? { ...s, status_id } : s)));
    await supabase.from("tasks").update({ status_id }).eq("id", sub.id);
  }

  async function removeSubtask(id: string) {
    setSubtasks(subtasks.filter((s) => s.id !== id));
    await supabase.from("tasks").delete().eq("id", id);
  }

  async function addComment(e: React.FormEvent) {
    e.preventDefault();
    const body = newComment.trim();
    if (!body) return;
    setNewComment("");
    const { data } = await supabase
      .from("comments")
      .insert({ task_id: task.id, body })
      .select("*, profiles(email, full_name)")
      .single();
    if (data) setComments([...comments, data as Comment]);
  }

  const status = statuses.find((s) => s.id === task.status_id);
  const doneCount = subtasks.filter((s) => s.status_id === doneStatus?.id).length;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b px-6 py-3 text-sm">
          <span
            className="rounded px-2 py-0.5 text-xs font-semibold uppercase text-white"
            style={{ background: status?.color ?? "#94a3b8" }}
          >
            {status?.name ?? "Sem status"}
          </span>
          <div className="flex gap-3">
            <button
              onClick={() => confirm("Excluir esta tarefa?") && actions.remove(task.id)}
              className="text-slate-400 hover:text-red-600"
            >
              Excluir
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-800">
              ✕
            </button>
          </div>
        </div>

        <div className="space-y-6 p-6">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== task.title && actions.update(task.id, { title: title.trim() })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="w-full text-2xl font-semibold outline-none"
          />

          <div className="grid grid-cols-[110px_1fr] items-center gap-y-3 text-sm">
            <span className="text-slate-500">Status</span>
            <select
              value={task.status_id ?? ""}
              onChange={(e) => actions.update(task.id, { status_id: e.target.value })}
              className="w-48 rounded border px-2 py-1"
            >
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <span className="text-slate-500">Prioridade</span>
            <select
              value={task.priority ?? ""}
              onChange={(e) =>
                actions.update(task.id, { priority: (e.target.value || null) as Priority | null })
              }
              className="w-48 rounded border px-2 py-1"
            >
              <option value="">Sem prioridade</option>
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>

            <span className="text-slate-500">Prazo</span>
            <input
              type="date"
              value={task.due_date ?? ""}
              onChange={(e) => actions.update(task.id, { due_date: e.target.value || null })}
              className="w-48 rounded border px-2 py-1"
            />
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-500">Descrição</h3>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() =>
                description !== (task.description ?? "") &&
                actions.update(task.id, { description: description || null })
              }
              rows={5}
              placeholder="Adicione detalhes…"
              className="w-full rounded border p-3 text-sm outline-none focus:border-violet-500"
            />
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-500">
              Subtarefas {subtasks.length > 0 && `(${doneCount}/${subtasks.length})`}
            </h3>
            <ul className="space-y-1">
              {subtasks.map((sub) => {
                const done = sub.status_id === doneStatus?.id;
                return (
                  <li key={sub.id} className="group flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={done} onChange={() => toggleSubtask(sub)} />
                    <span className={`flex-1 ${done ? "text-slate-400 line-through" : ""}`}>{sub.title}</span>
                    <button
                      onClick={() => removeSubtask(sub.id)}
                      className="invisible text-xs text-slate-400 hover:text-red-600 group-hover:visible"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
            <form onSubmit={addSubtask} className="mt-2">
              <input
                value={newSubtask}
                onChange={(e) => setNewSubtask(e.target.value)}
                placeholder="+ Adicionar subtarefa"
                className="w-full rounded border border-dashed px-2 py-1 text-sm outline-none focus:border-violet-500"
              />
            </form>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-slate-500">Comentários</h3>
            <ul className="space-y-3">
              {comments.map((c) => (
                <li key={c.id} className="rounded-md bg-slate-50 p-3 text-sm">
                  <div className="mb-1 text-xs text-slate-500">
                    <strong className="text-slate-700">
                      {c.profiles?.full_name || c.profiles?.email || "Usuário"}
                    </strong>{" "}
                    · {new Date(c.created_at).toLocaleString("pt-BR")}
                  </div>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
            </ul>
            <form onSubmit={addComment} className="mt-3 flex gap-2">
              <input
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Escreva um comentário…"
                className="flex-1 rounded border px-3 py-1.5 text-sm outline-none focus:border-violet-500"
              />
              <button className="rounded bg-violet-600 px-3 text-sm text-white hover:bg-violet-700">
                Enviar
              </button>
            </form>
          </div>
        </div>
      </aside>
    </div>
  );
}
