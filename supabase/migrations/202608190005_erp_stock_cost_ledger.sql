alter table erp.stock_movements
  add constraint stock_movements_id_organization_unique unique (id, organization_id);

alter table erp.inventory_cost_entries
  add constraint inventory_cost_entries_id_organization_unique unique (id, organization_id);

create table erp.stock_cost_movements (
  id bigint generated always as identity primary key,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  document_id uuid not null,
  document_line_id uuid not null,
  source_stock_movement_id bigint not null,
  product_id uuid not null,
  variant_id uuid,
  inventory_unit_id uuid,
  location_id uuid not null,
  quantity_delta numeric(18, 4) not null check (
    quantity_delta <> 'NaN'::numeric and quantity_delta <> 0
  ),
  value_delta_base numeric(18, 4) not null check (
    value_delta_base <> 'NaN'::numeric
  ),
  unit_cost_snapshot numeric(24, 8) not null check (
    unit_cost_snapshot <> 'NaN'::numeric and unit_cost_snapshot >= 0
  ),
  reversal_of_cost_movement_id bigint,
  purchase_cost_entry_id bigint,
  occurred_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete restrict,
  constraint stock_cost_movements_id_organization_unique unique (id, organization_id),
  constraint stock_cost_movements_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint stock_cost_movements_document_fk foreign key (document_id, organization_id)
    references erp.stock_documents(id, organization_id) on delete restrict,
  constraint stock_cost_movements_line_fk foreign key (document_line_id, organization_id)
    references erp.stock_document_lines(id, organization_id) on delete restrict,
  constraint stock_cost_movements_source_movement_fk
    foreign key (source_stock_movement_id, organization_id)
    references erp.stock_movements(id, organization_id) on delete restrict,
  constraint stock_cost_movements_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint stock_cost_movements_variant_fk foreign key (variant_id, product_id, organization_id)
    references erp.product_variants(id, product_id, organization_id) on delete restrict,
  constraint stock_cost_movements_unit_fk foreign key (inventory_unit_id, organization_id)
    references erp.inventory_units(id, organization_id) on delete restrict,
  constraint stock_cost_movements_location_fk foreign key (location_id, organization_id, branch_id)
    references erp.locations(id, organization_id, branch_id) on delete restrict,
  constraint stock_cost_movements_reversal_fk
    foreign key (reversal_of_cost_movement_id, organization_id)
    references erp.stock_cost_movements(id, organization_id) on delete restrict,
  constraint stock_cost_movements_purchase_entry_fk
    foreign key (purchase_cost_entry_id, organization_id)
    references erp.inventory_cost_entries(id, organization_id) on delete restrict,
  constraint stock_cost_movements_source_unique unique (source_stock_movement_id),
  constraint stock_cost_movements_reversal_unique unique (reversal_of_cost_movement_id),
  constraint stock_cost_movements_purchase_entry_unique unique (purchase_cost_entry_id),
  constraint stock_cost_movements_value_sign check (
    value_delta_base = 0 or sign(value_delta_base) = sign(quantity_delta)
  ),
  constraint stock_cost_movements_reversal_shape check (
    reversal_of_cost_movement_id is null or purchase_cost_entry_id is null
  )
);

create index stock_cost_movements_document_idx
  on erp.stock_cost_movements (document_id, id);
create index stock_cost_movements_product_idx
  on erp.stock_cost_movements (
    organization_id, branch_id, product_id,
    coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid), id
  );

