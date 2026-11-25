"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { notifyStructureChanged, STRUCTURE_EVENT } from "@/lib/tasks";
import { formUrl, type List, type Space, type SpaceGroup, type Workspace } from "@/lib/types";
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
  // Celular: o menu vira uma gaveta, aberta pelo ☰ da barra do topo
  const [mobileOpen, setMobileOpen] = useState(false);
  const [groups, setGroups] = useState<SpaceGroup[]>([]);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const toggleGroup = (id: string) => setCollapsedGroups((c) => ({ ...c, [id]: !c[id] }));
  useEffect(() => setMobileOpen(false), [pathname]);

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
        supabase.from("space_groups").select("*").eq("workspace_id", workspace.id).order("position"),
      ]).then(([s, l, g]) => {
        setSpaces((s.data as Space[]) ?? []);
        setLists((l.data as List[]) ?? []);
        setGroups((g.data as SpaceGroup[]) ?? []);
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

  // Pastas (acima dos Spaces): só o dono organiza
  async function createGroup(): Promise<string | null> {
    const name = window.prompt("Nome da nova pasta (ex.: Marketing, Comercial)")?.trim();
    if (!name) return null;
    const { data, error } = await createClient()
      .from("space_groups")
      .insert({ workspace_id: workspace.id, name, position: (groups.at(-1)?.position ?? 0) + 1000 })
      .select()
      .single();
    if (error) {
      toast(`Não deu para criar a pasta: ${error.message}`);
      return null;
    }
    setGroups((prev) => [...prev, data as SpaceGroup]);
    return (data as SpaceGroup).id;
  }
  async function renameGroup(g: SpaceGroup) {
    const name = window.prompt("Novo nome da pasta", g.name)?.trim();
    if (!name || name === g.name) return;
    const { error } = await createClient().from("space_groups").update({ name }).eq("id", g.id);
    if (error) return toast(`Não deu para renomear: ${error.message}`);
    setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, name } : x)));
  }
  async function deleteGroup(g: SpaceGroup) {
    if (!window.confirm(`Excluir a pasta "${g.name}"? Os Spaces dela continuam, só ficam fora de pasta.`)) return;
    const { error } = await createClient().from("space_groups").delete().eq("id", g.id);
    if (error) return toast(`Não deu para excluir: ${error.message}`);
    setGroups((prev) => prev.filter((x) => x.id !== g.id));
    setSpaces((prev) => prev.map((s) => (s.group_id === g.id ? { ...s, group_id: null } : s)));
  }
  async function moveSpaceToGroup(space: Space, groupId: string | null) {
    const before = space.group_id;
    setSpaces((prev) => prev.map((s) => (s.id === space.id ? { ...s, group_id: groupId } : s)));
    const { error } = await createClient().from("spaces").update({ group_id: groupId }).eq("id", space.id);
    if (error) {
      setSpaces((prev) => prev.map((s) => (s.id === space.id ? { ...s, group_id: before } : s)));
      return toast(`Não deu para mover: ${error.message}`);
    }
    toast(groupId ? `"${space.name}" foi para a pasta ${groups.find((g) => g.id === groupId)?.name ?? ""}` : `"${space.name}" saiu da pasta`);
  }
  async function moveListToSpace(list: List, space: Space) {
    setLists((prev) => prev.map((l) => (l.id === list.id ? { ...l, space_id: space.id } : l)));
    const { error } = await createClient().from("lists").update({ space_id: space.id, folder_id: null }).eq("id", list.id);
    if (error) {
      setLists((prev) => prev.map((l) => (l.id === list.id ? list : l)));
      return toast(`Não deu para mover a lista: ${error.message}`);
    }
    setCollapsed((c) => ({ ...c, [space.id]: false }));
    toast(`Lista "${list.name}" agora está em ${space.name}`);
    notifyStructureChanged();
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

  // Lista de campanha ganha as colunas de resultado (Google/Meta); voltar não apaga os números
  async function setListKind(list: List, kind: List["kind"]) {
    setLists((prev) => prev.map((l) => (l.id === list.id ? { ...l, kind } : l)));
    // Conteúdo passa pela função do banco: lista vazia ganha as etapas de produção de post
    const { error } =
      kind === "content"
        ? await createClient().rpc("make_content_list", { p_list: list.id })
        : kind === "pdv"
          ? await createClient().rpc("make_pdv_list", { p_list: list.id })
          : kind === "launch"
            ? await createClient().rpc("make_launch_list", { p_list: list.id })
          : await createClient().from("lists").update({ kind }).eq("id", list.id);
    if (error) {
      setLists((prev) => prev.map((l) => (l.id === list.id ? list : l)));
      return toast(`Não deu para mudar a lista: ${error.message}`);
    }
    toast(
      kind === "campaign"
        ? `"${list.name}" agora é lista de campanha 📈`
        : kind === "content"
          ? `"${list.name}" agora é lista de conteúdo 📱`
          : kind === "pdv"
            ? `"${list.name}" agora é lista de PDV 🏪`
            : kind === "launch"
              ? `"${list.name}" agora é lista de lançamento de produtos 🚀`
          : `"${list.name}" voltou a ser lista comum`,
    );
    notifyStructureChanged();
  }

  async function copyFormLink(token: string) {
    try {
      await navigator.clipboard.writeText(formUrl(token));
      toast("Link do formulário copiado 📝");
    } catch {
      toast(`Link do formulário: ${formUrl(token)}`);
    }
  }

  // Formulário de briefing: link público para quem não tem conta pedir demandas nesta lista
  async function setListForm(list: List, on: boolean) {
    const supabase = createClient();
    if (on) {
      const { data: token, error } = await supabase.rpc("enable_list_form", { p_list: list.id });
      if (error || !token) return toast(`Não deu para ativar: ${error?.message ?? "tente de novo"}`);
      setLists((prev) => prev.map((l) => (l.id === list.id ? { ...l, form_enabled: true, form_token: token as string } : l)));
      await copyFormLink(token as string);
    } else {
      const { error } = await supabase.from("lists").update({ form_enabled: false }).eq("id", list.id);
      if (error) return toast(`Não deu para desativar: ${error.message}`);
      setLists((prev) => prev.map((l) => (l.id === list.id ? { ...l, form_enabled: false } : l)));
      toast("Formulário desativado: o link parou de funcionar");
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

  const renderSpace = (space: Space) => (
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
                      {isOwner && (
                        <div className="border-y py-1">
                          <div className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">📁 Mover para pasta</div>
                          {groups
                            .filter((g) => g.id !== space.group_id)
                            .map((g) => (
                              <button
                                key={g.id}
                                className={menuItem}
                                onClick={() => {
                                  close();
                                  void moveSpaceToGroup(space, g.id);
                                }}
                              >
                                ↳ {g.name}
                              </button>
                            ))}
                          {space.group_id && (
                            <button
                              className={menuItem}
                              onClick={() => {
                                close();
                                void moveSpaceToGroup(space, null);
                              }}
                            >
                              ↳ Sem pasta
                            </button>
                          )}
                          <button
                            className={menuItem}
                            onClick={async () => {
                              close();
                              const id = await createGroup();
                              if (id) void moveSpaceToGroup(space, id);
                            }}
                          >
                            ＋ Nova pasta…
                          </button>
                        </div>
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
                        <Link href={href} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 md:py-1">
                          {list.kind !== "tasks" ? (
                            <span
                              className="w-3.5 shrink-0 text-center text-xs"
                              title={list.kind === "campaign" ? "Lista de campanha" : list.kind === "pdv" ? "Lista de PDV" : list.kind === "launch" ? "Lançamento de produtos" : "Lista de conteúdo"}
                            >
                              {list.kind === "campaign" ? "📈" : list.kind === "pdv" ? "🏪" : list.kind === "launch" ? "🚀" : "📱"}
                            </span>
                          ) : (
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
                          )}
                          <span className="truncate">{list.name}</span>
                          {openCounts[list.id] ? (
                            <span className="ml-auto shrink-0 text-xs font-normal tabular-nums text-slate-400 group-hover:hidden">
                              {openCounts[list.id]}
                            </span>
                          ) : null}
                        </Link>
                        <Popover
                          label={`Opções de ${list.name}`}
                          width={230}
                          triggerClassName="invisible mr-1 rounded px-1 leading-none text-slate-500 hover:bg-slate-300 group-hover:visible aria-expanded:visible"
                          trigger="⋯"
                        >
                          {(close) => (
                            <>
                              <button className={menuItem} onClick={() => startRename("list", list.id, list.name, close)}>
                                ✏️ Renomear
                              </button>
                              {(
                                [
                                  ["content", "📱 Tornar lista de conteúdo"],
                                  ["campaign", "📈 Tornar lista de campanha"],
                                  ["pdv", "🏪 Tornar lista de PDV"],
                                  ["launch", "🚀 Tornar lista de lançamento"],
                                  ["tasks", "☰ Voltar a lista comum"],
                                ] as const
                              )
                                .filter(([kind]) => kind !== list.kind)
                                .map(([kind, label]) => (
                                  <button
                                    key={kind}
                                    className={menuItem}
                                    onClick={() => {
                                      close();
                                      void setListKind(list, kind);
                                    }}
                                  >
                                    {label}
                                  </button>
                                ))}
                              {activeSpaces.filter((sp) => sp.id !== list.space_id).length > 0 && (
                                <div className="border-y py-1">
                                  <div className="px-3 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">↪ Mover para o Space</div>
                                  {activeSpaces
                                    .filter((sp) => sp.id !== list.space_id)
                                    .map((sp) => (
                                      <button
                                        key={sp.id}
                                        className={menuItem}
                                        onClick={() => {
                                          close();
                                          void moveListToSpace(list, sp);
                                        }}
                                      >
                                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: sp.color }} />
                                        {sp.name}
                                      </button>
                                    ))}
                                </div>
                              )}
                              {list.form_enabled && list.form_token ? (
                                <>
                                  <button
                                    className={menuItem}
                                    onClick={() => {
                                      close();
                                      void copyFormLink(list.form_token!);
                                    }}
                                  >
                                    📝 Copiar link do briefing
                                  </button>
                                  <button
                                    className={menuItem}
                                    onClick={() => {
                                      close();
                                      void setListForm(list, false);
                                    }}
                                  >
                                    🚫 Desativar formulário
                                  </button>
                                </>
                              ) : (
                                <button
                                  className={menuItem}
                                  onClick={() => {
                                    close();
                                    void setListForm(list, true);
                                  }}
                                >
                                  📝 Ativar formulário de briefing
                                </button>
                              )}
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
  );

  return (
    <>
      {/* Barra do topo, só no celular */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-12 items-center gap-2 border-b bg-white/95 px-2 backdrop-blur md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menu"
          className="flex h-10 w-10 items-center justify-center rounded-lg text-xl text-slate-700 active:bg-slate-100"
        >
          ☰
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" className="h-6 w-6 rounded" />
        <span className="truncate text-sm font-semibold text-slate-800">{workspace.name}</span>
      </div>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={() => setMobileOpen(false)} />}
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shrink-0 flex-col border-r bg-slate-50 shadow-xl transition-transform duration-200 md:static md:z-auto md:w-64 md:translate-x-0 md:shadow-none ${
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="flex items-center gap-1 border-b p-3">
        <button
          onClick={() => setMobileOpen(false)}
          aria-label="Fechar menu"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg text-slate-500 active:bg-slate-200 md:hidden"
        >
          ✕
        </button>
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
          { href: `/w/${workspace.id}/gestao`, label: "Gestão", icon: "📊", show: isAdmin },
          { href: `/w/${workspace.id}/members`, label: "Membros", icon: "👥", show: isAdmin },
        ]
          .filter((item) => item.show)
          .map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded-md px-2 py-2.5 text-sm md:py-1.5 ${
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
            <span className="flex items-center gap-1">
            <button
              title="Nova pasta"
              onClick={() => void createGroup()}
              className="rounded px-1 text-[11px] leading-none hover:bg-slate-200 hover:text-slate-700"
            >
              📁+
            </button>
            <button
              title="Novo Space"
              onClick={() => setAdding({ kind: "space" })}
              className="rounded px-1 text-base leading-none hover:bg-slate-200 hover:text-slate-700"
            >
              +
            </button>
            </span>
          )}
        </div>

        {groups.map((g) => {
          const inGroup = activeSpaces.filter((sp) => sp.group_id === g.id);
          const closed = collapsedGroups[g.id];
          return (
            <div key={g.id} className="pt-1">
              <div className="group flex items-center gap-1 rounded-md px-1 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500 hover:bg-slate-200">
                <button onClick={() => toggleGroup(g.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                  <span className="w-3 text-slate-400">{closed ? "▸" : "▾"}</span>
                  <span>📁</span>
                  <span className="truncate">{g.name}</span>
                  <span className="font-normal text-slate-400">{inGroup.length}</span>
                </button>
                {isOwner && (
                  <Popover
                    label={`Opções da pasta ${g.name}`}
                    width={190}
                    triggerClassName="invisible rounded px-1 leading-none text-slate-500 hover:bg-slate-300 group-hover:visible aria-expanded:visible"
                    trigger="⋯"
                  >
                    {(close) => (
                      <>
                        <button
                          className={menuItem}
                          onClick={() => {
                            close();
                            void renameGroup(g);
                          }}
                        >
                          ✏️ Renomear pasta
                        </button>
                        <button
                          className={menuItem}
                          onClick={() => {
                            close();
                            void deleteGroup(g);
                          }}
                        >
                          🗑 Excluir pasta (os Spaces ficam)
                        </button>
                      </>
                    )}
                  </Popover>
                )}
              </div>
              {!closed && <div className="ml-2">{inGroup.map(renderSpace)}</div>}
            </div>
          );
        })}

        {activeSpaces.filter((sp) => !sp.group_id || !groups.some((g) => g.id === sp.group_id)).map(renderSpace)}

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
    </>
  );
}
