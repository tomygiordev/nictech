begin;

-- The ERP-only migrations do not recreate the legacy storefront baseline.
create table if not exists public.categories (id uuid primary key, name text not null, created_at timestamptz default now());
create table if not exists public.brands (id uuid primary key, name text not null, created_at timestamptz default now());
create table if not exists public.models (
  id uuid primary key, brand_id uuid references public.brands(id), name text not null, created_at timestamptz default now()
);
create table if not exists public.products (
  id uuid primary key, name text not null, description text, price numeric not null,
  original_price numeric, stock integer not null default 0 check (stock >= 0),
  image_url text, additional_images text[], tags text[], condition text, capacity text,
  category_id uuid references public.categories(id), brand_id uuid references public.brands(id),
  model_id uuid references public.models(id), is_active boolean not null default true, created_at timestamptz default now()
);
create table if not exists public.product_variants (
  id uuid primary key, product_id uuid references public.products(id), color text not null,
  stock integer not null default 0 check (stock >= 0), price numeric(12, 2),
  image_url text, is_active boolean not null default true, created_at timestamptz default now()
);
create table if not exists public.orders (
  id uuid primary key, items jsonb not null, payer jsonb not null, total numeric not null,
  status text not null, payment_id text, payment_method_id text, stock_decremented boolean not null default false,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

insert into storage.buckets (id, name, public) values ('product_images', 'product_images', true)
on conflict (id) do nothing;
do $$
begin
  if not exists (select from pg_policies where schemaname='storage' and tablename='objects' and policyname='Allow Upload') then
    create policy "Allow Upload" on storage.objects for insert to authenticated with check (
      bucket_id = 'product_images' and (storage.foldername(name))[1] = 'erp' and erp.has_permission('catalog.manage')
    );
  end if;
end;
$$;

insert into public.categories (id, name) values
  ('e2000000-0000-0000-0000-000000000001', 'Celulares QA'),
  ('e2000000-0000-0000-0000-000000000002', 'Accesorios QA')
on conflict (id) do nothing;
insert into public.brands (id, name) values ('e2000000-0000-0000-0000-000000000003', 'Marca QA')
on conflict (id) do nothing;
insert into public.models (id, brand_id, name) values
  ('e2000000-0000-0000-0000-000000000004', 'e2000000-0000-0000-0000-000000000003', 'Modelo QA')
on conflict (id) do nothing;

do $$
begin
  if not exists (select from erp.storefront_catalog_sync where organization_id='10000000-0000-0000-0000-000000000001') then
    insert into public.products (id, name, price, category_id, brand_id, model_id)
    values ('e2000000-0000-0000-0000-000000000005','Artículo inicial QA',2000,
      'e2000000-0000-0000-0000-000000000002','e2000000-0000-0000-0000-000000000003','e2000000-0000-0000-0000-000000000004');
    perform erp.import_storefront_catalog_opening();
    perform erp.activate_storefront_bridge('10000000-0000-0000-0000-000000000001');
  end if;
end;
$$;
notify pgrst, 'reload schema';
commit;
