create extension if not exists pgcrypto with schema extensions;

create schema if not exists erp;

comment on schema erp is
  'Private NicTech ERP domain. Exposed through PostgREST with RLS enforced on every table.';

create type erp.permission_effect as enum ('allow', 'deny');
create type erp.location_kind as enum (
  'store',
  'warehouse',
  'workshop',
  'repair_reserve',
  'web_reserve',
  'warranty',
  'transit',
  'quarantine',
  'other'
);

create table erp.organizations (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  display_name text not null,
  tax_id text,
  timezone text not null default 'America/Argentina/Buenos_Aires',
  default_currency text not null default 'ARS' check (default_currency ~ '^[A-Z]{3}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_legal_name_not_blank check (btrim(legal_name) <> ''),
  constraint organizations_display_name_not_blank check (btrim(display_name) <> '')
);

create table erp.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  code text not null,
  name text not null,
  address jsonb not null default '{}'::jsonb,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branches_code_not_blank check (btrim(code) <> ''),
  constraint branches_name_not_blank check (btrim(name) <> ''),
  constraint branches_id_organization_unique unique (id, organization_id),
  constraint branches_code_unique unique (organization_id, code)
);

create table erp.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null references erp.branches(id) on delete restrict,
  code text not null,
  name text not null,
  kind erp.location_kind not null,
  allows_sale boolean not null default false,
  allows_negative_stock boolean not null default false,
  contributes_to_web_stock boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint locations_code_not_blank check (btrim(code) <> ''),
  constraint locations_name_not_blank check (btrim(name) <> ''),
  constraint locations_branch_organization_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint locations_code_unique unique (organization_id, code)
);

create table erp.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  organization_id uuid references erp.organizations(id) on delete restrict,
  employee_code text,
  display_name text not null,
  phone text,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_not_blank check (btrim(display_name) <> ''),
  constraint profiles_id_organization_unique unique (id, organization_id),
  constraint profiles_employee_code_unique unique (organization_id, employee_code)
);

create table erp.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  code text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roles_code_not_blank check (btrim(code) <> ''),
  constraint roles_name_not_blank check (btrim(name) <> ''),
  constraint roles_id_organization_unique unique (id, organization_id),
  constraint roles_code_unique unique (organization_id, code)
);

create table erp.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  module text not null,
  name text not null,
  description text,
  is_sensitive boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint permissions_code_format check (code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  constraint permissions_module_not_blank check (btrim(module) <> ''),
  constraint permissions_name_not_blank check (btrim(name) <> '')
);

create table erp.role_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  role_id uuid not null,
  permission_id uuid not null references erp.permissions(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint role_permissions_role_organization_fk foreign key (role_id, organization_id)
    references erp.roles(id, organization_id) on delete restrict,
  constraint role_permissions_role_permission_unique unique (role_id, permission_id)
);

create table erp.profile_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  profile_id uuid not null,
  role_id uuid not null,
  branch_id uuid,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint profile_roles_profile_organization_fk foreign key (profile_id, organization_id)
    references erp.profiles(id, organization_id) on delete restrict,
  constraint profile_roles_role_organization_fk foreign key (role_id, organization_id)
    references erp.roles(id, organization_id) on delete restrict,
  constraint profile_roles_branch_organization_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint profile_roles_valid_range check (valid_until is null or valid_until > valid_from)
);

create unique index profile_roles_global_unique
  on erp.profile_roles (profile_id, role_id)
  where branch_id is null;

create unique index profile_roles_branch_unique
  on erp.profile_roles (profile_id, role_id, branch_id)
  where branch_id is not null;

create table erp.profile_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  profile_id uuid not null,
  permission_id uuid not null references erp.permissions(id) on delete restrict,
  branch_id uuid,
  effect erp.permission_effect not null,
  reason text not null,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint permission_override_profile_organization_fk foreign key (profile_id, organization_id)
    references erp.profiles(id, organization_id) on delete restrict,
  constraint permission_override_branch_organization_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint permission_override_reason_not_blank check (btrim(reason) <> ''),
  constraint permission_override_valid_range check (valid_until is null or valid_until > valid_from)
);

