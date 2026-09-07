begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

-- Setup test user with owner permissions
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '87000000-0000-0000-0000-000000000099',
  'authenticated', 'authenticated', 'phase-d-test@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Phase D Test"}'::jsonb, now(), now()
);

update erp.profiles
   set organization_id = '10000000-0000-0000-0000-000000000001'
 where id = '87000000-0000-0000-0000-000000000099';

insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  '87000000-0000-0000-0000-000000000099',
  '40000000-0000-0000-0000-000000000001',
  '87000000-0000-0000-0000-000000000099'
);

create temporary table d_ids(kind text primary key, id uuid, text_val text);
grant all on d_ids to authenticated;

-- Setup test customer
insert into erp.customers(id, organization_id, code, display_name, phone, email)
values('c1000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','40123456','Carlos Cliente Taller','+5491144445555','carlos@test.com');

-- Setup test replacement part product
insert into erp.products(id, organization_id, product_type_id, item_kind, unit_id, internal_code, internal_name, inventory_tracking, can_use_as_repair_part)
values('d2000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','product','50000000-0000-0000-0000-000000000001','PHASED-SCREEN','Módulo Pantalla iPhone 13','quantity',true);

-- Context setup
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','87000000-0000-0000-0000-000000000099',true);
set local role authenticated;

-- Setup FX and stock opening
select lives_ok($$select erp.capture_exchange_rate('ARS', 1, 'phased-local', now(), 'phased-fx', 'Phase D FX')$$, 'Phase D FX snapshot captured');
select lives_ok($$select erp.post_stock_document('opening', '20000000-0000-0000-0000-000000000001', 'phased-stock', 'Phase D stock', '[{"product_id":"d2000000-0000-0000-0000-000000000001","to_location_id":"30000000-0000-0000-0000-000000000002","quantity":10,"unit_cost":25}]')$$, 'Phase D part stock opened');

insert into d_ids(kind, id)
values('part_product', 'd2000000-0000-0000-0000-000000000001'::uuid);

-- 1. Test erp.intake_repair_order
select lives_ok(
  $$insert into d_ids(kind, id, text_val)
    select 'repair_order', (res->>'repair_order_id')::uuid, res->>'order_code'
    from erp.intake_repair_order(
      '20000000-0000-0000-0000-000000000001'::uuid,
      'c1000000-0000-0000-0000-000000000001'::uuid,
      'Smartphone',
      'Apple',
      'iPhone 13 Pro',
      'SN-PHASED-001',
      '356789012345678',
      '["funda original", "cable lightning"]'::jsonb,
      'Rayones leves en pantalla',
      'Golpe en esquina',
      'Cliente necesita equipo para el viernes',
      'No enciende tras golpe',
      'Ingreso formal taller'
    ) as res$$,
  'Atomic repair intake creates equipment and numbered repair order'
);

select is(
  (select count(*) from erp.repair_orders where id = (select id from d_ids where kind = 'repair_order')),
  1::bigint,
  'Repair order exists in database'
);

select is(
  (select s.code from erp.repair_state_events e
   join erp.repair_statuses s on s.id = e.status_id
   where e.repair_order_id = (select id from d_ids where kind = 'repair_order')
   order by e.event_sequence desc limit 1),
  'received',
  'Repair order initial status is received'
);

-- 2. Test status transition received -> diagnosis
select lives_ok(
  $$select erp.transition_repair_order(
    (select id from d_ids where kind = 'repair_order'),
    '85000000-0000-0000-0000-000000000002'::uuid,
    'Equipo ingresado a mesa de laboratorio',
    'op-diag-1',
    'Inicio de diagnóstico técnico'
  )$$,
  'Transition received -> diagnosis succeeds'
);

-- 3. Test status transition diagnosis -> repair
select lives_ok(
  $$select erp.transition_repair_order(
    (select id from d_ids where kind = 'repair_order'),
    '85000000-0000-0000-0000-000000000003'::uuid,
    'Reparación en curso en taller',
    'op-rep-1',
    'Desarme y reemplazo de módulo'
  )$$,
  'Transition diagnosis -> repair succeeds'
);


-- 4. Test direct part consumption (Finding H07)
select lives_ok(
  $$insert into d_ids(kind, id)
    select 'part_doc_1', erp.consume_repair_part_direct(
      (select id from d_ids where kind = 'repair_order'),
      '30000000-0000-0000-0000-000000000002'::uuid,
      (select id from d_ids where kind = 'part_product'),
      null,
      1::numeric,
      'Instalación de módulo pantalla'
    )$$,
  'Direct part consumption reserves, releases, and posts repair_consumption document atomically'
);

