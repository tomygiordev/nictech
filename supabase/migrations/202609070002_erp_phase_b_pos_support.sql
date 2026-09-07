-- 202609070002_erp_phase_b_pos_support.sql
-- FASE B & POS Support: Dynamic customer and session helpers for isolated variant sales

-- 1. Helper to get or create a POS customer by display name
create or replace function erp.get_or_create_pos_customer(
  p_display_name text default 'Consumidor Final'
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  v_org_id uuid := erp.current_organization_id();
  v_cust_id uuid;
  v_name text := coalesce(nullif(btrim(p_display_name), ''), 'Consumidor Final');
  v_code text;
begin
  if v_org_id is null then
    select id into v_org_id from erp.organizations limit 1;
  end if;

  if v_org_id is null then
    raise exception 'No organization found to attach POS customer';
  end if;

  select id into v_cust_id
  from erp.customers
  where organization_id = v_org_id
    and lower(btrim(display_name)) = lower(v_name)
    and is_active
  limit 1;

  if v_cust_id is not null then
    return v_cust_id;
  end if;

  v_code := 'CLI-' || substr(md5(v_name || gen_random_uuid()::text), 1, 6);

  insert into erp.customers (
    organization_id, code, display_name, is_active
  ) values (
    v_org_id, v_code, v_name, true
  ) returning id into v_cust_id;

  return v_cust_id;
end;
$$;

grant execute on function erp.get_or_create_pos_customer(text) to authenticated, service_role;

-- 2. Helper to get or open a POS cash session
create or replace function erp.get_or_open_pos_cash_session(
  target_branch_id uuid default '20000000-0000-0000-0000-000000000001'::uuid
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  v_org_id uuid := erp.current_organization_id();
  v_session_id uuid;
  v_register_id uuid;
begin
  if v_org_id is null then
    select id into v_org_id from erp.organizations limit 1;
  end if;

  if v_org_id is null then
    return null;
  end if;

  select s.id into v_session_id
  from erp.cash_sessions s
  where s.organization_id = v_org_id
    and s.branch_id = target_branch_id
    and not exists (
      select 1 from erp.cash_closures c where c.cash_session_id = s.id
    )
  order by s.opened_at desc
  limit 1;

  if v_session_id is not null then
    return v_session_id;
  end if;

  select id into v_register_id
  from erp.cash_registers
  where organization_id = v_org_id
    and branch_id = target_branch_id
    and is_active
  limit 1;

  if v_register_id is null then
    return null;
  end if;

  return erp.open_cash_session(
    v_register_id,
    'pos-auto-open-' || gen_random_uuid()::text,
    'Apertura automatica POS',
    jsonb_build_array(
      jsonb_build_object('currency_code', 'ARS', 'amount', 0)
    )
  );
end;
$$;

grant execute on function erp.get_or_open_pos_cash_session(uuid) to authenticated, service_role;
