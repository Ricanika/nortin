"use client";

import { Fragment, useEffect, useState } from "react";
import { parseQuick } from "@/lib/quickParse";
import type { Status, Task } from "@/lib/types";
import type { TaskActions } from "./ListScreen";
import { CompleteToggle, DuePicker, PriorityPicker, StatusPicker } from "./InlineEditors";
import { AssigneePicker, NewTaskInput } from "./TaskBits";
import { useWorkspace } from "./WorkspaceContext";
import { CampaignCells } from "./CampaignResults";
import type { CampaignResult } from "@/lib/campaign";
import { contentTotals, type SocialChannel } from "@/lib/social";
import { cpc, sumMetrics } from "@/lib/campaign";
import { memberName } from "@/lib/types";
import { ChannelRows, ContentCells } from "./ContentMetrics";
import PostCover from "./PostCover";

type SortKey =
  | "name"
  | "assignees"
  | "priority"
  | "due"
  | "impressions"
  | "likes"
  | "engagement"
  | "c_impressions"
  | "c_clicks"
  | "c_cpc"
  | "c_spend";

const COLS = "grid-cols-[minmax(200px,1fr)_96px_130px_100px_96px_32px] min-w-[700px]";
// Lista de campanha: + Plataformas, Impressões, Cliques, CPC, Gasto (larguras iguais às do CampaignCells)
const COLS_CAMPAIGN =
  "grid-cols-[minmax(200px,1fr)_96px_130px_100px_96px_52px_84px_72px_78px_96px_32px] min-w-[1130px]";
// Lista de conteúdo: + Redes, Alcance, Engajamento (curtidas + comentários + compartilhamentos) e
// Taxa % (engajamento ÷ alcance), somando os canais; ▸ abre por canal
const COLS_CONTENT =
  "grid-cols-[minmax(200px,1fr)_96px_130px_100px_96px_150px_90px_104px_80px_32px] min-w-[1100px]";

