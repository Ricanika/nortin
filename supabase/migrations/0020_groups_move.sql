-- Pastas acima dos Spaces (ex.: Marketing → Nitron, Teak...; Comercial → Nitron PDV)
-- e funções para mover tarefas entre listas.

create table public.space_groups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  position double precision not null default 0,
  created_at timestamptz not null default now()
);
create index on public.space_groups (workspace_id);
alter table public.space_groups enable row level security;
create policy space_groups_select on public.space_groups for select using (public.is_member(workspace_id));
create policy space_groups_insert on public.space_groups for insert with check (public.is_owner(workspace_id));
create policy space_groups_update on public.space_groups for update
  using (public.is_owner(workspace_id)) with check (public.is_owner(workspace_id));
create policy space_groups_delete on public.space_groups for delete using (public.is_owner(workspace_id));

alter table public.spaces add column group_id uuid references public.space_groups (id) on delete set null;

-- Move a tarefa (e as subtarefas) para outra lista do mesmo workspace.
-- Status: o de mesmo nome na lista nova; senão o do mesmo tipo; senão o primeiro.
create function public.move_task(p_task uuid, p_list uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_task record;
  v_ws uuid;
  v_status uuid;
begin
  select t.id, t.workspace_id, t.status_id, s.name as status_name, s.type as status_type
    into v_task
    from tasks t left join statuses s on s.id = t.status_id
   where t.id = p_task;
  select workspace_id into v_ws from lists where id = p_list;
  if v_task.id is null or v_ws is null or v_ws <> v_task.workspace_id or not public.is_member(v_ws) then
    raise exception 'Tarefa ou lista não encontrada';
  end if;

  select id into v_status from statuses
   where list_id = p_list and lower(trim(name)) = lower(trim(coalesce(v_task.status_name, '')))
   order by position limit 1;
  if v_status is null then
    select id into v_status from statuses
     where list_id = p_list and type = v_task.status_type order by position limit 1;
  end if;
  if v_status is null then
    select id into v_status from statuses where list_id = p_list order by position limit 1;
  end if;

  update tasks set list_id = p_list, status_id = v_status where id = p_task;
  -- subtarefas vão junto (o status delas cai no primeiro da lista, se não existir)
  update tasks set list_id = p_list where parent_task_id = p_task;
end;
$$;
revoke execute on function public.move_task(uuid, uuid) from public, anon;
grant execute on function public.move_task(uuid, uuid) to authenticated;
