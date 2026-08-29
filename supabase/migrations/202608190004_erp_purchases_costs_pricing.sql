create type erp.purchase_approval_action as enum ('approved', 'rejected');
create type erp.purchase_expense_kind as enum ('freight', 'tax', 'insurance', 'customs', 'other');
create type erp.cost_entry_kind as enum ('purchase_receipt');

create or replace function erp.is_finite_numeric_text(value text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  parsed numeric;
begin
  if value is null or value !~ '^[+-]?[0-9]+([.][0-9]+)?$' then
    return false;
  end if;
  parsed := value::numeric;
  return parsed <> 'NaN'::numeric;
exception when others then
  return false;
end;
$$;

create table erp.organization_currencies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  decimal_places smallint not null default 2 check (decimal_places between 0 and 6),
  is_base boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_currencies_id_org_unique unique (id, organization_id),
  constraint organization_currencies_code_unique unique (organization_id, currency_code)
);
create unique index organization_currencies_base_unique
  on erp.organization_currencies (organization_id) where is_base;

create table erp.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  base_currency text not null check (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text not null check (quote_currency ~ '^[A-Z]{3}$'),
  rate_to_base numeric(24, 10) not null check (rate_to_base <> 'NaN'::numeric and rate_to_base > 0),
  source text not null check (btrim(source) <> ''),
  quoted_at timestamptz not null,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null,
  captured_at timestamptz not null default now(),
  captured_by uuid references auth.users(id) on delete restrict,
  constraint exchange_rates_id_org_unique unique (id, organization_id),
  constraint exchange_rates_pair_distinct check (
    base_currency <> quote_currency or rate_to_base = 1
  ),
  constraint exchange_rates_operation_unique unique (organization_id, idempotency_key),
  constraint exchange_rates_base_currency_fk foreign key (organization_id, base_currency)
    references erp.organization_currencies(organization_id, currency_code) on delete restrict,
  constraint exchange_rates_quote_currency_fk foreign key (organization_id, quote_currency)
    references erp.organization_currencies(organization_id, currency_code) on delete restrict
);

create table erp.exchange_rate_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  exchange_rate_id uuid not null,
  base_currency text not null,
  quote_currency text not null,
  rate_to_base numeric(24, 10) not null check (rate_to_base <> 'NaN'::numeric and rate_to_base > 0),
  source text not null,
  quoted_at timestamptz not null,
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint exchange_rate_snapshots_id_org_unique unique (id, organization_id),
  constraint exchange_rate_snapshots_rate_fk foreign key (exchange_rate_id, organization_id)
    references erp.exchange_rates(id, organization_id) on delete restrict,
  constraint exchange_rate_snapshots_rate_unique unique (exchange_rate_id)
);

create table erp.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  supplier_id uuid not null,
  currency_code text not null,
  exchange_snapshot_id uuid not null,
  exchange_rate numeric(24, 10) not null check (exchange_rate <> 'NaN'::numeric and exchange_rate > 0),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null,
  reason text not null check (btrim(reason) <> ''),
  ordered_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint purchase_orders_id_org_unique unique (id, organization_id),
  constraint purchase_orders_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint purchase_orders_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint purchase_orders_supplier_fk foreign key (supplier_id, organization_id)
    references erp.suppliers(id, organization_id) on delete restrict,
  constraint purchase_orders_snapshot_fk foreign key (exchange_snapshot_id, organization_id)
    references erp.exchange_rate_snapshots(id, organization_id) on delete restrict,
  constraint purchase_orders_operation_unique unique (organization_id, branch_id, idempotency_key)
);

create table erp.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  purchase_order_id uuid not null,
  line_number integer not null check (line_number > 0),
  product_id uuid not null,
  variant_id uuid,
  ordered_quantity numeric(18, 4) not null check (ordered_quantity <> 'NaN'::numeric and ordered_quantity > 0),
  unit_price numeric(18, 4) not null check (unit_price <> 'NaN'::numeric and unit_price >= 0),
  tax_amount numeric(18, 4) not null default 0 check (tax_amount <> 'NaN'::numeric and tax_amount >= 0),
  created_at timestamptz not null default now(),
  constraint purchase_order_lines_id_org_unique unique (id, organization_id),
  constraint purchase_order_lines_order_fk foreign key (purchase_order_id, organization_id)
    references erp.purchase_orders(id, organization_id) on delete restrict,
  constraint purchase_order_lines_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint purchase_order_lines_variant_fk foreign key (variant_id, product_id, organization_id)
    references erp.product_variants(id, product_id, organization_id) on delete restrict,
  constraint purchase_order_lines_number_unique unique (purchase_order_id, line_number)
);

create table erp.purchase_approval_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  purchase_order_id uuid not null,
  branch_id uuid not null,
  action erp.purchase_approval_action not null,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null,
  reason text not null check (btrim(reason) <> ''),
  occurred_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete restrict,
  constraint purchase_approval_events_id_org_unique unique (id, organization_id),
  constraint purchase_approval_events_order_fk foreign key (purchase_order_id, organization_id, branch_id)
    references erp.purchase_orders(id, organization_id, branch_id) on delete restrict,
  constraint purchase_approval_events_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint purchase_approval_events_operation_unique unique (organization_id, branch_id, idempotency_key)
);
create unique index purchase_order_terminal_event_once
  on erp.purchase_approval_events (purchase_order_id);

create table erp.purchase_receipts (
  id uuid primary key,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  purchase_order_id uuid not null,
  supplier_id uuid not null,
  currency_code text not null,
  exchange_snapshot_id uuid not null,
  exchange_rate numeric(24, 10) not null check (exchange_rate <> 'NaN'::numeric and exchange_rate > 0),
  stock_document_id uuid,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null,
  reason text not null check (btrim(reason) <> ''),
  goods_total_base numeric(18, 4) not null check (goods_total_base <> 'NaN'::numeric and goods_total_base >= 0),
  expense_total_base numeric(18, 4) not null check (expense_total_base <> 'NaN'::numeric and expense_total_base >= 0),
  landed_total_base numeric(18, 4) not null check (
    landed_total_base <> 'NaN'::numeric and landed_total_base = goods_total_base + expense_total_base
  ),
  payable_created boolean not null,
  received_at timestamptz not null default now(),
  received_by uuid references auth.users(id) on delete restrict,
  constraint purchase_receipts_id_org_unique unique (id, organization_id),
  constraint purchase_receipts_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint purchase_receipts_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint purchase_receipts_order_fk foreign key (purchase_order_id, organization_id, branch_id)
    references erp.purchase_orders(id, organization_id, branch_id) on delete restrict,
  constraint purchase_receipts_supplier_fk foreign key (supplier_id, organization_id)
    references erp.suppliers(id, organization_id) on delete restrict,
  constraint purchase_receipts_snapshot_fk foreign key (exchange_snapshot_id, organization_id)
    references erp.exchange_rate_snapshots(id, organization_id) on delete restrict,
  constraint purchase_receipts_stock_fk foreign key (stock_document_id, organization_id)
    references erp.stock_documents(id, organization_id) on delete restrict,
  constraint purchase_receipts_operation_unique unique (organization_id, branch_id, idempotency_key),
  constraint purchase_receipts_stock_unique unique (stock_document_id)
);

create table erp.purchase_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  receipt_id uuid not null,
  branch_id uuid not null,
  purchase_order_line_id uuid not null,
  line_number integer not null check (line_number > 0),
  product_id uuid not null,
  variant_id uuid,
  inventory_unit_id uuid,
  to_location_id uuid not null,
  quantity numeric(18, 4) not null check (quantity <> 'NaN'::numeric and quantity > 0),
  unit_price numeric(18, 4) not null check (unit_price <> 'NaN'::numeric and unit_price >= 0),
  goods_cost_base numeric(18, 4) not null check (goods_cost_base <> 'NaN'::numeric and goods_cost_base >= 0),
  allocated_expense_base numeric(18, 4) not null check (
    allocated_expense_base <> 'NaN'::numeric and allocated_expense_base >= 0
  ),
  landed_cost_base numeric(18, 4) not null check (
    landed_cost_base <> 'NaN'::numeric and landed_cost_base = goods_cost_base + allocated_expense_base
  ),
  unit_landed_cost numeric(24, 8) not null check (unit_landed_cost <> 'NaN'::numeric and unit_landed_cost >= 0),
  rounding_adjustment_base numeric(18, 4) not null default 0 check (rounding_adjustment_base <> 'NaN'::numeric),
  created_at timestamptz not null default now(),
  constraint purchase_receipt_lines_id_org_unique unique (id, organization_id),
  constraint purchase_receipt_lines_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint purchase_receipt_lines_id_org_receipt_unique unique (id, organization_id, receipt_id),
  constraint purchase_receipt_lines_receipt_fk foreign key (receipt_id, organization_id, branch_id)
    references erp.purchase_receipts(id, organization_id, branch_id) on delete restrict,
  constraint purchase_receipt_lines_order_line_fk foreign key (purchase_order_line_id, organization_id)
    references erp.purchase_order_lines(id, organization_id) on delete restrict,
  constraint purchase_receipt_lines_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint purchase_receipt_lines_variant_fk foreign key (variant_id, product_id, organization_id)
    references erp.product_variants(id, product_id, organization_id) on delete restrict,
  constraint purchase_receipt_lines_unit_fk foreign key (inventory_unit_id, organization_id)
    references erp.inventory_units(id, organization_id) on delete restrict,
  constraint purchase_receipt_lines_location_fk foreign key (to_location_id, organization_id, branch_id)
    references erp.locations(id, organization_id, branch_id) on delete restrict,
  constraint purchase_receipt_lines_number_unique unique (receipt_id, line_number),
  constraint purchase_receipt_lines_cost_reconciles check (
    round(unit_landed_cost * quantity, 4) + rounding_adjustment_base = landed_cost_base
  )
);

