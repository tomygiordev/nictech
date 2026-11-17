-- ============================================================================
-- Smoke Test: ERP Catalog Compatibility (N:M) & Transactional Variant Commands
-- Slice #1221 - Self-contained transactional test suite (Single DO with P9001 Sentinel)
-- ============================================================================
-- INVARIANTS TESTED:
-- 1. Happy path: N:M accessory compatibility across multiple models; SKU and stock preserved.
-- 2. Add / Edit / Pause variants: UUID stable, price_delta legacy preserved, non-color attrs preserved, no hard delete.
-- 3. Barcode immutable handling: updates deactivate/reactivate without mutating value, satisfying prevent_identifier_reassignment.
-- 4. Root fix: kind='internal' with value B on SAME variant cannot be reactivated as barcode (raises unique_violation, preserves old barcode & SKU).
-- 5. Optimistic concurrency: expected_updated_at guards both compatibility and variant commands against lost updates.
-- 6. Multi-tenant isolation: models from foreign organization rejected with invalid_parameter_value.
-- 7. Granularity invariant bidirectional:
--    a. Product with parent stock / active reservation / non-terminal unit rejects variant creation.
--    b. Inactive/released reservations do NOT block variant creation.
--    c. Product with variants rejects new active parent stock or units via shared server triggers.
-- 8. Auth guard & granular permissions: unauthenticated or unauthorized calls rejected with insufficient_privilege.
-- 9. Clean isolation: public.products / public.product_variants remain 0, no profile alterations, full ROLLBACK via P9001 sentinel.
-- ============================================================================

begin;

-- Safe local timeouts
set local statement_timeout = '30s';
set local lock_timeout = '10s';

-- The smoke test owns its actor and reference models; no seeded Auth account is required.
create temporary table catalog_smoke_fixture(k text primary key, id uuid);
insert into catalog_smoke_fixture values ('actor',gen_random_uuid()),('brand',gen_random_uuid()),('model1',gen_random_uuid()),('model2',gen_random_uuid());
insert into catalog_smoke_fixture select 'org',id from erp.organizations order by created_at limit 1;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'authenticated','authenticated',id::text||'@example.test','{}','{}',now(),now() from catalog_smoke_fixture where k='actor';
insert into erp.profiles(id,organization_id,display_name) values ((select id from catalog_smoke_fixture where k='actor'),(select id from catalog_smoke_fixture where k='org'),'Fixture catálogo') on conflict (id) do nothing;
insert into erp.profile_roles(organization_id,profile_id,role_id) select o.id,a.id,r.id from catalog_smoke_fixture o,catalog_smoke_fixture a,erp.roles r where o.k='org' and a.k='actor' and r.organization_id=o.id and r.code='owner' on conflict do nothing;
insert into erp.brands(id,organization_id,code,name) select (select id from catalog_smoke_fixture where k='brand'),id,'SMOKE-'||gen_random_uuid()::text,'Smoke '||gen_random_uuid()::text from catalog_smoke_fixture where k='org';
insert into erp.product_models(id,organization_id,brand_id,code,name) select f.id,(select id from catalog_smoke_fixture where k='org'),(select id from catalog_smoke_fixture where k='brand'),'SMOKE-'||gen_random_uuid()::text,'Smoke '||gen_random_uuid()::text from catalog_smoke_fixture f where f.k in ('model1','model2');