create or replace function erp.validate_stock_cost_movement()
returns trigger
language plpgsql
set search_path = erp, pg_catalog
as $$
begin
  if not exists (
    select 1 from erp.stock_movements movement
    where movement.id = new.source_stock_movement_id
      and movement.organization_id = new.organization_id
      and movement.branch_id = new.branch_id
      and movement.document_id = new.document_id
      and movement.document_line_id = new.document_line_id
      and movement.product_id = new.product_id
      and movement.variant_id is not distinct from new.variant_id
      and movement.inventory_unit_id is not distinct from new.inventory_unit_id
      and movement.location_id = new.location_id
      and movement.quantity_delta = new.quantity_delta
  ) then
    raise exception using errcode = 'foreign_key_violation',
      message = 'cost movement does not match its source stock movement';
  end if;

  if new.reversal_of_cost_movement_id is not null and not exists (
    select 1
    from erp.stock_cost_movements original
    join erp.stock_documents reversal_document
      on reversal_document.id = new.document_id
     and reversal_document.organization_id = new.organization_id
    where original.id = new.reversal_of_cost_movement_id
      and original.organization_id = new.organization_id
      and original.document_id = reversal_document.source_id
      and reversal_document.source_type in ('stock_document_reversal', 'stock_reversal')
      and original.product_id = new.product_id
      and original.variant_id is not distinct from new.variant_id
      and original.inventory_unit_id is not distinct from new.inventory_unit_id
      and original.location_id = new.location_id
      and original.quantity_delta = -new.quantity_delta
      and original.value_delta_base = -new.value_delta_base
      and original.unit_cost_snapshot = new.unit_cost_snapshot
  ) then
    raise exception using errcode = 'check_violation',
      message = 'cost reversal must be the exact opposite original fact';
  end if;

  if new.purchase_cost_entry_id is not null and not exists (
    select 1
    from erp.inventory_cost_entries entry
    join erp.purchase_receipts receipt
      on receipt.id = entry.receipt_id
     and receipt.organization_id = entry.organization_id
    where entry.id = new.purchase_cost_entry_id
      and entry.organization_id = new.organization_id
      and entry.branch_id = new.branch_id
      and receipt.stock_document_id = new.document_id
      and entry.product_id = new.product_id
      and entry.variant_id is not distinct from new.variant_id
      and entry.inventory_unit_id is not distinct from new.inventory_unit_id
      and entry.quantity_delta = new.quantity_delta
      and entry.total_cost_base = new.value_delta_base
      and entry.unit_cost_base = new.unit_cost_snapshot
  ) then
    raise exception using errcode = 'check_violation',
      message = 'purchase cost movement must match its authoritative receipt cost entry';
  end if;
  return new;
end;
$$;

create or replace function erp.audit_stock_cost_movement()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
begin
  insert into erp.audit_events (
    organization_id, branch_id, actor_user_id, schema_name, table_name,
    record_id, action, reason, metadata
  ) values (
    new.organization_id, new.branch_id, auth.uid(), 'erp', 'stock_cost_movements',
    new.id::text, 'insert', nullif(current_setting('erp.operation_reason', true), ''),
    jsonb_build_object(
      'source_stock_movement_id', new.source_stock_movement_id,
      'document_id', new.document_id,
      'redacted', true
    )
  );
  return null;
end;
$$;

create or replace function erp.record_purchase_receipt_cost_entry(target_cost_entry_id bigint)
returns void
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  cost_entry erp.inventory_cost_entries%rowtype;
  source_movement erp.stock_movements%rowtype;
begin
  if exists (
    select 1 from erp.stock_cost_movements
    where purchase_cost_entry_id = target_cost_entry_id
  ) then
    return;
  end if;

  select * into cost_entry
  from erp.inventory_cost_entries
  where id = target_cost_entry_id;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'purchase cost entry not found';
  end if;

  select movement.* into source_movement
  from erp.purchase_receipts receipt
  join erp.stock_movements movement
    on movement.document_id = receipt.stock_document_id
   and movement.organization_id = receipt.organization_id
  where receipt.id = cost_entry.receipt_id
    and receipt.organization_id = cost_entry.organization_id
    and movement.branch_id = cost_entry.branch_id
    and movement.product_id = cost_entry.product_id
    and movement.variant_id is not distinct from cost_entry.variant_id
    and movement.inventory_unit_id is not distinct from cost_entry.inventory_unit_id
    and movement.quantity_delta = cost_entry.quantity_delta
    and not exists (
      select 1 from erp.stock_cost_movements existing
      where existing.source_stock_movement_id = movement.id
    )
  order by movement.id
  limit 1;

  if source_movement.id is null then
    raise exception using errcode = 'data_exception',
      message = 'purchase cost entry has no unmatched stock movement';
  end if;

  insert into erp.stock_cost_movements (
    organization_id, branch_id, document_id, document_line_id,
    source_stock_movement_id, product_id, variant_id, inventory_unit_id,
    location_id, quantity_delta, value_delta_base, unit_cost_snapshot,
    purchase_cost_entry_id, occurred_at, actor_id
  ) values (
    cost_entry.organization_id, cost_entry.branch_id, source_movement.document_id,
    source_movement.document_line_id, source_movement.id, cost_entry.product_id,
    cost_entry.variant_id, cost_entry.inventory_unit_id, source_movement.location_id,
    cost_entry.quantity_delta, cost_entry.total_cost_base, cost_entry.unit_cost_base,
    cost_entry.id, cost_entry.occurred_at, source_movement.actor_id
  );
