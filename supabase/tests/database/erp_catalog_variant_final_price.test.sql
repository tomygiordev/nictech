-- ============================================================================
-- Smoke Test: ERP Catalog Variant Final Price & Canonical Price Resolver
-- Slice #1221 - Self-contained transactional test suite (Single DO with P9001 Sentinel)
-- ============================================================================
-- INVARIANTS TESTED:
-- 1. Table constraint: erp.product_variants.final_price_ars enforces >= 0, finite, rejects negatives and NaN. Null allowed (inherits). Zero allowed.
-- 2. create_catalog_product_with_variants:
--    - Uses actor in organization WITHOUT storefront sync bridge to prevent writes to public tables.
--    - If no such actor exists, skips runtime creation test explicitly and reports it.
-- 3. manage_product_variants:
--    a. B1 Regression: New variant inherit as first/only row does not fail with 55000 (unassigned v_existing_var).
--    b. B1 Regression: Existing variant with delta followed by new inherit variant resets local delta and does not leak delta to the new variant.
--    c. Adds new variants with own final price ARS or inheriting.
--    d. Updates existing variants to set own final price or switch back to inherit (final_price_mode: 'inherit').
--    e. Omission invariant: omitting price fields preserves existing override without accidental reset to null.
--    f. Pause / reactivate preserves override price, UUID, stock balance and non-color attributes.
--    g. Optimistic concurrency conflict check via expected_updated_at.
--    h. Rejects negative or NaN prices.
-- 4. resolve_catalog_effective_price:
--    a. Parent without variant resolves to parent base sale price (parent_base).
--    b. Variant with own final price override resolves to final_price_ars (variant_override, is_override=true).
--    c. Variant inheriting resolves to parent price (parent_inherited).
--    d. Parent price update alters inherited variant price but leaves override variant strictly unchanged.
--    e. Legacy delta: variant with price_delta and null final_price_ars resolves to parent + delta (legacy_delta).
--    f. Override vs delta: explicit final_price_ars wins over price_delta (override beats delta).
--    g. Zero price: final_price_ars = 0 resolves as variant_override (is_override=true).
--    h. Exact 100.005 numeric(18,4) resolution without rounding or tax recalculation.
-- 5. Multi-tenant & permissions:
--    a. REAL cross-tenant test: creates foreign org + foreign product_type/unit/product/variant fixtures, queries those IDs from current actor and verifies rejection.
--    b. Unauthenticated or unauthorized calls rejected with insufficient_privilege.
-- 6. Storefront cleanliness: assert CERO rows in public.products and public.product_variants for test fixtures.
-- 7. Clean rollback via P9001 sentinel: zero residual rows in database.
-- ============================================================================

begin;

set local statement_timeout = '30s';
set local lock_timeout = '10s';

do $$
declare
  r_cand record;
  v_admin_uid uuid;
  v_org_id uuid;
  v_unit_id uuid;
  v_type_id uuid;

  -- Organization without storefront sync for createRPC test
  v_no_sync_admin_uid uuid;
  v_no_sync_org_id uuid;
  v_no_sync_unit_id uuid;
  v_no_sync_type_id uuid;
  v_can_test_create_rpc boolean := false;

  v_test_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_sku_fixture text;
  v_sku_create text;

  -- Foreign tenant fixtures
  v_foreign_org_id uuid := gen_random_uuid();
  v_foreign_unit_id uuid := gen_random_uuid();
  v_foreign_type_id uuid := gen_random_uuid();
  v_foreign_prod_id uuid := gen_random_uuid();
  v_foreign_var_id uuid := gen_random_uuid();

  -- Products & variants under test org
  v_prod_a uuid := gen_random_uuid();
  v_prod_create_id uuid;
  v_var_inherit_id uuid := gen_random_uuid();
  v_var_override_id uuid := gen_random_uuid();
  v_var_delta_id uuid := gen_random_uuid();
  v_var_zero_id uuid := gen_random_uuid();
  v_var_exact_id uuid := gen_random_uuid();
  v_var_new_id uuid;

  v_location_id uuid;
  v_res jsonb;
  v_price_res jsonb;
  v_variants_res jsonb;
  v_failed boolean;
  v_saved_override numeric(18, 4);
  v_saved_attrs jsonb;
  v_public_count int;
  v_stale_updated_at timestamptz := now() - interval '1 hour';