select is(
  (select count(*) from erp.repair_part_events
   where repair_order_id = (select id from d_ids where kind = 'repair_order') and action = 'consumed'),
  1::bigint,
  'Repair part event recorded as consumed'
);

-- 5. Test QC gate: transition to terminal status 'ready' without passing QC must be REJECTED (H16)
select throws_ok(
  $$select erp.transition_repair_order(
    (select id from d_ids where kind = 'repair_order'),
    '85000000-0000-0000-0000-000000000004'::uuid,
    'Listo',
    'op-ready-premature',
    'Intento de entrega sin QC'
  )$$,
  '55000',
  'latest final test must follow repair progression and pass every required item',
  'Transition to ready status is blocked without passing final QC'
);

-- 6. Test failing QC protocol
select lives_ok(
  $$select erp.record_repair_test_run(
    (select id from d_ids where kind = 'repair_order'),
    '85300000-0000-0000-0000-000000000002'::uuid,
    '[{"item_key":"powers_on","result":"pass"},{"item_key":"reported_fault","result":"fail"},{"item_key":"safety","result":"pass"}]'::jsonb,
    'Falla persiste intermitentemente',
    'op-qc-fail'
  )$$,
  'Failing QC run recorded'
);

select throws_ok(
  $$select erp.transition_repair_order(
    (select id from d_ids where kind = 'repair_order'),
    '85000000-0000-0000-0000-000000000004'::uuid,
    'Listo',
    'op-ready-fail',
    'Intento tras QC fallido'
  )$$,
  '55000',
  'latest final test must follow repair progression and pass every required item',
  'Failing QC prevents advancing to ready status'
);

-- 7. Test passing QC protocol
select lives_ok(
  $$select erp.record_repair_test_run(
    (select id from d_ids where kind = 'repair_order'),
    '85300000-0000-0000-0000-000000000002'::uuid,
    '[{"item_key":"powers_on","result":"pass"},{"item_key":"reported_fault","result":"pass"},{"item_key":"safety","result":"pass"}]'::jsonb,
    'Pruebas de encendido, carga y seguridad aprobadas 100%',
    'op-qc-pass'
  )$$,
  'Passing QC run recorded'
);

-- Advancing to ready now succeeds
select lives_ok(
  $$select erp.transition_repair_order(
    (select id from d_ids where kind = 'repair_order'),
    '85000000-0000-0000-0000-000000000004'::uuid,
    'Equipo listo para retirar',
    'op-ready-pass',
    'Aprobado tras QC exitoso'
  )$$,
  'Advancing to ready status succeeds after valid passing QC'
);

-- 8. Test H16: altering parts after QC invalidates delivery eligibility
select lives_ok(
  $$insert into d_ids(kind, id)
    select 'part_doc_2', erp.consume_repair_part_direct(
      (select id from d_ids where kind = 'repair_order'),
      '30000000-0000-0000-0000-000000000002'::uuid,
      (select id from d_ids where kind = 'part_product'),
      null,
      1::numeric,
      'Se reemplaza flex adicional'
    )$$,
  'Consuming additional part on ready equipment'
);

-- Delivery must now be rejected because QC is older than the last part intervention!
select throws_ok(
  $$select erp.deliver_repair_order(
    (select id from d_ids where kind = 'repair_order'),
    'Carlos Cliente Taller',
    '3456',
    'typed_name',
    'Carlos Cliente Taller',
    90,
    'Garantía técnica 90 días',
    'op-deliv-invalidated',
    'Intento de entrega con repuesto posterior a QC'
  )$$,
  '55000',
  'terminal status and latest passing final tests are required for delivery',
  'Delivery is blocked when parts were changed after the last QC'
);

-- Fresh passing QC satisfies the requirement again
select lives_ok(
  $$select erp.record_repair_test_run(
    (select id from d_ids where kind = 'repair_order'),
    '85300000-0000-0000-0000-000000000002'::uuid,
    '[{"item_key":"powers_on","result":"pass"},{"item_key":"reported_fault","result":"pass"},{"item_key":"safety","result":"pass"}]'::jsonb,
    'Re-test completo post-flex aprobado',
    'op-qc-retest'
  )$$,
  'Fresh passing QC satisfies test freshness condition'
);