end;
$$;

create or replace function erp.capture_purchase_receipt_cost_movement()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
begin
  perform erp.record_purchase_receipt_cost_entry(new.id);
  return null;
end;
$$;

create trigger stock_cost_movements_validate
before insert on erp.stock_cost_movements
for each row execute function erp.validate_stock_cost_movement();

create trigger stock_cost_movements_immutable
before update or delete on erp.stock_cost_movements
for each row execute function erp.prevent_fact_mutation();

create trigger stock_cost_movements_audit
after insert on erp.stock_cost_movements
for each row execute function erp.audit_stock_cost_movement();

create trigger inventory_cost_entries_stock_cost_bridge
after insert on erp.inventory_cost_entries
for each row execute function erp.capture_purchase_receipt_cost_movement();

create or replace function erp.process_stock_document_costs(target_document_id uuid)
returns void
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  target_document erp.stock_documents%rowtype;
  movement_row record;
  tracking_mode erp.inventory_tracking_mode;
  balance_row erp.inventory_cost_balances%rowtype;
  movement_value numeric(18, 4);
  movement_unit_cost numeric(24, 8);
  unit_acquisition_cost numeric(18, 4);
  original_cost erp.stock_cost_movements%rowtype;
begin
  select * into target_document
  from erp.stock_documents
  where id = target_document_id;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'stock document not found for cost processing';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    target_document.organization_id::text || ':' || target_document.branch_id::text, 0
  ));

  if target_document.kind = 'receipt'
    and target_document.source_type = 'purchase_receipt' then
    return;
  end if;

  for movement_row in
    select movement.*, line.unit_cost as trusted_unit_cost, product.inventory_tracking
    from erp.stock_movements movement
    join erp.stock_document_lines line
      on line.id = movement.document_line_id
     and line.organization_id = movement.organization_id
    join erp.products product
      on product.id = movement.product_id
     and product.organization_id = movement.organization_id
    where movement.document_id = target_document_id
      and not exists (
        select 1 from erp.stock_cost_movements existing
        where existing.source_stock_movement_id = movement.id
      )
    order by line.line_number, movement.quantity_delta, movement.id
  loop
    tracking_mode := movement_row.inventory_tracking;
    movement_value := null;
    movement_unit_cost := null;

    if target_document.source_type in ('stock_document_reversal', 'stock_reversal') then
      select original.* into original_cost
      from erp.stock_cost_movements original
      where original.document_id = target_document.source_id
        and original.organization_id = target_document.organization_id
        and original.product_id = movement_row.product_id
        and original.variant_id is not distinct from movement_row.variant_id
        and original.inventory_unit_id is not distinct from movement_row.inventory_unit_id
        and original.location_id = movement_row.location_id
        and original.quantity_delta = -movement_row.quantity_delta
        and not exists (
          select 1 from erp.stock_cost_movements reversal
          where reversal.reversal_of_cost_movement_id = original.id
        )
      order by original.id
      limit 1;
      if original_cost.id is null then
        raise exception using errcode = 'data_exception',
          message = 'original cost movement is missing or already reversed';
      end if;
      movement_value := -original_cost.value_delta_base;
      movement_unit_cost := original_cost.unit_cost_snapshot;
    elsif tracking_mode in ('serial', 'imei') then
      select acquisition_cost into unit_acquisition_cost
      from erp.inventory_units
      where id = movement_row.inventory_unit_id
        and organization_id = movement_row.organization_id;
      if not found or unit_acquisition_cost is null
        or unit_acquisition_cost = 'NaN'::numeric then
        raise exception using errcode = 'data_exception',
          message = 'serialized inventory unit has no consistent acquisition cost';
      end if;
      if movement_row.quantity_delta > 0
        and target_document.kind <> 'transfer'
        and movement_row.trusted_unit_cost <> unit_acquisition_cost then
        raise exception using errcode = 'check_violation',
          message = 'serialized stock line cost must match the persisted acquisition cost';
      end if;
      movement_unit_cost := unit_acquisition_cost;
      movement_value := case when movement_row.quantity_delta > 0
        then unit_acquisition_cost else -unit_acquisition_cost end;
    elsif movement_row.quantity_delta > 0 then
      if target_document.kind = 'transfer' then
        select abs(value_delta_base), unit_cost_snapshot
        into movement_value, movement_unit_cost
        from erp.stock_cost_movements
        where document_line_id = movement_row.document_line_id
          and quantity_delta < 0;
        if movement_value is null then
          raise exception using errcode = 'data_exception',
            message = 'transfer outbound cost must be processed before inbound cost';
        end if;
      else
        movement_unit_cost := movement_row.trusted_unit_cost;
        movement_value := round(movement_row.quantity_delta * movement_unit_cost, 4);
      end if;
    else
      insert into erp.inventory_cost_balances (
        organization_id, branch_id, product_id, variant_id,
        valued_quantity, total_cost_base, weighted_average_cost
      ) values (
        movement_row.organization_id, movement_row.branch_id, movement_row.product_id,
        movement_row.variant_id, 0, 0, 0
      ) on conflict (organization_id, branch_id, product_id, variant_key) do nothing;

      select * into balance_row
      from erp.inventory_cost_balances
      where organization_id = movement_row.organization_id
        and branch_id = movement_row.branch_id
        and product_id = movement_row.product_id
        and variant_key = coalesce(
          movement_row.variant_id,
          '00000000-0000-0000-0000-000000000000'::uuid
        )
      for update;

      if balance_row.valued_quantity < abs(movement_row.quantity_delta) then
        raise exception using errcode = 'check_violation',
          message = 'insufficient valued quantity for stock movement';
      end if;
      if balance_row.valued_quantity = abs(movement_row.quantity_delta) then
        movement_value := -balance_row.total_cost_base;
      else
        movement_value := -round(
          abs(movement_row.quantity_delta) * balance_row.weighted_average_cost, 4
        );
      end if;
      if abs(movement_value) > balance_row.total_cost_base then
        raise exception using errcode = 'check_violation',
          message = 'insufficient valued amount for stock movement';
      end if;
      movement_unit_cost := case when movement_row.quantity_delta = 0 then 0
        else round(abs(movement_value / movement_row.quantity_delta), 8) end;
    end if;

    if tracking_mode = 'quantity' then
      if movement_row.quantity_delta > 0 then
        insert into erp.inventory_cost_balances (
          organization_id, branch_id, product_id, variant_id,
          valued_quantity, total_cost_base, weighted_average_cost
        ) values (
          movement_row.organization_id, movement_row.branch_id, movement_row.product_id,
          movement_row.variant_id, movement_row.quantity_delta, movement_value,
          case when movement_row.quantity_delta = 0 then 0
            else round(movement_value / movement_row.quantity_delta, 4) end
        ) on conflict (organization_id, branch_id, product_id, variant_key) do update
        set valued_quantity = erp.inventory_cost_balances.valued_quantity + excluded.valued_quantity,
            total_cost_base = erp.inventory_cost_balances.total_cost_base + excluded.total_cost_base,
            weighted_average_cost = case
              when erp.inventory_cost_balances.valued_quantity + excluded.valued_quantity = 0 then 0
              else round(
                (erp.inventory_cost_balances.total_cost_base + excluded.total_cost_base)
                / (erp.inventory_cost_balances.valued_quantity + excluded.valued_quantity), 4
              )
            end,
            updated_at = now();
      else
        update erp.inventory_cost_balances
        set valued_quantity = valued_quantity + movement_row.quantity_delta,
            total_cost_base = total_cost_base + movement_value,
            weighted_average_cost = case
              when valued_quantity + movement_row.quantity_delta = 0 then 0
              else round(
                (total_cost_base + movement_value)
                / (valued_quantity + movement_row.quantity_delta), 4
              )
            end,
            updated_at = now()
        where organization_id = movement_row.organization_id
          and branch_id = movement_row.branch_id
          and product_id = movement_row.product_id
          and variant_key = coalesce(
            movement_row.variant_id,
            '00000000-0000-0000-0000-000000000000'::uuid
          )
          and valued_quantity + movement_row.quantity_delta >= 0
          and total_cost_base + movement_value >= 0;
        if not found then
          raise exception using errcode = 'check_violation',
            message = 'cost valuation cannot become negative';
        end if;
      end if;
    end if;

    insert into erp.stock_cost_movements (
      organization_id, branch_id, document_id, document_line_id,
      source_stock_movement_id, product_id, variant_id, inventory_unit_id,
      location_id, quantity_delta, value_delta_base, unit_cost_snapshot,
      reversal_of_cost_movement_id, occurred_at, actor_id
    ) values (
      movement_row.organization_id, movement_row.branch_id, movement_row.document_id,
      movement_row.document_line_id, movement_row.id, movement_row.product_id,
      movement_row.variant_id, movement_row.inventory_unit_id, movement_row.location_id,
      movement_row.quantity_delta, movement_value, movement_unit_cost,
      case when target_document.source_type in ('stock_document_reversal', 'stock_reversal')
        then original_cost.id end,
      movement_row.occurred_at, movement_row.actor_id
    );
  end loop;
