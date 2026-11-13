"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formUrl, memberName, toTask, type List, type Status, type Task } from "@/lib/types";
import { useWorkspace } from "./WorkspaceContext";
import ListView from "./ListView";
import BoardView from "./BoardView";
import TaskDrawer from "./TaskDrawer";
import CalendarView from "./CalendarView";
import FolderLink from "./FolderLink";
import { CampaignSummary } from "./CampaignResults";
import { ContentSummary } from "./ContentMetrics";
import { ListKindContext } from "./PostCover";
import { toResult, type CampaignResult } from "@/lib/campaign";
import type { SocialChannel } from "@/lib/social";
import { useToast } from "./Toast";
import { notifyStructureChanged, STRUCTURE_EVENT, toggleTarget } from "@/lib/tasks";

export type TaskPatch = Partial<
  Pick<Task, "title" | "description" | "status_id" | "priority" | "due_date" | "position" | "recurrence" | "folder_url" | "media" | "post_type" | "cta_url">
>;

export interface TaskActions {
  create: (title: string, statusId: string, extra?: TaskPatch, assignees?: string[]) => Promise<void>;
  update: (id: string, patch: TaskPatch) => Promise<void>;
  remove: (id: string) => Promise<void>;
  open: (id: string) => void;
  assign: (taskId: string, userId: string, assigned: boolean) => Promise<void>;
  toggleDone: (id: string) => Promise<void>;
}

const TASK_SELECT = "*, task_assignees(user_id)";

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

