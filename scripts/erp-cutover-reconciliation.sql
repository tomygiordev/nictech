-- =============================================================================
-- scripts/erp-cutover-reconciliation.sql
-- =============================================================================
-- Conciliación ERP (erp.*) vs tienda legacy (public.*) para los cortes W3.
--
-- Propósito:
--   Ejecutar antes y después de cada corte (catalog, prices_promos, stock,
--   repairs) para auditar diferencias entre erp.* y public.*, revisar las
--   banderas de corte, contar eventos de canario (7 y 30 días) y comparar el
--   conteo de filas por tabla relevante.
--
-- Garantías:
--   - 100% SOLO LECTURA: envuelto en `begin read only; ... rollback;`.
--   - Sin datos personales de clientes: solo conteos y, como máximo, 20
--     ejemplos por diferencia con id y nombre de producto/variante/promo.
--   - Tolerante a objetos faltantes (`to_regclass`, `to_regprocedure`, columnas).
--
-- Uso:
--   psql -X -f scripts/erp-cutover-reconciliation.sql
-- =============================================================================

\set ON_ERROR_STOP on

begin read only;

-- =============================================================================
-- 0. CONTEXTO DE ORGANIZACIÓN Y PUENTES DE SINCRONIZACIÓN
-- =============================================================================
do $$
declare
  v_orgs integer := 0;
  v_active_orgs integer := 0;
  v_cat_sync integer := 0;
  v_stock_proj integer := 0;
  v_stock_cap integer := 0;
begin
  raise notice '========================================================================';
  raise notice 'CONCILIACIÓN DE CORTE ERP vs TIENDA (SOLO LECTURA)';
  raise notice 'Base: % | Fecha: %', current_database(), now();
  raise notice '========================================================================';

  if to_regclass('erp.organizations') is not null then
    execute 'select count(*), count(*) filter (where is_active) from erp.organizations'
      into v_orgs, v_active_orgs;
    raise notice '[context] erp.organizations: total=% | activas=%', v_orgs, v_active_orgs;
  else
    raise notice '[context] erp.organizations: no instalado';
  end if;

  if to_regclass('erp.storefront_catalog_sync') is not null then
    execute 'select count(*) from erp.storefront_catalog_sync' into v_cat_sync;
    raise notice '[context] erp.storefront_catalog_sync activas=%', v_cat_sync;
  else
    raise notice '[context] erp.storefront_catalog_sync: no instalado';
  end if;

  if to_regclass('erp.storefront_stock_projection') is not null then
    execute 'select count(*) from erp.storefront_stock_projection' into v_stock_proj;
    raise notice '[context] erp.storefront_stock_projection activas=%', v_stock_proj;
  else
    raise notice '[context] erp.storefront_stock_projection: no instalado';
  end if;

  if to_regclass('erp.storefront_stock_capture') is not null then
    execute 'select count(*) from erp.storefront_stock_capture' into v_stock_cap;
    raise notice '[context] erp.storefront_stock_capture activas=%', v_stock_cap;
  else
    raise notice '[context] erp.storefront_stock_capture: no instalado';
  end if;
end $$;

-- =============================================================================
-- 1. GRUPO: catalog
-- =============================================================================
do $$
declare
  v_has_pub_cat boolean;
  v_has_pub_brand boolean;
  v_has_pub_active boolean;
  v_has_pub_tags boolean;
  v_has_pub_cond boolean;
  v_has_erp_tags boolean;
  v_has_erp_cond boolean;
  v_has_erp_sheet_init boolean;
  v_cnt bigint;
  v_cnt2 bigint;
  v_rec record;
  v_sql text;
