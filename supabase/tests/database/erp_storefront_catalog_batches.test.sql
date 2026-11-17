begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

do $$
begin
  if to_regclass('public.products') is null then
    create table if not exists public.products (
      id uuid primary key, name text not null, description text,
      price numeric not null, stock integer not null, image_url text,
      additional_images text[], tags text[], condition text, capacity text,
      created_at timestamptz default now()
    );
    create table if not exists public.product_variants (
      id uuid primary key, product_id uuid references public.products(id),
      color text not null, stock integer not null, image_url text,
      created_at timestamptz not null default now()
    );
  end if;
end;
$$;
insert into public.products (id, name, price, stock)
select gen_random_uuid(),
  'Producto ' || n::text || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6),
  100, 1
from generate_series(1, 201) n;

create temporary table _batch_result (value jsonb not null) on commit drop;
insert into _batch_result select erp.import_storefront_catalog_opening();
select is((select (value->>'stock_lines')::integer from _batch_result), 201,
  'Large storefront opening records all stock lines');
select is((select (value->>'opening_documents')::integer from _batch_result), 2,
  'Opening is split into two bounded documents');
select is((select sum(quantity_on_hand) from erp.stock_balances
  where product_id in (select id from public.products)), 201::numeric,
  'Batched opening balances reconcile');

select * from finish();
rollback;
