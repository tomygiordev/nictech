-- Endurece las políticas RLS legacy de public.* y storage.objects:
-- reemplaza auth.role() = 'authenticated' por public.is_legacy_admin() (JWT app_metadata.role = 'admin'),
-- permite subidas de ERP a product_images/erp/* con erp.has_permission('catalog.manage')
-- y elimina las políticas de escritura anon sobre product_images.

create or replace function public.is_legacy_admin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

revoke all on function public.is_legacy_admin() from public;
grant execute on function public.is_legacy_admin() to anon, authenticated, service_role;

do $$
declare
  v_policies constant text[][] := array[
    array['brands', 'Admin all brands', 'true', 'true'],
    array['categories', 'Admin all categories', 'true', 'true'],
    array['colors', 'Admin all colors', 'true', 'true'],
    array['models', 'Admin all models', 'true', 'true'],
    array['products', 'Admin all products', 'true', 'true'],
    array['repair_logs', 'Admin all repair logs', 'true', 'true'],
    array['capacities', 'Admin delete capacities', 'true', 'false'],
    array['capacities', 'Admin insert capacities', 'false', 'true'],
    array['orders', 'Admin delete orders', 'true', 'false'],
    array['orders', 'Admin select orders', 'true', 'false'],
    array['orders', 'Admin update orders', 'true', 'true'],
    array['posts', 'Admin delete posts', 'true', 'false'],
    array['posts', 'Admin insert posts', 'false', 'true'],
    array['posts', 'Admin update posts', 'true', 'true'],
    array['product_variants', 'Admin delete product_variants', 'true', 'false'],
    array['product_variants', 'Admin insert product_variants', 'false', 'true'],
    array['product_variants', 'Admin update product_variants', 'true', 'true'],
    array['repairs', 'Admin delete repairs', 'true', 'false'],
    array['repairs', 'Admin insert repairs', 'false', 'true'],
    array['repairs', 'Admin select repairs', 'true', 'false'],
    array['repairs', 'Admin update repairs', 'true', 'true'],
    array['payment_audit_log', 'Admin select audit', 'true', 'false'],
    array['inventory_movements', 'Authenticated all inventory_movements', 'true', 'true'],
    array['carousel_settings', 'Authenticated can update carousel settings', 'true', 'false'],
    array['dollar_settings', 'Authenticated can update dollar settings', 'true', 'false'],
    array['hero_banners', 'Authenticated users can manage banners', 'true', 'false'],
    array['repair_statuses', 'Authenticated users can manage repair statuses', 'true', 'false']
  ];
  v_entry text[];
  v_table text;
  v_policy text;
  v_has_using boolean;
  v_has_check boolean;
  v_sql text;
begin
  foreach v_entry slice 1 in array v_policies loop
    v_table := v_entry[1];
    v_policy := v_entry[2];
    v_has_using := v_entry[3]::boolean;
    v_has_check := v_entry[4]::boolean;

    if to_regclass(format('public.%I', v_table)) is null then
      continue;
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_policies
      where schemaname = 'public'
        and tablename = v_table
        and policyname = v_policy
    ) then
      raise notice 'Política pública no encontrada: public.% (%)', v_table, v_policy;
      continue;
    end if;

    v_sql := format('alter policy %I on public.%I', v_policy, v_table);
    if v_has_using then
      v_sql := v_sql || ' using (public.is_legacy_admin())';
    end if;
    if v_has_check then
      v_sql := v_sql || ' with check (public.is_legacy_admin())';
    end if;

    execute v_sql;
  end loop;
end;
$$;

do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects no existe; se omiten cambios de políticas de Storage';
    return;
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Admins can upload blog images'
  ) then
    execute $pol$
      alter policy "Admins can upload blog images" on storage.objects
        with check (bucket_id = 'blog_images'::text and public.is_legacy_admin())
    $pol$;
  else
    raise notice 'Política de Storage no encontrada: Admins can upload blog images';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Admins can update blog images'
  ) then
    execute $pol$
      alter policy "Admins can update blog images" on storage.objects
        using (bucket_id = 'blog_images'::text and public.is_legacy_admin())
    $pol$;
  else
    raise notice 'Política de Storage no encontrada: Admins can update blog images';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Admins can delete blog images'
  ) then
    execute $pol$
      alter policy "Admins can delete blog images" on storage.objects
        using (bucket_id = 'blog_images'::text and public.is_legacy_admin())
    $pol$;
  else
    raise notice 'Política de Storage no encontrada: Admins can delete blog images';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Allow Upload'
  ) then
    execute $pol$
      alter policy "Allow Upload" on storage.objects
        with check (
          bucket_id = 'product_images'::text
          and (
            public.is_legacy_admin()
            or (
              (storage.foldername(name))[1] = 'erp'::text
              and erp.has_permission('catalog.manage'::text)
            )
          )
        )
    $pol$;
  else
    raise notice 'Política de Storage no encontrada: Allow Upload';
  end if;

  execute 'drop policy if exists "Give anon users access to JPG images in folder 1uh8lhk_1" on storage.objects';
  execute 'drop policy if exists "Give anon users access to JPG images in folder 1uh8lhk_2" on storage.objects';
  execute 'drop policy if exists "Give anon users access to JPG images in folder 1uh8lhk_3" on storage.objects';
end;
$$;
