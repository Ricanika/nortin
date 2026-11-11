-- Stories com várias mídias viram vários posts no GHL (um por mídia), então o post guarda
-- a lista de códigos; e o link de CTA, que cada rede recebe do jeito que permite.
alter table public.tasks
  add column ghl_parent_ids text[] not null default '{}',
  add column cta_url text check (cta_url is null or cta_url ~* '^https?://');

-- posts já enviados: o código único entra na lista
update public.tasks set ghl_parent_ids = array[ghl_parent_id] where ghl_parent_id is not null;
