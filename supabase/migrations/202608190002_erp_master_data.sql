create type erp.party_kind as enum ('person', 'business');
create type erp.catalog_item_kind as enum ('product', 'service');
create type erp.inventory_tracking_mode as enum ('none', 'quantity', 'serial', 'imei');
create type erp.service_price_mode as enum ('fixed', 'suggested', 'editable');
create type erp.zero_stock_behavior as enum ('hidden', 'out_of_stock', 'inquiry');
create type erp.identifier_kind as enum ('internal', 'manufacturer', 'barcode', 'additional');

create table erp.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  code text not null,
  kind erp.party_kind not null default 'person',
  display_name text not null,
  legal_name text,
  email text,
  phone text,
  whatsapp_phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint customers_code_not_blank check (btrim(code) <> ''),
  constraint customers_display_name_not_blank check (btrim(display_name) <> ''),
  constraint customers_id_organization_unique unique (id, organization_id),
  constraint customers_code_unique unique (organization_id, code)
);

create table erp.customer_private_details (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  customer_id uuid not null,
  tax_id text,
  identity_document text,
  address jsonb not null default '{}'::jsonb,
  internal_notes text,
  communication_consent boolean not null default false,
  consent_recorded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint customer_private_customer_fk foreign key (customer_id, organization_id)
    references erp.customers(id, organization_id) on delete restrict,
  constraint customer_private_customer_unique unique (customer_id),
  constraint customer_private_consent_time check (
    not communication_consent or consent_recorded_at is not null
  )
);

create unique index customer_private_tax_id_unique
  on erp.customer_private_details (organization_id, tax_id)
  where tax_id is not null and btrim(tax_id) <> '';

create unique index customer_private_identity_unique
  on erp.customer_private_details (organization_id, identity_document)
  where identity_document is not null and btrim(identity_document) <> '';

create table erp.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  code text not null,
  display_name text not null,
  legal_name text,
  tax_id text,
  email text,
  phone text,
  address jsonb not null default '{}'::jsonb,
  default_currency text not null default 'ARS' check (default_currency ~ '^[A-Z]{3}$'),
  payment_terms_days integer not null default 0 check (payment_terms_days >= 0),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint suppliers_code_not_blank check (btrim(code) <> ''),
  constraint suppliers_display_name_not_blank check (btrim(display_name) <> ''),
  constraint suppliers_id_organization_unique unique (id, organization_id),
  constraint suppliers_code_unique unique (organization_id, code)
);

create unique index suppliers_tax_id_unique
  on erp.suppliers (organization_id, tax_id)
  where tax_id is not null and btrim(tax_id) <> '';

create table erp.product_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  parent_id uuid,
  code text not null,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_categories_id_organization_unique unique (id, organization_id),
  constraint product_categories_parent_fk foreign key (parent_id, organization_id)
    references erp.product_categories(id, organization_id) on delete restrict,
  constraint product_categories_code_unique unique (organization_id, code),
  constraint product_categories_code_not_blank check (btrim(code) <> ''),
  constraint product_categories_name_not_blank check (btrim(name) <> ''),
  constraint product_categories_not_own_parent check (parent_id is null or parent_id <> id)
);

create table erp.brands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brands_id_organization_unique unique (id, organization_id),
  constraint brands_code_unique unique (organization_id, code),
  constraint brands_code_not_blank check (btrim(code) <> ''),
  constraint brands_name_not_blank check (btrim(name) <> '')
);

create table erp.product_models (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  brand_id uuid not null,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_models_brand_fk foreign key (brand_id, organization_id)
    references erp.brands(id, organization_id) on delete restrict,
  constraint product_models_id_organization_unique unique (id, organization_id),
  constraint product_models_identity_unique unique (id, organization_id, brand_id),
  constraint product_models_code_unique unique (organization_id, brand_id, code),
  constraint product_models_code_not_blank check (btrim(code) <> ''),
  constraint product_models_name_not_blank check (btrim(name) <> '')
);

