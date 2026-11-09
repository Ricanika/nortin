-- Listas de campanha: resultados por tarefa, separados por plataforma (Google / Meta).
-- CPC não é guardado: é sempre gasto ÷ cliques, calculado na tela.

alter table public.lists
  add column kind text not null default 'tasks' check (kind in ('tasks', 'campaign'));

create table public.campaign_results (
  task_id uuid not null references public.tasks (id) on delete cascade,
  platform text not null check (platform in ('google', 'meta')),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  spend numeric(14, 2) not null default 0 check (spend >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null default auth.uid(),
  primary key (task_id, platform)
);

-- workspace_id vem da tarefa, como em comments e task_assignees
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
  elsif tg_table_name in ('comments', 'task_assignees', 'campaign_results') then
    select workspace_id into new.workspace_id from tasks where id = new.task_id;
  end if;
  if new.workspace_id is null then
    raise exception 'parent not found for %', tg_table_name;
  end if;
  return new;
end;
$$;

create function public.campaign_results_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger campaign_results_ws before insert or update on public.campaign_results
  for each row execute function public.inherit_workspace_id();
create trigger campaign_results_touch before update on public.campaign_results
  for each row execute function public.campaign_results_touch();

revoke execute on function public.campaign_results_touch() from public, anon, authenticated;

alter table public.campaign_results enable row level security;
create policy campaign_results_member on public.campaign_results for all
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.campaign_results;
  end if;
end $$;
