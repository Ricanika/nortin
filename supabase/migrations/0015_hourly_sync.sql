-- Robô de hora em hora (o Cron grátis da Vercel só roda 1x por dia): o próprio Supabase chama
-- /api/social/sync a cada hora. A chave é gerada aqui, fica numa tabela que só o servidor lê
-- (RLS ligada, sem regras) e é conferida pela rota.
create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.app_secrets (
  name text primary key,
  value text not null,
  created_at timestamptz not null default now()
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;

insert into public.app_secrets (name, value)
values ('hourly_sync', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (name) do nothing;

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
end $$;
revoke all on function public.call_hourly_sync() from public, anon, authenticated;

select cron.unschedule('hyak-hourly-sync') where exists (select 1 from cron.job where jobname = 'hyak-hourly-sync');
select cron.schedule('hyak-hourly-sync', '7 * * * *', 'select public.call_hourly_sync()');
