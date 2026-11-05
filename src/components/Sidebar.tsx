"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { List, Space, Workspace } from "@/lib/types";
import { useWorkspace } from "./WorkspaceContext";

const SPACE_COLORS = ["#7c3aed", "#2563eb", "#059669", "#d97706", "#db2777", "#0891b2"];

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
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState<{ kind: "space" } | { kind: "list"; spaceId: string } | null>(
    null,
  );
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const supabase = createClient();
    Promise.all([
      supabase.from("spaces").select("*").eq("workspace_id", workspace.id).order("position"),
      supabase.from("lists").select("*").eq("workspace_id", workspace.id).order("position"),
    ]).then(([s, l]) => {
      setSpaces((s.data as Space[]) ?? []);
      setLists((l.data as List[]) ?? []);
    });
  }, [workspace.id]);

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

  const draftInput = (
    <form onSubmit={submitDraft}>
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setAdding(null);
          setDraft("");
        }}
        onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
        placeholder={adding?.kind === "space" ? "Nome do Space" : "Nome da lista"}
        className="w-full rounded border border-violet-400 bg-white px-2 py-1 text-sm outline-none"
      />
    </form>
  );

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

        {spaces.map((space) => (
          <div key={space.id}>
            <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-slate-200">
              <button
                onClick={() => setCollapsed({ ...collapsed, [space.id]: !collapsed[space.id] })}
                className="flex flex-1 items-center gap-2 text-left"
              >
                <span
                  className="flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold text-white"
                  style={{ background: space.color }}
                >
                  {space.name[0]?.toUpperCase()}
                </span>
                <span className="truncate font-medium">{space.name}</span>
              </button>
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

            {!collapsed[space.id] && (
              <div className="ml-4 space-y-0.5 border-l pl-2">
                {lists
                  .filter((l) => l.space_id === space.id)
                  .map((list) => {
                    const href = `/w/${workspace.id}/l/${list.id}`;
                    const active = pathname.startsWith(href);
                    return (
                      <Link
                        key={list.id}
                        href={href}
                        className={`block truncate rounded-md px-2 py-1 text-sm ${
                          active ? "bg-violet-100 font-medium text-violet-700" : "hover:bg-slate-200"
                        }`}
                      >
                        {list.name}
                      </Link>
                    );
                  })}
                {adding?.kind === "list" && adding.spaceId === space.id && draftInput}
              </div>
            )}
          </div>
        ))}

        {adding?.kind === "space" && <div className="px-2">{draftInput}</div>}
      </nav>

      <form action="/auth/signout" method="post" className="border-t p-3 text-xs text-slate-500">
        <div className="truncate">{userEmail}</div>
        <button className="mt-1 text-violet-600 hover:underline">Sair</button>
      </form>
    </aside>
  );
}