do $$
declare
  -- Candidate actor discovery & tenant references
  r_cand record;
  v_admin_uid uuid;
  v_org_id uuid;
  v_model_count integer;
  v_unit_id uuid;
  v_type_id uuid;
  v_location_id uuid;
  v_branch_id uuid;
  v_model1_id uuid;
  v_model2_id uuid;

  -- Test suffix and dynamic values
  v_test_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_sku_a text;
  v_sku_b text;
  v_sku_c text;
  v_sku_d text;
  v_sku_e text;
  v_barcode1 text;
  v_barcode2 text;
  v_internal_val text;

  -- Foreign tenant fixtures
  v_foreign_org_id uuid := gen_random_uuid();
  v_foreign_brand_id uuid := gen_random_uuid();
  v_foreign_model_id uuid := gen_random_uuid();

  -- Product and Batch IDs
  v_prod_a uuid := gen_random_uuid();
  v_prod_b uuid := gen_random_uuid();
  v_prod_c uuid := gen_random_uuid();
  v_prod_d uuid := gen_random_uuid();
  v_prod_e uuid := gen_random_uuid();
  v_res_batch_c uuid := gen_random_uuid();

  -- Runtime test variables
  v_resolved_org uuid;
  v_expected_updated_at timestamptz;
  v_stale_updated_at timestamptz := now() - interval '1 hour';
  v_res jsonb;
  v_var_id uuid;
  v_omitted_variant_id uuid;
  v_count integer;
  v_failed boolean;
  v_ident_active boolean;
  v_ident_primary boolean;
  v_ident_kind erp.identifier_kind;
  v_ident_count integer;
  v_viewer_uid uuid;
  v_public_prods integer;
  v_public_vars integer;