create table erp.purchase_receipt_expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  receipt_id uuid not null,
  expense_number integer not null check (expense_number > 0),
  kind erp.purchase_expense_kind not null,
  description text not null check (btrim(description) <> ''),
  amount_base numeric(18, 4) not null check (amount_base <> 'NaN'::numeric and amount_base > 0),
  payable_to_supplier boolean not null,
  created_at timestamptz not null default now(),
  constraint purchase_receipt_expenses_id_org_unique unique (id, organization_id),
  constraint purchase_receipt_expenses_id_org_receipt_unique unique (id, organization_id, receipt_id),
  constraint purchase_receipt_expenses_receipt_fk foreign key (receipt_id, organization_id)
    references erp.purchase_receipts(id, organization_id) on delete restrict,
  constraint purchase_receipt_expenses_number_unique unique (receipt_id, expense_number)
);

create table erp.purchase_expense_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  receipt_id uuid not null,
  expense_id uuid not null,
  receipt_line_id uuid not null,
  amount_base numeric(18, 4) not null check (amount_base <> 'NaN'::numeric and amount_base > 0),
  created_at timestamptz not null default now(),
  constraint purchase_expense_allocations_expense_fk foreign key (expense_id, organization_id, receipt_id)
    references erp.purchase_receipt_expenses(id, organization_id, receipt_id) on delete restrict,
  constraint purchase_expense_allocations_line_fk foreign key (receipt_line_id, organization_id, receipt_id)
    references erp.purchase_receipt_lines(id, organization_id, receipt_id) on delete restrict,
  constraint purchase_expense_allocations_unique unique (expense_id, receipt_line_id)
);

create table erp.inventory_cost_entries (
  id bigint generated always as identity primary key,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  receipt_id uuid not null,
  receipt_line_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  inventory_unit_id uuid,
  entry_kind erp.cost_entry_kind not null,
  quantity_delta numeric(18, 4) not null check (quantity_delta <> 'NaN'::numeric and quantity_delta > 0),
  total_cost_base numeric(18, 4) not null check (total_cost_base <> 'NaN'::numeric and total_cost_base >= 0),
  unit_cost_base numeric(24, 8) not null check (unit_cost_base <> 'NaN'::numeric and unit_cost_base >= 0),
  occurred_at timestamptz not null default now(),
  constraint inventory_cost_entries_receipt_fk foreign key (receipt_id, organization_id, branch_id)
    references erp.purchase_receipts(id, organization_id, branch_id) on delete restrict,
  constraint inventory_cost_entries_line_fk foreign key (receipt_line_id, organization_id, branch_id)
    references erp.purchase_receipt_lines(id, organization_id, branch_id) on delete restrict,
  constraint inventory_cost_entries_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint inventory_cost_entries_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint inventory_cost_entries_variant_fk foreign key (variant_id, product_id, organization_id)
    references erp.product_variants(id, product_id, organization_id) on delete restrict,
  constraint inventory_cost_entries_unit_fk foreign key (inventory_unit_id, organization_id)
    references erp.inventory_units(id, organization_id) on delete restrict,
  constraint inventory_cost_entries_line_unique unique (receipt_line_id)
);

create table erp.inventory_cost_balances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  variant_key uuid generated always as (coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  valued_quantity numeric(18, 4) not null check (valued_quantity <> 'NaN'::numeric and valued_quantity >= 0),
  total_cost_base numeric(18, 4) not null check (total_cost_base <> 'NaN'::numeric and total_cost_base >= 0),
  weighted_average_cost numeric(24, 8) not null check (weighted_average_cost <> 'NaN'::numeric and weighted_average_cost >= 0),
  updated_at timestamptz not null default now(),
  constraint inventory_cost_balances_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint inventory_cost_balances_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint inventory_cost_balances_variant_fk foreign key (variant_id, product_id, organization_id)
    references erp.product_variants(id, product_id, organization_id) on delete restrict,
  constraint inventory_cost_balances_unique unique (organization_id, branch_id, product_id, variant_key)
);

create table erp.serialized_acquisition_costs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  inventory_unit_id uuid not null,
  receipt_line_id uuid not null,
  acquisition_cost_base numeric(18, 4) not null check (acquisition_cost_base <> 'NaN'::numeric and acquisition_cost_base >= 0),
  acquired_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint serialized_acquisition_costs_unit_fk foreign key (inventory_unit_id, organization_id)
    references erp.inventory_units(id, organization_id) on delete restrict,
  constraint serialized_acquisition_costs_line_fk foreign key (receipt_line_id, organization_id)
    references erp.purchase_receipt_lines(id, organization_id) on delete restrict,
  constraint serialized_acquisition_costs_unit_unique unique (inventory_unit_id),
  constraint serialized_acquisition_costs_line_unique unique (receipt_line_id)
);

create table erp.supplier_payables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  supplier_id uuid not null,
  receipt_id uuid not null,
  currency_code text not null,
  amount_currency numeric(18, 4) not null check (amount_currency <> 'NaN'::numeric and amount_currency >= 0),
  amount_base numeric(18, 4) not null check (amount_base <> 'NaN'::numeric and amount_base >= 0),
  exchange_snapshot_id uuid not null,
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint supplier_payables_id_org_unique unique (id, organization_id),
  constraint supplier_payables_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint supplier_payables_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint supplier_payables_supplier_fk foreign key (supplier_id, organization_id)
    references erp.suppliers(id, organization_id) on delete restrict,
  constraint supplier_payables_receipt_fk foreign key (receipt_id, organization_id, branch_id)
    references erp.purchase_receipts(id, organization_id, branch_id) on delete restrict,
  constraint supplier_payables_snapshot_fk foreign key (exchange_snapshot_id, organization_id)
    references erp.exchange_rate_snapshots(id, organization_id) on delete restrict,
  constraint supplier_payables_receipt_unique unique (receipt_id)
);

create table erp.supplier_account_entries (
  id bigint generated always as identity primary key,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  supplier_id uuid not null,
  payable_id uuid not null,
  amount_base_delta numeric(18, 4) not null check (
    amount_base_delta <> 'NaN'::numeric and amount_base_delta <> 0
  ),
  occurred_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete restrict,
  constraint supplier_account_entries_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint supplier_account_entries_supplier_fk foreign key (supplier_id, organization_id)
    references erp.suppliers(id, organization_id) on delete restrict,
  constraint supplier_account_entries_payable_fk foreign key (payable_id, organization_id, branch_id)
    references erp.supplier_payables(id, organization_id, branch_id) on delete restrict,
  constraint supplier_account_entries_payable_unique unique (payable_id)
);

create table erp.payment_methods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  code text not null check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  surcharge_percent numeric(9, 4) not null default 0 check (
    surcharge_percent <> 'NaN'::numeric and surcharge_percent >= 0
  ),
  max_installments integer not null default 1 check (max_installments > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_methods_id_org_unique unique (id, organization_id),
  constraint payment_methods_code_unique unique (organization_id, code)
);

create table erp.price_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  code text not null check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  currency_code text not null,
  payment_method_id uuid,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint price_lists_id_org_unique unique (id, organization_id),
  constraint price_lists_currency_fk foreign key (organization_id, currency_code)
    references erp.organization_currencies(organization_id, currency_code) on delete restrict,
  constraint price_lists_payment_method_fk foreign key (payment_method_id, organization_id)
    references erp.payment_methods(id, organization_id) on delete restrict,
  constraint price_lists_code_unique unique (organization_id, code)
);

create table erp.price_change_previews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  price_list_id uuid not null,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null,
  reason text not null check (btrim(reason) <> ''),
  formula jsonb not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint price_change_previews_id_org_unique unique (id, organization_id),
  constraint price_change_previews_list_fk foreign key (price_list_id, organization_id)
    references erp.price_lists(id, organization_id) on delete restrict,
  constraint price_change_previews_operation_unique unique (organization_id, idempotency_key)
);

