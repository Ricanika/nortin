-- O robô de hora em hora também completa as visitas de PDV com código e sem dados do Sankhya
create or replace function public.call_hourly_sync()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare k text;
begin
  select value into k from public.app_secrets where name = 'hourly_sync';
  perform net.http_get(
    url := 'https://hyakgroup.vercel.app/api/social/sync',
    headers := jsonb_build_object('Authorization', 'Bearer ' || k),
    timeout_milliseconds := 60000
  );
  perform net.http_get(
    url := 'https://hyakgroup.vercel.app/api/pdv/sync?faltando=1',
    headers := jsonb_build_object('Authorization', 'Bearer ' || k),
    timeout_milliseconds := 60000
  );
end $$;
revoke all on function public.call_hourly_sync() from public, anon, authenticated;
