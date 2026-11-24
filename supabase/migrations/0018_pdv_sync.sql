-- Robô diário da Gestão de PDV (06h17 de Brasília): atualiza vendas e curva das lojas com visita
create or replace function public.call_pdv_sync()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare k text;
begin
  select value into k from public.app_secrets where name = 'hourly_sync';
  perform net.http_get(
    url := 'https://hyakgroup.vercel.app/api/pdv/sync',
    headers := jsonb_build_object('Authorization', 'Bearer ' || k),
    timeout_milliseconds := 60000
  );
end $$;
revoke all on function public.call_pdv_sync() from public, anon, authenticated;

select cron.unschedule('hyak-pdv-sync') where exists (select 1 from cron.job where jobname = 'hyak-pdv-sync');
select cron.schedule('hyak-pdv-sync', '17 9 * * *', 'select public.call_pdv_sync()');
