-- Nortin: schema inicial (fase 1 do MVP)
-- Hierarquia: workspace -> space -> (folder) -> list -> task -> subtask
-- Toda tabela abaixo de workspaces carrega workspace_id (preenchido por trigger)
-- para que as policies de RLS sejam uma checagem simples de membership.

create type public.task_priority as enum ('urgent', 'high', 'normal', 'low');
create type public.status_type as enum ('open', 'active', 'done', 'closed');
create type public.member_role as enum ('owner', 'admin', 'member', 'guest');

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  color text not null default '#7c3aed',
  position double precision not null default 0,
  created_at timestamptz not null default now()
);

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  space_id uuid not null references public.spaces (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  position double precision not null default 0,
  created_at timestamptz not null default now()
);

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  space_id uuid not null references public.spaces (id) on delete cascade,
  folder_id uuid references public.folders (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  position double precision not null default 0,
  created_at timestamptz not null default now()
);

create table public.statuses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  list_id uuid not null references public.lists (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  color text not null default '#94a3b8',
  type public.status_type not null default 'active',
  position double precision not null default 0
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  list_id uuid not null references public.lists (id) on delete cascade,
  parent_task_id uuid references public.tasks (id) on delete cascade,
  status_id uuid references public.statuses (id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  description text,
  priority public.task_priority,
  start_date date,
  due_date date,
  position double precision not null default 0,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_assignees (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  primary key (task_id, user_id)
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  task_id uuid not null references public.tasks (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create index on public.spaces (workspace_id);
create index on public.lists (space_id);
create index on public.statuses (list_id, position);
create index on public.tasks (list_id, status_id, position);
create index on public.tasks (parent_task_id);
create index on public.comments (task_id, created_at);

-- ---------------------------------------------------------------------------
-- Helpers de permissão
-- ---------------------------------------------------------------------------

create function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid()
  );
$$;

create function public.is_admin(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;

-- ---------------------------------------------------------------------------
-- Triggers: workspace_id herdado do pai + consistência
-- ---------------------------------------------------------------------------

create function public.inherit_workspace_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'folders' then
    select workspace_id into new.workspace_id from spaces where id = new.space_id;
  elsif tg_table_name = 'lists' then
    if new.folder_id is not null then
      select space_id into new.space_id from folders where id = new.folder_id;
    end if;
    select workspace_id into new.workspace_id from spaces where id = new.space_id;
  elsif tg_table_name in ('statuses', 'tasks') then
    select workspace_id into new.workspace_id from lists where id = new.list_id;
  elsif tg_table_name in ('comments', 'task_assignees') then
    select workspace_id into new.workspace_id from tasks where id = new.task_id;
  end if;
  if new.workspace_id is null then
    raise exception 'parent not found for %', tg_table_name;
  end if;
  return new;
end;
$$;

create trigger folders_ws before insert or update on public.folders
  for each row execute function public.inherit_workspace_id();
create trigger lists_ws before insert or update on public.lists
  for each row execute function public.inherit_workspace_id();
create trigger statuses_ws before insert or update on public.statuses
  for each row execute function public.inherit_workspace_id();
create trigger tasks_ws before insert or update on public.tasks
  for each row execute function public.inherit_workspace_id();
create trigger comments_ws before insert or update on public.comments
  for each row execute function public.inherit_workspace_id();
create trigger task_assignees_ws before insert or update on public.task_assignees
  for each row execute function public.inherit_workspace_id();

-- Garante que o status da tarefa pertence à lista dela (cai no primeiro status se não).
create function public.tasks_normalize() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status_id is null
     or not exists (select 1 from statuses where id = new.status_id and list_id = new.list_id) then
    select id into new.status_id from statuses
      where list_id = new.list_id order by position limit 1;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger tasks_normalize before insert or update on public.tasks
  for each row execute function public.tasks_normalize();

-- Toda lista nova nasce com 3 status padrão.
create function public.lists_default_statuses() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into statuses (list_id, workspace_id, name, color, type, position) values
    (new.id, new.workspace_id, 'A fazer',      '#94a3b8', 'open',   1000),
    (new.id, new.workspace_id, 'Em andamento', '#3b82f6', 'active', 2000),
    (new.id, new.workspace_id, 'Concluído',    '#22c55e', 'done',   3000);
  return new;
end;
$$;

create trigger lists_default_statuses after insert on public.lists
  for each row execute function public.lists_default_statuses();

-- Perfil criado automaticamente no signup.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RPC: criar workspace (com Space e List iniciais)
-- ---------------------------------------------------------------------------

create function public.create_workspace(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ws uuid;
  v_space uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  insert into profiles (id) values (v_uid) on conflict (id) do nothing;

  insert into workspaces (name, owner_id) values (p_name, v_uid) returning id into v_ws;
  insert into workspace_members (workspace_id, user_id, role) values (v_ws, v_uid, 'owner');
  insert into spaces (workspace_id, name, position) values (v_ws, 'Equipe', 1000) returning id into v_space;
  insert into lists (space_id, name, position) values (v_space, 'Tarefas', 1000);
  return v_ws;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.spaces enable row level security;
alter table public.folders enable row level security;
alter table public.lists enable row level security;
alter table public.statuses enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.comments enable row level security;

-- profiles: eu mesmo + quem divide workspace comigo
create policy profiles_select on public.profiles for select using (
  id = auth.uid() or exists (
    select 1 from workspace_members m
    where m.user_id = profiles.id and public.is_member(m.workspace_id)
  )
);
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- workspaces: criação só via create_workspace()
create policy workspaces_select on public.workspaces for select using (public.is_member(id));
create policy workspaces_update on public.workspaces for update
  using (public.is_admin(id)) with check (public.is_admin(id));
create policy workspaces_delete on public.workspaces for delete using (owner_id = auth.uid());

create policy members_select on public.workspace_members for select
  using (public.is_member(workspace_id));
create policy members_admin on public.workspace_members for all
  using (public.is_admin(workspace_id)) with check (public.is_admin(workspace_id));

-- demais tabelas: membro do workspace pode tudo
do $$
declare t text;
begin
  foreach t in array array['spaces', 'folders', 'lists', 'statuses', 'tasks', 'task_assignees']
  loop
    execute format(
      'create policy %1$s_member on public.%1$s for all
         using (public.is_member(workspace_id)) with check (public.is_member(workspace_id))', t);
  end loop;
end $$;

create policy comments_select on public.comments for select using (public.is_member(workspace_id));
create policy comments_insert on public.comments for insert
  with check (public.is_member(workspace_id) and author_id = auth.uid());
create policy comments_modify on public.comments for update
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy comments_delete on public.comments for delete using (author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.tasks, public.statuses, public.comments;
  end if;
end $$;