begin
  raise notice '------------------------------------------------------------------------';
  raise notice '[1] GRUPO: catalog';
  raise notice '------------------------------------------------------------------------';

  if to_regclass('public.products') is null or to_regclass('erp.products') is null then
    raise notice '[catalog] omitido: falta public.products (%) o erp.products (%)',
      coalesce(to_regclass('public.products')::text, 'ausente'),
      coalesce(to_regclass('erp.products')::text, 'ausente');
    return;
  end if;

  select exists (select 1 from pg_attribute where attrelid = 'public.products'::regclass and attname = 'category_id' and not attisdropped) into v_has_pub_cat;
  select exists (select 1 from pg_attribute where attrelid = 'public.products'::regclass and attname = 'brand_id' and not attisdropped) into v_has_pub_brand;
  select exists (select 1 from pg_attribute where attrelid = 'public.products'::regclass and attname = 'is_active' and not attisdropped) into v_has_pub_active;
  select exists (select 1 from pg_attribute where attrelid = 'public.products'::regclass and attname = 'tags' and not attisdropped) into v_has_pub_tags;
  select exists (select 1 from pg_attribute where attrelid = 'public.products'::regclass and attname = 'condition' and not attisdropped) into v_has_pub_cond;
  select exists (select 1 from pg_attribute where attrelid = 'erp.products'::regclass and attname = 'tags' and not attisdropped) into v_has_erp_tags;
  select exists (select 1 from pg_attribute where attrelid = 'erp.products'::regclass and attname = 'condition' and not attisdropped) into v_has_erp_cond;
  select exists (select 1 from pg_attribute where attrelid = 'erp.products'::regclass and attname = 'sheet_fields_initialized' and not attisdropped) into v_has_erp_sheet_init;

  -- 1.1 Productos vinculados vs sin contraparte
  execute $q$
    select count(*) from public.products pp
    join erp.products ep on ep.id = pp.id and ep.item_kind = 'product'
  $q$ into v_cnt;
  raise notice '[catalog] productos vinculados (id compartido, item_kind=product): %', v_cnt;

  execute $q$
    select count(*) from public.products pp
    where not exists (
      select 1 from erp.products ep where ep.id = pp.id and ep.item_kind = 'product'
    )
  $q$ into v_cnt;
  raise notice '[catalog] public.products sin contraparte en erp.products: %', v_cnt;
  if v_cnt > 0 then
    for v_rec in execute $q$
      select pp.id, pp.name
      from public.products pp
      where not exists (
        select 1 from erp.products ep where ep.id = pp.id and ep.item_kind = 'product'
      )
      order by pp.name, pp.id
      limit 20
    $q$ loop
      raise notice '  ejemplo public_sin_erp: id=% | nombre=%', v_rec.id, v_rec.name;
    end loop;
  end if;

  execute $q$
    select
      count(*),
      count(*) filter (where ep.is_active and ep.publish_on_web and ep.allow_online_sale and ep.can_sell)
    from erp.products ep
    where ep.item_kind = 'product'
      and not exists (select 1 from public.products pp where pp.id = ep.id)
  $q$ into v_cnt, v_cnt2;
  raise notice '[catalog] erp.products (item_kind=product) sin contraparte en public.products: % (publicables_web=%)', v_cnt, v_cnt2;
  if v_cnt > 0 then
    for v_rec in execute $q$
      select
        ep.id,
        coalesce(nullif(ep.public_name, ''), ep.internal_name) as name,
        (ep.is_active and ep.publish_on_web and ep.allow_online_sale and ep.can_sell) as web_visible
      from erp.products ep
      where ep.item_kind = 'product'
        and not exists (select 1 from public.products pp where pp.id = ep.id)
      order by web_visible desc, name, ep.id
      limit 20
    $q$ loop
      raise notice '  ejemplo erp_sin_public: id=% | nombre=% | web_visible=%', v_rec.id, v_rec.name, v_rec.web_visible;
    end loop;
  end if;

  -- Variantes sin contraparte
  if to_regclass('public.product_variants') is not null and to_regclass('erp.product_variants') is not null then
    execute $q$
      select count(*) from public.product_variants pv
      where not exists (select 1 from erp.product_variants ev where ev.id = pv.id)
    $q$ into v_cnt;
    raise notice '[catalog] public.product_variants sin contraparte en erp.product_variants: %', v_cnt;
    if v_cnt > 0 then
      for v_rec in execute $q$
        select pv.id, coalesce(pp.name, '(sin padre)') as product_name, pv.color
        from public.product_variants pv
        left join public.products pp on pp.id = pv.product_id
        where not exists (select 1 from erp.product_variants ev where ev.id = pv.id)
        order by product_name, pv.color, pv.id
        limit 20
      $q$ loop
        raise notice '  ejemplo variant_public_sin_erp: variant_id=% | producto=% | color=%',
          v_rec.id, v_rec.product_name, v_rec.color;
      end loop;
    end if;

    execute $q$
      select count(*) from erp.product_variants ev
      join erp.products ep on ep.id = ev.product_id and ep.organization_id = ev.organization_id
      where ep.item_kind = 'product'
        and not exists (select 1 from public.product_variants pv where pv.id = ev.id)
    $q$ into v_cnt;
    raise notice '[catalog] erp.product_variants sin contraparte en public.product_variants: %', v_cnt;
    if v_cnt > 0 then
      for v_rec in execute $q$
        select ev.id, coalesce(nullif(ep.public_name, ''), ep.internal_name) as product_name, ev.name as variant_name, ev.is_active
        from erp.product_variants ev
        join erp.products ep on ep.id = ev.product_id and ep.organization_id = ev.organization_id
        where ep.item_kind = 'product'
          and not exists (select 1 from public.product_variants pv where pv.id = ev.id)
        order by ev.is_active desc, product_name, ev.id
        limit 20
      $q$ loop
        raise notice '  ejemplo variant_erp_sin_public: variant_id=% | producto=% | variante=% | activa=%',
          v_rec.id, v_rec.product_name, v_rec.variant_name, v_rec.is_active;
      end loop;
    end if;
  end if;

  -- 1.2 Diferencia de nombre público
  execute $q$
    select count(*)
    from public.products pp
    join erp.products ep on ep.id = pp.id and ep.item_kind = 'product'
    where pp.name is distinct from coalesce(nullif(ep.public_name, ''), ep.internal_name)
  $q$ into v_cnt;
  raise notice '[catalog] diff nombre público (public.name vs erp.public_name/internal_name): %', v_cnt;
  if v_cnt > 0 then
    for v_rec in execute $q$
      select pp.id, pp.name as pub_name, coalesce(nullif(ep.public_name, ''), ep.internal_name) as erp_name
      from public.products pp
      join erp.products ep on ep.id = pp.id and ep.item_kind = 'product'
      where pp.name is distinct from coalesce(nullif(ep.public_name, ''), ep.internal_name)
      order by pp.name, pp.id
      limit 20
    $q$ loop
      raise notice '  ejemplo diff_nombre: id=% | public=% | erp=%', v_rec.id, v_rec.pub_name, v_rec.erp_name;
    end loop;
  end if;

  -- 1.3 Diferencia de descripción pública
  execute $q$
    select count(*)
    from public.products pp
    join erp.products ep on ep.id = pp.id and ep.item_kind = 'product'
    where pp.description is distinct from ep.public_description
  $q$ into v_cnt;
  raise notice '[catalog] diff descripción pública (public.description vs erp.public_description): %', v_cnt;
  if v_cnt > 0 then
    for v_rec in execute $q$
      select
        pp.id,
        pp.name,
        length(coalesce(pp.description, '')) as pub_len,
        length(coalesce(ep.public_description, '')) as erp_len
      from public.products pp
      join erp.products ep on ep.id = pp.id and ep.item_kind = 'product'
      where pp.description is distinct from ep.public_description
      order by pp.name, pp.id
      limit 20
    $q$ loop
      raise notice '  ejemplo diff_descripcion: id=% | nombre=% | len_public=% | len_erp=%',
        v_rec.id, v_rec.name, v_rec.pub_len, v_rec.erp_len;
    end loop;
  end if;

  -- 1.4 Diferencia de categoría
  if v_has_pub_cat then
    execute $q$
      select count(*)
      from public.products pp
      join erp.products ep on ep.id = pp.id and ep.item_kind = 'product'
      where pp.category_id is distinct from ep.category_id
    $q$ into v_cnt;
    raise notice '[catalog] diff categoría (public.category_id vs erp.category_id): %', v_cnt;
    if v_cnt > 0 then
      for v_rec in execute $q$
        select pp.id, pp.name, pp.category_id as pub_cat, ep.category_id as erp_cat
        from public.products pp
        join erp.products ep on ep.id = pp.id and ep.item_kind = 'product'
        where pp.category_id is distinct from ep.category_id
        order by pp.name, pp.id
        limit 20
      $q$ loop
        raise notice '  ejemplo diff_categoria: id=% | nombre=% | pub_cat=% | erp_cat=%',
          v_rec.id, v_rec.name, v_rec.pub_cat, v_rec.erp_cat;
      end loop;
    end if;
  else
    raise notice '[catalog] diff categoría: columna public.products.category_id ausente';
  end if;

  -- 1.5 Diferencia de marca
  if v_has_pub_brand then
    execute $q$
      select count(*)
      from public.products pp
      join erp.products ep on ep.id = pp.id and ep.item_kind = 'product'
      where pp.brand_id is distinct from ep.brand_id
    $q$ into v_cnt;
    raise notice '[catalog] diff marca (public.brand_id vs erp.brand_id): %', v_cnt;
    if v_cnt > 0 then
      for v_rec in execute $q$
        select pp.id, pp.name, pp.brand_id as pub_brand, ep.brand_id as erp_brand
        from public.products pp
        join erp.products ep on ep.id = pp.id and ep.item_kind = 'product'
        where pp.brand_id is distinct from ep.brand_id
        order by pp.name, pp.id
        limit 20
      $q$ loop
        raise notice '  ejemplo diff_marca: id=% | nombre=% | pub_brand=% | erp_brand=%',
          v_rec.id, v_rec.name, v_rec.pub_brand, v_rec.erp_brand;
      end loop;
    end if;
  else
    raise notice '[catalog] diff marca: columna public.products.brand_id ausente';
  end if;

  -- 1.6 Diferencia de is_active / publicación
  if v_has_pub_active then
    execute $q$
      select count(*)
      from public.products pp
      join erp.products ep on ep.id = pp.id and ep.item_kind = 'product'
      where coalesce(pp.is_active, true) is distinct from (
        ep.is_active and ep.publish_on_web and ep.allow_online_sale and ep.can_sell
      )
    $q$ into v_cnt;
    raise notice '[catalog] diff is_active/publicación: %', v_cnt;
    if v_cnt > 0 then
      for v_rec in execute $q$
        select
          pp.id,
          pp.name,
          coalesce(pp.is_active, true) as pub_active,
          (ep.is_active and ep.publish_on_web and ep.allow_online_sale and ep.can_sell) as erp_published,
          ep.is_active as erp_active,
          ep.publish_on_web,
          ep.allow_online_sale,
          ep.can_sell
        from public.products pp
        join erp.products ep on ep.id = pp.id and ep.item_kind = 'product'
        where coalesce(pp.is_active, true) is distinct from (
          ep.is_active and ep.publish_on_web and ep.allow_online_sale and ep.can_sell
        )
        order by pp.name, pp.id
        limit 20
      $q$ loop
        raise notice '  ejemplo diff_publicacion: id=% | nombre=% | pub_active=% | erp_pub=% (act=%,web=%,online=%,sell=%)',
          v_rec.id, v_rec.name, v_rec.pub_active, v_rec.erp_published,
          v_rec.erp_active, v_rec.publish_on_web, v_rec.allow_online_sale, v_rec.can_sell;
      end loop;
    end if;
  else
    raise notice '[catalog] diff is_active/publicación: columna public.products.is_active ausente';
  end if;

  -- 1.7 Diferencia de tags
  if v_has_pub_tags and v_has_erp_tags then
    v_sql := '
      select
        count(*),
        count(*) filter (where ' || case when v_has_erp_sheet_init then 'ep.sheet_fields_initialized' else 'true' end || ')
      from public.products pp
      join erp.products ep on ep.id = pp.id and ep.item_kind = ''product''
      where coalesce(pp.tags, ''{}''::text[]) is distinct from coalesce(ep.tags, ''{}''::text[])';
    execute v_sql into v_cnt, v_cnt2;
    raise notice '[catalog] diff tags: % (con sheet_fields_initialized=%)', v_cnt, v_cnt2;
    if v_cnt > 0 then
      v_sql := '
        select
          pp.id,
          pp.name,
          coalesce(pp.tags, ''{}''::text[]) as pub_tags,
          coalesce(ep.tags, ''{}''::text[]) as erp_tags,
          ' || case when v_has_erp_sheet_init then 'ep.sheet_fields_initialized' else 'true' end || ' as sheet_init
        from public.products pp
        join erp.products ep on ep.id = pp.id and ep.item_kind = ''product''
        where coalesce(pp.tags, ''{}''::text[]) is distinct from coalesce(ep.tags, ''{}''::text[])
        order by sheet_init desc, pp.name, pp.id
        limit 20';
      for v_rec in execute v_sql loop
        raise notice '  ejemplo diff_tags: id=% | nombre=% | sheet_init=% | pub=% | erp=%',
          v_rec.id, v_rec.name, v_rec.sheet_init, v_rec.pub_tags, v_rec.erp_tags;
      end loop;
    end if;
  else
    raise notice '[catalog] diff tags: no aplicable (pub_tags=% | erp_tags=%)', v_has_pub_tags, v_has_erp_tags;
  end if;

  -- 1.8 Diferencia de condition
  if v_has_pub_cond and v_has_erp_cond then
    v_sql := '
      select
        count(*),
        count(*) filter (where ' || case when v_has_erp_sheet_init then 'ep.sheet_fields_initialized' else 'true' end || ')
      from public.products pp
      join erp.products ep on ep.id = pp.id and ep.item_kind = ''product''
      where lower(nullif(btrim(pp.condition), '''')) is distinct from lower(nullif(btrim(ep.condition), ''''))';
    execute v_sql into v_cnt, v_cnt2;
    raise notice '[catalog] diff condition: % (con sheet_fields_initialized=%)', v_cnt, v_cnt2;
    if v_cnt > 0 then
      v_sql := '
        select
          pp.id,
          pp.name,
          pp.condition as pub_cond,
          ep.condition as erp_cond,
          ' || case when v_has_erp_sheet_init then 'ep.sheet_fields_initialized' else 'true' end || ' as sheet_init
        from public.products pp
        join erp.products ep on ep.id = pp.id and ep.item_kind = ''product''
        where lower(nullif(btrim(pp.condition), '''')) is distinct from lower(nullif(btrim(ep.condition), ''''))
        order by sheet_init desc, pp.name, pp.id
        limit 20';
      for v_rec in execute v_sql loop
        raise notice '  ejemplo diff_condition: id=% | nombre=% | sheet_init=% | pub=% | erp=%',
          v_rec.id, v_rec.name, v_rec.sheet_init, v_rec.pub_cond, v_rec.erp_cond;
      end loop;
    end if;
  else
    raise notice '[catalog] diff condition: no aplicable (pub_cond=% | erp_cond=%)', v_has_pub_cond, v_has_erp_cond;
  end if;
end $$;

-- =============================================================================
-- 2. GRUPO: prices_promos
-- =============================================================================
do $$
declare
  v_has_pub_orig boolean;
  v_has_pub_exp boolean;
  v_has_var_price boolean;
  v_has_promos boolean;
  v_has_promo_targets boolean;
  v_has_promo_view boolean;
  v_has_channel_resolver boolean;
  v_has_internal_resolver boolean;
  v_has_web_status boolean;
  v_cnt bigint;
  v_cnt2 bigint;
  v_cnt3 bigint;
  v_rec record;
  v_sql text;
begin
  raise notice '------------------------------------------------------------------------';
  raise notice '[2] GRUPO: prices_promos';
  raise notice '------------------------------------------------------------------------';

  v_has_promos := to_regclass('erp.promotions') is not null;
  v_has_promo_targets := to_regclass('erp.promotion_targets') is not null;
  v_has_promo_view := to_regclass('public.storefront_promotion_prices') is not null;
  v_has_channel_resolver := to_regprocedure('erp.resolve_catalog_price_for_channel(uuid,uuid,uuid,timestamptz,text)') is not null;
  v_has_internal_resolver := to_regprocedure('erp.resolve_catalog_effective_price_internal(uuid,uuid,uuid,timestamptz)') is not null;

  if to_regclass('public.products') is null or to_regclass('erp.products') is null then
    raise notice '[prices_promos] omitido productos/promos legacy: falta public.products o erp.products';
  else
    select exists (select 1 from pg_attribute where attrelid = 'public.products'::regclass and attname = 'original_price' and not attisdropped) into v_has_pub_orig;
    select exists (select 1 from pg_attribute where attrelid = 'public.products'::regclass and attname = 'sale_expires_at' and not attisdropped) into v_has_pub_exp;

    -- 2.1 Precio de lista ERP vs public.products.price
    v_sql := '
      select
        count(*),
        count(*) filter (where ' ||
          case when v_has_pub_orig
            then 'pp.original_price is not null and pp.original_price > pp.price' ||
                 case when v_has_pub_exp then ' and (pp.sale_expires_at is null or pp.sale_expires_at > now())' else '' end
            else 'false' end || ')
      from public.products pp
      join erp.products ep on ep.id = pp.id and ep.item_kind = ''product''
      where pp.price is distinct from round(coalesce(ep.base_sale_price, 0), 2)';
    execute v_sql into v_cnt, v_cnt2;
    raise notice '[prices_promos] diff precio lista ERP (base_sale_price) vs public.products.price: % (con_promo_legacy_vigente=%, sin_promo_legacy=%)',
      v_cnt, v_cnt2, (v_cnt - v_cnt2);

    if v_cnt > 0 then
      v_sql := '
        select
          pp.id,
          pp.name,
          pp.price as pub_price,
          ' || case when v_has_pub_orig then 'pp.original_price' else 'null::numeric' end || ' as pub_orig,
          ep.base_sale_price as erp_list
        from public.products pp
        join erp.products ep on ep.id = pp.id and ep.item_kind = ''product''
        where pp.price is distinct from round(coalesce(ep.base_sale_price, 0), 2)
        order by pp.name, pp.id
        limit 20';
      for v_rec in execute v_sql loop
        raise notice '  ejemplo diff_precio_lista: id=% | nombre=% | pub_price=% | pub_orig=% | erp_base=%',
          v_rec.id, v_rec.name, v_rec.pub_price, v_rec.pub_orig, v_rec.erp_list;
      end loop;
    end if;

    -- 2.3 Promos legacy vigentes sin promo ERP equivalente
    if v_has_pub_orig then
      v_sql := '
        select
          count(*),
          count(*) filter (where pp.original_price > pp.price and ' ||
            case when v_has_pub_exp then '(pp.sale_expires_at is null or pp.sale_expires_at > now())' else 'true' end || '),
          count(*) filter (where pp.original_price <= pp.price)
        from public.products pp
        where pp.original_price is not null';
      execute v_sql into v_cnt, v_cnt2, v_cnt3;
      raise notice '[prices_promos] promos legacy total_con_original_price=% | vigentes=% | invertidas(<=price)=%',
        v_cnt, v_cnt2, v_cnt3;

      if v_has_promos and v_has_promo_targets and v_has_channel_resolver then
        v_sql := '
          with legacy_active as (
            select
              pp.id as product_id,
              pp.name as product_name,
              pp.price as legacy_promo_price,
              pp.original_price as legacy_list_price,
              ' || case when v_has_pub_exp then 'pp.sale_expires_at' else 'null::timestamptz' end || ' as sale_expires_at,
              ep.organization_id,
              (ep.id is not null) as has_erp_product,
              case when ep.id is not null then
                erp.resolve_catalog_price_for_channel(ep.organization_id, ep.id, null, now(), ''web'')
              else null::jsonb end as resolved
            from public.products pp
            left join erp.products ep on ep.id = pp.id and ep.item_kind = ''product''
            where pp.original_price is not null
              and pp.original_price > pp.price
              ' || case when v_has_pub_exp then 'and (pp.sale_expires_at is null or pp.sale_expires_at > now())' else '' end || '
          )
          select
            count(*) filter (where (resolved->>''promotion_id'') is null),
            count(*) filter (where (resolved->>''promotion_id'') is not null and round((resolved->>''final_price_ars'')::numeric, 2) is distinct from round(legacy_promo_price, 2))
          from legacy_active';
        execute v_sql into v_cnt, v_cnt2;
        raise notice '[prices_promos] promos legacy vigentes sin promo ERP equivalente: % | con promo ERP pero distinto precio efectivo: %',
          v_cnt, v_cnt2;

        if v_cnt > 0 or v_cnt2 > 0 then
          v_sql := '
            with legacy_active as (
              select
                pp.id as product_id,
                pp.name as product_name,
                pp.price as legacy_promo_price,
                pp.original_price as legacy_list_price,
                ' || case when v_has_pub_exp then 'pp.sale_expires_at' else 'null::timestamptz' end || ' as sale_expires_at,
                (ep.id is not null) as has_erp_product,
                case when ep.id is not null then
                  erp.resolve_catalog_price_for_channel(ep.organization_id, ep.id, null, now(), ''web'')
                else null::jsonb end as resolved
              from public.products pp
              left join erp.products ep on ep.id = pp.id and ep.item_kind = ''product''
              where pp.original_price is not null
                and pp.original_price > pp.price
                ' || case when v_has_pub_exp then 'and (pp.sale_expires_at is null or pp.sale_expires_at > now())' else '' end || '
            )
            select
              product_id,
              product_name,
              legacy_promo_price,
              legacy_list_price,
              sale_expires_at,
              has_erp_product,
              (resolved->>''promotion_id'') as erp_promo_id,
              (resolved->>''final_price_ars'')::numeric as erp_effective
            from legacy_active
            where (resolved->>''promotion_id'') is null
               or round((resolved->>''final_price_ars'')::numeric, 2) is distinct from round(legacy_promo_price, 2)
            order by (resolved->>''promotion_id'') is not null, product_name, product_id
            limit 20';
          for v_rec in execute v_sql loop
            raise notice '  ejemplo promo_legacy_sin_equiv: id=% | nombre=% | pub_promo=% | pub_orig=% | erp_link=% | erp_promo=% | erp_eff=%',
              v_rec.product_id, v_rec.product_name, v_rec.legacy_promo_price, v_rec.legacy_list_price,
              v_rec.has_erp_product, v_rec.erp_promo_id, v_rec.erp_effective;
          end loop;
        end if;
      else
        raise notice '[prices_promos] comparación promos legacy vs ERP: erp.promotions/resolver no instalado (promos legacy vigentes=%)', v_cnt2;
      end if;
    else
      raise notice '[prices_promos] promos legacy: columna public.products.original_price ausente';
    end if;
  end if;

  -- 2.2 public.product_variants.price vs el resolver
  if to_regclass('public.product_variants') is null or to_regclass('erp.product_variants') is null then
    raise notice '[prices_promos] omitido variantes: falta public.product_variants o erp.product_variants';
  else
    select exists (select 1 from pg_attribute where attrelid = 'public.product_variants'::regclass and attname = 'price' and not attisdropped) into v_has_var_price;
    if not v_has_var_price then
      raise notice '[prices_promos] public.product_variants.price: columna no instalada (migración 20261114300000)';
    elsif not v_has_channel_resolver and not v_has_internal_resolver then
      raise notice '[prices_promos] resolver de precios ERP: no instalado';
    else
      v_sql := '
        with resolved_variants as (
          select
            pv.id as variant_id,
            pv.product_id,
            coalesce(pp.name, ep.internal_name) as product_name,
            pv.color as variant_color,
            pv.price as public_variant_price,
            ' || case
              when v_has_channel_resolver then
                'round((erp.resolve_catalog_price_for_channel(ev.organization_id, ev.product_id, ev.id, now(), ''web'')->>''list_price_ars'')::numeric, 2) as resolver_list_price,
                 round((erp.resolve_catalog_price_for_channel(ev.organization_id, ev.product_id, ev.id, now(), ''web'')->>''final_price_ars'')::numeric, 2) as resolver_web_price'
              else
                'round((erp.resolve_catalog_effective_price_internal(ev.organization_id, ev.product_id, ev.id, now())->>''final_price_ars'')::numeric, 2) as resolver_list_price,
                 round((erp.resolve_catalog_effective_price_internal(ev.organization_id, ev.product_id, ev.id, now())->>''final_price_ars'')::numeric, 2) as resolver_web_price'
            end || '
          from public.product_variants pv
          join erp.product_variants ev on ev.id = pv.id and ev.product_id = pv.product_id
          join erp.products ep on ep.id = ev.product_id and ep.organization_id = ev.organization_id
          left join public.products pp on pp.id = pv.product_id
        )
        select
          count(*) filter (where public_variant_price is distinct from resolver_list_price),
          count(*) filter (where public_variant_price is null),
          count(*) filter (where resolver_web_price is distinct from resolver_list_price)
        from resolved_variants';
      execute v_sql into v_cnt, v_cnt2, v_cnt3;
      raise notice '[prices_promos] diff public.product_variants.price vs resolver (list_price): % (nulls=%, variantes_con_promo_web_activa=%)',
        v_cnt, v_cnt2, v_cnt3;

      if v_cnt > 0 then
        v_sql := '
          with resolved_variants as (
            select
              pv.id as variant_id,
              pv.product_id,
              coalesce(pp.name, ep.internal_name) as product_name,
              pv.color as variant_color,
              pv.price as public_variant_price,
              ' || case
                when v_has_channel_resolver then
                  'round((erp.resolve_catalog_price_for_channel(ev.organization_id, ev.product_id, ev.id, now(), ''web'')->>''list_price_ars'')::numeric, 2) as resolver_list_price,
                   round((erp.resolve_catalog_price_for_channel(ev.organization_id, ev.product_id, ev.id, now(), ''web'')->>''final_price_ars'')::numeric, 2) as resolver_web_price'
                else
                  'round((erp.resolve_catalog_effective_price_internal(ev.organization_id, ev.product_id, ev.id, now())->>''final_price_ars'')::numeric, 2) as resolver_list_price,
                   round((erp.resolve_catalog_effective_price_internal(ev.organization_id, ev.product_id, ev.id, now())->>''final_price_ars'')::numeric, 2) as resolver_web_price'
              end || '
            from public.product_variants pv
            join erp.product_variants ev on ev.id = pv.id and ev.product_id = pv.product_id
            join erp.products ep on ep.id = ev.product_id and ep.organization_id = ev.organization_id
            left join public.products pp on pp.id = pv.product_id
          )
          select * from resolved_variants
          where public_variant_price is distinct from resolver_list_price
          order by product_name, variant_color, variant_id
          limit 20';
        for v_rec in execute v_sql loop
          raise notice '  ejemplo diff_variant_price: variant_id=% | product_id=% | nombre=% | color=% | pub_price=% | resolver_list=% | resolver_web=%',
            v_rec.variant_id, v_rec.product_id, v_rec.product_name, v_rec.variant_color,
            v_rec.public_variant_price, v_rec.resolver_list_price, v_rec.resolver_web_price;
        end loop;
      end if;
    end if;
  end if;

  -- 2.4 Promos ERP vigentes vs lo que expone la vista public.storefront_promotion_prices
  if not v_has_promos or not v_has_promo_targets then
    raise notice '[prices_promos] promos ERP: tablas erp.promotions / erp.promotion_targets no instaladas';
  elsif not v_has_promo_view then
    raise notice '[prices_promos] vista public.storefront_promotion_prices: no instalada';
  else
    select exists (select 1 from pg_attribute where attrelid = 'erp.products'::regclass and attname = 'web_status' and not attisdropped) into v_has_web_status;

    execute $q$
      select
        count(distinct p.id),
        count(*)
      from erp.promotions p
      join erp.promotion_targets t
        on t.promotion_id = p.id and t.organization_id = p.organization_id
      where p.is_active
        and t.is_active
        and 'web' = any(p.channels)
        and p.starts_at <= now()
        and (p.ends_at is null or now() < p.ends_at)
    $q$ into v_cnt, v_cnt2;
    execute 'select count(*) from public.storefront_promotion_prices where promotion_id is not null' into v_cnt3;
    raise notice '[prices_promos] promos ERP web vigentes: promos=% | targets=% | filas_con_promo_en_vista=%',
      v_cnt, v_cnt2, v_cnt3;

    v_sql := '
      with active_targets as (
        select
          p.id as promo_id,
          p.name as promo_name,
          p.kind,
          p.value,
          t.organization_id,
          t.product_id,
          t.variant_id,
          coalesce(nullif(ep.public_name, ''''), ep.internal_name) as product_name,
          exists (select 1 from erp.storefront_catalog_sync s where s.organization_id = t.organization_id) as has_sync,
          (ep.is_active and ep.can_sell and ep.publish_on_web and ep.allow_online_sale' ||
            case when v_has_web_status then ' and ep.web_status = ''published''' else '' end || ') as is_published,
          coalesce(ev.is_active, true) as variant_active,
          v.promotion_id as view_promo_id,
          v.list_price as view_list_price,
          v.effective_price as view_effective_price
        from erp.promotions p
        join erp.promotion_targets t
          on t.promotion_id = p.id and t.organization_id = p.organization_id
        join erp.products ep
          on ep.id = t.product_id and ep.organization_id = t.organization_id
        left join erp.product_variants ev
          on ev.id = t.variant_id and ev.product_id = t.product_id and ev.organization_id = t.organization_id
        left join public.storefront_promotion_prices v
          on v.product_id = t.product_id
         and v.variant_id is not distinct from t.variant_id
        where p.is_active
          and t.is_active
          and ''web'' = any(p.channels)
          and p.starts_at <= now()
          and (p.ends_at is null or now() < p.ends_at)
      )
      select
        count(*) filter (where view_promo_id is distinct from promo_id),
        count(*) filter (where not has_sync or not is_published or not variant_active)
      from active_targets';
    execute v_sql into v_cnt, v_cnt2;
    raise notice '[prices_promos] targets ERP web vigentes no ganadores/no expuestos en vista: % (por no_publicado/sin_sync/variante_inactiva=%)',
      v_cnt, v_cnt2;

    if v_cnt > 0 then
      v_sql := '
        with active_targets as (
          select
            p.id as promo_id,
            p.name as promo_name,
            t.product_id,
            t.variant_id,
            coalesce(nullif(ep.public_name, ''''), ep.internal_name) as product_name,
            exists (select 1 from erp.storefront_catalog_sync s where s.organization_id = t.organization_id) as has_sync,
            (ep.is_active and ep.can_sell and ep.publish_on_web and ep.allow_online_sale' ||
              case when v_has_web_status then ' and ep.web_status = ''published''' else '' end || ') as is_published,
            coalesce(ev.is_active, true) as variant_active,
            v.promotion_id as view_promo_id,
            v.list_price as view_list_price,
            v.effective_price as view_effective_price
          from erp.promotions p
          join erp.promotion_targets t
            on t.promotion_id = p.id and t.organization_id = p.organization_id
          join erp.products ep
            on ep.id = t.product_id and ep.organization_id = t.organization_id
          left join erp.product_variants ev
            on ev.id = t.variant_id and ev.product_id = t.product_id and ev.organization_id = t.organization_id
          left join public.storefront_promotion_prices v
            on v.product_id = t.product_id
           and v.variant_id is not distinct from t.variant_id
          where p.is_active
            and t.is_active
            and ''web'' = any(p.channels)
            and p.starts_at <= now()
            and (p.ends_at is null or now() < p.ends_at)
        )
        select *
        from active_targets
        where view_promo_id is distinct from promo_id
        order by promo_name, product_name, product_id
        limit 20';
      for v_rec in execute v_sql loop
        raise notice '  ejemplo promo_erp_vs_vista: promo_id=% | promo=% | product_id=% | producto=% | variant_id=% | sync=% | pub=% | var_act=% | vista_promo=%',
          v_rec.promo_id, v_rec.promo_name, v_rec.product_id, v_rec.product_name, v_rec.variant_id,
          v_rec.has_sync, v_rec.is_published, v_rec.variant_active, v_rec.view_promo_id;
      end loop;
    end if;

    -- Consistencia entre vista y resolver para productos publicados
    if v_has_channel_resolver then
      execute $q$
        with resolved_view as (
          select
            v.product_id,
            v.variant_id,
            coalesce(nullif(ep.public_name, ''), ep.internal_name) as product_name,
            v.list_price as view_list,
            v.effective_price as view_eff,
            v.promotion_id as view_promo,
            erp.resolve_catalog_price_for_channel(ep.organization_id, v.product_id, v.variant_id, now(), 'web') as res
          from public.storefront_promotion_prices v
          join erp.products ep on ep.id = v.product_id
        )
        select count(*)
        from resolved_view
        where view_list is distinct from (res->>'list_price_ars')::numeric
           or view_eff is distinct from (res->>'final_price_ars')::numeric
           or view_promo is distinct from (res->>'promotion_id')::uuid
      $q$ into v_cnt;
      raise notice '[prices_promos] diff vista storefront_promotion_prices vs resolver: %', v_cnt;
      if v_cnt > 0 then
        for v_rec in execute $q$
          with resolved_view as (
            select
              v.product_id,
              v.variant_id,
              coalesce(nullif(ep.public_name, ''), ep.internal_name) as product_name,
              v.list_price as view_list,
              v.effective_price as view_eff,
              v.promotion_id as view_promo,
              erp.resolve_catalog_price_for_channel(ep.organization_id, v.product_id, v.variant_id, now(), 'web') as res
            from public.storefront_promotion_prices v
            join erp.products ep on ep.id = v.product_id
          )
          select
            product_id,
            variant_id,
            product_name,
            view_eff,
            (res->>'final_price_ars')::numeric as res_eff,
            view_promo,
            (res->>'promotion_id')::uuid as res_promo
          from resolved_view
          where view_list is distinct from (res->>'list_price_ars')::numeric
             or view_eff is distinct from (res->>'final_price_ars')::numeric
             or view_promo is distinct from (res->>'promotion_id')::uuid
          order by product_name, product_id
          limit 20
        $q$ loop
          raise notice '  ejemplo diff_vista_resolver: product_id=% | variant_id=% | nombre=% | vista_eff=% | res_eff=%',
            v_rec.product_id, v_rec.variant_id, v_rec.product_name, v_rec.view_eff, v_rec.res_eff;
        end loop;
      end if;
    end if;
  end if;
end $$;

-- =============================================================================
-- 3. GRUPO: stock
-- =============================================================================
do $$
declare
  v_web_locs integer := 0;
  v_cnt bigint;
  v_sum_pub bigint;
  v_sum_proj bigint;
  v_rec record;
begin
  raise notice '------------------------------------------------------------------------';
  raise notice '[3] GRUPO: stock';
  raise notice '------------------------------------------------------------------------';

  if to_regclass('public.products') is null
     or to_regclass('erp.products') is null
     or to_regclass('erp.stock_balances') is null
     or to_regclass('erp.locations') is null then
    raise notice '[stock] omitido: faltan tablas de stock o public.products';
    return;
  end if;

  execute $q$
    select count(*) from erp.locations
    where is_active and contributes_to_web_stock
  $q$ into v_web_locs;
  raise notice '[stock] ubicaciones web activas (contributes_to_web_stock=true): %', v_web_locs;

  -- 3.1 Stock proyectado vs public.products.stock
  execute $q$
    with prod_calc as (
      select
        pp.id as product_id,
        pp.name as product_name,
        pp.stock as public_stock,
        greatest(coalesce(sum(b.quantity_on_hand - b.quantity_reserved), 0), 0)::bigint as projected_stock
      from public.products pp
      join erp.products ep on ep.id = pp.id and ep.item_kind = 'product'
      left join erp.stock_balances b
        on b.organization_id = ep.organization_id
       and b.product_id = ep.id
       and exists (
         select 1 from erp.locations l
         where l.id = b.location_id
           and l.organization_id = b.organization_id
           and l.is_active
           and l.contributes_to_web_stock
       )
      group by pp.id, pp.name, pp.stock
    )
    select
      count(*) filter (where public_stock::bigint is distinct from projected_stock),
      coalesce(sum(public_stock), 0),
      coalesce(sum(projected_stock), 0)
    from prod_calc
  $q$ into v_cnt, v_sum_pub, v_sum_proj;
  raise notice '[stock] productos vinculados diff: % | suma_public=% | suma_proyectado=%',
    v_cnt, v_sum_pub, v_sum_proj;

  if v_cnt > 0 then
    for v_rec in execute $q$
      with prod_calc as (
        select
          pp.id as product_id,
          pp.name as product_name,
          pp.stock as public_stock,
          greatest(coalesce(sum(b.quantity_on_hand - b.quantity_reserved), 0), 0)::bigint as projected_stock
        from public.products pp
        join erp.products ep on ep.id = pp.id and ep.item_kind = 'product'
        left join erp.stock_balances b
          on b.organization_id = ep.organization_id
         and b.product_id = ep.id
         and exists (
           select 1 from erp.locations l
           where l.id = b.location_id
             and l.organization_id = b.organization_id
             and l.is_active
             and l.contributes_to_web_stock
         )
        group by pp.id, pp.name, pp.stock
      )
      select * from prod_calc
      where public_stock::bigint is distinct from projected_stock
      order by abs(public_stock - projected_stock) desc, product_name, product_id
      limit 20
    $q$ loop
      raise notice '  ejemplo diff_stock_producto: id=% | nombre=% | web=% | proyectado=%',
        v_rec.product_id, v_rec.product_name, v_rec.public_stock, v_rec.projected_stock;
    end loop;
  end if;

  -- 3.2 Stock proyectado vs public.product_variants.stock
  if to_regclass('public.product_variants') is not null and to_regclass('erp.product_variants') is not null then
    execute $q$
      with var_calc as (
        select
          pv.id as variant_id,
          pv.product_id,
          coalesce(pp.name, ep.internal_name) as product_name,
          pv.color as variant_color,
          pv.stock as public_stock,
          greatest(coalesce(sum(b.quantity_on_hand - b.quantity_reserved), 0), 0)::bigint as projected_stock
        from public.product_variants pv
        join erp.product_variants ev on ev.id = pv.id and ev.product_id = pv.product_id
        join erp.products ep on ep.id = ev.product_id and ep.organization_id = ev.organization_id
        left join public.products pp on pp.id = pv.product_id
        left join erp.stock_balances b
          on b.organization_id = ev.organization_id
         and b.product_id = ev.product_id
         and b.variant_id = ev.id
         and exists (
           select 1 from erp.locations l
           where l.id = b.location_id
             and l.organization_id = b.organization_id
             and l.is_active
             and l.contributes_to_web_stock
         )
        group by pv.id, pv.product_id, coalesce(pp.name, ep.internal_name), pv.color, pv.stock
      )
      select
        count(*) filter (where public_stock::bigint is distinct from projected_stock),
        coalesce(sum(public_stock), 0),
        coalesce(sum(projected_stock), 0)
      from var_calc
    $q$ into v_cnt, v_sum_pub, v_sum_proj;
    raise notice '[stock] variantes vinculadas diff: % | suma_public=% | suma_proyectado=%',
      v_cnt, v_sum_pub, v_sum_proj;

    if v_cnt > 0 then
      for v_rec in execute $q$
        with var_calc as (
          select
            pv.id as variant_id,
            pv.product_id,
            coalesce(pp.name, ep.internal_name) as product_name,
            pv.color as variant_color,
            pv.stock as public_stock,
            greatest(coalesce(sum(b.quantity_on_hand - b.quantity_reserved), 0), 0)::bigint as projected_stock
          from public.product_variants pv
          join erp.product_variants ev on ev.id = pv.id and ev.product_id = pv.product_id
          join erp.products ep on ep.id = ev.product_id and ep.organization_id = ev.organization_id
          left join public.products pp on pp.id = pv.product_id
          left join erp.stock_balances b
            on b.organization_id = ev.organization_id
           and b.product_id = ev.product_id
           and b.variant_id = ev.id
           and exists (
             select 1 from erp.locations l
             where l.id = b.location_id
               and l.organization_id = b.organization_id
               and l.is_active
               and l.contributes_to_web_stock
           )
          group by pv.id, pv.product_id, coalesce(pp.name, ep.internal_name), pv.color, pv.stock
        )
        select * from var_calc
        where public_stock::bigint is distinct from projected_stock
        order by abs(public_stock - projected_stock) desc, product_name, variant_color, variant_id
        limit 20
      $q$ loop
        raise notice '  ejemplo diff_stock_variante: variant_id=% | product_id=% | nombre=% | color=% | web=% | proyectado=%',
          v_rec.variant_id, v_rec.product_id, v_rec.product_name, v_rec.variant_color, v_rec.public_stock, v_rec.projected_stock;
      end loop;
    end if;

    -- Productos con variantes cuyo stock padre difiere de suma(variantes) en public
    execute $q$
      select count(*)
      from public.products pp
      where exists (select 1 from public.product_variants pv where pv.product_id = pp.id)
        and pp.stock <> (select coalesce(sum(pv.stock), 0) from public.product_variants pv where pv.product_id = pp.id)
    $q$ into v_cnt;
    raise notice '[stock] public.products con variantes donde parent.stock <> sum(variants.stock): %', v_cnt;
    if v_cnt > 0 then
      for v_rec in execute $q$
        select
          pp.id,
          pp.name,
          pp.stock as parent_stock,
          (select coalesce(sum(pv.stock), 0) from public.product_variants pv where pv.product_id = pp.id) as variants_sum
        from public.products pp
        where exists (select 1 from public.product_variants pv where pv.product_id = pp.id)
          and pp.stock <> (select coalesce(sum(pv.stock), 0) from public.product_variants pv where pv.product_id = pp.id)
        order by pp.name, pp.id
        limit 20
      $q$ loop
        raise notice '  ejemplo inconsistencia_padre_variantes: id=% | nombre=% | padre=% | sum_variantes=%',
          v_rec.id, v_rec.name, v_rec.parent_stock, v_rec.variants_sum;
      end loop;
    end if;
  end if;
end $$;

-- =============================================================================
-- 4. GRUPO: repairs
-- =============================================================================
do $$
declare
  v_has_public_code boolean := false;
  v_has_is_deleted boolean := false;
  v_pub_total bigint := 0;
  v_pub_active bigint := 0;
  v_erp_total bigint := 0;
  v_matched_id bigint := 0;
  v_matched_code bigint := 0;
  v_unmirrored bigint := 0;
begin
  raise notice '------------------------------------------------------------------------';
  raise notice '[4] GRUPO: repairs';
  raise notice '------------------------------------------------------------------------';

  if to_regclass('public.repairs') is null or to_regclass('erp.repair_orders') is null then
    raise notice '[repairs] omitido: falta public.repairs (%) o erp.repair_orders (%)',
      coalesce(to_regclass('public.repairs')::text, 'ausente'),
      coalesce(to_regclass('erp.repair_orders')::text, 'ausente');
    return;
  end if;

  select exists (select 1 from pg_attribute where attrelid = 'public.repairs'::regclass and attname = 'is_deleted' and not attisdropped) into v_has_is_deleted;
  select exists (select 1 from pg_attribute where attrelid = 'erp.repair_orders'::regclass and attname = 'public_tracking_code' and not attisdropped) into v_has_public_code;

  execute 'select count(*) from public.repairs' into v_pub_total;
  if v_has_is_deleted then
    execute 'select count(*) from public.repairs where not coalesce(is_deleted, false)' into v_pub_active;
  else
    v_pub_active := v_pub_total;
  end if;
  execute 'select count(*) from erp.repair_orders' into v_erp_total;

  execute '
    select count(*)
    from public.repairs r
    where ' || case when v_has_is_deleted then 'not coalesce(r.is_deleted, false) and ' else '' end || '
      exists (select 1 from erp.repair_orders er where er.id = r.id)'
    into v_matched_id;

  if v_has_public_code then
    execute '
      select
        count(*) filter (where exists (
          select 1 from erp.repair_orders er
          where upper(btrim(er.public_tracking_code)) = upper(btrim(r.tracking_code))
        )),
        count(*) filter (where not exists (
          select 1 from erp.repair_orders er
          where er.id = r.id
             or upper(btrim(er.public_tracking_code)) = upper(btrim(r.tracking_code))
        ))
      from public.repairs r
      where ' || case when v_has_is_deleted then 'not coalesce(r.is_deleted, false)' else 'true' end
      into v_matched_code, v_unmirrored;
  else
    v_matched_code := 0;
    v_unmirrored := v_pub_active - v_matched_id;
  end if;

  raise notice '[repairs] public.repairs total=% (activas=%) | erp.repair_orders total=%',
    v_pub_total, v_pub_active, v_erp_total;
  raise notice '[repairs] reparaciones legacy activas sin espejo ERP: % (coinciden_por_id=%, coinciden_por_tracking_code=%, public_tracking_code_disponible=%)',
    v_unmirrored, v_matched_id, v_matched_code, v_has_public_code;
  raise notice '[repairs] nota: no existe tabla puente explícita entre public.repairs y erp.repair_orders; se compara por id o tracking_code=public_tracking_code (sin exponer datos de clientes).';
end $$;

-- =============================================================================
-- 5. BANDERAS DE CORTE Y EVENTOS DE CANARIO (7 Y 30 DÍAS)
-- =============================================================================
do $$
declare
  v_rec record;
  v_cnt bigint := 0;
begin
  raise notice '------------------------------------------------------------------------';
  raise notice '[5] BANDERAS DE CORTE Y CANARIOS';
  raise notice '------------------------------------------------------------------------';

  if to_regclass('erp.storefront_cutover_groups') is null then
    raise notice '[banderas] erp.storefront_cutover_groups: no instalado';
  else
    for v_rec in execute $q$
      select
        organization_id,
        group_code,
        admin_tab_hidden,
        legacy_write_mode,
        updated_at
      from erp.storefront_cutover_groups
      order by organization_id, group_code
    $q$ loop
      v_cnt := v_cnt + 1;
      raise notice '[bandera] org=% | grupo=% | admin_tab_hidden=% | legacy_write_mode=% | updated_at=%',
        v_rec.organization_id, v_rec.group_code, v_rec.admin_tab_hidden, v_rec.legacy_write_mode, v_rec.updated_at;
    end loop;
    if v_cnt = 0 then
      raise notice '[banderas] erp.storefront_cutover_groups sin filas';
    end if;
  end if;

  if to_regclass('erp.legacy_write_canary_events') is null then
    raise notice '[canarios] erp.legacy_write_canary_events: no instalado';
  else
    for v_rec in execute $q$
      with groups as (
        select unnest(array['catalog', 'stock', 'prices_promos', 'repairs', 'dashboard']) as group_code
      )
      select
        g.group_code,
        count(e.id) filter (where e.created_at >= now() - interval '7 days') as events_7d,
        count(e.id) filter (where e.created_at >= now() - interval '30 days') as events_30d,
        count(e.id) as events_total
      from groups g
      left join erp.legacy_write_canary_events e on e.group_code = g.group_code
      group by g.group_code
      order by g.group_code
    $q$ loop
      raise notice '[canario] grupo=% | ultimos_7d=% | ultimos_30d=% | total=%',
        v_rec.group_code, v_rec.events_7d, v_rec.events_30d, v_rec.events_total;
    end loop;

    for v_rec in execute $q$
      select
        group_code,
        table_name,
        operation,
        count(*) filter (where created_at >= now() - interval '7 days') as events_7d,
        count(*) as events_30d
      from erp.legacy_write_canary_events
      where created_at >= now() - interval '30 days'
      group by group_code, table_name, operation
      order by events_30d desc, group_code, table_name, operation
      limit 20
    $q$ loop
      raise notice '  detalle canario 30d: grupo=% | tabla=% | op=% | 7d=% | 30d=%',
        v_rec.group_code, v_rec.table_name, v_rec.operation, v_rec.events_7d, v_rec.events_30d;
    end loop;
  end if;
end $$;

-- =============================================================================
-- 6. CONTEO DE FILAS POR TABLA RELEVANTE (public.* y erp.*)
-- =============================================================================
do $$
declare
  v_tables text[] := array[
    'public.products',
    'public.product_variants',
    'public.categories',
    'public.brands',
    'public.models',
    'public.colors',
    'public.capacities',
    'public.inventory_movements',
    'public.orders',
    'public.repairs',
    'public.repair_logs',
    'public.repair_statuses',
    'public.posts',
    'public.hero_banners',
    'public.storefront_promotion_prices',
    'erp.organizations',
    'erp.branches',
    'erp.locations',
    'erp.products',
    'erp.product_variants',
    'erp.product_categories',
    'erp.brands',
    'erp.product_models',
    'erp.colors',
    'erp.product_media',
    'erp.product_compatible_models',
    'erp.stock_balances',
    'erp.stock_documents',
    'erp.stock_movements',
    'erp.stock_reservations',
    'erp.promotions',
    'erp.promotion_targets',
    'erp.web_orders',
    'erp.web_order_lines',
    'erp.web_provider_payments',
    'erp.repair_orders',
    'erp.repair_state_events',
    'erp.repair_notes',
    'erp.repair_deliveries',
    'erp.storefront_catalog_sync',
    'erp.storefront_stock_projection',
    'erp.storefront_stock_capture',
    'erp.storefront_cutover_groups',
    'erp.legacy_write_canary_events'
  ];
  v_tbl text;
  v_cnt bigint;
begin
  raise notice '------------------------------------------------------------------------';
  raise notice '[6] CONTEO DE FILAS POR TABLA RELEVANTE';
  raise notice '------------------------------------------------------------------------';

  foreach v_tbl in array v_tables loop
    if to_regclass(v_tbl) is null then
      raise notice '[conteo] %: no instalado', v_tbl;
    else
      execute format('select count(*) from %s', v_tbl) into v_cnt;
      raise notice '[conteo] %: %', v_tbl, v_cnt;
    end if;
  end loop;

  raise notice '========================================================================';
  raise notice 'FIN DE CONCILIACIÓN';
  raise notice '========================================================================';
end $$;

rollback;
