"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { friendlyDate, ymd } from "@/lib/dates";
import { memberName, type Comment, type Status, type Task } from "@/lib/types";
import type { TaskActions } from "./ListScreen";
import { AssigneePicker, Avatar } from "./TaskBits";
import { DuePicker, PriorityPicker, StatusPicker } from "./InlineEditors";
import { useWorkspace } from "./WorkspaceContext";
import FolderLink, { folderService } from "./FolderLink";

type Message = Omit<Comment, "profiles">;

// Links nas mensagens viram clicáveis; os de pasta/arquivo ganham o nome do serviço
const URL_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]])/g;

function MessageBody({ text, mine }: { text: string; mine: boolean }) {
  const parts = text.split(URL_RE);
  return (
    <p className="whitespace-pre-wrap break-words">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className={`underline underline-offset-2 ${mine ? "text-white" : "text-sky-700"}`}
          >
            {["SharePoint", "OneDrive", "Google Drive", "Dropbox"].includes(folderService(part)) ? `📁 ${folderService(part)}: ` : ""}
            {part.length > 60 ? `${part.slice(0, 57)}…` : part}
          </a>
        ) : (
          part
        ),
      )}
    </p>
  );
}

export default function TaskDrawer({
  task,
  listFolder,
  statuses,
  actions,
  onClose,
}: {
  task: Task;
  listFolder: string | null;
  statuses: Status[];
  actions: TaskActions;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { members, me } = useWorkspace();
  const [title, setTitle] = useState(task.title);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Chat da tarefa: carrega e recebe mensagens novas em tempo real
  useEffect(() => {
    supabase
      .from("comments")
      .select("id, task_id, author_id, body, created_at")
      .eq("task_id", task.id)
      .order("created_at")
      .then(({ data }) => setMessages((data as Message[]) ?? []));
    const channel = supabase
      .channel(`chat:${task.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "comments", filter: `task_id=eq.${task.id}` }, (payload) => {
        const m = payload.new as Message;
        setMessages((prev) => (prev?.some((x) => x.id === m.id) ? prev : [...(prev ?? []), m]));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [task.id, supabase]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages?.length]);

  // Com a tarefa aberta, os botões flutuantes (+ Tarefa / 🎤) saem da frente do chat
  useEffect(() => {
    document.body.dataset.drawerOpen = "true";
    return () => {
      delete document.body.dataset.drawerOpen;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const { data, error } = await supabase
      .from("comments")
      .insert({ task_id: task.id, body })
      .select("id, task_id, author_id, body, created_at")
      .single();
    setSending(false);
    if (error) return setError("Não deu para enviar. Tente de novo.");
    setDraft("");
    setMessages((prev) => (prev?.some((x) => x.id === data.id) ? prev : [...(prev ?? []), data as Message]));
  }

  const status = statuses.find((s) => s.id === task.status_id);
  const isDone = status?.type === "done";

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onClose}>
      <aside onClick={(e) => e.stopPropagation()} className="flex h-full w-full max-w-xl flex-col bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3 text-sm">
          <span
            className="rounded px-2 py-0.5 text-xs font-semibold uppercase text-white"
            style={{ background: status?.color ?? "#94a3b8" }}
          >
            {status?.name ?? "Sem status"}
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => actions.toggleDone(task.id)}
              className={`rounded-md px-3 py-1 font-medium ${
                isDone ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-emerald-600 text-white hover:bg-emerald-700"
              }`}
            >
              {isDone ? "✓ Concluída" : "✓ Concluir"}
            </button>
            <button onClick={() => actions.remove(task.id)} className="text-slate-400 hover:text-red-600">
              Excluir
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-800" aria-label="Fechar">
              ✕
            </button>
          </div>
        </div>

        {/* Dados da tarefa */}
        <div className="space-y-4 border-b px-5 py-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== task.title && actions.update(task.id, { title: title.trim() })}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="w-full text-xl font-semibold outline-none"
            aria-label="Título"
          />
          <div className="grid grid-cols-[100px_1fr] items-center gap-y-2.5 text-sm">
            <span className="text-slate-500">Status</span>
            <div className="w-40">
              <StatusPicker statuses={statuses} value={task.status_id} onChange={(status_id) => actions.update(task.id, { status_id })} />
            </div>

            <span className="text-slate-500">Responsáveis</span>
            <div>
              <AssigneePicker value={task.assignees} members={members} onToggle={(userId, on) => actions.assign(task.id, userId, on)} />
            </div>

            <span className="text-slate-500">Prioridade</span>
            <div>
              <PriorityPicker value={task.priority} onChange={(priority) => actions.update(task.id, { priority })} />
            </div>

            <span className="text-slate-500">Prazo</span>
            <div>
              <DuePicker
                value={task.due_date}
                done={isDone}
                onChange={(due_date) => actions.update(task.id, { due_date })}
                recurrence={task.recurrence}
                onRecurrenceChange={(recurrence) => actions.update(task.id, { recurrence })}
              />
            </div>

            <span className="text-slate-500">Pasta</span>
            <div>
              <FolderLink
                subject="tarefa"
                value={task.folder_url}
                inherited={listFolder}
                onSave={(folder_url) => actions.update(task.id, { folder_url })}
              />
            </div>
          </div>
        </div>

        {/* Chat */}
        <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
          <div className="border-b bg-white px-5 py-2 text-sm font-semibold text-slate-700">💬 Chat</div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-3">
            {messages === null && <p className="text-center text-sm text-slate-400">Carregando…</p>}
            {messages?.length === 0 && (
              <p className="mt-6 text-center text-sm text-slate-400">
                Nenhuma mensagem ainda. Combine aqui o que precisa ser feito nesta tarefa.
              </p>
            )}
            {messages?.map((m, i) => {
              const prev = messages[i - 1];
              const day = ymd(new Date(m.created_at));
              const newDay = !prev || ymd(new Date(prev.created_at)) !== day;
              const sameAuthor = !newDay && prev?.author_id === m.author_id;
              const mine = m.author_id === me;
              const author = members.find((x) => x.user_id === m.author_id);
              const time = new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
              return (
                <div key={m.id}>
                  {newDay && (
                    <div className="my-3 text-center">
                      <span className="rounded-full bg-white px-3 py-0.5 text-[11px] font-medium text-slate-500 shadow-sm">
                        {friendlyDate(day)}
                      </span>
                    </div>
                  )}
                  <div className={`flex items-end gap-2 ${mine ? "justify-end" : ""} ${sameAuthor ? "" : "mt-2"}`}>
                    {!mine && (
                      <span className={`w-7 shrink-0 ${sameAuthor ? "invisible" : ""}`}>
                        {author && <Avatar member={author} size={28} />}
                      </span>
                    )}
                    <div
                      className={`max-w-[78%] rounded-2xl px-3 py-1.5 text-sm shadow-sm ${
                        mine ? "rounded-br-md bg-violet-600 text-white" : "rounded-bl-md bg-white text-slate-800"
                      }`}
                    >
                      {!mine && !sameAuthor && (
                        <div className="mb-0.5 text-xs font-semibold text-violet-700">{memberName(author)}</div>
                      )}
                      <MessageBody text={m.body} mine={mine} />
                      <div className={`mt-0.5 text-right text-[10px] ${mine ? "text-violet-200" : "text-slate-400"}`}>{time}</div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="border-t bg-white px-4 py-3"
          >
            {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder="Escreva uma mensagem…"
                aria-label="Mensagem"
                className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border px-3 py-2 text-sm outline-none focus:border-violet-500"
              />
              <button
                disabled={!draft.trim() || sending}
                className="h-10 shrink-0 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
              >
                Enviar
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">
              Enter envia · Shift+Enter quebra linha · Mensagens enviadas não podem ser editadas nem apagadas.
            </p>
          </form>
        </div>
      </aside>
    </div>
  );
}
