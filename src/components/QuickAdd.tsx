"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyDate, todayISO } from "@/lib/dates";
import { parseQuick } from "@/lib/quickParse";
import { createTaskFull } from "@/lib/tasks";
import { startWavRecording, type WavRecording } from "@/lib/wavRecorder";
import { memberName, PRIORITIES, RECURRENCES, type Priority, type Recurrence } from "@/lib/types";
import { DuePicker, PriorityPicker } from "./InlineEditors";
import { AssigneePicker, Avatar } from "./TaskBits";
import { useToast } from "./Toast";
import { useWorkspace } from "./WorkspaceContext";

interface ListOption {
  id: string;
  name: string;
  spaceName: string;
  spaceColor: string;
}

interface Draft {
  key: number;
  title: string;
  assignees: string[];
  due: string | null;
  priority: Priority | null;
  recurrence: Recurrence | null;
  listId: string;
}

type Mode = "type" | "recording" | "processing" | "review";

interface OpenOpts {
  voice?: boolean;
}

const Ctx = createContext<(opts?: OpenOpts) => void>(() => {});
export const useQuickAdd = () => useContext(Ctx);

const MAX_SECONDS = 90;

// Tipos mínimos da Web Speech API (ditado do navegador)
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function getRecognition(): Recognition | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return C ? new C() : null;
}

