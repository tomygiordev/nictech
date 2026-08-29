begin;

create extension if not exists pgtap with schema extensions;

select plan(77);

select has_table('erp', 'inventory_units', 'Serialized inventory units exist');
select has_table('erp', 'stock_documents', 'Stock documents exist');
select has_table('erp', 'stock_document_lines', 'Stock document lines exist');
select has_table('erp', 'stock_movements', 'Immutable stock movements exist');
select has_table('erp', 'stock_balances', 'Location stock balances exist');
select has_table('erp', 'stock_reservation_batches', 'Reservation batches exist');
select has_table('erp', 'stock_reservations', 'Reservation lines exist');
select has_table('erp', 'inventory_counts', 'Physical inventory sessions exist');
select has_table('erp', 'inventory_count_lines', 'Physical inventory lines exist');

select has_function(
  'erp',
  'post_stock_document',
  array['erp.stock_document_kind', 'uuid', 'text', 'text', 'jsonb', 'boolean', 'text', 'uuid'],
  'Transactional stock posting command exists'
);
select has_function(
  'erp',
  'create_stock_reservation',
  array['uuid', 'text', 'text', 'uuid', 'timestamp with time zone', 'jsonb'],
  'Transactional stock reservation command exists'
);
select has_function(
  'erp',
  'fulfill_stock_reservation',
  array['uuid', 'text', 'text'],
  'Transactional reservation fulfillment command exists'
);
select has_function(
  'erp',
  'reverse_stock_document',
  array['uuid', 'text', 'text'],
  'Append-only stock reversal command exists'
);
select has_function(
  'erp',
  'expire_stock_reservations',
  array['uuid', 'integer'],
  'Bounded reservation expiry command exists'
);
select has_function(
  'erp',
  'get_inventory_unit_identifiers',
  array['uuid'],
  'Audited inventory identifier reader exists'
);
select has_function(
  'erp',
  'register_inventory_unit',
  array['uuid', 'uuid', 'text', 'text', 'numeric'],
  'Serialized-unit registration command exists'
);
select is(
  has_function_privilege(
    'service_role',
    'erp.post_stock_document(erp.stock_document_kind,uuid,text,text,jsonb,boolean,text,uuid)',
    'EXECUTE'
  ),
  false,
  'Service role cannot execute stock posting as an unscoped actor'
);
select is(
  has_function_privilege(
    'service_role',
    'erp.create_stock_reservation(uuid,text,text,uuid,timestamptz,jsonb)',
    'EXECUTE'
  ),
  false,
  'Service role cannot create reservations as an unscoped actor'
);
select is(
  has_function_privilege('service_role', 'erp.release_stock_reservation(uuid,text)', 'EXECUTE'),
  false,
  'Service role cannot release reservations as an unscoped actor'
);
select is(
  has_function_privilege('authenticated', 'erp.reverse_stock_document(uuid,text,text)', 'EXECUTE'),
  true,
  'Authenticated actors may invoke the permission-checked reversal command'
);
select is(
  has_column_privilege('authenticated', 'erp.inventory_units', 'serial_number', 'SELECT'),
  false,
  'General stock readers cannot select raw serial numbers'
);
select is(
  has_table_privilege('service_role', 'erp.stock_movements', 'TRIGGER'),
  false,
  'Service role cannot attach triggers to the stock ledger'
);
select is(
  has_table_privilege('service_role', 'erp.stock_movements', 'REFERENCES'),
  false,
  'Service role cannot create references against the stock ledger'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'erp.stock_movements'::regclass),
  'Stock movements enforce RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'erp.stock_balances'::regclass),
  'Stock balances enforce RLS'
);
select is(
  has_table_privilege('authenticated', 'erp.stock_balances', 'UPDATE'),
  false,
  'Authenticated clients cannot update stock balances directly'
);
select is(
  has_table_privilege('service_role', 'erp.stock_balances', 'UPDATE'),
  false,
  'Service clients cannot bypass stock commands with direct balance updates'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'erp.inventory_units'::regclass
      and conname = 'inventory_units_status_location'
  ),
  'Serialized unit status and location combinations are constrained'
);
select has_column('erp', 'stock_documents', 'request_hash', 'Stock idempotency binds the original request');
select has_column('erp', 'stock_reservation_batches', 'request_hash', 'Reservation idempotency binds the original request');
select has_index('erp', 'stock_documents', 'stock_documents_reversal_unique', 'A document can only be reversed once');
select ok(
  exists (
    select 1 from erp.permissions
    where code = 'users.assign_sensitive' and is_sensitive and is_active
  ),
  'Sensitive grants require a dedicated permission'
);

