-- Gestão de PDV: visitas de merchandising a clientes, com vendas do Sankhya (antes × depois),
-- curva A de produtos, checklist, fotos e contagem de estoque na gôndola.

alter table public.lists drop constraint lists_kind_check;
alter table public.lists add constraint lists_kind_check check (kind in ('tasks', 'campaign', 'content', 'pdv'));

-- Visita: código do parceiro no Sankhya e dados da visita (checklist, fotos, hora do check-in)
alter table public.tasks
  add column pdv_codparc integer,
  add column pdv jsonb not null default '{}'::jsonb;
create index on public.tasks (pdv_codparc) where pdv_codparc is not null;

-- Lista vira "PDV"; se ainda estiver vazia, ganha as etapas da visita
create function public.make_pdv_list(p_list uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from lists where id = p_list;
  if v_ws is null or not public.is_member(v_ws) then
    raise exception 'Lista não encontrada';
  end if;
  update lists set kind = 'pdv' where id = p_list;
  if not exists (select 1 from tasks where list_id = p_list) then
    delete from statuses where list_id = p_list;
    insert into statuses (list_id, workspace_id, name, color, type, position) values
      (p_list, v_ws, 'A visitar',          '#94a3b8', 'open',   1000),
      (p_list, v_ws, 'Agendada',           '#60a5fa', 'active', 2000),
      (p_list, v_ws, 'Visitada',           '#f59e0b', 'active', 3000),
      (p_list, v_ws, 'Em acompanhamento',  '#a78bfa', 'active', 4000),
      (p_list, v_ws, 'Concluída',          '#22c55e', 'done',   5000),
      (p_list, v_ws, 'Cancelada',          '#ef4444', 'closed', 6000);
  end if;
end;
$$;
revoke execute on function public.make_pdv_list(uuid) from public, anon;
grant execute on function public.make_pdv_list(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Cópia do Sankhya (só leitura; quem grava é o servidor, com a chave de serviço)
-- ---------------------------------------------------------------------------
create table public.pdv_partners (
  codparc integer primary key,
  nome text not null,
  razao text,
  endereco text,
  bairro text,
  cidade text,
  uf text,
  cep text,
  telefone text,
  vendedor text,
  key_account text,
  updated_at timestamptz not null default now()
);

-- Vendas por mês da loja (views do comercial)
create table public.pdv_sales_monthly (
  codparc integer not null,
  mes date not null,
  valor numeric not null default 0,
  notas integer not null default 0,
  primary key (codparc, mes)
);

-- Vendas por mês de toda a base (para "crescimento acima da base")
create table public.pdv_base_monthly (
  mes date primary key,
  valor numeric not null,
  clientes integer not null
);

-- Produtos que a loja compra (12 meses), com a curva ABC
create table public.pdv_curve (
  codparc integer not null,
  codprod integer not null,
  descricao text not null,
  referencia text,
  marca text,
  valor numeric not null,
  qtd numeric not null,
  share numeric not null,
  curva char(1) not null check (curva in ('A', 'B', 'C')),
  rank integer not null,
  tem_foto_erp boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (codparc, codprod)
);

-- Foto do produto: do Sankhya (copiada) ou tirada pelo promotor; vale para todas as visitas
create table public.pdv_product_photos (
  codprod integer primary key,
  url text not null,
  origem text not null default 'app' check (origem in ('erp', 'app')),
  updated_at timestamptz not null default now()
);

-- Contagem de estoque na loja, por visita e produto
create table public.pdv_stock (
  task_id uuid not null references public.tasks (id) on delete cascade,
  codprod integer not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  qty numeric,
  counted_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (task_id, codprod)
);

-- workspace da contagem = o da visita
create function public.pdv_stock_ws() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select workspace_id into new.workspace_id from tasks where id = new.task_id;
  if new.workspace_id is null then raise exception 'visita não encontrada'; end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger pdv_stock_ws before insert or update on public.pdv_stock
  for each row execute function public.pdv_stock_ws();

alter table public.pdv_partners enable row level security;
alter table public.pdv_sales_monthly enable row level security;
alter table public.pdv_base_monthly enable row level security;
alter table public.pdv_curve enable row level security;
alter table public.pdv_product_photos enable row level security;
alter table public.pdv_stock enable row level security;

create policy pdv_partners_read on public.pdv_partners for select to authenticated using (true);
create policy pdv_sales_read on public.pdv_sales_monthly for select to authenticated using (true);
create policy pdv_base_read on public.pdv_base_monthly for select to authenticated using (true);
create policy pdv_curve_read on public.pdv_curve for select to authenticated using (true);
create policy pdv_photos_all on public.pdv_product_photos for all to authenticated using (true) with check (true);
create policy pdv_stock_member on public.pdv_stock for all
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

-- Fotos (antes/depois e produtos)
insert into storage.buckets (id, name, public) values ('pdv', 'pdv', true) on conflict (id) do nothing;
-- caminho: <workspace_id>/...
create policy pdv_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pdv' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy pdv_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'pdv' and public.is_member(((storage.foldername(name))[1])::uuid));
