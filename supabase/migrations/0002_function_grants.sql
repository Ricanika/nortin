-- Funções SECURITY DEFINER não devem ser chamáveis por quem não está logado.
-- Triggers não exigem EXECUTE de quem dispara, então ficam fechadas para a API.

revoke execute on function public.inherit_workspace_id() from public, anon, authenticated;
revoke execute on function public.lists_default_statuses() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Usadas pelas policies de RLS e pela criação de workspace: só usuário logado.
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.is_admin(uuid) from public, anon;
revoke execute on function public.create_workspace(text) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.create_workspace(text) to authenticated;