create unique index profile_permission_overrides_scope_unique
  on erp.profile_permission_overrides (
    profile_id,
    permission_id,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create table erp.configuration_values (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid references erp.branches(id) on delete restrict,
  key text not null,
  value jsonb not null,
  description text,
  is_secret boolean not null default false,
  is_system boolean not null default false,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint configuration_branch_organization_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint configuration_key_format check (key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')
);

create unique index configuration_values_scope_unique
  on erp.configuration_values (
    organization_id,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    key
  );

create table erp.audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid references erp.organizations(id) on delete restrict,
  branch_id uuid references erp.branches(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default clock_timestamp(),
  schema_name text not null,
  table_name text not null,
  record_id text,
  action text not null check (action in ('insert', 'update', 'delete', 'execute', 'approve', 'reject', 'reverse', 'login', 'logout', 'read_sensitive')),
  reason text,
  correlation_id uuid not null default gen_random_uuid(),
  request_id text,
  old_values jsonb,
  new_values jsonb,
  metadata jsonb not null default '{}'::jsonb,
  constraint audit_branch_requires_organization check (branch_id is null or organization_id is not null),
  constraint audit_branch_organization_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint audit_event_has_payload check (
    old_values is not null or new_values is not null or metadata <> '{}'::jsonb
  )
);

create index audit_events_org_time_idx
  on erp.audit_events (organization_id, occurred_at desc);
create index audit_events_record_idx
  on erp.audit_events (schema_name, table_name, record_id, occurred_at desc);
create index audit_events_actor_idx
  on erp.audit_events (actor_user_id, occurred_at desc);
create index audit_events_correlation_idx
  on erp.audit_events (correlation_id);

create or replace function erp.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = erp, pg_temp
as $$
  select organization_id
  from erp.profiles
  where id = auth.uid()
    and is_active;
$$;

create or replace function erp.has_permission(
  permission_code text,
  target_branch_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = erp, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  current_organization_id uuid;
  current_time timestamptz := now();
begin
  if auth.role() = 'service_role' then
    return true;
  end if;

  select profile.organization_id
  into current_organization_id
  from erp.profiles profile
  where profile.id = current_user_id
    and profile.is_active;

  if current_user_id is null or current_organization_id is null then
    return false;
  end if;

  if target_branch_id is not null and not exists (
    select 1
    from erp.branches branch
    where branch.id = target_branch_id
      and branch.organization_id = current_organization_id
      and branch.is_active
  ) then
    return false;
  end if;

  if exists (
    select 1
    from erp.profile_permission_overrides override_grant
    join erp.permissions permission on permission.id = override_grant.permission_id
    where override_grant.profile_id = current_user_id
      and override_grant.organization_id = current_organization_id
      and permission.code = permission_code
      and permission.is_active
      and override_grant.effect = 'deny'
      and override_grant.valid_from <= current_time
      and (override_grant.valid_until is null or override_grant.valid_until > current_time)
      and (override_grant.branch_id is null or override_grant.branch_id = target_branch_id)
  ) then
    return false;
  end if;

  if exists (
    select 1
    from erp.profile_permission_overrides override_grant
    join erp.permissions permission on permission.id = override_grant.permission_id
    where override_grant.profile_id = current_user_id
      and override_grant.organization_id = current_organization_id
      and permission.code = permission_code
      and permission.is_active
      and override_grant.effect = 'allow'
      and override_grant.valid_from <= current_time
      and (override_grant.valid_until is null or override_grant.valid_until > current_time)
      and (override_grant.branch_id is null or override_grant.branch_id = target_branch_id)
  ) then
    return true;
  end if;

  return exists (
    select 1
    from erp.profile_roles profile_role
    join erp.roles role on role.id = profile_role.role_id and role.is_active
    join erp.role_permissions role_permission
      on role_permission.role_id = role.id
      and role_permission.is_active
    join erp.permissions permission on permission.id = role_permission.permission_id
    where profile_role.profile_id = current_user_id
      and profile_role.organization_id = current_organization_id
      and role.organization_id = current_organization_id
      and permission.code = permission_code
      and permission.is_active
      and profile_role.valid_from <= current_time
      and (profile_role.valid_until is null or profile_role.valid_until > current_time)
      and (profile_role.branch_id is null or profile_role.branch_id = target_branch_id)
  );
end;
$$;

create or replace function erp.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function erp.prevent_delete()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = 'integrity_constraint_violation',
    message = format('%I.%I records must be deactivated or reversed, not deleted', tg_table_schema, tg_table_name);
end;
$$;

create or replace function erp.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = 'integrity_constraint_violation',
    message = 'audit events are append-only';
end;
$$;

create or replace function erp.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  old_row jsonb;
  new_row jsonb;
  row_id text;
  row_organization_id uuid;
  row_branch_id uuid;
  operation_reason text := nullif(current_setting('erp.operation_reason', true), '');
  operation_correlation text := nullif(current_setting('erp.correlation_id', true), '');
  audit_correlation_id uuid;
begin
  if tg_op = 'INSERT' then
    new_row := to_jsonb(new);
    row_id := new_row ->> 'id';
  elsif tg_op = 'UPDATE' then
    old_row := to_jsonb(old);
    new_row := to_jsonb(new);
    row_id := coalesce(new_row ->> 'id', old_row ->> 'id');
  else
    old_row := to_jsonb(old);
    row_id := old_row ->> 'id';
  end if;

  row_organization_id := coalesce(
    nullif(new_row ->> 'organization_id', '')::uuid,
    nullif(old_row ->> 'organization_id', '')::uuid,
    case
      when tg_table_name = 'organizations' then
        nullif(coalesce(new_row ->> 'id', old_row ->> 'id'), '')::uuid
    end,
    erp.current_organization_id()
  );
  row_branch_id := coalesce(
    nullif(new_row ->> 'branch_id', '')::uuid,
    nullif(old_row ->> 'branch_id', '')::uuid
  );

  if tg_table_name = 'inventory_units' and row_branch_id is null then
    select branch_id into row_branch_id
    from erp.locations
    where id = coalesce(
      nullif(new_row ->> 'current_location_id', '')::uuid,
      nullif(old_row ->> 'current_location_id', '')::uuid
    );
  end if;

  if tg_table_name = 'configuration_values' then
    if coalesce((old_row ->> 'is_secret')::boolean, false) then
      old_row := jsonb_set(old_row, '{value}', '"[redacted]"'::jsonb);
    end if;
    if coalesce((new_row ->> 'is_secret')::boolean, false) then
      new_row := jsonb_set(new_row, '{value}', '"[redacted]"'::jsonb);
    end if;
  end if;

  if tg_table_name = 'customer_private_details' then
    old_row := old_row
      - 'tax_id'
      - 'identity_document'
      - 'address'
      - 'internal_notes';
    new_row := new_row
      - 'tax_id'
      - 'identity_document'
      - 'address'
      - 'internal_notes';
  end if;

  if tg_table_name = 'inventory_units' then
    old_row := old_row
      - 'serial_number'
      - 'imei'
      - 'normalized_serial_number'
      - 'normalized_imei'
      - 'acquisition_cost';
    new_row := new_row
      - 'serial_number'
      - 'imei'
      - 'normalized_serial_number'
      - 'normalized_imei'
      - 'acquisition_cost';
  end if;

  if tg_table_name = 'products' then
    old_row := old_row - 'purchase_currency' - 'base_cost' - 'target_margin_percent';
    new_row := new_row - 'purchase_currency' - 'base_cost' - 'target_margin_percent';
  end if;

  if tg_table_name in ('purchase_orders', 'purchase_receipts') then
    old_row := old_row
      - 'exchange_rate'
      - 'goods_total_base'
      - 'expense_total_base'
      - 'landed_total_base';
    new_row := new_row
      - 'exchange_rate'
      - 'goods_total_base'
      - 'expense_total_base'
      - 'landed_total_base';
  end if;

  if tg_table_name in ('purchase_order_lines', 'purchase_receipt_lines') then
    old_row := old_row
      - 'unit_price'
      - 'tax_amount'
      - 'goods_cost_base'
      - 'allocated_expense_base'
      - 'landed_cost_base'
      - 'unit_landed_cost'
      - 'rounding_adjustment_base';
    new_row := new_row
      - 'unit_price'
      - 'tax_amount'
      - 'goods_cost_base'
      - 'allocated_expense_base'
      - 'landed_cost_base'
      - 'unit_landed_cost'
      - 'rounding_adjustment_base';
  end if;

  if tg_table_name in (
    'purchase_receipt_expenses', 'purchase_expense_allocations',
    'inventory_cost_entries', 'inventory_cost_balances',
    'serialized_acquisition_costs', 'supplier_payables',
    'supplier_account_entries', 'price_change_preview_lines', 'price_entries'
  ) then
    old_row := old_row
      - 'amount_base'
      - 'amount_currency'
      - 'amount_base_delta'
      - 'quantity_delta'
      - 'total_cost_base'
      - 'unit_cost_base'
      - 'valued_quantity'
      - 'weighted_average_cost'
      - 'acquisition_cost_base'
      - 'current_price'
      - 'proposed_price'
      - 'amount';
    new_row := new_row
      - 'amount_base'
      - 'amount_currency'
      - 'amount_base_delta'
      - 'quantity_delta'
      - 'total_cost_base'
      - 'unit_cost_base'
      - 'valued_quantity'
      - 'weighted_average_cost'
      - 'acquisition_cost_base'
      - 'current_price'
      - 'proposed_price'
      - 'amount';
  end if;

  audit_correlation_id := case
    when operation_correlation ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then operation_correlation::uuid
    else gen_random_uuid()
  end;

  insert into erp.audit_events (
    organization_id,
    branch_id,
    actor_user_id,
    schema_name,
    table_name,
    record_id,
    action,
    reason,
    correlation_id,
    request_id,
    old_values,
    new_values,
    metadata
  ) values (
    row_organization_id,
    row_branch_id,
    auth.uid(),
    tg_table_schema,
    tg_table_name,
    row_id,
    lower(tg_op),
    operation_reason,
    audit_correlation_id,
    nullif(current_setting('request.id', true), ''),
    old_row,
    new_row,
    jsonb_build_object('trigger', tg_name)
  );

  return null;
end;
$$;

create or replace function erp.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
begin
  insert into erp.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Usuario'
    )
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function erp.bootstrap_owner(
  auth_user_id uuid,
  target_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  owner_role_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'bootstrap_owner requires the service role';
  end if;

  select role.id
  into owner_role_id
  from erp.roles role
  where role.organization_id = target_organization_id
    and role.code = 'owner'
    and role.is_active;

  if owner_role_id is null then
    raise exception using
      errcode = 'foreign_key_violation',
      message = 'the target organization has no active owner role';
  end if;

  update erp.profiles
  set organization_id = target_organization_id
  where id = auth_user_id
    and organization_id is null;

  if not found then
    raise exception using
      errcode = 'check_violation',
      message = 'the profile does not exist or already belongs to an organization';
  end if;

  insert into erp.profile_roles (
    organization_id,
    profile_id,
    role_id,
    created_by
  ) values (
    target_organization_id,
    auth_user_id,
    owner_role_id,
    auth.uid()
  );
end;
$$;

create trigger organizations_touch_updated_at
before update on erp.organizations
for each row execute function erp.touch_updated_at();
create trigger branches_touch_updated_at
before update on erp.branches
for each row execute function erp.touch_updated_at();
create trigger locations_touch_updated_at
before update on erp.locations
for each row execute function erp.touch_updated_at();
create trigger profiles_touch_updated_at
before update on erp.profiles
for each row execute function erp.touch_updated_at();
create trigger roles_touch_updated_at
before update on erp.roles
for each row execute function erp.touch_updated_at();
create trigger role_permissions_touch_updated_at
before update on erp.role_permissions
for each row execute function erp.touch_updated_at();
create trigger configuration_touch_updated_at
before update on erp.configuration_values
for each row execute function erp.touch_updated_at();

create trigger organizations_prevent_delete
before delete on erp.organizations
for each row execute function erp.prevent_delete();
create trigger branches_prevent_delete
before delete on erp.branches
for each row execute function erp.prevent_delete();
create trigger locations_prevent_delete
before delete on erp.locations
for each row execute function erp.prevent_delete();
create trigger profiles_prevent_delete
before delete on erp.profiles
for each row execute function erp.prevent_delete();
create trigger roles_prevent_delete
before delete on erp.roles
for each row execute function erp.prevent_delete();
create trigger permissions_prevent_delete
before delete on erp.permissions
for each row execute function erp.prevent_delete();
create trigger role_permissions_prevent_delete
before delete on erp.role_permissions
for each row execute function erp.prevent_delete();
create trigger profile_roles_prevent_delete
before delete on erp.profile_roles
for each row execute function erp.prevent_delete();
create trigger permission_overrides_prevent_delete
before delete on erp.profile_permission_overrides
for each row execute function erp.prevent_delete();
create trigger configuration_prevent_delete
before delete on erp.configuration_values
for each row execute function erp.prevent_delete();

create trigger audit_events_prevent_update
before update on erp.audit_events
for each row execute function erp.prevent_audit_mutation();
create trigger audit_events_prevent_delete
before delete on erp.audit_events
for each row execute function erp.prevent_audit_mutation();

create trigger organizations_audit
after insert or update on erp.organizations
for each row execute function erp.audit_row_change();
create trigger branches_audit
after insert or update on erp.branches
for each row execute function erp.audit_row_change();
create trigger locations_audit
after insert or update on erp.locations
for each row execute function erp.audit_row_change();
create trigger profiles_audit
after insert or update on erp.profiles
for each row execute function erp.audit_row_change();
create trigger roles_audit
after insert or update on erp.roles
for each row execute function erp.audit_row_change();
create trigger permissions_audit
after insert or update on erp.permissions
for each row execute function erp.audit_row_change();
create trigger role_permissions_audit
after insert or update on erp.role_permissions
for each row execute function erp.audit_row_change();
create trigger profile_roles_audit
after insert or update on erp.profile_roles
for each row execute function erp.audit_row_change();
create trigger permission_overrides_audit
after insert or update on erp.profile_permission_overrides
for each row execute function erp.audit_row_change();
create trigger configuration_audit
after insert or update on erp.configuration_values
for each row execute function erp.audit_row_change();

drop trigger if exists erp_profile_on_auth_user_created on auth.users;
create trigger erp_profile_on_auth_user_created
after insert on auth.users
for each row execute function erp.handle_new_auth_user();

alter table erp.organizations enable row level security;
alter table erp.branches enable row level security;
alter table erp.locations enable row level security;
alter table erp.profiles enable row level security;
alter table erp.roles enable row level security;
alter table erp.permissions enable row level security;
alter table erp.role_permissions enable row level security;
alter table erp.profile_roles enable row level security;
alter table erp.profile_permission_overrides enable row level security;
alter table erp.configuration_values enable row level security;
alter table erp.audit_events enable row level security;

create policy organizations_select_own
on erp.organizations for select to authenticated
using (id = erp.current_organization_id());
create policy organizations_manage
on erp.organizations for update to authenticated
using (id = erp.current_organization_id() and erp.has_permission('configuration.manage'))
with check (id = erp.current_organization_id() and erp.has_permission('configuration.manage'));

create policy branches_select_own
on erp.branches for select to authenticated
using (organization_id = erp.current_organization_id());
create policy branches_insert
on erp.branches for insert to authenticated
with check (
  organization_id = erp.current_organization_id()
  and erp.has_permission('locations.manage')
);
create policy branches_update
on erp.branches for update to authenticated
using (
  organization_id = erp.current_organization_id()
  and (
    erp.has_permission('locations.manage', id)
    or erp.has_permission('locations.manage')
  )
)
with check (
  organization_id = erp.current_organization_id()
  and (
    erp.has_permission('locations.manage', id)
    or erp.has_permission('locations.manage')
  )
);

create policy locations_select_own
on erp.locations for select to authenticated
using (organization_id = erp.current_organization_id());
create policy locations_manage
on erp.locations for all to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('locations.manage', branch_id))
with check (organization_id = erp.current_organization_id() and erp.has_permission('locations.manage', branch_id));

create policy profiles_select_allowed
on erp.profiles for select to authenticated
using (
  id = auth.uid()
  or (organization_id = erp.current_organization_id() and erp.has_permission('users.view'))
);
create policy profiles_manage
on erp.profiles for update to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('users.manage'))
with check (organization_id = erp.current_organization_id() and erp.has_permission('users.manage'));

create policy roles_select_allowed
on erp.roles for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('users.view'));
create policy roles_manage
on erp.roles for all to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('users.manage'))
with check (organization_id = erp.current_organization_id() and erp.has_permission('users.manage'));