end;
$$;

alter function erp.post_stock_document(
  erp.stock_document_kind, uuid, text, text, jsonb, boolean, text, uuid
) rename to post_stock_document_stage4_core;

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
  posted_document_id uuid;
begin
  if source_type in ('stock_document_reversal', 'stock_reversal') then
    raise exception using errcode = 'insufficient_privilege',
      message = 'stock reversals must be posted through reverse_stock_document';
  end if;
  if source_type = 'purchase_receipt' and document_kind <> 'receipt' then
    raise exception using errcode = 'invalid_parameter_value',
      message = 'purchase_receipt is reserved for receipt documents';
  end if;
  if source_type is distinct from 'purchase_receipt'
    and document_kind <> 'transfer'
    and jsonb_typeof(lines) = 'array'
    and exists (
      select 1 from jsonb_array_elements(lines) line
      where nullif(line->>'to_location_id', '') is not null
        and nullif(line->>'from_location_id', '') is null
    )
    and not erp.has_permission('costs.manage', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'costs.manage permission is required for inbound stock valuation';
  end if;
  posted_document_id := erp.post_stock_document_stage4_core(
    document_kind, target_branch_id, operation_key, operation_reason, lines,
    allow_negative, source_type, source_id
  );
  perform erp.process_stock_document_costs(posted_document_id);
  return posted_document_id;
end;
$$;

alter function erp.fulfill_stock_reservation(uuid, text, text)
rename to fulfill_stock_reservation_core;

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
  posted_document_id uuid;
begin
  posted_document_id := erp.fulfill_stock_reservation_core(
    target_batch_id, operation_key, operation_reason
  );
  perform erp.process_stock_document_costs(posted_document_id);
  return posted_document_id;
end;
$$;

create or replace function erp.reverse_stock_document_core(
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
  legacy_reversal_request_hash text;
  unit_state_row record;
begin
  if nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'operation key and reason are required';
  end if;
  select * into original_document from erp.stock_documents
  where id = original_document_id and organization_id = actor_organization_id;
  if not found then raise exception using errcode = 'no_data_found', message = 'stock document not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    actor_organization_id::text || ':' || original_document.branch_id::text, 0
  ));
  select * into original_document from erp.stock_documents
  where id = original_document_id and organization_id = actor_organization_id for update;
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
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'product_id', line.product_id, 'variant_id', line.variant_id,
    'inventory_unit_id', line.inventory_unit_id,
    'from_location_id', line.to_location_id, 'to_location_id', line.from_location_id,
    'quantity', line.quantity, 'unit_cost', line.unit_cost
  )) order by line.line_number) into reversal_lines
  from erp.stock_document_lines line
  where line.document_id = original_document_id
    and line.organization_id = actor_organization_id;
  if reversal_lines is null then
    raise exception using errcode = 'data_exception', message = 'stock document has no lines';
  end if;

  reversal_request_hash := md5(jsonb_build_object(
    'kind', reversal_kind, 'branch_id', original_document.branch_id,
    'reason', operation_reason, 'lines', reversal_lines, 'allow_negative', false,
    'source_type', 'stock_document_reversal', 'source_id', original_document_id
  )::text);
  legacy_reversal_request_hash := md5(jsonb_build_object(
    'kind', reversal_kind, 'branch_id', original_document.branch_id,
    'reason', operation_reason, 'lines', reversal_lines, 'allow_negative', false,
    'source_type', 'stock_reversal', 'source_id', original_document_id
  )::text);
  if exists (select 1 from erp.stock_documents where reversed_document_id = original_document_id) then
    select id into reversal_document_id from erp.stock_documents
    where reversed_document_id = original_document_id
      and idempotency_key = operation_key
      and (
        (source_type = 'stock_document_reversal' and request_hash = reversal_request_hash)
        or (source_type = 'stock_reversal' and request_hash = legacy_reversal_request_hash)
      );
    if reversal_document_id is not null then return reversal_document_id; end if;
    raise exception using errcode = 'integrity_constraint_violation', message = 'stock reversal retry does not match the original request';
  end if;

  reversal_document_id := erp.post_stock_document_stage4_core(
    reversal_kind, original_document.branch_id, operation_key, operation_reason,
    reversal_lines, false, 'stock_document_reversal', original_document_id
  );
  perform erp.process_stock_document_costs(reversal_document_id);
  perform set_config('erp.allow_stock_line_state_restore', 'on', true);
  for unit_state_row in
    select reversal_line.id as reversal_line_id, reversal_line.inventory_unit_id,
      case when original_document.kind = 'reservation_fulfillment'
        then 'available'::erp.inventory_unit_status else original_line.unit_status_before end as restored_status
    from erp.stock_document_lines reversal_line
    join erp.stock_document_lines original_line
      on original_line.document_id = original_document_id
     and original_line.line_number = reversal_line.line_number
     and original_line.organization_id = reversal_line.organization_id
    where reversal_line.document_id = reversal_document_id
      and reversal_line.organization_id = actor_organization_id
      and reversal_line.inventory_unit_id is not null
  loop
    update erp.inventory_units set status = unit_state_row.restored_status, updated_by = auth.uid()
    where id = unit_state_row.inventory_unit_id and organization_id = actor_organization_id;
    if not found then raise exception using errcode = 'data_exception', message = 'reversal inventory unit state could not be restored'; end if;
    update erp.stock_document_lines set unit_status_after = unit_state_row.restored_status
    where id = unit_state_row.reversal_line_id and organization_id = actor_organization_id;
  end loop;
  perform set_config('erp.allow_stock_line_state_restore', 'off', true);
  perform set_config('erp.allow_stock_document_link', 'on', true);
  update erp.stock_documents set status = 'reversed', reversed_document_id = original_document_id
  where id = reversal_document_id and organization_id = actor_organization_id
    and status = 'posted' and reversed_document_id is null;
  perform set_config('erp.allow_stock_document_link', 'off', true);
  if not found then raise exception using errcode = 'data_exception', message = 'reversal document could not be linked'; end if;
  return reversal_document_id;