create table erp.units_of_measure (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  code text not null,
  name text not null,
  allows_decimals boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint units_id_organization_unique unique (id, organization_id),
  constraint units_code_unique unique (organization_id, code),
  constraint units_code_not_blank check (btrim(code) <> ''),
  constraint units_name_not_blank check (btrim(name) <> '')
);

create table erp.product_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  code text not null,
  name text not null,
  item_kind erp.catalog_item_kind not null,
  default_tracking_mode erp.inventory_tracking_mode not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_types_id_organization_unique unique (id, organization_id),
  constraint product_types_identity_unique unique (id, organization_id, item_kind),
  constraint product_types_code_unique unique (organization_id, code),
  constraint product_types_code_not_blank check (btrim(code) <> ''),
  constraint product_types_name_not_blank check (btrim(name) <> ''),
  constraint product_types_service_has_no_stock check (
    item_kind <> 'service' or default_tracking_mode = 'none'
  ),
  constraint product_types_product_has_stock_tracking check (
    item_kind <> 'product' or default_tracking_mode <> 'none'
  )
);

create table erp.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  product_type_id uuid not null,
  item_kind erp.catalog_item_kind not null,
  category_id uuid references erp.product_categories(id) on delete restrict,
  brand_id uuid references erp.brands(id) on delete restrict,
  model_id uuid references erp.product_models(id) on delete restrict,
  unit_id uuid not null references erp.units_of_measure(id) on delete restrict,
  internal_code text not null,
  normalized_internal_code text generated always as (upper(btrim(internal_code))) stored,
  internal_name text not null,
  public_name text,
  internal_description text,
  public_description text,
  inventory_tracking erp.inventory_tracking_mode not null,
  service_price_mode erp.service_price_mode not null default 'fixed',
  purchase_currency text not null default 'ARS' check (purchase_currency ~ '^[A-Z]{3}$'),
  base_cost numeric(18, 4) not null default 0 check (base_cost <> 'NaN'::numeric and base_cost >= 0),
  base_sale_price numeric(18, 4) not null default 0 check (base_sale_price <> 'NaN'::numeric and base_sale_price >= 0),
  target_margin_percent numeric(9, 4) check (
    target_margin_percent is null
    or (target_margin_percent <> 'NaN'::numeric and target_margin_percent >= 0)
  ),
  tax_rate_percent numeric(7, 4) not null default 21 check (
    tax_rate_percent <> 'NaN'::numeric and tax_rate_percent between 0 and 100
  ),
  warranty_days integer not null default 0 check (warranty_days >= 0),
  minimum_stock numeric(18, 4) not null default 0 check (minimum_stock <> 'NaN'::numeric and minimum_stock >= 0),
  admission_date date not null default current_date,
  can_sell boolean not null default true,
  can_use_as_repair_part boolean not null default false,
  publish_on_web boolean not null default false,
  allow_online_sale boolean not null default false,
  zero_stock_behavior erp.zero_stock_behavior not null default 'hidden',
  internal_image_path text,
  web_image_path text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint products_id_organization_unique unique (id, organization_id),
  constraint products_product_type_fk foreign key (product_type_id, organization_id, item_kind)
    references erp.product_types(id, organization_id, item_kind) on delete restrict,
  constraint products_category_organization_fk foreign key (category_id, organization_id)
    references erp.product_categories(id, organization_id) on delete restrict,
  constraint products_brand_organization_fk foreign key (brand_id, organization_id)
    references erp.brands(id, organization_id) on delete restrict,
  constraint products_model_organization_fk foreign key (model_id, organization_id, brand_id)
    references erp.product_models(id, organization_id, brand_id) on delete restrict,
  constraint products_unit_organization_fk foreign key (unit_id, organization_id)
    references erp.units_of_measure(id, organization_id) on delete restrict,
  constraint products_internal_code_unique unique (organization_id, normalized_internal_code),
  constraint products_internal_code_not_blank check (btrim(internal_code) <> ''),
  constraint products_internal_name_not_blank check (btrim(internal_name) <> ''),
  constraint products_model_requires_brand check (model_id is null or brand_id is not null),
  constraint products_service_has_no_stock check (
    item_kind <> 'service' or inventory_tracking = 'none'
  ),
  constraint products_product_has_stock_tracking check (
    item_kind <> 'product' or inventory_tracking <> 'none'
  ),
  constraint products_service_not_repair_part check (
    item_kind <> 'service' or not can_use_as_repair_part
  ),
  constraint products_online_requires_web_publication check (
    not allow_online_sale or publish_on_web
  )
);