export function QuickAddProvider({ children }: { children: React.ReactNode }) {
  const { workspace, members } = useWorkspace();
  const pathname = usePathname();
  const toast = useToast();
  const supabase = useMemo(() => createClient(), []);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("type");
  const [lists, setLists] = useState<ListOption[]>([]);
  const [listId, setListId] = useState("");
  const [text, setText] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [dictating, setDictating] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<WavRecording | null>(null);
  const speechRef = useRef<Recognition | null>(null);
  const draftSeq = useRef(0);
  const lastListKey = `nortin:lastList:${workspace.id}`;

  const loadLists = useCallback(async () => {
    const { data } = await supabase
      .from("lists")
      .select("id, name, position, archived_at, spaces(name, color, position, archived_at)")
      .eq("workspace_id", workspace.id)
      .is("archived_at", null);
    const opts = (data ?? [])
      .map((l) => {
        const sp = l.spaces as unknown as { name: string; color: string; position: number; archived_at: string | null } | null;
        if (sp?.archived_at) return null;
        return { id: l.id, name: l.name, spaceName: sp?.name ?? "", spaceColor: sp?.color ?? "#94a3b8", sort: [sp?.position ?? 0, l.position] };
      })
      .filter((o): o is NonNullable<typeof o> => o !== null)
      .sort((a, b) => a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1])
      .map(({ sort: _s, ...o }) => o);
    setLists(opts);
    return opts;
  }, [supabase, workspace.id]);

  const stopAll = useCallback(() => {
    recRef.current?.cancel();
    recRef.current = null;
    speechRef.current?.stop();
    speechRef.current = null;
    setDictating(false);
  }, []);

  const close = useCallback(() => {
    stopAll();
    setOpen(false);
    setMode("type");
    setText("");
    setDrafts([]);
    setError(null);
  }, [stopAll]);

  // Abre já na lista da tela atual; senão, na última usada.
  const openQuickAdd = useCallback(
    async (opts?: OpenOpts) => {
      setOpen(true);
      setError(null);
      setMode("type");
      // Recarrega sempre: listas podem ter sido criadas ou arquivadas desde a última vez.
      const opts2 = await loadLists();
      const fromUrl = pathname.match(/\/l\/([^/?]+)/)?.[1];
      let remembered: string | null = null;
      try {
        remembered = localStorage.getItem(lastListKey);
      } catch {}
      const pick = [fromUrl, remembered].find((id) => id && opts2.some((l) => l.id === id)) ?? opts2[0]?.id ?? "";
      setListId(pick);
      if (opts?.voice) void startVoice();
      else setTimeout(() => inputRef.current?.focus(), 0);
    },
    // startVoice é estável o bastante para este uso
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lists, loadLists, pathname, lastListKey],
  );

  useEffect(() => {
    fetch("/api/voice")
      .then((r) => r.json())
      .then((j) => setAiEnabled(Boolean(j.ai)))
      .catch(() => setAiEnabled(false));
  }, []);

  // Tecla N abre de qualquer lugar (fora de campos de texto)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.closest("input, textarea, select, [contenteditable=true]");
      if (!open && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void openQuickAdd();
      }
      if (open && e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, openQuickAdd, close]);

  // Cronômetro e nível do microfone durante a gravação
  useEffect(() => {
    if (mode !== "recording") return;
    const started = Date.now();
    let raf = 0;
    const tick = () => {
      const s = Math.floor((Date.now() - started) / 1000);
      setSeconds(s);
      setLevel(recRef.current?.level() ?? 0);
      if (s >= MAX_SECONDS) void finishRecording();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const parsed = useMemo(() => parseQuick(text, members), [text, members]);
  const listName = (id: string) => {
    const l = lists.find((x) => x.id === id);
    return l ? `${l.spaceName} / ${l.name}` : "";
  };

  function rememberList(id: string) {
    setListId(id);
    try {
      localStorage.setItem(lastListKey, id);
    } catch {}
  }

  async function createTyped(e?: React.FormEvent) {
    e?.preventDefault();
    if (!parsed.title || !listId || busy) return;
    setBusy(true);
    try {
      const id = await createTaskFull(supabase, { listId, ...parsed });
      rememberList(listId);
      setText("");
      toast(`Tarefa criada em ${listName(listId)}`, {
        undo: () => void supabase.from("tasks").delete().eq("id", id),
      });
      inputRef.current?.focus();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ---------- Voz ----------

  async function startVoice() {
    setError(null);
    const ai = aiEnabled ?? (await fetch("/api/voice").then((r) => r.json()).then((j) => Boolean(j.ai)).catch(() => false));
    if (ai) {
      try {
        recRef.current = await startWavRecording();
        setSeconds(0);
        setMode("recording");
      } catch {
        setError("Não consegui usar o microfone. Libere a permissão no cadeado ao lado do endereço do site.");
      }
      return;
    }
    // Sem IA: ditado do navegador, uma tarefa por vez
    const rec = getRecognition();
    if (!rec) {
      setError("Este navegador não faz ditado. Use Chrome, Edge ou Safari, ou digite a tarefa.");
      return;
    }
    const before = text ? `${text} ` : "";
    rec.lang = "pt-BR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let said = "";
      for (let i = 0; i < e.results.length; i++) said += e.results[i][0].transcript;
      setText(before + said.trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") setError("Microfone bloqueado. Libere a permissão no cadeado ao lado do endereço do site.");
    };
    rec.onend = () => {
      setDictating(false);
      speechRef.current = null;
      inputRef.current?.focus();
    };
    speechRef.current = rec;
    setDictating(true);
    rec.start();
  }

  function stopDictation() {
    speechRef.current?.stop();
  }

  async function finishRecording() {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    setMode("processing");
    try {
      const audio = await rec.stop();
      const form = new FormData();
      form.append("audio", audio, "audio.wav");
      form.append("workspaceId", workspace.id);
      form.append("today", todayISO());
      const res = await fetch("/api/voice", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Falha ao entender o áudio");
      setTranscript(json.transcript ?? "");
      const got: Draft[] = (json.tasks ?? []).map(
        (t: {
          title: string;
          assignees: string[];
          due: string | null;
          priority: Priority | null;
          recurrence: Recurrence | null;
          listId: string | null;
        }) => ({
          key: ++draftSeq.current,
          title: t.title,
          assignees: t.assignees,
          due: t.due,
          priority: t.priority,
          recurrence: t.recurrence ?? null,
          listId: t.listId ?? listId,
        }),
      );
      if (got.length === 0) {
        setMode("type");
        setError(`Não identifiquei tarefas no áudio${json.transcript ? `: "${json.transcript}"` : ""}. Tente de novo ou digite.`);
        return;
      }
      setDrafts(got);
      setMode("review");
    } catch (err) {
      setMode("type");
      setError((err as Error).message);
    }
  }

  async function createDrafts() {
    const valid = drafts.filter((d) => d.title.trim() && d.listId);
    if (!valid.length) return;
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const d of valid) {
        ids.push(await createTaskFull(supabase, { ...d, title: d.title.trim() }));
      }
      toast(valid.length === 1 ? "1 tarefa criada" : `${valid.length} tarefas criadas`, {
        undo: () => void supabase.from("tasks").delete().in("id", ids),
      });
      close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const patchDraft = (key: number, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const priorityInfo = PRIORITIES.find((p) => p.value === parsed.priority);
  const assigneeMembers = parsed.assignees.map((id) => members.find((m) => m.user_id === id)).filter(Boolean);

  return (
    <Ctx.Provider value={openQuickAdd}>
      {children}

      {/* Botões fixos: microfone e + Tarefa */}
      {!open && (
        <div
          className="quick-fab fixed z-40 flex items-center gap-2"
          style={{
            right: "max(1.25rem, env(safe-area-inset-right))",
            bottom: "max(1.25rem, env(safe-area-inset-bottom))",
          }}
        >
          <button
            onClick={() => void openQuickAdd({ voice: true })}
            title="Criar por áudio"
            aria-label="Criar tarefa por áudio"
            className="flex h-12 w-12 items-center justify-center rounded-full border bg-white text-xl shadow-lg hover:border-violet-400"
          >
            🎤
          </button>
          <button
            onClick={() => void openQuickAdd()}
            title="Nova tarefa (tecla N)"
            className="flex h-12 items-center gap-2 rounded-full bg-violet-600 px-5 font-semibold text-white shadow-lg hover:bg-violet-700"
          >
            <span className="text-xl leading-none">+</span> Tarefa
          </button>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-4 pt-[12vh]" onMouseDown={close}>
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl"
            role="dialog"
            aria-label="Nova tarefa"
          >
            <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm">
              <span className="text-slate-500">Em</span>
              <select
                value={listId}
                onChange={(e) => rememberList(e.target.value)}
                className="min-w-0 flex-1 truncate rounded-md bg-slate-50 px-2 py-1 font-medium outline-none hover:bg-slate-100"
                aria-label="Lista"
              >
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.spaceName} / {l.name}
                  </option>
                ))}
              </select>
              <button onClick={close} className="px-1 text-slate-400 hover:text-slate-700" aria-label="Fechar">
                ✕
              </button>
            </div>

            {mode === "type" && (
              <form onSubmit={createTyped} className="space-y-3 p-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => (dictating ? stopDictation() : void startVoice())}
                    title={dictating ? "Parar ditado" : "Falar"}
                    aria-label={dictating ? "Parar ditado" : "Falar a tarefa"}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg ${
                      dictating ? "animate-pulse bg-red-500 text-white" : "bg-slate-100 hover:bg-violet-100"
                    }`}
                  >
                    {dictating ? "■" : "🎤"}
                  </button>
                  <input
                    ref={inputRef}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={dictating ? "Pode falar…" : "Ex.: Ligar pro Assaí @bia amanhã !urgente"}
                    className="min-w-0 flex-1 rounded-lg border px-3 py-2.5 text-base outline-none focus:border-violet-500"
                    aria-label="Tarefa"
                  />
                  <button
                    disabled={!parsed.title || busy}
                    className="h-11 shrink-0 rounded-lg bg-violet-600 px-4 font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
                  >
                    Criar
                  </button>
                </div>

                {text.trim() ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-700">
                      {parsed.title || "…"}
                    </span>
                    {assigneeMembers.map((m) => (
                      <span key={m!.user_id} className="flex items-center gap-1 rounded-full bg-violet-50 py-0.5 pl-0.5 pr-2 text-violet-700">
                        <Avatar member={m!} size={18} /> {memberName(m!)}
                      </span>
                    ))}
                    {parsed.due && (
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">📅 {friendlyDate(parsed.due)}</span>
                    )}
                    {parsed.recurrence && (
                      <span className="rounded-full bg-violet-50 px-2 py-1 text-violet-700">
                        🔁 {RECURRENCES.find((r) => r.value === parsed.recurrence)?.label}
                      </span>
                    )}
                    {priorityInfo && (
                      <span className="rounded-full bg-slate-50 px-2 py-1" style={{ color: priorityInfo.color }}>
                        ⚑ {priorityInfo.label}
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    Escreva ou fale do seu jeito: <b>@nome</b> ou &quot;pra Bia&quot; marca o responsável;{" "}
                    <b>hoje, amanhã, sexta, dia 15, 05/11</b> viram prazo; <b>toda sexta, todo dia, todo mês</b> repetem;{" "}
                    <b>urgente</b> ou <b>!alta</b> viram prioridade.
                    Enter cria e já deixa pronto para a próxima.
                  </p>
                )}
                {aiEnabled === false && !dictating && (
                  <p className="text-[11px] text-slate-400">No áudio, fale uma tarefa por vez e depois toque em Criar.</p>
                )}
              </form>
            )}

            {mode === "recording" && (
              <div className="flex flex-col items-center gap-4 px-6 py-8 text-center">
                <button
                  onClick={() => void finishRecording()}
                  aria-label="Parar e criar tarefas"
                  className="relative flex h-24 w-24 items-center justify-center rounded-full bg-red-500 text-3xl text-white shadow-lg"
                  style={{ boxShadow: `0 0 0 ${6 + level * 26}px rgba(239,68,68,.18)` }}
                >
                  ■
                </button>
                <div className="text-2xl font-semibold tabular-nums">
                  0:{String(seconds).padStart(2, "0")}
                  <span className="text-sm font-normal text-slate-400"> / 1:30</span>
                </div>
                <p className="max-w-sm text-sm text-slate-500">
                  Fale as tarefas, quem faz e o prazo. Ex.: <i>&quot;Bia, ligar pro Assaí amanhã, é urgente. Rafael, revisar a
                  tabela até sexta.&quot;</i>
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => void finishRecording()}
                    className="rounded-lg bg-violet-600 px-5 py-2 font-semibold text-white hover:bg-violet-700"
                  >
                    Pronto
                  </button>
                  <button
                    onClick={() => {
                      stopAll();
                      setMode("type");
                    }}
                    className="rounded-lg border px-4 py-2 text-slate-600 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}

            {mode === "processing" && (
              <div className="flex flex-col items-center gap-3 px-6 py-12 text-sm text-slate-500">
                <span className="h-8 w-8 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" />
                Entendendo o áudio…
              </div>
            )}

            {mode === "review" && (
              <div className="space-y-3 p-4">
                <p className="text-sm font-medium">
                  Entendi {drafts.length === 1 ? "1 tarefa" : `${drafts.length} tarefas`}. Confira e crie:
                </p>
                <ul className="space-y-2">
                  {drafts.map((d) => (
                    <li key={d.key} className="space-y-1.5 rounded-lg border p-2.5">
                      <div className="flex items-center gap-2">
                        <input
                          value={d.title}
                          onChange={(e) => patchDraft(d.key, { title: e.target.value })}
                          className="min-w-0 flex-1 rounded px-1 py-0.5 font-medium outline-none focus:bg-slate-50"
                          aria-label="Título"
                        />
                        <button
                          onClick={() => setDrafts((prev) => prev.filter((x) => x.key !== d.key))}
                          className="text-slate-400 hover:text-red-600"
                          aria-label="Remover"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <AssigneePicker
                          value={d.assignees}
                          members={members}
                          onToggle={(uid, on) =>
                            patchDraft(d.key, { assignees: on ? [...d.assignees, uid] : d.assignees.filter((x) => x !== uid) })
                          }
                        />
                        <DuePicker
                          value={d.due}
                          onChange={(due) => patchDraft(d.key, { due })}
                          recurrence={d.recurrence}
                          onRecurrenceChange={(recurrence) => patchDraft(d.key, { recurrence })}
                        />
                        <PriorityPicker value={d.priority} onChange={(priority) => patchDraft(d.key, { priority })} />
                        <select
                          value={d.listId}
                          onChange={(e) => patchDraft(d.key, { listId: e.target.value })}
                          className="ml-auto max-w-[45%] truncate rounded bg-slate-50 px-1.5 py-0.5 text-xs text-slate-600"
                          aria-label="Lista"
                        >
                          {lists.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.spaceName} / {l.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </li>
                  ))}
                </ul>
                {transcript && <p className="text-xs italic text-slate-400">&quot;{transcript}&quot;</p>}
                <div className="flex gap-2">
                  <button
                    onClick={() => void createDrafts()}
                    disabled={busy || drafts.length === 0}
                    className="flex-1 rounded-lg bg-violet-600 py-2.5 font-semibold text-white hover:bg-violet-700 disabled:opacity-40"
                  >
                    {busy ? "Criando…" : drafts.length === 1 ? "Criar tarefa" : `Criar ${drafts.length} tarefas`}
                  </button>
                  <button
                    onClick={() => {
                      setDrafts([]);
                      void startVoice();
                    }}
                    className="rounded-lg border px-4 text-slate-600 hover:bg-slate-50"
                  >
                    🎤 Regravar
                  </button>
                </div>
              </div>
            )}

            {error && <p className="border-t bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}
