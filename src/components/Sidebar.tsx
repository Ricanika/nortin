"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { notifyStructureChanged, STRUCTURE_EVENT } from "@/lib/tasks";
import type { List, Space, Workspace } from "@/lib/types";
import Popover from "./Popover";
import { useToast } from "./Toast";
import { useWorkspace } from "./WorkspaceContext";

const SPACE_COLORS = ["#7c3aed", "#2563eb", "#059669", "#d97706", "#db2777", "#0891b2"];

type Editing = { kind: "space" | "list"; id: string } | null;

export default function Sidebar({
  workspaces,
  userEmail,
}: {
  workspaces: Workspace[];
  userEmail: string;
}) {
  const { workspace, role } = useWorkspace();
  const isOwner = role === "owner";
  const isAdmin = role === "owner" || role === "admin";
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState<{ kind: "space" } | { kind: "list"; spaceId: string } | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [draft, setDraft] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [openCounts, setOpenCounts] = useState<Record<string, number>>({});

  // Contador ao lado de cada lista: tarefas em aberto (sem subtarefas e sem concluídas)
  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout>;
    const loadCounts = async () => {
      const { data } = await supabase
        .from("tasks")
        .select("list_id, statuses(type)")
        .eq("workspace_id", workspace.id)
        .is("parent_task_id", null)
        .limit(10000);
      const counts: Record<string, number> = {};
      for (const t of data ?? []) {
        const type = (t.statuses as unknown as { type: string } | null)?.type;
        if (type === "done" || type === "closed") continue;
        counts[t.list_id] = (counts[t.list_id] ?? 0) + 1;
      }
      setOpenCounts(counts);
    };
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(loadCounts, 600);
    };
    loadCounts();
    const channel = supabase
      .channel(`sidebar-counts:${workspace.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `workspace_id=eq.${workspace.id}` }, reload)
      // DELETE não aceita filtro no Supabase Realtime
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "tasks" }, reload)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [workspace.id]);

  useEffect(() => {
    const supabase = createClient();
    const load = () =>
      Promise.all([
        supabase.from("spaces").select("*").eq("workspace_id", workspace.id).order("position"),
        supabase.from("lists").select("*").eq("workspace_id", workspace.id).order("position"),
      ]).then(([s, l]) => {
        setSpaces((s.data as Space[]) ?? []);
        setLists((l.data as List[]) ?? []);
      });
    load();
    // Desarquivar pelo aviso da própria lista também atualiza a barra
    window.addEventListener(STRUCTURE_EVENT, load);
    return () => window.removeEventListener(STRUCTURE_EVENT, load);
  }, [workspace.id]);

  const activeSpaces = spaces.filter((s) => !s.archived_at);
  const archivedSpaces = spaces.filter((s) => s.archived_at);
  const archivedLists = lists.filter((l) => l.archived_at && !spaces.find((s) => s.id === l.space_id)?.archived_at);
  const archivedCount = archivedSpaces.length + archivedLists.length;

  async function submitDraft(e: React.FormEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (!name || !adding) return;
    const supabase = createClient();

    if (adding.kind === "space") {
      const { data } = await supabase
        .from("spaces")
        .insert({
          workspace_id: workspace.id,
          name,
          color: SPACE_COLORS[spaces.length % SPACE_COLORS.length],
          position: (spaces.at(-1)?.position ?? 0) + 1000,
        })
        .select()
        .single();
      if (data) setSpaces([...spaces, data as Space]);
    } else {
      const siblings = lists.filter((l) => l.space_id === adding.spaceId);
      const { data } = await supabase
        .from("lists")
        .insert({ space_id: adding.spaceId, name, position: (siblings.at(-1)?.position ?? 0) + 1000 })
        .select()
        .single();
      if (data) {
        setLists([...lists, data as List]);
        router.push(`/w/${workspace.id}/l/${data.id}`);
      }
    }
    setAdding(null);
    setDraft("");
  }

  async function submitRename(e: React.FormEvent) {
    e.preventDefault();
    const name = draft.trim();
    const target = editing;
    setEditing(null);
    setDraft("");
    if (!name || !target) return;
    const table = target.kind === "space" ? "spaces" : "lists";
    const { error } = await createClient().from(table).update({ name }).eq("id", target.id);
    if (error) return toast(`Não deu para renomear: ${error.message}`);
    if (target.kind === "space") setSpaces((prev) => prev.map((s) => (s.id === target.id ? { ...s, name } : s)));
    else setLists((prev) => prev.map((l) => (l.id === target.id ? { ...l, name } : l)));
    router.refresh();
  }

  // Arquivar nunca apaga: some da barra e das visões, e volta com "Desarquivar".
  async function setSpaceArchived(space: Space, archived: boolean, silent = false) {
    const stamp = archived ? new Date().toISOString() : null;
    setSpaces((prev) => prev.map((s) => (s.id === space.id ? { ...s, archived_at: stamp } : s)));
    const { error } = await createClient().rpc("set_space_archived", { p_space: space.id, p_archived: archived });
    if (error) {
      setSpaces((prev) => prev.map((s) => (s.id === space.id ? space : s)));
      return toast(`Não deu para ${archived ? "arquivar" : "desarquivar"}: ${error.message}`);
    }
    if (!silent) {
      toast(archived ? `Space "${space.name}" arquivado` : `Space "${space.name}" de volta`, {
        undo: () => void setSpaceArchived({ ...space, archived_at: stamp }, !archived, true),
      });
    }
    notifyStructureChanged();
  }

  async function setListArchived(list: List, archived: boolean, silent = false) {
    const stamp = archived ? new Date().toISOString() : null;
    setLists((prev) => prev.map((l) => (l.id === list.id ? { ...l, archived_at: stamp } : l)));
    const { error } = await createClient().from("lists").update({ archived_at: stamp }).eq("id", list.id);
    if (error) {
      setLists((prev) => prev.map((l) => (l.id === list.id ? list : l)));
      return toast(`Não deu para ${archived ? "arquivar" : "desarquivar"}: ${error.message}`);
    }
    if (!silent) {
      toast(archived ? `Lista "${list.name}" arquivada` : `Lista "${list.name}" de volta`, {
        undo: () => void setListArchived({ ...list, archived_at: stamp }, !archived, true),
      });
    }
    notifyStructureChanged();
  }

  const nameInput = (placeholder: string, onSubmit: (e: React.FormEvent) => void, cancel: () => void) => (
    <form onSubmit={onSubmit}>
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          cancel();
          setDraft("");
        }}
        onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
        placeholder={placeholder}
        className="w-full rounded border border-violet-400 bg-white px-2 py-1 text-sm outline-none"
      />
    </form>
  );
  const addInput = nameInput(adding?.kind === "space" ? "Nome do Space" : "Nome da lista", submitDraft, () => setAdding(null));
  const renameInput = nameInput("Novo nome", submitRename, () => setEditing(null));

  const menuItem = "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50";
  const startRename = (kind: "space" | "list", id: string, current: string, close: () => void) => {
    close();
    setDraft(current);
    setEditing({ kind, id });
  };

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r bg-slate-50">
      <div className="border-b p-3">
        <select
          value={workspace.id}
          onChange={(e) => router.push(`/w/${e.target.value}`)}
          className="w-full rounded-md bg-transparent px-1 py-1 text-sm font-semibold outline-none hover:bg-slate-200"
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {[
          { href: `/w/${workspace.id}`, label: "Meu dia", icon: "☀️", show: true },
          { href: `/w/${workspace.id}/me`, label: "Minhas tarefas", icon: "◎", show: true },
          { href: `/w/${workspace.id}/gestao`, label: "Gestão", icon: "📊", show: isAdmin },
          { href: `/w/${workspace.id}/members`, label: "Membros", icon: "👥", show: isAdmin },
        ]
          .filter((item) => item.show)
          .map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                pathname === item.href ? "bg-violet-100 font-medium text-violet-700" : "hover:bg-slate-200"
              }`}
            >
              <span className="w-5 text-center">{item.icon}</span>
              {item.label}
            </Link>
          ))}

        <div className="flex items-center justify-between px-2 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-slate-400">
          Spaces
          {isOwner && (
            <button
              title="Novo Space"
              onClick={() => setAdding({ kind: "space" })}
              className="rounded px-1 text-base leading-none hover:bg-slate-200 hover:text-slate-700"
            >
              +
            </button>
          )}
        </div>

        {activeSpaces.map((space) => (
          <div key={space.id}>
            {editing?.kind === "space" && editing.id === space.id ? (
              <div className="px-2 py-1">{renameInput}</div>
            ) : (
              <div className="group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm hover:bg-slate-200">
                <button
                  onClick={() => setCollapsed({ ...collapsed, [space.id]: !collapsed[space.id] })}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold text-white"
                    style={{ background: space.color }}
                  >
                    {space.name[0]?.toUpperCase()}
                  </span>
                  <span className="truncate font-medium">{space.name}</span>
                </button>
                <Popover
                  label={`Opções de ${space.name}`}
                  width={200}
                  triggerClassName="invisible rounded px-1 leading-none text-slate-500 hover:bg-slate-300 group-hover:visible aria-expanded:visible"
                  trigger="⋯"
                >
                  {(close) => (
                    <>
                      {isOwner && (
                        <button className={menuItem} onClick={() => startRename("space", space.id, space.name, close)}>
                          ✏️ Renomear
                        </button>
                      )}
                      <button
                        className={menuItem}
                        onClick={() => {
                          close();
                          void setSpaceArchived(space, true);
                        }}
                      >
                        📦 Arquivar Space
                      </button>
                    </>
                  )}
                </Popover>
                <button
                  title="Nova lista"
                  onClick={() => {
                    setCollapsed({ ...collapsed, [space.id]: false });
                    setAdding({ kind: "list", spaceId: space.id });
                  }}
                  className="invisible rounded px-1 leading-none text-slate-500 hover:bg-slate-300 group-hover:visible"
                >
                  +
                </button>
              </div>
            )}

            {!collapsed[space.id] && (
              <div className="ml-4 space-y-0.5 border-l pl-2">
                {lists
                  .filter((l) => l.space_id === space.id && !l.archived_at)
                  .map((list) => {
                    if (editing?.kind === "list" && editing.id === list.id) return <div key={list.id}>{renameInput}</div>;
                    const href = `/w/${workspace.id}/l/${list.id}`;
                    const active = pathname.startsWith(href);
                    return (
                      <div
                        key={list.id}
                        className={`group flex items-center rounded-md text-sm ${
                          active ? "bg-violet-100 font-medium text-violet-700" : "hover:bg-slate-200"
                        }`}
                      >
                        <Link href={href} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1">
                          <svg
                            viewBox="0 0 16 16"
                            className="h-3.5 w-3.5 shrink-0 text-slate-400"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            aria-hidden="true"
                          >
                            <path d="M2 4l1.2 1.2L5.5 3M2 9l1.2 1.2L5.5 8M8 4.2h6M8 9.2h6M8 13h6M2.5 13h2" />
                          </svg>
                          <span className="truncate">{list.name}</span>
                          {openCounts[list.id] ? (
                            <span className="ml-auto shrink-0 text-xs font-normal tabular-nums text-slate-400 group-hover:hidden">
                              {openCounts[list.id]}
                            </span>
                          ) : null}
                        </Link>
                        <Popover
                          label={`Opções de ${list.name}`}
                          width={190}
                          triggerClassName="invisible mr-1 rounded px-1 leading-none text-slate-500 hover:bg-slate-300 group-hover:visible aria-expanded:visible"
                          trigger="⋯"
                        >
                          {(close) => (
                            <>
                              <button className={menuItem} onClick={() => startRename("list", list.id, list.name, close)}>
                                ✏️ Renomear
                              </button>
                              <button
                                className={menuItem}
                                onClick={() => {
                                  close();
                                  void setListArchived(list, true);
                                }}
                              >
                                📦 Arquivar lista
                              </button>
                            </>
                          )}
                        </Popover>
                      </div>
                    );
                  })}
                {adding?.kind === "list" && adding.spaceId === space.id && addInput}
              </div>
            )}
          </div>
        ))}

        {adding?.kind === "space" && <div className="px-2">{addInput}</div>}

        {archivedCount > 0 && (
          <div className="pt-3">
            <button
              onClick={() => setShowArchived(!showArchived)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium uppercase tracking-wide text-slate-400 hover:bg-slate-200"
              aria-expanded={showArchived}
            >
              <span>{showArchived ? "▾" : "▸"}</span> 📦 Arquivados ({archivedCount})
            </button>
            {showArchived && (
              <div className="mt-1 space-y-0.5">
                {archivedSpaces.map((space) => (
                  <div key={space.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-500">
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold text-white opacity-60"
                      style={{ background: space.color }}
                    >
                      {space.name[0]?.toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{space.name}</span>
                    <button
                      onClick={() => void setSpaceArchived(space, false)}
                      className="shrink-0 text-xs font-medium text-violet-600 hover:underline"
                    >
                      Desarquivar
                    </button>
                  </div>
                ))}
                {archivedLists.map((list) => (
                  <div key={list.id} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-slate-500">
                    <Link href={`/w/${workspace.id}/l/${list.id}`} className="min-w-0 flex-1 truncate hover:text-slate-700">
                      <span className="text-xs text-slate-400">{spaces.find((s) => s.id === list.space_id)?.name} / </span>
                      {list.name}
                    </Link>
                    <button
                      onClick={() => void setListArchived(list, false)}
                      className="shrink-0 text-xs font-medium text-violet-600 hover:underline"
                    >
                      Desarquivar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </nav>

      <form action="/auth/signout" method="post" className="border-t p-3 text-xs text-slate-500">
        <div className="truncate">{userEmail}</div>
        <button className="mt-1 text-violet-600 hover:underline">Sair</button>
      </form>
    </aside>
  );
}
