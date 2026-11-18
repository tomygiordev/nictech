create or replace function erp.project_catalog_sheet(p_org uuid, p_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  p erp.products%rowtype;
  v_image text;
  v_gallery text[];
  v_visible boolean;
  v_tags text[];
  v_condition text;
  v_capacity text;
  v_inserted integer;
  v_public jsonb;
  v_prev_projection text;
begin
  if to_regclass('public.products') is null or to_regclass('public.product_variants') is null then
    return;
  end if;
  if not exists (select 1 from erp.storefront_catalog_sync where organization_id = p_org) then
    return;
  end if;
  select * into p from erp.products where id = p_id and organization_id = p_org and item_kind = 'product';
  if not found then
    return;
  end if;

  select coalesce(
    (select m.storage_path from erp.product_media m
     where m.organization_id = p_org and m.product_id = p_id and m.variant_id is null and m.is_active and m.is_primary
     limit 1),
    p.web_image_path
  ) into v_image;

  execute 'select to_jsonb(w) from public.products w where id = $1' into v_public using p_id;

  if p.media_initialized then
    select coalesce(array_agg(m.storage_path order by m.sort_order, m.id), '{}')
      into v_gallery
    from erp.product_media m
    where m.organization_id = p_org and m.product_id = p_id and m.variant_id is null and m.is_active and not m.is_primary;
  else
    select coalesce(array_agg(x.value order by x.ord), '{}')
      into v_gallery
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_public -> 'additional_images') = 'array' then v_public -> 'additional_images' else '[]'::jsonb end
    ) with ordinality x(value, ord);
  end if;

  if p.sheet_fields_initialized then
    v_tags := p.tags;
    v_condition := initcap(p.condition);
    v_capacity := p.capacity;
  else
    select coalesce(array_agg(x.value order by x.ord), p.tags)
      into v_tags
    from jsonb_array_elements_text(
      case when jsonb_typeof(v_public -> 'tags') = 'array' then v_public -> 'tags' else '[]'::jsonb end
    ) with ordinality x(value, ord);
    v_condition := v_public ->> 'condition';
    v_capacity := v_public ->> 'capacity';
  end if;

  v_visible := p.is_active and p.publish_on_web and p.allow_online_sale and p.can_sell;

  v_prev_projection := current_setting('erp.projecting_storefront_catalog', true);
  perform set_config('erp.projecting_storefront_catalog', 'on', true);

  begin
    if v_public is not null then
      update public.products
         set name = coalesce(nullif(p.public_name, ''), p.internal_name),
             description = p.public_description,
             price = p.base_sale_price,
             image_url = v_image,
             is_active = v_visible,
             category_id = p.category_id,
             brand_id = p.brand_id,
             model_id = p.model_id
       where id = p_id
         and (name, description, price, image_url, is_active, category_id, brand_id, model_id)
          is distinct from (
            coalesce(nullif(p.public_name, ''), p.internal_name),
            p.public_description,
            p.base_sale_price,
            v_image,
            v_visible,
            p.category_id,
            p.brand_id,
            p.model_id
          );
    elsif v_visible then
      insert into public.products (id, name, description, price, image_url, stock, is_active, category_id, brand_id, model_id)
      values (
        p.id,
        coalesce(nullif(p.public_name, ''), p.internal_name),
        p.public_description,
        p.base_sale_price,
        v_image,
        0,
        true,
        p.category_id,
        p.brand_id,
        p.model_id
      );
    else
      perform set_config('erp.projecting_storefront_catalog', coalesce(v_prev_projection, ''), true);
      return;
    end if;

    if exists (select 1 from pg_attribute where attrelid = to_regclass('public.products') and attname = 'additional_images' and not attisdropped) then
      execute 'update public.products set additional_images = $1 where id = $2 and coalesce(additional_images, ''{}''::text[]) is distinct from $1'
        using v_gallery, p_id;
    end if;
    if exists (select 1 from pg_attribute where attrelid = to_regclass('public.products') and attname = 'tags' and not attisdropped) then
      execute 'update public.products set tags = $1 where id = $2 and coalesce(tags, ''{}''::text[]) is distinct from $1'
        using v_tags, p_id;
    end if;
    if exists (select 1 from pg_attribute where attrelid = to_regclass('public.products') and attname = 'condition' and not attisdropped) then
      execute 'update public.products set condition = $1 where id = $2 and condition is distinct from $1'
        using v_condition, p_id;
    end if;
    if exists (select 1 from pg_attribute where attrelid = to_regclass('public.products') and attname = 'capacity' and not attisdropped) then
      execute 'update public.products set capacity = $1 where id = $2 and capacity is distinct from $1'
        using v_capacity, p_id;
    end if;

    -- Variants created while the parent was a draft have no public row yet.
    if v_visible then
      insert into public.product_variants (id, product_id, color, image_url, stock, is_active)
      select v.id, v.product_id, coalesce(nullif(v.attributes ->> 'color', ''), v.name), v.image_path, 0, v.is_active
      from erp.product_variants v
      where v.organization_id = p_org
        and v.product_id = p_id
        and not exists (select 1 from public.product_variants w where w.id = v.id)
      on conflict (id) do nothing;
      get diagnostics v_inserted = row_count;
      -- Materialize variants before roll-up so the legacy capture guard sees consistent stock.
      if v_public is null or v_inserted > 0 then
        perform erp.project_storefront_product_stock(p_org, p_id);
      end if;
    end if;

    perform set_config('erp.projecting_storefront_catalog', coalesce(v_prev_projection, ''), true);
  exception when others then
    perform set_config('erp.projecting_storefront_catalog', coalesce(v_prev_projection, ''), true);
    raise;
  end;
end;
$$;

revoke all on function erp.project_catalog_sheet(uuid, uuid) from public, anon, authenticated, service_role;