export default function ListScreen({ listId }: { listId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const v = searchParams.get("v");
  const view = v === "board" || v === "calendar" ? v : "list";
  const openTaskId = searchParams.get("t");
  const assigneeFilter = searchParams.get("p");
  const { workspace, members, me } = useWorkspace();
  const toast = useToast();

  const supabase = useMemo(() => createClient(), []);
  const [list, setList] = useState<List | null>(null);
  const [spaceArchived, setSpaceArchived] = useState(false);
  const [results, setResults] = useState<CampaignResult[]>([]);
  const isCampaign = list?.kind === "campaign";
  const isContent = list?.kind === "content";
  const [channels, setChannels] = useState<SocialChannel[]>([]);

  // Lista de conteúdo: status, link e métricas de cada rede dos posts, em tempo real
  useEffect(() => {
    if (!isContent) return;
    const load = () =>
      supabase
        .from("social_channels")
        .select("*, tasks!inner(list_id)")
        .eq("tasks.list_id", listId)
        .then(({ data }) => setChannels((data ?? []) as SocialChannel[]));
    load();
    const channel = supabase
      .channel(`social:${listId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "social_channels", filter: `workspace_id=eq.${workspace.id}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isContent, listId, supabase, workspace.id]);


  const saveResult = useCallback(
    (r: CampaignResult) =>
      setResults((prev) => [...prev.filter((x) => !(x.task_id === r.task_id && x.platform === r.platform)), r]),
    [],
  );

  // Lista de campanha: resultados Google/Meta das tarefas, em tempo real
  useEffect(() => {
    if (!isCampaign) return;
    supabase
      .from("campaign_results")
      .select("task_id, platform, impressions, clicks, spend, tasks!inner(list_id)")
      .eq("tasks.list_id", listId)
      .then(({ data }) => setResults((data ?? []).map((r) => toResult(r))));
    const channel = supabase
      .channel(`campaign:${listId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "campaign_results", filter: `workspace_id=eq.${workspace.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          saveResult(toResult(payload.new as Record<string, unknown>));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [isCampaign, listId, supabase, workspace.id, saveResult]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      router.replace(`${pathname}?${params}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Situação de arquivo da lista e do Space (atualiza se alguém arquivar pela barra lateral)
  const loadArchive = useCallback(async () => {
    const { data } = await supabase
      .from("lists")
      .select("archived_at, kind, form_enabled, form_token, spaces(archived_at)")
      .eq("id", listId)
      .single();
    if (!data) return;
    setList((prev) =>
      prev
        ? { ...prev, archived_at: data.archived_at, kind: data.kind as List["kind"], form_enabled: data.form_enabled, form_token: data.form_token }
        : prev,
    );
    setSpaceArchived(Boolean((data.spaces as unknown as { archived_at: string | null } | null)?.archived_at));
  }, [supabase, listId]);

  useEffect(() => {
    loadArchive();
    window.addEventListener(STRUCTURE_EVENT, loadArchive);
    return () => window.removeEventListener(STRUCTURE_EVENT, loadArchive);
  }, [loadArchive]);

  async function unarchive() {
    if (!list) return;
    const { error } = spaceArchived
      ? await supabase.rpc("set_space_archived", { p_space: list.space_id, p_archived: false })
      : await supabase.from("lists").update({ archived_at: null }).eq("id", list.id);
    if (error) return setError(error.message);
    toast(spaceArchived ? "Space de volta" : "Lista de volta");
    notifyStructureChanged();
  }

  // Carga inicial
  useEffect(() => {
    Promise.all([
      supabase.from("lists").select("*").eq("id", listId).single(),
      supabase.from("statuses").select("*").eq("list_id", listId).order("position"),
      supabase
        .from("tasks")
        .select(TASK_SELECT)
        .eq("list_id", listId)
        .is("parent_task_id", null)
        .order("position"),
    ]).then(([l, s, t]) => {
      if (l.error) return setError(l.error.message);
      setList(l.data as List);
      setStatuses((s.data as Status[]) ?? []);
      setTasks((t.data ?? []).map(toTask));
    });
  }, [listId, supabase]);

  // Realtime: mudanças feitas por outras pessoas aparecem na hora
  useEffect(() => {
    const upsert = <T extends { id: string }>(rows: T[], row: T) =>
      rows.some((r) => r.id === row.id) ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row];

    const channel = supabase
      .channel(`list:${listId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks", filter: `list_id=eq.${listId}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          // O payload não traz os responsáveis: preserva os que já temos.
          const row = payload.new as Omit<Task, "assignees">;
          setTasks((prev) => {
            if (row.parent_task_id) return prev;
            if (row.list_id !== listId) return prev.filter((t) => t.id !== row.id);
            const old = prev.find((t) => t.id === row.id);
            return upsert(prev, { ...row, assignees: old?.assignees ?? [] });
          });
        },
      )
      // DELETE não aceita filtro no Supabase Realtime
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, (payload) => {
        const id = (payload.old as { id: string }).id;
        setTasks((prev) => prev.filter((t) => t.id !== id));
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "statuses", filter: `list_id=eq.${listId}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          setStatuses((prev) => upsert(prev, payload.new as Status));
        },
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "statuses" }, (payload) => {
        const id = (payload.old as { id: string }).id;
        setStatuses((prev) => prev.filter((s) => s.id !== id));
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "task_assignees", filter: `workspace_id=eq.${workspace.id}` },
        (payload) => {
          const { task_id, user_id } = payload.new as { task_id: string; user_id: string };
          setTasks((prev) =>
            prev.map((t) =>
              t.id === task_id && !t.assignees.includes(user_id) ? { ...t, assignees: [...t.assignees, user_id] } : t,
            ),
          );
        },
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "task_assignees" }, (payload) => {
        const { task_id, user_id } = payload.old as { task_id: string; user_id: string };
        setTasks((prev) =>
          prev.map((t) => (t.id === task_id ? { ...t, assignees: t.assignees.filter((u) => u !== user_id) } : t)),
        );
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [listId, supabase, workspace.id]);

  // Com a lista aberta, confere no GHL os posts cujo horário já passou: assim que publicam,
  // vão para "Publicado" com link e números, sem esperar o robô diário
  const lastSync = useRef(new Map<string, number>());
  useEffect(() => {
    if (!isContent) return;
    const check = async () => {
      const now = Date.now();
      const due = tasks.filter((t) => {
        const pending = channels.some((c) => c.task_id === t.id && c.status === "scheduled");
        const passed = t.publish_at && new Date(t.publish_at).getTime() <= now;
        const recent = now - (lastSync.current.get(t.id) ?? 0) < 4 * 60 * 1000;
        return pending && passed && !recent;
      });
      for (const t of due.slice(0, 5)) {
        lastSync.current.set(t.id, now);
        await fetch("/api/social/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId: t.id }),
        }).catch(() => undefined);
      }
    };
    void check();
    const timer = setInterval(() => void check(), 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [isContent, tasks, channels]);

  const actions: TaskActions = {
    async create(title, statusId, extra, assignees = []) {
      const last = tasks.filter((t) => t.status_id === statusId).sort(byPosition).at(-1);
      const { data, error } = await supabase
        .from("tasks")
        .insert({ ...extra, list_id: listId, status_id: statusId, title, position: (last?.position ?? 0) + 1000 })
        .select(TASK_SELECT)
        .single();
      if (error) return setError(error.message);
      const created = toTask(data);
      // Com o filtro "pessoa" ativo, a tarefa nova já nasce marcada para ela.
      const who = [...new Set([...assignees, ...(assigneeFilter ? [assigneeFilter] : [])])];
      if (who.length) {
        await supabase.from("task_assignees").insert(who.map((user_id) => ({ task_id: created.id, user_id })));
        created.assignees = who;
      }
      setTasks((prev) => (prev.some((t) => t.id === created.id) ? prev : [...prev, created]));
    },
    async update(id, patch) {
      const before = tasks;
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
      const { error } = await supabase.from("tasks").update(patch).eq("id", id);
      if (error) {
        setTasks(before);
        setError(error.message);
      }
    },
    // Exclui de verdade só depois de 5 s: até lá, "Desfazer" devolve a tarefa.
    async remove(id) {
      const task = tasks.find((t) => t.id === id);
      if (!task) return;
      setTasks((prev) => prev.filter((t) => t.id !== id));
      if (openTaskId === id) setParam("t", null);
      let undone = false;
      const scheduled = channels.some((c) => c.task_id === id && c.status !== "published");
      toast(scheduled ? "Tarefa excluída · o agendamento no GHL será cancelado" : "Tarefa excluída", {
        undo: () => {
          undone = true;
          setTasks((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, task]));
        },
      });
      setTimeout(async () => {
        if (undone) return;
        // Post de conteúdo agendado: cancela no GHL antes, senão ele seria publicado mesmo sem a tarefa
        if (channels.some((c) => c.task_id === id && c.status !== "published")) {
          const res = await fetch("/api/social/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ taskId: id }),
          });
          if (!res.ok) {
            setTasks((prev) => (prev.some((t) => t.id === id) ? prev : [...prev, task]));
            return setError("Não deu para cancelar o agendamento no GHL, então a tarefa não foi excluída. Tente de novo.");
          }
        }
        const { error } = await supabase.from("tasks").delete().eq("id", id);
        if (error) setError(error.message);
      }, 5200);
    },
    async toggleDone(id) {
      const task = tasks.find((t) => t.id === id);
      if (!task) return;
      const target = toggleTarget(statuses, task.status_id);
      if (!target || !task.status_id) return;
      const previous = task.status_id;
      const wasDone = statuses.find((s) => s.id === previous)?.type === "done";
      await actions.update(id, { status_id: target.id });
      const repeats = !wasDone && target.type === "done" && task.recurrence;
      toast(wasDone ? "Tarefa reaberta" : repeats ? "Concluída ✓ · 🔁 a próxima já foi criada" : "Tarefa concluída ✓", {
        undo: () => void actions.update(id, { status_id: previous }),
      });
    },
    open: (id) => setParam("t", id),
    async assign(taskId, userId, assigned) {
      const apply = (on: boolean) =>
        setTasks((prev) =>
          prev.map((t) =>
            t.id !== taskId
              ? t
              : { ...t, assignees: on ? [...new Set([...t.assignees, userId])] : t.assignees.filter((u) => u !== userId) },
          ),
        );
      apply(assigned);
      const { error } = assigned
        ? await supabase.from("task_assignees").insert({ task_id: taskId, user_id: userId })
        : await supabase.from("task_assignees").delete().eq("task_id", taskId).eq("user_id", userId);
      if (error && error.code !== "23505") {
        apply(!assigned);
        setError(error.message);
      }
    },
  };

  async function addStatus(name: string) {
    const { data, error } = await supabase
      .from("statuses")
      .insert({
        list_id: listId,
        name,
        color: "#a855f7",
        position: (statuses.at(-1)?.position ?? 0) + 1000,
      })
      .select()
      .single();
    if (error) return setError(error.message);
    setStatuses((prev) => (prev.some((s) => s.id === data.id) ? prev : [...prev, data as Status]));
  }

  async function removeStatus(id: string) {
    if (tasks.some((t) => t.status_id === id)) {
      return setError("Mova as tarefas para outro status antes de excluir este.");
    }
    if (statuses.length <= 1) return setError("A lista precisa de pelo menos um status.");
    setStatuses((prev) => prev.filter((s) => s.id !== id));
    const { error } = await supabase.from("statuses").delete().eq("id", id);
    if (error) setError(error.message);
  }

  const sortedStatuses = [...statuses].sort(byPosition);
  const q = query.trim().toLowerCase();
  const visibleTasks = [...tasks]
    .filter((t) => !q || t.title.toLowerCase().includes(q))
    .filter((t) => !assigneeFilter || t.assignees.includes(assigneeFilter))
    .sort(byPosition);
  const openTask = tasks.find((t) => t.id === openTaskId) ?? null;

  return (
    <ListKindContext.Provider value={list?.kind ?? "tasks"}>
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b px-6 pt-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold">{list?.name ?? "…"}</h1>
          {list && (
            <FolderLink
              subject="lista"
              value={list.folder_url}
              onSave={async (folder_url) => {
                const before = list.folder_url;
                setList({ ...list, folder_url });
                const { error } = await supabase.from("lists").update({ folder_url }).eq("id", list.id);
                if (error) {
                  setList({ ...list, folder_url: before });
                  setError(error.message);
                } else toast(folder_url ? "Pasta vinculada à lista" : "Pasta removida da lista");
              }}
            />
          )}
          {list?.form_enabled && list.form_token && (
            <span className="inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-1 text-xs text-violet-700">
              📝 Briefing ativo
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(formUrl(list.form_token!));
                    toast("Link do formulário copiado 📝");
                  } catch {
                    toast(`Link do formulário: ${formUrl(list.form_token!)}`);
                  }
                }}
                className="rounded px-1 font-semibold hover:bg-violet-100"
              >
                Copiar link
              </button>
              <a href={`/f/${list.form_token}`} target="_blank" rel="noopener noreferrer" className="rounded px-1 font-semibold hover:bg-violet-100">
                Abrir ↗
              </a>
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div className="flex gap-1 text-sm">
            {(["list", "board", "calendar"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setParam("v", v === "list" ? null : v)}
                className={`border-b-2 px-3 pb-2 ${
                  view === v
                    ? "border-violet-600 font-medium text-violet-700"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
              >
                {v === "list" ? "☰ Lista" : v === "board" ? "▦ Quadro" : "▣ Calendário"}
              </button>
            ))}
          </div>
          <div className="mb-2 flex flex-wrap gap-2">
            <select
              value={assigneeFilter ?? ""}
              onChange={(e) => setParam("p", e.target.value || null)}
              className="rounded-md border px-2 py-1 text-sm outline-none focus:border-violet-500"
              aria-label="Filtrar por responsável"
            >
              <option value="">Todos os responsáveis</option>
              <option value={me}>Só as minhas</option>
              {members
                .filter((m) => m.user_id !== me)
                .map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {memberName(m)}
                  </option>
                ))}
            </select>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar tarefas…"
              className="w-56 rounded-md border px-3 py-1 text-sm outline-none focus:border-violet-500"
            />
          </div>
        </div>
      </header>

      {(list?.archived_at || spaceArchived) && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-50 px-6 py-2 text-sm text-amber-800">
          <span>
            📦 {spaceArchived ? "O Space desta lista está arquivado" : "Esta lista está arquivada"}. As tarefas não aparecem em Meu dia,
            Minhas tarefas nem Gestão.
          </span>
          <button onClick={unarchive} className="rounded-md bg-amber-600 px-3 py-1 font-medium text-white hover:bg-amber-700">
            Desarquivar
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between bg-red-50 px-6 py-2 text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto bg-white">
        {isContent && view === "list" && (
          <div className="px-4 pt-4 sm:px-6">
            <ContentSummary channels={channels.filter((c) => tasks.some((t) => t.id === c.task_id))} />
          </div>
        )}
        {isCampaign && view === "list" && (
          <div className="px-4 pt-4 sm:px-6">
            <CampaignSummary results={results.filter((r) => tasks.some((t) => t.id === r.task_id))} />
          </div>
        )}
        {view === "list" ? (
          <ListView
            statuses={sortedStatuses}
            tasks={visibleTasks}
            actions={actions}
            campaign={isCampaign ? { results, onSaved: saveResult } : undefined}
            social={isContent ? channels : undefined}
          />
        ) : view === "calendar" ? (
          <CalendarView
            items={visibleTasks.map((t) => {
              const s = statuses.find((x) => x.id === t.status_id);
              return {
                id: t.id,
                title: t.title,
                due_date: t.due_date,
                color: s?.color ?? "#94a3b8",
                done: s?.type === "done" || s?.type === "closed",
                priority: t.priority,
                assignees: t.assignees,
              };
            })}
            members={members}
            onOpen={actions.open}
            onMove={(id, date) => actions.update(id, { due_date: date })}
            onCreate={async (date, title) => {
              if (sortedStatuses[0]) await actions.create(title, sortedStatuses[0].id, { due_date: date });
            }}
          />
        ) : (
          <BoardView
            statuses={sortedStatuses}
            tasks={visibleTasks}
            actions={actions}
            onAddStatus={addStatus}
            onRemoveStatus={removeStatus}
          />
        )}
      </div>

      {openTask && (
        <TaskDrawer
          key={openTask.id}
          task={openTask}
          listFolder={list?.folder_url ?? null}
          campaign={isCampaign ? { results: results.filter((r) => r.task_id === openTask.id), onSaved: saveResult } : undefined}
          social={isContent ? channels.filter((c) => c.task_id === openTask.id) : undefined}
          statuses={sortedStatuses}
          actions={actions}
          onClose={() => setParam("t", null)}
        />
      )}
    </div>
    </ListKindContext.Provider>
  );
}
