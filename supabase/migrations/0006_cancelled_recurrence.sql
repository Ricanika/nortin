-- Etapa "Cancelado" em todas as listas + tarefas recorrentes.

-- ---------------------------------------------------------------------------
-- Cancelado (tipo 'closed': sai das pendências, como concluída, mas fica registrado)
-- ---------------------------------------------------------------------------

create or replace function public.lists_default_statuses() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into statuses (list_id, workspace_id, name, color, type, position) values
    (new.id, new.workspace_id, 'A fazer',      '#94a3b8', 'open',   1000),
    (new.id, new.workspace_id, 'Em andamento', '#3b82f6', 'active', 2000),
    (new.id, new.workspace_id, 'Concluído',    '#22c55e', 'done',   3000),
    (new.id, new.workspace_id, 'Cancelado',    '#ef4444', 'closed', 4000);
  return new;
end;
$$;

-- Listas que já existem ganham a etapa no fim
insert into public.statuses (list_id, workspace_id, name, color, type, position)
select l.id, l.workspace_id, 'Cancelado', '#ef4444', 'closed',
       coalesce((select max(position) from public.statuses s where s.list_id = l.id), 0) + 1000
from public.lists l
where not exists (select 1 from public.statuses s where s.list_id = l.id and s.type = 'closed');

-- ---------------------------------------------------------------------------
-- Recorrência: ao concluir, nasce a próxima tarefa com o prazo seguinte
-- ---------------------------------------------------------------------------

alter table public.tasks
  add column recurrence text check (recurrence in ('daily', 'weekdays', 'weekly', 'monthly', 'yearly')),
  -- Sem FK de propósito: o trigger apaga a próxima ao desfazer, dentro do update desta linha
  add column recurrence_next_id uuid;

create function public.next_due(p_due date, p_rule text) returns date
language plpgsql immutable as $$
declare
  d date := p_due;
begin
  if p_rule = 'daily' then d := d + 1;
  elsif p_rule = 'weekdays' then
    d := d + 1;
    while extract(isodow from d) > 5 loop d := d + 1; end loop;
  elsif p_rule = 'weekly' then d := d + 7;
  elsif p_rule = 'monthly' then d := (p_due + interval '1 month')::date;
  elsif p_rule = 'yearly' then d := (p_due + interval '1 year')::date;
  end if;
  return d;
end;
$$;

create function public.tasks_recurrence() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old_type status_type;
  v_new_type status_type;
  v_due date;
  v_open uuid;
  v_next uuid;
  v_guard int := 0;
begin
  if new.status_id is not distinct from old.status_id then
    return new;
  end if;
  select type into v_old_type from statuses where id = old.status_id;
  select type into v_new_type from statuses where id = new.status_id;

  -- Concluiu uma recorrente (e ainda não gerou a próxima): cria a próxima
  if v_new_type = 'done' and v_old_type is distinct from 'done'
     and new.recurrence is not null and new.recurrence_next_id is null then
    v_due := coalesce(new.due_date, current_date);
    -- Concluída com atraso: pula até a próxima data a partir de hoje
    loop
      v_due := public.next_due(v_due, new.recurrence);
      v_guard := v_guard + 1;
      exit when v_due >= current_date or v_guard > 1000;
    end loop;

    select id into v_open from statuses
      where list_id = new.list_id and type not in ('done', 'closed') order by position limit 1;

    insert into tasks (list_id, parent_task_id, status_id, title, description, priority, due_date, position, created_by, recurrence)
    values (new.list_id, new.parent_task_id, v_open, new.title, new.description, new.priority, v_due,
            new.position + 1, new.created_by, new.recurrence)
    returning id into v_next;

    insert into task_assignees (task_id, user_id)
      select v_next, user_id from task_assignees where task_id = new.id;

    new.recurrence_next_id := v_next;

  -- Reabriu logo depois de concluir (ex.: "Desfazer"): remove a próxima, se ninguém mexeu nela
  elsif v_old_type = 'done' and v_new_type is distinct from 'done' and new.recurrence_next_id is not null then
    delete from tasks
      where id = new.recurrence_next_id
        and created_at > now() - interval '15 minutes'
        and updated_at = created_at;
    new.recurrence_next_id := null;
  end if;

  return new;
end;
$$;

-- Roda depois de tasks_normalize (ordem alfabética): o status já está validado
create trigger tasks_recurrence before update on public.tasks
  for each row execute function public.tasks_recurrence();

revoke execute on function public.tasks_recurrence() from public, anon, authenticated;