create table erp.price_change_preview_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  preview_id uuid not null,
  line_number integer not null check (line_number > 0),
  product_id uuid not null,
  variant_id uuid,
  variant_key uuid generated always as (coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  baseline_entry_id bigint,
  current_price numeric(18, 4),
  proposed_price numeric(18, 4) not null check (proposed_price <> 'NaN'::numeric and proposed_price >= 0),
  created_at timestamptz not null default now(),
  constraint price_preview_lines_id_org_unique unique (id, organization_id),
  constraint price_preview_lines_preview_fk foreign key (preview_id, organization_id)
    references erp.price_change_previews(id, organization_id) on delete restrict,
  constraint price_preview_lines_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint price_preview_lines_variant_fk foreign key (variant_id, product_id, organization_id)
    references erp.product_variants(id, product_id, organization_id) on delete restrict,
  constraint price_preview_lines_number_unique unique (preview_id, line_number),
  constraint price_preview_lines_product_unique unique (preview_id, product_id, variant_key),
  constraint price_preview_lines_current_finite check (current_price is null or current_price <> 'NaN'::numeric)
);

create table erp.price_change_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  preview_id uuid not null,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null,
  reason text not null check (btrim(reason) <> ''),
  applied_at timestamptz not null default now(),
  applied_by uuid references auth.users(id) on delete restrict,
  constraint price_change_applications_id_org_unique unique (id, organization_id),
  constraint price_change_applications_preview_fk foreign key (preview_id, organization_id)
    references erp.price_change_previews(id, organization_id) on delete restrict,
  constraint price_change_applications_preview_unique unique (preview_id),
  constraint price_change_applications_operation_unique unique (organization_id, idempotency_key)
);

