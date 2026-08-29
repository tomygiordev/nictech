begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

select has_table('erp', 'customers', 'Customers table exists');
select has_table('erp', 'customer_private_details', 'Sensitive customer details are separated');
select has_table('erp', 'suppliers', 'Suppliers table exists');
select has_table('erp', 'product_types', 'Configurable product types exist');
select has_table('erp', 'products', 'Products and services table exists');
select has_table('erp', 'product_variants', 'Product variants table exists');
select has_table('erp', 'product_identifiers', 'Permanent product identifiers exist');

select has_function(
  'erp',
  'get_customer_private_details',
  array['uuid'],
  'Sensitive customer reads use an audited function'
);
select has_function(
  'erp',
  'upsert_customer_private_details',
  array['uuid', 'text', 'text', 'jsonb', 'text', 'boolean', 'timestamp with time zone'],
  'Sensitive customer writes use a permission-checked function'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'erp.customers'::regclass),
  'Customers enforce RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'erp.customer_private_details'::regclass),
  'Sensitive customer details enforce RLS'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'erp.products'::regclass),
  'Products enforce RLS'
);

select is(
  (select count(*) from erp.units_of_measure where organization_id = '10000000-0000-0000-0000-000000000001'),
  2::bigint,
  'Seed creates deterministic units of measure'
);
select is(
  (select count(*) from erp.product_types where organization_id = '10000000-0000-0000-0000-000000000001'),
  4::bigint,
  'Seed creates the initial product and service types'
);

select throws_ok(
  $$
    insert into erp.product_types (
      organization_id,
      code,
      name,
      item_kind,
      default_tracking_mode
    ) values (
      '10000000-0000-0000-0000-000000000001',
      'BAD-SERVICE',
      'Invalid service',
      'service',
      'quantity'
    )
  $$,
  '23514',
  null,
  'Services cannot use inventory tracking'
);

insert into erp.customers (
  id,
  organization_id,
  code,
  display_name
)
values (
  '71000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'TEST-CUSTOMER-001',
  'Test customer'
);

insert into erp.customer_private_details (
  organization_id,
  customer_id,
  tax_id,
  identity_document,
  address,
  internal_notes
)
values (
  '10000000-0000-0000-0000-000000000001',
  '71000000-0000-0000-0000-000000000001',
  '20-12345678-9',
  '12345678',
  '{"street": "Private 123"}'::jsonb,
  'Private note'
);

select ok(
  not exists (
    select 1
    from erp.audit_events
    where table_name = 'customer_private_details'
      and (
        new_values ? 'tax_id'
        or new_values ? 'identity_document'
        or new_values ? 'address'
        or new_values ? 'internal_notes'
      )
  ),
  'Sensitive customer values are redacted from audit payloads'
);

select is(
  has_table_privilege('authenticated', 'erp.customer_private_details', 'SELECT'),
  false,
  'Authenticated users cannot bypass audited sensitive reads'
);

insert into erp.products (
  id,
  organization_id,
  product_type_id,
  item_kind,
  unit_id,
  internal_code,
  internal_name,
  public_name,
  inventory_tracking,
  publish_on_web,
  allow_online_sale
)
values (
  '70000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '60000000-0000-0000-0000-000000000001',
  'product',
  '50000000-0000-0000-0000-000000000001',
  'TEST-PRODUCT-001',
  'Test product',
  'Test product',
  'quantity',
  true,
  true
);

select lives_ok(
  $$
    insert into erp.product_identifiers (
      organization_id,
      product_id,
      kind,
      value,
      is_primary
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      'barcode',
      ' 779 123 456 ',
      true
    )
  $$,
  'A product barcode can be registered'
);

select is(
  (
    select normalized_value
    from erp.product_identifiers
    where product_id = '70000000-0000-0000-0000-000000000001'
  ),
  '779123456',
  'Identifiers are normalized for scanner lookup'
);

select throws_ok(
  $$
    insert into erp.product_identifiers (
      organization_id,
      product_id,
      kind,
      value
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      'additional',
      '779123456'
    )
  $$,
  '23505',
  null,
  'Normalized identifiers are unique inside an organization'
);

select throws_ok(
  $$update erp.products set internal_code = 'REASSIGNED' where id = '70000000-0000-0000-0000-000000000001'$$,
  '23000',
  'product internal codes are permanent; deactivate the product instead',
  'Product codes cannot be recycled through reassignment'
);

select throws_ok(
  $$
    insert into erp.products (
      organization_id,
      product_type_id,
      item_kind,
      unit_id,
      internal_code,
      internal_name,
      inventory_tracking
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '60000000-0000-0000-0000-000000000001',
      'product',
      '50000000-0000-0000-0000-000000000001',
      ' test-product-001 ',
      'Duplicate normalized code',
      'quantity'
    )
  $$,
  '23505',
  null,
  'Product codes remain unique across case and surrounding whitespace'
);

select throws_ok(
  $$
    update erp.product_identifiers
    set value = 'OTHER-CODE'
    where product_id = '70000000-0000-0000-0000-000000000001'
  $$,
  '23000',
  'product identifiers are permanent; deactivate the identifier instead',
  'Identifiers cannot be recycled through reassignment'
);

select lives_ok(
  $$
    update erp.product_identifiers
    set is_active = false
    where product_id = '70000000-0000-0000-0000-000000000001'
  $$,
  'Identifiers can be deactivated without losing history'
);

select throws_ok(
  $$delete from erp.products where id = '70000000-0000-0000-0000-000000000001'$$,
  '23000',
  'erp.products records must be deactivated or reversed, not deleted',
  'Catalog products cannot be hard-deleted'
);

select throws_ok(
  $$
    insert into erp.products (
      organization_id,
      product_type_id,
      item_kind,
      unit_id,
      internal_code,
      internal_name,
      inventory_tracking,
      publish_on_web,
      allow_online_sale
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '60000000-0000-0000-0000-000000000001',
      'product',
      '50000000-0000-0000-0000-000000000001',
      'BAD-WEB-PRODUCT',
      'Invalid web product',
      'quantity',
      false,
      true
    )
  $$,
  '23514',
  null,
  'Online sale requires web publication'
);

select ok(
  exists (
    select 1
    from erp.audit_events
    where table_name = 'products'
      and record_id = '70000000-0000-0000-0000-000000000001'
      and action = 'insert'
  ),
  'Product creation is audited'
);

select is(
  has_table_privilege('anon', 'erp.products', 'SELECT'),
  false,
  'Anonymous users cannot read the internal catalog'
);

select * from finish();
rollback;