insert into erp.products (
  id,
  organization_id,
  product_type_id,
  item_kind,
  unit_id,
  internal_code,
  internal_name,
  inventory_tracking
) values (
  '71000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001',
  'product',
  '50000000-0000-0000-0000-000000000001',
  'TEST-LEDGER-1',
  'Producto de prueba ledger',
  'quantity'
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '70000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'ledger-test@nictech.local',
  'not-used',
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Ledger Test"}'::jsonb,
  now(),
  now()
);

update erp.profiles
set organization_id = '10000000-0000-0000-0000-000000000001'
where id = '70000000-0000-0000-0000-000000000001';

insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000001'
);

select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$
    select erp.post_stock_document(
      'opening',
      '20000000-0000-0000-0000-000000000001',
      'test-receipt-1',
      'Initial test receipt',
      jsonb_build_array(jsonb_build_object(
        'product_id', '71000000-0000-0000-0000-000000000001',
        'to_location_id', '30000000-0000-0000-0000-000000000002',
        'quantity', 10,
        'unit_cost', 25
      )),
      false
    )
  $$,
  'A permitted opening posts atomically'
);

select erp.post_stock_document(
  'opening',
  '20000000-0000-0000-0000-000000000001',
  'test-receipt-1',
  'Initial test receipt',
  jsonb_build_array(jsonb_build_object(
    'product_id', '71000000-0000-0000-0000-000000000001',
    'to_location_id', '30000000-0000-0000-0000-000000000002',
    'quantity', 10,
    'unit_cost', 25
  )),
  false
);

select is(
  (select count(*) from erp.stock_documents where idempotency_key = 'test-receipt-1'),
  1::bigint,
  'Retrying the same opening does not duplicate its document'
);
select is(
  (
    select quantity_on_hand
    from erp.stock_balances
    where product_id = '71000000-0000-0000-0000-000000000001'
      and location_id = '30000000-0000-0000-0000-000000000002'
  ),
  10::numeric,
  'Opening increases on-hand stock once'
);

select lives_ok(
  $$
    select erp.create_stock_reservation(
      '20000000-0000-0000-0000-000000000001',
      'test-reservation-1',
      'sale',
      '73000000-0000-0000-0000-000000000001',
      now() + interval '30 minutes',
      jsonb_build_array(jsonb_build_object(
        'location_id', '30000000-0000-0000-0000-000000000002',
        'product_id', '71000000-0000-0000-0000-000000000001',
        'quantity', 4
      ))
    )
  $$,
  'Available stock can be reserved atomically'
);
select is(
  (
    select quantity_reserved
    from erp.stock_balances
    where product_id = '71000000-0000-0000-0000-000000000001'
      and location_id = '30000000-0000-0000-0000-000000000002'
  ),
  4::numeric,
  'Reservation separates reserved stock from available stock'
);

select lives_ok(
  $$
    select erp.fulfill_stock_reservation(
      (select id from erp.stock_reservation_batches where idempotency_key = 'test-reservation-1'),
      'test-fulfillment-1',
      'Approved test order'
    )
  $$,
  'Reservation fulfillment consumes the exact reservation atomically'
);
select is(
  (
    select quantity_on_hand
    from erp.stock_balances
    where product_id = '71000000-0000-0000-0000-000000000001'
      and location_id = '30000000-0000-0000-0000-000000000002'
  ),
  6::numeric,
  'Fulfillment decrements on-hand stock'
);
select is(
  (
    select quantity_reserved
    from erp.stock_balances
    where product_id = '71000000-0000-0000-0000-000000000001'
      and location_id = '30000000-0000-0000-0000-000000000002'
  ),
  0::numeric,
  'Fulfillment releases the reserved balance'
);
select is(
  (select status::text from erp.stock_reservation_batches where idempotency_key = 'test-reservation-1'),
  'fulfilled',
  'Fulfilled reservation records its terminal state'
);
select is(
  (select count(*) from erp.stock_movements where product_id = '71000000-0000-0000-0000-000000000001'),
  2::bigint,
  'Receipt and fulfillment each append one ledger movement'
);

