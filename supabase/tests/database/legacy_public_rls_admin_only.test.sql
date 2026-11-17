begin;

create extension if not exists pgtap with schema extensions;

set local search_path = public, extensions, erp, pg_catalog;

select plan(12);

-- 1-3. is_legacy_admin() para anon, authenticated sin admin y authenticated con admin.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select is(public.is_legacy_admin(), false, 'anon tiene is_legacy_admin() = false');
reset role;

select set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{}}', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;
select is(
  public.is_legacy_admin(),
  false,
  'authenticated sin claim admin tiene is_legacy_admin() = false'
);

select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
select is(
  public.is_legacy_admin(),
  true,
  'authenticated con app_metadata.role = admin tiene is_legacy_admin() = true'
);
reset role;

-- 4-10. RLS sobre tablas legacy public.* (orders, posts, products).
create function pg_temp.run_legacy_public_rls_tests()
returns setof text
language plpgsql
as $$
declare
  v_order_id uuid := gen_random_uuid();
  v_prod_id uuid := gen_random_uuid();
  v_count bigint;
  v_rows integer;
begin
  if to_regclass('public.orders') is null
     or to_regclass('public.posts') is null
     or to_regclass('public.products') is null then
    return next ok(true, 'skip: tablas legacy public.orders/posts/products ausentes en clean');
    return next ok(true, 'skip: authenticated sin admin bloqueado al insertar public.posts');
    return next ok(true, 'skip: authenticated sin admin bloqueado al actualizar public.products');
    return next ok(true, 'skip: authenticated con admin ve orden fixture en public.orders');
    return next ok(true, 'skip: authenticated con admin inserta en public.posts');
    return next ok(true, 'skip: authenticated con admin actualiza public.products');
    return next ok(true, 'skip: anon lee public.products');
    return;
  end if;

  execute 'insert into public.orders (id, total, status) values ($1, 1500.00, ''pending'')'
    using v_order_id;
  execute 'insert into public.products (id, name, price, stock, is_active) values ($1, ''Fixture Legacy RLS'', 1000.00, 5, true)'
    using v_prod_id;

  perform set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{}}', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  set local role authenticated;

  execute 'select count(*)::bigint from public.orders' into v_count;
  return next is(
    v_count,
    0::bigint,
    'authenticated sin admin ve 0 filas en public.orders'
  );

  return next throws_ok(
    $q$
      insert into public.posts (title, excerpt, content, image_url, category)
      values ('Post no autorizado', 'Resumen', 'Contenido', 'https://example.com/a.jpg', 'General')
    $q$,
    '42501',
    null,
    'authenticated sin admin falla con 42501 al insertar en public.posts'
  );

  execute 'update public.products set price = price + 100 where id = $1'
    using v_prod_id;
  get diagnostics v_rows = row_count;
  return next is(
    v_rows,
    0,
    'authenticated sin admin afecta 0 filas al actualizar public.products'
  );

  perform set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
  execute 'select count(*)::bigint from public.orders where id = $1'
    into v_count
    using v_order_id;
  return next is(
    v_count,
    1::bigint,
    'authenticated con admin ve la orden fixture en public.orders'
  );

  return next lives_ok(
    $q$
      insert into public.posts (title, excerpt, content, image_url, category)
      values ('Post admin', 'Resumen', 'Contenido', 'https://example.com/b.jpg', 'General')
    $q$,
    'authenticated con admin puede insertar en public.posts'
  );

  execute 'update public.products set price = price + 100 where id = $1'
    using v_prod_id;
  get diagnostics v_rows = row_count;
  return next is(
    v_rows,
    1,
    'authenticated con admin actualiza 1 fila en public.products'
  );

  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;

  execute 'select count(*)::bigint from public.products where id = $1'
    into v_count
    using v_prod_id;
  return next is(
    v_count,
    1::bigint,
    'anon sigue leyendo public.products'
  );

  reset role;
end;
$$;

select * from pg_temp.run_legacy_public_rls_tests();

-- 11-12. Storage (si existe storage.objects).
create function pg_temp.run_storage_rls_tests()
returns setof text
language plpgsql
as $$
begin
  if to_regclass('storage.objects') is null then
    return next ok(true, 'skip storage');
    return next ok(true, 'skip storage: política anon DELETE 1uh8lhk_3');
    return;
  end if;

  return next ok(
    coalesce((
      select with_check like '%is_legacy_admin%'
      from pg_catalog.pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = 'Allow Upload'
    ), false)
    and not exists (
      select 1
      from pg_catalog.pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname in (
          'Give anon users access to JPG images in folder 1uh8lhk_1',
          'Give anon users access to JPG images in folder 1uh8lhk_2'
        )
    ),
    'storage.objects Allow Upload usa is_legacy_admin y las dos políticas anon de escritura no existen'
  );

  return next ok(
    not exists (
      select 1
      from pg_catalog.pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = 'Give anon users access to JPG images in folder 1uh8lhk_3'
    ),
    'storage.objects no tiene la política anon DELETE 1uh8lhk_3'
  );
end;
$$;

select * from pg_temp.run_storage_rls_tests();

select * from finish();

rollback;