create table erp.product_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  product_id uuid not null,
  code text not null,
  name text not null,
  attributes jsonb not null default '{}'::jsonb,
  image_path text,
  price_delta numeric(18, 4) not null default 0 check (price_delta <> 'NaN'::numeric),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint product_variants_id_product_organization_unique unique (id, product_id, organization_id),
  constraint product_variants_code_unique unique (organization_id, product_id, code),
  constraint product_variants_code_not_blank check (btrim(code) <> ''),
  constraint product_variants_name_not_blank check (btrim(name) <> '')
);

create table erp.product_identifiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  product_id uuid not null,
  variant_id uuid,
  kind erp.identifier_kind not null,
  value text not null,
  normalized_value text generated always as (
    upper(regexp_replace(btrim(value), '[[:space:]]+', '', 'g'))
  ) stored,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint product_identifiers_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint product_identifiers_variant_fk foreign key (variant_id, product_id, organization_id)
    references erp.product_variants(id, product_id, organization_id) on delete restrict,
  constraint product_identifiers_value_not_blank check (btrim(value) <> ''),
  constraint product_identifiers_value_unique unique (organization_id, normalized_value)
);

create unique index product_identifiers_primary_unique
  on erp.product_identifiers (organization_id, product_id, coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), kind)
  where is_primary;

create or replace function erp.prevent_product_code_reassignment()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.organization_id <> old.organization_id or new.internal_code <> old.internal_code then
    raise exception using
      errcode = 'integrity_constraint_violation',
      message = 'product internal codes are permanent; deactivate the product instead';
  end if;
  return new;
end;
$$;

create or replace function erp.prevent_identifier_reassignment()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.organization_id <> old.organization_id
    or new.product_id <> old.product_id
    or new.variant_id is distinct from old.variant_id
    or new.kind <> old.kind
    or new.value <> old.value then
    raise exception using
      errcode = 'integrity_constraint_violation',
      message = 'product identifiers are permanent; deactivate the identifier instead';
  end if;
  return new;
end;
$$;

create or replace function erp.get_customer_private_details(target_customer_id uuid)
returns table (
  customer_id uuid,
  tax_id text,
  identity_document text,
  address jsonb,
  internal_notes text,
  communication_consent boolean,
  consent_recorded_at timestamptz
)
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  target_organization_id uuid := erp.current_organization_id();
begin
  if target_organization_id is null
    or not erp.has_permission('customers.view_sensitive') then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'customers.view_sensitive is required';
  end if;

  if not exists (
    select 1
    from erp.customers customer
    where customer.id = target_customer_id
      and customer.organization_id = target_organization_id
  ) then
    raise exception using
      errcode = 'no_data_found',
      message = 'customer not found';
  end if;

  insert into erp.audit_events (
    organization_id,
    actor_user_id,
    schema_name,
    table_name,
    record_id,
    action,
    metadata
  ) values (
    target_organization_id,
    auth.uid(),
    'erp',
    'customer_private_details',
    target_customer_id::text,
    'read_sensitive',
    jsonb_build_object('customer_id', target_customer_id)
  );

  return query
  select
    details.customer_id,
    details.tax_id,
    details.identity_document,
    details.address,
    details.internal_notes,
    details.communication_consent,
    details.consent_recorded_at
  from erp.customer_private_details details
  where details.customer_id = target_customer_id
    and details.organization_id = target_organization_id;