select throws_ok(
  $$
    select erp.post_stock_document(
      'reservation_fulfillment',
      '20000000-0000-0000-0000-000000000001',
      'invalid-generic-fulfillment',
      'Must use reservation command',
      '[{"product_id":"71000000-0000-0000-0000-000000000001","from_location_id":"30000000-0000-0000-0000-000000000002","quantity":1}]'::jsonb
    )
  $$,
  '22023',
  'use fulfill_stock_reservation for reserved stock',
  'Generic stock posting rejects reservation fulfillment'
);

select throws_ok(
  $$
    select erp.post_stock_document(
      'sale',
      '20000000-0000-0000-0000-000000000001',
      'oversell-test',
      'Must reject oversell',
      '[{"product_id":"71000000-0000-0000-0000-000000000001","from_location_id":"30000000-0000-0000-0000-000000000002","quantity":7}]'::jsonb,
      false,
      'test_sale',
      '74000000-0000-0000-0000-000000000001'
    )
  $$,
  '23514',
  'insufficient available stock on line 1',
  'Stock cannot be oversold without explicit override'
);

select lives_ok(
  $$
    select erp.reverse_stock_document(
      (select id from erp.stock_documents where idempotency_key = 'test-fulfillment-1'),
      'test-fulfillment-reversal-1',
      'Approved test cancellation'
    )
  $$,
  'A posted fulfillment can be reversed with an inverse document'
);
select is(
  (
    select quantity_on_hand
    from erp.stock_balances
    where product_id = '71000000-0000-0000-0000-000000000001'
      and location_id = '30000000-0000-0000-0000-000000000002'
  ),
  10::numeric,
  'Reversal restores the exact on-hand quantity'
);
select is(
  (select status::text from erp.stock_documents where idempotency_key = 'test-fulfillment-reversal-1'),
  'reversed',
  'Reversal document is explicitly marked as reversed'
);
select is(
  (
    select reversed_document_id
    from erp.stock_documents
    where idempotency_key = 'test-fulfillment-reversal-1'
  ),
  (select id from erp.stock_documents where idempotency_key = 'test-fulfillment-1'),
  'Reversal document points to its immutable original'
);
select is(
  (select count(*) from erp.stock_movements where product_id = '71000000-0000-0000-0000-000000000001'),
  3::bigint,
  'Reversal appends one inverse movement without deleting history'
);
select throws_ok(
  $$select erp.reverse_stock_document(
    (select id from erp.stock_documents where idempotency_key = 'test-fulfillment-1'),
    'test-fulfillment-reversal-1',
    'A different cancellation reason'
  )$$,
  '23000',
  'stock reversal retry does not match the original request',
  'Reversal retries must match the complete original request'
);

insert into erp.products (
  id, organization_id, product_type_id, item_kind, unit_id,
  internal_code, internal_name, inventory_tracking
) values (
  '71000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000002',
  'product',
  '50000000-0000-0000-0000-000000000001',
  'TEST-SERIAL-1',
  'Producto serializado de prueba',
  'serial'
);

