-- Só o criador do workspace (workspaces.owner_id) pode ter o papel 'owner',
-- e esse papel não pode ser removido nem rebaixado.
create or replace function public.protect_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.user_id <> old.user_id) then
    raise exception 'O dono do workspace não pode ser removido';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'owner'
     and not exists (select 1 from workspaces where id = new.workspace_id and owner_id = new.user_id) then
    raise exception 'Apenas o criador do workspace pode ser dono';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger workspace_members_protect_owner on public.workspace_members;
create trigger workspace_members_protect_owner before insert or update or delete on public.workspace_members
  for each row execute function public.protect_owner();

revoke execute on function public.protect_owner() from public, anon, authenticated;