create table erp.price_entries (
  id bigint generated always as identity primary key,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  price_list_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  variant_key uuid generated always as (coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  amount numeric(18, 4) not null check (amount <> 'NaN'::numeric and amount >= 0),
  currency_code text not null,
  application_id uuid not null,
  effective_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint price_entries_list_fk foreign key (price_list_id, organization_id)
    references erp.price_lists(id, organization_id) on delete restrict,
  constraint price_entries_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint price_entries_variant_fk foreign key (variant_id, product_id, organization_id)
    references erp.product_variants(id, product_id, organization_id) on delete restrict,
  constraint price_entries_application_fk foreign key (application_id, organization_id)
    references erp.price_change_applications(id, organization_id) on delete restrict,
  constraint price_entries_application_product_unique unique (application_id, product_id, variant_key)
);
alter table erp.price_change_preview_lines
  add constraint price_preview_lines_baseline_fk foreign key (baseline_entry_id)
  references erp.price_entries(id) on delete restrict;
create index price_entries_current_idx
  on erp.price_entries (organization_id, price_list_id, product_id, variant_key, effective_at desc, id desc);

create or replace function erp.prevent_fact_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = 'integrity_constraint_violation',
    message = format('%I.%I facts are append-only', tg_table_schema, tg_table_name);
end;
$$;

create or replace function erp.protect_purchase_receipt()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
    and old.stock_document_id is null
    and new.stock_document_id is not null
    and (to_jsonb(new) - 'stock_document_id') = (to_jsonb(old) - 'stock_document_id')
    and exists (
      select 1 from erp.stock_documents d
      where d.id = new.stock_document_id and d.organization_id = new.organization_id
        and d.branch_id = new.branch_id and d.kind = 'receipt'
        and d.source_type = 'purchase_receipt' and d.source_id = new.id
    ) then
    return new;
  end if;
  raise exception using errcode = 'integrity_constraint_violation',
    message = 'erp.purchase_receipts facts are append-only';
end;
$$;

alter function erp.post_stock_document(
  erp.stock_document_kind, uuid, text, text, jsonb, boolean, text, uuid
) rename to post_stock_document_core;

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
begin
  if document_kind = 'receipt' and not exists (
    select 1 from erp.purchase_receipts receipt
    where receipt.id = source_id
      and receipt.organization_id = actor_organization_id
      and receipt.branch_id = target_branch_id
      and receipt.stock_document_id is null
      and source_type = 'purchase_receipt'
  ) then
    raise exception using errcode = 'insufficient_privilege',
      message = 'purchase receipts must be posted through post_purchase_receipt';
  end if;
  return erp.post_stock_document_core(
    document_kind, target_branch_id, operation_key, operation_reason, lines,
    allow_negative, source_type, source_id
  );
end;
$$;

alter function erp.reverse_stock_document(uuid, text, text)
rename to reverse_stock_document_core;

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
begin
  if exists (
    select 1 from erp.stock_documents document
    where document.id = original_document_id
      and document.organization_id = actor_organization_id
      and document.kind = 'receipt'
      and document.source_type = 'purchase_receipt'
  ) then
    raise exception using errcode = 'feature_not_supported',
      message = 'purchase receipt reversal requires a future compensating cost and payable command';
  end if;
  return erp.reverse_stock_document_core(original_document_id, operation_key, operation_reason);
end;
$$;

create or replace function erp.capture_exchange_rate(
  target_quote_currency text,
  captured_rate_to_base numeric,
  rate_source text,
  quote_time timestamptz,
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
  base_currency_code text;
  operation_hash text;
  rate_id uuid;
  snapshot_id uuid;
begin
  if actor_organization_id is null or not erp.has_permission('pricing.manage') then
    raise exception using errcode = 'insufficient_privilege', message = 'pricing.manage permission is required';
  end if;
  if nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null
    or nullif(btrim(rate_source), '') is null or quote_time is null
    or captured_rate_to_base is null or captured_rate_to_base = 'NaN'::numeric
    or captured_rate_to_base <= 0 then
    raise exception using errcode = 'invalid_parameter_value', message = 'complete positive exchange-rate data is required';
  end if;
  select currency_code into base_currency_code
  from erp.organization_currencies
  where organization_id = actor_organization_id and is_base and is_active;
  if base_currency_code is null or not exists (
    select 1 from erp.organization_currencies
    where organization_id = actor_organization_id
      and currency_code = upper(btrim(target_quote_currency)) and is_active
  ) then
    raise exception using errcode = 'foreign_key_violation', message = 'active organization currencies are required';
  end if;
  if upper(btrim(target_quote_currency)) = base_currency_code and captured_rate_to_base <> 1 then
    raise exception using errcode = 'check_violation', message = 'base currency exchange rate must equal one';
  end if;
  operation_hash := md5(jsonb_build_object(
    'quote_currency', upper(btrim(target_quote_currency)), 'rate_to_base', captured_rate_to_base,
    'source', btrim(rate_source), 'quoted_at', quote_time, 'reason', btrim(operation_reason)
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':fx:' || operation_key, 0));
  select snapshot.id into snapshot_id
  from erp.exchange_rates rate
  join erp.exchange_rate_snapshots snapshot on snapshot.exchange_rate_id = rate.id
  where rate.organization_id = actor_organization_id and rate.idempotency_key = operation_key
    and rate.request_hash = operation_hash;
  if snapshot_id is not null then return snapshot_id; end if;
  if exists (select 1 from erp.exchange_rates where organization_id = actor_organization_id and idempotency_key = operation_key) then
    raise exception using errcode = 'integrity_constraint_violation', message = 'exchange-rate operation key is already used by another request';
  end if;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.exchange_rates (
    organization_id, base_currency, quote_currency, rate_to_base, source,
    quoted_at, idempotency_key, request_hash, captured_by
  ) values (
    actor_organization_id, base_currency_code, upper(btrim(target_quote_currency)), captured_rate_to_base,
    btrim(rate_source), quote_time, operation_key, operation_hash, auth.uid()
  ) returning id into rate_id;
  insert into erp.exchange_rate_snapshots (
    organization_id, exchange_rate_id, base_currency, quote_currency,
    rate_to_base, source, quoted_at, captured_at
  ) select rate.organization_id, rate.id, rate.base_currency, rate.quote_currency,
      rate.rate_to_base, rate.source, rate.quoted_at, rate.captured_at
    from erp.exchange_rates rate where rate.id = rate_id
  returning id into snapshot_id;
  return snapshot_id;
end;
$$;

create or replace function erp.create_purchase_order(
  target_branch_id uuid,
  target_supplier_id uuid,
  order_currency text,
  target_exchange_snapshot_id uuid,
  operation_key text,
  operation_reason text,
  lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  operation_hash text;
  order_id uuid;
  snapshot_rate numeric(24, 10);
  line jsonb;
  line_number integer := 0;
  target_product_id uuid;
  target_variant_id uuid;
  quantity numeric(18, 4);
  unit_price numeric(18, 4);
  tax_amount numeric(18, 4);
begin
  if actor_organization_id is null or not erp.has_permission('purchases.manage', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'purchases.manage permission is required';
  end if;
  if nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null
    or lines is null or jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0
    or jsonb_array_length(lines) > 250 or pg_column_size(lines) > 1048576 then
    raise exception using errcode = 'invalid_parameter_value', message = 'order key, reason and 1 to 250 lines are required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(lines) item
    where jsonb_typeof(item) <> 'object'
      or nullif(item->>'product_id', '') is null
      or not erp.is_finite_numeric_text(item->>'quantity')
      or not erp.is_finite_numeric_text(item->>'unit_price')
      or (item ? 'tax_amount' and not erp.is_finite_numeric_text(item->>'tax_amount'))
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'purchase-order lines must contain valid finite values';
  end if;
  if not exists (select 1 from erp.branches where id = target_branch_id and organization_id = actor_organization_id and is_active)
    or not exists (select 1 from erp.suppliers where id = target_supplier_id and organization_id = actor_organization_id and is_active) then
    raise exception using errcode = 'foreign_key_violation', message = 'active branch and supplier are required';
  end if;
  select rate_to_base into snapshot_rate
  from erp.exchange_rate_snapshots
  where id = target_exchange_snapshot_id and organization_id = actor_organization_id
    and quote_currency = upper(btrim(order_currency));
  if snapshot_rate is null then
    raise exception using errcode = 'foreign_key_violation', message = 'exchange snapshot does not match the order currency';
  end if;
  operation_hash := md5(jsonb_build_object(
    'branch_id', target_branch_id, 'supplier_id', target_supplier_id,
    'currency', upper(btrim(order_currency)), 'snapshot_id', target_exchange_snapshot_id,
    'reason', operation_reason, 'lines', lines
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':' || target_branch_id::text, 0));
  select id into order_id from erp.purchase_orders
  where organization_id = actor_organization_id and branch_id = target_branch_id
    and idempotency_key = operation_key and request_hash = operation_hash;
  if order_id is not null then return order_id; end if;
  if exists (select 1 from erp.purchase_orders where organization_id = actor_organization_id and branch_id = target_branch_id and idempotency_key = operation_key) then
    raise exception using errcode = 'integrity_constraint_violation', message = 'purchase-order operation key is already used by another request';
  end if;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.purchase_orders (
    organization_id, branch_id, supplier_id, currency_code, exchange_snapshot_id,
    exchange_rate, idempotency_key, request_hash, reason, created_by
  ) values (
    actor_organization_id, target_branch_id, target_supplier_id, upper(btrim(order_currency)),
    target_exchange_snapshot_id, snapshot_rate, operation_key, operation_hash, operation_reason, auth.uid()
  ) returning id into order_id;
  for line in select value from jsonb_array_elements(lines) loop
    line_number := line_number + 1;
    begin
      target_product_id := (line->>'product_id')::uuid;
      target_variant_id := nullif(line->>'variant_id', '')::uuid;
      quantity := (line->>'quantity')::numeric;
      unit_price := (line->>'unit_price')::numeric;
      tax_amount := coalesce(nullif(line->>'tax_amount', '')::numeric, 0);
    exception when others then
      raise exception using errcode = 'invalid_parameter_value', message = format('invalid purchase-order line %s', line_number);
    end;
    if quantity = 'NaN'::numeric or unit_price = 'NaN'::numeric or tax_amount = 'NaN'::numeric
      or quantity <= 0 or unit_price < 0 or tax_amount < 0 or not exists (
      select 1 from erp.products p where p.id = target_product_id and p.organization_id = actor_organization_id
        and p.item_kind = 'product' and p.is_active
    ) or (target_variant_id is not null and not exists (
      select 1 from erp.product_variants v
      where v.id = target_variant_id and v.product_id = target_product_id
        and v.organization_id = actor_organization_id and v.is_active
    )) then
      raise exception using errcode = 'check_violation', message = format('invalid purchase-order line %s values', line_number);
    end if;
    insert into erp.purchase_order_lines (
      organization_id, purchase_order_id, line_number, product_id, variant_id,
      ordered_quantity, unit_price, tax_amount
    ) values (
      actor_organization_id, order_id, line_number, target_product_id, target_variant_id,
      quantity, unit_price, tax_amount
    );
  end loop;
  return order_id;
end;
$$;

create or replace function erp.approve_purchase_order(
  target_purchase_order_id uuid,
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
  operation_hash text;
  event_id uuid;
begin
  if nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'approval key and reason are required';
  end if;
  select branch_id into target_branch_id from erp.purchase_orders
  where id = target_purchase_order_id and organization_id = actor_organization_id
  for update;
  if target_branch_id is null then raise exception using errcode = 'no_data_found', message = 'purchase order not found'; end if;
  if not erp.has_permission('purchases.approve', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'purchases.approve permission is required';
  end if;
  operation_hash := md5(jsonb_build_object('order_id', target_purchase_order_id, 'action', 'approved', 'reason', operation_reason)::text);
  perform pg_advisory_xact_lock(hashtextextended(
    actor_organization_id::text || ':' || target_branch_id::text || ':purchase-approval:' || operation_key,
    0
  ));
  select id into event_id from erp.purchase_approval_events
  where organization_id = actor_organization_id and branch_id = target_branch_id
    and idempotency_key = operation_key and request_hash = operation_hash;
  if event_id is not null then return event_id; end if;
  if exists (select 1 from erp.purchase_approval_events where organization_id = actor_organization_id and branch_id = target_branch_id and idempotency_key = operation_key) then
    raise exception using errcode = 'integrity_constraint_violation', message = 'purchase-approval operation key is already used by another request';
  end if;
  if exists (select 1 from erp.purchase_approval_events where purchase_order_id = target_purchase_order_id) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'purchase order already has a terminal approval event';
  end if;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.purchase_approval_events (
    organization_id, purchase_order_id, branch_id, action, idempotency_key,
    request_hash, reason, actor_id
  ) values (
    actor_organization_id, target_purchase_order_id, target_branch_id, 'approved',
    operation_key, operation_hash, operation_reason, auth.uid()
  ) returning id into event_id;
  return event_id;
end;
$$;

create or replace function erp.reject_purchase_order(
  target_purchase_order_id uuid,
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
  operation_hash text;
  event_id uuid;
begin
  if nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'rejection key and reason are required';
  end if;
  select branch_id into target_branch_id
  from erp.purchase_orders
  where id = target_purchase_order_id and organization_id = actor_organization_id
  for update;
  if target_branch_id is null then
    raise exception using errcode = 'no_data_found', message = 'purchase order not found';
  end if;
  if not erp.has_permission('purchases.approve', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'purchases.approve permission is required';
  end if;
  operation_hash := md5(jsonb_build_object(
    'order_id', target_purchase_order_id, 'action', 'rejected', 'reason', operation_reason
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(
    actor_organization_id::text || ':' || target_branch_id::text || ':purchase-approval:' || operation_key,
    0
  ));
  select id into event_id
  from erp.purchase_approval_events
  where organization_id = actor_organization_id
    and branch_id = target_branch_id
    and idempotency_key = operation_key
    and request_hash = operation_hash;
  if event_id is not null then
    return event_id;
  end if;
  if exists (
    select 1 from erp.purchase_approval_events
    where organization_id = actor_organization_id
      and branch_id = target_branch_id
      and idempotency_key = operation_key
  ) then
    raise exception using errcode = 'integrity_constraint_violation',
      message = 'purchase-approval operation key is already used by another request';
  end if;
  if exists (
    select 1 from erp.purchase_approval_events
    where purchase_order_id = target_purchase_order_id
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'purchase order already has a terminal approval event';
  end if;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.purchase_approval_events (
    organization_id, purchase_order_id, branch_id, action, idempotency_key,
    request_hash, reason, actor_id
  ) values (
    actor_organization_id, target_purchase_order_id, target_branch_id, 'rejected',
    operation_key, operation_hash, operation_reason, auth.uid()
  ) returning id into event_id;
  return event_id;
end;
$$;

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
  new_receipt_id uuid;
  operation_hash text;
  normalized_lines jsonb := '[]'::jsonb;
  stock_lines jsonb := '[]'::jsonb;
  line jsonb;
  normalized_line jsonb;
  line_number integer;
  order_line erp.purchase_order_lines%rowtype;
  received_quantity numeric(18, 4);
  line_quantity numeric(18, 4);
  target_location_id uuid;
  target_unit_id uuid;
  allocated_expense numeric(18, 4);
  goods_cost numeric(18, 4);
  landed_cost numeric(18, 4);
  unit_landed numeric(24, 8);
  goods_total numeric(18, 4) := 0;
  expense_total numeric(18, 4) := 0;
  supplier_expense_total numeric(18, 4) := 0;
  posted_stock_document_id uuid;
  receipt_line_id uuid;
  expense jsonb;
  allocation jsonb;
  expense_id uuid;
  tracking_mode erp.inventory_tracking_mode;
  payment_days integer;
begin
  if lines is null or jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0
    or jsonb_array_length(lines) > 250 or pg_column_size(lines) > 1048576
    or expenses is null or jsonb_typeof(expenses) <> 'array' or jsonb_array_length(expenses) > 100
    or pg_column_size(expenses) > 1048576 or nullif(btrim(operation_key), '') is null
    or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'receipt key, reason, lines and bounded expenses are required';
  end if;
  if exists (
    select 1 from jsonb_array_elements(lines) item
    where jsonb_typeof(item) <> 'object'
      or (item->>'line_number') !~ '^[1-9][0-9]*$'
      or case when (item->>'line_number') ~ '^[1-9][0-9]*$' then
        case when length(item->>'line_number') > 10 then true
          else (item->>'line_number')::numeric > 2147483647 end
        else false end
      or nullif(item->>'purchase_order_line_id', '') is null
      or nullif(item->>'to_location_id', '') is null
      or not erp.is_finite_numeric_text(item->>'quantity')
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'receipt lines must contain valid finite values';
  end if;
  if exists (
    select 1 from jsonb_array_elements(expenses) expense_item
    where jsonb_typeof(expense_item) <> 'object'
      or not erp.is_finite_numeric_text(expense_item->>'amount_base')
      or nullif(btrim(expense_item->>'description'), '') is null
      or jsonb_typeof(expense_item->'payable_to_supplier') <> 'boolean'
      or jsonb_typeof(expense_item->'allocations') <> 'array'
      or (expense_item->>'kind') not in ('freight', 'tax', 'insurance', 'customs', 'other')
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'receipt expenses must contain valid finite values';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(expenses) expense_item
    cross join lateral jsonb_array_elements(expense_item->'allocations') allocation_item
    where jsonb_typeof(allocation_item) <> 'object'
      or (allocation_item->>'line_number') !~ '^[1-9][0-9]*$'
      or case when (allocation_item->>'line_number') ~ '^[1-9][0-9]*$' then
        case when length(allocation_item->>'line_number') > 10 then true
          else (allocation_item->>'line_number')::numeric > 2147483647 end
        else false end
      or not erp.is_finite_numeric_text(allocation_item->>'amount_base')
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'receipt allocations must contain valid finite values';
  end if;
  if exists (
    select 1 from jsonb_array_elements(lines) l
    group by (l->>'line_number') having count(*) > 1
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'receipt line numbers must be unique';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(expenses) with ordinality expense_item(value, expense_number)
    cross join lateral jsonb_array_elements(expense_item.value->'allocations') allocation_item
    group by expense_item.expense_number, allocation_item->>'line_number'
    having count(*) > 1
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'receipt expense allocations must be unique per line';
  end if;
  operation_hash := md5(jsonb_build_object(
    'order_id', target_purchase_order_id, 'reason', operation_reason,
    'lines', lines, 'expenses', expenses, 'create_payable', create_payable
  )::text);
  select * into purchase_order from erp.purchase_orders
  where id = target_purchase_order_id and organization_id = actor_organization_id;
  if not found then raise exception using errcode = 'no_data_found', message = 'purchase order not found'; end if;
  if not erp.has_permission('purchases.manage', purchase_order.branch_id)
    or not erp.has_permission('stock.move', purchase_order.branch_id)
    or not erp.has_permission('costs.manage', purchase_order.branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'purchases.manage, stock.move and costs.manage permissions are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':' || purchase_order.branch_id::text, 0));
  perform 1 from erp.purchase_orders where id = target_purchase_order_id and organization_id = actor_organization_id for update;
  select id into new_receipt_id from erp.purchase_receipts
  where organization_id = actor_organization_id and branch_id = purchase_order.branch_id
    and idempotency_key = operation_key and request_hash = operation_hash;
  if new_receipt_id is not null then return new_receipt_id; end if;
  if exists (select 1 from erp.purchase_receipts where organization_id = actor_organization_id and branch_id = purchase_order.branch_id and idempotency_key = operation_key) then
    raise exception using errcode = 'integrity_constraint_violation', message = 'purchase-receipt operation key is already used by another request';
  end if;
  if not exists (select 1 from erp.purchase_approval_events where purchase_order_id = target_purchase_order_id and action = 'approved') then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'purchase order is not approved';
  end if;
  new_receipt_id := gen_random_uuid();
  begin
    select coalesce(sum(round((e->>'amount_base')::numeric, 4)), 0) into expense_total
    from jsonb_array_elements(expenses) e;
    select coalesce(sum(round((e->>'amount_base')::numeric, 4)), 0)
      into supplier_expense_total
    from jsonb_array_elements(expenses) e
    where (e->>'payable_to_supplier')::boolean;
  exception when others then
    raise exception using errcode = 'invalid_parameter_value', message = 'invalid receipt expense amount';
  end;
  if exists (
    select 1 from jsonb_array_elements(expenses) e
    where coalesce(round((e->>'amount_base')::numeric, 4), 0) <= 0
      or nullif(btrim(e->>'description'), '') is null
      or coalesce(jsonb_typeof(e->'allocations'), '') <> 'array'
      or round((e->>'amount_base')::numeric, 4) <> coalesce((
        select sum(round((a->>'amount_base')::numeric, 4))
        from jsonb_array_elements(e->'allocations') a
      ), 0)
  ) then
    raise exception using errcode = 'check_violation', message = 'each receipt expense must reconcile exactly to its allocations';
  end if;
  if exists (
    select 1 from jsonb_array_elements(expenses) e
    cross join lateral jsonb_array_elements(e->'allocations') a
    where round((a->>'amount_base')::numeric, 4) <= 0
      or not exists (select 1 from jsonb_array_elements(lines) l where (l->>'line_number')::integer = (a->>'line_number')::integer)
  ) then
    raise exception using errcode = 'check_violation', message = 'expense allocations must be positive and reference receipt lines';
  end if;
  for line in select value from jsonb_array_elements(lines) loop
    begin
      line_number := (line->>'line_number')::integer;
      line_quantity := (line->>'quantity')::numeric;
      target_location_id := (line->>'to_location_id')::uuid;
      target_unit_id := nullif(line->>'inventory_unit_id', '')::uuid;
      select * into strict order_line from erp.purchase_order_lines
      where id = (line->>'purchase_order_line_id')::uuid
        and purchase_order_id = target_purchase_order_id and organization_id = actor_organization_id;
    exception when no_data_found then
      raise exception using errcode = 'foreign_key_violation', message = format('purchase-order line not found for receipt line %s', coalesce(line_number, 0));
    when others then
      raise exception using errcode = 'invalid_parameter_value', message = 'invalid purchase-receipt line';
    end;
    if line_quantity = 'NaN'::numeric or line_number <= 0 or line_quantity <= 0 or not exists (
      select 1 from erp.locations where id = target_location_id and organization_id = actor_organization_id
        and branch_id = purchase_order.branch_id and is_active
    ) then
      raise exception using errcode = 'check_violation', message = format('invalid purchase-receipt line %s values', line_number);
    end if;
    select inventory_tracking into tracking_mode from erp.products
    where id = order_line.product_id and organization_id = actor_organization_id;
    if (tracking_mode in ('serial', 'imei') and (target_unit_id is null or line_quantity <> 1))
      or (tracking_mode = 'quantity' and target_unit_id is not null) then
      raise exception using errcode = 'check_violation', message = format('receipt tracking does not match line %s', line_number);
    end if;
    if target_unit_id is not null and not exists (
      select 1 from erp.inventory_units where id = target_unit_id and organization_id = actor_organization_id
        and product_id = order_line.product_id and variant_id is not distinct from order_line.variant_id
        and status = 'quarantine' and current_location_id is null and is_active
    ) then
      raise exception using errcode = 'check_violation', message = format('serialized unit is not ready on line %s', line_number);
    end if;
    select coalesce(sum(existing.quantity), 0) into received_quantity
    from erp.purchase_receipt_lines existing
    join erp.purchase_receipts receipt on receipt.id = existing.receipt_id
    where existing.purchase_order_line_id = order_line.id and receipt.stock_document_id is not null;
    select received_quantity + coalesce(sum((prior->>'quantity')::numeric), 0)
      into received_quantity
    from jsonb_array_elements(lines) prior
    where (prior->>'purchase_order_line_id')::uuid = order_line.id
      and (prior->>'line_number')::integer < line_number;
    if received_quantity + line_quantity > order_line.ordered_quantity then
      raise exception using errcode = 'check_violation', message = format('receipt would exceed ordered quantity on line %s', order_line.line_number);
    end if;
    select coalesce(sum(round((a->>'amount_base')::numeric, 4)), 0) into allocated_expense
    from jsonb_array_elements(expenses) e
    cross join lateral jsonb_array_elements(e->'allocations') a
    where (a->>'line_number')::integer = line_number;
    goods_cost := round((order_line.unit_price * line_quantity + order_line.tax_amount * line_quantity / order_line.ordered_quantity) * purchase_order.exchange_rate, 4);
    landed_cost := goods_cost + allocated_expense;
    unit_landed := round(landed_cost / line_quantity, 8);
    goods_total := goods_total + goods_cost;
    normalized_line := jsonb_build_object(
      'line_number', line_number, 'purchase_order_line_id', order_line.id,
      'product_id', order_line.product_id, 'variant_id', order_line.variant_id,
      'inventory_unit_id', target_unit_id, 'to_location_id', target_location_id,
      'quantity', line_quantity, 'unit_price', order_line.unit_price,
      'goods_cost_base', goods_cost, 'allocated_expense_base', allocated_expense,
      'landed_cost_base', landed_cost, 'unit_landed_cost', unit_landed,
      'rounding_adjustment_base', landed_cost - round(unit_landed * line_quantity, 4)
    );
    normalized_lines := normalized_lines || jsonb_build_array(normalized_line);
    stock_lines := stock_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'product_id', order_line.product_id, 'variant_id', order_line.variant_id,
      'inventory_unit_id', target_unit_id, 'to_location_id', target_location_id,
      'quantity', line_quantity, 'unit_cost', unit_landed
    )));
  end loop;
  if round((select coalesce(sum((n->>'allocated_expense_base')::numeric), 0) from jsonb_array_elements(normalized_lines) n), 4)
    <> round(expense_total, 4) then
    raise exception using errcode = 'check_violation', message = 'allocated landed expense does not reconcile to receipt expense total';
  end if;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.purchase_receipts (
    id, organization_id, branch_id, purchase_order_id, supplier_id, currency_code,
    exchange_snapshot_id, exchange_rate, idempotency_key, request_hash, reason,
    goods_total_base, expense_total_base, landed_total_base, payable_created, received_by
  ) values (
    new_receipt_id, actor_organization_id, purchase_order.branch_id, purchase_order.id,
    purchase_order.supplier_id, purchase_order.currency_code, purchase_order.exchange_snapshot_id,
    purchase_order.exchange_rate, operation_key, operation_hash, operation_reason,
     goods_total, expense_total, goods_total + expense_total,
     create_payable and goods_total + supplier_expense_total > 0, auth.uid()
  );
  for normalized_line in select value from jsonb_array_elements(normalized_lines) loop
    insert into erp.purchase_receipt_lines (
      organization_id, receipt_id, branch_id, purchase_order_line_id, line_number, product_id,
      variant_id, inventory_unit_id, to_location_id, quantity, unit_price,
       goods_cost_base, allocated_expense_base, landed_cost_base, unit_landed_cost,
       rounding_adjustment_base
    ) values (
      actor_organization_id, new_receipt_id, purchase_order.branch_id,
      (normalized_line->>'purchase_order_line_id')::uuid,
      (normalized_line->>'line_number')::integer, (normalized_line->>'product_id')::uuid,
      nullif(normalized_line->>'variant_id', '')::uuid, nullif(normalized_line->>'inventory_unit_id', '')::uuid,
      (normalized_line->>'to_location_id')::uuid, (normalized_line->>'quantity')::numeric,
      (normalized_line->>'unit_price')::numeric, (normalized_line->>'goods_cost_base')::numeric,
      (normalized_line->>'allocated_expense_base')::numeric, (normalized_line->>'landed_cost_base')::numeric,
       (normalized_line->>'unit_landed_cost')::numeric,
       (normalized_line->>'rounding_adjustment_base')::numeric
    );
  end loop;
  line_number := 0;
  for expense in select value from jsonb_array_elements(expenses) loop
    line_number := line_number + 1;
    insert into erp.purchase_receipt_expenses (
      organization_id, receipt_id, expense_number, kind, description, amount_base,
      payable_to_supplier
    ) values (
      actor_organization_id, new_receipt_id, line_number, (expense->>'kind')::erp.purchase_expense_kind,
      expense->>'description', round((expense->>'amount_base')::numeric, 4),
      (expense->>'payable_to_supplier')::boolean
    ) returning id into expense_id;
    for allocation in select value from jsonb_array_elements(expense->'allocations') loop
      select receipt_line.id into strict receipt_line_id
      from erp.purchase_receipt_lines receipt_line
      where receipt_line.receipt_id = new_receipt_id
        and receipt_line.organization_id = actor_organization_id
        and receipt_line.line_number = (allocation->>'line_number')::integer;
      insert into erp.purchase_expense_allocations (
        organization_id, receipt_id, expense_id, receipt_line_id, amount_base
      ) values (
        actor_organization_id, new_receipt_id, expense_id, receipt_line_id,
         round((allocation->>'amount_base')::numeric, 4)
      );
    end loop;
  end loop;
  posted_stock_document_id := erp.post_stock_document(
    'receipt', purchase_order.branch_id, 'purchase-receipt:' || new_receipt_id::text,
    operation_reason, stock_lines, false, 'purchase_receipt', new_receipt_id
  );
  update erp.purchase_receipts
  set stock_document_id = posted_stock_document_id
  where id = new_receipt_id and organization_id = actor_organization_id and stock_document_id is null;
  for normalized_line in select value from jsonb_array_elements(normalized_lines) loop
    select receipt_line.id into strict receipt_line_id
    from erp.purchase_receipt_lines receipt_line
    where receipt_line.receipt_id = new_receipt_id
      and receipt_line.organization_id = actor_organization_id
      and receipt_line.line_number = (normalized_line->>'line_number')::integer;
    insert into erp.inventory_cost_entries (
      organization_id, branch_id, receipt_id, receipt_line_id, product_id, variant_id,
      inventory_unit_id, entry_kind, quantity_delta, total_cost_base, unit_cost_base
    ) values (
      actor_organization_id, purchase_order.branch_id, new_receipt_id, receipt_line_id,
      (normalized_line->>'product_id')::uuid, nullif(normalized_line->>'variant_id', '')::uuid,
      nullif(normalized_line->>'inventory_unit_id', '')::uuid, 'purchase_receipt',
      (normalized_line->>'quantity')::numeric, (normalized_line->>'landed_cost_base')::numeric,
      (normalized_line->>'unit_landed_cost')::numeric
    );
    if nullif(normalized_line->>'inventory_unit_id', '') is null then
      insert into erp.inventory_cost_balances (
        organization_id, branch_id, product_id, variant_id, valued_quantity,
        total_cost_base, weighted_average_cost
      ) values (
        actor_organization_id, purchase_order.branch_id, (normalized_line->>'product_id')::uuid,
        nullif(normalized_line->>'variant_id', '')::uuid, (normalized_line->>'quantity')::numeric,
        (normalized_line->>'landed_cost_base')::numeric, (normalized_line->>'unit_landed_cost')::numeric
      ) on conflict (organization_id, branch_id, product_id, variant_key) do update
      set valued_quantity = erp.inventory_cost_balances.valued_quantity + excluded.valued_quantity,
          total_cost_base = erp.inventory_cost_balances.total_cost_base + excluded.total_cost_base,
          weighted_average_cost = round(
            (erp.inventory_cost_balances.total_cost_base + excluded.total_cost_base)
            / (erp.inventory_cost_balances.valued_quantity + excluded.valued_quantity), 4
          ), updated_at = now();
    else
      insert into erp.serialized_acquisition_costs (
        organization_id, inventory_unit_id, receipt_line_id, acquisition_cost_base, acquired_at
      ) values (
        actor_organization_id, (normalized_line->>'inventory_unit_id')::uuid, receipt_line_id,
        (normalized_line->>'unit_landed_cost')::numeric, now()
      );
      update erp.inventory_units set acquisition_cost = (normalized_line->>'unit_landed_cost')::numeric,
        acquired_at = now(), updated_by = auth.uid()
      where id = (normalized_line->>'inventory_unit_id')::uuid and organization_id = actor_organization_id
        and acquisition_cost in (0, (normalized_line->>'unit_landed_cost')::numeric);
      if not found then raise exception using errcode = 'check_violation', message = 'serialized unit already has a different acquisition cost'; end if;
    end if;
  end loop;
   if create_payable and goods_total + supplier_expense_total > 0 then
    select payment_terms_days into payment_days from erp.suppliers
    where id = purchase_order.supplier_id and organization_id = actor_organization_id;
    insert into erp.supplier_payables (
      organization_id, branch_id, supplier_id, receipt_id, currency_code,
      amount_currency, amount_base, exchange_snapshot_id, due_at, created_by
    ) values (
      actor_organization_id, purchase_order.branch_id, purchase_order.supplier_id, new_receipt_id,
       purchase_order.currency_code, round((goods_total + supplier_expense_total) / purchase_order.exchange_rate, 4),
       goods_total + supplier_expense_total, purchase_order.exchange_snapshot_id,
      now() + make_interval(days => payment_days), auth.uid()
    ) returning id into expense_id;
    insert into erp.supplier_account_entries (
      organization_id, branch_id, supplier_id, payable_id, amount_base_delta, actor_id
    ) values (
      actor_organization_id, purchase_order.branch_id, purchase_order.supplier_id,
       expense_id, goods_total + supplier_expense_total, auth.uid()
    );
  end if;
  return new_receipt_id;
end;
$$;

create or replace function erp.preview_price_change(
  target_price_list_id uuid,
  operation_key text,
  operation_reason text,
  changes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  operation_hash text;
  preview_id uuid;
  change jsonb;
  line_number integer := 0;
  target_product_id uuid;
  target_variant_id uuid;
  baseline_entry bigint;
  current_amount numeric(18, 4);
  proposed_amount numeric(18, 4);
begin
  if actor_organization_id is null or not erp.has_permission('pricing.manage') then
    raise exception using errcode = 'insufficient_privilege', message = 'pricing.manage permission is required';
  end if;
  if nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null
    or changes is null or jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) = 0
    or jsonb_array_length(changes) > 1000 or pg_column_size(changes) > 1048576 then
    raise exception using errcode = 'invalid_parameter_value', message = 'price preview key, reason and 1 to 1000 changes are required';
  end if;
  if not exists (select 1 from erp.price_lists where id = target_price_list_id and organization_id = actor_organization_id and is_active) then
    raise exception using errcode = 'foreign_key_violation', message = 'active price list not found';
  end if;
  if exists (
    select 1 from jsonb_array_elements(changes) item
    where jsonb_typeof(item) <> 'object'
      or nullif(item->>'product_id', '') is null
      or (item ? 'new_price' and not erp.is_finite_numeric_text(item->>'new_price'))
      or (item ? 'percent_change' and not erp.is_finite_numeric_text(item->>'percent_change'))
      or not (item ? 'new_price' or item ? 'percent_change')
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'price changes must contain valid finite values';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(changes) item
    group by item->>'product_id', coalesce(nullif(item->>'variant_id', ''), '00000000-0000-0000-0000-000000000000')
    having count(*) > 1
  ) then
    raise exception using errcode = 'invalid_parameter_value', message = 'price changes cannot repeat a product variant';
  end if;
  operation_hash := md5(jsonb_build_object('price_list_id', target_price_list_id, 'reason', operation_reason, 'changes', changes)::text);
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':price-preview:' || operation_key, 0));
  select id into preview_id from erp.price_change_previews
  where organization_id = actor_organization_id and idempotency_key = operation_key and request_hash = operation_hash;
  if preview_id is not null then return preview_id; end if;
  if exists (select 1 from erp.price_change_previews where organization_id = actor_organization_id and idempotency_key = operation_key) then
    raise exception using errcode = 'integrity_constraint_violation', message = 'price-preview operation key is already used by another request';
  end if;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.price_change_previews (
    organization_id, price_list_id, idempotency_key, request_hash, reason, formula, created_by
  ) values (
    actor_organization_id, target_price_list_id, operation_key, operation_hash,
    operation_reason, changes, auth.uid()
  ) returning id into preview_id;
  for change in select value from jsonb_array_elements(changes) loop
    line_number := line_number + 1;
    begin
      target_product_id := (change->>'product_id')::uuid;
      target_variant_id := nullif(change->>'variant_id', '')::uuid;
      baseline_entry := null;
      current_amount := null;
      select id, amount into baseline_entry, current_amount from erp.price_entries
      where organization_id = actor_organization_id and price_list_id = target_price_list_id
        and product_id = target_product_id
        and variant_key = coalesce(target_variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and effective_at <= now()
      order by effective_at desc, id desc limit 1;
      if change ? 'new_price' then proposed_amount := (change->>'new_price')::numeric;
      elsif change ? 'percent_change' and current_amount is not null then
        proposed_amount := round(current_amount * (1 + (change->>'percent_change')::numeric / 100), 4);
      else raise exception using errcode = 'invalid_parameter_value', message = 'each price change needs new_price or an existing price plus percent_change';
      end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = 'invalid_parameter_value', message = format('invalid price change line %s', line_number);
    end;
    if proposed_amount = 'NaN'::numeric or proposed_amount < 0 or not exists (
      select 1 from erp.products where id = target_product_id and organization_id = actor_organization_id and is_active
    ) or (target_variant_id is not null and not exists (
      select 1 from erp.product_variants where id = target_variant_id and product_id = target_product_id
        and organization_id = actor_organization_id and is_active
    )) then
      raise exception using errcode = 'check_violation', message = format('invalid price change line %s values', line_number);
    end if;
    insert into erp.price_change_preview_lines (
      organization_id, preview_id, line_number, product_id, variant_id,
      baseline_entry_id, current_price, proposed_price
    ) values (
      actor_organization_id, preview_id, line_number, target_product_id,
      target_variant_id, baseline_entry, current_amount, proposed_amount
    );
  end loop;
  return preview_id;
end;
$$;

create or replace function erp.apply_price_change(
  target_preview_id uuid,
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
  target_price_list_id uuid;
  target_currency text;
  operation_hash text;
  application_id uuid;
  effective_time timestamptz := clock_timestamp();
begin
  if actor_organization_id is null or not erp.has_permission('pricing.manage') then
    raise exception using errcode = 'insufficient_privilege', message = 'pricing.manage permission is required';
  end if;
  if nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'price application key and reason are required';
  end if;
  select preview.price_list_id, list.currency_code into target_price_list_id, target_currency
  from erp.price_change_previews preview join erp.price_lists list on list.id = preview.price_list_id
  where preview.id = target_preview_id and preview.organization_id = actor_organization_id;
  if target_price_list_id is null then raise exception using errcode = 'no_data_found', message = 'price preview not found'; end if;
  operation_hash := md5(jsonb_build_object('preview_id', target_preview_id, 'reason', operation_reason)::text);
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':price-list:' || target_price_list_id::text, 0));
  select id into application_id from erp.price_change_applications
  where organization_id = actor_organization_id and idempotency_key = operation_key and request_hash = operation_hash;
  if application_id is not null then return application_id; end if;
  if exists (select 1 from erp.price_change_applications where organization_id = actor_organization_id and idempotency_key = operation_key) then
    raise exception using errcode = 'integrity_constraint_violation', message = 'price-application operation key is already used by another request';
  end if;
  if exists (select 1 from erp.price_change_applications where preview_id = target_preview_id) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'price preview was already applied';
  end if;
  if exists (
    select 1
    from erp.price_change_preview_lines line
    left join lateral (
      select entry.id, entry.amount
      from erp.price_entries entry
      where entry.organization_id = actor_organization_id
        and entry.price_list_id = target_price_list_id
        and entry.product_id = line.product_id
        and entry.variant_key = line.variant_key
        and entry.effective_at <= now()
      order by entry.effective_at desc, entry.id desc
      limit 1
    ) current_entry on true
    where line.preview_id = target_preview_id
      and line.organization_id = actor_organization_id
      and (
        current_entry.id is distinct from line.baseline_entry_id
        or current_entry.amount is distinct from line.current_price
      )
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state',
      message = 'price preview is stale and must be regenerated';
  end if;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.price_change_applications (
    organization_id, preview_id, idempotency_key, request_hash, reason, applied_at, applied_by
  ) values (
    actor_organization_id, target_preview_id, operation_key, operation_hash,
    operation_reason, effective_time, auth.uid()
  ) returning id into application_id;
  insert into erp.price_entries (
    organization_id, price_list_id, product_id, variant_id, amount,
    currency_code, application_id, effective_at
  ) select actor_organization_id, target_price_list_id, line.product_id, line.variant_id,
      line.proposed_price, target_currency, application_id, effective_time
    from erp.price_change_preview_lines line
    where line.preview_id = target_preview_id and line.organization_id = actor_organization_id
    order by line.line_number;
  if not found then raise exception using errcode = 'data_exception', message = 'price preview has no lines'; end if;
  return application_id;
end;
$$;

create trigger purchase_receipts_immutable before update or delete on erp.purchase_receipts
for each row execute function erp.protect_purchase_receipt();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'exchange_rates', 'exchange_rate_snapshots', 'purchase_orders', 'purchase_order_lines',
    'purchase_approval_events', 'purchase_receipt_lines', 'purchase_receipt_expenses',
    'purchase_expense_allocations', 'inventory_cost_entries', 'serialized_acquisition_costs',
    'supplier_payables', 'supplier_account_entries', 'price_change_previews',
    'price_change_preview_lines', 'price_change_applications', 'price_entries'
  ] loop
    execute format('create trigger %I_immutable before update or delete on erp.%I for each row execute function erp.prevent_fact_mutation()', table_name, table_name);
  end loop;
end;
$$;

create trigger organization_currencies_touch before update on erp.organization_currencies
for each row execute function erp.touch_updated_at();
create trigger payment_methods_touch before update on erp.payment_methods
for each row execute function erp.touch_updated_at();
create trigger price_lists_touch before update on erp.price_lists
for each row execute function erp.touch_updated_at();
create trigger inventory_cost_balances_touch before update on erp.inventory_cost_balances
for each row execute function erp.touch_updated_at();
create trigger organization_currencies_no_delete before delete on erp.organization_currencies
for each row execute function erp.prevent_delete();
create trigger payment_methods_no_delete before delete on erp.payment_methods
for each row execute function erp.prevent_delete();
create trigger price_lists_no_delete before delete on erp.price_lists
for each row execute function erp.prevent_delete();
create trigger inventory_cost_balances_no_delete before delete on erp.inventory_cost_balances
for each row execute function erp.prevent_delete();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'organization_currencies', 'exchange_rates', 'exchange_rate_snapshots', 'purchase_orders',
    'purchase_order_lines', 'purchase_approval_events', 'purchase_receipts',
    'purchase_receipt_lines', 'purchase_receipt_expenses', 'purchase_expense_allocations',
    'inventory_cost_entries', 'inventory_cost_balances', 'serialized_acquisition_costs',
    'supplier_payables', 'supplier_account_entries', 'payment_methods', 'price_lists',
    'price_change_previews', 'price_change_preview_lines', 'price_change_applications', 'price_entries'
  ] loop
    execute format('create trigger %I_audit after insert or update on erp.%I for each row execute function erp.audit_row_change()', table_name, table_name);
    execute format('alter table erp.%I enable row level security', table_name);
  end loop;
end;
$$;

create policy organization_currencies_select on erp.organization_currencies for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('pricing.view'));
create policy exchange_rates_select on erp.exchange_rates for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('pricing.view'));
create policy exchange_rate_snapshots_select on erp.exchange_rate_snapshots for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('pricing.view'));
create policy purchase_orders_select on erp.purchase_orders for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and erp.has_permission('purchases.view', branch_id)
  and erp.has_permission('costs.view', branch_id)
);
create policy purchase_order_lines_select on erp.purchase_order_lines for select to authenticated
using (organization_id = erp.current_organization_id() and exists (
  select 1 from erp.purchase_orders o where o.id = purchase_order_id
    and o.organization_id = purchase_order_lines.organization_id
    and erp.has_permission('purchases.view', o.branch_id)
    and erp.has_permission('costs.view', o.branch_id)
));
create policy purchase_approval_events_select on erp.purchase_approval_events for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('purchases.view', branch_id));
create policy purchase_receipts_select on erp.purchase_receipts for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and erp.has_permission('purchases.view', branch_id)
  and erp.has_permission('costs.view', branch_id)
);
create policy purchase_receipt_lines_select on erp.purchase_receipt_lines for select to authenticated
using (organization_id = erp.current_organization_id() and exists (
  select 1 from erp.purchase_receipts r where r.id = receipt_id
    and r.organization_id = purchase_receipt_lines.organization_id
    and erp.has_permission('purchases.view', r.branch_id)
    and erp.has_permission('costs.view', r.branch_id)
));
create policy purchase_receipt_expenses_select on erp.purchase_receipt_expenses for select to authenticated
using (organization_id = erp.current_organization_id() and exists (
  select 1 from erp.purchase_receipts r where r.id = receipt_id
    and r.organization_id = purchase_receipt_expenses.organization_id and erp.has_permission('costs.view', r.branch_id)
));
create policy purchase_expense_allocations_select on erp.purchase_expense_allocations for select to authenticated
using (organization_id = erp.current_organization_id() and exists (
  select 1
  from erp.purchase_receipt_expenses expense
  join erp.purchase_receipts receipt on receipt.id = expense.receipt_id
    and receipt.organization_id = expense.organization_id
  where expense.id = expense_id
    and expense.organization_id = purchase_expense_allocations.organization_id
    and erp.has_permission('costs.view', receipt.branch_id)
));
create policy inventory_cost_entries_select on erp.inventory_cost_entries for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('costs.view', branch_id));
create policy inventory_cost_balances_select on erp.inventory_cost_balances for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('costs.view', branch_id));
create policy serialized_acquisition_costs_select on erp.serialized_acquisition_costs for select to authenticated
using (organization_id = erp.current_organization_id() and exists (
  select 1
  from erp.purchase_receipt_lines line
  join erp.purchase_receipts receipt on receipt.id = line.receipt_id
    and receipt.organization_id = line.organization_id
  where line.id = receipt_line_id
    and line.organization_id = serialized_acquisition_costs.organization_id
    and erp.has_permission('costs.view', receipt.branch_id)
));
create policy supplier_payables_select on erp.supplier_payables for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and erp.has_permission('purchases.view', branch_id)
  and erp.has_permission('costs.view', branch_id)
);
create policy supplier_account_entries_select on erp.supplier_account_entries for select to authenticated
using (
  organization_id = erp.current_organization_id()
  and erp.has_permission('purchases.view', branch_id)
  and erp.has_permission('costs.view', branch_id)
);
create policy payment_methods_select on erp.payment_methods for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('pricing.view'));
create policy price_lists_select on erp.price_lists for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('pricing.view'));
create policy price_change_previews_select on erp.price_change_previews for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('pricing.view'));
create policy price_change_preview_lines_select on erp.price_change_preview_lines for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('pricing.view'));
create policy price_change_applications_select on erp.price_change_applications for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('pricing.view'));
create policy price_entries_select on erp.price_entries for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('pricing.view'));

