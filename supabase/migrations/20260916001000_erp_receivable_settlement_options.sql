-- Safe lookup contracts for explicit receivable settlements.
-- Accounts-receivable operators must not depend on pricing.view or cash.view
-- merely to select the payment method and open drawer required by the command.

create or replace function erp.list_receivable_payment_methods(target_branch_id uuid)
returns table (
  id uuid,
  code text,
  name text,
  settlement_kind text,
  requires_cash_session boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org_id uuid := erp.current_organization_id();
begin
  if org_id is null
     or target_branch_id is null
     or not erp.has_permission('accounts_receivable.manage', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'accounts_receivable.manage permission is required';
  end if;

  return query
  select method.id, method.code, method.name,
         method.settlement_kind, method.requires_cash_session
  from erp.payment_methods method
  where method.organization_id = org_id
    and method.is_active
  order by method.name, method.code;
end;
$$;

create or replace function erp.list_receivable_cash_sessions(target_branch_id uuid)
returns table (
  id uuid,
  branch_id uuid,
  cash_register_code text,
  cash_register_name text,
  opened_at timestamptz,
  currencies text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org_id uuid := erp.current_organization_id();
begin
  if org_id is null
     or target_branch_id is null
     or not erp.has_permission('accounts_receivable.manage', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'accounts_receivable.manage permission is required';
  end if;

  return query
  select session.id, session.branch_id, register.code, register.name,
         session.opened_at,
         array_agg(opening.currency_code order by opening.currency_code)::text[]
  from erp.cash_sessions session
  join erp.cash_registers register
    on register.id = session.cash_register_id
   and register.organization_id = session.organization_id
   and register.branch_id = session.branch_id
  join erp.cash_session_opening_counts opening
    on opening.cash_session_id = session.id
   and opening.organization_id = session.organization_id
   and opening.branch_id = session.branch_id
  left join erp.cash_closures closure
    on closure.cash_session_id = session.id
   and closure.organization_id = session.organization_id
   and closure.branch_id = session.branch_id
  where session.organization_id = org_id
    and session.branch_id = target_branch_id
    and closure.id is null
  group by session.id, session.branch_id, register.code, register.name, session.opened_at
  order by session.opened_at desc;
end;
$$;

comment on function erp.list_receivable_payment_methods(uuid) is
  'Safe active payment-method lookup for an authorized receivable settlement branch.';
comment on function erp.list_receivable_cash_sessions(uuid) is
  'Safe open cash-session lookup, including opened currencies, for an authorized receivable settlement branch.';

revoke all on function erp.list_receivable_payment_methods(uuid) from public, anon, service_role;
revoke all on function erp.list_receivable_cash_sessions(uuid) from public, anon, service_role;
grant execute on function erp.list_receivable_payment_methods(uuid) to authenticated;
grant execute on function erp.list_receivable_cash_sessions(uuid) to authenticated;