create policy permissions_select_allowed
on erp.permissions for select to authenticated
using (erp.has_permission('users.view'));
create policy role_permissions_select_allowed
on erp.role_permissions for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and
  erp.has_permission('users.view')
);
create policy role_permissions_manage
on erp.role_permissions for insert to authenticated
with check (
  organization_id = erp.current_organization_id()
  and erp.has_permission('users.manage')
  and exists (
    select 1 from erp.permissions p
    where p.id = permission_id
      and (not p.is_sensitive or erp.has_permission('users.assign_sensitive'))
  )
);
create policy role_permissions_update
on erp.role_permissions for update to authenticated
using (
  organization_id = erp.current_organization_id()
  and erp.has_permission('users.manage')
  and exists (
    select 1 from erp.permissions p
    where p.id = permission_id
      and (not p.is_sensitive or erp.has_permission('users.assign_sensitive'))
  )
)
with check (
  organization_id = erp.current_organization_id()
  and erp.has_permission('users.manage')
  and exists (
    select 1 from erp.permissions p
    where p.id = permission_id
      and (not p.is_sensitive or erp.has_permission('users.assign_sensitive'))
  )
);

create policy profile_roles_select_allowed
on erp.profile_roles for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and (profile_id = auth.uid() or erp.has_permission('users.view', branch_id))
);
create policy profile_roles_manage
on erp.profile_roles for insert to authenticated
with check (
  organization_id = erp.current_organization_id()
  and erp.has_permission('users.manage', branch_id)
  and (
    not exists (
      select 1
      from erp.role_permissions rp
      join erp.permissions p on p.id = rp.permission_id
      where rp.role_id = profile_roles.role_id and rp.is_active and p.is_active and p.is_sensitive
    )
    or erp.has_permission('users.assign_sensitive', branch_id)
  )
);
create policy profile_roles_update
on erp.profile_roles for update to authenticated
using (
  organization_id = erp.current_organization_id()
  and erp.has_permission('users.manage', branch_id)
  and (
    not exists (
      select 1
      from erp.role_permissions rp
      join erp.permissions p on p.id = rp.permission_id
      where rp.role_id = profile_roles.role_id and rp.is_active and p.is_active and p.is_sensitive
    )
    or erp.has_permission('users.assign_sensitive', branch_id)
  )
)
with check (
  organization_id = erp.current_organization_id()
  and erp.has_permission('users.manage', branch_id)
  and (
    not exists (
      select 1
      from erp.role_permissions rp
      join erp.permissions p on p.id = rp.permission_id
      where rp.role_id = profile_roles.role_id and rp.is_active and p.is_active and p.is_sensitive
    )
    or erp.has_permission('users.assign_sensitive', branch_id)
  )
);

