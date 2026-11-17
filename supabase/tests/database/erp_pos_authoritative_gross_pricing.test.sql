-- ============================================================================
-- Smoke Test: Authoritative Gross Pricing (v2) for POS & Server Price Authority
-- Slice #1221 - Astra1266 Contract Verification (Rollback Only, P9001 Sentinel)
-- ============================================================================

begin;

set local statement_timeout = '30s';
set local lock_timeout = '10s';

do $$
declare
  r_cand record;
  r_branch record;
  v_admin_uid uuid;
  v_org_id uuid;
  v_branch_id uuid;
  v_location_id uuid;
  v_unit_id uuid;
  v_type_id uuid;
  v_snapshot_id uuid;
  v_payment_method_id uuid;
  v_template_version_id uuid;
  v_template_id uuid;
  v_has_discount boolean := false;

  v_suffix text := substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  -- Fixture products
  v_prod_with_vars uuid := gen_random_uuid();
  v_var_inherit uuid := gen_random_uuid();
  v_var_override uuid := gen_random_uuid();
  v_var_delta uuid := gen_random_uuid();

  v_prod_simple_one uuid := gen_random_uuid();
  v_prod_simple_fract uuid := gen_random_uuid();
  v_prod_simple_third uuid := gen_random_uuid();
  v_prod_simple_zero uuid := gen_random_uuid();
  v_prod_neg uuid := gen_random_uuid();
  v_var_neg uuid := gen_random_uuid();
  v_prod_web uuid := gen_random_uuid();
  v_prod_v1 uuid := gen_random_uuid();

  -- Foreign tenant fixtures
  v_foreign_branch_id uuid := gen_random_uuid();
  v_foreign_period_id uuid := gen_random_uuid();
  v_foreign_entry_id uuid := gen_random_uuid();
  v_foreign_org_id uuid := gen_random_uuid();
  v_foreign_unit_id uuid := gen_random_uuid();
  v_foreign_type_id uuid := gen_random_uuid();
  v_foreign_prod_id uuid := gen_random_uuid();

  -- Web order fixtures
  v_web_order_id uuid := gen_random_uuid();
  v_web_customer_id uuid := gen_random_uuid();
  v_web_reservation_id uuid := gen_random_uuid();
  v_web_payment_event_id uuid := gen_random_uuid();
  v_web_sale_id uuid;

  -- Test working variables
  v_res jsonb;
  v_sqlstate text;
  v_sqlerrm text;
  v_sale_id uuid;
  v_doc_id uuid;
  v_sale_row erp.sales%rowtype;
  v_line_row erp.sale_lines%rowtype;
  v_op_key text;

  v_sales_count_before int;
  v_moves_count_before int;
  v_pays_count_before int;

  v_v1_lines jsonb;
  v_v1_payments jsonb;
  v_v1_op_key text;
  v_v1_reason text;
  v_v1_sale_id uuid;
  v_v1_doc_id uuid;
  v_v1_replayed_id uuid;
  v_big_sale_id uuid;
  v_account_sale_id uuid;
  v_customer_acc_sale_id uuid;
  v_sha_fixture text;

  -- Accounting exact4 contract test variables
  v_entry_row erp.journal_entries%rowtype;
  v_public_original_id uuid;
  v_public_reversal_id uuid;
  v_internal_original_id uuid;
  v_internal_reversal_id uuid;
  v_public_chain_id uuid;
  v_internal_chain_id uuid;
  v_legacy_reversal_id uuid;
  v_internal_legacy_id uuid;
  v_internal_legacy_reversal_id uuid;
  v_provenance_fixture_id uuid;
  v_constraint_name text;
  v_denied_actor uuid;
  r_pair record;
  v_reversal_id uuid;
  v_reversal_replayed_id uuid;
  v_rev_entry_row erp.journal_entries%rowtype;
  v_tb_row record;
  v_zero_sale_id uuid;
  v_zero_cost_prod uuid := gen_random_uuid();
  v_micro_prod uuid := gen_random_uuid();
  v_micro_cost_prod uuid := gen_random_uuid();
  v_closed_period_id uuid;
  v_legacy_entry_id uuid;
  v_acc_rec_id uuid;
  v_acc_inc_id uuid;
  v_expected_debit numeric;
  v_expected_credit numeric;
  v_expected_balance numeric;
  v_replay_source_id uuid := gen_random_uuid();
  v_replay_entry_id uuid;
  v_replay_again_id uuid;
  v_replay_newkey_id uuid;
  r_role record;
  r_table record;
  r_priv record;
  v_role_id uuid;
  v_exchange_rate_id uuid;
