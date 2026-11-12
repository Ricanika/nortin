import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { memberName } from "@/lib/types";

export interface PublicForm {
  listId: string;
  listName: string;
  spaceName: string;
  workspaceId: string;
  members: { id: string; name: string }[];
}

/** Formulário ativo pelo código do link; null se o link não existe ou foi desativado. */
export async function loadPublicForm(token: string): Promise<PublicForm | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const db = createAdminClient();
  const { data: list } = await db
    .from("lists")
    .select("id, name, workspace_id, form_enabled, archived_at, spaces(name, archived_at)")
    .eq("form_token", token)
    .maybeSingle();
  const space = list?.spaces as unknown as { name: string; archived_at: string | null } | null;
  if (!list || !list.form_enabled || list.archived_at || space?.archived_at) return null;

  const { data: rows } = await db
    .from("workspace_members")
    .select("user_id, profiles(email, full_name)")
    .eq("workspace_id", list.workspace_id);
  const members = (rows ?? [])
    .map((m) => ({ id: m.user_id, name: memberName(m.profiles as unknown as { email: string | null; full_name: string | null }) }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return { listId: list.id, listName: list.name, spaceName: space?.name ?? "", workspaceId: list.workspace_id, members };
}