revoke all on
  erp.organization_currencies, erp.exchange_rates, erp.exchange_rate_snapshots,
  erp.purchase_orders, erp.purchase_order_lines, erp.purchase_approval_events,
  erp.purchase_receipts, erp.purchase_receipt_lines, erp.purchase_receipt_expenses,
  erp.purchase_expense_allocations, erp.inventory_cost_entries, erp.inventory_cost_balances,
  erp.serialized_acquisition_costs, erp.supplier_payables, erp.supplier_account_entries,
  erp.payment_methods, erp.price_lists, erp.price_change_previews,
  erp.price_change_preview_lines, erp.price_change_applications, erp.price_entries
from public, anon, authenticated, service_role;

grant select on
  erp.organization_currencies, erp.exchange_rates, erp.exchange_rate_snapshots,
  erp.purchase_orders, erp.purchase_order_lines, erp.purchase_approval_events,
  erp.purchase_receipts, erp.purchase_receipt_lines, erp.purchase_receipt_expenses,
  erp.purchase_expense_allocations, erp.inventory_cost_entries, erp.inventory_cost_balances,
  erp.serialized_acquisition_costs, erp.supplier_payables, erp.supplier_account_entries,
  erp.payment_methods, erp.price_lists, erp.price_change_previews,
  erp.price_change_preview_lines, erp.price_change_applications, erp.price_entries