select lives_ok(
  $$select erp.register_inventory_unit(
    '71000000-0000-0000-0000-000000000002', null, 'SER-0001', null, 50
  )$$,
  'A serialized unit can be registered in quarantine'
);
select is(
  (select status::text from erp.inventory_units where product_id = '71000000-0000-0000-0000-000000000002'),
  'quarantine',
  'New serialized units start in quarantine'
);
select throws_ok(
  $$select erp.register_inventory_unit(
    '71000000-0000-0000-0000-000000000002', null, '  ', null, 0
  )$$,
  '23514',
  'serial-tracked products require a serial number',
  'Blank serialized identities are rejected'
);
select lives_ok(
  $$
    select erp.post_stock_document(
      'opening',
      '20000000-0000-0000-0000-000000000001',
      'test-serial-receipt-1',
      'Receive serialized test unit',
      jsonb_build_array(jsonb_build_object(
        'product_id', '71000000-0000-0000-0000-000000000002',
        'inventory_unit_id', (
          select id from erp.inventory_units
          where product_id = '71000000-0000-0000-0000-000000000002'
        ),
        'to_location_id', '30000000-0000-0000-0000-000000000002',
        'quantity', 1,
        'unit_cost', 50
      )),
      false
    )
  $$,
  'A quarantined serialized unit can be opened atomically'
);
select is(
  (select status::text from erp.inventory_units where product_id = '71000000-0000-0000-0000-000000000002'),
  'available',
  'Opening makes the serialized unit available'
);
select lives_ok(
  $$select * from erp.get_inventory_unit_identifiers(
    (select id from erp.inventory_units where product_id = '71000000-0000-0000-0000-000000000002')
  )$$,
  'Authorized identifier reads use the audited RPC'
);
select ok(
  exists (
    select 1 from erp.audit_events
    where table_name = 'inventory_units'
      and action = 'read_sensitive'
      and record_id = (
        select id::text from erp.inventory_units
        where product_id = '71000000-0000-0000-0000-000000000002'
      )
  ),
  'Serialized identifier reads create a sensitive-read audit event'
);
select lives_ok(
  $$
    select erp.create_stock_reservation(
      '20000000-0000-0000-0000-000000000001',
      'test-serial-reservation-1',
      'sale',
      '73000000-0000-0000-0000-000000000002',
      now() + interval '30 minutes',
      jsonb_build_array(jsonb_build_object(
        'location_id', '30000000-0000-0000-0000-000000000002',
        'product_id', '71000000-0000-0000-0000-000000000002',
        'inventory_unit_id', (
          select id from erp.inventory_units
          where product_id = '71000000-0000-0000-0000-000000000002'
        ),
        'quantity', 1
      ))
    )
  $$,
  'Available serialized stock can be reserved'
);
select is(
  (select status::text from erp.inventory_units where product_id = '71000000-0000-0000-0000-000000000002'),
  'reserved',
  'Serialized reservation marks the exact unit reserved'
);
select lives_ok(
  $$select erp.release_stock_reservation(
    (select id from erp.stock_reservation_batches where idempotency_key = 'test-serial-reservation-1'),
    'Cancelled serialized test sale'
  )$$,
  'A serialized reservation can be released'
);
select is(
  (select status::text from erp.inventory_units where product_id = '71000000-0000-0000-0000-000000000002'),
  'available',
  'Releasing a serialized reservation restores unit availability'
);

select lives_ok(
  $$select erp.reverse_stock_document(
    (select id from erp.stock_documents where idempotency_key = 'test-serial-receipt-1'),
    'test-serial-receipt-reversal-1',
    'Undo serialized test receipt'
  )$$,
  'A serialized receipt can be reversed append-only'
);
select is(
  (select status::text from erp.inventory_units where product_id = '71000000-0000-0000-0000-000000000002'),
  'quarantine',
  'Serialized reversal restores the exact prior unit status'
);
select ok(
  (select current_location_id is null from erp.inventory_units where product_id = '71000000-0000-0000-0000-000000000002'),
  'Serialized reversal restores the exact prior location'
);
reset role;
select is(
  (
    select line.unit_status_after::text
    from erp.stock_document_lines line
    join erp.stock_documents document on document.id = line.document_id
    where document.idempotency_key = 'test-serial-receipt-reversal-1'
  ),
  'quarantine',
  'Reversal history records the restored serialized state'
);
set local role authenticated;