-- 9. Test versioned Quote and customer response (Finding H06, H20)
select lives_ok(
  $$insert into d_ids(kind, id)
    select 'quote_1', erp.create_repair_quote_version(
      (select id from d_ids where kind = 'repair_order'),
      'ARS',
      (select id from erp.exchange_rate_snapshots where source = 'phased-local'),
      jsonb_build_array(
        jsonb_build_object(
          'kind', 'product',
          'product_id', (select id from d_ids where kind = 'part_product'),
          'description', 'Módulo repuesto pantalla',
          'quantity', 1,
          'unit_price', 15000,
          'tax_rate_percent', 21
        ),
        jsonb_build_object(
          'kind', 'free_concept',
          'description', 'Mano de obra especializada',
          'quantity', 1,
          'unit_price', 8000,
          'unit_cost', 2000,
          'tax_rate_percent', 21
        )
      ),
      'op-quote-1',
      'Presupuesto inicial para cliente'
    )$$,
  'Versioned quote created with itemized parts and labor'
);

-- Direct customer response recording
select lives_ok(
  $$select erp.respond_quote_direct(
    (select id from d_ids where kind = 'quote_1'),
    'approved',
    'Cliente acepta por WhatsApp y da conformidad'
  )$$,
  'Quote decision recorded atomically via token wrapper'
);

select is(
  (select decision from erp.repair_quote_response_events
   where quote_id = (select id from d_ids where kind = 'quote_1')),
  'approved'::erp.repair_quote_decision,
  'Quote decision is recorded as approved'
);

-- 10. Test formal delivery and derived warranty (Finding H05, H08)
select lives_ok(
  $$insert into d_ids(kind, id)
    select 'delivery_1', erp.deliver_repair_order(
      (select id from d_ids where kind = 'repair_order'),
      'Carlos Cliente Taller',
      '3456',
      'typed_name',
      'Carlos Cliente Taller',
      90,
      'Garantía técnica 90 días sobre módulo instalado y mano de obra',
      'op-deliv-success',
      'Entrega física de equipo reparado'
    )$$,
  'Formal delivery succeeds and generates immutable delivery fact and warranty'
);

select is(
  (select count(*) from erp.repair_deliveries where id = (select id from d_ids where kind = 'delivery_1')),
  1::bigint,
  'Repair delivery recorded'
);

select is(
  (select count(*) from erp.repair_warranties where delivery_id = (select id from d_ids where kind = 'delivery_1')),
  1::bigint,
  'Repair warranty policy derived from delivery'
);

-- 11. Test part tampering blocked on delivered order (Finding H16)
select throws_ok(
  $$select erp.consume_repair_part_direct(
    (select id from d_ids where kind = 'repair_order'),
    '30000000-0000-0000-0000-000000000002'::uuid,
    (select id from d_ids where kind = 'part_product'),
    null,
    1::numeric,
    'Intento de consumo en orden ya entregada'
  )$$,
  '55000',
  'cannot consume parts on a delivered repair order',
  'Parts cannot be consumed on an already delivered repair order'
);

-- 12. Test independent warranty claim (Finding H08)
select lives_ok(
  $$insert into d_ids(kind, id)
    select 'claim_1', erp.open_repair_warranty_claim(
      (select id from erp.repair_warranties where delivery_id = (select id from d_ids where kind = 'delivery_1')),
      'Desprendimiento de protector colocado',
      'op-claim-1',
      'Reclamo de garantía por cliente'
    )$$,
  'Independent warranty claim opened against active warranty'
);

select ok(
  (select claim_code from erp.repair_warranty_claims where id = (select id from d_ids where kind = 'claim_1')) like 'WC-%',
  'Warranty claim receives sequential WC code'
);

-- 13. Test erp.repair_orders_overview view
select is(
  (select status_code from erp.repair_orders_overview where id = (select id from d_ids where kind = 'repair_order')),
  'ready',
  'Overview view returns current status code ready'
);

select ok(
  (select delivery_id is not null from erp.repair_orders_overview where id = (select id from d_ids where kind = 'repair_order')),
  'Overview view contains delivery reference'
);

select ok(
  (select warranty_id is not null from erp.repair_orders_overview where id = (select id from d_ids where kind = 'repair_order')),
  'Overview view contains derived warranty reference'
);

select is(
  (select (latest_quote->>'decision') from erp.repair_orders_overview where id = (select id from d_ids where kind = 'repair_order')),
  'approved',
  'Overview view contains approved quote decision'
);

select * from finish();
rollback;