end;
$$;

alter table erp.stock_cost_movements enable row level security;

create policy stock_cost_movements_select on erp.stock_cost_movements
for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and erp.has_permission('costs.view', branch_id)
);

revoke all on erp.stock_cost_movements from public, anon, authenticated, service_role;
grant select on erp.stock_cost_movements to authenticated, service_role;
revoke all on sequence erp.stock_cost_movements_id_seq from public, anon, authenticated, service_role;

revoke all on function erp.audit_stock_cost_movement() from public, anon, authenticated, service_role;
revoke all on function erp.validate_stock_cost_movement() from public, anon, authenticated, service_role;
revoke all on function erp.record_purchase_receipt_cost_entry(bigint) from public, anon, authenticated, service_role;
revoke all on function erp.capture_purchase_receipt_cost_movement() from public, anon, authenticated, service_role;
revoke all on function erp.process_stock_document_costs(uuid) from public, anon, authenticated, service_role;
revoke all on function erp.post_stock_document_stage4_core(
  erp.stock_document_kind, uuid, text, text, jsonb, boolean, text, uuid
) from public, anon, authenticated, service_role;
revoke all on function erp.fulfill_stock_reservation_core(uuid, text, text)
from public, anon, authenticated, service_role;
revoke all on function erp.reverse_stock_document_core(uuid, text, text)
from public, anon, authenticated, service_role;
revoke all on function erp.post_stock_document(
  erp.stock_document_kind, uuid, text, text, jsonb, boolean, text, uuid
) from public, anon, service_role;
revoke all on function erp.fulfill_stock_reservation(uuid, text, text)
from public, anon, service_role;
grant execute on function erp.post_stock_document(
  erp.stock_document_kind, uuid, text, text, jsonb, boolean, text, uuid
) to authenticated;
grant execute on function erp.fulfill_stock_reservation(uuid, text, text) to authenticated;

