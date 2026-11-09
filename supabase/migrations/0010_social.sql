-- Listas de conteúdo de redes sociais, publicadas pelo GoHighLevel (Social Planner).
-- Cada post é uma tarefa; cada rede é uma linha em social_channels com status, link e métricas.

-- ---------------------------------------------------------------------------
-- Space ↔ subconta do GHL (a chave fica só na Vercel, na variável ghl_token_env)
-- ---------------------------------------------------------------------------
alter table public.spaces
  add column ghl_location_id text,
  add column ghl_token_env text check (ghl_token_env is null or ghl_token_env ~ '^GHL_TOKEN_[A-Z0-9_]+$'),
  add column ghl_user_id text;

-- ---------------------------------------------------------------------------
-- Lista de conteúdo
-- ---------------------------------------------------------------------------
alter table public.lists drop constraint lists_kind_check;
alter table public.lists add constraint lists_kind_check check (kind in ('tasks', 'campaign', 'content'));

-- Post: texto em tasks.description, mídia, tipo e horário de publicação
alter table public.tasks
  add column media jsonb not null default '[]'::jsonb,
  add column post_type text not null default 'post' check (post_type in ('post', 'reel', 'story')),
  add column publish_at timestamptz,
  add column ghl_parent_id text;

-- Lista vira "conteúdo"; se ainda estiver vazia, ganha as etapas de produção de post
create function public.make_content_list(p_list uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from lists where id = p_list;
  if v_ws is null or not public.is_member(v_ws) then
    raise exception 'Lista não encontrada';
  end if;
  update lists set kind = 'content' where id = p_list;
  if not exists (select 1 from tasks where list_id = p_list) then
    delete from statuses where list_id = p_list;
    insert into statuses (list_id, workspace_id, name, color, type, position) values
      (p_list, v_ws, 'Ideia',            '#a78bfa', 'open',   1000),
      (p_list, v_ws, 'Copy / Roteiro',   '#60a5fa', 'active', 2000),
      (p_list, v_ws, 'Arte / Gravação',  '#f472b6', 'active', 3000),
      (p_list, v_ws, 'Aprovação',        '#f59e0b', 'active', 4000),
      (p_list, v_ws, 'Agendado',         '#06b6d4', 'active', 5000),
      (p_list, v_ws, 'Publicado',        '#22c55e', 'done',   6000),
      (p_list, v_ws, 'Cancelado',        '#ef4444', 'closed', 7000);
  end if;
end;
$$;

revoke execute on function public.make_content_list(uuid) from public, anon;
grant execute on function public.make_content_list(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Canais do post (uma linha por rede) e histórico de métricas
-- ---------------------------------------------------------------------------
create table public.social_channels (
  task_id uuid not null references public.tasks (id) on delete cascade,
  platform text not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  ghl_account_id text not null,
  account_name text,
  ghl_post_id text,
  status text not null default 'scheduled' check (status in ('scheduled', 'published', 'failed')),
  link text,
  error text,
  published_at timestamptz,
  likes integer not null default 0,
  comments integer not null default 0,
  shares integer not null default 0,
  metrics_at timestamptz,
  -- quando o robô busca de novo: diário na 1ª semana, semanal até 30 dias, depois mensal
  next_sync_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (task_id, platform)
);

create table public.social_metrics (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks (id) on delete cascade,
  platform text not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  captured_at timestamptz not null default now(),
  likes integer not null,
  comments integer not null,
  shares integer not null
);

create index on public.social_channels (next_sync_at);
create index on public.social_metrics (task_id, platform, captured_at);

create or replace function public.inherit_workspace_id() returns trigger
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
  elsif tg_table_name in ('comments', 'task_assignees', 'campaign_results', 'social_channels', 'social_metrics') then
    select workspace_id into new.workspace_id from tasks where id = new.task_id;
  end if;
  if new.workspace_id is null then
    raise exception 'parent not found for %', tg_table_name;
  end if;
  return new;
end;
$$;

create trigger social_channels_ws before insert or update on public.social_channels
  for each row execute function public.inherit_workspace_id();
create trigger social_metrics_ws before insert on public.social_metrics
  for each row execute function public.inherit_workspace_id();

alter table public.social_channels enable row level security;
alter table public.social_metrics enable row level security;
create policy social_channels_member on public.social_channels for all
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy social_metrics_select on public.social_metrics for select using (public.is_member(workspace_id));
create policy social_metrics_insert on public.social_metrics for insert with check (public.is_member(workspace_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.social_channels;
  end if;
end $$;