export default function ListView({
  statuses,
  tasks,
  actions,
  campaign,
  social,
}: {
  statuses: Status[];
  tasks: Task[];
  actions: TaskActions;
  campaign?: { results: CampaignResult[]; onSaved: (r: CampaignResult) => void };
  social?: SocialChannel[];
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [openChannels, setOpenChannels] = useState<Set<string>>(new Set());
  const toggleChannels = (id: string) =>
    setOpenChannels((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const { members } = useWorkspace();
  const cols = campaign ? COLS_CAMPAIGN : social ? COLS_CONTENT : COLS;

  // Ordenação pelos títulos das colunas: ▲ crescente → ▼ decrescente → ordem manual.
  // Vale dentro de cada grupo de status e fica lembrada por lista neste navegador.
  const listId = statuses[0]?.list_id ?? "";
  const sortKey = `hyak:sort:${listId}`;
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(sortKey);
      setSort(saved ? JSON.parse(saved) : null);
    } catch {
      setSort(null);
    }
  }, [sortKey]);
  const cycleSort = (key: SortKey) => {
    const next = !sort || sort.key !== key ? { key, dir: 1 as const } : sort.dir === 1 ? { key, dir: -1 as const } : null;
    setSort(next);
    try {
      if (next) localStorage.setItem(sortKey, JSON.stringify(next));
      else localStorage.removeItem(sortKey);
    } catch {}
  };

  // Valor de cada tarefa na coluna escolhida; vazio sempre vai para o fim
  const valueOf = (t: Task, key: SortKey): string | number | null => {
    switch (key) {
      case "name":
        return t.title.toLocaleLowerCase("pt-BR");
      case "assignees": {
        const names = t.assignees.map((id) => memberName(members.find((m) => m.user_id === id))).sort();
        return names[0]?.toLocaleLowerCase("pt-BR") ?? null;
      }
      case "priority":
        return t.priority === "urgent" ? 0 : t.priority === "high" ? 1 : null;
      case "due":
        return t.due_date;
      case "impressions":
      case "likes":
      case "engagement": {
        const ch = (social ?? []).filter((c) => c.task_id === t.id && c.status === "published");
        if (!ch.length) return null;
        const tot = contentTotals(ch);
        // likes = coluna Engajamento (curtidas + comentários + compartilhamentos); engagement = Taxa %
        return key === "engagement" ? tot.engagement : key === "likes" ? tot.interactions : tot.impressions || null;
      }
      case "c_impressions":
      case "c_clicks":
      case "c_cpc":
      case "c_spend": {
        const rs = (campaign?.results ?? []).filter((r) => r.task_id === t.id);
        if (!rs.length) return null;
        const m = sumMetrics(rs);
        return key === "c_impressions" ? m.impressions : key === "c_clicks" ? m.clicks : key === "c_spend" ? m.spend : cpc(m);
      }
    }
  };
  const sorted = (list: Task[]) => {
    if (!sort) return list;
    return [...list].sort((a, b) => {
      const va = valueOf(a, sort.key);
      const vb = valueOf(b, sort.key);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
      return cmp * sort.dir;
    });
  };
  const head = (key: SortKey, label: string, cls = "") => (
    <button
      type="button"
      onClick={() => cycleSort(key)}
      title={`Ordenar por ${label}`}
      className={`flex items-center gap-1 hover:text-slate-700 ${cls} ${sort?.key === key ? "font-semibold text-violet-700" : ""}`}
    >
      {label}
      <span className="w-2 text-[9px]">{sort?.key === key ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
    </button>
  );

  return (
    <div className="space-y-6 p-4 pb-28 sm:p-6">
      {statuses.map((status) => {
        const group = sorted(tasks.filter((t) => t.status_id === status.id));
        const isDone = status.type === "done" || status.type === "closed";
        return (
          <section key={status.id}>
            <button
              onClick={() => setCollapsed({ ...collapsed, [status.id]: !collapsed[status.id] })}
              className="mb-2 flex items-center gap-2 text-sm"
            >
              <span className="w-3 text-slate-400">{collapsed[status.id] ? "▸" : "▾"}</span>
              <span className="rounded px-2 py-0.5 text-xs font-semibold uppercase text-white" style={{ background: status.color }}>
                {status.name}
              </span>
              <span className="text-slate-400">{group.length}</span>
            </button>

            {!collapsed[status.id] && (
              <div className="overflow-x-auto sm:ml-5">
                <div className={`grid ${cols} border-b px-2 pb-1 text-xs text-slate-400`}>
                  {head("name", "Nome", "pl-7")}
                  {head("assignees", "Responsáveis")}
                  <span>Status</span>
                  {head("priority", "Prioridade")}
                  {head("due", "Prazo")}
                  {social && (
                    <>
                      <span className="pl-4">Redes</span>
                      {head("impressions", "Alcance", "justify-end pr-2")}
                      {head("likes", "Engajamento", "justify-end pr-2")}
                      {head("engagement", "Taxa %", "justify-end pr-2")}
                    </>
                  )}
                  {campaign && (
                    <>
                      <span className="pl-1">Mídia</span>
                      {head("c_impressions", "Impressões", "justify-end pr-2")}
                      {head("c_clicks", "Cliques", "justify-end pr-2")}
                      {head("c_cpc", "CPC", "justify-end pr-2")}
                      {head("c_spend", "Gasto", "justify-end pr-2")}
                    </>
                  )}
                  <span />
                </div>
                {group.map((task) => (
                  <Fragment key={task.id}>
                  <div
                    className={`group grid ${cols} items-center border-b px-2 py-1.5 text-sm hover:bg-slate-50`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <CompleteToggle done={isDone} color={status.color} onToggle={() => actions.toggleDone(task.id)} />
                      <button
                        onClick={() => actions.open(task.id)}
                        className={`flex min-w-0 items-center gap-2 truncate text-left hover:text-violet-700 ${
                          isDone && !social ? "text-slate-400 line-through" : ""
                        }`}
                      >
                        {social && <PostCover media={task.media} />}
                        {task.source === "form" && (
                          <span className="mr-1" title={`Briefing de ${task.requester_name ?? "solicitante"}`}>
                            📝
                          </span>
                        )}
                        {task.title}
                      </button>
                    </div>
                    <AssigneePicker
                      value={task.assignees}
                      members={members}
                      onToggle={(userId, on) => actions.assign(task.id, userId, on)}
                    />
                    <div className="min-w-0 pr-2">
                      <StatusPicker
                        statuses={statuses}
                        value={task.status_id}
                        onChange={(status_id) => actions.update(task.id, { status_id })}
                      />
                    </div>
                    <PriorityPicker value={task.priority} onChange={(priority) => actions.update(task.id, { priority })} />
                    <DuePicker
                      value={task.due_date}
                      done={isDone}
                      onChange={(due_date) => actions.update(task.id, { due_date })}
                      recurrence={task.recurrence}
                      onRecurrenceChange={(recurrence) => actions.update(task.id, { recurrence })}
                    />
                    {social && (
                      <ContentCells
                        channels={social.filter((c) => c.task_id === task.id)}
                        expanded={openChannels.has(task.id)}
                        onToggle={() => toggleChannels(task.id)}
                      />
                    )}
                    {campaign && (
                      <CampaignCells
                        taskId={task.id}
                        title={task.title}
                        results={campaign.results.filter((r) => r.task_id === task.id)}
                        onSaved={campaign.onSaved}
                      />
                    )}
                    <button
                      title="Excluir"
                      aria-label="Excluir tarefa"
                      onClick={() => actions.remove(task.id)}
                      className="invisible text-slate-400 hover:text-red-600 group-hover:visible"
                    >
                      🗑
                    </button>
                  </div>
                  {social && openChannels.has(task.id) && (
                    <ChannelRows channels={social.filter((c) => c.task_id === task.id)} cols={cols} />
                  )}
                  </Fragment>
                ))}
                <NewTaskInput
                  className="block w-full px-2 py-1.5"
                  onCreate={async (text) => {
                    const p = parseQuick(text, members);
                    if (!p.title) return;
                    await actions.create(p.title, status.id, { due_date: p.due, priority: p.priority, recurrence: p.recurrence }, p.assignees);
                  }}
                />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

