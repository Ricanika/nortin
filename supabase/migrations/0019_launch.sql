-- Lançamento de produtos (processo Nitron v1.0): um cartão por projeto (o "dossiê"),
-- trilha A–F, fases F0–F7 e portões G0–G5 registrados em tasks.launch.

alter table public.lists drop constraint lists_kind_check;
alter table public.lists add constraint lists_kind_check check (kind in ('tasks', 'campaign', 'content', 'pdv', 'launch'));

alter table public.tasks add column launch jsonb not null default '{}'::jsonb;

create function public.make_launch_list(p_list uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from lists where id = p_list;
  if v_ws is null or not public.is_member(v_ws) then
    raise exception 'Lista não encontrada';
  end if;
  update lists set kind = 'launch' where id = p_list;
  if not exists (select 1 from tasks where list_id = p_list) then
    delete from statuses where list_id = p_list;
    insert into statuses (list_id, workspace_id, name, color, type, position) values
      (p_list, v_ws, 'F0 · Ideia e triagem',          '#94a3b8', 'open',   1000),
      (p_list, v_ws, 'F1 · Conceito',                 '#60a5fa', 'active', 2000),
      (p_list, v_ws, 'F2 · Projeto e protótipo',      '#818cf8', 'active', 3000),
      (p_list, v_ws, 'F3 · Ferramentaria',            '#a78bfa', 'active', 4000),
      (p_list, v_ws, 'F4 · Cadastro',                 '#f59e0b', 'active', 5000),
      (p_list, v_ws, 'F5 · Lote piloto',              '#fb923c', 'active', 6000),
      (p_list, v_ws, 'F6 · Lançamento',               '#ec4899', 'active', 7000),
      (p_list, v_ws, 'F7 · Acompanhamento',           '#14b8a6', 'active', 8000),
      (p_list, v_ws, 'Mantido',                       '#22c55e', 'done',   9000),
      (p_list, v_ws, 'Encerrado',                     '#64748b', 'closed', 10000);
  end if;
end;
$$;
revoke execute on function public.make_launch_list(uuid) from public, anon;
grant execute on function public.make_launch_list(uuid) to authenticated;
