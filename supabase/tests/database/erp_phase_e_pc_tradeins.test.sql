begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

-- 1. Setup test staff user with owner permissions
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '88000000-0000-0000-0000-000000000099',
  'authenticated', 'authenticated', 'phase-e-test@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Phase E Test Staff"}'::jsonb, now(), now()
);

update erp.profiles
   set organization_id = '10000000-0000-0000-0000-000000000001'
 where id = '88000000-0000-0000-0000-000000000099';

insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  '88000000-0000-0000-0000-000000000099',
  '40000000-0000-0000-0000-000000000001', -- Owner role
  '88000000-0000-0000-0000-000000000099'
);

create temporary table e_test_ids (
  kind text primary key,
  id uuid,
  text_val text
);
grant all on e_test_ids to authenticated, service_role;

-- 2. Setup customer and products
insert into erp.customers(id, organization_id, code, display_name, phone, email)
values('c2000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','41999888','Pedro Canje','+5491177778888','pedro@test.com');

insert into erp.products(id, organization_id, product_type_id, item_kind, unit_id, internal_code, internal_name, inventory_tracking)
values('d3000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','product','50000000-0000-0000-0000-000000000001','IPHONE-12-USADO','iPhone 12 64GB Usado','imei');

-- Authenticate as staff
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','88000000-0000-0000-0000-000000000099',true);
set local role authenticated;

-- Setup FX snapshot
select lives_ok($$select erp.capture_exchange_rate('ARS', 1, 'phasee-local', now(), 'phasee-fx', 'Phase E FX')$$, 'Phase E FX snapshot captured');

-- 3. Test Trade-in Intake
select lives_ok(
  $$
  insert into e_test_ids(kind, id)
  select 'trade_in', erp.create_trade_in(
    '20000000-0000-0000-0000-000000000001'::uuid,
    'c2000000-0000-0000-0000-000000000001'::uuid,
    'd3000000-0000-0000-0000-000000000001'::uuid,
    null,
    'F2LX8000H8TT',
    '358291091234567',
    'Pedro Canje',
    'Equipo de mi propiedad personal adquirido en 2021',
    '[{"type":"identity","private_object_path":"evidence/dni.pdf","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]'::jsonb,
    200000,
    'trade-intake-test-01',
    'Ingreso de iPhone 12 para canje'
  );
  $$,
  'Trade-in with IMEI created successfully'
);

-- Check trade_in appears in overview with quarantine stage
select is(
  (select stage from erp.trade_ins_overview where id = (select id from e_test_ids where kind = 'trade_in')),
  'quarantine',
  'Trade-in initial stage in overview is quarantine'
);

-- Provenance review
select lives_ok(
  $$select erp.review_trade_in_provenance((select id from e_test_ids where kind = 'trade_in'), 'approved', 'DNI y titularidad verificados')$$,
  'Provenance review approved'
);

-- Evaluation
select lives_ok(
  $$
  select erp.create_trade_in_evaluation(
    (select id from e_test_ids where kind = 'trade_in'),
    '{"screen":"original_clean","battery_health":88}'::jsonb,
    180000,
    0,
    'eval-test-01',
    'Evaluación técnica completada'
  );
  $$,
  'Evaluation created'
);

select lives_ok(
  $$
  select erp.review_trade_in_evaluation(
    (select id from erp.trade_in_evaluations where trade_in_id = (select id from e_test_ids where kind = 'trade_in')),
    'approved',
    'Valor acordado aprobado'
  );
  $$,
  'Evaluation approved'
);

-- 4. TEST FINDING H14: release_trade_in_to_stock MUST reject when imei_status is NULL
select throws_ok(
  $$
  select erp.release_trade_in_to_stock(
    (select id from e_test_ids where kind = 'trade_in'),
    '30000000-0000-0000-0000-000000000002'::uuid,
    'release-premature-h14',
    'Intento de liberación sin resultado IMEI'
  );
  $$,
  '55000',
  'latest IMEI request must have an effective clear or applicable not-required result',
  'H14 Regression Test: release_trade_in_to_stock rejects NULL imei_status'
);

