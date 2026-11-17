-- Verifies POS sale and local fiscal/non-fiscal invoice issuance are atomic
-- and independent of fiscal points, ARCA requests and integration outbox.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '86000000-0000-0000-0000-000000000098',
  'authenticated', 'authenticated', 'pos-invoice-test@nictech.local', 'not-used', now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"POS invoice test"}'::jsonb, now(), now()
);

update erp.profiles
set organization_id = '10000000-0000-0000-0000-000000000001'
where id = '86000000-0000-0000-0000-000000000098';

insert into erp.profile_roles (organization_id, profile_id, role_id, created_by)
values (
  '10000000-0000-0000-0000-000000000001',
  '86000000-0000-0000-0000-000000000098',
  '40000000-0000-0000-0000-000000000001',
  '86000000-0000-0000-0000-000000000098'
) on conflict do nothing;

-- Local numbering must not require a configured or active ARCA point.
update erp.fiscal_points
set is_active = false
where organization_id = '10000000-0000-0000-0000-000000000001'
  and branch_id = '20000000-0000-0000-0000-000000000001';

select set_config('request.jwt.claim.sub', '86000000-0000-0000-0000-000000000098', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

create temporary table _invoice_ctx as
select
  '20000000-0000-0000-0000-000000000001'::uuid as branch_id,
  '30000000-0000-0000-0000-000000000001'::uuid as location_id,
  '82000000-0000-0000-0000-000000000001'::uuid as cash_method_id,
  erp.get_or_create_exchange_snapshot('ARS') as snapshot_id,
  erp.get_or_create_pos_customer('POS invoice test customer') as customer_id;

create temporary table _invoice_product as
select (erp.create_catalog_product_with_variants(
  'PROD-LOCAL-INVOICE-01',
  'Producto para comprobante local',
  'product'::erp.catalog_item_kind,
  'quantity'::erp.inventory_tracking_mode,
  null, null, null, null,
  100, 250, 0,
  '[]'::jsonb
)->>'product_id')::uuid as product_id;

select erp.post_stock_document(
  'opening',
  (select branch_id from _invoice_ctx),
  'op-local-invoice-stock',
  'Stock de prueba para emisión local',
  jsonb_build_array(jsonb_build_object(
    'product_id', (select product_id from _invoice_product),
    'to_location_id', (select location_id from _invoice_ctx),
    'quantity', 4,
    'unit_cost', 100
  ))
);

-- The app's local E2E intentionally leaves append-only sale/document history.
-- Capture the current per-kind document and counter baselines so this contract
-- remains repeatable against a populated developer database.
reset role;
create temporary table _invoice_counter_baseline as
select kinds.invoice_kind,
  coalesce(max(case kinds.invoice_kind
    when 'fiscal' then substring(document_row.document_number from 3)::numeric
    else substring(document_row.document_number from 4)::numeric
  end), 0)::bigint as document_max,
  coalesce((
    select counter_row.last_number
    from erp.document_counters counter_row
    where counter_row.organization_id = '10000000-0000-0000-0000-000000000001'
      and counter_row.branch_id = '20000000-0000-0000-0000-000000000001'
      and counter_row.invoice_kind = kinds.invoice_kind
  ), 0)::bigint as counter_last
from (values ('fiscal'::text), ('non_fiscal'::text)) kinds(invoice_kind)
left join erp.documents document_row
  on document_row.organization_id = '10000000-0000-0000-0000-000000000001'
  and document_row.branch_id = '20000000-0000-0000-0000-000000000001'
  and document_row.document_number ~ case kinds.invoice_kind
    when 'fiscal' then '^F-[0-9]{1,19}$'
    else '^NF-[0-9]{1,19}$'
  end
group by kinds.invoice_kind;
grant select on _invoice_counter_baseline to authenticated;
set local role authenticated;

select has_column('erp', 'documents', 'invoice_kind', 'Documents persist fiscal/non-fiscal local invoice kind');
select has_table('erp', 'document_counters', 'Internal invoice counters exist independently');
select has_function(
  'erp',
  'create_sale_with_invoice',
  array['uuid','uuid','text','uuid','text','text','jsonb','text','jsonb','uuid'],
  'Internal POS invoice command exists'
);
select is(
  has_function_privilege('service_role', 'erp.create_sale_with_invoice(uuid,uuid,text,uuid,text,text,jsonb,text,jsonb,uuid)', 'EXECUTE'),
  false,
  'Service role cannot invoke the checked POS invoice command directly'
);
select is(
  has_function_privilege('authenticated', 'erp.create_sale_with_invoice(uuid,uuid,text,uuid,text,text,jsonb,text,jsonb,uuid)', 'EXECUTE'),
  true,
  'Authenticated actors can issue local POS invoices'
);
select is(
  has_function_privilege('authenticated', 'erp.issue_invoice_document(uuid,uuid,uuid,text,text,jsonb,text,text,text)', 'EXECUTE'),
  false,
  'Internal invoice document helper is not directly callable by authenticated users'
);

create temporary table _fiscal_invoice as
select erp.create_sale_with_invoice(
  (select branch_id from _invoice_ctx),
  (select customer_id from _invoice_ctx),
  'ARS',
  (select snapshot_id from _invoice_ctx),
  'op-local-fiscal-invoice-01',
  'Venta de prueba fiscal local',
  jsonb_build_array(jsonb_build_object(
    'kind', 'product',
    'product_id', (select product_id from _invoice_product),
    'from_location_id', (select location_id from _invoice_ctx),
    'description', 'Producto para comprobante local',
    'quantity', 1,
    'unit_price', 250,
    'expected_unit_price', 250,
    'discount_amount', 0,
    'tax_rate_percent', 0,
    'tax_amount', 0
  )),
  'fiscal',
  '[]'::jsonb
) as result;

select ok(
  (select result->>'invoice_kind' = 'fiscal' and result ? 'sale_id' and result ? 'document_id' from _fiscal_invoice),
  'Fiscal invoice is emitted inside the ERP without an ARCA request'
);
select is(
  (select result->>'document_number' from _fiscal_invoice),
  (select 'F-' || case when length((document_max + 1)::text) < 8 then lpad((document_max + 1)::text, 8, '0') else (document_max + 1)::text end from _invoice_counter_baseline where invoice_kind = 'fiscal'),
  'Fiscal invoice uses the next local number after existing history'
);
select is(
  (select invoice_kind from erp.documents where id = ((select result->>'document_id' from _fiscal_invoice))::uuid),
  'fiscal',
  'Fiscal invoice kind is persisted'
);
select is(
  (select count(*) from erp.fiscal_requests where document_id = ((select result->>'document_id' from _fiscal_invoice))::uuid),
  0::bigint,
  'Local fiscal issuance creates no provider request'
);
select is(
  (select count(*)
   from erp.integration_outbox outbox_row
   join erp.fiscal_requests request_row on request_row.id = outbox_row.aggregate_id
   where outbox_row.event_type = 'fiscal.issue.requested'
     and request_row.document_id = ((select result->>'document_id' from _fiscal_invoice))::uuid),
  0::bigint,
  'Local fiscal issuance creates no fiscal outbox event'
);

create temporary table _non_fiscal_invoice as
select erp.create_sale_with_invoice(
  (select branch_id from _invoice_ctx),
  (select customer_id from _invoice_ctx),
  'ARS',
  (select snapshot_id from _invoice_ctx),
  'op-local-non-fiscal-invoice-01',
  'Venta de prueba no fiscal local',
  jsonb_build_array(jsonb_build_object(
    'kind', 'product',
    'product_id', (select product_id from _invoice_product),
    'from_location_id', (select location_id from _invoice_ctx),
    'description', 'Producto para comprobante local',
    'quantity', 1,
    'unit_price', 250,
    'expected_unit_price', 250,
    'discount_amount', 0,
    'tax_rate_percent', 0,
    'tax_amount', 0
  )),
  'non_fiscal',
  '[]'::jsonb
) as result;

select ok(
  (select result->>'invoice_kind' = 'non_fiscal' and result ? 'sale_id' and result ? 'document_id' from _non_fiscal_invoice),
  'Non-fiscal invoice is emitted inside the ERP'
);
select is(
  (select result->>'document_number' from _non_fiscal_invoice),
  (select 'NF-' || case when length((document_max + 1)::text) < 8 then lpad((document_max + 1)::text, 8, '0') else (document_max + 1)::text end from _invoice_counter_baseline where invoice_kind = 'non_fiscal'),
  'Non-fiscal invoice uses the next number in its independent local sequence'
);
select is(
  (select invoice_kind from erp.documents where id = ((select result->>'document_id' from _non_fiscal_invoice))::uuid),
  'non_fiscal',
  'Non-fiscal invoice kind is persisted'
);
select is(
  (select count(*) from erp.fiscal_requests where document_id = ((select result->>'document_id' from _non_fiscal_invoice))::uuid),
  0::bigint,
  'Non-fiscal issuance creates no provider request'
);
select is(
  (select count(*)
   from erp.integration_outbox outbox_row
   join erp.fiscal_requests request_row on request_row.id = outbox_row.aggregate_id
   where outbox_row.event_type = 'fiscal.issue.requested'
     and request_row.document_id = ((select result->>'document_id' from _non_fiscal_invoice))::uuid),
  0::bigint,
  'Non-fiscal issuance creates no fiscal outbox event'
);

select is(
  (select erp.create_sale_with_invoice(
    (select branch_id from _invoice_ctx),
    (select customer_id from _invoice_ctx),
    'ARS',
    (select snapshot_id from _invoice_ctx),
    'op-local-fiscal-invoice-01',
    'Venta de prueba fiscal local',
    jsonb_build_array(jsonb_build_object(
      'kind', 'product',
      'product_id', (select product_id from _invoice_product),
      'from_location_id', (select location_id from _invoice_ctx),
      'description', 'Producto para comprobante local',
      'quantity', 1,
      'unit_price', 250,
    'expected_unit_price', 250,
      'discount_amount', 0,
      'tax_rate_percent', 0,
      'tax_amount', 0
    )),
    'fiscal',
    '[]'::jsonb
  )),
  (select result from _fiscal_invoice),
  'Identical retry returns the same local invoice and sale'
);

select has_function(
  'erp',
  'get_document_sale_receipts',
  array['uuid[]'],
  'Document workspace uses a permission-scoped receipt recovery RPC'
);
select ok(
  has_function_privilege('authenticated', 'erp.get_document_sale_receipts(uuid[])', 'EXECUTE')
    and not has_function_privilege('anon', 'erp.get_document_sale_receipts(uuid[])', 'EXECUTE')
    and not has_function_privilege('service_role', 'erp.get_document_sale_receipts(uuid[])', 'EXECUTE'),
  'Receipt recovery is callable only by authenticated document users'
);
select ok(
  not has_function_privilege('authenticated', 'erp.create_sale_with_fiscal_document(uuid,uuid,text,uuid,text,text,jsonb,jsonb,uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'erp.create_sale_with_fiscal_document(uuid,uuid,text,uuid,text,text,jsonb,jsonb,uuid)', 'EXECUTE')
    and not has_function_privilege('service_role', 'erp.create_sale_with_fiscal_document(uuid,uuid,text,uuid,text,text,jsonb,jsonb,uuid)', 'EXECUTE'),
  'Legacy POS fiscal RPC is revoked for every application role'
);
create temporary table _local_receipts as
select *
from erp.get_document_sale_receipts(array[
  ((select result->>'document_id' from _fiscal_invoice))::uuid,
  ((select result->>'document_id' from _non_fiscal_invoice))::uuid
]);
select ok(
  (select count(*) = 2
    and bool_and(jsonb_array_length(receipt->'lines') = 1)
    and bool_and(receipt ? 'total_amount' and receipt ? 'subtotal_amount' and receipt ? 'tax_amount')
    and bool_and(receipt ? 'customer_display_name' and receipt ? 'customer_legal_name')
    and bool_and(receipt ? 'branch_name' and jsonb_typeof(receipt->'payments') = 'array')
    and bool_and(receipt ? 'document_status' and receipt ? 'sale_state' and receipt ? 'payment_state')
    from _local_receipts),
  'Receipt recovery returns authoritative sale lines, totals, branch, payments and distinct states'
);
select throws_ok(
  $$select erp.request_fiscal_issuance(
    ((select result->>'document_id' from _fiscal_invoice))::uuid,
    '91400000-0000-0000-0000-000000000001',
    'FACTURA_B', 'local-fiscal-request-rejected', 'Local invoice has no provider authorization'
  )$$,
  '55000',
  'locally classified POS invoices cannot be sent for provider authorization',
  'Fiscal local POS classification cannot request authorization'
);
select throws_ok(
  $$select erp.request_fiscal_issuance(
    ((select result->>'document_id' from _non_fiscal_invoice))::uuid,
    '91400000-0000-0000-0000-000000000001',
    'FACTURA_B', 'local-non-fiscal-request-rejected', 'Non-fiscal local invoice cannot be authorized'
  )$$,
  '55000',
  'locally classified POS invoices cannot be sent for provider authorization',
  'Non-fiscal local POS classification cannot request authorization'
);

reset role;
select is(
  (select count(*) from erp.documents where id in (
    ((select result->>'document_id' from _fiscal_invoice))::uuid,
    ((select result->>'document_id' from _non_fiscal_invoice))::uuid
  ) and private_object_path is null),
  2::bigint,
  'Local invoices do not claim PDF objects that were never stored'
);
select is(
  (select last_number from erp.document_counters where organization_id = '10000000-0000-0000-0000-000000000001' and branch_id = '20000000-0000-0000-0000-000000000001' and invoice_kind = 'fiscal'),
  (select greatest(counter_last, document_max) + 1 from _invoice_counter_baseline where invoice_kind = 'fiscal'),
  'Fiscal counter advances once after the existing baseline despite idempotent retry'
);
select is(
  (select last_number from erp.document_counters where organization_id = '10000000-0000-0000-0000-000000000001' and branch_id = '20000000-0000-0000-0000-000000000001' and invoice_kind = 'non_fiscal'),
  (select greatest(counter_last, document_max) + 1 from _invoice_counter_baseline where invoice_kind = 'non_fiscal'),
  'Non-fiscal counter advances independently after the existing baseline'
);
select is(
  (select count(*) from erp.documents where id in (
    ((select result->>'document_id' from _fiscal_invoice))::uuid,
    ((select result->>'document_id' from _non_fiscal_invoice))::uuid
  )),
  2::bigint,
  'Fiscal and non-fiscal sales persist exactly one invoice each'
);
select is(
  (select count(*) from erp.fiscal_points where branch_id = '20000000-0000-0000-0000-000000000001' and is_active),
  0::bigint,
  'Invoices were issued while no active fiscal point was configured'
);

update erp.document_counters
set last_number = 99999999
where organization_id = '10000000-0000-0000-0000-000000000001'
  and branch_id = '20000000-0000-0000-0000-000000000001'
  and invoice_kind = 'fiscal';
set local role authenticated;
create temporary table _overflow_invoice as
select erp.create_sale_with_invoice(
  (select branch_id from _invoice_ctx),
  (select customer_id from _invoice_ctx),
  'ARS',
  (select snapshot_id from _invoice_ctx),
  'op-local-fiscal-invoice-overflow',
  'Venta de prueba con numeración extendida',
  jsonb_build_array(jsonb_build_object(
    'kind', 'product',
    'product_id', (select product_id from _invoice_product),
    'from_location_id', (select location_id from _invoice_ctx),
    'description', 'Producto para comprobante local',
    'quantity', 1,
    'unit_price', 250,
    'expected_unit_price', 250,
    'discount_amount', 0,
    'tax_rate_percent', 0,
    'tax_amount', 0
  )),
  'fiscal',
  '[]'::jsonb
) as result;
select is(
  (select result->>'document_number' from _overflow_invoice),
  'F-100000000',
  'Local invoice numbering grows beyond eight digits without truncation'
);
reset role;

select * from finish();
rollback;
