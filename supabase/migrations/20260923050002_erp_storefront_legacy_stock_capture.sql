-- Legacy storefront stock writes are captured only after an explicit bridge
-- activation. Installation alone does not change either inventory ledger.
create table erp.storefront_stock_capture (
  organization_id uuid primary key references erp.organizations(id) on delete restrict,
  enabled_at timestamptz not null default now()
);
alter table erp.storefront_stock_capture enable row level security;
revoke all on erp.storefront_stock_capture from public, anon, authenticated, service_role;

create or replace function erp.capture_storefront_stock_delta(
  p_product_id uuid, p_variant_id uuid, p_previous integer, p_current integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  target_org constant uuid := '10000000-0000-0000-0000-000000000001';
  target_branch constant uuid := '20000000-0000-0000-0000-000000000001';
  intake_location constant uuid := '30000000-0000-0000-0000-000000000001';
  delta integer := p_current - p_previous;
  erp_available numeric;
  remaining numeric;
  take_quantity numeric;
  source_balance record;
  document_id uuid;
  document_line_id uuid;
  line_number integer := 0;
  weighted_cost numeric(18, 4);
  previous_reason text;
  previous_capture_setting text;
begin
  if delta = 0 then return; end if;
  if p_previous is null or p_current is null or p_previous < 0 or p_current < 0 then
    raise exception using errcode = 'check_violation', message = 'storefront stock must be a nonnegative integer';
  end if;
  if not exists (select 1 from erp.storefront_stock_capture where organization_id = target_org)
     or not exists (select 1 from erp.storefront_stock_projection where organization_id = target_org) then
    return;
  end if;
  if not exists (
    select 1 from erp.products ep
    where ep.id = p_product_id and ep.organization_id = target_org
      and ep.item_kind = 'product' and ep.inventory_tracking = 'quantity' and ep.is_active
      and (p_variant_id is null or exists (
        select 1 from erp.product_variants ev
        where ev.id = p_variant_id and ev.product_id = ep.id
          and ev.organization_id = target_org and ev.is_active
      ))
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'storefront stock item must be mapped to an active quantity-tracked ERP item';
  end if;
  if session_user <> 'postgres'
     and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and (auth.uid() is null
       or not erp.has_permission('stock.adjust', target_branch)
       or not erp.has_permission('stock.move', target_branch)
       or (delta > 0 and not erp.has_permission('costs.manage', target_branch))) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'ERP stock adjustment permission is required for legacy stock updates';
  end if;

  -- A historical storefront row must agree with ERP before applying its delta.
  -- This check refuses to compound an out-of-band write or a stale client edit.
  select greatest(coalesce(sum(b.quantity_on_hand - b.quantity_reserved), 0), 0)
    into erp_available
  from erp.stock_balances b
  join erp.locations l on l.id = b.location_id and l.organization_id = b.organization_id
  where b.organization_id = target_org and b.product_id = p_product_id
    and b.variant_id is not distinct from p_variant_id
    and l.is_active and l.contributes_to_web_stock;
  if erp_available <> p_previous then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'storefront stock differs from ERP; reconcile before changing it';
  end if;
  if exists (
    select 1 from erp.stock_balances b
    join erp.locations l on l.id = b.location_id and l.organization_id = b.organization_id
    where b.organization_id = target_org and b.product_id = p_product_id
      and b.variant_id is not distinct from p_variant_id
      and l.is_active and l.contributes_to_web_stock
      and b.branch_id <> target_branch
      and b.quantity_on_hand <> 0
  ) then
    raise exception using errcode = 'feature_not_supported',
      message = 'legacy stock capture cannot adjust inventory across ERP branches';
  end if;
  if not exists (
    select 1 from erp.locations
    where id = intake_location and organization_id = target_org
      and branch_id = target_branch and is_active and contributes_to_web_stock
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'ERP web intake location is not active';
  end if;

  previous_reason := current_setting('erp.operation_reason', true);
  previous_capture_setting := current_setting('erp.applying_legacy_stock', true);
  perform set_config('erp.operation_reason', 'Ajuste de stock desde panel anterior', true);
  perform set_config('erp.applying_legacy_stock', 'on', true);

  insert into erp.stock_documents (
    organization_id, branch_id, kind, idempotency_key, request_hash,
    reason, source_type, source_id, posted_by
  ) values (
    target_org, target_branch, 'adjustment',
    'storefront-legacy-' || gen_random_uuid()::text,
    md5(jsonb_build_object('product', p_product_id, 'variant', p_variant_id,
      'before', p_previous, 'after', p_current, 'transaction', txid_current())::text),
    'Ajuste de stock desde panel anterior', 'storefront_legacy_stock',
    coalesce(p_variant_id, p_product_id), auth.uid()
  ) returning id into document_id;

  if delta > 0 then
    select coalesce(weighted_average_cost, 0) into weighted_cost
    from erp.inventory_cost_balances
    where organization_id = target_org and branch_id = target_branch
      and product_id = p_product_id
      and variant_key = coalesce(p_variant_id, '00000000-0000-0000-0000-000000000000'::uuid);
    weighted_cost := coalesce(weighted_cost, 0);
    insert into erp.stock_document_lines (
      organization_id, document_id, line_number, product_id, variant_id,
      to_location_id, quantity, unit_cost
    ) values (
      target_org, document_id, 1, p_product_id, p_variant_id,
      intake_location, delta, weighted_cost
    ) returning id into document_line_id;
    insert into erp.stock_movements (
      organization_id, branch_id, document_id, document_line_id,
      product_id, variant_id, location_id, quantity_delta, unit_cost, actor_id
    ) values (
      target_org, target_branch, document_id, document_line_id,
      p_product_id, p_variant_id, intake_location, delta, weighted_cost, auth.uid()
    );
    insert into erp.stock_balances (
      organization_id, branch_id, location_id, product_id, variant_id, quantity_on_hand
    ) values (
      target_org, target_branch, intake_location, p_product_id, p_variant_id, delta
    ) on conflict (organization_id, location_id, product_id, variant_key) do update
      set quantity_on_hand = erp.stock_balances.quantity_on_hand + excluded.quantity_on_hand,
          updated_at = now();
  else
    remaining := -delta;
    for source_balance in
      select b.id, b.location_id,
        greatest(b.quantity_on_hand - b.quantity_reserved, 0) as available
      from erp.stock_balances b
      join erp.locations l on l.id = b.location_id and l.organization_id = b.organization_id
      where b.organization_id = target_org and b.branch_id = target_branch
        and b.product_id = p_product_id
        and b.variant_id is not distinct from p_variant_id
        and l.is_active and l.contributes_to_web_stock
      order by b.location_id
      for update of b
    loop
      exit when remaining = 0;
      take_quantity := least(remaining, source_balance.available);
      if take_quantity <= 0 then continue; end if;
      line_number := line_number + 1;
      if line_number > 250 then
        raise exception using errcode = 'program_limit_exceeded',
          message = 'legacy stock adjustment exceeds 250 location lines';
      end if;
      insert into erp.stock_document_lines (
        organization_id, document_id, line_number, product_id, variant_id,
        from_location_id, quantity, unit_cost
      ) values (
        target_org, document_id, line_number, p_product_id, p_variant_id,
        source_balance.location_id, take_quantity, 0
      ) returning id into document_line_id;
      update erp.stock_balances
        set quantity_on_hand = quantity_on_hand - take_quantity, updated_at = now()
        where id = source_balance.id
          and quantity_on_hand - quantity_reserved >= take_quantity;
      if not found then
        raise exception using errcode = 'check_violation',
          message = 'ERP available stock changed during legacy adjustment';
      end if;
      insert into erp.stock_movements (
        organization_id, branch_id, document_id, document_line_id,
        product_id, variant_id, location_id, quantity_delta, unit_cost, actor_id
      ) values (
        target_org, target_branch, document_id, document_line_id,
        p_product_id, p_variant_id, source_balance.location_id,
        -take_quantity, 0, auth.uid()
      );
      remaining := remaining - take_quantity;
    end loop;
    if remaining <> 0 then
      raise exception using errcode = 'check_violation',
        message = 'insufficient ERP web stock for legacy adjustment';
    end if;
  end if;

  perform erp.process_stock_document_costs(document_id);
  perform set_config('erp.operation_reason', coalesce(previous_reason, ''), true);
  perform set_config('erp.applying_legacy_stock', coalesce(previous_capture_setting, ''), true);
end;
$$;

create or replace function erp.capture_storefront_stock_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
declare
  target_org constant uuid := '10000000-0000-0000-0000-000000000001';
  variant_total integer;
  parent_stock integer;
  previous_capture_setting text;
begin
  if current_setting('erp.projecting_storefront_stock', true) = 'on'
     or current_setting('erp.applying_legacy_stock', true) = 'on'
     or not exists (select 1 from erp.storefront_stock_capture where organization_id = target_org)
     or not exists (select 1 from erp.storefront_stock_projection where organization_id = target_org) then
    return new;
  end if;

  if tg_table_name = 'products' then
    if tg_op = 'UPDATE' and new.stock is not distinct from old.stock then return new; end if;
    if exists (select 1 from public.product_variants where product_id = new.id) then
      select coalesce(sum(stock), 0) into variant_total
      from public.product_variants where product_id = new.id;
      if new.stock <> variant_total then
        raise exception using errcode = 'check_violation',
          message = 'parent product stock must equal the sum of its variants';
      end if;
      if tg_op = 'UPDATE' then return new; end if;
    end if;
    perform erp.capture_storefront_stock_delta(
      new.id, null, case when tg_op = 'INSERT' then 0 else old.stock end, new.stock
    );
    return new;
  end if;

  if tg_op = 'UPDATE' and new.product_id is distinct from old.product_id then
    raise exception using errcode = 'feature_not_supported',
      message = 'moving a storefront variant between products requires ERP migration';
  end if;
  if new.product_id is null then
    raise exception using errcode = 'check_violation',
      message = 'storefront stock variant requires a parent product';
  end if;
  if tg_op = 'UPDATE' and new.stock is not distinct from old.stock then return new; end if;

  select stock into parent_stock from public.products where id = new.product_id for update;
  if not found then
    raise exception using errcode = 'foreign_key_violation', message = 'variant parent product not found';
  end if;
  select coalesce(sum(stock), 0) into variant_total
  from public.product_variants where product_id = new.product_id;
  if tg_op = 'INSERT' and parent_stock <> variant_total - new.stock then
    raise exception using errcode = 'feature_not_supported',
      message = 'adding a variant to a product with unvarianted stock requires ERP migration';
  end if;
  if tg_op = 'UPDATE' and parent_stock <> variant_total - (new.stock - old.stock) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'storefront parent and variant stock were already inconsistent';
  end if;

  perform erp.capture_storefront_stock_delta(
    new.product_id, new.id, case when tg_op = 'INSERT' then 0 else old.stock end, new.stock
  );
  previous_capture_setting := current_setting('erp.applying_legacy_stock', true);
  perform set_config('erp.applying_legacy_stock', 'on', true);
  update public.products set stock = variant_total where id = new.product_id;
  perform set_config('erp.applying_legacy_stock', coalesce(previous_capture_setting, ''), true);
  return new;
end;
$$;

-- AFTER names intentionally sort after a_storefront_catalog_sync, so new
-- public rows already have matching ERP catalog UUIDs before stock capture.
do $$ begin
  if to_regclass('public.products') is not null then
    execute 'create trigger z_storefront_stock_capture after insert or update of stock on public.products for each row execute function erp.capture_storefront_stock_row()';
  end if;
  if to_regclass('public.product_variants') is not null then
    execute 'create trigger z_storefront_stock_capture after insert or update of stock, product_id on public.product_variants for each row execute function erp.capture_storefront_stock_row()';
  end if;
end $$;

create or replace function erp.activate_storefront_stock_capture(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, erp, public, pg_temp
as $$
begin
  if current_user <> 'postgres' then
    raise exception using errcode = 'insufficient_privilege',
      message = 'storefront stock capture activation requires database owner';
  end if;
  if p_organization_id <> '10000000-0000-0000-0000-000000000001'::uuid
     or to_regclass('public.products') is null
     or to_regclass('public.product_variants') is null
     or not exists (
       select 1 from erp.configuration_values
       where organization_id = p_organization_id and branch_id is null
         and key = 'storefront.initial_catalog_import'
     ) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'storefront catalog opening import is required before stock capture';
  end if;
  lock table erp.stock_balances, public.products, public.product_variants
    in share row exclusive mode;
  if exists (
    select 1 from public.products p
    left join erp.products ep on ep.id = p.id and ep.organization_id = p_organization_id
    where ep.id is null
  ) or exists (
    select 1 from public.product_variants v
    left join erp.product_variants ev
      on ev.id = v.id and ev.product_id = v.product_id
        and ev.organization_id = p_organization_id
    where ev.id is null
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'all storefront stock rows must be mapped to ERP before activation';
  end if;
  if exists (
    select 1 from public.products p
    where p.stock <> (
      select greatest(coalesce(sum(b.quantity_on_hand - b.quantity_reserved), 0), 0)
      from erp.stock_balances b
      join erp.locations l on l.id = b.location_id and l.organization_id = b.organization_id
      where b.organization_id = p_organization_id and b.product_id = p.id
        and l.is_active and l.contributes_to_web_stock
    )
  ) or exists (
    select 1 from public.product_variants v
    where v.stock <> (
      select greatest(coalesce(sum(b.quantity_on_hand - b.quantity_reserved), 0), 0)
      from erp.stock_balances b
      join erp.locations l on l.id = b.location_id and l.organization_id = b.organization_id
      where b.organization_id = p_organization_id
        and b.product_id = v.product_id and b.variant_id = v.id
        and l.is_active and l.contributes_to_web_stock
    )
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'storefront stock has changed since ERP import; reconcile before activation';
  end if;
  if not exists (select 1 from pg_trigger
    where tgrelid = 'public.products'::regclass and tgname = 'z_storefront_stock_capture') then
    execute 'create trigger z_storefront_stock_capture after insert or update of stock on public.products for each row execute function erp.capture_storefront_stock_row()';
  end if;
  if not exists (select 1 from pg_trigger
    where tgrelid = 'public.product_variants'::regclass and tgname = 'z_storefront_stock_capture') then
    execute 'create trigger z_storefront_stock_capture after insert or update of stock, product_id on public.product_variants for each row execute function erp.capture_storefront_stock_row()';
  end if;
  insert into erp.storefront_stock_capture (organization_id)
  values (p_organization_id)
  on conflict (organization_id) do nothing;
end;
$$;

revoke all on function erp.capture_storefront_stock_delta(uuid, uuid, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function erp.capture_storefront_stock_row()
  from public, anon, authenticated, service_role;
revoke all on function erp.activate_storefront_stock_capture(uuid)
  from public, anon, authenticated, service_role;