-- TEST FINDING H14: manual fallback without previous provider request must be rejected
select throws_ok(
  $$
  select erp.record_trade_in_imei_manual_fallback(
    (select id from e_test_ids where kind = 'trade_in'),
    'clear',
    '{"enacom_status":"clean"}'::jsonb,
    'fallback-premature-h14',
    'Fallback sin consulta previa al proveedor'
  );
  $$,
  '55000',
  'latest provider request must end unavailable or error for manual fallback',
  'H14 Regression Test: manual fallback rejected when no provider request exists'
);

-- Request provider IMEI check
select lives_ok(
  $$
  insert into e_test_ids(kind, id)
  select 'imei_request', erp.request_trade_in_imei_check(
    (select id from e_test_ids where kind = 'trade_in'),
    'api.imeicheck.mock',
    'imei-req-01',
    'Consulta oficial de IMEI'
  );
  $$,
  'IMEI check request created'
);

-- TEST FINDING H14: manual fallback while provider result is still NULL (pending) must be rejected
select throws_ok(
  $$
  select erp.record_trade_in_imei_manual_fallback(
    (select id from e_test_ids where kind = 'trade_in'),
    'clear',
    '{"enacom_status":"clean"}'::jsonb,
    'fallback-pending-h14',
    'Fallback mientras proveedor está pendiente'
  );
  $$,
  '55000',
  'latest provider request must end unavailable or error for manual fallback',
  'H14 Regression Test: manual fallback rejected when provider request is pending (NULL result)'
);

-- Simulate provider failure as service_role
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select lives_ok(
  $$
  select erp.record_trade_in_imei_provider_result(
    (select id from e_test_ids where kind = 'imei_request'),
    'unavailable',
    '503 Service Temporarily Unavailable',
    '{"http_code":503}'::jsonb,
    'imei-result-unavail-01'
  );
  $$,
  'Provider result recorded as unavailable'
);

-- Now technician records manual fallback
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select lives_ok(
  $$
  select erp.record_trade_in_imei_manual_fallback(
    (select id from e_test_ids where kind = 'trade_in'),
    'clear',
    '{"enacom_lookup":"clean","screenshot_hash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'::jsonb,
    'fallback-valid-01',
    'Comprobación manual en ENACOM limpia'
  );
  $$,
  'Manual fallback accepted when provider is unavailable'
);

-- Diagnostic check on IMEI results via overview view
select diag('OVERVIEW imei_status: ' || coalesce((select imei_status::text from erp.trade_ins_overview where id = (select id from e_test_ids where kind = 'trade_in')), 'NULL'));

-- Release to stock now succeeds
select lives_ok(
  $$
  select erp.release_trade_in_to_stock(
    (select id from e_test_ids where kind = 'trade_in'),
    '30000000-0000-0000-0000-000000000001'::uuid,
    'release-valid-01',
    'Liberación a stock disponible'
  );
  $$,
  'Trade-in released to stock successfully'
);

-- Overview shows stage as ready_for_stock
select is(
  (select stage from erp.trade_ins_overview where id = (select id from e_test_ids where kind = 'trade_in')),
  'ready_for_stock',
  'Trade-in stage is ready_for_stock after release'
);