to authenticated, service_role;

revoke all on sequence erp.inventory_cost_entries_id_seq from public, anon, authenticated, service_role;
revoke all on sequence erp.supplier_account_entries_id_seq from public, anon, authenticated, service_role;
revoke all on sequence erp.price_entries_id_seq from public, anon, authenticated, service_role;

revoke all on function erp.post_stock_document_core(erp.stock_document_kind, uuid, text, text, jsonb, boolean, text, uuid) from public, anon, authenticated, service_role;
revoke all on function erp.post_stock_document(erp.stock_document_kind, uuid, text, text, jsonb, boolean, text, uuid) from public, anon, service_role;
revoke all on function erp.reverse_stock_document_core(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function erp.reverse_stock_document(uuid, text, text) from public, anon, service_role;
revoke all on function erp.capture_exchange_rate(text, numeric, text, timestamptz, text, text) from public, anon, service_role;
revoke all on function erp.create_purchase_order(uuid, uuid, text, uuid, text, text, jsonb) from public, anon, service_role;
revoke all on function erp.approve_purchase_order(uuid, text, text) from public, anon, service_role;
revoke all on function erp.reject_purchase_order(uuid, text, text) from public, anon, service_role;
revoke all on function erp.post_purchase_receipt(uuid, text, text, jsonb, jsonb, boolean) from public, anon, service_role;
revoke all on function erp.preview_price_change(uuid, text, text, jsonb) from public, anon, service_role;
revoke all on function erp.apply_price_change(uuid, text, text) from public, anon, service_role;
revoke all on function erp.prevent_fact_mutation() from public, anon, authenticated, service_role;
revoke all on function erp.protect_purchase_receipt() from public, anon, authenticated, service_role;
revoke all on function erp.is_finite_numeric_text(text) from public, anon, authenticated, service_role;

grant execute on function erp.post_stock_document(erp.stock_document_kind, uuid, text, text, jsonb, boolean, text, uuid) to authenticated;
grant execute on function erp.reverse_stock_document(uuid, text, text) to authenticated;
grant execute on function erp.capture_exchange_rate(text, numeric, text, timestamptz, text, text) to authenticated;
grant execute on function erp.create_purchase_order(uuid, uuid, text, uuid, text, text, jsonb) to authenticated;
grant execute on function erp.approve_purchase_order(uuid, text, text) to authenticated;
grant execute on function erp.reject_purchase_order(uuid, text, text) to authenticated;
grant execute on function erp.post_purchase_receipt(uuid, text, text, jsonb, jsonb, boolean) to authenticated;
grant execute on function erp.preview_price_change(uuid, text, text, jsonb) to authenticated;
grant execute on function erp.apply_price_change(uuid, text, text) to authenticated;

comment on table erp.inventory_cost_entries is
  'Authoritative append-only receipt valuation ledger. Outbound COGS and cost depletion are integrated in stage 5.';
