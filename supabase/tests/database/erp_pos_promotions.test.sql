begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(14);

insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values (
  '00000000-0000-0000-0000-000000000000', '86000000-0000-0000-0000-000000000053',
  'authenticated', 'authenticated', 'pos-promotions-pgtap@nictech.test', now(),
  '{"provider":"email","providers":["email"]}', '{"display_name":"POS promotions pgTAP"}', now(), now()
);
update erp.profiles set organization_id = '10000000-0000-0000-0000-000000000001'
where id = '86000000-0000-0000-0000-000000000053';

select ok(
  not has_function_privilege('anon', 'erp.quote_pos_catalog_prices(uuid[])', 'execute'),
  'Anonymous users cannot quote POS prices'
);
select set_config('request.jwt.claim.sub', '86000000-0000-0000-0000-000000000053', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select throws_ok(
  $$select erp.quote_pos_catalog_prices('{}'::uuid[])$$,
  '42501', 'sales.create permission required', 'An authenticated user without sales.create cannot quote POS prices'
);

reset role;
insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000053',
  '40000000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000053'
);
set local role authenticated;

create temporary table _pos_promo as
select
  '20000000-0000-0000-0000-000000000001'::uuid as branch_id,
  '30000000-0000-0000-0000-000000000001'::uuid as location_id,
  '82000000-0000-0000-0000-000000000002'::uuid as card_id,
  erp.get_or_create_exchange_snapshot('ARS') as snapshot_id,
  erp.get_or_create_pos_customer('Cliente pgTAP promociones') as customer_id,
  (erp.create_catalog_product_with_variants(
    'POS-PROMO-PGTAP', 'Cargador pgTAP promociones', 'product', 'quantity',
    null, null, null, null, 400, 1210, 21, '[]'::jsonb
  )->>'product_id')::uuid as product_id;

select erp.post_stock_document(
  'opening', branch_id, 'pgtap-pos-promo-opening', 'Stock inicial', jsonb_build_array(
    jsonb_build_object('product_id', product_id, 'to_location_id', location_id, 'quantity', 6, 'unit_cost', 400)
  )
) from _pos_promo;

create function pg_temp.pos_promotion(p_id uuid, p_channel text, p_ends_at timestamptz)
returns uuid language sql as $$
  select erp.upsert_promotion(
    p_id, 'pgTAP 10 %', 'porcentaje', 10, now() - interval '2 days', p_ends_at,
    true, array[p_channel], jsonb_build_array(jsonb_build_object('product_id', product_id))
  ) from _pos_promo
$$;

create function pg_temp.pos_quote()
returns jsonb language sql as $$
  select erp.quote_pos_catalog_prices(array[product_id])->0 from _pos_promo
$$;

create function pg_temp.pos_charge(p_key text, p_expected numeric)
returns jsonb language sql as $$
  select erp.create_sale_with_invoice(
    branch_id, customer_id, 'ARS', snapshot_id, p_key, 'Venta pgTAP promociones',
    jsonb_build_array(jsonb_build_object(
      'kind', 'product', 'product_id', product_id, 'from_location_id', location_id,
      'quantity', 1, 'expected_unit_price', p_expected, 'expected_tax_rate', 21
    )),
    'non_fiscal', jsonb_build_array(jsonb_build_object('payment_method_id', card_id, 'amount', p_expected))
  ) from _pos_promo
$$;

create temporary table _pos_promo_id as
select pg_temp.pos_promotion(null, 'pos', now() + interval '1 day') as id;

select is((pg_temp.pos_quote()->>'list_price_ars')::numeric, 1210::numeric, 'POS quote preserves list price');
select is((pg_temp.pos_quote()->>'final_price_ars')::numeric, 1089::numeric, 'POS quote applies the active 10% promotion');
select is((pg_temp.pos_quote()->>'promotion_id')::uuid, (select id from _pos_promo_id), 'POS quote identifies the applied promotion');
select throws_ok(
  $$select pg_temp.pos_charge('pgtap-pos-promo-active-invalid', 1210)$$,
  '23514', 'stale quote: catalog price or tax rate has changed, requote required', 'Checkout rejects list price while the POS promotion is active'
);

create temporary table _pos_promo_receipt as
select pg_temp.pos_charge('pgtap-pos-promo-active', 1089) as result;
select is(
  (select p.amount from erp.payments p join _pos_promo_receipt r on p.sale_id = (r.result->>'sale_id')::uuid),
  1089::numeric, 'Checkout records a payment for ARS 1,089'
);

select pg_temp.pos_promotion(id, 'pos', now() - interval '1 day') from _pos_promo_id;
select is((pg_temp.pos_quote()->>'final_price_ars')::numeric, 1210::numeric, 'POS requote ignores the expired promotion');
select throws_ok(
  $$select pg_temp.pos_charge('pgtap-pos-promo-expired-invalid', 1089)$$,
  '23514', 'stale quote: catalog price or tax rate has changed, requote required', 'Checkout rejects the expired discount for a new sale'
);
select is(
  pg_temp.pos_charge('pgtap-pos-promo-active', 1089),
  (select result from _pos_promo_receipt),
  'Replaying the original sale after the promotion expires returns the same receipt'
);

create temporary table _pos_expired_receipt as
select pg_temp.pos_charge('pgtap-pos-promo-expired', 1210) as result;
select is(
  (select p.amount from erp.payments p join _pos_expired_receipt r on p.sale_id = (r.result->>'sale_id')::uuid),
  1210::numeric, 'Checkout records ARS 1,210 after expiration'
);

select pg_temp.pos_promotion(id, 'web', now() + interval '1 day') from _pos_promo_id;
select is((pg_temp.pos_quote()->>'final_price_ars')::numeric, 1210::numeric, 'POS quote ignores a currently active web-only promotion');
create temporary table _pos_web_receipt as
select pg_temp.pos_charge('pgtap-pos-promo-web', 1210) as result;
select is(
  (select p.amount from erp.payments p join _pos_web_receipt r on p.sale_id = (r.result->>'sale_id')::uuid),
  1210::numeric, 'Checkout records ARS 1,210 when the promotion only includes web'
);
select is(
  (select count(*) from erp.payments p join erp.sale_lines l on l.sale_id = p.sale_id join _pos_promo c on c.product_id = l.product_id),
  3::bigint, 'Exactly one payment per valid sale, with none for the replay or stale quotes'
);

select * from finish();
rollback;