-- 5. Apply trade-in as payment on a sale
select lives_ok(
  $$
  insert into e_test_ids(kind, id)
  select 'sale', erp.create_sale(
    '20000000-0000-0000-0000-000000000001'::uuid,
    'c2000000-0000-0000-0000-000000000001'::uuid,
    'ARS',
    (select id from erp.exchange_rate_snapshots order by captured_at desc limit 1),
    'sale-tradein-01',
    'Venta con parte de pago canje',
    jsonb_build_array(jsonb_build_object(
      'kind', 'product',
      'product_id', 'd3000000-0000-0000-0000-000000000001'::uuid,
      'from_location_id', '30000000-0000-0000-0000-000000000001'::uuid,
      'quantity', 1,
      'unit_price', 250000,
      'inventory_unit_id', (select inventory_unit_id from erp.trade_ins where id = (select id from e_test_ids where kind = 'trade_in'))
    )),
    '[]'::jsonb
  );
  $$,
  'Sale created for trade-in payment'
);

select lives_ok(
  $$
  select erp.apply_trade_in_sale_payment(
    (select id from e_test_ids where kind = 'trade_in'),
    (select id from e_test_ids where kind = 'sale'),
    180000,
    'pay-tradein-01',
    'Pago aplicado por canje'
  );
  $$,
  'Trade-in payment applied to sale'
);

-- Overview shows stage as applied_to_sale
select is(
  (select stage from erp.trade_ins_overview where id = (select id from e_test_ids where kind = 'trade_in')),
  'applied_to_sale',
  'Trade-in stage is applied_to_sale after payment application'
);

-- Helper direct intake test
select lives_ok(
  $$
  select erp.intake_trade_in_direct(
    '20000000-0000-0000-0000-000000000001'::uuid,
    'c2000000-0000-0000-0000-000000000001'::uuid,
    'd3000000-0000-0000-0000-000000000001'::uuid,
    null,
    'F3LX9999H8TT',
    '358291099999999',
    'Pedro Canje',
    'Equipo secundario',
    150000,
    'DNI y factura de compra'
  );
  $$,
  'Helper erp.intake_trade_in_direct executes cleanly'
);

-- 6. PC BUILD TESTS & FINDING H17
-- Setup PC components (motherboard, cpu, memory, storage, power_supply)
insert into erp.products(id, organization_id, product_type_id, item_kind, unit_id, internal_code, internal_name, inventory_tracking) values
  ('e1000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','product','50000000-0000-0000-0000-000000000001','PC-MB-B550','Motherboard B550M','quantity'),
  ('e1000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','product','50000000-0000-0000-0000-000000000001','PC-CPU-5600','AMD Ryzen 5 5600','quantity'),
  ('e1000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','product','50000000-0000-0000-0000-000000000001','PC-RAM-16G','DDR4 16GB 3200MHz','quantity'),
  ('e1000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','product','50000000-0000-0000-0000-000000000001','PC-SSD-1TB','NVMe SSD 1TB','quantity'),
  ('e1000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','product','50000000-0000-0000-0000-000000000001','PC-PSU-650W','Fuente 650W Bronze','quantity');

-- Open stock for PC components
select lives_ok(
  $$
  select erp.post_stock_document('opening', '20000000-0000-0000-0000-000000000001', 'pc-stock-open', 'Apertura stock componentes PC', jsonb_build_array(
    jsonb_build_object('product_id','e1000000-0000-0000-0000-000000000001','to_location_id','30000000-0000-0000-0000-000000000002','quantity',5,'unit_cost',100),
    jsonb_build_object('product_id','e1000000-0000-0000-0000-000000000002','to_location_id','30000000-0000-0000-0000-000000000002','quantity',5,'unit_cost',140),
    jsonb_build_object('product_id','e1000000-0000-0000-0000-000000000003','to_location_id','30000000-0000-0000-0000-000000000002','quantity',10,'unit_cost',35),
    jsonb_build_object('product_id','e1000000-0000-0000-0000-000000000004','to_location_id','30000000-0000-0000-0000-000000000002','quantity',5,'unit_cost',65),
    jsonb_build_object('product_id','e1000000-0000-0000-0000-000000000005','to_location_id','30000000-0000-0000-0000-000000000002','quantity',5,'unit_cost',75)
  ));
  $$,
  'Stock opened for all PC components'
);