do $$
declare
  entry_row record;
  document_row record;
begin
  perform set_config('erp.operation_reason', 'Stage 5 cost valuation rebuild', true);
  for entry_row in select id from erp.inventory_cost_entries order by id loop
    perform erp.record_purchase_receipt_cost_entry(entry_row.id);
  end loop;

  update erp.inventory_cost_balances
  set valued_quantity = 0, total_cost_base = 0, weighted_average_cost = 0, updated_at = now();

  for document_row in
    select document.id, document.source_type, document.source_id,
      document.organization_id, document.branch_id
    from erp.stock_documents document
    join lateral (
      select min(movement.id) as first_movement_id
      from erp.stock_movements movement
      where movement.document_id = document.id
        and movement.organization_id = document.organization_id
    ) sequence on sequence.first_movement_id is not null
    order by sequence.first_movement_id, document.id
  loop
    if document_row.source_type = 'purchase_receipt' then
      insert into erp.inventory_cost_balances (
        organization_id, branch_id, product_id, variant_id,
        valued_quantity, total_cost_base, weighted_average_cost
      )
      select entry.organization_id, entry.branch_id, entry.product_id, entry.variant_id,
        sum(entry.quantity_delta), sum(entry.total_cost_base),
        round(sum(entry.total_cost_base) / sum(entry.quantity_delta), 4)
      from erp.inventory_cost_entries entry
      join erp.products product
        on product.id = entry.product_id and product.organization_id = entry.organization_id
      where entry.receipt_id = document_row.source_id
        and product.inventory_tracking = 'quantity'
      group by entry.organization_id, entry.branch_id, entry.product_id, entry.variant_id
      on conflict (organization_id, branch_id, product_id, variant_key) do update
      set valued_quantity = erp.inventory_cost_balances.valued_quantity + excluded.valued_quantity,
          total_cost_base = erp.inventory_cost_balances.total_cost_base + excluded.total_cost_base,
          weighted_average_cost = round(
            (erp.inventory_cost_balances.total_cost_base + excluded.total_cost_base)
            / (erp.inventory_cost_balances.valued_quantity + excluded.valued_quantity), 4
          ),
          updated_at = now();
    else
      perform erp.process_stock_document_costs(document_row.id);
    end if;
  end loop;
end;
$$;

comment on table erp.stock_cost_movements is
  'Authoritative append-only stock valuation movements, one per physical stock movement.';
comment on table erp.inventory_cost_entries is
  'Authoritative append-only purchase receipt valuation facts bridged one-to-one to stock cost movements.';
