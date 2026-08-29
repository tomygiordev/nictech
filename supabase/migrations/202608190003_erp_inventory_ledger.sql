create type erp.inventory_unit_status as enum (
  'available',
  'reserved',
  'in_transit',
  'in_repair',
  'sold',
  'warranty',
  'quarantine',
  'retired'
);

create type erp.stock_document_kind as enum (
  'opening',
  'receipt',
  'sale',
  'transfer',
  'adjustment',
  'reservation_fulfillment',
  'repair_consumption',
  'return',
  'physical_count'
);

create type erp.stock_document_status as enum ('posted', 'reversed');
create type erp.stock_reservation_status as enum ('active', 'released', 'fulfilled', 'expired');
create type erp.inventory_count_status as enum ('draft', 'counting', 'review', 'posted', 'cancelled');

alter table erp.locations
  add constraint locations_id_organization_branch_unique unique (id, organization_id, branch_id),
  add constraint locations_id_organization_unique unique (id, organization_id);

create table erp.inventory_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  product_id uuid not null,
  variant_id uuid,
  current_location_id uuid,
  serial_number text,
  imei text,
  normalized_serial_number text generated always as (
    nullif(upper(regexp_replace(btrim(serial_number), '[[:space:]-]+', '', 'g')), '')
  ) stored,
  normalized_imei text generated always as (
    nullif(regexp_replace(btrim(imei), '[^0-9]+', '', 'g'), '')
  ) stored,
  status erp.inventory_unit_status not null default 'available',
  acquisition_cost numeric(18, 4) not null default 0 check (
    acquisition_cost <> 'NaN'::numeric and acquisition_cost >= 0
  ),
  acquired_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint inventory_units_id_organization_unique unique (id, organization_id),
  constraint inventory_units_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint inventory_units_variant_fk foreign key (variant_id, product_id, organization_id)
    references erp.product_variants(id, product_id, organization_id) on delete restrict,
  constraint inventory_units_location_fk foreign key (current_location_id, organization_id)
    references erp.locations(id, organization_id) on delete restrict,
  constraint inventory_units_identifier_present check (normalized_serial_number is not null or normalized_imei is not null),
  constraint inventory_units_imei_format check (normalized_imei is null or normalized_imei ~ '^[0-9]{14,16}$'),
  constraint inventory_units_status_location check (
    (status in ('available', 'reserved', 'in_repair', 'warranty') and current_location_id is not null)
    or (status in ('sold', 'retired') and current_location_id is null)
    or status in ('in_transit', 'quarantine')
  )
);

create unique index inventory_units_serial_unique
  on erp.inventory_units (organization_id, normalized_serial_number)
  where normalized_serial_number is not null;
create unique index inventory_units_imei_unique
  on erp.inventory_units (organization_id, normalized_imei)
  where normalized_imei is not null;

create table erp.stock_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  kind erp.stock_document_kind not null,
  status erp.stock_document_status not null default 'posted',
  idempotency_key text not null,
  request_hash text not null,
  reason text not null,
  source_type text,
  source_id uuid,
  reversed_document_id uuid,
  posted_at timestamptz not null default now(),
  posted_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint stock_documents_id_organization_unique unique (id, organization_id),
  constraint stock_documents_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint stock_documents_reversed_document_fk foreign key (reversed_document_id, organization_id)
    references erp.stock_documents(id, organization_id) on delete restrict,
  constraint stock_documents_idempotency_unique unique (organization_id, branch_id, kind, idempotency_key),
  constraint stock_documents_idempotency_not_blank check (btrim(idempotency_key) <> ''),
  constraint stock_documents_reason_not_blank check (btrim(reason) <> ''),
  constraint stock_documents_reversal_shape check (
    (status = 'posted' and reversed_document_id is null)
    or (status = 'reversed' and reversed_document_id is not null)
  ),
  constraint stock_documents_not_self_reversal check (reversed_document_id is null or reversed_document_id <> id)
);

create unique index stock_documents_reversal_unique
  on erp.stock_documents (reversed_document_id)
  where reversed_document_id is not null;
create unique index stock_documents_reservation_fulfillment_unique
  on erp.stock_documents (organization_id, source_id)
  where kind = 'reservation_fulfillment' and source_type = 'stock_reservation';

create table erp.stock_document_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  document_id uuid not null,
  line_number integer not null check (line_number > 0),
  product_id uuid not null,
  variant_id uuid,
  inventory_unit_id uuid,
  from_location_id uuid,
  to_location_id uuid,
  quantity numeric(18, 4) not null check (quantity <> 'NaN'::numeric and quantity > 0),
  unit_cost numeric(18, 4) not null default 0 check (unit_cost <> 'NaN'::numeric and unit_cost >= 0),
  unit_status_before erp.inventory_unit_status,
  unit_status_after erp.inventory_unit_status,
  created_at timestamptz not null default now(),
  constraint stock_document_lines_id_organization_unique unique (id, organization_id),
  constraint stock_document_lines_document_fk foreign key (document_id, organization_id)
    references erp.stock_documents(id, organization_id) on delete restrict,
  constraint stock_document_lines_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint stock_document_lines_variant_fk foreign key (variant_id, product_id, organization_id)
    references erp.product_variants(id, product_id, organization_id) on delete restrict,
  constraint stock_document_lines_unit_fk foreign key (inventory_unit_id, organization_id)
    references erp.inventory_units(id, organization_id) on delete restrict,
  constraint stock_document_lines_from_location_fk foreign key (from_location_id, organization_id)
    references erp.locations(id, organization_id) on delete restrict,
  constraint stock_document_lines_to_location_fk foreign key (to_location_id, organization_id)
    references erp.locations(id, organization_id) on delete restrict,
  constraint stock_document_lines_number_unique unique (document_id, line_number),
  constraint stock_document_lines_has_location check (from_location_id is not null or to_location_id is not null),
  constraint stock_document_lines_distinct_locations check (from_location_id is distinct from to_location_id),
  constraint stock_document_lines_unit_state_pair check (
    (inventory_unit_id is null and unit_status_before is null and unit_status_after is null)
    or (inventory_unit_id is not null and unit_status_before is not null and unit_status_after is not null)
  )
);

create table erp.stock_movements (
  id bigint generated always as identity primary key,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  document_id uuid not null,
  document_line_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  inventory_unit_id uuid,
  location_id uuid not null,
  quantity_delta numeric(18, 4) not null check (
    quantity_delta <> 'NaN'::numeric and quantity_delta <> 0
  ),
  unit_cost numeric(18, 4) not null default 0 check (unit_cost <> 'NaN'::numeric and unit_cost >= 0),
  occurred_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete restrict,
  constraint stock_movements_document_fk foreign key (document_id, organization_id)
    references erp.stock_documents(id, organization_id) on delete restrict,
  constraint stock_movements_line_fk foreign key (document_line_id, organization_id)
    references erp.stock_document_lines(id, organization_id) on delete restrict,
  constraint stock_movements_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint stock_movements_variant_fk foreign key (variant_id, product_id, organization_id)
    references erp.product_variants(id, product_id, organization_id) on delete restrict,
  constraint stock_movements_unit_fk foreign key (inventory_unit_id, organization_id)
    references erp.inventory_units(id, organization_id) on delete restrict,
  constraint stock_movements_location_fk foreign key (location_id, organization_id, branch_id)
    references erp.locations(id, organization_id, branch_id) on delete restrict,
  constraint stock_movements_line_location_unique unique (document_line_id, location_id)
);

create index stock_movements_product_location_idx
  on erp.stock_movements (organization_id, product_id, location_id, occurred_at desc);
create index stock_movements_document_idx on erp.stock_movements (document_id, id);

