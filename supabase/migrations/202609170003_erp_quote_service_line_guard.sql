alter function erp.create_repair_quote_version(uuid, text, uuid, jsonb, text, text)
  rename to create_repair_quote_version_unchecked;

do $$
declare
  implementation text;
begin
  select pg_get_functiondef('erp.create_repair_quote_version_unchecked(uuid,text,uuid,jsonb,text,text)'::regprocedure)
    into implementation;
  implementation := replace(
    implementation,
    'create_repair_quote_version.quote_currency',
    'create_repair_quote_version_unchecked.quote_currency'
  );
  execute implementation;
end;
$$;

create or replace function erp.create_repair_quote_version(
  target_repair_order_id uuid,
  quote_currency text,
  target_exchange_snapshot_id uuid,
  lines jsonb,
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
  line jsonb;
  line_number bigint;
  target_product_id uuid;
begin
  if jsonb_typeof(lines) = 'array' then
    for line, line_number in
      select value, ordinality from jsonb_array_elements(lines) with ordinality
    loop
      if line->>'kind' = 'service' then
        target_product_id := nullif(line->>'product_id', '')::uuid;
        if target_product_id is null or not exists (
          select 1 from erp.products
          where id = target_product_id
            and organization_id = actor_organization_id
            and item_kind = 'service'
            and is_active
        ) then
          raise exception using errcode = 'foreign_key_violation', message = format('active repair service unavailable on quote line %s', line_number);
        end if;
      end if;
    end loop;
  end if;

  return erp.create_repair_quote_version_unchecked(
    target_repair_order_id,
    quote_currency,
    target_exchange_snapshot_id,
    lines,
    operation_key,
    operation_reason
  );
end;
$$;

revoke all on function erp.create_repair_quote_version(uuid, text, uuid, jsonb, text, text) from public, anon, service_role;
grant execute on function erp.create_repair_quote_version(uuid, text, uuid, jsonb, text, text) to authenticated;
revoke all on function erp.create_repair_quote_version_unchecked(uuid, text, uuid, jsonb, text, text) from public, anon, authenticated, service_role;