end;
$$;

create or replace function erp.upsert_customer_private_details(
  target_customer_id uuid,
  new_tax_id text default null,
  new_identity_document text default null,
  new_address jsonb default '{}'::jsonb,
  new_internal_notes text default null,
  new_communication_consent boolean default false,
  new_consent_recorded_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  target_organization_id uuid := erp.current_organization_id();
  details_id uuid;
begin
  if target_organization_id is null
    or not erp.has_permission('customers.manage')
    or not erp.has_permission('customers.view_sensitive') then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'customers.manage and customers.view_sensitive are required';
  end if;

  if not exists (
    select 1
    from erp.customers customer
    where customer.id = target_customer_id
      and customer.organization_id = target_organization_id
  ) then
    raise exception using
      errcode = 'no_data_found',
      message = 'customer not found';
  end if;

  insert into erp.customer_private_details (
    organization_id,
    customer_id,
    tax_id,
    identity_document,
    address,
    internal_notes,
    communication_consent,
    consent_recorded_at,
    updated_by
  ) values (
    target_organization_id,
    target_customer_id,
    nullif(btrim(new_tax_id), ''),
    nullif(btrim(new_identity_document), ''),
    coalesce(new_address, '{}'::jsonb),
    new_internal_notes,
    new_communication_consent,
    new_consent_recorded_at,
    auth.uid()
  )
  on conflict (customer_id) do update
  set tax_id = excluded.tax_id,
      identity_document = excluded.identity_document,
      address = excluded.address,
      internal_notes = excluded.internal_notes,
      communication_consent = excluded.communication_consent,
      consent_recorded_at = excluded.consent_recorded_at,
      updated_by = auth.uid()
  returning id into details_id;

  return details_id;
end;
$$;

create trigger products_prevent_code_reassignment
before update on erp.products
for each row execute function erp.prevent_product_code_reassignment();

create trigger product_identifiers_prevent_reassignment
before update on erp.product_identifiers
for each row execute function erp.prevent_identifier_reassignment();

create trigger customers_touch_updated_at before update on erp.customers
for each row execute function erp.touch_updated_at();
create trigger customer_private_touch_updated_at before update on erp.customer_private_details
for each row execute function erp.touch_updated_at();
create trigger suppliers_touch_updated_at before update on erp.suppliers
for each row execute function erp.touch_updated_at();
create trigger product_categories_touch_updated_at before update on erp.product_categories
for each row execute function erp.touch_updated_at();
create trigger brands_touch_updated_at before update on erp.brands
for each row execute function erp.touch_updated_at();
create trigger product_models_touch_updated_at before update on erp.product_models
for each row execute function erp.touch_updated_at();
create trigger units_touch_updated_at before update on erp.units_of_measure
for each row execute function erp.touch_updated_at();
create trigger product_types_touch_updated_at before update on erp.product_types
for each row execute function erp.touch_updated_at();
create trigger products_touch_updated_at before update on erp.products
for each row execute function erp.touch_updated_at();
create trigger product_variants_touch_updated_at before update on erp.product_variants
for each row execute function erp.touch_updated_at();
create trigger product_identifiers_touch_updated_at before update on erp.product_identifiers
for each row execute function erp.touch_updated_at();

create trigger customers_prevent_delete before delete on erp.customers
for each row execute function erp.prevent_delete();
create trigger customer_private_prevent_delete before delete on erp.customer_private_details
for each row execute function erp.prevent_delete();
create trigger suppliers_prevent_delete before delete on erp.suppliers
for each row execute function erp.prevent_delete();
create trigger product_categories_prevent_delete before delete on erp.product_categories
for each row execute function erp.prevent_delete();
create trigger brands_prevent_delete before delete on erp.brands
for each row execute function erp.prevent_delete();
create trigger product_models_prevent_delete before delete on erp.product_models
for each row execute function erp.prevent_delete();
create trigger units_prevent_delete before delete on erp.units_of_measure
for each row execute function erp.prevent_delete();
create trigger product_types_prevent_delete before delete on erp.product_types
for each row execute function erp.prevent_delete();
create trigger products_prevent_delete before delete on erp.products
for each row execute function erp.prevent_delete();
create trigger product_variants_prevent_delete before delete on erp.product_variants
for each row execute function erp.prevent_delete();
create trigger product_identifiers_prevent_delete before delete on erp.product_identifiers
for each row execute function erp.prevent_delete();

create trigger customers_audit after insert or update on erp.customers
for each row execute function erp.audit_row_change();
create trigger customer_private_audit after insert or update on erp.customer_private_details
for each row execute function erp.audit_row_change();
create trigger suppliers_audit after insert or update on erp.suppliers
for each row execute function erp.audit_row_change();
create trigger product_categories_audit after insert or update on erp.product_categories
for each row execute function erp.audit_row_change();
create trigger brands_audit after insert or update on erp.brands
for each row execute function erp.audit_row_change();
create trigger product_models_audit after insert or update on erp.product_models
for each row execute function erp.audit_row_change();
create trigger units_audit after insert or update on erp.units_of_measure
for each row execute function erp.audit_row_change();
create trigger product_types_audit after insert or update on erp.product_types
for each row execute function erp.audit_row_change();
create trigger products_audit after insert or update on erp.products
for each row execute function erp.audit_row_change();
create trigger product_variants_audit after insert or update on erp.product_variants
for each row execute function erp.audit_row_change();
create trigger product_identifiers_audit after insert or update on erp.product_identifiers
for each row execute function erp.audit_row_change();

alter table erp.customers enable row level security;
alter table erp.customer_private_details enable row level security;
alter table erp.suppliers enable row level security;
alter table erp.product_categories enable row level security;
alter table erp.brands enable row level security;
alter table erp.product_models enable row level security;
alter table erp.units_of_measure enable row level security;
alter table erp.product_types enable row level security;
alter table erp.products enable row level security;
alter table erp.product_variants enable row level security;
alter table erp.product_identifiers enable row level security;

create policy customers_select on erp.customers for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('customers.view'));
create policy customers_insert on erp.customers for insert to authenticated
with check (organization_id = erp.current_organization_id() and erp.has_permission('customers.manage'));
create policy customers_update on erp.customers for update to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('customers.manage'))
with check (organization_id = erp.current_organization_id() and erp.has_permission('customers.manage'));