create policy overrides_select_allowed
on erp.profile_permission_overrides for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and (profile_id = auth.uid() or erp.has_permission('users.view', branch_id))
);
create policy overrides_manage
on erp.profile_permission_overrides for insert to authenticated
with check (
  organization_id = erp.current_organization_id()
  and erp.has_permission('users.manage', branch_id)
  and exists (
    select 1 from erp.permissions p
    where p.id = permission_id
      and (not p.is_sensitive or erp.has_permission('users.assign_sensitive', branch_id))
  )
);
create policy overrides_update
on erp.profile_permission_overrides for update to authenticated
using (
  organization_id = erp.current_organization_id()
  and erp.has_permission('users.manage', branch_id)
  and exists (
    select 1 from erp.permissions p
    where p.id = permission_id
      and (not p.is_sensitive or erp.has_permission('users.assign_sensitive', branch_id))
  )
)
with check (
  organization_id = erp.current_organization_id()
  and erp.has_permission('users.manage', branch_id)
  and exists (
    select 1 from erp.permissions p
    where p.id = permission_id
      and (not p.is_sensitive or erp.has_permission('users.assign_sensitive', branch_id))
  )
);

create policy configuration_select_allowed
on erp.configuration_values for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and erp.has_permission('configuration.view', branch_id)
  and (not is_secret or erp.has_permission('configuration.view_secret', branch_id))
);
create policy configuration_insert
on erp.configuration_values for insert to authenticated
with check (
  organization_id = erp.current_organization_id()
  and erp.has_permission('configuration.manage', branch_id)
);
create policy configuration_update
on erp.configuration_values for update to authenticated
using (
  organization_id = erp.current_organization_id()
  and erp.has_permission('configuration.manage', branch_id)
)
with check (
  organization_id = erp.current_organization_id()
  and erp.has_permission('configuration.manage', branch_id)
);

create policy audit_events_select_allowed
on erp.audit_events for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and erp.has_permission('audit.view', branch_id)
);

revoke all on schema erp from public, anon;
grant usage on schema erp to authenticated, service_role;

revoke all on all tables in schema erp from public, anon;
grant select, insert, update on all tables in schema erp to authenticated;
revoke insert, update on erp.permissions from authenticated;
revoke insert, update, delete on erp.audit_events from authenticated;
grant all on all tables in schema erp to service_role;
revoke truncate on all tables in schema erp from service_role;
grant usage, select on all sequences in schema erp to service_role;

revoke all on all functions in schema erp from public, anon;
grant execute on function erp.current_organization_id() to authenticated, service_role;
grant execute on function erp.has_permission(text, uuid) to authenticated, service_role;
grant execute on function erp.bootstrap_owner(uuid, uuid) to service_role;

alter default privileges in schema erp revoke all on tables from public, anon;
alter default privileges in schema erp grant all on tables to service_role;
alter default privileges in schema erp grant usage, select on sequences to service_role;
alter default privileges in schema erp revoke execute on functions from public, anon;
