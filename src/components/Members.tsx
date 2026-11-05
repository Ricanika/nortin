"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { memberName, type Role } from "@/lib/types";
import { Avatar } from "./TaskBits";
import { useWorkspace } from "./WorkspaceContext";

const ROLE_LABEL: Record<Role, string> = {
  owner: "Dono",
  admin: "Administrador",
  member: "Membro",
  guest: "Convidado",
};

export default function Members() {
  const { workspace, members, me, role } = useWorkspace();
  const router = useRouter();
  const isOwner = role === "owner";
  const isAdmin = role === "owner" || role === "admin";

  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  if (!isAdmin) {
    return <p className="p-6 text-sm text-slate-500">Apenas o dono e administradores gerenciam membros.</p>;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setMsg(null);
    const { data, error } = await createClient().rpc("add_member_by_email", {
      p_workspace: workspace.id,
      p_email: email.trim(),
    });
    setBusy(false);
    if (error) return setMsg({ tone: "err", text: error.message });
    if (data === "not_found") {
      return setMsg({
        tone: "err",
        text: `Ainda não existe conta com ${email.trim()}. Peça para a pessoa se cadastrar no Hyak Group com esse e-mail e depois adicione de novo.`,
      });
    }
    setMsg({ tone: "ok", text: `${email.trim()} agora faz parte do workspace.` });
    setEmail("");
    router.refresh();
  }

  async function changeRole(userId: string, newRole: Role) {
    const { error } = await createClient()
      .from("workspace_members")
      .update({ role: newRole })
      .eq("workspace_id", workspace.id)
      .eq("user_id", userId);
    if (error) return setMsg({ tone: "err", text: error.message });
    router.refresh();
  }

  async function remove(userId: string) {
    setConfirmRemove(null);
    const { error } = await createClient()
      .from("workspace_members")
      .delete()
      .eq("workspace_id", workspace.id)
      .eq("user_id", userId);
    if (error) return setMsg({ tone: "err", text: error.message });
    router.refresh();
  }

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-3xl space-y-8 p-6">
        <header>
          <h1 className="text-lg font-semibold">Membros de {workspace.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Membros veem todos os Spaces, criam listas e tarefas e podem ser marcados como responsáveis.
            Só o dono cria, renomeia e exclui Spaces.
          </p>
        </header>

        <form onSubmit={add} className="space-y-2">
          <label htmlFor="member-email" className="text-sm font-medium">
            Adicionar pessoa
          </label>
          <div className="flex flex-wrap gap-2">
            <input
              id="member-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@empresa.com.br"
              className="min-w-0 flex-1 rounded-md border px-3 py-2 text-sm outline-none focus:border-violet-500"
            />
            <button
              disabled={busy}
              className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              {busy ? "Adicionando…" : "Adicionar"}
            </button>
          </div>
          <p className="text-xs text-slate-400">A pessoa precisa ter criado a conta no Hyak Group antes.</p>
          {msg && (
            <p className={`text-sm ${msg.tone === "ok" ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>
          )}
        </form>

        <ul className="divide-y rounded-lg border">
          {members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <Avatar member={m} size={32} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">
                  {memberName(m)} {m.user_id === me && <span className="text-slate-400">(você)</span>}
                </div>
                <div className="truncate text-xs text-slate-500">{m.email}</div>
              </div>

              {m.role === "owner" || !isOwner ? (
                <span className="text-xs text-slate-500">{ROLE_LABEL[m.role]}</span>
              ) : (
                <select
                  value={m.role}
                  onChange={(e) => changeRole(m.user_id, e.target.value as Role)}
                  className="rounded border px-2 py-1 text-xs"
                  aria-label={`Papel de ${memberName(m)}`}
                >
                  <option value="member">Membro</option>
                  <option value="admin">Administrador</option>
                </select>
              )}

              {m.role !== "owner" &&
                (confirmRemove === m.user_id ? (
                  <span className="flex items-center gap-2 text-xs">
                    Remover?
                    <button onClick={() => remove(m.user_id)} className="font-semibold text-red-600">
                      Sim
                    </button>
                    <button onClick={() => setConfirmRemove(null)} className="text-slate-500">
                      Não
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmRemove(m.user_id)}
                    className="text-xs text-slate-400 hover:text-red-600"
                  >
                    Remover
                  </button>
                ))}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