create table erp.stock_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  location_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  variant_key uuid generated always as (coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  quantity_on_hand numeric(18, 4) not null default 0 check (quantity_on_hand <> 'NaN'::numeric),
  quantity_reserved numeric(18, 4) not null default 0 check (
    quantity_reserved <> 'NaN'::numeric and quantity_reserved >= 0
  ),
  updated_at timestamptz not null default now(),
  constraint stock_balances_location_fk foreign key (location_id, organization_id, branch_id)
    references erp.locations(id, organization_id, branch_id) on delete restrict,
  constraint stock_balances_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint stock_balances_variant_fk foreign key (variant_id, product_id, organization_id)
    references erp.product_variants(id, product_id, organization_id) on delete restrict,
  constraint stock_balances_identity_unique unique (organization_id, location_id, product_id, variant_key),
  constraint stock_balances_reserved_not_above_stock check (quantity_reserved <= greatest(quantity_on_hand, 0))
);

create table erp.stock_reservation_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  idempotency_key text not null,
  request_hash text not null,
  status erp.stock_reservation_status not null default 'active',
  source_type text not null,
  source_id uuid,
  expires_at timestamptz not null,
  released_at timestamptz,
  fulfilled_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint stock_reservation_batches_id_organization_unique unique (id, organization_id),
  constraint stock_reservation_batches_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint stock_reservation_batches_idempotency_unique unique (organization_id, branch_id, idempotency_key),
  constraint stock_reservation_batches_key_not_blank check (btrim(idempotency_key) <> ''),
  constraint stock_reservation_batches_source_not_blank check (btrim(source_type) <> ''),
  constraint stock_reservation_batches_expiry check (expires_at > created_at),
  constraint stock_reservation_batches_lifecycle check (
    (status = 'active' and released_at is null and fulfilled_at is null)
    or (status in ('released', 'expired') and released_at is not null and fulfilled_at is null)
    or (status = 'fulfilled' and fulfilled_at is not null and released_at is null)
  )
);

create table erp.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  batch_id uuid not null,
  location_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  inventory_unit_id uuid,
  quantity numeric(18, 4) not null check (quantity <> 'NaN'::numeric and quantity > 0),
  created_at timestamptz not null default now(),
  constraint stock_reservations_batch_fk foreign key (batch_id, organization_id)
    references erp.stock_reservation_batches(id, organization_id) on delete restrict,
  constraint stock_reservations_location_fk foreign key (location_id, organization_id)
    references erp.locations(id, organization_id) on delete restrict,
  constraint stock_reservations_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint stock_reservations_variant_fk foreign key (variant_id, product_id, organization_id)
    references erp.product_variants(id, product_id, organization_id) on delete restrict,
  constraint stock_reservations_unit_fk foreign key (inventory_unit_id, organization_id)
    references erp.inventory_units(id, organization_id) on delete restrict
);

create table erp.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  location_id uuid not null,
  code text not null,
  status erp.inventory_count_status not null default 'draft',
  freeze_at timestamptz,
  started_at timestamptz,
  submitted_at timestamptz,
  posted_document_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  updated_by uuid references auth.users(id) on delete set null,
  constraint inventory_counts_id_organization_unique unique (id, organization_id),
  constraint inventory_counts_location_fk foreign key (location_id, organization_id, branch_id)
    references erp.locations(id, organization_id, branch_id) on delete restrict,
  constraint inventory_counts_document_fk foreign key (posted_document_id, organization_id)
    references erp.stock_documents(id, organization_id) on delete restrict,
  constraint inventory_counts_code_unique unique (organization_id, code),
  constraint inventory_counts_code_not_blank check (btrim(code) <> '')
);

create table erp.inventory_count_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  count_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  inventory_unit_id uuid,
  expected_quantity numeric(18, 4) not null check (expected_quantity <> 'NaN'::numeric),
  counted_quantity numeric(18, 4) check (
    counted_quantity is null or (counted_quantity <> 'NaN'::numeric and counted_quantity >= 0)
  ),
  counted_at timestamptz,
  counted_by uuid references auth.users(id) on delete set null,
  notes text,
  constraint inventory_count_lines_count_fk foreign key (count_id, organization_id)
    references erp.inventory_counts(id, organization_id) on delete restrict,
  constraint inventory_count_lines_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint inventory_count_lines_variant_fk foreign key (variant_id, product_id, organization_id)
    references erp.product_variants(id, product_id, organization_id) on delete restrict,
  constraint inventory_count_lines_unit_fk foreign key (inventory_unit_id, organization_id)
    references erp.inventory_units(id, organization_id) on delete restrict
);

create or replace function erp.reservation_source_permission(source_kind text)
returns text
language sql
immutable
set search_path = erp, pg_catalog
as $$
  select case btrim(source_kind)
    when 'sale' then 'sales.create'
    when 'online_order' then 'orders.manage'
    when 'repair' then 'repairs.manage'
    when 'pc_build' then 'pc_builds.manage'
    else null
  end;
$$;

