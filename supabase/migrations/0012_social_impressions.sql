-- Impressões por canal: o GHL não entrega, então são digitadas (o robô não sobrescreve).
-- Engajamento = (curtidas + comentários + compartilhamentos) ÷ impressões, calculado na tela.
alter table public.social_channels
  add column impressions integer not null default 0 check (impressions >= 0);
alter table public.social_metrics
  add column impressions integer;