select erp.post_stock_document(
    'opening',
  '20000000-0000-0000-0000-000000000001',
  'test-serial-receipt-2',
  'Receive serialized unit for fulfillment reversal',
  jsonb_build_array(jsonb_build_object(
    'product_id', '71000000-0000-0000-0000-000000000002',
    'inventory_unit_id', (
      select id from erp.inventory_units
      where product_id = '71000000-0000-0000-0000-000000000002'
    ),
    'to_location_id', '30000000-0000-0000-0000-000000000002',
    'quantity', 1,
    'unit_cost', 50
  )),
    false
);
select erp.create_stock_reservation(
  '20000000-0000-0000-0000-000000000001',
  'test-serial-fulfillment-reservation',
  'sale',
  '73000000-0000-0000-0000-000000000004',
  now() + interval '30 minutes',
  jsonb_build_array(jsonb_build_object(
    'location_id', '30000000-0000-0000-0000-000000000002',
    'product_id', '71000000-0000-0000-0000-000000000002',
    'inventory_unit_id', (
      select id from erp.inventory_units
      where product_id = '71000000-0000-0000-0000-000000000002'
    ),
    'quantity', 1
  ))
);
select erp.fulfill_stock_reservation(
  (select id from erp.stock_reservation_batches where idempotency_key = 'test-serial-fulfillment-reservation'),
  'test-serial-fulfillment',
  'Fulfill serialized unit before cancellation'
);
select lives_ok(
  $$select erp.reverse_stock_document(
    (select id from erp.stock_documents where idempotency_key = 'test-serial-fulfillment'),
    'test-serial-fulfillment-reversal',
    'Cancel fulfilled serialized sale'
  )$$,
  'Serialized fulfillment cancellation reverses atomically'
);
select is(
  (select status::text from erp.inventory_units where product_id = '71000000-0000-0000-0000-000000000002'),
  'available',
  'Fulfillment reversal returns the serialized unit to available stock'
);
select is(
  (select current_location_id from erp.inventory_units where product_id = '71000000-0000-0000-0000-000000000002'),
  '30000000-0000-0000-0000-000000000002'::uuid,
  'Fulfillment reversal returns the serialized unit to its stock location'
);
select is(
  (
    select status::text from erp.stock_reservation_batches
    where idempotency_key = 'test-serial-fulfillment-reservation'
  ),
  'fulfilled',
  'Fulfillment reversal does not revive the consumed reservation'
);
select is(
  (
    select quantity_reserved from erp.stock_balances
    where product_id = '71000000-0000-0000-0000-000000000002'
      and location_id = '30000000-0000-0000-0000-000000000002'
  ),
  0::numeric,
  'Fulfillment reversal leaves no orphan reserved balance'
);

select lives_ok(
  $$select erp.create_stock_reservation(
    '20000000-0000-0000-0000-000000000001',
    'test-expiring-reservation-1',
    'sale',
    '73000000-0000-0000-0000-000000000003',
    now() + interval '30 minutes',
    '[{"location_id":"30000000-0000-0000-0000-000000000002","product_id":"71000000-0000-0000-0000-000000000001","quantity":2}]'::jsonb
  )$$,
  'A reservation can be prepared for bounded expiry processing'
);

reset role;
update erp.stock_reservation_batches
set created_at = now() - interval '2 minutes',
    expires_at = now() - interval '1 minute'
where idempotency_key = 'test-expiring-reservation-1';
set local role authenticated;

select is(
  erp.expire_stock_reservations('20000000-0000-0000-0000-000000000001', 10),
  1,
  'Expiry processing claims and releases one eligible reservation'
);
select is(
  (select status::text from erp.stock_reservation_batches where idempotency_key = 'test-expiring-reservation-1'),
  'expired',
  'Expired reservations record their terminal state'
);
select is(
  (
    select quantity_reserved
    from erp.stock_balances
    where product_id = '71000000-0000-0000-0000-000000000001'
      and location_id = '30000000-0000-0000-0000-000000000002'
  ),
  0::numeric,
  'Expiry processing releases the reserved balance'
);
select throws_ok(
  $$select erp.expire_stock_reservations(
    '20000000-0000-0000-0000-000000000001', null
  )$$,
  '22023',
  'batch limit must be between 1 and 500',
  'Expiry processing rejects an unbounded null limit'
);

reset role;

select throws_ok(
  $$delete from erp.stock_movements where product_id = '71000000-0000-0000-0000-000000000001'$$,
  '23000',
  'erp.stock_movements records must be deactivated or reversed, not deleted',
  'Ledger movements cannot be deleted'
);
select ok(
  exists (
    select 1 from erp.audit_events
    where table_name = 'stock_documents'
      and new_values ->> 'idempotency_key' = 'test-receipt-1'
  ),
  'Posted stock documents create an audit event'
);

select * from finish();
rollback;
