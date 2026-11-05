-- Arquivar em vez de apagar: qualquer membro arquiva e desarquiva listas e Spaces.

alter table public.spaces add column archived_at timestamptz;
alter table public.lists add column archived_at timestamptz;

-- Spaces só o dono edita (RLS); arquivar passa por esta função, aberta a qualquer membro,
-- que mexe apenas em archived_at.
create function public.set_space_archived(p_space uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from spaces where id = p_space;
  if v_ws is null or not public.is_member(v_ws) then
    raise exception 'Space não encontrado';
  end if;
  update spaces set archived_at = case when p_archived then now() else null end where id = p_space;
end;
$$;

revoke execute on function public.set_space_archived(uuid, boolean) from public, anon;
grant execute on function public.set_space_archived(uuid, boolean) to authenticated;
