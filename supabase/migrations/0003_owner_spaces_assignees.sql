-- Fase 2: só o dono do workspace mexe em Spaces; responsáveis por tarefa; membros por e-mail.

create function public.is_owner(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid() and role = 'owner'
  );
$$;

revoke execute on function public.is_owner(uuid) from public, anon;
grant execute on function public.is_owner(uuid) to authenticated;

-- Spaces: todos os membros enxergam, só o dono cria, edita e exclui.
drop policy spaces_member on public.spaces;
create policy spaces_select on public.spaces for select using (public.is_member(workspace_id));
create policy spaces_insert on public.spaces for insert with check (public.is_owner(workspace_id));
create policy spaces_update on public.spaces for update
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
create policy spaces_delete on public.spaces for delete using (public.is_owner(workspace_id));

-- Responsável precisa ser membro do workspace da tarefa.
create function public.task_assignees_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from workspace_members where workspace_id = new.workspace_id and user_id = new.user_id
  ) then
    raise exception 'Responsável não é membro deste workspace';
  end if;
  return new;
end;
$$;

-- Roda depois de task_assignees_ws (ordem alfabética), que já preencheu workspace_id.
create trigger task_assignees_zcheck before insert or update on public.task_assignees
  for each row execute function public.task_assignees_check();

revoke execute on function public.task_assignees_check() from public, anon, authenticated;

-- O dono não pode ser removido nem rebaixado.
create function public.protect_owner() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner') then
    raise exception 'O dono do workspace não pode ser removido';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger workspace_members_protect_owner before update or delete on public.workspace_members
  for each row execute function public.protect_owner();

revoke execute on function public.protect_owner() from public, anon, authenticated;

-- Admin adiciona alguém que já tem conta, pelo e-mail.
create function public.add_member_by_email(p_workspace uuid, p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  if not public.is_admin(p_workspace) then
    raise exception 'Apenas o dono ou administradores podem adicionar membros';
  end if;

  select id into v_user from profiles where lower(email) = lower(trim(p_email));
  if v_user is null then
    return 'not_found';
  end if;

  insert into workspace_members (workspace_id, user_id, role)
  values (p_workspace, v_user, 'member')
  on conflict (workspace_id, user_id) do nothing;
  return 'added';
end;
$$;

revoke execute on function public.add_member_by_email(uuid, text) from public, anon;
grant execute on function public.add_member_by_email(uuid, text) to authenticated;

create index on public.task_assignees (user_id);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.task_assignees;
  end if;
end $$;