-- Create PC build project
select lives_ok(
  $$
  insert into e_test_ids(kind, id)
  select 'pc_project', erp.create_pc_build_project(
    '20000000-0000-0000-0000-000000000001'::uuid,
    'c2000000-0000-0000-0000-000000000001'::uuid,
    'PC Gamer Ryz 5 5600',
    'Armado a medida para cliente',
    'pc-proj-01',
    'Creación de proyecto'
  );
  $$,
  'PC build project created'
);

-- TEST FINDING H17: create_pc_build_revision with multiple components matching compatibility rules
select lives_ok(
  $$
  insert into e_test_ids(kind, id)
  select 'pc_revision', erp.create_pc_build_revision(
    (select id from e_test_ids where kind = 'pc_project'),
    '86300000-0000-0000-0000-000000000001'::uuid,
    '86400000-0000-0000-0000-000000000001'::uuid,
    '{"form_factor":"ATX","cooling":"air"}'::jsonb,
    jsonb_build_array(
      jsonb_build_object('slot_code','motherboard','product_id','e1000000-0000-0000-0000-000000000001','quantity',1,'specifications',jsonb_build_object('socket','AM4','memory_type','DDR4','form_factor','mATX')),
      jsonb_build_object('slot_code','cpu','product_id','e1000000-0000-0000-0000-000000000002','quantity',1,'specifications',jsonb_build_object('socket','AM4','recommended_psu_watts',500)),
      jsonb_build_object('slot_code','memory','product_id','e1000000-0000-0000-0000-000000000003','quantity',1,'specifications',jsonb_build_object('memory_type','DDR4','capacity_gb',16)),
      jsonb_build_object('slot_code','storage','product_id','e1000000-0000-0000-0000-000000000004','quantity',1,'specifications',jsonb_build_object('interface','M.2 NVMe','capacity_gb',1000)),
      jsonb_build_object('slot_code','power_supply','product_id','e1000000-0000-0000-0000-000000000005','quantity',1,'specifications',jsonb_build_object('watts',650,'efficiency','80 Plus Bronze'))
    ),
    'pc-rev-01',
    'Revisión inicial con componentes completos'
  );
  $$,
  'H17 Verification: PC build revision created cleanly without variable ambiguity'
);

-- Check components count and frozen costs
select is(
  (select count(*)::int from erp.pc_build_components where revision_id = (select id from e_test_ids where kind = 'pc_revision')),
  5,
  '5 components created in revision'
);

-- Compatibility run
select lives_ok(
  $$
  insert into e_test_ids(kind, id)
  select 'comp_run', erp.record_pc_compatibility_run(
    (select id from e_test_ids where kind = 'pc_revision'),
    'pc-comp-01',
    'Chequeo de compatibilidad inicial'
  );
  $$,
  'Compatibility run executed'
);

select is(
  (select outcome from erp.pc_compatibility_runs where id = (select id from e_test_ids where kind = 'comp_run')),
  'pass'::erp.pc_compatibility_outcome,
  'Compatibility check outcome is pass'
);

-- Reserve components
select lives_ok(
  $$
  insert into e_test_ids(kind, id)
  select 'reservation_batch', erp.reserve_pc_build_components(
    (select id from e_test_ids where kind = 'pc_project'),
    (select id from e_test_ids where kind = 'pc_revision'),
    now() + interval '2 days',
    jsonb_build_array(
      jsonb_build_object('product_id','e1000000-0000-0000-0000-000000000001','location_id','30000000-0000-0000-0000-000000000002','quantity',1),
      jsonb_build_object('product_id','e1000000-0000-0000-0000-000000000002','location_id','30000000-0000-0000-0000-000000000002','quantity',1),
      jsonb_build_object('product_id','e1000000-0000-0000-0000-000000000003','location_id','30000000-0000-0000-0000-000000000002','quantity',1),
      jsonb_build_object('product_id','e1000000-0000-0000-0000-000000000004','location_id','30000000-0000-0000-0000-000000000002','quantity',1),
      jsonb_build_object('product_id','e1000000-0000-0000-0000-000000000005','location_id','30000000-0000-0000-0000-000000000002','quantity',1)
    ),
    'pc-res-01',
    'Reserva de componentes para armado'
  );
  $$,
  'Components reserved successfully'
);

