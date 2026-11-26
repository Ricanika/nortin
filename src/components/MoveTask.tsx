"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Popover from "./Popover";
import { useToast } from "./Toast";
import { useWorkspace } from "./WorkspaceContext";

interface Opt {
  id: string;
  name: string;
  space: { id: string; name: string; color: string };
}

/**
 * Move uma ou várias tarefas para outra lista (de qualquer Space do workspace).
 * O status vai para o de mesmo nome na lista nova; se não existir, o do mesmo tipo.
 */
export default function MoveTask({
  taskIds,
  listId,
  onMoved,
  trigger = "↪ Mover",
  triggerClassName = "text-slate-400 hover:text-violet-700",
}: {
  taskIds: string[];
  listId: string;
  onMoved: (ids: string[]) => void;
  trigger?: React.ReactNode;
  triggerClassName?: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const { workspace } = useWorkspace();
  const toast = useToast();
  const [opts, setOpts] = useState<Opt[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    supabase
      .from("lists")
      .select("id, name, archived_at, spaces(id, name, color, archived_at)")
      .eq("workspace_id", workspace.id)
      .is("archived_at", null)
      .order("position")
      .then(({ data }) =>
        setOpts(
          ((data ?? []) as unknown as (Opt & { spaces: Opt["space"] & { archived_at: string | null } })[])
            .filter((l) => l.spaces && !l.spaces.archived_at && l.id !== listId)
            .map((l) => ({ id: l.id, name: l.name, space: l.spaces })),
        ),
      );
  }, [supabase, workspace.id, listId]);

  async function move(o: Opt) {
    const results = await Promise.all(
      taskIds.map((id) => supabase.rpc("move_task", { p_task: id, p_list: o.id }).then(({ error }) => ({ id, error }))),
    );
    const ok = results.filter((r) => !r.error).map((r) => r.id);
    const failed = results.length - ok.length;
    if (ok.length) onMoved(ok);
    toast(
      failed
        ? `${ok.length} movida(s), ${failed} com erro: ${results.find((r) => r.error)?.error?.message}`
        : `${ok.length === 1 ? "Tarefa movida" : `${ok.length} tarefas movidas`} para ${o.space.name} / ${o.name}`,
    );
  }

  const filtered = (opts ?? []).filter((o) => `${o.space.name} ${o.name}`.toLowerCase().includes(q.toLowerCase()));
  const bySpace = [...new Set(filtered.map((o) => o.space.id))].map((id) => ({
    space: filtered.find((o) => o.space.id === id)!.space,
    lists: filtered.filter((o) => o.space.id === id),
  }));

  return (
    <Popover label="Mover para outra lista" width={260} triggerClassName={triggerClassName} trigger={trigger}>
      {(close) => (
        <div className="max-h-80 overflow-y-auto">
          <div className="sticky top-0 border-b bg-white p-2">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar lista…"
              className="w-full rounded border px-2 py-1 text-sm outline-none focus:border-violet-500"
            />
          </div>
          {!opts && <p className="px-3 py-2 text-xs text-slate-400">Carregando…</p>}
          {opts && !filtered.length && <p className="px-3 py-2 text-xs text-slate-400">Nenhuma lista encontrada.</p>}
          {bySpace.map(({ space, lists }) => (
            <div key={space.id} className="py-1">
              <div className="flex items-center gap-1.5 px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <span className="h-2 w-2 rounded-sm" style={{ background: space.color }} />
                {space.name}
              </div>
              {lists.map((o) => (
                <button
                  key={o.id}
                  onClick={() => {
                    close();
                    void move(o);
                  }}
                  className="flex w-full items-center px-3 py-1.5 pl-6 text-left text-sm hover:bg-slate-50"
                >
                  {o.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}
