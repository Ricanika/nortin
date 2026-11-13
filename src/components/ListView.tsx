"use client";

import { Fragment, useState } from "react";
import { parseQuick } from "@/lib/quickParse";
import type { Status, Task } from "@/lib/types";
import type { TaskActions } from "./ListScreen";
import { CompleteToggle, DuePicker, PriorityPicker, StatusPicker } from "./InlineEditors";
import { AssigneePicker, NewTaskInput } from "./TaskBits";
import { useWorkspace } from "./WorkspaceContext";
import { CampaignCells } from "./CampaignResults";
import type { CampaignResult } from "@/lib/campaign";
import type { SocialChannel } from "@/lib/social";
import { ChannelRows, ContentCells } from "./ContentMetrics";
import PostCover from "./PostCover";

const COLS = "grid-cols-[minmax(200px,1fr)_96px_130px_100px_96px_32px] min-w-[700px]";
// Lista de campanha: + Plataformas, Impressões, Cliques, CPC, Gasto (larguras iguais às do CampaignCells)
const COLS_CAMPAIGN =
  "grid-cols-[minmax(200px,1fr)_96px_130px_100px_96px_52px_84px_72px_78px_96px_32px] min-w-[1130px]";
// Lista de conteúdo: + Redes, Impressões, Curtidas, Engajamento (soma dos canais; ▸ abre por canal)
const COLS_CONTENT =
  "grid-cols-[minmax(200px,1fr)_96px_130px_100px_96px_150px_90px_80px_90px_32px] min-w-[1080px]";

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

  return (
    <div className="space-y-6 p-4 pb-28 sm:p-6">
      {statuses.map((status) => {
        const group = tasks.filter((t) => t.status_id === status.id);
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
                  <span className="pl-7">Nome</span>
                  <span>Responsáveis</span>
                  <span>Status</span>
                  <span>Prioridade</span>
                  <span>Prazo</span>
                  {social && (
                    <>
                      <span className="pl-4">Redes</span>
                      <span className="pr-2 text-right">Impressões</span>
                      <span className="pr-2 text-right">Curtidas</span>
                      <span className="pr-2 text-right" title="(curtidas + comentários + compartilhamentos) ÷ impressões">
                        Engajam.
                      </span>
                    </>
                  )}
                  {campaign && (
                    <>
                      <span className="pl-1">Mídia</span>
                      <span className="pr-2 text-right">Impressões</span>
                      <span className="pr-2 text-right">Cliques</span>
                      <span className="pr-2 text-right">CPC</span>
                      <span className="pr-2 text-right">Gasto</span>
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