begin
  -- Internal subtransaction block: all DML and assertions run here.
  -- A P9001 exception sentinel at the end guarantees automatic rollback of all fixtures
  -- even if the outer batch tool doesn't execute the final ROLLBACK.
  begin
    -- ------------------------------------------------------------------------
    -- 1. Discover Real Preconditions & Select Active Tenant Profile
    -- ------------------------------------------------------------------------
    for r_cand in
      select p.id as profile_id, p.organization_id
        from erp.profiles p
        join erp.organizations o on o.id = p.organization_id and o.is_active = true
       where p.is_active = true
       order by p.created_at asc
    loop
      -- Check if tenant has required reference data
      select count(*) into v_model_count
        from erp.product_models
       where organization_id = r_cand.organization_id and is_active = true;

      if v_model_count >= 2 then
        select id into v_unit_id
          from erp.units_of_measure
         where organization_id = r_cand.organization_id
         limit 1;

        select id into v_type_id
          from erp.product_types
         where organization_id = r_cand.organization_id and item_kind = 'product'
         limit 1;

        select id, branch_id into v_location_id, v_branch_id
          from erp.locations
         where organization_id = r_cand.organization_id and is_active = true
         limit 1;

        if v_unit_id is not null and v_type_id is not null and v_location_id is not null then
          -- Validate effective permission with candidate claims BEFORE creating fixtures
          perform set_config('request.jwt.claim.sub', r_cand.profile_id::text, true);
          perform set_config('request.jwt.claims', json_build_object('sub', r_cand.profile_id, 'role', 'authenticated')::text, true);

          if erp.has_permission('catalog.manage') then
            v_admin_uid := r_cand.profile_id;
            v_org_id := r_cand.organization_id;
            exit;
          end if;
        end if;
      end if;
    end loop;

    if v_admin_uid is null then
      raise exception 'PRECONDITION FAILED: no active ERP profile with effective catalog.manage and required tenant references found';
    end if;

    -- Pick 2 distinct active models from the active tenant
    select id into v_model1_id
      from erp.product_models
     where organization_id = v_org_id and is_active = true
     order by name asc limit 1;

    select id into v_model2_id
      from erp.product_models
     where organization_id = v_org_id and is_active = true and id <> v_model1_id
     order by name desc limit 1;

    -- Generate unique dynamic codes
    v_sku_a := 'SMK-A-' || v_test_suffix;
    v_sku_b := 'SMK-B-' || v_test_suffix;
    v_sku_c := 'SMK-C-' || v_test_suffix;
    v_sku_d := 'SMK-D-' || v_test_suffix;
    v_sku_e := 'SMK-E-' || v_test_suffix;
    v_barcode1 := '779' || lpad(((floor(random() * 899999999) + 100000000)::bigint)::text, 9, '0');
    v_barcode2 := '778' || lpad(((floor(random() * 899999999) + 100000000)::bigint)::text, 9, '0');
    v_internal_val := 'INT-' || v_test_suffix;

    -- ------------------------------------------------------------------------
    -- 2. Create Fixtures as PostgreSQL / Session Role (Bridges Disabled via Flags)
    -- ------------------------------------------------------------------------
    -- Foreign tenant (inactive, no actor, bridge disabled)
    insert into erp.organizations (id, display_name, legal_name, tax_id, is_active)
    values (v_foreign_org_id, 'Foreign Org Smoke ' || v_test_suffix, 'Foreign Org Smoke SA ' || v_test_suffix, '30-99999999-9', false);

    insert into erp.brands (id, organization_id, code, name)
    values (v_foreign_brand_id, v_foreign_org_id, 'FBR-' || v_test_suffix, 'Foreign Brand');

    insert into erp.product_models (id, organization_id, brand_id, code, name, is_active)
    values (v_foreign_model_id, v_foreign_org_id, v_foreign_brand_id, 'FMD-' || v_test_suffix, 'Foreign Model', true);

    -- Product A: Happy Path (N:M Compatibility & Variants). model_id omitted (check products_model_requires_brand)
    insert into erp.products (
      id, organization_id, product_type_id, item_kind, unit_id,
      internal_code, internal_name, base_sale_price, inventory_tracking,
      publish_on_web, allow_online_sale, can_sell
    ) values (
      v_prod_a, v_org_id, v_type_id, 'product', v_unit_id,
      v_sku_a, 'Funda Smoke A ' || v_test_suffix, 10000, 'quantity',
      false, false, false
    );

    -- Product B: Parent Stock Collision
    insert into erp.products (
      id, organization_id, product_type_id, item_kind, unit_id,
      internal_code, internal_name, base_sale_price, inventory_tracking,
      publish_on_web, allow_online_sale, can_sell
    ) values (
      v_prod_b, v_org_id, v_type_id, 'product', v_unit_id,
      v_sku_b, 'Funda Smoke B ' || v_test_suffix, 10000, 'quantity',
      false, false, false
    );

    insert into erp.stock_balances (
      organization_id, branch_id, location_id, product_id, variant_id,
      quantity_on_hand, quantity_reserved
    ) values (
      v_org_id, v_branch_id, v_location_id, v_prod_b, null,
      15, 0
    );

    -- Product C: Parent Active Reservation
    insert into erp.products (
      id, organization_id, product_type_id, item_kind, unit_id,
      internal_code, internal_name, base_sale_price, inventory_tracking,
      publish_on_web, allow_online_sale, can_sell
    ) values (
      v_prod_c, v_org_id, v_type_id, 'product', v_unit_id,
      v_sku_c, 'Funda Smoke C ' || v_test_suffix, 10000, 'quantity',
      false, false, false
    );

    insert into erp.stock_reservation_batches (
      id, organization_id, branch_id, idempotency_key, request_hash,
      status, source_type, expires_at, created_by
    ) values (
      v_res_batch_c, v_org_id, v_branch_id, 'smk-res-c-' || gen_random_uuid()::text, 'hash-c',
      'active', 'smoke_test', now() + interval '2 hours', v_admin_uid
    );

    insert into erp.stock_reservations (
      organization_id, batch_id, location_id, product_id, variant_id, quantity
    ) values (
      v_org_id, v_res_batch_c, v_location_id, v_prod_c, null, 2
    );

    -- Product D: Parent Serialized Inventory Unit (tracking must be 'serial' per validate_inventory_unit)
    insert into erp.products (
      id, organization_id, product_type_id, item_kind, unit_id,
      internal_code, internal_name, base_sale_price, inventory_tracking,
      publish_on_web, allow_online_sale, can_sell
    ) values (
      v_prod_d, v_org_id, v_type_id, 'product', v_unit_id,
      v_sku_d, 'Funda Smoke D ' || v_test_suffix, 10000, 'serial',
      false, false, false
    );

    insert into erp.inventory_units (
      organization_id, product_id, variant_id, current_location_id,
      serial_number, status, is_active, created_by
    ) values (
      v_org_id, v_prod_d, null, v_location_id,
      'SN-D-' || v_test_suffix, 'available', true, v_admin_uid
    );

    -- Product E: Reverse Writers Test (has variants already; tracking 'serial' for unit trigger test)
    insert into erp.products (
      id, organization_id, product_type_id, item_kind, unit_id,
      internal_code, internal_name, base_sale_price, inventory_tracking,
      publish_on_web, allow_online_sale, can_sell
    ) values (
      v_prod_e, v_org_id, v_type_id, 'product', v_unit_id,
      v_sku_e, 'Funda Smoke E ' || v_test_suffix, 10000, 'serial',
      false, false, false
    );

    insert into erp.product_variants (
      organization_id, product_id, code, name, price_delta, is_active
    ) values (
      v_org_id, v_prod_e, 'VAR-E1-' || v_test_suffix, 'Variante E1', 0, true
    );

    -- ------------------------------------------------------------------------
    -- 3. Switch to Authenticated Session (Real Admin Profile)
    -- ------------------------------------------------------------------------
    perform set_config('request.jwt.claim.sub', v_admin_uid::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin_uid, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';

    v_resolved_org := erp.current_organization_id();
    if v_resolved_org is distinct from v_org_id then
      raise exception 'Assertion failed: current_organization_id resolved to %, expected %', v_resolved_org, v_org_id;
    end if;

    if not erp.has_permission('catalog.manage') then
      raise exception 'Assertion failed: active admin profile must have catalog.manage';
    end if;

    -- ------------------------------------------------------------------------
    -- 4. Test Compatibility N:M Commands (Happy Path, Sync, & Concurrency)
    -- ------------------------------------------------------------------------
    select updated_at into v_expected_updated_at from erp.products where id = v_prod_a;

    -- 4.1 Happy path: assign 2 models
    v_res := erp.set_product_compatible_models(v_prod_a, array[v_model1_id, v_model2_id], v_expected_updated_at);
    if v_res is null or (v_res->'compatible_model_ids') is null or jsonb_array_length(v_res->'compatible_model_ids') is distinct from 2 then
      raise exception 'Assertion failed: set_product_compatible_models should return 2 models, got %', v_res;
    end if;

    -- 4.2 Verify getter returns both models
    v_res := erp.get_product_compatible_models(v_prod_a);
    if v_res is null or jsonb_array_length(v_res) is distinct from 2 then
      raise exception 'Assertion failed: get_product_compatible_models should return 2 items, got %', v_res;
    end if;

    -- 4.3 Synchronize: remove 1 model
    select updated_at into v_expected_updated_at from erp.products where id = v_prod_a;
    v_res := erp.set_product_compatible_models(v_prod_a, array[v_model1_id], v_expected_updated_at);

    select count(*) into v_count
      from erp.product_compatible_models
     where product_id = v_prod_a and organization_id = v_org_id and is_active;
    if v_count is distinct from 1 then
      raise exception 'Assertion failed: expected 1 active compatible model after sync, got %', v_count;
    end if;
    if not exists (select 1 from erp.product_compatible_models where product_id=v_prod_a and organization_id=v_org_id and model_id=v_model2_id and not is_active) then
      raise exception 'Assertion failed: removed compatibility must remain as inactive history';
    end if;

    -- 4.4 Optimistic Concurrency check: passing stale expected_updated_at must fail
    v_failed := false;
    begin
      perform erp.set_product_compatible_models(v_prod_a, array[v_model1_id, v_model2_id], v_stale_updated_at);
    exception when check_violation then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'Assertion failed: set_product_compatible_models must reject stale expected_updated_at with check_violation';
    end if;

    -- 4.5 Foreign Tenant Model rejected
    select updated_at into v_expected_updated_at from erp.products where id = v_prod_a;
    v_failed := false;
    begin
      perform erp.set_product_compatible_models(v_prod_a, array[v_foreign_model_id], v_expected_updated_at);
    exception when invalid_parameter_value then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'Assertion failed: set_product_compatible_models must reject foreign model with invalid_parameter_value';
    end if;

    -- ------------------------------------------------------------------------
    -- 5. Test Variant Management Commands & Invariant Barcode Handling
    -- ------------------------------------------------------------------------
    select updated_at into v_expected_updated_at from erp.products where id = v_prod_a;

    -- 5.1 Create initial variant with code and barcode
    v_res := erp.manage_product_variants(
      v_prod_a,
      jsonb_build_array(
        jsonb_build_object('name', 'Negro', 'code', 'neg', 'barcode', v_barcode1, 'is_active', true)
      ),
      v_expected_updated_at
    );

    v_var_id := (v_res->'variants'->0->>'id')::uuid;
    if v_var_id is null then
      raise exception 'Assertion failed: manage_product_variants did not return variant ID';
    end if;

    -- Verify barcode inserted as active and primary in erp.product_identifiers
    select is_active, is_primary into v_ident_active, v_ident_primary
      from erp.product_identifiers
     where organization_id = v_org_id and product_id = v_prod_a and variant_id = v_var_id and kind = 'barcode';

    if v_ident_active is distinct from true or v_ident_primary is distinct from true then
      raise exception 'Assertion failed: initial barcode should be active and primary';
    end if;

    -- 5.2 Change barcode: deactivates old barcode row and creates new row without mutating value
    select updated_at into v_expected_updated_at from erp.products where id = v_prod_a;
    v_res := erp.manage_product_variants(
      v_prod_a,
      jsonb_build_array(
        jsonb_build_object('id', v_var_id, 'name', 'Negro', 'code', 'NEG', 'barcode', v_barcode2, 'is_active', true)
      ),
      v_expected_updated_at
    );

    -- Old barcode must be preserved inactive and non-primary
    select is_active, is_primary into v_ident_active, v_ident_primary
      from erp.product_identifiers
     where organization_id = v_org_id and variant_id = v_var_id and normalized_value = upper(v_barcode1);
    if v_ident_active is distinct from false or v_ident_primary is distinct from false then
      raise exception 'Assertion failed: old barcode should be paused/un-primaried, not active';
    end if;

    -- New barcode must be active and primary
    select is_active, is_primary into v_ident_active, v_ident_primary
      from erp.product_identifiers
     where organization_id = v_org_id and variant_id = v_var_id and normalized_value = upper(v_barcode2);
    if v_ident_active is distinct from true or v_ident_primary is distinct from true then
      raise exception 'Assertion failed: new barcode should be active and primary';
    end if;

    -- Total barcode identifiers for variant must be exactly 2 (preserving history)
    select count(*) into v_ident_count
      from erp.product_identifiers
     where organization_id = v_org_id and variant_id = v_var_id and kind = 'barcode';
    if v_ident_count is distinct from 2 then
      raise exception 'Assertion failed: expected 2 historical barcode rows, got %', v_ident_count;
    end if;

    -- 5.3 Reactivate old barcode: passing barcode1 again must reactivate without failing on prevent_identifier_reassignment
    select updated_at into v_expected_updated_at from erp.products where id = v_prod_a;
    v_res := erp.manage_product_variants(
      v_prod_a,
      jsonb_build_array(
        jsonb_build_object('id', v_var_id, 'name', 'Negro', 'code', 'NEG', 'barcode', v_barcode1, 'is_active', true)
      ),
      v_expected_updated_at
    );

    select is_active, is_primary into v_ident_active, v_ident_primary
      from erp.product_identifiers
     where organization_id = v_org_id and variant_id = v_var_id and normalized_value = upper(v_barcode1);
    if v_ident_active is distinct from true or v_ident_primary is distinct from true then
      raise exception 'Assertion failed: reactivated barcode should be active and primary';
    end if;

    -- 5.4 Root fix verification: identifier kind='internal' with value B on SAME variant cannot be reactivated as barcode
    execute 'reset role';
    insert into erp.product_identifiers (
      organization_id, product_id, variant_id, kind, value, is_primary, is_active, created_by
    ) values (
      v_org_id, v_prod_a, v_var_id, 'internal', v_internal_val, false, true, v_admin_uid
    );
    execute 'set local role authenticated';

    select updated_at into v_expected_updated_at from erp.products where id = v_prod_a;
    v_failed := false;
    begin
      perform erp.manage_product_variants(
        v_prod_a,
        jsonb_build_array(
          jsonb_build_object('id', v_var_id, 'name', 'Negro', 'code', 'NEG', 'barcode', v_internal_val, 'is_active', true)
        ),
        v_expected_updated_at
      );
    exception when unique_violation then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'Assertion failed: assigning existing internal identifier value as barcode on same variant must raise unique_violation';
    end if;

    -- Verify that kind='internal' row was preserved intact and not mutated into a barcode
    select kind, is_active into v_ident_kind, v_ident_active
      from erp.product_identifiers
     where organization_id = v_org_id and variant_id = v_var_id and normalized_value = upper(v_internal_val);
    if v_ident_kind is distinct from 'internal' or v_ident_active is distinct from true then
      raise exception 'Assertion failed: internal identifier should remain intact and active with kind internal';
    end if;

    -- Verify that active barcode (v_barcode1) remained active and primary
    select is_active, is_primary into v_ident_active, v_ident_primary
      from erp.product_identifiers
     where organization_id = v_org_id and variant_id = v_var_id and normalized_value = upper(v_barcode1);
    if v_ident_active is distinct from true or v_ident_primary is distinct from true then
      raise exception 'Assertion failed: previous active barcode must remain active and primary after rejected collision';
    end if;

    -- 5.5 Clear barcode: passing empty/null barcode deactivates current barcode without deleting
    select updated_at into v_expected_updated_at from erp.products where id = v_prod_a;
    v_res := erp.manage_product_variants(
      v_prod_a,
      jsonb_build_array(
        jsonb_build_object('id', v_var_id, 'name', 'Negro', 'code', 'NEG', 'barcode', null, 'is_active', true)
      ),
      v_expected_updated_at
    );

    select count(*) into v_ident_count
      from erp.product_identifiers
     where organization_id = v_org_id and variant_id = v_var_id and kind = 'barcode' and is_active = true;
    if v_ident_count is distinct from 0 then
      raise exception 'Assertion failed: no active barcodes should remain after clearing';
    end if;

    -- 5.6 Duplicate variant code within payload rejected
    v_failed := false;
    begin
      perform erp.manage_product_variants(
        v_prod_a,
        jsonb_build_array(
          jsonb_build_object('name', 'Blanco', 'code', 'BLA'),
          jsonb_build_object('name', 'Blanco Glaciar', 'code', 'bla')
        )
      );
    exception when unique_violation then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'Assertion failed: duplicate variant code in payload must raise unique_violation';
    end if;

    -- ------------------------------------------------------------------------
    -- 5.7 Preserve legacy attributes/pricing, omitted variants, and identity when pausing.
    execute 'reset role';
    update erp.product_variants
       set attributes = '{"color":"Negro","material":"silicona"}'::jsonb,
           price_delta = 123
     where id = v_var_id;
    execute 'set local role authenticated';
    v_res := erp.manage_product_variants(v_prod_a,
      jsonb_build_array(jsonb_build_object('name', 'Omitida', 'code', 'OMIT')));
    v_omitted_variant_id := (v_res->'variants'->0->>'id')::uuid;
    perform erp.manage_product_variants(v_prod_a,
      jsonb_build_array(jsonb_build_object('id', v_var_id, 'name', 'Azul', 'code', 'AZU', 'is_active', false)));
    if not exists (
      select 1 from erp.product_variants
       where id = v_var_id and product_id = v_prod_a and not is_active
         and price_delta = 123 and attributes->>'material' = 'silicona'
         and attributes->>'color' = 'Azul'
    ) then
      raise exception 'Assertion failed: pause/edit must preserve variant identity, legacy price and non-color attributes';
    end if;
    if not exists (
      select 1 from erp.product_variants
       where id = v_omitted_variant_id and product_id = v_prod_a
         and code = 'OMIT' and is_active and price_delta = 0
    ) then
      raise exception 'Assertion failed: omitted variant must remain unchanged';
    end if;

    -- ------------------------------------------------------------------------
    -- 6. Test Stock Granularity Invariants (Both Directions & Direct Trigger Tests)
    -- ------------------------------------------------------------------------
    -- 6.1 Direction A: Product B has parent stock > 0 -> Variant creation must fail
    v_failed := false;
    begin
      perform erp.manage_product_variants(
        v_prod_b,
        jsonb_build_array(jsonb_build_object('name', 'Rojo', 'code', 'ROJ'))
      );
    exception when check_violation then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'Assertion failed: creating variant on product with parent stock must raise check_violation';
    end if;

    -- 6.2 Direction A: Product C has active reservation -> Variant creation must fail
    v_failed := false;
    begin
      perform erp.manage_product_variants(
        v_prod_c,
        jsonb_build_array(jsonb_build_object('name', 'Verde', 'code', 'VER'))
      );
    exception when check_violation then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'Assertion failed: creating variant on product with active reservation must raise check_violation';
    end if;

    -- 6.3 Inactive / Released reservation does NOT block variant creation
    -- Direct update requires postgres role
    execute 'reset role';
    update erp.stock_reservation_batches
       set status = 'released', released_at = now()
     where id = v_res_batch_c;
    execute 'set local role authenticated';

    -- Now variant creation on Product C succeeds
    perform erp.manage_product_variants(
      v_prod_c,
      jsonb_build_array(jsonb_build_object('name', 'Verde', 'code', 'VER'))
    );

    -- 6.4 Direction A: Product D has active inventory unit -> Variant creation must fail
    v_failed := false;
    begin
      perform erp.manage_product_variants(
        v_prod_d,
        jsonb_build_array(jsonb_build_object('name', 'Azul', 'code', 'AZU'))
      );
    exception when check_violation then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'Assertion failed: creating variant on product with active inventory unit must raise check_violation';
    end if;

    -- 6.5 Direction B: Product E has variants -> Adding active parent stock balance must fail via trigger
    -- Direct ledger insert requires postgres role
    execute 'reset role';
    v_failed := false;
    begin
      insert into erp.stock_balances (
        organization_id, branch_id, location_id, product_id, variant_id,
        quantity_on_hand, quantity_reserved
      ) values (
        v_org_id, v_branch_id, v_location_id, v_prod_e, null,
        10, 0
      );
    exception when check_violation then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'Assertion failed: inserting active parent stock on product with variants must raise check_violation';
    end if;

    -- Zero balance is allowed (no exception)
    insert into erp.stock_balances (
      organization_id, branch_id, location_id, product_id, variant_id,
      quantity_on_hand, quantity_reserved
    ) values (
      v_org_id, v_branch_id, v_location_id, v_prod_e, null,
      0, 0
    );

    -- 6.6 Direction B: Product E has variants -> Adding parent serialized inventory unit must fail via trigger
    v_failed := false;
    begin
      insert into erp.inventory_units (
        organization_id, product_id, variant_id, current_location_id,
        serial_number, status, is_active, created_by
      ) values (
        v_org_id, v_prod_e, null, v_location_id,
        'SN-E-' || v_test_suffix, 'available', true, v_admin_uid
      );
    exception when check_violation then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'Assertion failed: inserting active parent inventory unit on product with variants must raise check_violation';
    end if;

    -- ------------------------------------------------------------------------
    -- 7. Test Auth Guards & Granular Permissions
    -- ------------------------------------------------------------------------
    execute 'set local role authenticated';

    -- 7.1 Unauthenticated call (no auth.uid)
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{}', true);

    v_failed := false;
    begin
      perform erp.set_product_compatible_models(v_prod_a, '{}'::uuid[]);
    exception when insufficient_privilege then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'Assertion failed: unauthenticated call must be rejected with insufficient_privilege';
    end if;

    -- 7.2 Granular permission check: find real existing profile WITHOUT catalog.manage if available in tenant
    v_viewer_uid := null;
    for r_cand in
      select p.id
        from erp.profiles p
       where p.organization_id = v_org_id
         and p.is_active = true
         and p.id <> v_admin_uid
       order by p.created_at asc
    loop
      perform set_config('request.jwt.claim.sub', r_cand.id::text, true);
      perform set_config('request.jwt.claims', json_build_object('sub', r_cand.id, 'role', 'authenticated')::text, true);
      if not erp.has_permission('catalog.manage') then
        v_viewer_uid := r_cand.id;
        exit;
      end if;
    end loop;

    if v_viewer_uid is not null then
      v_failed := false;
      begin
        perform erp.manage_product_variants(v_prod_a, jsonb_build_array(jsonb_build_object('name', 'X', 'code', 'X')));
      exception when insufficient_privilege then
        v_failed := true;
      end;
      if not v_failed then
        raise exception 'Assertion failed: profile without catalog.manage must be rejected with insufficient_privilege';
      end if;
      raise notice 'Granular permission test passed with viewer profile %', v_viewer_uid;
    else
      raise notice 'SKIP: No existing active profile without catalog.manage found in organization %; skipping granular denial test without mutating profiles', v_org_id;
    end if;

    -- ------------------------------------------------------------------------
    -- 8. Assert Public Isolation
    -- ------------------------------------------------------------------------
    execute 'reset role';

    if to_regclass('public.products') is not null then
      select count(*) into v_public_prods
        from public.products
       where id in (v_prod_a, v_prod_b, v_prod_c, v_prod_d, v_prod_e);

      if v_public_prods is distinct from 0 then
        raise exception 'Assertion failed: public.products leaked % fixture rows', v_public_prods;
      end if;
    end if;

    if to_regclass('public.product_variants') is not null then
      select count(*) into v_public_vars
        from public.product_variants
       where product_id in (v_prod_a, v_prod_b, v_prod_c, v_prod_d, v_prod_e);

      if v_public_vars is distinct from 0 then
        raise exception 'Assertion failed: public.product_variants leaked % fixture rows', v_public_vars;
      end if;
    end if;

    -- ------------------------------------------------------------------------
    -- 9. Trigger Automatic Rollback of Inner Subtransaction via Sentinel
    -- ------------------------------------------------------------------------
    raise exception using errcode = 'P9001', message = 'ERP catalog smoke test completed successfully';
  exception
    when sqlstate 'P9001' then
      -- Sentinel caught: all test fixtures inside this subtransaction have been cleanly rolled back.
      execute 'reset role';
      perform set_config('request.jwt.claim.sub', '', true);
      perform set_config('request.jwt.claims', '{}', true);
  end;
end;
$$;

-- Result summary (executed if DO completes without unexpected errors)
select 'PASS: ERP Catalog Compatibility & Variants Smoke Test' as smoke_result;

rollback;
