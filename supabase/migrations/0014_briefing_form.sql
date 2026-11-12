-- Formulário público de briefing por lista: quem não tem conta pede a demanda por um link.
-- O envio passa pelo servidor (chave de serviço); o link é um código aleatório que pode ser trocado.

alter table public.lists
  add column form_enabled boolean not null default false,
  add column form_token text unique;

alter table public.tasks
  add column source text not null default 'app' check (source in ('app', 'form')),
  add column requester_name text,
  add column requester_email text;

-- Ativa (ou reativa) o formulário; com p_new_link troca o código, e o link antigo para de funcionar
create function public.enable_list_form(p_list uuid, p_new_link boolean default false) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_token text;
begin
  select workspace_id, form_token into v_ws, v_token from lists where id = p_list;
  if v_ws is null or not public.is_member(v_ws) then
    raise exception 'Lista não encontrada';
  end if;
  if v_token is null or p_new_link then
    v_token := replace(gen_random_uuid()::text, '-', '');
  end if;
  update lists set form_enabled = true, form_token = v_token where id = p_list;
  return v_token;
end;
$$;

revoke execute on function public.enable_list_form(uuid, boolean) from public, anon;
grant execute on function public.enable_list_form(uuid, boolean) to authenticated;