create policy suppliers_select on erp.suppliers for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('suppliers.view'));
create policy suppliers_insert on erp.suppliers for insert to authenticated
with check (organization_id = erp.current_organization_id() and erp.has_permission('suppliers.manage'));
create policy suppliers_update on erp.suppliers for update to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('suppliers.manage'))
with check (organization_id = erp.current_organization_id() and erp.has_permission('suppliers.manage'));

create policy categories_select on erp.product_categories for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.view'));
create policy categories_insert on erp.product_categories for insert to authenticated
with check (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'));
create policy categories_update on erp.product_categories for update to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'))
with check (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'));

create policy brands_select on erp.brands for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.view'));
create policy brands_insert on erp.brands for insert to authenticated
with check (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'));
create policy brands_update on erp.brands for update to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'))
with check (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'));

create policy models_select on erp.product_models for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.view'));
create policy models_insert on erp.product_models for insert to authenticated
with check (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'));
create policy models_update on erp.product_models for update to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'))
with check (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'));

create policy units_select on erp.units_of_measure for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.view'));
create policy units_insert on erp.units_of_measure for insert to authenticated
with check (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'));
create policy units_update on erp.units_of_measure for update to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'))
with check (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'));

create policy product_types_select on erp.product_types for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.view'));
create policy product_types_insert on erp.product_types for insert to authenticated
with check (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'));
create policy product_types_update on erp.product_types for update to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'))
with check (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'));

create policy products_select on erp.products for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.view'));
create policy products_insert on erp.products for insert to authenticated
with check (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'));
create policy products_update on erp.products for update to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'))
with check (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'));

create policy variants_select on erp.product_variants for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.view'));
create policy variants_insert on erp.product_variants for insert to authenticated
with check (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'));
create policy variants_update on erp.product_variants for update to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'))
with check (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'));

create policy identifiers_select on erp.product_identifiers for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.view'));
create policy identifiers_insert on erp.product_identifiers for insert to authenticated
with check (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'));
create policy identifiers_update on erp.product_identifiers for update to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'))
with check (organization_id = erp.current_organization_id() and erp.has_permission('catalog.manage'));

grant select, insert, update on
  erp.customers,
  erp.suppliers,
  erp.product_categories,
  erp.brands,
  erp.product_models,
  erp.units_of_measure,
  erp.product_types,
  erp.product_variants,
  erp.product_identifiers
to authenticated;

grant select (
  id, organization_id, product_type_id, item_kind, category_id, brand_id, model_id,
  unit_id, internal_code, normalized_internal_code, internal_name, public_name,
  internal_description, public_description, inventory_tracking, service_price_mode,
  base_sale_price, tax_rate_percent, warranty_days, minimum_stock, admission_date,
  can_sell, can_use_as_repair_part, publish_on_web, allow_online_sale,
  zero_stock_behavior, internal_image_path, web_image_path, is_active,
  created_at, updated_at, created_by, updated_by
) on erp.products to authenticated;
grant insert (
  organization_id, product_type_id, item_kind, category_id, brand_id, model_id,
  unit_id, internal_code, internal_name, public_name, internal_description,
  public_description, inventory_tracking, service_price_mode, base_sale_price,
  tax_rate_percent, warranty_days, minimum_stock, admission_date, can_sell,
  can_use_as_repair_part, publish_on_web, allow_online_sale, zero_stock_behavior,
  internal_image_path, web_image_path, is_active, created_by, updated_by
) on erp.products to authenticated;
grant update (
  product_type_id, item_kind, category_id, brand_id, model_id, unit_id,
  internal_name, public_name, internal_description, public_description,
  inventory_tracking, service_price_mode, base_sale_price, tax_rate_percent,
  warranty_days, minimum_stock, admission_date, can_sell, can_use_as_repair_part,
  publish_on_web, allow_online_sale, zero_stock_behavior, internal_image_path,
  web_image_path, is_active, updated_by
) on erp.products to authenticated;

revoke all on erp.customer_private_details from authenticated;

grant all on
  erp.customers,
  erp.customer_private_details,
  erp.suppliers,
  erp.product_categories,
  erp.brands,
  erp.product_models,
  erp.units_of_measure,
  erp.product_types,
  erp.products,
  erp.product_variants,
  erp.product_identifiers
to service_role;

revoke truncate on
  erp.customers,
  erp.customer_private_details,
  erp.suppliers,
  erp.product_categories,
  erp.brands,
  erp.product_models,
  erp.units_of_measure,
  erp.product_types,
  erp.products,
  erp.product_variants,
  erp.product_identifiers
from service_role;

revoke all on function erp.prevent_product_code_reassignment() from public, anon, authenticated;
revoke all on function erp.prevent_identifier_reassignment() from public, anon, authenticated;
revoke all on function erp.get_customer_private_details(uuid) from public, anon;
revoke all on function erp.upsert_customer_private_details(uuid, text, text, jsonb, text, boolean, timestamptz) from public, anon;
grant execute on function erp.get_customer_private_details(uuid) to authenticated, service_role;
grant execute on function erp.upsert_customer_private_details(uuid, text, text, jsonb, text, boolean, timestamptz) to authenticated, service_role;
