-- Chat da tarefa (comments) só aceita mensagens novas; prioridade só Urgente ou Importante.

-- Mensagens enviadas não podem ser editadas nem apagadas: sem policy de update/delete, o RLS bloqueia.
drop policy comments_modify on public.comments;
drop policy comments_delete on public.comments;

-- Prioridades: urgent = Urgente, high = Importante
update public.tasks set priority = null where priority in ('normal', 'low');
alter table public.tasks
  add constraint tasks_priority_two check (priority is null or priority in ('urgent', 'high'));