create or replace function erp.post_stock_document(
  document_kind erp.stock_document_kind,
  target_branch_id uuid,
  operation_key text,
  operation_reason text,
  lines jsonb,
  allow_negative boolean default false,
  source_type text default null,
  source_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  document_id uuid;
  line jsonb;
  line_id uuid;
  line_number integer := 0;
  target_product_id uuid;
  target_variant_id uuid;
  target_unit_id uuid;
  from_location uuid;
  to_location uuid;
  line_quantity numeric(18, 4);
  line_unit_cost numeric(18, 4);
  tracking_mode erp.inventory_tracking_mode;
  unit_status_before erp.inventory_unit_status;
  unit_status_after erp.inventory_unit_status;
  balance_on_hand numeric(18, 4);
  balance_reserved numeric(18, 4);
  location_allows_negative boolean;
  operation_hash text;
begin
  if actor_organization_id is null or not erp.has_permission('stock.move', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'stock.move permission is required';
  end if;
  if document_kind in ('opening', 'adjustment', 'physical_count')
    and not erp.has_permission('stock.adjust', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'stock.adjust permission is required';
  end if;
  if allow_negative and not erp.has_permission('stock.override_negative', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'stock.override_negative permission is required';
  end if;
  if nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'operation key and reason are required';
  end if;
  if lines is null or jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0
    or jsonb_array_length(lines) > 250 or pg_column_size(lines) > 1048576 then
    raise exception using errcode = 'invalid_parameter_value', message = 'stock lines must contain 1 to 250 entries within 1 MiB';
  end if;
  if document_kind = 'reservation_fulfillment' then
    raise exception using errcode = 'invalid_parameter_value', message = 'use fulfill_stock_reservation for reserved stock';
  end if;
  if document_kind = 'receipt' and not erp.has_permission('purchases.manage', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'purchases.manage permission is required';
  end if;
  if document_kind = 'sale' and not erp.has_permission('sales.create', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'sales.create permission is required';
  end if;
  if document_kind = 'return' and not erp.has_permission('sales.cancel', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'sales.cancel permission is required';
  end if;
  if document_kind = 'repair_consumption' and not erp.has_permission('repairs.manage', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'repairs.manage permission is required';
  end if;
  if document_kind in ('receipt', 'sale', 'repair_consumption', 'return')
    and (nullif(btrim(source_type), '') is null or source_id is null) then
    raise exception using errcode = 'invalid_parameter_value', message = 'business stock documents require source type and source id';
  end if;
  if not exists (
    select 1 from erp.branches
    where id = target_branch_id and organization_id = actor_organization_id and is_active
  ) then
    raise exception using errcode = 'foreign_key_violation', message = 'active branch not found';
  end if;

  operation_hash := md5(jsonb_build_object(
    'kind', document_kind,
    'branch_id', target_branch_id,
    'reason', operation_reason,
    'lines', lines,
    'allow_negative', allow_negative,
    'source_type', source_type,
    'source_id', source_id
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':' || target_branch_id::text, 0));
  perform set_config('erp.operation_reason', operation_reason, true);

  select id into document_id
  from erp.stock_documents
    where organization_id = actor_organization_id and idempotency_key = operation_key
      and branch_id = target_branch_id and kind = document_kind and request_hash = operation_hash;
  if document_id is not null then
    return document_id;
  end if;
  if exists (
    select 1 from erp.stock_documents
    where organization_id = actor_organization_id and branch_id = target_branch_id
      and kind = document_kind and idempotency_key = operation_key
  ) then
    raise exception using errcode = 'integrity_constraint_violation', message = 'stock operation key is already used by another operation';
  end if;

  insert into erp.stock_documents (
    organization_id, branch_id, kind, idempotency_key, request_hash, reason, source_type, source_id, posted_by
  ) values (
    actor_organization_id, target_branch_id, document_kind, operation_key, operation_hash, operation_reason,
    nullif(btrim(source_type), ''), source_id, auth.uid()
  ) returning id into document_id;

  for line in select value from jsonb_array_elements(lines)
  loop
    line_number := line_number + 1;
    begin
      target_product_id := (line->>'product_id')::uuid;
      target_variant_id := nullif(line->>'variant_id', '')::uuid;
      target_unit_id := nullif(line->>'inventory_unit_id', '')::uuid;
      from_location := nullif(line->>'from_location_id', '')::uuid;
      to_location := nullif(line->>'to_location_id', '')::uuid;
      line_quantity := (line->>'quantity')::numeric;
      line_unit_cost := coalesce(nullif(line->>'unit_cost', '')::numeric, 0);
    exception when others then
      raise exception using errcode = 'invalid_parameter_value', message = format('invalid stock line %s', line_number);
    end;

    if line_quantity <= 0 or (from_location is null and to_location is null) or from_location = to_location then
      raise exception using errcode = 'invalid_parameter_value', message = format('invalid stock line %s shape', line_number);
    end if;
    if (document_kind = 'transfer' and (from_location is null or to_location is null))
      or (document_kind in ('opening', 'receipt', 'return') and (from_location is not null or to_location is null))
      or (document_kind in ('sale', 'reservation_fulfillment', 'repair_consumption') and (from_location is null or to_location is not null))
      or (document_kind in ('adjustment', 'physical_count') and from_location is not null and to_location is not null) then
      raise exception using errcode = 'invalid_parameter_value', message = format('stock line %s direction does not match document kind', line_number);
    end if;

    select inventory_tracking into tracking_mode
    from erp.products
    where id = target_product_id and organization_id = actor_organization_id and item_kind = 'product' and is_active;
    if tracking_mode is null then
      raise exception using errcode = 'foreign_key_violation', message = format('active stock product not found on line %s', line_number);
    end if;
    if tracking_mode in ('serial', 'imei') and (target_unit_id is null or line_quantity <> 1) then
      raise exception using errcode = 'check_violation', message = 'serialized stock lines require one inventory unit and quantity 1';
    end if;
    if tracking_mode = 'quantity' and target_unit_id is not null then
      raise exception using errcode = 'check_violation', message = 'quantity-tracked products cannot reference an inventory unit';
    end if;
    if target_variant_id is not null and not exists (
      select 1 from erp.product_variants
      where id = target_variant_id and product_id = target_product_id
        and organization_id = actor_organization_id and is_active
    ) then
      raise exception using errcode = 'foreign_key_violation', message = format('active variant not found on line %s', line_number);
    end if;
    if target_unit_id is not null then
      select status into unit_status_before
      from erp.inventory_units
        where id = target_unit_id and product_id = target_product_id
          and variant_id is not distinct from target_variant_id and organization_id = actor_organization_id and is_active
          and (
            (from_location is not null and current_location_id = from_location and status = 'available')
            or (
              from_location is null and current_location_id is null
              and (
                (document_kind in ('opening', 'receipt', 'physical_count') and status = 'quarantine')
                or (document_kind = 'adjustment' and status in ('quarantine', 'sold', 'retired'))
                or (document_kind = 'return' and status in ('sold', 'warranty', 'quarantine'))
              )
            )
          )
      for update;
      if not found then
        raise exception using errcode = 'foreign_key_violation', message = format('inventory unit is not in the expected location on line %s', line_number);
      end if;
      unit_status_after := case
        when to_location is not null then 'available'::erp.inventory_unit_status
        when document_kind = 'sale' then 'sold'::erp.inventory_unit_status
        else 'retired'::erp.inventory_unit_status
      end;
    else
      unit_status_before := null;
      unit_status_after := null;
    end if;
    if from_location is not null and not exists (
      select 1 from erp.locations where id = from_location and organization_id = actor_organization_id
        and branch_id = target_branch_id and is_active
    ) then
      raise exception using errcode = 'foreign_key_violation', message = format('source location not found on line %s', line_number);
    end if;
    if to_location is not null and not exists (
      select 1 from erp.locations where id = to_location and organization_id = actor_organization_id
        and branch_id = target_branch_id and is_active
    ) then
      raise exception using errcode = 'foreign_key_violation', message = format('destination location not found on line %s', line_number);
    end if;

    insert into erp.stock_document_lines (
      organization_id, document_id, line_number, product_id, variant_id, inventory_unit_id,
      from_location_id, to_location_id, quantity, unit_cost, unit_status_before, unit_status_after
    ) values (
      actor_organization_id, document_id, line_number, target_product_id, target_variant_id, target_unit_id,
      from_location, to_location, line_quantity, line_unit_cost, unit_status_before, unit_status_after
    ) returning id into line_id;

    if from_location is not null then
      insert into erp.stock_balances (
        organization_id, branch_id, location_id, product_id, variant_id, quantity_on_hand
      ) values (
        actor_organization_id, target_branch_id, from_location, target_product_id, target_variant_id, 0
      ) on conflict (organization_id, location_id, product_id, variant_key) do nothing;

      select quantity_on_hand, quantity_reserved, l.allows_negative_stock
      into balance_on_hand, balance_reserved, location_allows_negative
      from erp.stock_balances b
      join erp.locations l on l.id = b.location_id
      where b.organization_id = actor_organization_id and b.location_id = from_location
        and b.product_id = target_product_id and b.variant_key = coalesce(target_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      for update of b;

      if balance_on_hand - balance_reserved < line_quantity
        and not (allow_negative and location_allows_negative) then
        raise exception using errcode = 'check_violation', message = format('insufficient available stock on line %s', line_number);
      end if;

      update erp.stock_balances
      set quantity_on_hand = quantity_on_hand - line_quantity, updated_at = now()
      where organization_id = actor_organization_id and location_id = from_location
        and product_id = target_product_id and variant_key = coalesce(target_variant_id, '00000000-0000-0000-0000-000000000000'::uuid);

      insert into erp.stock_movements (
        organization_id, branch_id, document_id, document_line_id, product_id, variant_id,
        inventory_unit_id, location_id, quantity_delta, unit_cost, actor_id
      ) values (
        actor_organization_id, target_branch_id, document_id, line_id, target_product_id, target_variant_id,
        target_unit_id, from_location, -line_quantity, line_unit_cost, auth.uid()
      );
    end if;

    if to_location is not null then
      insert into erp.stock_balances (
        organization_id, branch_id, location_id, product_id, variant_id, quantity_on_hand
      ) values (
        actor_organization_id, target_branch_id, to_location, target_product_id, target_variant_id, line_quantity
      ) on conflict (organization_id, location_id, product_id, variant_key) do update
      set quantity_on_hand = erp.stock_balances.quantity_on_hand + excluded.quantity_on_hand,
          updated_at = now();

      insert into erp.stock_movements (
        organization_id, branch_id, document_id, document_line_id, product_id, variant_id,
        inventory_unit_id, location_id, quantity_delta, unit_cost, actor_id
      ) values (
        actor_organization_id, target_branch_id, document_id, line_id, target_product_id, target_variant_id,
        target_unit_id, to_location, line_quantity, line_unit_cost, auth.uid()
      );
    end if;

    if target_unit_id is not null then
      update erp.inventory_units
      set current_location_id = to_location,
          status = unit_status_after,
          updated_by = auth.uid()
      where id = target_unit_id and organization_id = actor_organization_id
        and status = unit_status_before
        and current_location_id is not distinct from from_location;
      if not found then
        raise exception using errcode = 'data_exception', message = format('inventory unit changed concurrently on line %s', line_number);
      end if;
    end if;
  end loop;

  return document_id;
exception when unique_violation then
  select id into document_id
  from erp.stock_documents
    where organization_id = actor_organization_id and idempotency_key = operation_key
      and branch_id = target_branch_id and kind = document_kind and request_hash = operation_hash;
  if document_id is not null then return document_id; end if;
  raise;
end;
$$;

create or replace function erp.create_stock_reservation(
  target_branch_id uuid,
  operation_key text,
  reservation_source_type text,
  reservation_source_id uuid,
  expiration_time timestamptz,
  lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  batch_id uuid;
  line jsonb;
  target_location_id uuid;
  target_product_id uuid;
  target_variant_id uuid;
  target_unit_id uuid;
  line_quantity numeric(18, 4);
  balance_on_hand numeric(18, 4);
  balance_reserved numeric(18, 4);
  tracking_mode erp.inventory_tracking_mode;
  operation_hash text;
  source_permission text;
begin
  if actor_organization_id is null or not erp.has_permission('stock.move', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'stock.move permission is required';
  end if;
  if expiration_time <= now() then
    raise exception using errcode = 'invalid_parameter_value', message = 'reservation expiration must be in the future';
  end if;
  if nullif(btrim(operation_key), '') is null or nullif(btrim(reservation_source_type), '') is null
    or reservation_source_id is null or lines is null or jsonb_typeof(lines) <> 'array'
    or jsonb_array_length(lines) = 0 or jsonb_array_length(lines) > 250
    or pg_column_size(lines) > 1048576 then
    raise exception using errcode = 'invalid_parameter_value', message = 'reservation key, source and lines are required';
  end if;
  source_permission := erp.reservation_source_permission(reservation_source_type);
  if source_permission is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'unsupported reservation source type';
  end if;
  if not erp.has_permission(source_permission, target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = source_permission || ' permission is required';
  end if;

  operation_hash := md5(jsonb_build_object(
    'branch_id', target_branch_id,
    'source_type', reservation_source_type,
    'source_id', reservation_source_id,
    'expires_at', expiration_time,
    'lines', lines
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':' || target_branch_id::text, 0));

  select id into batch_id from erp.stock_reservation_batches
    where organization_id = actor_organization_id and idempotency_key = operation_key
      and branch_id = target_branch_id and source_type = reservation_source_type
    and source_id is not distinct from reservation_source_id and request_hash = operation_hash;
  if batch_id is not null then return batch_id; end if;
  if exists (
    select 1 from erp.stock_reservation_batches
    where organization_id = actor_organization_id and branch_id = target_branch_id
      and idempotency_key = operation_key
  ) then
    raise exception using errcode = 'integrity_constraint_violation', message = 'reservation key is already used by another operation';
  end if;

  insert into erp.stock_reservation_batches (
    organization_id, branch_id, idempotency_key, request_hash, source_type, source_id, expires_at, created_by
  ) values (
    actor_organization_id, target_branch_id, operation_key, operation_hash, reservation_source_type,
    reservation_source_id, expiration_time, auth.uid()
  ) returning id into batch_id;

  for line in select value from jsonb_array_elements(lines)
  loop
    begin
      target_location_id := (line->>'location_id')::uuid;
      target_product_id := (line->>'product_id')::uuid;
      target_variant_id := nullif(line->>'variant_id', '')::uuid;
      target_unit_id := nullif(line->>'inventory_unit_id', '')::uuid;
      line_quantity := (line->>'quantity')::numeric;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value', message = 'invalid reservation line';
    end;
    if line_quantity <= 0 then
      raise exception using errcode = 'invalid_parameter_value', message = 'reservation quantity must be positive';
    end if;
    select inventory_tracking into tracking_mode
    from erp.products
    where id = target_product_id and organization_id = actor_organization_id and item_kind = 'product' and is_active;
    if tracking_mode is null then
      raise exception using errcode = 'foreign_key_violation', message = 'active stock product not found';
    end if;
    if tracking_mode in ('serial', 'imei') and (target_unit_id is null or line_quantity <> 1) then
      raise exception using errcode = 'check_violation', message = 'serialized reservations require one inventory unit and quantity 1';
    end if;
    if tracking_mode = 'quantity' and target_unit_id is not null then
      raise exception using errcode = 'check_violation', message = 'quantity-tracked reservations cannot reference an inventory unit';
    end if;
    if target_variant_id is not null and not exists (
      select 1 from erp.product_variants
      where id = target_variant_id and product_id = target_product_id
        and organization_id = actor_organization_id and is_active
    ) then
      raise exception using errcode = 'foreign_key_violation', message = 'active reservation variant not found';
    end if;
    if not exists (
      select 1 from erp.locations where id = target_location_id and organization_id = actor_organization_id
        and branch_id = target_branch_id and is_active
    ) then
      raise exception using errcode = 'foreign_key_violation', message = 'active reservation location not found';
    end if;

    select quantity_on_hand, quantity_reserved into balance_on_hand, balance_reserved
    from erp.stock_balances
    where organization_id = actor_organization_id and location_id = target_location_id
      and product_id = target_product_id
      and variant_key = coalesce(target_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
    for update;
    if not found or balance_on_hand - balance_reserved < line_quantity then
      raise exception using errcode = 'check_violation', message = 'insufficient stock for reservation';
    end if;

    if target_unit_id is not null and (line_quantity <> 1 or not exists (
      select 1 from erp.inventory_units where id = target_unit_id and organization_id = actor_organization_id
        and product_id = target_product_id and variant_id is not distinct from target_variant_id
        and current_location_id = target_location_id and status = 'available' and is_active
    )) then
      raise exception using errcode = 'check_violation', message = 'serialized reservation unit is not available';
    end if;

    update erp.stock_balances
    set quantity_reserved = quantity_reserved + line_quantity, updated_at = now()
    where organization_id = actor_organization_id and location_id = target_location_id
      and product_id = target_product_id
      and variant_key = coalesce(target_variant_id, '00000000-0000-0000-0000-000000000000'::uuid);

    insert into erp.stock_reservations (
      organization_id, batch_id, location_id, product_id, variant_id, inventory_unit_id, quantity
    ) values (
      actor_organization_id, batch_id, target_location_id, target_product_id,
      target_variant_id, target_unit_id, line_quantity
    );

    if target_unit_id is not null then
      update erp.inventory_units set status = 'reserved', updated_by = auth.uid()
      where id = target_unit_id and organization_id = actor_organization_id;
    end if;
  end loop;

  return batch_id;
exception when unique_violation then
  select id into batch_id from erp.stock_reservation_batches
    where organization_id = actor_organization_id and idempotency_key = operation_key
      and branch_id = target_branch_id and source_type = reservation_source_type
    and source_id is not distinct from reservation_source_id and request_hash = operation_hash;
  if batch_id is not null then return batch_id; end if;
  raise;
end;
$$;

create or replace function erp.release_stock_reservation(target_batch_id uuid, release_reason text)
returns void
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  target_branch_id uuid;
  reservation_source_type text;
  source_permission text;
  reservation_row record;
begin
  select branch_id, source_type into target_branch_id, reservation_source_type
  from erp.stock_reservation_batches
  where id = target_batch_id and organization_id = actor_organization_id and status = 'active';
  if target_branch_id is null then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'active reservation not found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':' || target_branch_id::text, 0));

  select branch_id, source_type into target_branch_id, reservation_source_type
  from erp.stock_reservation_batches
  where id = target_batch_id and organization_id = actor_organization_id and status = 'active'
  for update;
  if target_branch_id is null then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'active reservation not found';
  end if;
  if not erp.has_permission('stock.move', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'stock.move permission is required';
  end if;
  source_permission := erp.reservation_source_permission(reservation_source_type);
  if source_permission is null or not erp.has_permission(source_permission, target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'reservation source permission is required';
  end if;
  if nullif(btrim(release_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'release reason is required';
  end if;
  perform set_config('erp.operation_reason', release_reason, true);

  for reservation_row in
    select * from erp.stock_reservations where batch_id = target_batch_id order by id for update
  loop
    update erp.stock_balances
    set quantity_reserved = quantity_reserved - reservation_row.quantity, updated_at = now()
    where organization_id = actor_organization_id and location_id = reservation_row.location_id
      and product_id = reservation_row.product_id
      and variant_key = coalesce(reservation_row.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and quantity_reserved >= reservation_row.quantity;
    if not found then
      raise exception using errcode = 'data_exception', message = 'reservation balance is inconsistent';
    end if;
    if reservation_row.inventory_unit_id is not null then
      update erp.inventory_units set status = 'available', updated_by = auth.uid()
      where id = reservation_row.inventory_unit_id and organization_id = actor_organization_id and status = 'reserved';
      if not found then
        raise exception using errcode = 'data_exception', message = 'reserved inventory unit is inconsistent';
      end if;
    end if;
  end loop;

  update erp.stock_reservation_batches
  set status = case when expires_at <= now() then 'expired' else 'released' end,
      released_at = now(), reason = release_reason, updated_by = auth.uid()
  where id = target_batch_id and organization_id = actor_organization_id;
end;
$$;

create or replace function erp.validate_inventory_unit()
returns trigger
language plpgsql
set search_path = erp, pg_catalog
as $$
declare
  tracking_mode erp.inventory_tracking_mode;
  normalized_serial text := nullif(upper(regexp_replace(btrim(new.serial_number), '[[:space:]-]+', '', 'g')), '');
  normalized_imei text := nullif(regexp_replace(btrim(new.imei), '[^0-9]+', '', 'g'), '');
begin
  select inventory_tracking into tracking_mode
  from erp.products
  where id = new.product_id and organization_id = new.organization_id
    and item_kind = 'product' and is_active;

  if tracking_mode is null then
    raise exception using errcode = 'foreign_key_violation', message = 'active serialized product not found';
  end if;

  if tracking_mode = 'serial' and normalized_serial is null then
    raise exception using errcode = 'check_violation', message = 'serial-tracked products require a serial number';
  end if;
  if tracking_mode = 'imei' and (normalized_imei is null or normalized_imei !~ '^[0-9]{14,16}$') then
    raise exception using errcode = 'check_violation', message = 'IMEI-tracked products require a valid IMEI';
  end if;
  if tracking_mode not in ('serial', 'imei') then
    raise exception using errcode = 'check_violation', message = 'inventory units require a serial- or IMEI-tracked product';
  end if;
  if tg_op = 'UPDATE' and (
    new.organization_id <> old.organization_id
    or new.product_id <> old.product_id
    or new.variant_id is distinct from old.variant_id
    or new.serial_number is distinct from old.serial_number
    or new.imei is distinct from old.imei
  ) then
    raise exception using errcode = 'integrity_constraint_violation', message = 'inventory unit identity is permanent';
  end if;
  return new;
end;
$$;

create or replace function erp.register_inventory_unit(
  target_product_id uuid,
  target_variant_id uuid,
  serial_number text,
  imei text,
  acquisition_cost numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  unit_id uuid;
  tracking_mode erp.inventory_tracking_mode;
begin
  if actor_organization_id is null or not erp.has_permission('stock.adjust') then
    raise exception using errcode = 'insufficient_privilege', message = 'stock.adjust permission is required';
  end if;
  if acquisition_cost > 0 and not erp.has_permission('costs.manage') then
    raise exception using errcode = 'insufficient_privilege', message = 'costs.manage permission is required to register acquisition cost';
  end if;
  select inventory_tracking into tracking_mode
  from erp.products
  where id = target_product_id and organization_id = actor_organization_id
    and item_kind = 'product' and is_active;
  if tracking_mode is null or tracking_mode not in ('serial', 'imei') then
    raise exception using errcode = 'foreign_key_violation', message = 'active serialized product not found';
  end if;
  if target_variant_id is not null and not exists (
    select 1 from erp.product_variants
    where id = target_variant_id and product_id = target_product_id
      and organization_id = actor_organization_id and is_active
  ) then
    raise exception using errcode = 'foreign_key_violation', message = 'active product variant not found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text, 0));

  insert into erp.inventory_units (
    organization_id, product_id, variant_id, serial_number, imei,
    status, acquisition_cost, created_by, updated_by
  ) values (
    actor_organization_id, target_product_id, target_variant_id,
    nullif(btrim(serial_number), ''), nullif(btrim(imei), ''),
    'quarantine', acquisition_cost, auth.uid(), auth.uid()
  ) returning id into unit_id;
  return unit_id;
end;
$$;

create or replace function erp.fulfill_stock_reservation(
  target_batch_id uuid,
  operation_key text,
  operation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  target_branch_id uuid;
  batch_status erp.stock_reservation_status;
  batch_expires_at timestamptz;
  reservation_source_type text;
  source_permission text;
  document_id uuid;
  operation_hash text;
  reservation_row record;
  line_id uuid;
  line_number integer := 0;
begin
  if actor_organization_id is null then
    raise exception using errcode = 'insufficient_privilege', message = 'active organization is required';
  end if;
  if nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'operation key and reason are required';
  end if;
  select branch_id, status, expires_at, source_type
  into target_branch_id, batch_status, batch_expires_at, reservation_source_type
  from erp.stock_reservation_batches
  where id = target_batch_id and organization_id = actor_organization_id;

  if target_branch_id is null then
    raise exception using errcode = 'foreign_key_violation', message = 'reservation not found';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':' || target_branch_id::text, 0));

  select branch_id, status, expires_at, source_type
  into target_branch_id, batch_status, batch_expires_at, reservation_source_type
  from erp.stock_reservation_batches
  where id = target_batch_id and organization_id = actor_organization_id
  for update;
  source_permission := erp.reservation_source_permission(reservation_source_type);
  if not erp.has_permission('stock.move', target_branch_id)
    or source_permission is null or not erp.has_permission(source_permission, target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'stock.move and reservation source permissions are required';
  end if;

  operation_hash := md5(jsonb_build_object(
    'batch_id', target_batch_id,
    'reason', operation_reason
  )::text);

  select id into document_id
  from erp.stock_documents
  where organization_id = actor_organization_id and idempotency_key = operation_key
    and branch_id = target_branch_id and kind = 'reservation_fulfillment'
    and request_hash = operation_hash;
  if document_id is not null and batch_status = 'fulfilled' then
    return document_id;
  end if;
  if batch_status <> 'active' then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'reservation is not active';
  end if;
  if batch_expires_at <= now() then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'reservation is expired and must be released';
  end if;
  if exists (
    select 1 from erp.stock_documents
    where organization_id = actor_organization_id and branch_id = target_branch_id
      and kind = 'reservation_fulfillment' and idempotency_key = operation_key
  ) then
    raise exception using errcode = 'integrity_constraint_violation', message = 'stock operation key is already used by another operation';
  end if;

  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.stock_documents (
    organization_id, branch_id, kind, idempotency_key, request_hash, reason,
    source_type, source_id, posted_by
  ) values (
    actor_organization_id, target_branch_id, 'reservation_fulfillment', operation_key,
    operation_hash, operation_reason, 'stock_reservation', target_batch_id, auth.uid()
  ) returning id into document_id;

  for reservation_row in
    select * from erp.stock_reservations where batch_id = target_batch_id order by location_id, product_id, id for update
  loop
    line_number := line_number + 1;

    update erp.stock_balances
    set quantity_on_hand = quantity_on_hand - reservation_row.quantity,
        quantity_reserved = quantity_reserved - reservation_row.quantity,
        updated_at = now()
    where organization_id = actor_organization_id
      and location_id = reservation_row.location_id
      and product_id = reservation_row.product_id
      and variant_key = coalesce(reservation_row.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and quantity_on_hand >= reservation_row.quantity
      and quantity_reserved >= reservation_row.quantity;
    if not found then
      raise exception using errcode = 'data_exception', message = 'reservation balance is inconsistent';
    end if;

    insert into erp.stock_document_lines (
      organization_id, document_id, line_number, product_id, variant_id,
      inventory_unit_id, from_location_id, quantity, unit_status_before, unit_status_after
    ) values (
      actor_organization_id, document_id, line_number, reservation_row.product_id,
      reservation_row.variant_id, reservation_row.inventory_unit_id,
      reservation_row.location_id, reservation_row.quantity,
      case when reservation_row.inventory_unit_id is not null then 'reserved'::erp.inventory_unit_status end,
      case when reservation_row.inventory_unit_id is not null then 'sold'::erp.inventory_unit_status end
    ) returning id into line_id;

    insert into erp.stock_movements (
      organization_id, branch_id, document_id, document_line_id, product_id,
      variant_id, inventory_unit_id, location_id, quantity_delta, actor_id
    ) values (
      actor_organization_id, target_branch_id, document_id, line_id,
      reservation_row.product_id, reservation_row.variant_id,
      reservation_row.inventory_unit_id, reservation_row.location_id,
      -reservation_row.quantity, auth.uid()
    );

    if reservation_row.inventory_unit_id is not null then
      update erp.inventory_units
      set current_location_id = null, status = 'sold', updated_by = auth.uid()
      where id = reservation_row.inventory_unit_id and organization_id = actor_organization_id
        and current_location_id = reservation_row.location_id and status = 'reserved';
      if not found then
        raise exception using errcode = 'data_exception', message = 'reserved inventory unit is inconsistent';
      end if;
    end if;
  end loop;

  if line_number = 0 then
    raise exception using errcode = 'data_exception', message = 'reservation has no lines';
  end if;

  update erp.stock_reservation_batches
  set status = 'fulfilled', fulfilled_at = now(), updated_by = auth.uid()
  where id = target_batch_id and organization_id = actor_organization_id and status = 'active';

  return document_id;
end;
$$;

create or replace function erp.expire_stock_reservations(target_branch_id uuid, batch_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  reservation_batch record;
  reservation_row record;
  expired_count integer := 0;
begin
  if batch_limit is null or batch_limit < 1 or batch_limit > 500 then
    raise exception using errcode = 'invalid_parameter_value', message = 'batch limit must be between 1 and 500';
  end if;
  if actor_organization_id is null
    or not erp.has_permission('stock.reservations_expire', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'stock.reservations_expire permission is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':' || target_branch_id::text, 0));
  perform set_config('erp.operation_reason', 'Automatic reservation expiry', true);

  for reservation_batch in
    select id
    from erp.stock_reservation_batches
    where organization_id = actor_organization_id
      and branch_id = target_branch_id
      and status = 'active'
      and expires_at <= now()
    order by expires_at, id
    limit batch_limit
    for update skip locked
  loop
    for reservation_row in
      select * from erp.stock_reservations
      where batch_id = reservation_batch.id
      order by id
      for update
    loop
      update erp.stock_balances
      set quantity_reserved = quantity_reserved - reservation_row.quantity,
          updated_at = now()
      where organization_id = actor_organization_id
        and location_id = reservation_row.location_id
        and product_id = reservation_row.product_id
        and variant_key = coalesce(reservation_row.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and quantity_reserved >= reservation_row.quantity;
      if not found then
        raise exception using errcode = 'data_exception', message = 'reservation balance is inconsistent';
      end if;

      if reservation_row.inventory_unit_id is not null then
        update erp.inventory_units
        set status = 'available', updated_by = auth.uid()
        where id = reservation_row.inventory_unit_id
          and organization_id = actor_organization_id
          and status = 'reserved';
        if not found then
          raise exception using errcode = 'data_exception', message = 'reserved inventory unit is inconsistent';
        end if;
      end if;
    end loop;

    update erp.stock_reservation_batches
    set status = 'expired', released_at = now(),
        reason = 'Automatic reservation expiry', updated_by = auth.uid()
    where id = reservation_batch.id
      and organization_id = actor_organization_id
      and status = 'active';
    expired_count := expired_count + 1;
  end loop;

  return expired_count;
end;
$$;

create or replace function erp.get_inventory_unit_identifiers(target_unit_id uuid)
returns table (
  inventory_unit_id uuid,
  serial_number text,
  imei text,
  normalized_serial_number text,
  normalized_imei text
)
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  target_branch_id uuid;
begin
  select location.branch_id into target_branch_id
  from erp.inventory_units unit
  left join erp.locations location
    on location.id = unit.current_location_id
   and location.organization_id = unit.organization_id
  where unit.id = target_unit_id
    and unit.organization_id = actor_organization_id;

  if not found then
    raise exception using errcode = 'no_data_found', message = 'inventory unit not found';
  end if;
  if not erp.has_permission('stock.view_identifiers', target_branch_id)
    or not erp.has_permission('stock.view', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'stock identifier permissions are required';
  end if;

  insert into erp.audit_events (
    organization_id, branch_id, actor_user_id, schema_name, table_name,
    record_id, action, metadata
  ) values (
    actor_organization_id, target_branch_id, auth.uid(), 'erp', 'inventory_units',
    target_unit_id::text, 'read_sensitive', jsonb_build_object('inventory_unit_id', target_unit_id)
  );

  return query
  select unit.id, unit.serial_number, unit.imei,
    unit.normalized_serial_number, unit.normalized_imei
  from erp.inventory_units unit
  where unit.id = target_unit_id
    and unit.organization_id = actor_organization_id;
end;
$$;

create or replace function erp.reverse_stock_document(
  original_document_id uuid,
  operation_key text,
  operation_reason text
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  original_document erp.stock_documents%rowtype;
  reversal_document_id uuid;
  reversal_kind erp.stock_document_kind;
  reversal_lines jsonb;
  reversal_request_hash text;
  unit_state_row record;
begin
  if nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'operation key and reason are required';
  end if;

  select * into original_document
  from erp.stock_documents
  where id = original_document_id and organization_id = actor_organization_id;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'stock document not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    actor_organization_id::text || ':' || original_document.branch_id::text,
    0
  ));
  select * into original_document
  from erp.stock_documents
  where id = original_document_id and organization_id = actor_organization_id
  for update;
  if original_document.status <> 'posted' or original_document.reversed_document_id is not null then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'stock document is not reversible';
  end if;
  if not erp.has_permission('stock.adjust', original_document.branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'stock.adjust permission is required';
  end if;
  if original_document.kind in ('sale', 'reservation_fulfillment', 'return')
    and not erp.has_permission('sales.cancel', original_document.branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'sales.cancel permission is required';
  end if;
  if original_document.kind = 'receipt'
    and not erp.has_permission('purchases.manage', original_document.branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'purchases.manage permission is required';
  end if;
  if original_document.kind = 'repair_consumption'
    and not erp.has_permission('repairs.manage', original_document.branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'repairs.manage permission is required';
  end if;

  reversal_kind := case when original_document.kind = 'transfer' then 'transfer' else 'adjustment' end;
  select jsonb_agg(
    jsonb_strip_nulls(jsonb_build_object(
      'product_id', line.product_id,
      'variant_id', line.variant_id,
      'inventory_unit_id', line.inventory_unit_id,
      'from_location_id', line.to_location_id,
      'to_location_id', line.from_location_id,
      'quantity', line.quantity,
      'unit_cost', line.unit_cost
    )) order by line.line_number
  ) into reversal_lines
  from erp.stock_document_lines line
  where line.document_id = original_document_id
    and line.organization_id = actor_organization_id;

  if reversal_lines is null then
    raise exception using errcode = 'data_exception', message = 'stock document has no lines';
  end if;

  reversal_request_hash := md5(jsonb_build_object(
    'kind', reversal_kind,
    'branch_id', original_document.branch_id,
    'reason', operation_reason,
    'lines', reversal_lines,
    'allow_negative', false,
    'source_type', 'stock_reversal',
    'source_id', original_document_id
  )::text);
  if exists (
    select 1 from erp.stock_documents
    where reversed_document_id = original_document_id
  ) then
    select id into reversal_document_id
    from erp.stock_documents
    where reversed_document_id = original_document_id
      and idempotency_key = operation_key
      and request_hash = reversal_request_hash;
    if reversal_document_id is not null then
      return reversal_document_id;
    end if;
    raise exception using errcode = 'integrity_constraint_violation', message = 'stock reversal retry does not match the original request';
  end if;

  reversal_document_id := erp.post_stock_document(
    reversal_kind,
    original_document.branch_id,
    operation_key,
    operation_reason,
    reversal_lines,
    false,
    'stock_reversal',
    original_document_id
  );

  perform set_config('erp.allow_stock_line_state_restore', 'on', true);
  for unit_state_row in
    select reversal_line.id as reversal_line_id,
      reversal_line.inventory_unit_id,
      case
        when original_document.kind = 'reservation_fulfillment'
          then 'available'::erp.inventory_unit_status
        else original_line.unit_status_before
      end as restored_status
    from erp.stock_document_lines reversal_line
    join erp.stock_document_lines original_line
      on original_line.document_id = original_document_id
     and original_line.line_number = reversal_line.line_number
     and original_line.organization_id = reversal_line.organization_id
    where reversal_line.document_id = reversal_document_id
      and reversal_line.organization_id = actor_organization_id
      and reversal_line.inventory_unit_id is not null
  loop
    update erp.inventory_units
    set status = unit_state_row.restored_status,
        updated_by = auth.uid()
    where id = unit_state_row.inventory_unit_id
      and organization_id = actor_organization_id;
    if not found then
      raise exception using errcode = 'data_exception', message = 'reversal inventory unit state could not be restored';
    end if;

    update erp.stock_document_lines
    set unit_status_after = unit_state_row.restored_status
    where id = unit_state_row.reversal_line_id
      and organization_id = actor_organization_id;
  end loop;
  perform set_config('erp.allow_stock_line_state_restore', 'off', true);

  perform set_config('erp.allow_stock_document_link', 'on', true);
  update erp.stock_documents
  set status = 'reversed', reversed_document_id = original_document_id
  where id = reversal_document_id
    and organization_id = actor_organization_id
    and status = 'posted'
    and reversed_document_id is null;
  perform set_config('erp.allow_stock_document_link', 'off', true);
  if not found then
    raise exception using errcode = 'data_exception', message = 'reversal document could not be linked';
  end if;

  return reversal_document_id;
end;
$$;

create or replace function erp.protect_stock_document_line()
returns trigger
language plpgsql
set search_path = erp, pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
    and current_setting('erp.allow_stock_line_state_restore', true) = 'on'
    and old.inventory_unit_id is not null
    and new.unit_status_after is not null
    and (to_jsonb(new) - 'unit_status_after') = (to_jsonb(old) - 'unit_status_after') then
    return new;
  end if;
  raise exception using errcode = 'integrity_constraint_violation',
    message = 'erp.stock_document_lines records are append-only';
end;
$$;

create or replace function erp.protect_stock_document()
returns trigger
language plpgsql
set search_path = erp, pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
    and current_setting('erp.allow_stock_document_link', true) = 'on'
    and old.status = 'posted'
    and old.reversed_document_id is null
    and new.status = 'reversed'
    and new.reversed_document_id is not null
    and (to_jsonb(new) - array['status', 'reversed_document_id'])
      = (to_jsonb(old) - array['status', 'reversed_document_id']) then
    return new;
  end if;
  raise exception using errcode = 'integrity_constraint_violation',
    message = 'erp.stock_documents records are append-only and can only be linked by the reversal command';
end;
$$;

create or replace function erp.validate_stock_relationships()
returns trigger
language plpgsql
set search_path = erp, pg_catalog
as $$
declare
  parent_branch_id uuid;
  parent_location_id uuid;
begin
  if tg_table_name = 'stock_document_lines' then
    select branch_id into parent_branch_id
    from erp.stock_documents
    where id = new.document_id and organization_id = new.organization_id;
    if (new.from_location_id is not null and not exists (
      select 1 from erp.locations where id = new.from_location_id
        and organization_id = new.organization_id and branch_id = parent_branch_id
    )) or (new.to_location_id is not null and not exists (
      select 1 from erp.locations where id = new.to_location_id
        and organization_id = new.organization_id and branch_id = parent_branch_id
    )) then
      raise exception using errcode = 'foreign_key_violation', message = 'stock line location does not belong to document branch';
    end if;
    if new.inventory_unit_id is not null and not exists (
      select 1 from erp.inventory_units
      where id = new.inventory_unit_id and organization_id = new.organization_id
        and product_id = new.product_id and variant_id is not distinct from new.variant_id
    ) then
      raise exception using errcode = 'foreign_key_violation', message = 'stock line unit does not match product and variant';
    end if;
  elsif tg_table_name = 'stock_movements' then
    if not exists (
      select 1
      from erp.stock_document_lines line
      join erp.stock_documents document
        on document.id = line.document_id and document.organization_id = line.organization_id
      where line.id = new.document_line_id
        and line.organization_id = new.organization_id
        and line.document_id = new.document_id
        and line.product_id = new.product_id
        and line.variant_id is not distinct from new.variant_id
        and line.inventory_unit_id is not distinct from new.inventory_unit_id
        and document.branch_id = new.branch_id
        and new.unit_cost = line.unit_cost
        and (
          (new.location_id = line.from_location_id and new.quantity_delta = -line.quantity)
          or (new.location_id = line.to_location_id and new.quantity_delta = line.quantity)
        )
    ) then
      raise exception using errcode = 'foreign_key_violation', message = 'stock movement does not match its document line';
    end if;
  elsif tg_table_name = 'stock_reservations' then
    select branch_id into parent_branch_id
    from erp.stock_reservation_batches
    where id = new.batch_id and organization_id = new.organization_id;
    if not exists (
      select 1 from erp.locations
      where id = new.location_id and organization_id = new.organization_id
        and branch_id = parent_branch_id
    ) then
      raise exception using errcode = 'foreign_key_violation', message = 'reservation location does not belong to batch branch';
    end if;
    if new.inventory_unit_id is not null and not exists (
      select 1 from erp.inventory_units
      where id = new.inventory_unit_id and organization_id = new.organization_id
        and product_id = new.product_id and variant_id is not distinct from new.variant_id
    ) then
      raise exception using errcode = 'foreign_key_violation', message = 'reservation unit does not match product and variant';
    end if;
  elsif tg_table_name = 'inventory_counts' then
    if new.posted_document_id is not null and not exists (
      select 1 from erp.stock_documents
      where id = new.posted_document_id and organization_id = new.organization_id
        and branch_id = new.branch_id and kind = 'physical_count'
    ) then
      raise exception using errcode = 'foreign_key_violation', message = 'inventory count document does not match its branch and kind';
    end if;
  elsif tg_table_name = 'inventory_count_lines' then
    select branch_id, location_id into parent_branch_id, parent_location_id
    from erp.inventory_counts
    where id = new.count_id and organization_id = new.organization_id;
    if not found then
      raise exception using errcode = 'foreign_key_violation', message = 'inventory count not found';
    end if;
    if new.inventory_unit_id is not null and not exists (
      select 1 from erp.inventory_units unit
      join erp.locations location
        on location.id = unit.current_location_id and location.organization_id = unit.organization_id
      where unit.id = new.inventory_unit_id and unit.organization_id = new.organization_id
        and unit.product_id = new.product_id
        and unit.variant_id is not distinct from new.variant_id
        and unit.current_location_id = parent_location_id
        and location.branch_id = parent_branch_id
    ) then
      raise exception using errcode = 'foreign_key_violation', message = 'counted unit does not belong to the count location';
    end if;
  end if;
  return new;
end;
$$;

create or replace function erp.prevent_branch_inventory_deactivation()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog
as $$
begin
  if old.is_active and not new.is_active and (
    exists (
      select 1 from erp.stock_reservation_batches
      where organization_id = old.organization_id and branch_id = old.id and status = 'active'
    ) or exists (
      select 1 from erp.stock_balances
      where organization_id = old.organization_id and branch_id = old.id
        and (quantity_on_hand <> 0 or quantity_reserved <> 0)
    )
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'branch inventory and active reservations must be cleared before deactivation';
  end if;
  return new;
end;
$$;

create trigger inventory_units_validate before insert or update on erp.inventory_units
for each row execute function erp.validate_inventory_unit();
create trigger stock_document_lines_validate before insert on erp.stock_document_lines
for each row execute function erp.validate_stock_relationships();
create trigger stock_movements_validate before insert on erp.stock_movements
for each row execute function erp.validate_stock_relationships();
create trigger stock_reservations_validate before insert on erp.stock_reservations
for each row execute function erp.validate_stock_relationships();
create trigger inventory_counts_validate before insert or update on erp.inventory_counts
for each row execute function erp.validate_stock_relationships();
create trigger inventory_count_lines_validate before insert or update on erp.inventory_count_lines
for each row execute function erp.validate_stock_relationships();
create trigger branches_inventory_deactivation before update of is_active on erp.branches
for each row execute function erp.prevent_branch_inventory_deactivation();

create trigger inventory_units_touch_updated_at before update on erp.inventory_units
for each row execute function erp.touch_updated_at();
create trigger reservation_batches_touch_updated_at before update on erp.stock_reservation_batches
for each row execute function erp.touch_updated_at();
create trigger inventory_counts_touch_updated_at before update on erp.inventory_counts
for each row execute function erp.touch_updated_at();

create trigger inventory_units_prevent_delete before delete on erp.inventory_units
for each row execute function erp.prevent_delete();
create trigger stock_documents_immutable before update or delete on erp.stock_documents
for each row execute function erp.protect_stock_document();
create trigger stock_document_lines_immutable before update or delete on erp.stock_document_lines
for each row execute function erp.protect_stock_document_line();
create trigger stock_movements_immutable before update or delete on erp.stock_movements
for each row execute function erp.prevent_delete();
create trigger stock_balances_prevent_delete before delete on erp.stock_balances
for each row execute function erp.prevent_delete();
create trigger reservation_batches_prevent_delete before delete on erp.stock_reservation_batches
for each row execute function erp.prevent_delete();
create trigger stock_reservations_immutable before update or delete on erp.stock_reservations
for each row execute function erp.prevent_delete();
create trigger inventory_counts_prevent_delete before delete on erp.inventory_counts
for each row execute function erp.prevent_delete();
create trigger inventory_count_lines_prevent_delete before delete on erp.inventory_count_lines
for each row execute function erp.prevent_delete();

create trigger inventory_units_audit after insert or update on erp.inventory_units
for each row execute function erp.audit_row_change();
create trigger stock_documents_audit after insert or update on erp.stock_documents
for each row execute function erp.audit_row_change();
create trigger reservation_batches_audit after insert or update on erp.stock_reservation_batches
for each row execute function erp.audit_row_change();
create trigger inventory_counts_audit after insert or update on erp.inventory_counts
for each row execute function erp.audit_row_change();

alter table erp.inventory_units enable row level security;
alter table erp.stock_documents enable row level security;
alter table erp.stock_document_lines enable row level security;
alter table erp.stock_movements enable row level security;
alter table erp.stock_balances enable row level security;
alter table erp.stock_reservation_batches enable row level security;
alter table erp.stock_reservations enable row level security;
alter table erp.inventory_counts enable row level security;
alter table erp.inventory_count_lines enable row level security;

create policy inventory_units_select on erp.inventory_units for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and (
    (current_location_id is null and erp.has_permission('stock.view'))
    or exists (
      select 1 from erp.locations l
      where l.id = current_location_id and l.organization_id = inventory_units.organization_id
        and erp.has_permission('stock.view', l.branch_id)
    )
  )
);
create policy stock_documents_select on erp.stock_documents for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('stock.view', branch_id));
create policy stock_document_lines_select on erp.stock_document_lines for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and exists (
    select 1 from erp.stock_documents d
    where d.id = document_id and d.organization_id = stock_document_lines.organization_id
      and erp.has_permission('stock.view', d.branch_id)
  )
);
create policy stock_movements_select on erp.stock_movements for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('stock.view', branch_id));
create policy stock_balances_select on erp.stock_balances for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('stock.view', branch_id));
create policy reservation_batches_select on erp.stock_reservation_batches for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('stock.view', branch_id));
create policy stock_reservations_select on erp.stock_reservations for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and exists (
    select 1 from erp.stock_reservation_batches b
    where b.id = batch_id and b.organization_id = stock_reservations.organization_id
      and erp.has_permission('stock.view', b.branch_id)
  )
);
create policy inventory_counts_select on erp.inventory_counts for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('stock.view', branch_id));
create policy inventory_count_lines_select on erp.inventory_count_lines for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and exists (
    select 1 from erp.inventory_counts c
    where c.id = count_id and c.organization_id = inventory_count_lines.organization_id
      and erp.has_permission('stock.view', c.branch_id)
  )
);

grant select on
  erp.stock_documents,
  erp.stock_balances,
  erp.stock_reservation_batches,
  erp.stock_reservations,
  erp.inventory_counts,
  erp.inventory_count_lines
to authenticated;

grant select (
  id, organization_id, product_id, variant_id, current_location_id,
  status, acquired_at, is_active,
  created_at, updated_at, created_by, updated_by
) on erp.inventory_units to authenticated;

grant select (
  id, organization_id, document_id, line_number, product_id, variant_id,
  inventory_unit_id, from_location_id, to_location_id, quantity, created_at
) on erp.stock_document_lines to authenticated;

grant select (
  id, organization_id, branch_id, document_id, document_line_id, product_id,
  variant_id, inventory_unit_id, location_id, quantity_delta, occurred_at, actor_id
) on erp.stock_movements to authenticated;

revoke all on
  erp.inventory_units,
  erp.stock_documents,
  erp.stock_document_lines,
  erp.stock_movements,
  erp.stock_balances,
  erp.stock_reservation_batches,
  erp.stock_reservations,
  erp.inventory_counts,
  erp.inventory_count_lines
from service_role;

grant select on
  erp.inventory_units,
  erp.stock_documents,
  erp.stock_document_lines,
  erp.stock_movements,
  erp.stock_balances,
  erp.stock_reservation_batches,
  erp.stock_reservations,
  erp.inventory_counts,
  erp.inventory_count_lines
to service_role;

revoke all on function erp.reservation_source_permission(text) from public, anon, authenticated, service_role;
revoke all on function erp.post_stock_document(erp.stock_document_kind, uuid, text, text, jsonb, boolean, text, uuid) from public, anon, service_role;
revoke all on function erp.create_stock_reservation(uuid, text, text, uuid, timestamptz, jsonb) from public, anon, service_role;
revoke all on function erp.release_stock_reservation(uuid, text) from public, anon, service_role;
revoke all on function erp.register_inventory_unit(uuid, uuid, text, text, numeric) from public, anon, service_role;
revoke all on function erp.fulfill_stock_reservation(uuid, text, text) from public, anon, service_role;
revoke all on function erp.expire_stock_reservations(uuid, integer) from public, anon, service_role;
revoke all on function erp.get_inventory_unit_identifiers(uuid) from public, anon, service_role;
revoke all on function erp.reverse_stock_document(uuid, text, text) from public, anon, service_role;
revoke all on function erp.protect_stock_document_line() from public, anon, authenticated, service_role;
revoke all on function erp.protect_stock_document() from public, anon, authenticated, service_role;
revoke all on function erp.validate_stock_relationships() from public, anon, authenticated, service_role;
revoke all on function erp.prevent_branch_inventory_deactivation() from public, anon, authenticated, service_role;
grant execute on function erp.post_stock_document(erp.stock_document_kind, uuid, text, text, jsonb, boolean, text, uuid) to authenticated;
grant execute on function erp.create_stock_reservation(uuid, text, text, uuid, timestamptz, jsonb) to authenticated;
grant execute on function erp.release_stock_reservation(uuid, text) to authenticated;
grant execute on function erp.register_inventory_unit(uuid, uuid, text, text, numeric) to authenticated;
grant execute on function erp.fulfill_stock_reservation(uuid, text, text) to authenticated;
grant execute on function erp.expire_stock_reservations(uuid, integer) to authenticated;
grant execute on function erp.get_inventory_unit_identifiers(uuid) to authenticated;
grant execute on function erp.reverse_stock_document(uuid, text, text) to authenticated;
