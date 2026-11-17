alter function erp.post_purchase_receipt(uuid, text, text, jsonb, jsonb, boolean)
  rename to post_purchase_receipt_unchecked;

create or replace function erp.post_purchase_receipt(
  target_purchase_order_id uuid,
  operation_key text,
  operation_reason text,
  lines jsonb,
  expenses jsonb default '[]'::jsonb,
  create_payable boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  purchase_order erp.purchase_orders%rowtype;
  line jsonb;
  target_location_id uuid;
begin
  select * into purchase_order from erp.purchase_orders
  where id = target_purchase_order_id and organization_id = actor_organization_id;
  if not found then
    raise exception using errcode = 'no_data_found', message = 'purchase order not found';
  end if;

  if jsonb_typeof(lines) = 'array' then
    for line in select value from jsonb_array_elements(lines) loop
      target_location_id := nullif(line->>'to_location_id', '')::uuid;
      if exists (
        select 1 from erp.locations
        where id = target_location_id
          and organization_id = actor_organization_id
          and branch_id = purchase_order.branch_id
          and kind = 'quarantine'
      ) then
        raise exception using errcode = 'check_violation', message = 'purchase receipts cannot target quarantine locations';
      end if;
    end loop;
  end if;

  return erp.post_purchase_receipt_unchecked(
    target_purchase_order_id,
    operation_key,
    operation_reason,
    lines,
    expenses,
    create_payable
  );
end;
$$;

revoke all on function erp.post_purchase_receipt(uuid, text, text, jsonb, jsonb, boolean) from public, anon, service_role;
grant execute on function erp.post_purchase_receipt(uuid, text, text, jsonb, jsonb, boolean) to authenticated;
revoke all on function erp.post_purchase_receipt_unchecked(uuid, text, text, jsonb, jsonb, boolean) from public, anon, authenticated, service_role;