begin
  -- --------------------------------------------------------------------------
  -- 1. Self-Contained Environment, References, User & Role Fixture
  -- --------------------------------------------------------------------------
  select id into v_org_id
    from erp.organizations
   where is_active = true
   order by created_at asc
   limit 1;

  if v_org_id is null then
    v_org_id := gen_random_uuid();
    insert into erp.organizations (id, legal_name, display_name, timezone, default_currency, is_active)
    values (v_org_id, 'POS Test Org ' || v_suffix, 'POS Test Org ' || v_suffix, 'America/Argentina/Buenos_Aires', 'ARS', true);
  end if;

  select id into v_branch_id
    from erp.branches
   where organization_id = v_org_id and is_active = true
   order by created_at asc
   limit 1;

  if v_branch_id is null then
    v_branch_id := gen_random_uuid();
    insert into erp.branches (id, organization_id, code, name, is_active)
    values (v_branch_id, v_org_id, 'BR-' || v_suffix, 'Sucursal ' || v_suffix, true);
  end if;

  select id into v_location_id
    from erp.locations
   where organization_id = v_org_id
     and branch_id = v_branch_id
     and is_active = true
     and allows_sale = true
   order by created_at asc
   limit 1;

  if v_location_id is null then
    v_location_id := gen_random_uuid();
    insert into erp.locations (id, organization_id, branch_id, code, name, kind, allows_sale, contributes_to_web_stock, is_active)
    values (v_location_id, v_org_id, v_branch_id, 'LOC-' || v_suffix, 'Mostrador ' || v_suffix, 'store', true, false, true);
  end if;

  select id into v_unit_id
    from erp.units_of_measure
   where organization_id = v_org_id and is_active = true
   order by created_at asc
   limit 1;

  if v_unit_id is null then
    v_unit_id := gen_random_uuid();
    insert into erp.units_of_measure (id, organization_id, code, name, allows_decimals, is_active)
    values (v_unit_id, v_org_id, 'UN-' || v_suffix, 'Unidad ' || v_suffix, false, true);
  end if;

  select id into v_type_id
    from erp.product_types
   where organization_id = v_org_id
     and item_kind = 'product'
     and default_tracking_mode = 'quantity'
     and is_active = true
   order by created_at asc
   limit 1;

  if v_type_id is null then
    v_type_id := gen_random_uuid();
    insert into erp.product_types (id, organization_id, code, name, item_kind, default_tracking_mode, is_active)
    values (v_type_id, v_org_id, 'PT-' || v_suffix, 'Producto ' || v_suffix, 'product', 'quantity', true);
  end if;

  select id into v_snapshot_id
    from erp.exchange_rate_snapshots
   where organization_id = v_org_id
     and quote_currency = 'ARS'
     and rate_to_base = 1
   order by created_at asc
   limit 1;

  if v_snapshot_id is null then
    insert into erp.organization_currencies (organization_id, currency_code, decimal_places, is_base)
    values (v_org_id, 'ARS', 2, true)
    on conflict do nothing;

    v_exchange_rate_id := gen_random_uuid();
    v_snapshot_id := gen_random_uuid();

    insert into erp.exchange_rates (
      id, organization_id, base_currency, quote_currency, rate_to_base,
      source, quoted_at, idempotency_key, request_hash
    ) values (
      v_exchange_rate_id, v_org_id, 'ARS', 'ARS', 1,
      'pos-test-local', now(), 'pos-gross-rate-' || v_suffix, repeat('a', 64)
    );

    insert into erp.exchange_rate_snapshots (
      id, organization_id, exchange_rate_id, base_currency, quote_currency,
      rate_to_base, source, quoted_at, captured_at
    ) values (
      v_snapshot_id, v_org_id, v_exchange_rate_id, 'ARS', 'ARS',
      1, 'pos-test-local', now(), now()
    );
  end if;

  select id into v_payment_method_id
    from erp.payment_methods
   where organization_id = v_org_id
     and is_active = true
     and requires_cash_session = false
   order by created_at asc
   limit 1;

  if v_payment_method_id is null then
    v_payment_method_id := gen_random_uuid();
    insert into erp.payment_methods (
      id, organization_id, code, name, surcharge_percent, max_installments,
      settlement_kind, requires_cash_session, is_active
    ) values (
      v_payment_method_id, v_org_id, 'PM-' || v_suffix, 'Tarjeta ' || v_suffix, 0, 12,
      'card', false, true
    );
  end if;

  v_admin_uid := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', v_admin_uid, 'authenticated', 'authenticated',
    'pos-gross-' || v_suffix || '@nictech.local', 'not-used', now(),
    '{"provider":"email"}'::jsonb, '{"display_name":"POS Gross Test"}'::jsonb, now(), now()
  )
  on conflict (id) do nothing;

  insert into erp.profiles (id, organization_id, display_name, is_active)
  values (v_admin_uid, v_org_id, 'POS Gross Test ' || v_suffix, true)
  on conflict (id) do update
    set organization_id = excluded.organization_id,
        is_active = true;

  insert into erp.roles (organization_id, code, name, description, is_system, is_active)
  values (v_org_id, 'test-pos-gross-' || v_suffix, 'Test POS Gross ' || v_suffix, 'Fixture role for POS gross pricing test', false, true)
  on conflict (organization_id, code) do update set is_active = true
  returning id into v_role_id;

  insert into erp.role_permissions (organization_id, role_id, permission_id, is_active)
  select v_org_id, v_role_id, perm.id, true
    from erp.permissions perm
   where perm.code in (
     'catalog.view', 'catalog.manage',
     'pricing.view', 'pricing.manage',
     'sales.view', 'sales.create', 'sales.discount',
     'orders.view', 'orders.manage',
     'documents.view', 'documents.issue',
     'stock.view', 'stock.move', 'stock.adjust',
     'accounting.view', 'accounting.post', 'accounting.close_period',
     'reports.view', 'reports.export',
     'customers.view', 'customers.manage',
     'audit.view', 'purchases.view', 'costs.view', 'costs.manage', 'profitability.view', 'locations.view'
   )
     and perm.is_active
  on conflict (role_id, permission_id) do update
    set is_active = true,
        updated_at = now();

  insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
  values (v_org_id, v_admin_uid, v_role_id, v_admin_uid)
  on conflict (profile_id, role_id) where branch_id is null do update
    set valid_from = clock_timestamp(),
        valid_until = null;

  perform set_config('request.jwt.claim.sub', v_admin_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_has_discount := erp.has_permission('sales.discount', v_branch_id);

  if not (
    erp.has_permission('sales.create', v_branch_id)
    and erp.has_permission('documents.issue', v_branch_id)
    and erp.has_permission('documents.view', v_branch_id)
    and erp.has_permission('orders.manage', v_branch_id)
  ) or v_location_id is null or v_unit_id is null or v_type_id is null
     or v_snapshot_id is null or v_payment_method_id is null then
    raise exception 'TEST PRECONDITION FAILED: authorized active profile, sales references and non-cash payment method are required';
  end if;

  -- Ensure active document template exists in current org
  select version_row.id into v_template_version_id
    from erp.document_template_versions version_row
    join erp.document_templates template_row
      on template_row.id = version_row.template_id
     and template_row.organization_id = version_row.organization_id
   where version_row.organization_id = v_org_id
     and template_row.document_kind = 'sale'
     and template_row.is_active
   order by version_row.version desc
   limit 1;

  if v_template_version_id is null then
    v_template_id := gen_random_uuid();
    v_template_version_id := gen_random_uuid();

    insert into erp.document_templates (id, organization_id, code, name, document_kind, is_active)
    values (v_template_id, v_org_id, 'SALE_RECEIPT_' || v_suffix, 'Comprobante de venta ' || v_suffix, 'sale', true);

    insert into erp.document_template_versions (id, organization_id, template_id, version, definition)
    values (v_template_version_id, v_org_id, v_template_id, 1, '{"sections":["business","customer","sale","payments","totals"]}'::jsonb);
  end if;

  select
    (max(role.account_id::text) filter (where role.role_code = 'receivable'))::uuid,
    (max(role.account_id::text) filter (where role.role_code = 'sales_income'))::uuid
  into
    v_acc_rec_id,
    v_acc_inc_id
  from erp.accounting_account_roles role
  where role.organization_id = v_org_id;

  if v_acc_rec_id is null or v_acc_inc_id is null then
    raise exception 'TEST PRECONDITION FAILED: receivable and sales_income account roles are required';
  end if;

  -- --------------------------------------------------------------------------
  -- 2. Insert Test Catalog Fixtures (Rollback Isolated)
  -- --------------------------------------------------------------------------
  -- Product WITH variants: base 1000.0000, tax 21%, inventory_tracking 'quantity'
  insert into erp.products (
    id, organization_id, product_type_id, item_kind, unit_id,
    internal_code, internal_name, inventory_tracking, base_sale_price,
    purchase_currency, tax_rate_percent, can_sell, publish_on_web, allow_online_sale, is_active
  ) values (
    v_prod_with_vars, v_org_id, v_type_id, 'product', v_unit_id,
    'PWV-' || v_suffix, 'Prod With Variants ' || v_suffix, 'quantity', 1000.0000,
    'ARS', 21.0000, true, false, false, true
  );

  -- Inherits from parent (final_price_ars null, delta 0)
  insert into erp.product_variants (
    id, product_id, organization_id, code, name, price_delta, final_price_ars, is_active
  ) values (
    v_var_inherit, v_prod_with_vars, v_org_id, 'VAR-INH-' || v_suffix, 'Var Inherit', 0, null, true
  );

  -- Override absolute final price (1500.0000 ARS)
  insert into erp.product_variants (
    id, product_id, organization_id, code, name, price_delta, final_price_ars, is_active
  ) values (
    v_var_override, v_prod_with_vars, v_org_id, 'VAR-OVR-' || v_suffix, 'Var Override', 0, 1500.0000, true
  );

  -- Legacy delta variant (delta 200.0000 is ignored).
  insert into erp.product_variants (
    id, product_id, organization_id, code, name, price_delta, final_price_ars, is_active
  ) values (
    v_var_delta, v_prod_with_vars, v_org_id, 'VAR-DEL-' || v_suffix, 'Var Delta', 200.0000, null, true
  );

  -- Product WITHOUT variants: ONE (1.0000 ARS, tax 21%)
  insert into erp.products (
    id, organization_id, product_type_id, item_kind, unit_id,
    internal_code, internal_name, inventory_tracking, base_sale_price,
    purchase_currency, tax_rate_percent, can_sell, publish_on_web, allow_online_sale, is_active
  ) values (
    v_prod_simple_one, v_org_id, v_type_id, 'product', v_unit_id,
    'ONE-' || v_suffix, 'Prod One ' || v_suffix, 'quantity', 1.0000,
    'ARS', 21.0000, true, false, false, true
  );

  -- Product WITHOUT variants: FRACT (100.0050 ARS, tax 21%)
  insert into erp.products (
    id, organization_id, product_type_id, item_kind, unit_id,
    internal_code, internal_name, inventory_tracking, base_sale_price,
    purchase_currency, tax_rate_percent, can_sell, publish_on_web, allow_online_sale, is_active
  ) values (
    v_prod_simple_fract, v_org_id, v_type_id, 'product', v_unit_id,
    'FRC-' || v_suffix, 'Prod Fract ' || v_suffix, 'quantity', 100.0050,
    'ARS', 21.0000, true, false, false, true
  );

  -- Product WITHOUT variants: THIRD (0.3300 ARS, tax 16.6667%)
  insert into erp.products (
    id, organization_id, product_type_id, item_kind, unit_id,
    internal_code, internal_name, inventory_tracking, base_sale_price,
    purchase_currency, tax_rate_percent, can_sell, publish_on_web, allow_online_sale, is_active
  ) values (
    v_prod_simple_third, v_org_id, v_type_id, 'product', v_unit_id,
    'THD-' || v_suffix, 'Prod Third ' || v_suffix, 'quantity', 0.3300,
    'ARS', 16.6667, true, false, false, true
  );

  -- Product WITHOUT variants: ZERO (0.0000 ARS, tax 21%)
  insert into erp.products (
    id, organization_id, product_type_id, item_kind, unit_id,
    internal_code, internal_name, inventory_tracking, base_sale_price,
    purchase_currency, tax_rate_percent, can_sell, publish_on_web, allow_online_sale, is_active
  ) values (
    v_prod_simple_zero, v_org_id, v_type_id, 'product', v_unit_id,
    'ZER-' || v_suffix, 'Prod Zero ' || v_suffix, 'quantity', 0.0000,
    'ARS', 21.0000, true, false, false, true
  );

  -- Product NEGATIVE: 50.0000 ARS base with -100 delta variant
  insert into erp.products (
    id, organization_id, product_type_id, item_kind, unit_id,
    internal_code, internal_name, inventory_tracking, base_sale_price,
    purchase_currency, tax_rate_percent, can_sell, publish_on_web, allow_online_sale, is_active
  ) values (
    v_prod_neg, v_org_id, v_type_id, 'product', v_unit_id,
    'NEG-' || v_suffix, 'Prod Neg ' || v_suffix, 'quantity', 50.0000,
    'ARS', 21.0000, true, false, false, true
  );

  insert into erp.product_variants (
    id, product_id, organization_id, code, name, price_delta, final_price_ars, is_active
  ) values (
    v_var_neg, v_prod_neg, v_org_id, 'VAR-NEG-' || v_suffix, 'Var Negative', -100.0000, null, true
  );

  -- Product WEB: 100.0000 ARS, tax 21% for online order fulfillment
  insert into erp.products (
    id, organization_id, product_type_id, item_kind, unit_id,
    internal_code, internal_name, inventory_tracking, base_sale_price,
    purchase_currency, tax_rate_percent, can_sell, publish_on_web, allow_online_sale, is_active
  ) values (
    v_prod_web, v_org_id, v_type_id, 'product', v_unit_id,
    'WEB-' || v_suffix, 'Prod Web ' || v_suffix, 'quantity', 100.0000,
    'ARS', 21.0000, true, false, false, true
  );

  -- Product V1: 100.0000 ARS, tax 21% for legacy replay testing
  insert into erp.products (
    id, organization_id, product_type_id, item_kind, unit_id,
    internal_code, internal_name, inventory_tracking, base_sale_price,
    purchase_currency, tax_rate_percent, can_sell, publish_on_web, allow_online_sale, is_active
  ) values (
    v_prod_v1, v_org_id, v_type_id, 'product', v_unit_id,
    'V1-' || v_suffix, 'Prod V1 ' || v_suffix, 'quantity', 100.0000,
    'ARS', 21.0000, true, false, false, true
  );

  -- Sales consume valued inventory, not only the quantity cache.
  perform erp.post_stock_document(
    'opening', v_branch_id, 'TEST-OPENING-' || v_suffix,
    'POS gross pricing smoke inventory',
    (
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'product_id', fixture.product_id,
        'variant_id', fixture.variant_id,
        'to_location_id', v_location_id,
        'quantity', 100,
        'unit_cost', 1
      )))
      from (values
        (v_prod_with_vars, v_var_inherit),
        (v_prod_with_vars, v_var_override),
        (v_prod_with_vars, v_var_delta),
        (v_prod_simple_one, null::uuid),
        (v_prod_simple_fract, null::uuid),
        (v_prod_simple_third, null::uuid),
        (v_prod_simple_zero, null::uuid),
        (v_prod_web, null::uuid),
        (v_prod_v1, null::uuid)
      ) fixture(product_id, variant_id)
    )
  );

  -- Foreign tenant fixtures (Real product in real foreign organization)
  insert into erp.organizations (id, display_name, legal_name, tax_id, is_active)
  values (v_foreign_org_id, 'Foreign Org ' || v_suffix, 'Foreign Org ' || v_suffix, '30' || substr(v_suffix, 1, 8) || '1', true);

  insert into erp.units_of_measure (id, organization_id, code, name, is_active)
  values (v_foreign_unit_id, v_foreign_org_id, 'U-' || v_suffix, 'Unidad', true);

  insert into erp.product_types (id, organization_id, code, name, item_kind, default_tracking_mode, is_active)
  values (v_foreign_type_id, v_foreign_org_id, 'PT-' || v_suffix, 'Tipo Prod', 'product', 'quantity', true);

  insert into erp.products (
    id, organization_id, product_type_id, item_kind, unit_id,
    internal_code, internal_name, inventory_tracking, base_sale_price,
    purchase_currency, tax_rate_percent, can_sell, publish_on_web, allow_online_sale, is_active
  ) values (
    v_foreign_prod_id, v_foreign_org_id, v_foreign_type_id, 'product', v_foreign_unit_id,
    'FGN-' || v_suffix, 'Foreign Product', 'quantity', 500.0000,
    'ARS', 21.0000, true, false, false, true
  );

  -- An unposted foreign draft proves journal tenant filtering without forging posted facts.
  insert into erp.branches (id, organization_id, code, name)
  values (v_foreign_branch_id, v_foreign_org_id, 'FBR-' || v_suffix, 'Foreign accounting branch');
  insert into erp.accounting_periods (id, organization_id, period_start, period_end)
  values (v_foreign_period_id, v_foreign_org_id, date_trunc('month', current_date)::date,
    (date_trunc('month', current_date) + interval '1 month - 1 day')::date);
  insert into erp.journal_entries (
    id, organization_id, branch_id, period_id, entry_date, description, idempotency_key, created_by
  ) values (
    v_foreign_entry_id, v_foreign_org_id, v_foreign_branch_id, v_foreign_period_id, current_date,
    'Foreign unposted draft fixture', 'FOREIGN-DRAFT-' || v_suffix, v_admin_uid
  );

  -- Web order fixtures
  insert into erp.customers (id, organization_id, code, display_name, legal_name, kind, is_active)
  values (v_web_customer_id, v_org_id, 'CUST-' || v_suffix, 'Web Customer ' || v_suffix, 'Web Customer ' || v_suffix, 'person', true);

  -- Authoritative stock reservation via RPC (updates stock_balances.quantity_reserved)
  v_web_reservation_id := erp.create_stock_reservation(
    v_branch_id,
    'batch-' || v_suffix,
    'online_order',
    v_web_order_id,
    now() + interval '1 hour',
    jsonb_build_array(
      jsonb_build_object(
        'location_id', v_location_id,
        'product_id', v_prod_web,
        'quantity', 1
      )
    )
  );

  if v_web_reservation_id is null then
    raise exception 'ASSERTION FAILED: create_stock_reservation returned null';
  end if;

  -- Comprobar reserved + 1 tras reserva
  if not exists (
    select 1 from erp.stock_balances
     where organization_id = v_org_id
       and location_id = v_location_id
       and product_id = v_prod_web
       and quantity_reserved >= 1
  ) then
    raise exception 'ASSERTION FAILED: Stock reservation did not increment quantity_reserved';
  end if;

  insert into erp.web_orders (
    id, organization_id, branch_id, customer_id, currency_code, exchange_snapshot_id,
    exchange_rate, reservation_batch_id, idempotency_key, request_hash, total_amount, expires_at
  ) values (
    v_web_order_id, v_org_id, v_branch_id, v_web_customer_id, 'ARS', v_snapshot_id,
    1, v_web_reservation_id, 'web-order-' || v_suffix, 'hash-order-' || v_suffix, 121.0000, now() + interval '1 hour'
  );

  insert into erp.web_order_lines (
    web_order_id, organization_id, branch_id, line_number, product_id, variant_id,
    inventory_unit_id, location_id, description, quantity, unit_price, tax_rate_percent, tax_amount, line_total
  ) values (
    v_web_order_id, v_org_id, v_branch_id, 1, v_prod_web, null,
    null, v_location_id, 'Web Line One', 1, 100.0000, 21.0000, 21.0000, 121.0000
  );

  insert into erp.web_payment_events (
    id, organization_id, branch_id, web_order_id, provider, provider_event_id, provider_payment_id,
    status, payment_method_id, amount, provider_occurred_at, applied
  ) values (
    v_web_payment_event_id, v_org_id, v_branch_id, v_web_order_id, 'mercadopago', 'mp-ev-' || v_suffix, 'mp-pay-' || v_suffix,
    'approved', v_payment_method_id, 121.0000, now(), true
  );

  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, order_state, idempotency_key, request_hash, reason
  ) values (
    v_org_id, v_branch_id, v_web_order_id, 'placed', 'web-order-placed-' || v_suffix, 'hash1', 'Order placed'
  );

  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, payment_state, source_payment_event_id, idempotency_key, request_hash, reason
  ) values (
    v_org_id, v_branch_id, v_web_order_id, 'paid', v_web_payment_event_id, 'web-order-paid-' || v_suffix, 'hash2', 'Payment approved'
  );

  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, delivery_state, idempotency_key, request_hash, reason
  ) values (
    v_org_id, v_branch_id, v_web_order_id, 'preparing', 'web-order-prep-' || v_suffix, 'hash3', 'Order preparing'
  );

  -- --------------------------------------------------------------------------
  -- TEST 1: A negative legacy delta does not affect an inherited price.
  -- --------------------------------------------------------------------------
  v_res := erp.resolve_catalog_effective_price(v_prod_neg, v_var_neg);
  if (v_res->>'final_price_ars')::numeric <> 50.0000
    or v_res->>'price_source' <> 'parent_inherited' then
    raise exception 'ASSERTION FAILED T1: legacy delta must be ignored: %', v_res;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 2: Catalog Price Resolution Authority
  -- --------------------------------------------------------------------------
  -- Parent inherited
  v_res := erp.resolve_catalog_effective_price(v_prod_with_vars, v_var_inherit);
  if (v_res->>'final_price_ars')::numeric <> 1000.0000 or (v_res->>'is_override')::boolean <> false
     or (v_res->>'price_source') <> 'parent_inherited' then
    raise exception 'ASSERTION FAILED T2.a: Variant inherit resolution failed: %', v_res;
  end if;

  -- Variant override
  v_res := erp.resolve_catalog_effective_price(v_prod_with_vars, v_var_override);
  if (v_res->>'final_price_ars')::numeric <> 1500.0000 or (v_res->>'is_override')::boolean <> true
     or (v_res->>'price_source') <> 'variant_override' then
    raise exception 'ASSERTION FAILED T2.b: Variant override resolution failed: %', v_res;
  end if;

  -- Legacy delta
  v_res := erp.resolve_catalog_effective_price(v_prod_with_vars, v_var_delta);
  if (v_res->>'final_price_ars')::numeric <> 1000.0000 or (v_res->>'price_source') <> 'parent_inherited' then
    raise exception 'ASSERTION FAILED T2.c: Legacy delta resolution failed: %', v_res;
  end if;

  -- Simple zero price
  v_res := erp.resolve_catalog_effective_price(v_prod_simple_zero);
  if (v_res->>'final_price_ars')::numeric <> 0.0000 or (v_res->>'price_source') <> 'parent_base' then
    raise exception 'ASSERTION FAILED T2.d: Zero price resolution failed: %', v_res;
  end if;

  -- Simple fractional price
  v_res := erp.resolve_catalog_effective_price(v_prod_simple_fract);
  if (v_res->>'final_price_ars')::numeric <> 100.0050 or (v_res->>'price_source') <> 'parent_base' then
    raise exception 'ASSERTION FAILED T2.e: Fractional price resolution failed: %', v_res;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 3: Function Security Privileges: Core Private, Receipt Authenticated Only
  -- --------------------------------------------------------------------------
  -- erp.create_sale_core must NOT be executable by authenticated, anon, public, or service_role
  if has_function_privilege('authenticated', 'erp.create_sale_core(text,text,uuid,uuid,text,uuid,text,text,jsonb,jsonb,uuid,text)', 'execute')
     or has_function_privilege('anon', 'erp.create_sale_core(text,text,uuid,uuid,text,uuid,text,text,jsonb,jsonb,uuid,text)', 'execute')
     or has_function_privilege('public', 'erp.create_sale_core(text,text,uuid,uuid,text,uuid,text,text,jsonb,jsonb,uuid,text)', 'execute')
     or has_function_privilege('service_role', 'erp.create_sale_core(text,text,uuid,uuid,text,uuid,text,text,jsonb,jsonb,uuid,text)', 'execute') then
    raise exception 'ASSERTION FAILED T3.a: erp.create_sale_core must not grant execute to authenticated/anon/public/service_role';
  end if;

  -- erp.get_document_sale_receipts must be executable ONLY by authenticated
  if not has_function_privilege('authenticated', 'erp.get_document_sale_receipts(uuid[])', 'execute')
     or has_function_privilege('anon', 'erp.get_document_sale_receipts(uuid[])', 'execute')
     or has_function_privilege('public', 'erp.get_document_sale_receipts(uuid[])', 'execute')
     or has_function_privilege('service_role', 'erp.get_document_sale_receipts(uuid[])', 'execute') then
    raise exception 'ASSERTION FAILED T3.b: erp.get_document_sale_receipts must be executable only by authenticated';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 4: Core Exiges sales.create Permission
  -- --------------------------------------------------------------------------
  -- Operational note: Current test database profiles possess administrative permissions
  -- on the single active branch 'CENTRAL'; checking permission rejection against an
  -- unauthorized branch id avoids fabricating synthetic roles while strictly verifying the check.
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.create_sale_core(
      p_origin => 'legacy_internal',
      p_pricing_version => 'v1',
      p_target_branch_id => gen_random_uuid(), -- Branch without permission
      p_target_customer_id => null,
      p_sale_currency => 'ARS',
      p_target_exchange_snapshot_id => v_snapshot_id,
      p_operation_key => 'TEST-NO-PERM-' || v_suffix,
      p_operation_reason => 'Unauthorized branch test',
      p_lines => jsonb_build_array(jsonb_build_object(
        'kind', 'product',
        'product_id', v_prod_simple_one,
        'from_location_id', v_location_id,
        'description', 'No perm line',
        'quantity', 1,
        'unit_price', 1.0000,
        'tax_rate_percent', 0.0000,
        'tax_amount', 0.0000
      )),
      p_payment_lines => jsonb_build_array(jsonb_build_object(
        'payment_method_id', v_payment_method_id,
        'amount', 1.0000
      ))
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;
  if v_sqlstate is distinct from '42501' or v_sqlerrm is distinct from 'sales.create permission is required' then
    raise exception 'ASSERTION FAILED T4: Expected SQLSTATE 42501 for missing sales.create permission, got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 5: Exact Rational Breakdown Case (.33 ARS qty 1 tax 16.6667%)
  -- --------------------------------------------------------------------------
  -- .33 / 1.166667 = 0.282857... -> Net = 0.2829, Tax = 0.0471, Line Total = 0.3300
  v_op_key := 'TEST-THIRD-Q1-' || v_suffix;
  v_res := erp.create_sale_with_invoice(
    target_branch_id => v_branch_id,
    target_customer_id => null,
    sale_currency => 'ARS',
    target_exchange_snapshot_id => v_snapshot_id,
    operation_key => v_op_key,
    operation_reason => 'Venta 0.33 tasa 16.6667',
    lines => jsonb_build_array(jsonb_build_object(
      'kind', 'product',
      'product_id', v_prod_simple_third,
      'from_location_id', v_location_id,
      'description', 'Producto 0.33',
      'quantity', 1,
      'expected_unit_price', 0.3300,
      'expected_tax_rate', 16.6667
    )),
    target_invoice_kind => 'non_fiscal',
    payment_lines => jsonb_build_array(jsonb_build_object(
      'payment_method_id', v_payment_method_id,
      'amount', 0.3300
    ))
  );

  v_sale_id := (v_res->>'sale_id')::uuid;
  select * into v_sale_row from erp.sales where id = v_sale_id;
  select * into v_line_row from erp.sale_lines where sale_id = v_sale_id;

  if v_line_row.unit_gross_price <> 0.3300 or v_line_row.net_subtotal_amount <> 0.2829
     or v_line_row.tax_amount <> 0.0471 or v_line_row.line_total <> 0.3300 then
    raise exception 'ASSERTION FAILED T5: Third breakdown mismatch: gross=% net=% tax=% total=%',
      v_line_row.unit_gross_price, v_line_row.net_subtotal_amount, v_line_row.tax_amount, v_line_row.line_total;
  end if;

  if v_sale_row.subtotal_amount <> 0.2829 or v_sale_row.tax_amount <> 0.0471 or v_sale_row.total_amount <> 0.3300 then
    raise exception 'ASSERTION FAILED T5: Third header totals mismatch: subtotal=% tax=% total=%',
      v_sale_row.subtotal_amount, v_sale_row.tax_amount, v_sale_row.total_amount;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 6: Gross 1.0000, Qty 1, Tax 21% via create_sale_with_invoice
  -- --------------------------------------------------------------------------
  v_op_key := 'TEST-ONE-Q1-' || v_suffix;
  v_res := erp.create_sale_with_invoice(
    target_branch_id => v_branch_id,
    target_customer_id => null,
    sale_currency => 'ARS',
    target_exchange_snapshot_id => v_snapshot_id,
    operation_key => v_op_key,
    operation_reason => 'Venta 1 peso q1',
    lines => jsonb_build_array(jsonb_build_object(
      'kind', 'product',
      'product_id', v_prod_simple_one,
      'from_location_id', v_location_id,
      'description', 'Producto 1 peso',
      'quantity', 1,
      'expected_unit_price', 1.0000,
      'expected_tax_rate', 21.0000
    )),
    target_invoice_kind => 'non_fiscal',
    payment_lines => jsonb_build_array(jsonb_build_object(
      'payment_method_id', v_payment_method_id,
      'amount', 1.0000
    ))
  );

  v_sale_id := (v_res->>'sale_id')::uuid;
  select * into v_sale_row from erp.sales where id = v_sale_id;
  select * into v_line_row from erp.sale_lines where sale_id = v_sale_id;

  if v_sale_row.pricing_version <> 'v2' or v_line_row.pricing_version <> 'v2' then
    raise exception 'ASSERTION FAILED T6: Pricing version v2 was not persisted';
  end if;

  if v_line_row.unit_gross_price <> 1.0000 or v_line_row.line_total <> 1.0000
     or v_line_row.net_subtotal_amount <> 0.8264 or v_line_row.tax_amount <> 0.1736 then
    raise exception 'ASSERTION FAILED T6: Line breakdown mismatch: gross=% net=% tax=% total=%',
      v_line_row.unit_gross_price, v_line_row.net_subtotal_amount, v_line_row.tax_amount, v_line_row.line_total;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 7: Gross 1.0000, Qty 2, Tax 21%
  -- --------------------------------------------------------------------------
  v_op_key := 'TEST-ONE-Q2-' || v_suffix;
  v_res := erp.create_sale_with_invoice(
    target_branch_id => v_branch_id,
    target_customer_id => null,
    sale_currency => 'ARS',
    target_exchange_snapshot_id => v_snapshot_id,
    operation_key => v_op_key,
    operation_reason => 'Venta 1 peso q2',
    lines => jsonb_build_array(jsonb_build_object(
      'kind', 'product',
      'product_id', v_prod_simple_one,
      'from_location_id', v_location_id,
      'description', 'Producto 1 peso q2',
      'quantity', 2,
      'expected_unit_price', 1.0000,
      'expected_tax_rate', 21.0000
    )),
    target_invoice_kind => 'non_fiscal',
    payment_lines => jsonb_build_array(jsonb_build_object(
      'payment_method_id', v_payment_method_id,
      'amount', 2.0000
    ))
  );

  v_sale_id := (v_res->>'sale_id')::uuid;
  select * into v_line_row from erp.sale_lines where sale_id = v_sale_id;

  if v_line_row.line_total <> 2.0000 or v_line_row.net_subtotal_amount <> 1.6529 or v_line_row.tax_amount <> 0.3471 then
    raise exception 'ASSERTION FAILED T7: Qty 2 breakdown mismatch: net=% tax=% total=%',
      v_line_row.net_subtotal_amount, v_line_row.tax_amount, v_line_row.line_total;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 8: Gross 100.0050, Qty 3, Tax 21% (No NaN, exact 4 decimals)
  -- --------------------------------------------------------------------------
  v_op_key := 'TEST-FRACT-Q3-' || v_suffix;
  v_res := erp.create_sale_with_invoice(
    target_branch_id => v_branch_id,
    target_customer_id => null,
    sale_currency => 'ARS',
    target_exchange_snapshot_id => v_snapshot_id,
    operation_key => v_op_key,
    operation_reason => 'Venta 100.005 q3',
    lines => jsonb_build_array(jsonb_build_object(
      'kind', 'product',
      'product_id', v_prod_simple_fract,
      'from_location_id', v_location_id,
      'description', 'Producto 100.005',
      'quantity', 3,
      'expected_unit_price', 100.0050,
      'expected_tax_rate', 21.0000
    )),
    target_invoice_kind => 'non_fiscal',
    payment_lines => jsonb_build_array(jsonb_build_object(
      'payment_method_id', v_payment_method_id,
      'amount', 300.0150
    ))
  );

  v_sale_id := (v_res->>'sale_id')::uuid;
  select * into v_sale_row from erp.sales where id = v_sale_id;
  select * into v_line_row from erp.sale_lines where sale_id = v_sale_id;

  if v_line_row.line_total <> 300.0150 or v_line_row.net_subtotal_amount <> 247.9463 or v_line_row.tax_amount <> 52.0687 then
    raise exception 'ASSERTION FAILED T8: 100.0050 q3 breakdown mismatch: net=% tax=% total=%',
      v_line_row.net_subtotal_amount, v_line_row.tax_amount, v_line_row.line_total;
  end if;

  v_account_sale_id := v_sale_id;

  -- --------------------------------------------------------------------------
  -- TEST 9: Zero Gross Price Valid with Empty Payments [] (Unpaid Event Recorded)
  -- --------------------------------------------------------------------------
  v_op_key := 'TEST-ZERO-Q1-' || v_suffix;
  v_res := erp.create_sale_with_invoice(
    target_branch_id => v_branch_id,
    target_customer_id => null,
    sale_currency => 'ARS',
    target_exchange_snapshot_id => v_snapshot_id,
    operation_key => v_op_key,
    operation_reason => 'Venta precio cero',
    lines => jsonb_build_array(jsonb_build_object(
      'kind', 'product',
      'product_id', v_prod_simple_zero,
      'from_location_id', v_location_id,
      'description', 'Producto precio cero',
      'quantity', 1,
      'expected_unit_price', 0.0000,
      'expected_tax_rate', 21.0000
    )),
    target_invoice_kind => 'non_fiscal',
    payment_lines => '[]'::jsonb
  );

  v_sale_id := (v_res->>'sale_id')::uuid;
  select * into v_line_row from erp.sale_lines where sale_id = v_sale_id;
  if v_line_row.line_total <> 0.0000 or v_line_row.tax_amount <> 0.0000 then
    raise exception 'ASSERTION FAILED T9.a: Zero price sale did not reconcile';
  end if;

  if not exists (
    select 1 from erp.sale_state_events
     where sale_id = v_sale_id and payment_state = 'unpaid'
  ) then
    raise exception 'ASSERTION FAILED T9.b: Zero price sale with empty payments did not record unpaid event';
  end if;

  -- Verify zero revenue sale with 1 COGS posted only COGS pair (no revenue 0/0 lines)
  select * into v_entry_row
    from erp.journal_entries
   where source_type = 'sale' and source_id = v_sale_id;

  if v_entry_row.id is null or v_entry_row.total_debit <> 1.0000 or v_entry_row.total_credit <> 1.0000 then
    raise exception 'ASSERTION FAILED T9.c: Zero revenue sale did not record 1.0000 COGS entry: total=%', v_entry_row.total_debit;
  end if;

  if (select count(*) from erp.journal_entry_lines where journal_entry_id = v_entry_row.id) <> 2 then
    raise exception 'ASSERTION FAILED T9.d: Expected exactly 2 lines (COGS only), got %',
      (select count(*) from erp.journal_entry_lines where journal_entry_id = v_entry_row.id);
  end if;

  if exists (
    select 1 from erp.journal_entry_lines
     where journal_entry_id = v_entry_row.id
       and debit = 0 and credit = 0
  ) then
    raise exception 'ASSERTION FAILED T9.e: Zero/Zero line found in journal entry';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 10: Null Payment Lines Rejected vs [] with Unpaid Event and Customer Receivable
  -- --------------------------------------------------------------------------
  -- Part A: NULL payment lines strictly rejected
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.create_sale_with_invoice(
      target_branch_id => v_branch_id,
      target_customer_id => null,
      sale_currency => 'ARS',
      target_exchange_snapshot_id => v_snapshot_id,
      operation_key => 'TEST-NULL-PAY-' || v_suffix,
      operation_reason => 'Null payment lines test',
      lines => jsonb_build_array(jsonb_build_object(
        'kind', 'product',
        'product_id', v_prod_simple_one,
        'from_location_id', v_location_id,
        'description', 'Line for null pay',
        'quantity', 1,
        'expected_unit_price', 1.0000,
        'expected_tax_rate', 21.0000
      )),
      target_invoice_kind => 'non_fiscal',
      payment_lines => null
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;
  if v_sqlstate is distinct from '22023' or v_sqlerrm is distinct from 'maximum of 20 payment lines allowed' then
    raise exception 'ASSERTION FAILED T10.a: Expected SQLSTATE 22023 for null payment lines, got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  -- Part B: Empty payments [] with customer creates receivable and records unpaid state event
  v_op_key := 'TEST-UNPAID-ACCT-' || v_suffix;
  v_res := erp.create_sale_with_invoice(
    target_branch_id => v_branch_id,
    target_customer_id => v_web_customer_id,
    sale_currency => 'ARS',
    target_exchange_snapshot_id => v_snapshot_id,
    operation_key => v_op_key,
    operation_reason => 'Venta en cuenta corriente impaga',
    lines => jsonb_build_array(jsonb_build_object(
      'kind', 'product',
      'product_id', v_prod_simple_one,
      'from_location_id', v_location_id,
      'description', 'Line for unpaid account',
      'quantity', 1,
      'expected_unit_price', 1.0000,
      'expected_tax_rate', 21.0000
    )),
    target_invoice_kind => 'non_fiscal',
    payment_lines => '[]'::jsonb
  );

  v_customer_acc_sale_id := (v_res->>'sale_id')::uuid;

  if not exists (
    select 1 from erp.customer_receivables
     where sale_id = v_customer_acc_sale_id and customer_id = v_web_customer_id and original_amount = 1.0000
  ) or not exists (
    select 1 from erp.sale_state_events
     where sale_id = v_customer_acc_sale_id and payment_state = 'unpaid'
  ) then
    raise exception 'ASSERTION FAILED T10.b: Unpaid sale on customer account did not record receivable or unpaid event';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 11: Monto v2 > 1e9 Rejected vs Paid Legacy Without That Limit
  -- --------------------------------------------------------------------------
  -- Part A: v2 sale with unit price > 1e9 is rejected by core validation
  update erp.products set base_sale_price = 1000000001.0000 where id = v_prod_simple_one;

  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.create_sale_with_invoice(
      target_branch_id => v_branch_id,
      target_customer_id => null,
      sale_currency => 'ARS',
      target_exchange_snapshot_id => v_snapshot_id,
      operation_key => 'TEST-MAX-V2-' || v_suffix,
      operation_reason => 'Test exceeds 1e9 v2',
      lines => jsonb_build_array(jsonb_build_object(
        'kind', 'product',
        'product_id', v_prod_simple_one,
        'from_location_id', v_location_id,
        'description', 'Prod > 1e9',
        'quantity', 1,
        'expected_unit_price', 1000000001.0000,
        'expected_tax_rate', 21.0000
      )),
      target_invoice_kind => 'non_fiscal',
      payment_lines => jsonb_build_array(jsonb_build_object(
        'payment_method_id', v_payment_method_id,
        'amount', 1000000001.0000
      ))
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;
  update erp.products set base_sale_price = 1.0000 where id = v_prod_simple_one;

  if v_sqlstate is distinct from '22023' or v_sqlerrm is distinct from 'POS amount exceeds maximum of 1000000000 ARS' then
    raise exception 'ASSERTION FAILED T11.a: Expected SQLSTATE 22023 for amount > 1e9 in v2, got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  -- Part B: Paid legacy (v1) created via core succeeds without 1e9 limit
  v_big_sale_id := erp.create_sale_core(
    p_origin => 'legacy_internal',
    p_pricing_version => 'v1',
    p_target_branch_id => v_branch_id,
    p_target_customer_id => null,
    p_sale_currency => 'ARS',
    p_target_exchange_snapshot_id => v_snapshot_id,
    p_operation_key => 'TEST-LEGACY-BIG-' || v_suffix,
    p_operation_reason => 'Legacy sale > 1e9',
    p_lines => jsonb_build_array(jsonb_build_object(
      'kind', 'product',
      'product_id', v_prod_simple_one,
      'from_location_id', v_location_id,
      'description', 'Legacy big sale',
      'quantity', 1,
      'unit_price', 2000000000.0000,
      'discount_amount', 0,
      'tax_rate_percent', 0.0000,
      'tax_amount', 0.0000
    )),
    p_payment_lines => jsonb_build_array(jsonb_build_object(
      'payment_method_id', v_payment_method_id,
      'amount', 2000000000.0000
    ))
  );

  select * into v_sale_row from erp.sales where id = v_big_sale_id;
  if v_sale_row.pricing_version <> 'v1' or v_sale_row.total_amount <> 2000000000.0000 then
    raise exception 'ASSERTION FAILED T11.b: Legacy sale > 1e9 did not persist properly: total=% version=%',
      v_sale_row.total_amount, v_sale_row.pricing_version;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 12: Stale Quote / Price Manipulation Rejection
  -- --------------------------------------------------------------------------
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.create_sale_with_invoice(
      target_branch_id => v_branch_id,
      target_customer_id => null,
      sale_currency => 'ARS',
      target_exchange_snapshot_id => v_snapshot_id,
      operation_key => 'TEST-MANIP-P-' || v_suffix,
      operation_reason => 'Intento manipulacion precio',
      lines => jsonb_build_array(jsonb_build_object(
        'kind', 'product',
        'product_id', v_prod_with_vars,
        'variant_id', v_var_inherit,
        'from_location_id', v_location_id,
        'description', 'Prod Standard',
        'quantity', 1,
        'expected_unit_price', 500.0000, -- Catalog is 1000!
        'expected_tax_rate', 21.0000
      )),
      target_invoice_kind => 'non_fiscal',
      payment_lines => jsonb_build_array(jsonb_build_object(
        'payment_method_id', v_payment_method_id,
        'amount', 500.0000
      ))
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;
  if v_sqlstate is distinct from '23514' or v_sqlerrm is distinct from 'stale quote: catalog price or tax rate has changed, requote required' then
    raise exception 'ASSERTION FAILED T12: Expected SQLSTATE 23514 (stale quote price), got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 13: Stale Quote / 1-Tick Price Difference Rejection (Zero Tolerance)
  -- --------------------------------------------------------------------------
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.create_sale_with_invoice(
      target_branch_id => v_branch_id,
      target_customer_id => null,
      sale_currency => 'ARS',
      target_exchange_snapshot_id => v_snapshot_id,
      operation_key => 'TEST-1TICK-' || v_suffix,
      operation_reason => 'Intento 1 tick desfasado',
      lines => jsonb_build_array(jsonb_build_object(
        'kind', 'product',
        'product_id', v_prod_with_vars,
        'variant_id', v_var_inherit,
        'from_location_id', v_location_id,
        'description', 'Prod Standard 1 tick',
        'quantity', 1,
        'expected_unit_price', 1000.0001, -- 1 tick off from 1000.0000!
        'expected_tax_rate', 21.0000
      )),
      target_invoice_kind => 'non_fiscal',
      payment_lines => jsonb_build_array(jsonb_build_object(
        'payment_method_id', v_payment_method_id,
        'amount', 1000.0001
      ))
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;
  if v_sqlstate is distinct from '23514' or v_sqlerrm is distinct from 'stale quote: catalog price or tax rate has changed, requote required' then
    raise exception 'ASSERTION FAILED T13: Expected SQLSTATE 23514 for 1-tick stale quote, got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 14: Free Concept Rejected in POS v2
  -- --------------------------------------------------------------------------
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.create_sale_with_invoice(
      target_branch_id => v_branch_id,
      target_customer_id => null,
      sale_currency => 'ARS',
      target_exchange_snapshot_id => v_snapshot_id,
      operation_key => 'TEST-FREE-CONCEPT-' || v_suffix,
      operation_reason => 'Intento free_concept',
      lines => jsonb_build_array(jsonb_build_object(
        'kind', 'free_concept',
        'description', 'Concepto libre no permitido',
        'quantity', 1,
        'expected_unit_price', 100.0000,
        'expected_tax_rate', 21.0000
      )),
      target_invoice_kind => 'non_fiscal',
      payment_lines => jsonb_build_array(jsonb_build_object(
        'payment_method_id', v_payment_method_id,
        'amount', 100.0000
      ))
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;
  if v_sqlstate is distinct from '0A000' or v_sqlerrm is distinct from 'free_concept lines are not permitted for POS v2 sales' then
    raise exception 'ASSERTION FAILED T14: Expected SQLSTATE 0A000 (free concept rejected), got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 15: Missing variant_id on Product with Variants Rejected
  -- --------------------------------------------------------------------------
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.create_sale_with_invoice(
      target_branch_id => v_branch_id,
      target_customer_id => null,
      sale_currency => 'ARS',
      target_exchange_snapshot_id => v_snapshot_id,
      operation_key => 'TEST-MISSING-VAR-' || v_suffix,
      operation_reason => 'Intento sin variant_id',
      lines => jsonb_build_array(jsonb_build_object(
        'kind', 'product',
        'product_id', v_prod_with_vars, -- Has variants!
        'variant_id', null, -- Missing variant_id!
        'from_location_id', v_location_id,
        'description', 'Prod con variantes sin variante',
        'quantity', 1,
        'expected_unit_price', 1000.0000,
        'expected_tax_rate', 21.0000
      )),
      target_invoice_kind => 'non_fiscal',
      payment_lines => jsonb_build_array(jsonb_build_object(
        'payment_method_id', v_payment_method_id,
        'amount', 1000.0000
      ))
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;
  if v_sqlstate is distinct from '22023' or v_sqlerrm is distinct from 'sale line 1 product has variants; explicit variant_id is required' then
    raise exception 'ASSERTION FAILED T15: Expected SQLSTATE 22023 for missing variant_id, got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 16: Non-ARS Currency Rejected in POS v2
  -- --------------------------------------------------------------------------
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.create_sale_with_invoice(
      target_branch_id => v_branch_id,
      target_customer_id => null,
      sale_currency => 'USD', -- Non-ARS!
      target_exchange_snapshot_id => v_snapshot_id,
      operation_key => 'TEST-NON-ARS-' || v_suffix,
      operation_reason => 'Intento moneda USD',
      lines => jsonb_build_array(jsonb_build_object(
        'kind', 'product',
        'product_id', v_prod_simple_one,
        'from_location_id', v_location_id,
        'description', 'Prod en USD',
        'quantity', 1,
        'expected_unit_price', 1.0000,
        'expected_tax_rate', 21.0000
      )),
      target_invoice_kind => 'non_fiscal',
      payment_lines => jsonb_build_array(jsonb_build_object(
        'payment_method_id', v_payment_method_id,
        'amount', 1.0000
      ))
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;
  if v_sqlstate is distinct from '22023' or v_sqlerrm is distinct from 'pos v2 sales strictly require ARS currency' then
    raise exception 'ASSERTION FAILED T16: Expected SQLSTATE 22023 for non-ARS currency, got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 17: Old RPC Bypass Prevention (erp.create_sale)
  -- --------------------------------------------------------------------------
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.create_sale(
      target_branch_id => v_branch_id,
      target_customer_id => null,
      sale_currency => 'ARS',
      target_exchange_snapshot_id => v_snapshot_id,
      operation_key => 'TEST-OLD-BYPASS-' || v_suffix,
      operation_reason => 'Intento bypass con RPC viejo',
      lines => jsonb_build_array(jsonb_build_object(
        'kind', 'product',
        'product_id', v_prod_simple_one,
        'from_location_id', v_location_id,
        'description', 'Prod bypass',
        'quantity', 1,
        'unit_price', 100.0000,
        'tax_rate_percent', 0.0000
      )),
      payment_lines => jsonb_build_array(jsonb_build_object(
        'payment_method_id', v_payment_method_id,
        'amount', 100.0000
      ))
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;
  if v_sqlstate is distinct from '0A000' or v_sqlerrm is distinct from 'direct legacy create_sale is deprecated for new sales; use create_sale_with_invoice with server-authoritative pricing' then
    raise exception 'ASSERTION FAILED T17: Expected SQLSTATE 0A000 for legacy create_sale bypass, got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 18: Real Fixture v1: Core Creation, Replay-Only on Legacy create_sale,
  --          Replay Mismatch Rejection, and Document Receipt Readback
  -- --------------------------------------------------------------------------
  v_v1_op_key := 'TEST-LEGACY-V1-' || v_suffix;
  v_v1_reason := 'Venta legacy v1 para replay';
  v_v1_lines := jsonb_build_array(jsonb_build_object(
    'kind', 'product',
    'product_id', v_prod_v1,
    'from_location_id', v_location_id,
    'description', 'Legacy item 100 net',
    'quantity', 1,
    'unit_price', 100.0000,
    'discount_amount', 0,
    'tax_rate_percent', 21.0000,
    'tax_amount', 21.0000
  ));
  v_v1_payments := jsonb_build_array(jsonb_build_object(
    'payment_method_id', v_payment_method_id,
    'amount', 121.0000
  ));

  -- Step 1: Create real v1 sale via private core within the transaction
  v_v1_sale_id := erp.create_sale_core(
    p_origin => 'legacy_internal',
    p_pricing_version => 'v1',
    p_target_branch_id => v_branch_id,
    p_target_customer_id => null,
    p_sale_currency => 'ARS',
    p_target_exchange_snapshot_id => v_snapshot_id,
    p_operation_key => v_v1_op_key,
    p_operation_reason => v_v1_reason,
    p_lines => v_v1_lines,
    p_payment_lines => v_v1_payments
  );

  select * into v_sale_row from erp.sales where id = v_v1_sale_id;
  select * into v_line_row from erp.sale_lines where sale_id = v_v1_sale_id;

  if v_sale_row.pricing_version is distinct from 'v1' or v_sale_row.total_amount is distinct from 121.0000
     or v_line_row.pricing_version is distinct from 'v1' or v_line_row.unit_price is distinct from 100.0000
     or v_line_row.unit_gross_price is not null or v_line_row.net_subtotal_amount is not null then
    raise exception 'ASSERTION FAILED T18.a: Legacy v1 facts mismatch: version=% total=% line_gross=%',
      v_sale_row.pricing_version, v_sale_row.total_amount, v_line_row.unit_gross_price;
  end if;

  -- Step 2: Mutate catalog base price to 5555.0000 ARS
  update erp.products set base_sale_price = 5555.0000 where id = v_prod_v1;

  -- Step 3: Replay via public erp.create_sale -> must succeed returning exact same sale ID
  v_v1_replayed_id := erp.create_sale(
    target_branch_id => v_branch_id,
    target_customer_id => null,
    sale_currency => 'ARS',
    target_exchange_snapshot_id => v_snapshot_id,
    operation_key => v_v1_op_key,
    operation_reason => v_v1_reason,
    lines => v_v1_lines,
    payment_lines => v_v1_payments
  );

  if v_v1_replayed_id is distinct from v_v1_sale_id then
    raise exception 'ASSERTION FAILED T18.b: Legacy replay returned different sale ID: original=% replayed=%',
      v_v1_sale_id, v_v1_replayed_id;
  end if;

  -- Step 4: Replay with modified payload must reject with 23505
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.create_sale(
      target_branch_id => v_branch_id,
      target_customer_id => null,
      sale_currency => 'ARS',
      target_exchange_snapshot_id => v_snapshot_id,
      operation_key => v_v1_op_key,
      operation_reason => 'Payload alterado',
      lines => jsonb_build_array(jsonb_build_object(
        'kind', 'product',
        'product_id', v_prod_v1,
        'from_location_id', v_location_id,
        'description', 'Changed line',
        'quantity', 2,
        'unit_price', 100.0000,
        'discount_amount', 0,
        'tax_rate_percent', 21.0000,
        'tax_amount', 42.0000
      )),
      payment_lines => jsonb_build_array(jsonb_build_object(
        'payment_method_id', v_payment_method_id,
        'amount', 242.0000
      ))
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;
  if v_sqlstate is distinct from '23505' or v_sqlerrm is distinct from 'idempotency key is already used by another request' then
    raise exception 'ASSERTION FAILED T18.c: Expected SQLSTATE 23505 for modified legacy replay, got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  -- Step 5: Issue invoice document for v1 sale and verify receipt readback reflects v1 schema
  v_sha_fixture := md5('v1-doc-part1-' || v_suffix) || md5('v1-doc-part2-' || v_suffix);
  v_v1_doc_id := erp.issue_invoice_document(
    v_branch_id,
    v_template_version_id,
    v_v1_sale_id,
    'non_fiscal',
    'NF-V1-' || v_suffix,
    jsonb_build_object('display_name', 'Consumidor Final', 'kind', 'person'),
    v_sha_fixture,
    v_v1_op_key || ':doc',
    'Documento legacy v1'
  );

  select receipt into v_res from erp.get_document_sale_receipts(array[v_v1_doc_id]);
  if v_res is null or (v_res->>'pricing_version') is distinct from 'v1'
     or (v_res->'lines'->0->>'pricing_version') is distinct from 'v1'
     or (v_res->'lines'->0->>'unit_gross_price') is not null
     or (v_res->'lines'->0->>'net_subtotal_amount') is not null
     or (v_res->'lines'->0->>'line_total')::numeric is distinct from 121.0000 then
    raise exception 'ASSERTION FAILED T18.d: Legacy v1 receipt readback mismatch: %', v_res;
  end if;

  -- Restore catalog price
  update erp.products set base_sale_price = 100.0000 where id = v_prod_v1;

  -- --------------------------------------------------------------------------
  -- TEST 19: Idempotent Replay AFTER Catalog Price Change and Template Deactivation (v2)
  -- --------------------------------------------------------------------------
  v_op_key := 'TEST-REPLAY-PRICING-' || v_suffix;
  v_res := erp.create_sale_with_invoice(
    target_branch_id => v_branch_id,
    target_customer_id => null,
    sale_currency => 'ARS',
    target_exchange_snapshot_id => v_snapshot_id,
    operation_key => v_op_key,
    operation_reason => 'Venta antes de cambio de precio',
    lines => jsonb_build_array(jsonb_build_object(
      'kind', 'product',
      'product_id', v_prod_simple_one,
      'from_location_id', v_location_id,
      'description', 'Prod pre-update',
      'quantity', 1,
      'expected_unit_price', 1.0000,
      'expected_tax_rate', 21.0000
    )),
    target_invoice_kind => 'non_fiscal',
    payment_lines => jsonb_build_array(jsonb_build_object(
      'payment_method_id', v_payment_method_id,
      'amount', 1.0000
    ))
  );

  v_sale_id := (v_res->>'sale_id')::uuid;
  v_doc_id := (v_res->>'document_id')::uuid;

  -- Change catalog price to 50.0000
  update erp.products set base_sale_price = 50.0000 where id = v_prod_simple_one;

  -- Deactivate sale document templates to prove replay returns BEFORE template check
  update erp.document_templates set is_active = false where organization_id = v_org_id and document_kind = 'sale';

  -- Replay with SAME operation_key and SAME original request payload
  v_res := erp.create_sale_with_invoice(
    target_branch_id => v_branch_id,
    target_customer_id => null,
    sale_currency => 'ARS',
    target_exchange_snapshot_id => v_snapshot_id,
    operation_key => v_op_key,
    operation_reason => 'Venta antes de cambio de precio',
    lines => jsonb_build_array(jsonb_build_object(
      'kind', 'product',
      'product_id', v_prod_simple_one,
      'from_location_id', v_location_id,
      'description', 'Prod pre-update',
      'quantity', 1,
      'expected_unit_price', 1.0000,
      'expected_tax_rate', 21.0000
    )),
    target_invoice_kind => 'non_fiscal',
    payment_lines => jsonb_build_array(jsonb_build_object(
      'payment_method_id', v_payment_method_id,
      'amount', 1.0000
    ))
  );

  if (v_res->>'sale_id')::uuid <> v_sale_id or (v_res->>'document_id')::uuid <> v_doc_id then
    raise exception 'ASSERTION FAILED T19: Replay returned different sale/document IDs: %', v_res;
  end if;

  -- Restore templates and catalog price
  update erp.document_templates set is_active = true where organization_id = v_org_id and document_kind = 'sale';
  update erp.products set base_sale_price = 1.0000 where id = v_prod_simple_one;

  -- --------------------------------------------------------------------------
  -- TEST 20: Reusing Operation Key with Different Payload Rejected (v2)
  -- --------------------------------------------------------------------------
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.create_sale_with_invoice(
      target_branch_id => v_branch_id,
      target_customer_id => null,
      sale_currency => 'ARS',
      target_exchange_snapshot_id => v_snapshot_id,
      operation_key => v_op_key, -- Reused key from T19!
      operation_reason => 'Payload cambiado con misma key',
      lines => jsonb_build_array(jsonb_build_object(
        'kind', 'product',
        'product_id', v_prod_simple_fract, -- Different product!
        'from_location_id', v_location_id,
        'description', 'Prod Fract con key duplicada',
        'quantity', 1,
        'expected_unit_price', 100.0050,
        'expected_tax_rate', 21.0000
      )),
      target_invoice_kind => 'non_fiscal',
      payment_lines => jsonb_build_array(jsonb_build_object(
        'payment_method_id', v_payment_method_id,
        'amount', 100.0050
      ))
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;
  if v_sqlstate is distinct from '23505' then
    raise exception 'ASSERTION FAILED T20: Expected SQLSTATE 23505 for reused key with different payload, got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 21: Stale Quote Leaves Zero State Mutation
  -- --------------------------------------------------------------------------
  select count(*) into v_sales_count_before from erp.sales where organization_id = v_org_id;
  select count(*) into v_moves_count_before from erp.stock_movements where organization_id = v_org_id;
  select count(*) into v_pays_count_before from erp.payments where organization_id = v_org_id;

  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.create_sale_with_invoice(
      target_branch_id => v_branch_id,
      target_customer_id => null,
      sale_currency => 'ARS',
      target_exchange_snapshot_id => v_snapshot_id,
      operation_key => 'TEST-STALE-NOMUTATE-' || v_suffix,
      operation_reason => 'Stale quote test',
      lines => jsonb_build_array(jsonb_build_object(
        'kind', 'product',
        'product_id', v_prod_simple_one,
        'from_location_id', v_location_id,
        'description', 'Stale price line',
        'quantity', 1,
        'expected_unit_price', 999.0000, -- Stale!
        'expected_tax_rate', 21.0000
      )),
      target_invoice_kind => 'non_fiscal',
      payment_lines => jsonb_build_array(jsonb_build_object(
        'payment_method_id', v_payment_method_id,
        'amount', 999.0000
      ))
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;

  if v_sqlstate is distinct from '23514' or v_sqlerrm is distinct from 'stale quote: catalog price or tax rate has changed, requote required' then
    raise exception 'ASSERTION FAILED T21: Expected SQLSTATE 23514 (stale quote), got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  if (select count(*) from erp.sales where organization_id = v_org_id) <> v_sales_count_before
     or (select count(*) from erp.stock_movements where organization_id = v_org_id) <> v_moves_count_before
     or (select count(*) from erp.payments where organization_id = v_org_id) <> v_pays_count_before then
    raise exception 'ASSERTION FAILED T21: Stale quote mutation leaked rows into sales, movements, or payments';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 22: Gross Discounts Reconciliation (if actor has sales.discount)
  -- --------------------------------------------------------------------------
  if v_has_discount then
    v_op_key := 'TEST-DISCOUNT-' || v_suffix;
    v_res := erp.create_sale_with_invoice(
      target_branch_id => v_branch_id,
      target_customer_id => null,
      sale_currency => 'ARS',
      target_exchange_snapshot_id => v_snapshot_id,
      operation_key => v_op_key,
      operation_reason => 'Venta con descuento gross',
      lines => jsonb_build_array(jsonb_build_object(
        'kind', 'product',
        'product_id', v_prod_with_vars,
        'variant_id', v_var_inherit,
        'from_location_id', v_location_id,
        'description', 'Prod con $100 descuento',
        'quantity', 1,
        'expected_unit_price', 1000.0000,
        'expected_tax_rate', 21.0000,
        'gross_discount_amount', 100.0000,
        'discount_reason', 'Descuento promocional'
      )),
      target_invoice_kind => 'non_fiscal',
      payment_lines => jsonb_build_array(jsonb_build_object(
        'payment_method_id', v_payment_method_id,
        'amount', 900.0000
      ))
    );

    v_sale_id := (v_res->>'sale_id')::uuid;
    select * into v_sale_row from erp.sales where id = v_sale_id;
    select * into v_line_row from erp.sale_lines where sale_id = v_sale_id;

    if v_line_row.line_total <> 900.0000 or v_sale_row.total_amount <> 900.0000 then
      raise exception 'ASSERTION FAILED T22: Discounted sale line total mismatch: line=% sale=%',
        v_line_row.line_total, v_sale_row.total_amount;
    end if;

    if v_sale_row.total_amount <> (v_sale_row.subtotal_amount - v_sale_row.discount_amount + v_sale_row.tax_amount) then
      raise exception 'ASSERTION FAILED T22: Header formula failed: subtotal=% discount=% tax=% total=%',
        v_sale_row.subtotal_amount, v_sale_row.discount_amount, v_sale_row.tax_amount, v_sale_row.total_amount;
    end if;

    if not exists (
      select 1 from erp.sale_discount_authorizations
       where sale_id = v_sale_id and authorized_amount = 100.0000
    ) then
      raise exception 'ASSERTION FAILED T22: Discount authorization entry missing';
    end if;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 23: Receipt Readback Reflects Persisted Facts and v2 Pricing
  -- --------------------------------------------------------------------------
  v_doc_id := (v_res->>'document_id')::uuid;
  select receipt into v_res from erp.get_document_sale_receipts(array[v_doc_id]);

  if v_res is null then
    raise exception 'ASSERTION FAILED T23: Receipt readback returned null';
  end if;

  if (v_res->>'pricing_version') <> 'v2' then
    raise exception 'ASSERTION FAILED T23: Receipt header pricing_version mismatch: %', v_res;
  end if;

  if (v_res->'lines'->0->>'unit_gross_price') is null or (v_res->'lines'->0->>'net_subtotal_amount') is null
     or (v_res->'lines'->0->>'line_total') is null then
    raise exception 'ASSERTION FAILED T23: Receipt v2 fields are missing: %', v_res->'lines'->0;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 24: Cross-Tenant Isolation with Real Foreign Product
  -- --------------------------------------------------------------------------
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.resolve_catalog_effective_price(v_foreign_prod_id);
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;
  if v_sqlstate is distinct from 'P0002' or v_sqlerrm is distinct from 'product not found in current organization' then
    raise exception 'ASSERTION FAILED T24: Expected SQLSTATE P0002 for foreign product across tenant boundary, got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 25: Web Paid Fulfillment (Ready Delivery State, Snapshot Preservation & Both Outbox Events)
  -- --------------------------------------------------------------------------
  -- Attempt fulfill while in 'preparing' delivery state -> must reject with 55000 (Fix 6)
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.fulfill_web_order(v_web_order_id, 'fulfill-fail-' || v_suffix, 'Fulfill should fail');
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;
  if v_sqlstate is distinct from '55000' or v_sqlerrm is distinct from 'a ready web order is required for fulfillment' then
    raise exception 'ASSERTION FAILED T25.a: Expected SQLSTATE 55000 for non-ready web order fulfillment, got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  -- Transition to 'ready' delivery state
  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, delivery_state,
    idempotency_key, request_hash, reason
  ) values (
    v_org_id, v_branch_id, v_web_order_id, 'ready',
    'web-order-ready-' || v_suffix, 'hash4', 'Order ready for dispatch'
  );

  -- Mutate live catalog price to 999.0000 to prove fulfill consumes paid snapshot WITHOUT requoting catalog
  update erp.products set base_sale_price = 999.0000 where id = v_prod_web;

  -- Fulfill succeeds
  v_web_sale_id := erp.fulfill_web_order(v_web_order_id, 'fulfill-ok-' || v_suffix, 'Fulfill ready order');

  if v_web_sale_id is null then
    raise exception 'ASSERTION FAILED T25.b: Web order fulfillment returned null sale_id';
  end if;

  -- Comprobar consumo posterior de reserva
  if exists (
    select 1 from erp.stock_balances
     where organization_id = v_org_id
       and location_id = v_location_id
       and product_id = v_prod_web
       and quantity_reserved <> 0
  ) then
    raise exception 'ASSERTION FAILED T25.res_consumed: stock reservation was not consumed, quantity_reserved <> 0';
  end if;

  -- Verify sale line preserved original v1 snapshot: unit_price 100.0000, tax 21.0000, total 121.0000
  select * into v_line_row from erp.sale_lines where sale_id = v_web_sale_id;
  if v_line_row.pricing_version <> 'v1' or v_line_row.line_total <> 121.0000
     or v_line_row.unit_price <> 100.0000 or v_line_row.tax_amount <> 21.0000
     or v_line_row.unit_gross_price is not null or v_line_row.net_subtotal_amount is not null then
    raise exception 'ASSERTION FAILED T25.c: Web fulfillment line did not preserve paid snapshot: price=% tax=% total=% version=%',
      v_line_row.unit_price, v_line_row.tax_amount, v_line_row.line_total, v_line_row.pricing_version;
  end if;

  -- Verify BOTH outbox events emitted: web_order.fulfilled AND web_order.delivery.dispatched
  if not exists (
    select 1 from erp.integration_outbox
     where aggregate_id = v_web_order_id and event_type = 'web_order.fulfilled'
  ) or not exists (
    select 1 from erp.integration_outbox
     where aggregate_id = v_web_order_id and event_type = 'web_order.delivery.dispatched'
  ) then
    raise exception 'ASSERTION FAILED T25.d: Web fulfillment did not emit both required outbox events';
  end if;

  -- Restore catalog price
  update erp.products set base_sale_price = 100.0000 where id = v_prod_web;

  -- --------------------------------------------------------------------------
  -- TEST 26: Exact 300.0150 Ledger Verification (Slice Engram 1221/1266)
  -- --------------------------------------------------------------------------
  select * into v_entry_row
    from erp.journal_entries
   where source_type = 'sale' and source_id = v_account_sale_id;

  if v_entry_row.id is null then
    raise exception 'ASSERTION FAILED T26.a: Journal entry for 300.0150 sale not found';
  end if;

  if v_entry_row.accounting_contract <> 'pos_gross_v2_exact4' then
    raise exception 'ASSERTION FAILED T26.b: Expected accounting_contract pos_gross_v2_exact4, got %',
      v_entry_row.accounting_contract;
  end if;

  if not exists (
    select 1 from erp.journal_entry_lines
     where journal_entry_id = v_entry_row.id
       and account_id = v_acc_rec_id
       and debit = 300.0150
  ) or not exists (
    select 1 from erp.journal_entry_lines
     where journal_entry_id = v_entry_row.id
       and account_id = v_acc_inc_id
       and credit = 300.0150
  ) then
    raise exception 'ASSERTION FAILED T26.c: Revenue lines did not preserve exact 300.0150 amount';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 27: Exact 0.0001 Revenue Sale (Without COGS)
  -- --------------------------------------------------------------------------
  insert into erp.products (
    id, organization_id, product_type_id, item_kind, unit_id,
    internal_code, internal_name, inventory_tracking, base_sale_price,
    purchase_currency, tax_rate_percent, can_sell, publish_on_web, allow_online_sale, is_active
  ) values (
    v_micro_prod, v_org_id, v_type_id, 'product', v_unit_id,
    'MIC-' || v_suffix, 'Micro Prod ' || v_suffix, 'quantity', 0.0001,
    'ARS', 21.0000, true, false, false, true
  );

  perform erp.post_stock_document(
    'opening', v_branch_id, 'TEST-OPEN-MIC-' || v_suffix,
    'Stock opening zero cost for micro prod',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_micro_prod,
      'to_location_id', v_location_id,
      'quantity', 10,
      'unit_cost', 0
    ))
  );

  v_op_key := 'TEST-MIC-Q1-' || v_suffix;
  v_res := erp.create_sale_with_invoice(
    target_branch_id => v_branch_id,
    target_customer_id => null,
    sale_currency => 'ARS',
    target_exchange_snapshot_id => v_snapshot_id,
    operation_key => v_op_key,
    operation_reason => 'Venta 0.0001 ARS',
    lines => jsonb_build_array(jsonb_build_object(
      'kind', 'product',
      'product_id', v_micro_prod,
      'from_location_id', v_location_id,
      'description', 'Producto 0.0001 ARS',
      'quantity', 1,
      'expected_unit_price', 0.0001,
      'expected_tax_rate', 21.0000
    )),
    target_invoice_kind => 'non_fiscal',
    payment_lines => jsonb_build_array(jsonb_build_object(
      'payment_method_id', v_payment_method_id,
      'amount', 0.0001
    ))
  );

  v_sale_id := (v_res->>'sale_id')::uuid;
  select * into v_entry_row
    from erp.journal_entries
   where source_type = 'sale' and source_id = v_sale_id;

  if v_entry_row.id is null or v_entry_row.total_debit <> 0.0001 or v_entry_row.total_credit <> 0.0001 then
    raise exception 'ASSERTION FAILED T27.a: Expected total 0.0001, got %', v_entry_row.total_debit;
  end if;

  if (select count(*) from erp.journal_entry_lines where journal_entry_id = v_entry_row.id) <> 2 then
    raise exception 'ASSERTION FAILED T27.b: Expected exactly 2 revenue lines for 0.0001 sale without COGS';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 28: Zero Revenue / Positive COGS (0/1 COGS) Verification
  -- --------------------------------------------------------------------------
  select * into v_entry_row
    from erp.journal_entries
   where source_type = 'sale' and source_id = (
     select id from erp.sales where idempotency_key = 'TEST-ZERO-Q1-' || v_suffix
   );

  if v_entry_row.id is null or v_entry_row.total_debit <> 1.0000 or v_entry_row.total_credit <> 1.0000 then
    raise exception 'ASSERTION FAILED T28.a: Expected 0/1 COGS entry with total 1.0000, got %', v_entry_row.total_debit;
  end if;

  if (select count(*) from erp.journal_entry_lines where journal_entry_id = v_entry_row.id) <> 2 then
    raise exception 'ASSERTION FAILED T28.b: Expected exactly 2 COGS lines for 0-revenue sale';
  end if;

  if exists (
    select 1 from erp.journal_entry_lines
     where journal_entry_id = v_entry_row.id
       and debit = 0 and credit = 0
  ) then
    raise exception 'ASSERTION FAILED T28.c: Zero amount line found in journal entry';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 29: Both Zero Outcome & Idempotent Replay (0/0 outcome + replay)
  -- --------------------------------------------------------------------------
  insert into erp.products (
    id, organization_id, product_type_id, item_kind, unit_id,
    internal_code, internal_name, inventory_tracking, base_sale_price,
    purchase_currency, tax_rate_percent, can_sell, publish_on_web, allow_online_sale, is_active
  ) values (
    v_zero_cost_prod, v_org_id, v_type_id, 'product', v_unit_id,
    'ZCP-' || v_suffix, 'Zero Cost Zero Price ' || v_suffix, 'quantity', 0.0000,
    'ARS', 21.0000, true, false, false, true
  );

  perform erp.post_stock_document(
    'opening', v_branch_id, 'TEST-OPEN-ZCP-' || v_suffix,
    'Stock opening zero cost for zero price prod',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_zero_cost_prod,
      'to_location_id', v_location_id,
      'quantity', 10,
      'unit_cost', 0
    ))
  );

  v_op_key := 'TEST-BOTH-ZERO-' || v_suffix;
  v_res := erp.create_sale_with_invoice(
    target_branch_id => v_branch_id,
    target_customer_id => null,
    sale_currency => 'ARS',
    target_exchange_snapshot_id => v_snapshot_id,
    operation_key => v_op_key,
    operation_reason => 'Venta 0 ingreso 0 COGS',
    lines => jsonb_build_array(jsonb_build_object(
      'kind', 'product',
      'product_id', v_zero_cost_prod,
      'from_location_id', v_location_id,
      'description', 'Producto cero costo y precio',
      'quantity', 1,
      'expected_unit_price', 0.0000,
      'expected_tax_rate', 21.0000
    )),
    target_invoice_kind => 'non_fiscal',
    payment_lines => '[]'::jsonb
  );

  v_zero_sale_id := (v_res->>'sale_id')::uuid;

  if exists (
    select 1 from erp.journal_entries
     where source_type = 'sale' and source_id = v_zero_sale_id
  ) then
    raise exception 'ASSERTION FAILED T29.a: Zero/Zero sale created unexpected journal entry';
  end if;

  if exists (
    select 1 from erp.accounting_source_events
     where source_type = 'sale' and source_id = v_zero_sale_id
  ) then
    raise exception 'ASSERTION FAILED T29.b: Zero/Zero sale created unexpected accounting source event';
  end if;

  if not exists (
    select 1 from erp.pos_v2_zero_accounting_outcomes
     where organization_id = v_org_id
       and sale_id = v_zero_sale_id
       and posting_kind = 'primary'
       and reason = 'zero_economic_effect'
       and accounting_contract = 'pos_gross_v2_exact4'
  ) then
    raise exception 'ASSERTION FAILED T29.c: Zero/Zero sale did not record private outcome';
  end if;

  if erp.post_confirmed_sale_accounting_v2_exact4(v_zero_sale_id, v_org_id) is not null then
    raise exception 'ASSERTION FAILED T29.d: Replay of zero outcome did not return null';
  end if;

  if (select count(*) from erp.pos_v2_zero_accounting_outcomes where sale_id = v_zero_sale_id) <> 1 then
    raise exception 'ASSERTION FAILED T29.e: Zero outcome duplicate created on replay';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 30: Fractional COGS 0.0001 Accumulation (3 units = 0.0003 COGS)
  -- --------------------------------------------------------------------------
  insert into erp.products (
    id, organization_id, product_type_id, item_kind, unit_id,
    internal_code, internal_name, inventory_tracking, base_sale_price,
    purchase_currency, tax_rate_percent, can_sell, publish_on_web, allow_online_sale, is_active
  ) values (
    v_micro_cost_prod, v_org_id, v_type_id, 'product', v_unit_id,
    'MCC-' || v_suffix, 'Micro Cost Prod ' || v_suffix, 'quantity', 1.0000,
    'ARS', 21.0000, true, false, false, true
  );

  perform erp.post_stock_document(
    'opening', v_branch_id, 'TEST-OPEN-MCC-' || v_suffix,
    'Stock opening 0.0001 cost',
    jsonb_build_array(jsonb_build_object(
      'product_id', v_micro_cost_prod,
      'to_location_id', v_location_id,
      'quantity', 10,
      'unit_cost', 0.0001
    ))
  );

  v_op_key := 'TEST-MCC-Q3-' || v_suffix;
  v_res := erp.create_sale_with_invoice(
    target_branch_id => v_branch_id,
    target_customer_id => null,
    sale_currency => 'ARS',
    target_exchange_snapshot_id => v_snapshot_id,
    operation_key => v_op_key,
    operation_reason => 'Venta micro costo q3',
    lines => jsonb_build_array(jsonb_build_object(
      'kind', 'product',
      'product_id', v_micro_cost_prod,
      'from_location_id', v_location_id,
      'description', 'Micro costo q3',
      'quantity', 3,
      'expected_unit_price', 1.0000,
      'expected_tax_rate', 21.0000
    )),
    target_invoice_kind => 'non_fiscal',
    payment_lines => jsonb_build_array(jsonb_build_object(
      'payment_method_id', v_payment_method_id,
      'amount', 3.0000
    ))
  );

  v_sale_id := (v_res->>'sale_id')::uuid;
  select * into v_entry_row
    from erp.journal_entries
   where source_type = 'sale' and source_id = v_sale_id;

  if v_entry_row.total_debit <> 3.0003 or v_entry_row.total_credit <> 3.0003 then
    raise exception 'ASSERTION FAILED T30: Expected total 3.0003, got %', v_entry_row.total_debit;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 31: Exact Reversals (Public & Internal) & Replay
  -- --------------------------------------------------------------------------
  -- Part A: Public reversal of exact4 entry (v_account_sale_id entry)
  select * into v_entry_row
    from erp.journal_entries
   where source_type = 'sale' and source_id = v_account_sale_id;

  v_reversal_id := erp.reverse_journal_entry(
    v_entry_row.id,
    'REV-EXACT4-' || v_suffix,
    'Reversa exacta de prueba'
  );

  if v_reversal_id is null then
    raise exception 'ASSERTION FAILED T31.a: Reversal returned null';
  end if;

  select * into v_rev_entry_row from erp.journal_entries where id = v_reversal_id;
  if v_rev_entry_row.accounting_contract <> 'pos_gross_v2_exact4'
     or v_rev_entry_row.total_debit <> v_entry_row.total_credit
     or v_rev_entry_row.total_credit <> v_entry_row.total_debit then
    raise exception 'ASSERTION FAILED T31.b: Reversal entry did not preserve exact amounts and contract: % vs %',
      v_rev_entry_row.total_debit, v_entry_row.total_credit;
  end if;

  v_reversal_replayed_id := erp.reverse_journal_entry(
    v_entry_row.id,
    'REV-EXACT4-' || v_suffix,
    'Reversa repetida'
  );
  if v_reversal_replayed_id <> v_reversal_id then
    raise exception 'ASSERTION FAILED T31.c: Public reversal replay returned different ID: % vs %',
      v_reversal_replayed_id, v_reversal_id;
  end if;

  v_public_original_id := v_entry_row.id;
  v_public_reversal_id := v_reversal_id;

  -- Part B: Internal reversal of exact4 entry
  select * into v_entry_row
    from erp.journal_entries
   where source_type = 'sale' and source_id = v_sale_id;

  v_reversal_id := erp.reverse_internal_journal_entry(
    v_org_id,
    v_entry_row.id,
    'sale',
    v_sale_id,
    'REV-INT-EXACT4-' || v_suffix,
    'Reversa interna exacta'
  );

  select * into v_rev_entry_row from erp.journal_entries where id = v_reversal_id;
  if v_rev_entry_row.accounting_contract <> 'pos_gross_v2_exact4'
     or v_rev_entry_row.total_debit <> 3.0003 then
    raise exception 'ASSERTION FAILED T31.d: Internal reversal did not preserve exact4 total 3.0003';
  end if;

  v_reversal_replayed_id := erp.reverse_internal_journal_entry(
    v_org_id,
    v_entry_row.id,
    'sale',
    v_sale_id,
    'REV-INT-EXACT4-' || v_suffix,
    'Reversa interna replay'
  );
  if v_reversal_replayed_id <> v_reversal_id then
    raise exception 'ASSERTION FAILED T31.e: Internal reversal replay returned different ID';
  end if;

  v_internal_original_id := v_entry_row.id;
  v_internal_reversal_id := v_reversal_id;

  -- --------------------------------------------------------------------------
  -- TEST 32: Trial Balance Mixed v1/v2 & Reversals Cancellation in Closed Period
  -- --------------------------------------------------------------------------
  select id into v_closed_period_id
    from erp.accounting_periods
   where organization_id = v_org_id
     and current_date between period_start and period_end;

  perform erp.close_accounting_period(v_closed_period_id, 'Cierre de prueba para trial balance');

  -- Replay must precede mutable period checks for both exact4 APIs.
  if erp.reverse_journal_entry(v_public_original_id, current_date,
       'REV-EXACT4-' || v_suffix, 'Replay publico cerrado') is distinct from v_public_reversal_id
     or erp.reverse_internal_journal_entry(v_org_id, v_internal_original_id, 'sale', v_sale_id,
       'REV-INT-EXACT4-' || v_suffix, 'Replay interno cerrado') is distinct from v_internal_reversal_id then
    raise exception 'ASSERTION FAILED T32.replay_closed: exact4 replay failed in a closed period';
  end if;


  for r_pair in select false as internal_api union all select true
  loop
    v_sqlstate := null;
    v_sqlerrm := null;
    begin
      if r_pair.internal_api then
        perform erp.reverse_internal_journal_entry(v_org_id, v_internal_reversal_id,
          'journal_reversal', v_internal_reversal_id,
          'REV-INT-CLOSED-NEW-' || v_suffix, 'Nueva reversa periodo cerrado');
      else
        perform erp.reverse_journal_entry(v_public_reversal_id, current_date,
          'REV-PUB-CLOSED-NEW-' || v_suffix, 'Nueva reversa periodo cerrado');
      end if;
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
    end;
    if v_sqlstate is distinct from '55000' or v_sqlerrm is distinct from 'accounting period is closed' then
      raise exception 'ASSERTION FAILED T32.reversal_closed: expected 55000 accounting period is closed, got % (%)', v_sqlstate, v_sqlerrm;
    end if;
  end loop;

  select * into v_tb_row
    from erp.v_trial_balance
   where organization_id = v_org_id
     and period_id = v_closed_period_id
     and account_id = v_acc_rec_id;

  if v_tb_row.account_id is null then
    raise exception 'ASSERTION FAILED T32.a: Trial balance row for receivable not found';
  end if;

  if v_tb_row.balance <> (v_tb_row.total_debit - v_tb_row.total_credit) then
    raise exception 'ASSERTION FAILED T32.b: Trial balance formula mismatch: balance=% debit=% credit=%',
      v_tb_row.balance, v_tb_row.total_debit, v_tb_row.total_credit;
  end if;

  -- Independent fact numeric expectation computed directly from underlying posted entries
  select
    coalesce(sum(case when entry.accounting_contract = 'pos_gross_v2_exact4' then (line.debit * line.exchange_rate) else round(line.debit * line.exchange_rate, 2) end), 0),
    coalesce(sum(case when entry.accounting_contract = 'pos_gross_v2_exact4' then (line.credit * line.exchange_rate) else round(line.credit * line.exchange_rate, 2) end), 0)
  into v_expected_debit, v_expected_credit
  from erp.journal_entry_lines line
  join erp.journal_entries entry on entry.id = line.journal_entry_id and entry.organization_id = line.organization_id
  where entry.organization_id = v_org_id
    and entry.period_id = v_closed_period_id
    and line.account_id = v_acc_rec_id
    and entry.status in ('posted', 'reversed');

  v_expected_balance := v_expected_debit - v_expected_credit;

  if v_tb_row.total_debit <> v_expected_debit or v_tb_row.total_credit <> v_expected_credit or v_tb_row.balance <> v_expected_balance then
    raise exception 'ASSERTION FAILED T32.fact: Trial balance mismatch with independent fact expectation: tb=(debit=% credit=% bal=%) expected=(debit=% credit=% bal=%)',
      v_tb_row.total_debit, v_tb_row.total_credit, v_tb_row.balance,
      v_expected_debit, v_expected_credit, v_expected_balance;
  end if;

  if exists (
    select 1
    from erp.v_trial_balance
    where organization_id = v_org_id
      and period_id = v_closed_period_id
      and total_debit <> round(total_debit, 4)
  ) then
    raise exception 'ASSERTION FAILED T32.c: Trial balance total_debit has non-exact4 scale';
  end if;

  if (
    select sum(total_debit) - sum(total_credit)
    from erp.v_trial_balance
    where organization_id = v_org_id and period_id = v_closed_period_id
  ) <> 0 then
    raise exception 'ASSERTION FAILED T32.d: Overall trial balance sum(debit) <> sum(credit)';
  end if;

  -- Verify real export_report_rows endpoint preserves exact4 for trial_balance
  v_res := erp.export_report_rows(
    report_code => 'trial_balance',
    operation_reason => 'Auditoria trial balance exact4',
    filters => '{}'::jsonb,
    date_from => null,
    date_to => null,
    target_branch_id => null,
    row_limit => 5000
  );

  if (v_res->>'report_code') <> 'trial_balance'
     or jsonb_array_length(v_res->'rows') = 0
     or (v_res->>'truncated')::boolean is not false then
    raise exception 'ASSERTION FAILED T32.e: export_report_rows failed: %', v_res;
  end if;

  -- Compare export against BOTH independent fact expectation AND v_trial_balance
  if not exists (
    select 1
    from jsonb_array_elements(v_res->'rows') as elem
    where (elem->>'account_id')::uuid = v_acc_rec_id
      and (elem->>'total_debit')::numeric = v_expected_debit
      and (elem->>'total_credit')::numeric = v_expected_credit
      and (elem->>'balance')::numeric = v_expected_balance
      and (elem->>'total_debit')::numeric = v_tb_row.total_debit
      and (elem->>'total_credit')::numeric = v_tb_row.total_credit
      and (elem->>'balance')::numeric = v_tb_row.balance
  ) then
    raise exception 'ASSERTION FAILED T32.f: export_report_rows row mismatch with independent fact expectation and v_trial_balance';
  end if;

  update erp.accounting_periods
     set status = 'open', closed_at = null, closed_by = null, close_reason = null
   where id = v_closed_period_id;

  -- --------------------------------------------------------------------------
  -- TEST 33: Legacy post_journal_entry with > 2 Decimals JSON
  -- --------------------------------------------------------------------------
  -- Part A: Valid when raw >2 decimals round to identical 2-decimal amounts
  v_legacy_entry_id := erp.post_journal_entry(
    v_branch_id,
    current_date,
    'manual',
    gen_random_uuid(),
    'TEST-LEGACY-DEC-' || v_suffix,
    'Asiento legado con decimales',
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_acc_rec_id,
        'debit', 100.555,
        'credit', 0
      ),
      jsonb_build_object(
        'account_id', v_acc_inc_id,
        'debit', 0,
        'credit', 100.56
      )
    )
  );

  select * into v_entry_row from erp.journal_entries where id = v_legacy_entry_id;
  if v_entry_row.accounting_contract <> 'legacy_v1' or v_entry_row.total_debit <> 100.56 then
    raise exception 'ASSERTION FAILED T33.a: Legacy entry did not cast to numeric(18,2) and legacy_v1: contract=% total=%',
      v_entry_row.accounting_contract, v_entry_row.total_debit;
  end if;

  -- Part B: Rejection when raw >2 decimals do NOT round to matching values
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.post_journal_entry(
      v_branch_id,
      current_date,
      'manual',
      gen_random_uuid(),
      'TEST-LEGACY-UNBAL-' || v_suffix,
      'Asiento legado desbalanceado',
      jsonb_build_array(
        jsonb_build_object(
          'account_id', v_acc_rec_id,
          'debit', 100.551,
          'credit', 0
        ),
        jsonb_build_object(
          'account_id', v_acc_inc_id,
          'debit', 0,
          'credit', 100.560
        )
      )
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;

  if v_sqlstate is distinct from '23514' or v_sqlerrm is distinct from 'journal entry must balance Debe=Haber' then
    raise exception 'ASSERTION FAILED T33.b: Expected check_violation 23514 for unbalancing legacy lines, got % (%)',
      v_sqlstate, v_sqlerrm;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 34: Maximum Legacy Number Conserved (16 integer digits)
  -- --------------------------------------------------------------------------
  v_legacy_entry_id := erp.post_journal_entry(
    v_branch_id,
    current_date,
    'manual',
    gen_random_uuid(),
    'TEST-LEGACY-MAX-' || v_suffix,
    'Asiento legado maximo',
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_acc_rec_id,
        'debit', 9999999999999999.99,
        'credit', 0
      ),
      jsonb_build_object(
        'account_id', v_acc_inc_id,
        'debit', 0,
        'credit', 9999999999999999.99
      )
    )
  );

  select * into v_entry_row from erp.journal_entries where id = v_legacy_entry_id;
  if v_entry_row.total_debit <> 9999999999999999.99 then
    raise exception 'ASSERTION FAILED T34: Maximum legacy number failed: %', v_entry_row.total_debit;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 35: Reject Forging Contract via RPC, JSON, or DML
  -- --------------------------------------------------------------------------
  -- Part A: Forged entry via direct DML with manual source
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    insert into erp.journal_entries (
      organization_id, branch_id, period_id, entry_date, status, description,
      source_type, source_id, idempotency_key, total_debit, total_credit,
      posted_at, posted_by, created_by, accounting_contract
    ) values (
      v_org_id, v_branch_id, v_entry_row.period_id, current_date, 'posted',
      'Forged entry', 'manual', gen_random_uuid(), 'FORGE-MANUAL-' || v_suffix,
      100.0000, 100.0000, now(), auth.uid(), auth.uid(), 'pos_gross_v2_exact4'
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;

  if v_sqlstate is distinct from '23000' or v_sqlerrm not like '%pos_gross_v2_exact4 contract is not permitted for source type manual%' then
    raise exception 'ASSERTION FAILED T35.a: Expected 23000 for manual exact4 insert, got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  if exists (select 1 from erp.journal_entries where idempotency_key = 'FORGE-MANUAL-' || v_suffix) then
    raise exception 'ASSERTION FAILED T35.a-residue: residual row found for forged manual entry';
  end if;

  -- Part B: Forged entry via direct DML with REAL v2 sale source but forged idempotency key
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    insert into erp.journal_entries (
      organization_id, branch_id, period_id, entry_date, status, description,
      source_type, source_id, idempotency_key, total_debit, total_credit,
      posted_at, posted_by, created_by, accounting_contract
    ) values (
      v_org_id, v_branch_id, v_entry_row.period_id, current_date, 'posted',
      'Forged real source entry', 'sale', v_account_sale_id, 'FORGE-REAL-' || v_suffix,
      300.0150, 300.0150, now(), auth.uid(), auth.uid(), 'pos_gross_v2_exact4'
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;

  if v_sqlstate is distinct from '23000' or v_sqlerrm not like '%authoritative idempotency key%' then
    raise exception 'ASSERTION FAILED T35.b: Expected 23000 for forged sale idempotency key, got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  if exists (select 1 from erp.journal_entries where idempotency_key = 'FORGE-REAL-' || v_suffix) then
    raise exception 'ASSERTION FAILED T35.b-residue: residual row found for forged real sale entry';
  end if;

  -- Part C: Mutating accounting_contract is prohibited
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    update erp.journal_entries
       set accounting_contract = 'pos_gross_v2_exact4'
     where id = v_legacy_entry_id;
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;

  if v_sqlstate is distinct from '23000' or v_sqlerrm not like '%immutable%' then
    raise exception 'ASSERTION FAILED T35.c: Expected 23000 for immutable contract, got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  -- Part D: Zero outcome coexistence with existing source event rejected
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    insert into erp.pos_v2_zero_accounting_outcomes (
      organization_id, sale_id, posting_kind, accounting_contract, reason, created_by
    ) values (
      v_org_id, v_account_sale_id, 'primary', 'pos_gross_v2_exact4', 'zero_economic_effect', auth.uid()
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;

  if v_sqlstate is distinct from '23000' or v_sqlerrm not like '%source event%' then
    raise exception 'ASSERTION FAILED T35.d: Expected 23000 for zero outcome coexistence, got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  -- Part E: Client RPC post_journal_entry rejects real v2 sale source with SQLSTATE 23514
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.post_journal_entry(
      v_branch_id,
      current_date,
      'sale',
      v_account_sale_id,
      'FORGE-RPC-V2-' || v_suffix,
      'Intento forja por wrapper legacy',
      jsonb_build_array(
        jsonb_build_object('account_id', v_acc_rec_id, 'debit', 10.00, 'credit', 0),
        jsonb_build_object('account_id', v_acc_inc_id, 'debit', 0, 'credit', 10.00)
      )
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;

  if v_sqlstate is distinct from '23514' or v_sqlerrm not like '%pos v2 sales cannot be posted via legacy journal entry%' then
    raise exception 'ASSERTION FAILED T35.e: Expected 23514 for legacy wrapper v2 sale, got: % (%)', v_sqlstate, v_sqlerrm;
  end if;

  if exists (select 1 from erp.journal_entries where idempotency_key = 'FORGE-RPC-V2-' || v_suffix) then
    raise exception 'ASSERTION FAILED T35.e-residue: residual row found for legacy wrapper v2 attempt';
  end if;

  -- Replay legacy with same key & same source with new key returns original UUID
  v_replay_entry_id := erp.post_journal_entry(
    v_branch_id,
    current_date,
    'manual',
    v_replay_source_id,
    'TEST-LEGACY-REP-KEY1-' || v_suffix,
    'Legacy replay test entry',
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_rec_id, 'debit', 25.00, 'credit', 0),
      jsonb_build_object('account_id', v_acc_inc_id, 'debit', 0, 'credit', 25.00)
    )
  );

  if v_replay_entry_id is null then
    raise exception 'ASSERTION FAILED T35.e-leg: initial legacy post returned null';
  end if;

  -- 1) Replay with same key
  v_replay_again_id := erp.post_journal_entry(
    v_branch_id,
    current_date,
    'manual',
    v_replay_source_id,
    'TEST-LEGACY-REP-KEY1-' || v_suffix,
    'Legacy replay same key',
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_rec_id, 'debit', 25.00, 'credit', 0),
      jsonb_build_object('account_id', v_acc_inc_id, 'debit', 0, 'credit', 25.00)
    )
  );
  if v_replay_again_id is distinct from v_replay_entry_id then
    raise exception 'ASSERTION FAILED T35.e-replay-same-key: expected %, got %', v_replay_entry_id, v_replay_again_id;
  end if;

  -- 2) Replay with same source and NEW key -> returns original UUID
  v_replay_newkey_id := erp.post_journal_entry(
    v_branch_id,
    current_date,
    'manual',
    v_replay_source_id,
    'TEST-LEGACY-REP-KEY2-' || v_suffix,
    'Legacy replay same source new key',
    jsonb_build_array(
      jsonb_build_object('account_id', v_acc_rec_id, 'debit', 25.00, 'credit', 0),
      jsonb_build_object('account_id', v_acc_inc_id, 'debit', 0, 'credit', 25.00)
    )
  );
  if v_replay_newkey_id is distinct from v_replay_entry_id then
    raise exception 'ASSERTION FAILED T35.e-replay-new-key: expected %, got %', v_replay_entry_id, v_replay_newkey_id;
  end if;

  -- Part F: Effective role privileges verification
  -- pos_v2_zero_accounting_outcomes: revoked from anon, authenticated, service_role
  if has_table_privilege('anon', 'erp.pos_v2_zero_accounting_outcomes', 'insert')
     or has_table_privilege('authenticated', 'erp.pos_v2_zero_accounting_outcomes', 'insert')
     or has_table_privilege('service_role', 'erp.pos_v2_zero_accounting_outcomes', 'insert') then
    raise exception 'ASSERTION FAILED T35.f: pos_v2_zero_accounting_outcomes must revoke insert from anon/authenticated/service_role';
  end if;

  -- Verify INSERT/UPDATE/DELETE/TRUNCATE are revoked from anon, authenticated, service_role on 3 tables
  for r_role in select unnest(array['anon', 'authenticated', 'service_role']) as role_name loop
    for r_table in select unnest(array['erp.journal_entries', 'erp.journal_entry_lines', 'erp.accounting_source_events']) as tbl_name loop
      for r_priv in select unnest(array['insert', 'update', 'delete', 'truncate']) as priv_name loop
        if has_table_privilege(r_role.role_name, r_table.tbl_name, r_priv.priv_name) then
          raise exception 'ASSERTION FAILED T35.priv: % has % on %', r_role.role_name, r_priv.priv_name, r_table.tbl_name;
        end if;
      end loop;
    end loop;
  end loop;

  -- Verify SELECT remains granted to authenticated and service_role on 3 tables
  for r_table in select unnest(array['erp.journal_entries', 'erp.journal_entry_lines', 'erp.accounting_source_events']) as tbl_name loop
    if not has_table_privilege('authenticated', r_table.tbl_name, 'select') then
      raise exception 'ASSERTION FAILED T35.sel_auth: select on % revoked from authenticated', r_table.tbl_name;
    end if;
    if not has_table_privilege('service_role', r_table.tbl_name, 'select') then
      raise exception 'ASSERTION FAILED T35.sel_srv: select on % revoked from service_role', r_table.tbl_name;
    end if;
  end loop;

  -- Verify function execute privileges
  if has_function_privilege('anon', 'erp.post_journal_entry(uuid,date,text,uuid,text,text,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'erp.post_journal_entry(uuid,date,text,uuid,text,text,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'erp.post_journal_entry(uuid,date,text,uuid,text,text,jsonb)', 'execute') then
    raise exception 'ASSERTION FAILED T35.i: post_journal_entry privilege mismatch';
  end if;

  if has_function_privilege('anon', 'erp.reverse_journal_entry(uuid,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'erp.reverse_journal_entry(uuid,text,text)', 'execute')
     or not has_function_privilege('service_role', 'erp.reverse_journal_entry(uuid,text,text)', 'execute') then
    raise exception 'ASSERTION FAILED T35.rev_priv: reverse_journal_entry privilege mismatch';
  end if;

  if has_function_privilege('anon', 'erp.export_report_rows(text,text,jsonb,date,date,uuid,integer)', 'execute')
     or not has_function_privilege('authenticated', 'erp.export_report_rows(text,text,jsonb,date,date,uuid,integer)', 'execute') then
    raise exception 'ASSERTION FAILED T35.exp_priv: export_report_rows privilege mismatch';
  end if;

  if has_function_privilege('authenticated', 'erp.post_internal_journal_entry(uuid,uuid,date,text,uuid,text,text,text,jsonb)', 'execute')
     or has_function_privilege('service_role', 'erp.post_internal_journal_entry(uuid,uuid,date,text,uuid,text,text,text,jsonb)', 'execute') then
    raise exception 'ASSERTION FAILED T35.j: post_internal_journal_entry must not be executable by authenticated/service_role';
  end if;

  if has_function_privilege('authenticated', 'erp.post_confirmed_sale_accounting_v2_exact4(uuid,uuid)', 'execute')
     or has_function_privilege('service_role', 'erp.post_confirmed_sale_accounting_v2_exact4(uuid,uuid)', 'execute') then
    raise exception 'ASSERTION FAILED T35.k: post_confirmed_sale_accounting_v2_exact4 must not be executable by authenticated/service_role';
  end if;

  -- Part G: Direct DML denied with SQLSTATE 42501 for anon, authenticated, service_role across 3 tables + TRUNCATE
  for r_role in select unnest(array['anon', 'authenticated', 'service_role']) as role_name loop
    for r_table in select unnest(array['erp.journal_entries', 'erp.journal_entry_lines', 'erp.accounting_source_events']) as tbl_name loop
      -- 1. INSERT denied 42501
      execute 'set local role ' || quote_ident(r_role.role_name);
      v_sqlstate := null;
      begin
        execute format('insert into %s default values', r_table.tbl_name);
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
      end;
      execute 'reset role';
      if v_sqlstate is distinct from '42501' then
        raise exception 'ASSERTION FAILED T35.dml_ins: Expected 42501 for insert on % as %, got %', r_table.tbl_name, r_role.role_name, v_sqlstate;
      end if;

      -- 2. UPDATE denied 42501
      execute 'set local role ' || quote_ident(r_role.role_name);
      v_sqlstate := null;
      begin
        execute format('update %s set organization_id = organization_id', r_table.tbl_name);
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
      end;
      execute 'reset role';
      if v_sqlstate is distinct from '42501' then
        raise exception 'ASSERTION FAILED T35.dml_upd: Expected 42501 for update on % as %, got %', r_table.tbl_name, r_role.role_name, v_sqlstate;
      end if;

      -- 3. DELETE denied 42501
      execute 'set local role ' || quote_ident(r_role.role_name);
      v_sqlstate := null;
      begin
        execute format('delete from %s where false', r_table.tbl_name);
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
      end;
      execute 'reset role';
      if v_sqlstate is distinct from '42501' then
        raise exception 'ASSERTION FAILED T35.dml_del: Expected 42501 for delete on % as %, got %', r_table.tbl_name, r_role.role_name, v_sqlstate;
      end if;

      -- 4. TRUNCATE denied 42501
      execute 'set local role ' || quote_ident(r_role.role_name);
      v_sqlstate := null;
      begin
        execute format('truncate table %s', r_table.tbl_name);
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
      end;
      execute 'reset role';
      if v_sqlstate is distinct from '42501' then
        raise exception 'ASSERTION FAILED T35.dml_trunc: Expected 42501 for truncate on % as %, got %', r_table.tbl_name, r_role.role_name, v_sqlstate;
      end if;
    end loop;
  end loop;

  -- --------------------------------------------------------------------------
  -- TEST 36: Tenant Isolation & Closed Period Rejection
  -- --------------------------------------------------------------------------
  select id into v_closed_period_id
    from erp.accounting_periods
   where organization_id = v_org_id
     and current_date between period_start and period_end;

  perform erp.close_accounting_period(v_closed_period_id, 'Cierre para test de rechazo');

  -- Part A: New positive POS sale in closed period is rejected with 55000
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.create_sale_with_invoice(
      target_branch_id => v_branch_id,
      target_customer_id => null,
      sale_currency => 'ARS',
      target_exchange_snapshot_id => v_snapshot_id,
      operation_key => 'TEST-CLOSED-POS-' || v_suffix,
      operation_reason => 'Venta positiva en periodo cerrado',
      lines => jsonb_build_array(jsonb_build_object(
        'kind', 'product',
        'product_id', v_prod_simple_one,
        'from_location_id', v_location_id,
        'description', 'Prod periodo cerrado pos',
        'quantity', 1,
        'expected_unit_price', 1.0000,
        'expected_tax_rate', 21.0000
      )),
      target_invoice_kind => 'non_fiscal',
      payment_lines => jsonb_build_array(jsonb_build_object(
        'payment_method_id', v_payment_method_id,
        'amount', 1.0000
      ))
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;

  if v_sqlstate is distinct from '55000' or v_sqlerrm is distinct from 'accounting period is closed' then
    raise exception 'ASSERTION FAILED T36.a: Expected 55000 accounting period is closed for positive sale, got % (%)',
      v_sqlstate, v_sqlerrm;
  end if;

  -- Part B: New 0/0 (zero economic effect) POS sale in closed period is also rejected with 55000
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.create_sale_with_invoice(
      target_branch_id => v_branch_id,
      target_customer_id => null,
      sale_currency => 'ARS',
      target_exchange_snapshot_id => v_snapshot_id,
      operation_key => 'TEST-CLOSED-ZERO-' || v_suffix,
      operation_reason => 'Venta 0/0 en periodo cerrado',
      lines => jsonb_build_array(jsonb_build_object(
        'kind', 'product',
        'product_id', v_zero_cost_prod,
        'from_location_id', v_location_id,
        'description', 'Prod cero cerrado',
        'quantity', 1,
        'expected_unit_price', 0.0000,
        'expected_tax_rate', 21.0000
      )),
      target_invoice_kind => 'non_fiscal',
      payment_lines => '[]'::jsonb
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;

  if v_sqlstate is distinct from '55000' or v_sqlerrm is distinct from 'accounting period is closed' then
    raise exception 'ASSERTION FAILED T36.b: Expected 55000 accounting period is closed for 0/0 sale, got % (%)',
      v_sqlstate, v_sqlerrm;
  end if;

  -- Reopen period
  update erp.accounting_periods
     set status = 'open', closed_at = null, closed_by = null, close_reason = null
   where id = v_closed_period_id;

  -- Part C: Cross-tenant exact4 helper execution is rejected
  v_sqlstate := null;
  v_sqlerrm := null;
  begin
    perform erp.post_confirmed_sale_accounting_v2_exact4(v_account_sale_id, v_foreign_org_id);
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_sqlerrm = message_text;
  end;

  if v_sqlstate is distinct from '42501' or v_sqlerrm not like '%cross-tenant%' then
    raise exception 'ASSERTION FAILED T36.c: Expected 42501 cross-tenant execution not permitted, got: % (%)',
      v_sqlstate, v_sqlerrm;
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 37: Exact4 provenance, crossed keys, and reversal-of-reversal chains
  -- --------------------------------------------------------------------------
  for r_pair in
    select v_public_original_id as original_id, v_public_reversal_id as reversal_id, false as internal_api
    union all
    select v_internal_original_id, v_internal_reversal_id, true
  loop
    select * into v_entry_row from erp.journal_entries where id = r_pair.original_id;
    select * into v_rev_entry_row from erp.journal_entries where id = r_pair.reversal_id;
    if v_entry_row.status <> 'reversed'
       or v_entry_row.reversal_of_entry_id is distinct from v_rev_entry_row.id
       or v_rev_entry_row.v2_original_entry_id is distinct from v_entry_row.id
       or v_rev_entry_row.reversal_of_entry_id is not null then
      raise exception 'ASSERTION FAILED T37.direction: incorrect forward/backward provenance for internal=%', r_pair.internal_api;
    end if;

    v_sqlstate := null;
    begin
      if r_pair.internal_api then
        perform erp.reverse_internal_journal_entry(v_org_id, r_pair.original_id, 'sale', v_sale_id,
          'REV-INT-NEW-KEY-' || v_suffix, 'No alias con clave distinta');
      else
        perform erp.reverse_journal_entry(r_pair.original_id, current_date,
          'REV-PUB-NEW-KEY-' || v_suffix, 'No alias con clave distinta');
      end if;
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '55000' then
      raise exception 'ASSERTION FAILED T37.newkey: expected 55000 for reversed original, got %', v_sqlstate;
    end if;

    -- A different exact4 target cannot reuse another original's reversal key.
    v_sqlstate := null;
    begin
      if r_pair.internal_api then
        perform erp.reverse_internal_journal_entry(v_org_id, v_public_original_id, 'sale', v_sale_id,
          'REV-INT-EXACT4-' || v_suffix, 'Cruce de original interno');
      else
        perform erp.reverse_journal_entry(v_internal_original_id, current_date,
          'REV-EXACT4-' || v_suffix, 'Cruce de original publico');
      end if;
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '23505' then
      raise exception 'ASSERTION FAILED T37.crosskey: expected 23505, got %', v_sqlstate;
    end if;

    -- A false target plus an exact4 key must never fall through legacy key-first replay.
    v_sqlstate := null;
    begin
      if r_pair.internal_api then
        perform erp.reverse_internal_journal_entry(v_org_id, gen_random_uuid(), 'sale', v_sale_id,
          'REV-INT-EXACT4-' || v_suffix, 'Target inexistente interno');
      else
        perform erp.reverse_journal_entry(gen_random_uuid(), current_date,
          'REV-EXACT4-' || v_suffix, 'Target inexistente publico');
      end if;
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '55000' then
      raise exception 'ASSERTION FAILED T37.key_dispatch: expected 55000, got %', v_sqlstate;
    end if;

    -- Both APIs reject a foreign target, even with a same-tenant exact4 replay key.
    v_sqlstate := null;
    begin
      if r_pair.internal_api then
        perform erp.reverse_internal_journal_entry(v_foreign_org_id, r_pair.original_id, 'sale', v_sale_id,
          'REV-INT-EXACT4-' || v_suffix, 'Cruce de tenant interno');
      else
        perform erp.reverse_journal_entry(v_foreign_entry_id, current_date,
          'REV-EXACT4-' || v_suffix, 'Cruce de tenant publico');
      end if;
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if (r_pair.internal_api and v_sqlstate is distinct from '55000')
       or (not r_pair.internal_api and v_sqlstate is distinct from '55000') then
      raise exception 'ASSERTION FAILED T37.tenant: expected tenant rejection 55000, got %', v_sqlstate;
    end if;

    -- The backward link is immutable independently of the posted-entry guard.
    v_sqlstate := null;
    begin
      update erp.journal_entries set v2_original_entry_id = null where id = r_pair.reversal_id;
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '23000' then
      raise exception 'ASSERTION FAILED T37.immutable: expected 23000, got %', v_sqlstate;
    end if;
  end loop;

  -- No mutable profiles, auth users or role grants: use a missing actor for denial.
  perform set_config('request.jwt.claim.sub', '', true);
  v_sqlstate := null;
  begin
    perform erp.reverse_internal_journal_entry(v_org_id, v_internal_original_id, 'sale', v_sale_id,
      'REV-INT-EXACT4-' || v_suffix, 'Sin actor interno');
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'ASSERTION FAILED T37.internal_actor: expected 42501, got %', v_sqlstate;
  end if;
  v_sqlstate := null;
  begin
    perform erp.reverse_journal_entry(v_public_original_id,
      'REV-EXACT4-' || v_suffix, 'Sin actor publico');
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
  end;
  if v_sqlstate is distinct from '55000' then
    raise exception 'ASSERTION FAILED T37.public_actor: expected baseline no-context 55000, got %', v_sqlstate;
  end if;
  perform set_config('request.jwt.claim.sub', v_admin_uid::text, true);

  -- Exercise only existing profiles; never create or modify identities/role grants.
  v_denied_actor := null;
  for r_cand in select id from erp.profiles
    where organization_id = v_org_id and is_active and id <> v_admin_uid
  loop
    perform set_config('request.jwt.claim.sub', r_cand.id::text, true);
    if erp.current_organization_id() = v_org_id
       and not erp.has_permission('accounting.post', v_branch_id) then
      v_denied_actor := r_cand.id;
      exit;
    end if;
  end loop;
  if v_denied_actor is not null then
    v_sqlstate := null;
    begin
      perform erp.reverse_journal_entry(v_public_original_id,
        'REV-EXACT4-' || v_suffix, 'Replay sin permiso contable');
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    if v_sqlstate is distinct from '42501' then
      raise exception 'ASSERTION FAILED T37.permission: expected 42501 before replay, got %', v_sqlstate;
    end if;
  else
    raise notice 'T37.permission not exercised: no existing active same-tenant profile lacks accounting.post';
  end if;
  perform set_config('request.jwt.claim.sub', v_admin_uid::text, true);

  v_sqlstate := null;
  begin
    perform erp.reverse_internal_journal_entry(v_org_id, v_internal_original_id,
      'journal_reversal', v_internal_original_id,
      'REV-INT-EXACT4-' || v_suffix, 'Misma clave otra fuente');
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
  end;
  if v_sqlstate is distinct from '23505' then
    raise exception 'ASSERTION FAILED T37.replay_source: expected 23505, got %', v_sqlstate;
  end if;

  -- A->B->C: the new reversal's forward pointer starts NULL; provenance points to B.
  v_public_chain_id := erp.reverse_journal_entry(v_public_reversal_id, current_date,
    'REV-PUB-CHAIN-' || v_suffix, 'Reversa de reversa publica');

  -- Reusing a business source already owned by A->B is a conflict, not replay.
  v_sqlstate := null;
  begin
    perform erp.reverse_internal_journal_entry(v_org_id, v_internal_reversal_id, 'sale', v_sale_id,
      'REV-INT-SOURCE-CONFLICT-' || v_suffix, 'Fuente ocupada');
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
  end;
  if v_sqlstate is distinct from '23505' then
    raise exception 'ASSERTION FAILED T37.source_conflict: expected 23505, got %', v_sqlstate;
  end if;
  v_internal_chain_id := erp.reverse_internal_journal_entry(v_org_id, v_internal_reversal_id,
    'journal_reversal', v_internal_reversal_id,
    'REV-INT-CHAIN-' || v_suffix, 'Reversa de reversa interna');

  -- Check exact inversion, currency/rate and line identity independently for all four pairs.
  for r_pair in
    select v_public_original_id as original_id, v_public_reversal_id as reversal_id
    union all select v_internal_original_id, v_internal_reversal_id
    union all select v_public_reversal_id, v_public_chain_id
    union all select v_internal_reversal_id, v_internal_chain_id
  loop
    select * into v_entry_row from erp.journal_entries where id = r_pair.original_id;
    select * into v_rev_entry_row from erp.journal_entries where id = r_pair.reversal_id;
    if v_entry_row.reversal_of_entry_id is distinct from r_pair.reversal_id
       or v_rev_entry_row.v2_original_entry_id is distinct from r_pair.original_id
       or v_rev_entry_row.total_debit is distinct from v_entry_row.total_credit
       or v_rev_entry_row.total_credit is distinct from v_entry_row.total_debit then
      raise exception 'ASSERTION FAILED T37.chain: header/provenance inversion mismatch';
    end if;
    if exists (
      select 1
      from (select * from erp.journal_entry_lines where journal_entry_id = r_pair.original_id) original_line
      full join (select * from erp.journal_entry_lines where journal_entry_id = r_pair.reversal_id) reversal_line
        on reversal_line.line_number = original_line.line_number
      where original_line.id is null or reversal_line.id is null
        or original_line.account_id is distinct from reversal_line.account_id
        or original_line.debit is distinct from reversal_line.credit
        or original_line.credit is distinct from reversal_line.debit
        or original_line.currency_code is distinct from reversal_line.currency_code
        or original_line.exchange_rate is distinct from reversal_line.exchange_rate
    ) then
      raise exception 'ASSERTION FAILED T37.lines: exact inverse line multiset mismatch';
    end if;
    select sum(debit), sum(credit) into v_expected_debit, v_expected_credit
    from erp.journal_entry_lines where journal_entry_id = r_pair.reversal_id;
    if v_expected_debit is distinct from v_rev_entry_row.total_debit
       or v_expected_credit is distinct from v_rev_entry_row.total_credit then
      raise exception 'ASSERTION FAILED T37.sums: persisted reversal lines do not equal exact headers';
    end if;
  end loop;
  if exists (select 1 from erp.journal_entries where id in (v_public_chain_id, v_internal_chain_id)
    and (status <> 'posted' or reversal_of_entry_id is not null)) then
    raise exception 'ASSERTION FAILED T37.chain_forward: terminal reversals must have NULL forward links';
  end if;

  if has_function_privilege('anon', 'erp.reverse_pos_v2_journal_entry_exact4(uuid,uuid,date,text,text,text,uuid,boolean)', 'execute')
     or has_function_privilege('authenticated', 'erp.reverse_pos_v2_journal_entry_exact4(uuid,uuid,date,text,text,text,uuid,boolean)', 'execute')
     or has_function_privilege('service_role', 'erp.reverse_pos_v2_journal_entry_exact4(uuid,uuid,date,text,text,text,uuid,boolean)', 'execute')
     or has_function_privilege('authenticated', 'erp.reverse_internal_journal_entry(uuid,uuid,text,uuid,text,text)', 'execute') then
    raise exception 'ASSERTION FAILED T37.private: reversal helpers must remain private';
  end if;

  -- Constraints remain enforced for privileged DML as well as RPC calls.
  v_provenance_fixture_id := gen_random_uuid();
  v_sqlstate := null;
  v_constraint_name := null;
  begin
    insert into erp.journal_entries (
      id, organization_id, branch_id, period_id, entry_date, status, description,
      source_type, source_id, idempotency_key, accounting_contract, v2_original_entry_id, created_by
    ) values (
      v_provenance_fixture_id, v_org_id, v_branch_id, v_entry_row.period_id, current_date, 'draft',
      'Duplicado de procedencia', 'journal_reversal', v_public_original_id,
      'PROVENANCE-DUP-' || v_suffix, 'pos_gross_v2_exact4', v_public_original_id, v_admin_uid
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_constraint_name = constraint_name;
  end;
  if v_sqlstate is distinct from '23505' or v_constraint_name is distinct from 'journal_entries_v2_original_unique' then
    raise exception 'ASSERTION FAILED T37.unique: expected provenance unique violation, got % (%)', v_sqlstate, v_constraint_name;
  end if;

  v_sqlstate := null;
  begin
    insert into erp.journal_entries (
      id, organization_id, branch_id, period_id, entry_date, status, description,
      source_type, source_id, idempotency_key, accounting_contract, v2_original_entry_id, created_by
    ) values (
      v_provenance_fixture_id, v_org_id, v_branch_id, v_entry_row.period_id, current_date, 'draft',
      'Procedencia de otro tenant', 'journal_reversal', v_foreign_entry_id,
      'PROVENANCE-FOREIGN-' || v_suffix, 'pos_gross_v2_exact4', v_foreign_entry_id, v_admin_uid
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
  end;
  if v_sqlstate is distinct from '23000' then
    raise exception 'ASSERTION FAILED T37.provenance_guard: expected 23000, got %', v_sqlstate;
  end if;
  v_sqlstate := null;
  begin
    insert into erp.journal_entries (
      id, organization_id, branch_id, period_id, entry_date, status, description,
      source_type, source_id, idempotency_key, accounting_contract, v2_original_entry_id, created_by
    ) values (
      v_provenance_fixture_id, v_org_id, v_branch_id, v_entry_row.period_id, current_date, 'draft',
      'Autorreferencia prohibida', 'journal_reversal', v_provenance_fixture_id,
      'PROVENANCE-SELF-' || v_suffix, 'pos_gross_v2_exact4', v_provenance_fixture_id, v_admin_uid
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
  end;
  if v_sqlstate is distinct from '23000' then
    raise exception 'ASSERTION FAILED T37.self: self provenance must be rejected, got %', v_sqlstate;
  end if;

  if (select count(*) from pg_constraint
      where conrelid = 'erp.journal_entries'::regclass and convalidated
        and conname in ('journal_entries_v2_original_fk', 'journal_entries_v2_original_not_self',
          'journal_entries_v2_original_contract', 'journal_entries_v2_original_unique')) <> 4 then
    raise exception 'ASSERTION FAILED T37.constraints: four validated provenance constraints are required';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'erp.journal_entries'::regclass and conname = 'journal_entries_v2_original_fk'
      and contype = 'f' and confrelid = 'erp.journal_entries'::regclass
      and cardinality(conkey) = 2 and cardinality(confkey) = 2
  ) then
    raise exception 'ASSERTION FAILED T37.tenant_fk: provenance must use a composite tenant FK';
  end if;

  -- --------------------------------------------------------------------------
  -- TEST 38: Literal latest-DEV legacy ordering (no new exact4 policy on v1)
  -- --------------------------------------------------------------------------
  v_legacy_reversal_id := erp.reverse_journal_entry(v_legacy_entry_id, current_date,
    'REV-LEGACY-PUBLIC-' || v_suffix, 'Reversa legacy maxima');
  select * into v_rev_entry_row from erp.journal_entries where id = v_legacy_reversal_id;
  if v_rev_entry_row.accounting_contract <> 'legacy_v1'
     or v_rev_entry_row.total_debit <> 9999999999999999.99
     or v_rev_entry_row.v2_original_entry_id is not null
     or v_rev_entry_row.reversal_of_entry_id is not null then
    raise exception 'ASSERTION FAILED T38.public: legacy max range or provenance changed';
  end if;
  perform erp.close_accounting_period(v_closed_period_id, 'Cierre para replay legacy');
  -- Public baseline replays by key BEFORE target/date/reason/status validation.
  if erp.reverse_journal_entry(gen_random_uuid(), null::date,
       'REV-LEGACY-PUBLIC-' || v_suffix, null) is distinct from v_legacy_reversal_id then
    raise exception 'ASSERTION FAILED T38.public_keyfirst: literal baseline ordering changed';
  end if;
  v_sqlstate := null;
  begin
    perform erp.reverse_journal_entry(v_legacy_entry_id, current_date,
      'REV-LEGACY-PUBLIC-NEW-' || v_suffix, 'Reversa duplicada legacy');
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
  end;
  if v_sqlstate is distinct from '55000' then
    raise exception 'ASSERTION FAILED T38.public_status: legacy reversed/newkey must reject 55000, got %', v_sqlstate;
  end if;

  update erp.accounting_periods
     set status = 'open', closed_at = null, closed_by = null, close_reason = null
   where id = v_closed_period_id;

  v_replay_source_id := gen_random_uuid();
  v_internal_legacy_id := erp.post_internal_journal_entry(v_org_id, v_branch_id, current_date,
    'manual', v_replay_source_id, 'primary', 'LEGACY-INTERNAL-FOR-REV-' || v_suffix,
    'Fixture contable legacy para reversa', jsonb_build_array(
      jsonb_build_object('account_id', v_acc_rec_id, 'debit', 100.555, 'credit', 0),
      jsonb_build_object('account_id', v_acc_inc_id, 'debit', 0, 'credit', 100.56)
    ));
  v_internal_legacy_reversal_id := erp.reverse_internal_journal_entry(v_org_id, v_internal_legacy_id,
    'manual', v_replay_source_id, 'REV-LEGACY-INTERNAL-' || v_suffix, 'Reversa interna legacy');
  select * into v_rev_entry_row from erp.journal_entries where id = v_internal_legacy_reversal_id;
  if v_rev_entry_row.accounting_contract <> 'legacy_v1' or v_rev_entry_row.total_debit <> 100.56
     or v_rev_entry_row.v2_original_entry_id is not null then
    raise exception 'ASSERTION FAILED T38.internal: legacy internal 2-decimal contract changed';
  end if;
  perform erp.close_accounting_period(v_closed_period_id, 'Cierre para replay interno legacy');
  -- Internal baseline returns the forward pointer for a reversed original, even with new key/source.
  if erp.reverse_internal_journal_entry(v_org_id, v_internal_legacy_id, null, null,
       'REV-LEGACY-INTERNAL-NEW-' || v_suffix, 'Replay legacy distinto') is distinct from v_internal_legacy_reversal_id then
    raise exception 'ASSERTION FAILED T38.internal_forward: baseline reversed replay changed';
  end if;
  v_sqlstate := null;
  begin
    perform erp.reverse_internal_journal_entry(v_org_id, v_internal_legacy_id, 'manual', v_replay_source_id,
      'REV-LEGACY-INTERNAL-' || v_suffix, '');
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
  end;
  if v_sqlstate is distinct from '55000' then
    raise exception 'ASSERTION FAILED T38.internal_validation: baseline validates reason before reversed replay, got %', v_sqlstate;
  end if;

  update erp.accounting_periods
     set status = 'open', closed_at = null, closed_by = null, close_reason = null
   where id = v_closed_period_id;

  -- SUCCESS: Trigger P9001 Sentinel for Zero-Fixture Rollback
  -- --------------------------------------------------------------------------
  raise exception using errcode = 'P9001', message = 'ERP_POS_AUTHORITATIVE_GROSS_PRICING_TEST_SUCCESS';

exception
  when sqlstate 'P9001' then
    -- Sentinel caught: all smoke test sections succeeded!
    null;
end;
$$;

select 'PASS: ERP POS Authoritative Gross Pricing Smoke Test' as smoke_result;

rollback;
