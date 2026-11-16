-- Prazo com horário (opcional) e a próxima recorrente mantém o horário
alter table public.tasks add column if not exists due_time time;

create or replace function public.tasks_recurrence() returns trigger
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

    insert into tasks (list_id, parent_task_id, status_id, title, description, priority, due_date, due_time, position, created_by, recurrence)
    values (new.list_id, new.parent_task_id, v_open, new.title, new.description, new.priority, v_due, new.due_time,
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