begin
  begin
    -- ------------------------------------------------------------------------
    -- 1. Discover Active Tenant & Profile with catalog.manage
    -- ------------------------------------------------------------------------
    for r_cand in
      select p.id as profile_id, p.organization_id
        from erp.profiles p
        join erp.organizations o on o.id = p.organization_id and o.is_active = true
       where p.is_active = true
       order by p.created_at asc
    loop
      select id into v_unit_id
        from erp.units_of_measure
       where organization_id = r_cand.organization_id and is_active = true
       limit 1;

      select id into v_type_id
        from erp.product_types
       where organization_id = r_cand.organization_id and item_kind = 'product' and is_active = true
       limit 1;

      if v_unit_id is not null and v_type_id is not null then
        perform set_config('request.jwt.claim.sub', r_cand.profile_id::text, true);
        perform set_config('request.jwt.claims', json_build_object('sub', r_cand.profile_id, 'role', 'authenticated')::text, true);

        if erp.has_permission('catalog.manage') and erp.has_permission('catalog.view') then
          v_admin_uid := r_cand.profile_id;
          v_org_id := r_cand.organization_id;

          -- Check if this org has NO storefront sync enabled
          if not exists (select 1 from erp.storefront_catalog_sync where organization_id = r_cand.organization_id) then
            v_no_sync_admin_uid := r_cand.profile_id;
            v_no_sync_org_id := r_cand.organization_id;
            v_no_sync_unit_id := v_unit_id;
            v_no_sync_type_id := v_type_id;
            v_can_test_create_rpc := true;
          end if;

          exit;
        end if;
      end if;
    end loop;

    if v_admin_uid is null then
      raise exception 'PRECONDITION FAILED: no active ERP profile with catalog.manage and catalog.view found';
    end if;

    -- If the first admin's org has storefront sync, look for another org without sync
    if not v_can_test_create_rpc then
      for r_cand in
        select p.id as profile_id, p.organization_id
          from erp.profiles p
          join erp.organizations o on o.id = p.organization_id and o.is_active = true
         where p.is_active = true
           and not exists (select 1 from erp.storefront_catalog_sync where organization_id = p.organization_id)
         order by p.created_at asc
      loop
        select id into v_no_sync_unit_id
          from erp.units_of_measure
         where organization_id = r_cand.organization_id and is_active = true
         limit 1;

        select id into v_no_sync_type_id
          from erp.product_types
         where organization_id = r_cand.organization_id and item_kind = 'product' and is_active = true
         limit 1;

        if v_no_sync_unit_id is not null and v_no_sync_type_id is not null then
          perform set_config('request.jwt.claim.sub', r_cand.profile_id::text, true);
          perform set_config('request.jwt.claims', json_build_object('sub', r_cand.profile_id, 'role', 'authenticated')::text, true);

          if erp.has_permission('catalog.manage') and erp.has_permission('catalog.view') then
            v_no_sync_admin_uid := r_cand.profile_id;
            v_no_sync_org_id := r_cand.organization_id;
            v_can_test_create_rpc := true;
            exit;
          end if;
        end if;
      end loop;
    end if;

    -- Switch back to main test actor
    perform set_config('request.jwt.claim.sub', v_admin_uid::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin_uid, 'role', 'authenticated')::text, true);

    v_sku_fixture := 'FXT-P-' || v_test_suffix;
    v_sku_create := 'CRT-P-' || v_test_suffix;

    -- ------------------------------------------------------------------------
    -- 2. Constraint Checks on erp.product_variants.final_price_ars (Negative & NaN)
    -- ------------------------------------------------------------------------
    -- Negative price check
    v_failed := false;
    begin
      insert into erp.product_variants (
        organization_id, product_id, code, name, final_price_ars, is_active
      ) values (
        v_org_id, v_prod_a, 'FAIL-NEG', 'Negativo', -500, true
      );
    exception when check_violation then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'ASSERTION FAILED: negative final_price_ars must be rejected by check constraint';
    end if;

    -- NaN price check
    v_failed := false;
    begin
      insert into erp.product_variants (
        organization_id, product_id, code, name, final_price_ars, is_active
      ) values (
        v_org_id, v_prod_a, 'FAIL-NAN', 'NaN Price', 'NaN'::numeric, true
      );
    exception when check_violation then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'ASSERTION FAILED: NaN final_price_ars must be rejected by check constraint';
    end if;

    -- ------------------------------------------------------------------------
    -- 3. Create unpublished product fixture (flags false) for resolver & management
    -- ------------------------------------------------------------------------
    insert into erp.products (
      id, organization_id, product_type_id, item_kind, unit_id,
      internal_code, internal_name, public_name, inventory_tracking,
      base_cost, base_sale_price, tax_rate_percent,
      can_sell, can_use_as_repair_part, publish_on_web, allow_online_sale,
      is_active, created_by
    ) values (
      v_prod_a, v_org_id, v_type_id, 'product', v_unit_id,
      v_sku_fixture, 'Fixture Test Precios ' || v_test_suffix, 'Fixture Test ' || v_test_suffix,
      'quantity', 5000, 10000, 21,
      true, false, false, false, -- publish_on_web = false, allow_online_sale = false
      true, v_admin_uid
    );

    -- Insert variant 1: Inherited (final_price_ars is null)
    insert into erp.product_variants (
      id, organization_id, product_id, code, name, attributes, price_delta, final_price_ars, is_active
    ) values (
      v_var_inherit_id, v_org_id, v_prod_a, 'INH', 'Heredado', jsonb_build_object('color', 'Heredado'), 0, null, true
    );

    -- Insert variant 2: Override (final_price_ars = 13500.50) with non-color attribute
    insert into erp.product_variants (
      id, organization_id, product_id, code, name, attributes, price_delta, final_price_ars, is_active
    ) values (
      v_var_override_id, v_org_id, v_prod_a, 'OVR', 'Propio', jsonb_build_object('color', 'Propio', 'material', 'cuero'), 0, 13500.50, true
    );

    -- Insert primary barcode for variant 2
    insert into erp.product_identifiers (
      organization_id, product_id, variant_id, kind, value, is_primary, is_active, created_by
    ) values (
      v_org_id, v_prod_a, v_var_override_id, 'barcode', '779' || v_test_suffix, true, true, v_admin_uid
    );

    -- Optional: Stock balance fixture for pause/reactivation test
    select id into v_location_id
      from erp.locations
     where organization_id = v_org_id and is_active = true
     limit 1;

    if v_location_id is not null then
      insert into erp.stock_balances (
        organization_id, branch_id, location_id, product_id, variant_id, quantity_on_hand, quantity_reserved
      )
      select v_org_id, l.branch_id, v_location_id, v_prod_a, v_var_override_id, 10, 2
        from erp.locations l
       where l.id = v_location_id;
    end if;

    -- ------------------------------------------------------------------------
    -- 4. create_catalog_product_with_variants test (ONLY if org has no storefront sync)
    -- ------------------------------------------------------------------------
    if v_can_test_create_rpc then
      perform set_config('request.jwt.claim.sub', v_no_sync_admin_uid::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub', v_no_sync_admin_uid, 'role', 'authenticated')::text, true);

      v_res := erp.create_catalog_product_with_variants(
        p_internal_code => v_sku_create,
        p_internal_name => 'Producto Alta RPC ' || v_test_suffix,
        p_item_kind => 'product',
        p_inventory_tracking => 'quantity',
        p_unit_id => v_no_sync_unit_id,
        p_base_cost => 3000,
        p_base_sale_price => 8000,
        p_tax_rate_percent => 21,
        p_variants => jsonb_build_array(
          jsonb_build_object(
            'code', 'INH-CRT',
            'name', 'Heredado Create',
            'final_price_mode', 'inherit'
          ),
          jsonb_build_object(
            'code', 'OVR-CRT',
            'name', 'Propio Create',
            'final_price_mode', 'own',
            'final_price_ars', 11999.99,
            'sku', 'SKU-CRT-' || v_test_suffix
          )
        )
      );

      v_prod_create_id := (v_res->>'product_id')::uuid;
      if v_prod_create_id is null then
        raise exception 'ASSERTION FAILED: create_catalog_product_with_variants failed to return product_id';
      end if;

      -- Switch back to main actor
      perform set_config('request.jwt.claim.sub', v_admin_uid::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub', v_admin_uid, 'role', 'authenticated')::text, true);
    else
      raise notice 'SKIPPED_CREATE_RPC_RUNTIME: no active ERP actor found in organization without storefront sync';
    end if;

    -- ------------------------------------------------------------------------
    -- 5. resolve_catalog_effective_price tests (Scope acotado: base/override/legacy delta, NO listas ni IVA extra)
    -- ------------------------------------------------------------------------
    -- 5a. Parent without variant: parent_base (10000)
    v_price_res := erp.resolve_catalog_effective_price(p_product_id => v_prod_a);
    if (v_price_res->>'final_price_ars')::numeric <> 10000
      or v_price_res->>'price_source' <> 'parent_base'
      or (v_price_res->>'is_override')::boolean <> false
      or v_price_res ? 'price_list_id'
      or v_price_res ? 'net_price_ars'
      or v_price_res ? 'tax_amount_ars' then
      raise exception 'ASSERTION FAILED: parent_base resolution incorrect or contains unexpected fields: %', v_price_res;
    end if;

    -- 5b. Inherited variant: parent_inherited (10000)
    v_price_res := erp.resolve_catalog_effective_price(p_product_id => v_prod_a, p_variant_id => v_var_inherit_id);
    if (v_price_res->>'final_price_ars')::numeric <> 10000
      or v_price_res->>'price_source' <> 'parent_inherited'
      or (v_price_res->>'is_override')::boolean <> false then
      raise exception 'ASSERTION FAILED: inherited variant resolution incorrect: %', v_price_res;
    end if;

    -- 5c. Override variant: variant_override (13500.50)
    v_price_res := erp.resolve_catalog_effective_price(p_product_id => v_prod_a, p_variant_id => v_var_override_id);
    if (v_price_res->>'final_price_ars')::numeric <> 13500.50
      or v_price_res->>'price_source' <> 'variant_override'
      or (v_price_res->>'is_override')::boolean <> true then
      raise exception 'ASSERTION FAILED: override variant resolution incorrect: %', v_price_res;
    end if;

    -- 5d. Parent price alteration: inherited tracks parent price, override stays unchanged
    update erp.products
       set base_sale_price = 12000
     where id = v_prod_a;

    v_price_res := erp.resolve_catalog_effective_price(p_product_id => v_prod_a, p_variant_id => v_var_inherit_id);
    if (v_price_res->>'final_price_ars')::numeric <> 12000 then
      raise exception 'ASSERTION FAILED: inherited variant should track new parent price 12000, got %', v_price_res;
    end if;

    v_price_res := erp.resolve_catalog_effective_price(p_product_id => v_prod_a, p_variant_id => v_var_override_id);
    if (v_price_res->>'final_price_ars')::numeric <> 13500.50 then
      raise exception 'ASSERTION FAILED: override variant should remain at 13500.50, got %', v_price_res;
    end if;

    -- 5e. Legacy delta: variant with price_delta = 1500 and final_price_ars = null resolves to base + delta
    insert into erp.product_variants (
      id, organization_id, product_id, code, name, price_delta, final_price_ars, is_active
    ) values (
      v_var_delta_id, v_org_id, v_prod_a, 'DLT', 'Delta Legacy', 1500, null, true
    );

    v_price_res := erp.resolve_catalog_effective_price(p_product_id => v_prod_a, p_variant_id => v_var_delta_id);
    if (v_price_res->>'final_price_ars')::numeric <> 13500 -- 12000 base + 1500 delta
      or v_price_res->>'price_source' <> 'legacy_delta'
      or (v_price_res->>'is_override')::boolean <> false then
      raise exception 'ASSERTION FAILED: legacy delta resolution incorrect: %', v_price_res;
    end if;

    -- 5f. Override beats legacy delta: if we set final_price_ars on that same variant, override wins!
    update erp.product_variants
       set final_price_ars = 14000
     where id = v_var_delta_id;

    v_price_res := erp.resolve_catalog_effective_price(p_product_id => v_prod_a, p_variant_id => v_var_delta_id);
    if (v_price_res->>'final_price_ars')::numeric <> 14000
      or v_price_res->>'price_source' <> 'variant_override'
      or (v_price_res->>'is_override')::boolean <> true then
      raise exception 'ASSERTION FAILED: override should beat legacy delta: %', v_price_res;
    end if;

    -- 5g. Cero ($0) price test: final_price_ars = 0 is a valid absolute own price (e.g. promo/sample)
    insert into erp.product_variants (
      id, organization_id, product_id, code, name, price_delta, final_price_ars, is_active
    ) values (
      v_var_zero_id, v_org_id, v_prod_a, 'ZERO', 'Muestra Cero', 0, 0, true
    );

    v_price_res := erp.resolve_catalog_effective_price(p_product_id => v_prod_a, p_variant_id => v_var_zero_id);
    if (v_price_res->>'final_price_ars')::numeric <> 0
      or v_price_res->>'price_source' <> 'variant_override'
      or (v_price_res->>'is_override')::boolean <> true then
      raise exception 'ASSERTION FAILED: zero price resolution incorrect: %', v_price_res;
    end if;

    -- 5h. Exact 100.005 numeric(18,4) price test (preserved without rounding or IVA surcharge)
    insert into erp.product_variants (
      id, organization_id, product_id, code, name, price_delta, final_price_ars, is_active
    ) values (
      v_var_exact_id, v_org_id, v_prod_a, 'EXACT', 'Fraccionario 100.005', 0, 100.0050, true
    );

    v_price_res := erp.resolve_catalog_effective_price(p_product_id => v_prod_a, p_variant_id => v_var_exact_id);
    if (v_price_res->>'final_price_ars')::numeric <> 100.0050
      or v_price_res->>'price_source' <> 'variant_override' then
      raise exception 'ASSERTION FAILED: 100.005 exact price resolution failed: %', v_price_res;
    end if;

    -- ------------------------------------------------------------------------
    -- 6. manage_product_variants RPC tests & B1 regressions
    -- ------------------------------------------------------------------------
    -- 6a. B1 Regression 1: New inherit variant as FIRST / ONLY row must not fail with error 55000
    v_res := erp.manage_product_variants(
      p_product_id => v_prod_a,
      p_variants => jsonb_build_array(
        jsonb_build_object(
          'id', null, -- New variant as FIRST/ONLY row
          'code', 'NEW-FIRST-INH',
          'name', 'Nuevo Primero Heredado',
          'final_price_mode', 'inherit',
          'is_active', true
        )
      )
    );

    -- Must return effective_price_ars = 12000 (parent base) without crashing
    if ((v_res->'variants'->0)->>'effective_price_ars')::numeric <> 12000
      or ((v_res->'variants'->0)->>'is_override')::boolean <> false
      or (v_res->'variants'->0)->>'final_price_ars' is not null then
      raise exception 'ASSERTION FAILED B1: first new inherit variant return incorrect: %', v_res;
    end if;

    -- 6b. B1 Regression 2: Existing variant with delta followed by new inherit variant must NOT leak delta
    -- First reset DLT to final_price_ars = null so it has price_delta = 1500
    update erp.product_variants
       set final_price_ars = null
     where id = v_var_delta_id;

    v_res := erp.manage_product_variants(
      p_product_id => v_prod_a,
      p_variants => jsonb_build_array(
        jsonb_build_object(
          'id', v_var_delta_id, -- Row 1: Existing with delta 1500
          'code', 'DLT',
          'name', 'Delta Legacy Editado',
          'final_price_mode', 'inherit',
          'is_active', true
        ),
        jsonb_build_object(
          'id', null, -- Row 2: New inherit variant following existing delta
          'code', 'NEW-AFTER-DLT',
          'name', 'Nuevo Tras Delta',
          'final_price_mode', 'inherit',
          'is_active', true
        )
      )
    );

    -- Row 1: base (12000) + delta (1500) = 13500
    if ((v_res->'variants'->0)->>'effective_price_ars')::numeric <> 13500 then
      raise exception 'ASSERTION FAILED B1: existing delta row effective price should be 13500, got %', v_res;
    end if;

    -- Row 2: MUST BE 12000 (parent base), NOT 13500 (must not leak delta from row 1!)
    if ((v_res->'variants'->1)->>'effective_price_ars')::numeric <> 12000 then
      raise exception 'ASSERTION FAILED B1: new variant after delta leaked delta 1500, got %', v_res;
    end if;

    -- 6c. Add new variant with own price and update existing to switch to own / inherit
    v_res := erp.manage_product_variants(
      p_product_id => v_prod_a,
      p_variants => jsonb_build_array(
        jsonb_build_object(
          'id', v_var_inherit_id,
          'code', 'INH',
          'name', 'Heredado Editado',
          'final_price_mode', 'inherit',
          'is_active', true
        ),
        jsonb_build_object(
          'id', v_var_override_id,
          'code', 'OVR',
          'name', 'Propio Editado',
          'final_price_mode', 'own',
          'final_price_ars', 15000,
          'is_active', true
        ),
        jsonb_build_object(
          'id', null,
          'code', 'NEW-OWN',
          'name', 'Nuevo Propio',
          'final_price_mode', 'own',
          'final_price_ars', 19999.99,
          'is_active', true
        )
      )
    );

    select id into v_var_new_id
      from erp.product_variants
     where product_id = v_prod_a and code = 'NEW-OWN';

    if v_var_new_id is null then
      raise exception 'ASSERTION FAILED: new variant NEW-OWN was not created';
    end if;

    select final_price_ars into v_saved_override
      from erp.product_variants
     where id = v_var_new_id;
    if v_saved_override <> 19999.99 then
      raise exception 'ASSERTION FAILED: NEW-OWN variant should have final_price_ars = 19999.99, got %', v_saved_override;
    end if;

    -- 6d. Omission Invariant: omitting final_price_ars & final_price_mode DOES NOT wipe existing override!
    v_res := erp.manage_product_variants(
      p_product_id => v_prod_a,
      p_variants => jsonb_build_array(
        jsonb_build_object(
          'id', v_var_override_id,
          'code', 'OVR',
          'name', 'Propio Renombrado',
          'is_active', true
          -- OMITTING final_price_mode and final_price_ars!
        )
      )
    );

    select final_price_ars into v_saved_override
      from erp.product_variants
     where id = v_var_override_id;

    if v_saved_override <> 15000 then
      raise exception 'ASSERTION FAILED: omitting price fields must preserve existing override 15000, got %', v_saved_override;
    end if;

    -- 6e. Pause & Reactivate Invariant: preserves override price, UUID, barcode, stock and non-color attributes
    -- Pause variant:
    v_res := erp.manage_product_variants(
      p_product_id => v_prod_a,
      p_variants => jsonb_build_array(
        jsonb_build_object(
          'id', v_var_override_id,
          'code', 'OVR',
          'name', 'Propio Pausado',
          'is_active', false
        )
      )
    );

    select final_price_ars, attributes, is_active
      into v_saved_override, v_saved_attrs, v_failed
      from erp.product_variants
     where id = v_var_override_id;

    if v_saved_override <> 15000 or v_failed <> false or v_saved_attrs->>'material' <> 'cuero' then
      raise exception 'ASSERTION FAILED: pause variant failed to preserve override or attributes: %', v_saved_attrs;
    end if;

    -- Reactivate variant:
    v_res := erp.manage_product_variants(
      p_product_id => v_prod_a,
      p_variants => jsonb_build_array(
        jsonb_build_object(
          'id', v_var_override_id,
          'code', 'OVR',
          'name', 'Propio Reactivado',
          'is_active', true
        )
      )
    );

    select final_price_ars, attributes, is_active
      into v_saved_override, v_saved_attrs, v_failed
      from erp.product_variants
     where id = v_var_override_id;

    if v_saved_override <> 15000 or v_failed <> true or v_saved_attrs->>'material' <> 'cuero' then
      raise exception 'ASSERTION FAILED: reactivate variant failed to preserve override or attributes: %', v_saved_attrs;
    end if;

    -- Verify barcode identifier remains active and primary
    if not exists (
      select 1 from erp.product_identifiers
       where organization_id = v_org_id
         and product_id = v_prod_a
         and variant_id = v_var_override_id
         and kind = 'barcode'
         and is_active = true
         and is_primary = true
    ) then
      raise exception 'ASSERTION FAILED: barcode identifier was lost or deactivated during pause/reactivate';
    end if;

    -- 6f. Optimistic concurrency conflict on stale timestamp
    v_failed := false;
    begin
      perform erp.manage_product_variants(
        p_product_id => v_prod_a,
        p_variants => jsonb_build_array(
          jsonb_build_object('id', v_var_override_id, 'code', 'OVR', 'name', 'Stale', 'is_active', true)
        ),
        p_expected_updated_at => v_stale_updated_at
      );
    exception when check_violation then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'ASSERTION FAILED: manage_product_variants with stale expected_updated_at must fail with check_violation';
    end if;

    -- ------------------------------------------------------------------------
    -- 7. get_catalog_product_variants getter tests
    -- ------------------------------------------------------------------------
    v_variants_res := erp.get_catalog_product_variants(p_product_id => v_prod_a);
    if jsonb_array_length(v_variants_res) < 3 then
      raise exception 'ASSERTION FAILED: get_catalog_product_variants returned unexpected count: %', v_variants_res;
    end if;

    -- ------------------------------------------------------------------------
    -- 8. REAL Cross-tenant isolation & Permissions
    -- ------------------------------------------------------------------------
    -- Create foreign org fixture
    insert into erp.organizations (id, display_name, legal_name, tax_id, is_active)
    values (v_foreign_org_id, 'Foreign Org Price ' || v_test_suffix, 'Foreign Org Price SA', '30-99999991-9', false);

    -- Create foreign unit of measure
    insert into erp.units_of_measure (id, organization_id, code, name, is_active)
    values (v_foreign_unit_id, v_foreign_org_id, 'UNI-F', 'Unidad Foreign', true);

    -- Create foreign product type
    insert into erp.product_types (id, organization_id, code, name, item_kind, default_tracking_mode, is_active)
    values (v_foreign_type_id, v_foreign_org_id, 'PRD-F', 'Tipo Foreign', 'product', 'quantity', true);

    -- Create foreign product fixture
    insert into erp.products (
      id, organization_id, product_type_id, item_kind, unit_id,
      internal_code, internal_name, public_name, inventory_tracking,
      base_cost, base_sale_price, tax_rate_percent,
      can_sell, can_use_as_repair_part, publish_on_web, allow_online_sale,
      is_active, created_by
    ) values (
      v_foreign_prod_id, v_foreign_org_id, v_foreign_type_id, 'product', v_foreign_unit_id,
      'FRG-P-' || v_test_suffix, 'Foreign Product', 'Foreign Product',
      'quantity', 1000, 2000, 21,
      true, false, false, false,
      true, auth.uid()
    );

    -- Create foreign variant fixture
    insert into erp.product_variants (
      id, organization_id, product_id, code, name, final_price_ars, is_active
    ) values (
      v_foreign_var_id, v_foreign_org_id, v_foreign_prod_id, 'FRG-VAR', 'Foreign Var', 2500, true
    );

    -- From current actor context (tenant v_org_id):
    -- Querying foreign product must be rejected with no_data_found
    v_failed := false;
    begin
      perform erp.resolve_catalog_effective_price(p_product_id => v_foreign_prod_id);
    exception when no_data_found then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'ASSERTION FAILED: resolve_catalog_effective_price for foreign product must raise no_data_found';
    end if;

    -- Querying own product with foreign variant must be rejected with no_data_found
    v_failed := false;
    begin
      perform erp.resolve_catalog_effective_price(p_product_id => v_prod_a, p_variant_id => v_foreign_var_id);
    exception when no_data_found then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'ASSERTION FAILED: resolve_catalog_effective_price with foreign variant must raise no_data_found';
    end if;

    -- Managing foreign product variants must be rejected with no_data_found
    v_failed := false;
    begin
      perform erp.manage_product_variants(
        p_product_id => v_foreign_prod_id,
        p_variants => jsonb_build_array(
          jsonb_build_object('id', v_foreign_var_id, 'code', 'FRG-VAR', 'name', 'Foreign Var', 'is_active', true)
        )
      );
    exception when no_data_found then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'ASSERTION FAILED: manage_product_variants for foreign product must raise no_data_found';
    end if;

    -- Managing own product injecting foreign variant ID must be rejected with invalid_parameter_value
    v_failed := false;
    begin
      perform erp.manage_product_variants(
        p_product_id => v_prod_a,
        p_variants => jsonb_build_array(
          jsonb_build_object('id', v_foreign_var_id, 'code', 'FRG-HACK', 'name', 'Hack', 'is_active', true)
        )
      );
    exception when invalid_parameter_value then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'ASSERTION FAILED: manage_product_variants injecting foreign variant ID must raise invalid_parameter_value';
    end if;

    -- get_catalog_product_variants for foreign product must be rejected with no_data_found
    v_failed := false;
    begin
      perform erp.get_catalog_product_variants(p_product_id => v_foreign_prod_id);
    exception when no_data_found then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'ASSERTION FAILED: get_catalog_product_variants for foreign product must raise no_data_found';
    end if;

    -- Unauthenticated call check
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '', true);

    v_failed := false;
    begin
      perform erp.resolve_catalog_effective_price(p_product_id => v_prod_a);
    exception when insufficient_privilege then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'ASSERTION FAILED: unauthenticated call must raise insufficient_privilege';
    end if;

    -- ------------------------------------------------------------------------
    -- 9. Storefront Cleanliness Assertion (CERO rows in public tables)
    -- ------------------------------------------------------------------------
    select count(*) into v_public_count
      from public.products
     where id in (v_prod_a, v_foreign_prod_id)
        or name like '%' || v_test_suffix || '%';

    if v_public_count > 0 then
      raise exception 'ASSERTION FAILED B6: public.products has % rows for test fixtures', v_public_count;
    end if;

    select count(*) into v_public_count
      from public.product_variants
     where id in (v_var_inherit_id, v_var_override_id, v_var_delta_id, v_var_zero_id, v_var_exact_id, v_foreign_var_id)
        or color like '%' || v_test_suffix || '%';

    if v_public_count > 0 then
      raise exception 'ASSERTION FAILED B6: public.product_variants has % rows for test fixtures', v_public_count;
    end if;

    -- ------------------------------------------------------------------------
    -- 10. Stock preservation and automatic rollback
    -- ------------------------------------------------------------------------
    if v_location_id is not null and not exists (
      select 1 from erp.stock_balances
       where product_id = v_prod_a and variant_id = v_var_override_id
         and location_id = v_location_id
         and quantity_on_hand = 10 and quantity_reserved = 2
    ) then
      raise exception 'ASSERTION FAILED: price and variant edits changed fixture stock';
    end if;

    raise exception using errcode = 'P9001', message = 'ERP_VARIANT_PRICE_TEST_SENTINEL_SUCCESS';
  exception
    when sqlstate 'P9001' then
      -- Sentinel caught: test suite succeeded, all assertions passed!
      null;
  end;
end;
$$;

select 'PASS: ERP Catalog Variant Final Price Smoke Test' as smoke_result;

rollback;