-- Record final test run
select lives_ok(
  $$
  select erp.record_pc_test_run(
    (select id from e_test_ids where kind = 'pc_revision'),
    '86600000-0000-0000-0000-000000000001'::uuid,
    jsonb_build_array(
      jsonb_build_object('item_key','post','result','pass','value',jsonb_build_object('post_time_ms',12000)),
      jsonb_build_object('item_key','memory','result','pass','value',jsonb_build_object('memtest','ok','cycles',2)),
      jsonb_build_object('item_key','storage','result','pass','value',jsonb_build_object('smart_status','healthy')),
      jsonb_build_object('item_key','thermal','result','pass','value',jsonb_build_object('max_temp_c',68))
    ),
    'Pruebas de estrés y POST 100% aprobadas',
    'pc-test-run-01'
  );
  $$,
  'PC final test run recorded with all passing items'
);

-- Complete PC build
select lives_ok(
  $$
  select erp.complete_pc_build(
    (select id from e_test_ids where kind = 'pc_project'),
    (select id from e_test_ids where kind = 'pc_revision'),
    (select id from e_test_ids where kind = 'reservation_batch'),
    'NT-BUILD-2026-0001',
    '{"warranty_months":12,"coverage":"hardware"}'::jsonb,
    'pc-complete-01',
    'Armado completado y listo para entrega'
  );
  $$,
  'PC build completed successfully'
);

-- Check overview view for completed project
select is(
  (select current_state from erp.pc_build_projects_overview where id = (select id from e_test_ids where kind = 'pc_project')),
  'completed'::erp.pc_build_state,
  'PC project overview current_state is completed'
);

select is(
  (select built_serial_number from erp.pc_build_projects_overview where id = (select id from e_test_ids where kind = 'pc_project')),
  'NT-BUILD-2026-0001',
  'PC project overview reflects built serial number'
);

-- 7. Test atomic PC build wrapper helper
select lives_ok(
  $$
  select erp.create_pc_build_atomic(
    '20000000-0000-0000-0000-000000000001'::uuid,
    'c2000000-0000-0000-0000-000000000001'::uuid,
    'PC Oficina Atomic Test',
    'Notas del proyecto atomic',
    jsonb_build_array(
      jsonb_build_object('slot_code','motherboard','product_id','e1000000-0000-0000-0000-000000000001','quantity',1,'specifications',jsonb_build_object('socket','AM4','memory_type','DDR4','form_factor','mATX')),
      jsonb_build_object('slot_code','cpu','product_id','e1000000-0000-0000-0000-000000000002','quantity',1,'specifications',jsonb_build_object('socket','AM4','recommended_psu_watts',500)),
      jsonb_build_object('slot_code','memory','product_id','e1000000-0000-0000-0000-000000000003','quantity',1,'specifications',jsonb_build_object('memory_type','DDR4','capacity_gb',16)),
      jsonb_build_object('slot_code','storage','product_id','e1000000-0000-0000-0000-000000000004','quantity',1,'specifications',jsonb_build_object('interface','M.2 NVMe','capacity_gb',1000)),
      jsonb_build_object('slot_code','power_supply','product_id','e1000000-0000-0000-0000-000000000005','quantity',1,'specifications',jsonb_build_object('watts',650,'efficiency','80 Plus Bronze'))
    )
  );
  $$,
  'Helper erp.create_pc_build_atomic creates project, revision, and compatibility run in one shot'
);

select * from finish();
rollback;
