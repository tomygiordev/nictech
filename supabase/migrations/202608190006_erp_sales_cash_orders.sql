create type erp.sale_line_kind as enum ('product', 'service', 'free_concept');
create type erp.sale_state as enum ('confirmed', 'cancelled');
create type erp.sale_payment_state as enum ('unpaid', 'partial', 'paid', 'refunded');
create type erp.sale_delivery_state as enum (
  'pending', 'preparing', 'ready', 'dispatched', 'delivered', 'returned'
);
create type erp.cash_movement_kind as enum (
  'payment', 'refund', 'contribution', 'withdrawal', 'expense'
);
create type erp.web_payment_status as enum (
  'pending', 'approved', 'rejected', 'cancelled', 'refunded'
);
create type erp.integration_attempt_status as enum ('succeeded', 'failed');

alter table erp.payment_methods
  add column settlement_kind text not null default 'card'
    check (settlement_kind in ('cash', 'card', 'bank', 'wallet', 'credit')),
  add column requires_cash_session boolean not null default false;

create table erp.cash_registers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  code text not null check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint cash_registers_id_org_unique unique (id, organization_id),
  constraint cash_registers_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint cash_registers_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint cash_registers_code_unique unique (organization_id, branch_id, code)
);

create table erp.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  cash_register_id uuid not null,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null,
  reason text not null check (btrim(reason) <> ''),
  opened_at timestamptz not null default now(),
  opened_by uuid references auth.users(id) on delete restrict,
  constraint cash_sessions_id_org_unique unique (id, organization_id),
  constraint cash_sessions_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint cash_sessions_register_fk foreign key (cash_register_id, organization_id, branch_id)
    references erp.cash_registers(id, organization_id, branch_id) on delete restrict,
  constraint cash_sessions_operation_unique unique (organization_id, branch_id, idempotency_key)
);

create table erp.cash_session_opening_counts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  cash_session_id uuid not null,
  branch_id uuid not null,
  currency_code text not null,
  amount numeric(18, 4) not null check (amount <> 'NaN'::numeric and amount >= 0),
  created_at timestamptz not null default now(),
  constraint cash_opening_session_fk foreign key (cash_session_id, organization_id, branch_id)
    references erp.cash_sessions(id, organization_id, branch_id) on delete restrict,
  constraint cash_opening_currency_fk foreign key (organization_id, currency_code)
    references erp.organization_currencies(organization_id, currency_code) on delete restrict,
  constraint cash_opening_currency_unique unique (cash_session_id, currency_code),
  constraint cash_opening_session_currency_unique unique (
    cash_session_id, organization_id, branch_id, currency_code
  )
);

create table erp.cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  cash_session_id uuid not null,
  kind erp.cash_movement_kind not null,
  currency_code text not null,
  amount numeric(18, 4) not null check (amount <> 'NaN'::numeric and amount <> 0),
  payment_id uuid,
  reversal_of_movement_id uuid,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null,
  reason text not null check (btrim(reason) <> ''),
  occurred_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete restrict,
  constraint cash_movements_id_org_unique unique (id, organization_id),
  constraint cash_movements_session_fk foreign key (cash_session_id, organization_id, branch_id)
    references erp.cash_sessions(id, organization_id, branch_id) on delete restrict,
  constraint cash_movements_opened_currency_fk foreign key (
    cash_session_id, organization_id, branch_id, currency_code
  ) references erp.cash_session_opening_counts(
    cash_session_id, organization_id, branch_id, currency_code
  ) on delete restrict,
  constraint cash_movements_currency_fk foreign key (organization_id, currency_code)
    references erp.organization_currencies(organization_id, currency_code) on delete restrict,
  constraint cash_movements_reversal_fk foreign key (reversal_of_movement_id, organization_id)
    references erp.cash_movements(id, organization_id) on delete restrict,
  constraint cash_movements_operation_unique unique (organization_id, branch_id, idempotency_key),
  constraint cash_movements_reversal_unique unique (reversal_of_movement_id),
  constraint cash_movements_sign check (
    (kind in ('payment', 'contribution') and amount > 0)
    or (kind in ('refund', 'withdrawal', 'expense') and amount < 0)
  )
);

create table erp.cash_closures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  cash_session_id uuid not null,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null,
  reason text not null check (btrim(reason) <> ''),
  closed_at timestamptz not null default now(),
  closed_by uuid references auth.users(id) on delete restrict,
  constraint cash_closures_id_org_unique unique (id, organization_id),
  constraint cash_closures_session_fk foreign key (cash_session_id, organization_id, branch_id)
    references erp.cash_sessions(id, organization_id, branch_id) on delete restrict,
  constraint cash_closures_session_unique unique (cash_session_id),
  constraint cash_closures_operation_unique unique (organization_id, branch_id, idempotency_key)
);

create table erp.cash_close_counts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  cash_closure_id uuid not null,
  currency_code text not null,
  expected_amount numeric(18, 4) not null check (expected_amount <> 'NaN'::numeric),
  counted_amount numeric(18, 4) not null check (counted_amount <> 'NaN'::numeric and counted_amount >= 0),
  difference_amount numeric(18, 4) not null check (
    difference_amount <> 'NaN'::numeric and difference_amount = counted_amount - expected_amount
  ),
  created_at timestamptz not null default now(),
  constraint cash_close_counts_closure_fk foreign key (cash_closure_id, organization_id)
    references erp.cash_closures(id, organization_id) on delete restrict,
  constraint cash_close_counts_currency_fk foreign key (organization_id, currency_code)
    references erp.organization_currencies(organization_id, currency_code) on delete restrict,
  constraint cash_close_counts_currency_unique unique (cash_closure_id, currency_code)
);

create table erp.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  customer_id uuid,
  currency_code text not null,
  exchange_snapshot_id uuid not null,
  exchange_rate numeric(24, 10) not null check (exchange_rate <> 'NaN'::numeric and exchange_rate > 0),
  stock_document_id uuid,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null,
  reason text not null check (btrim(reason) <> ''),
  subtotal_amount numeric(18, 4) not null check (subtotal_amount <> 'NaN'::numeric and subtotal_amount >= 0),
  discount_amount numeric(18, 4) not null check (discount_amount <> 'NaN'::numeric and discount_amount >= 0),
  tax_amount numeric(18, 4) not null check (tax_amount <> 'NaN'::numeric and tax_amount >= 0),
  total_amount numeric(18, 4) not null check (
    total_amount <> 'NaN'::numeric
    and total_amount = subtotal_amount - discount_amount + tax_amount
    and total_amount >= 0
  ),
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid references auth.users(id) on delete restrict,
  constraint sales_id_org_unique unique (id, organization_id),
  constraint sales_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint sales_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint sales_customer_fk foreign key (customer_id, organization_id)
    references erp.customers(id, organization_id) on delete restrict,
  constraint sales_currency_fk foreign key (organization_id, currency_code)
    references erp.organization_currencies(organization_id, currency_code) on delete restrict,
  constraint sales_snapshot_fk foreign key (exchange_snapshot_id, organization_id)
    references erp.exchange_rate_snapshots(id, organization_id) on delete restrict,
  constraint sales_stock_fk foreign key (stock_document_id, organization_id)
    references erp.stock_documents(id, organization_id) on delete restrict,
  constraint sales_operation_unique unique (organization_id, branch_id, idempotency_key),
  constraint sales_stock_unique unique (stock_document_id),
  constraint sales_discount_not_above_subtotal check (discount_amount <= subtotal_amount)
);

create table erp.sale_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  sale_id uuid not null,
  branch_id uuid not null,
  line_number integer not null check (line_number > 0),
  kind erp.sale_line_kind not null,
  product_id uuid,
  variant_id uuid,
  inventory_unit_id uuid,
  from_location_id uuid,
  description text not null check (btrim(description) <> ''),
  quantity numeric(18, 4) not null check (quantity <> 'NaN'::numeric and quantity > 0),
  unit_price numeric(18, 4) not null check (unit_price <> 'NaN'::numeric and unit_price >= 0),
  discount_amount numeric(18, 4) not null default 0 check (discount_amount <> 'NaN'::numeric and discount_amount >= 0),
  tax_rate_percent numeric(7, 4) not null check (tax_rate_percent <> 'NaN'::numeric and tax_rate_percent between 0 and 100),
  tax_amount numeric(18, 4) not null check (tax_amount <> 'NaN'::numeric and tax_amount >= 0),
  line_total numeric(18, 4) not null check (line_total <> 'NaN'::numeric and line_total >= 0),
  created_at timestamptz not null default now(),
  constraint sale_lines_id_org_unique unique (id, organization_id),
  constraint sale_lines_id_org_sale_unique unique (id, organization_id, sale_id),
  constraint sale_lines_sale_fk foreign key (sale_id, organization_id, branch_id)
    references erp.sales(id, organization_id, branch_id) on delete restrict,
  constraint sale_lines_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint sale_lines_variant_fk foreign key (variant_id, product_id, organization_id)
    references erp.product_variants(id, product_id, organization_id) on delete restrict,
  constraint sale_lines_unit_fk foreign key (inventory_unit_id, organization_id)
    references erp.inventory_units(id, organization_id) on delete restrict,
  constraint sale_lines_location_fk foreign key (from_location_id, organization_id, branch_id)
    references erp.locations(id, organization_id, branch_id) on delete restrict,
  constraint sale_lines_number_unique unique (sale_id, line_number),
  constraint sale_lines_amounts_reconcile check (
    discount_amount <= round(quantity * unit_price, 4)
    and tax_amount = round(
      (round(quantity * unit_price, 4) - discount_amount) * tax_rate_percent / 100,
      4
    )
    and line_total = round(quantity * unit_price, 4) - discount_amount + tax_amount
  ),
  constraint sale_lines_kind_shape check (
    (kind in ('product', 'service') and product_id is not null)
    or (kind = 'free_concept' and product_id is null and variant_id is null and inventory_unit_id is null and from_location_id is null)
  ),
  constraint sale_lines_stock_shape check (
    (kind = 'product' and from_location_id is not null)
    or (kind <> 'product' and from_location_id is null and inventory_unit_id is null and variant_id is null)
  )
);

create table erp.sale_discount_authorizations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  sale_id uuid not null,
  sale_line_id uuid not null,
  authorized_amount numeric(18, 4) not null check (authorized_amount <> 'NaN'::numeric and authorized_amount > 0),
  reason text not null check (btrim(reason) <> ''),
  authorized_at timestamptz not null default now(),
  authorized_by uuid references auth.users(id) on delete restrict,
  constraint sale_discount_line_fk foreign key (sale_line_id, organization_id, sale_id)
    references erp.sale_lines(id, organization_id, sale_id) on delete restrict,
  constraint sale_discount_line_unique unique (sale_line_id)
);

create table erp.sale_state_events (
  id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  sale_id uuid not null,
  branch_id uuid not null,
  sale_state erp.sale_state,
  payment_state erp.sale_payment_state,
  delivery_state erp.sale_delivery_state,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  reason text not null check (btrim(reason) <> ''),
  occurred_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete restrict,
  constraint sale_state_events_sale_fk foreign key (sale_id, organization_id, branch_id)
    references erp.sales(id, organization_id, branch_id) on delete restrict,
  constraint sale_state_events_one_axis check (
    num_nonnulls(sale_state, payment_state, delivery_state) = 1
  ),
  constraint sale_state_events_operation_unique unique (organization_id, branch_id, idempotency_key)
);

create table erp.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  sale_id uuid not null,
  payment_method_id uuid not null,
  cash_session_id uuid,
  currency_code text not null,
  amount numeric(18, 4) not null check (amount <> 'NaN'::numeric and amount <> 0),
  amount_base numeric(18, 4) not null check (amount_base <> 'NaN'::numeric and amount_base <> 0),
  reversal_of_payment_id uuid,
  provider_reference text,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null,
  reason text not null check (btrim(reason) <> ''),
  occurred_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete restrict,
  constraint payments_id_org_unique unique (id, organization_id),
  constraint payments_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint payments_sale_fk foreign key (sale_id, organization_id, branch_id)
    references erp.sales(id, organization_id, branch_id) on delete restrict,
  constraint payments_method_fk foreign key (payment_method_id, organization_id)
    references erp.payment_methods(id, organization_id) on delete restrict,
  constraint payments_session_fk foreign key (cash_session_id, organization_id, branch_id)
    references erp.cash_sessions(id, organization_id, branch_id) on delete restrict,
  constraint payments_currency_fk foreign key (organization_id, currency_code)
    references erp.organization_currencies(organization_id, currency_code) on delete restrict,
  constraint payments_reversal_fk foreign key (reversal_of_payment_id, organization_id)
    references erp.payments(id, organization_id) on delete restrict,
  constraint payments_operation_unique unique (organization_id, branch_id, idempotency_key),
  constraint payments_reversal_unique unique (reversal_of_payment_id),
  constraint payments_signs_match check (sign(amount) = sign(amount_base)),
  constraint payments_reversal_sign check (
    (reversal_of_payment_id is null and amount > 0)
    or (reversal_of_payment_id is not null and amount < 0)
  )
);

alter table erp.cash_movements
  add constraint cash_movements_payment_fk foreign key (payment_id, organization_id)
    references erp.payments(id, organization_id) on delete restrict;

create table erp.customer_receivables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  customer_id uuid not null,
  sale_id uuid not null,
  currency_code text not null,
  original_amount numeric(18, 4) not null check (original_amount <> 'NaN'::numeric and original_amount > 0),
  original_amount_base numeric(18, 4) not null check (original_amount_base <> 'NaN'::numeric and original_amount_base > 0),
  created_at timestamptz not null default now(),
  constraint customer_receivables_id_org_unique unique (id, organization_id),
  constraint customer_receivables_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint customer_receivables_customer_fk foreign key (customer_id, organization_id)
    references erp.customers(id, organization_id) on delete restrict,
  constraint customer_receivables_sale_fk foreign key (sale_id, organization_id, branch_id)
    references erp.sales(id, organization_id, branch_id) on delete restrict,
  constraint customer_receivables_currency_fk foreign key (organization_id, currency_code)
    references erp.organization_currencies(organization_id, currency_code) on delete restrict,
  constraint customer_receivables_sale_unique unique (sale_id)
);

create table erp.customer_account_entries (
  id bigint generated always as identity primary key,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  customer_id uuid not null,
  receivable_id uuid not null,
  payment_id uuid,
  amount_base_delta numeric(18, 4) not null check (amount_base_delta <> 'NaN'::numeric and amount_base_delta <> 0),
  entry_kind text not null check (entry_kind in ('sale', 'payment', 'payment_reversal', 'sale_cancellation')),
  occurred_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete restrict,
  constraint customer_account_entries_receivable_fk foreign key (receivable_id, organization_id, branch_id)
    references erp.customer_receivables(id, organization_id, branch_id) on delete restrict,
  constraint customer_account_entries_customer_fk foreign key (customer_id, organization_id)
    references erp.customers(id, organization_id) on delete restrict,
  constraint customer_account_entries_payment_fk foreign key (payment_id, organization_id)
    references erp.payments(id, organization_id) on delete restrict,
  constraint customer_account_entries_payment_unique unique (payment_id),
  constraint customer_account_entries_shape check (
    (entry_kind in ('sale', 'sale_cancellation') and payment_id is null)
    or (entry_kind in ('payment', 'payment_reversal') and payment_id is not null)
  )
);

create table erp.web_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  customer_id uuid,
  currency_code text not null,
  exchange_snapshot_id uuid not null,
  exchange_rate numeric(24, 10) not null check (exchange_rate <> 'NaN'::numeric and exchange_rate > 0),
  reservation_batch_id uuid,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null,
  total_amount numeric(18, 4) not null check (total_amount <> 'NaN'::numeric and total_amount >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint web_orders_id_org_unique unique (id, organization_id),
  constraint web_orders_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint web_orders_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint web_orders_customer_fk foreign key (customer_id, organization_id)
    references erp.customers(id, organization_id) on delete restrict,
  constraint web_orders_snapshot_fk foreign key (exchange_snapshot_id, organization_id)
    references erp.exchange_rate_snapshots(id, organization_id) on delete restrict,
  constraint web_orders_reservation_fk foreign key (reservation_batch_id, organization_id)
    references erp.stock_reservation_batches(id, organization_id) on delete restrict,
  constraint web_orders_operation_unique unique (organization_id, branch_id, idempotency_key),
  constraint web_orders_reservation_unique unique (reservation_batch_id)
);

create table erp.web_order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  web_order_id uuid not null,
  branch_id uuid not null,
  line_number integer not null check (line_number > 0),
  product_id uuid not null,
  variant_id uuid,
  inventory_unit_id uuid,
  location_id uuid not null,
  description text not null check (btrim(description) <> ''),
  quantity numeric(18, 4) not null check (quantity <> 'NaN'::numeric and quantity > 0),
  unit_price numeric(18, 4) not null check (unit_price <> 'NaN'::numeric and unit_price >= 0),
  tax_rate_percent numeric(7, 4) not null check (tax_rate_percent <> 'NaN'::numeric and tax_rate_percent between 0 and 100),
  tax_amount numeric(18, 4) not null check (tax_amount <> 'NaN'::numeric and tax_amount >= 0),
  line_total numeric(18, 4) not null check (
    line_total <> 'NaN'::numeric
    and tax_amount = round(round(quantity * unit_price, 4) * tax_rate_percent / 100, 4)
    and line_total = round(quantity * unit_price, 4) + tax_amount
  ),
  created_at timestamptz not null default now(),
  constraint web_order_lines_order_fk foreign key (web_order_id, organization_id, branch_id)
    references erp.web_orders(id, organization_id, branch_id) on delete restrict,
  constraint web_order_lines_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint web_order_lines_variant_fk foreign key (variant_id, product_id, organization_id)
    references erp.product_variants(id, product_id, organization_id) on delete restrict,
  constraint web_order_lines_unit_fk foreign key (inventory_unit_id, organization_id)
    references erp.inventory_units(id, organization_id) on delete restrict,
  constraint web_order_lines_location_fk foreign key (location_id, organization_id, branch_id)
    references erp.locations(id, organization_id, branch_id) on delete restrict,
  constraint web_order_lines_number_unique unique (web_order_id, line_number)
);

create table erp.web_payment_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  web_order_id uuid not null,
  provider text not null check (btrim(provider) <> ''),
  provider_event_id text not null check (btrim(provider_event_id) <> ''),
  provider_payment_id text,
  status erp.web_payment_status not null,
  payment_method_id uuid,
  amount numeric(18, 4) check (amount is null or (amount <> 'NaN'::numeric and amount >= 0)),
  provider_occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  applied boolean not null,
  error_message text,
  actor_id uuid references auth.users(id) on delete restrict,
  constraint web_payment_events_id_org_unique unique (id, organization_id),
  constraint web_payment_events_id_org_order_unique unique (id, organization_id, web_order_id),
  constraint web_payment_events_order_fk foreign key (web_order_id, organization_id, branch_id)
    references erp.web_orders(id, organization_id, branch_id) on delete restrict,
  constraint web_payment_events_method_fk foreign key (payment_method_id, organization_id)
    references erp.payment_methods(id, organization_id) on delete restrict,
  constraint web_payment_events_provider_unique unique (organization_id, provider, provider_event_id),
  constraint web_payment_events_approved_shape check (
    status <> 'approved' or (payment_method_id is not null and amount is not null and amount > 0)
  )
);

create table erp.web_provider_payments (
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  provider text not null check (btrim(provider) <> ''),
  provider_payment_id text not null check (btrim(provider_payment_id) <> ''),
  web_order_id uuid not null,
  branch_id uuid not null,
  claimed_at timestamptz not null default now(),
  constraint web_provider_payments_pk primary key (
    organization_id, provider, provider_payment_id
  ),
  constraint web_provider_payments_order_fk foreign key (
    web_order_id, organization_id, branch_id
  ) references erp.web_orders(id, organization_id, branch_id) on delete restrict
);

create table erp.web_order_events (
  id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  web_order_id uuid not null,
  order_state text,
  payment_state erp.sale_payment_state,
  delivery_state erp.sale_delivery_state,
  source_payment_event_id uuid,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null,
  reason text not null check (btrim(reason) <> ''),
  occurred_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete restrict,
  constraint web_order_events_order_fk foreign key (web_order_id, organization_id, branch_id)
    references erp.web_orders(id, organization_id, branch_id) on delete restrict,
  constraint web_order_events_payment_event_fk foreign key (
    source_payment_event_id, organization_id, web_order_id
  ) references erp.web_payment_events(id, organization_id, web_order_id) on delete restrict,
  constraint web_order_events_one_axis check (num_nonnulls(order_state, payment_state, delivery_state) = 1),
  constraint web_order_events_order_state_check check (
    order_state is null or order_state in ('placed', 'confirmed', 'cancelled', 'fulfilled', 'refunded')
  ),
  constraint web_order_events_operation_unique unique (organization_id, branch_id, idempotency_key)
);

create table erp.web_order_fulfillments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  web_order_id uuid not null,
  sale_id uuid not null,
  reservation_batch_id uuid not null,
  stock_document_id uuid not null,
  fulfilled_at timestamptz not null default now(),
  fulfilled_by uuid references auth.users(id) on delete restrict,
  constraint web_order_fulfillments_order_fk foreign key (web_order_id, organization_id, branch_id)
    references erp.web_orders(id, organization_id, branch_id) on delete restrict,
  constraint web_order_fulfillments_sale_fk foreign key (sale_id, organization_id, branch_id)
    references erp.sales(id, organization_id, branch_id) on delete restrict,
  constraint web_order_fulfillments_reservation_fk foreign key (reservation_batch_id, organization_id)
    references erp.stock_reservation_batches(id, organization_id) on delete restrict,
  constraint web_order_fulfillments_stock_fk foreign key (stock_document_id, organization_id)
    references erp.stock_documents(id, organization_id) on delete restrict,
  constraint web_order_fulfillments_order_unique unique (web_order_id),
  constraint web_order_fulfillments_sale_unique unique (sale_id)
);

create table erp.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  aggregate_type text not null check (btrim(aggregate_type) <> ''),
  aggregate_id uuid not null,
  event_type text not null check (btrim(event_type) <> ''),
  payload jsonb not null,
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint integration_outbox_id_org_unique unique (id, organization_id),
  constraint integration_outbox_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint integration_outbox_operation_unique unique (organization_id, idempotency_key)
);

create table erp.integration_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  outbox_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  status erp.integration_attempt_status not null,
  error_message text,
  attempted_at timestamptz not null default now(),
  attempted_by uuid references auth.users(id) on delete restrict,
  constraint integration_attempts_outbox_fk foreign key (outbox_id, organization_id)
    references erp.integration_outbox(id, organization_id) on delete restrict,
  constraint integration_attempts_number_unique unique (outbox_id, attempt_number),
  constraint integration_attempts_error_shape check (
    (status = 'succeeded' and error_message is null)
    or (status = 'failed' and nullif(btrim(error_message), '') is not null)
  )
);

create index cash_movements_session_currency_idx
  on erp.cash_movements (cash_session_id, currency_code, occurred_at, id);
create index sale_state_events_sale_time_idx
  on erp.sale_state_events (sale_id, event_sequence desc);
create index payments_sale_time_idx
  on erp.payments (sale_id, occurred_at, id);
create index customer_account_entries_customer_time_idx
  on erp.customer_account_entries (organization_id, customer_id, occurred_at, id);
create index web_payment_events_order_time_idx
  on erp.web_payment_events (web_order_id, provider_occurred_at desc, received_at desc, id desc);
create index web_order_events_order_time_idx
  on erp.web_order_events (web_order_id, event_sequence desc);
create index integration_outbox_available_idx
  on erp.integration_outbox (organization_id, available_at, id);
create index integration_attempts_outbox_idx
  on erp.integration_attempts (outbox_id, attempt_number desc);

create or replace function erp.audit_operational_fact()
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
    new.organization_id, nullif(to_jsonb(new)->>'branch_id', '')::uuid, auth.uid(),
    tg_table_schema, tg_table_name, to_jsonb(new)->>'id', 'insert',
    nullif(current_setting('erp.operation_reason', true), ''),
    jsonb_build_object('redacted', true, 'trigger', tg_name)
  );
  return null;
end;
$$;

create or replace function erp.validate_payment_reversal()
returns trigger
language plpgsql
set search_path = erp, pg_catalog
as $$
declare
  method_requires_cash boolean;
begin
  select requires_cash_session into method_requires_cash
  from erp.payment_methods
  where id = new.payment_method_id and organization_id = new.organization_id and is_active;
  if method_requires_cash is null
    or (method_requires_cash and new.cash_session_id is null)
    or (not method_requires_cash and new.cash_session_id is not null) then
    raise exception using errcode = 'check_violation', message = 'payment cash session does not match its payment method';
  end if;
  if new.cash_session_id is not null and not exists (
    select 1 from erp.cash_session_opening_counts opening
    where opening.cash_session_id = new.cash_session_id
      and opening.organization_id = new.organization_id
      and opening.branch_id = new.branch_id
      and opening.currency_code = new.currency_code
  ) then
    raise exception using errcode = 'foreign_key_violation', message = 'payment currency is not open in its cash session';
  end if;
  if new.reversal_of_payment_id is not null and not exists (
    select 1 from erp.payments original
    where original.id = new.reversal_of_payment_id
      and original.organization_id = new.organization_id
      and original.branch_id = new.branch_id
      and original.sale_id = new.sale_id
      and original.payment_method_id = new.payment_method_id
      and original.currency_code = new.currency_code
      and original.amount = -new.amount
      and original.amount_base = -new.amount_base
      and original.reversal_of_payment_id is null
  ) then
    raise exception using errcode = 'check_violation', message = 'payment reversal must exactly offset its original payment';
  end if;
  return new;
end;
$$;

create or replace function erp.validate_cash_reversal()
returns trigger
language plpgsql
set search_path = erp, pg_catalog
as $$
begin
  if new.kind = 'payment' and not exists (
    select 1 from erp.payments payment
    where payment.id = new.payment_id
      and payment.organization_id = new.organization_id
      and payment.branch_id = new.branch_id
      and payment.cash_session_id = new.cash_session_id
      and payment.currency_code = new.currency_code
      and payment.amount = new.amount
      and payment.reversal_of_payment_id is null
  ) then
    raise exception using errcode = 'check_violation', message = 'cash payment movement must match its payment';
  end if;
  if new.reversal_of_movement_id is not null and not exists (
    select 1
    from erp.cash_movements original
    join erp.payments reversal on reversal.id = new.payment_id
    where original.id = new.reversal_of_movement_id
      and original.organization_id = new.organization_id
      and original.branch_id = new.branch_id
      and original.currency_code = new.currency_code
      and original.amount = -new.amount
      and original.reversal_of_movement_id is null
      and reversal.organization_id = new.organization_id
      and reversal.branch_id = new.branch_id
      and reversal.cash_session_id = new.cash_session_id
      and reversal.currency_code = new.currency_code
      and reversal.amount = new.amount
      and reversal.reversal_of_payment_id = original.payment_id
  ) then
    raise exception using errcode = 'check_violation', message = 'cash reversal must exactly offset its original movement';
  end if;
  return new;
end;
$$;

create trigger payments_validate before insert on erp.payments
for each row execute function erp.validate_payment_reversal();
create trigger cash_movements_validate before insert on erp.cash_movements
for each row execute function erp.validate_cash_reversal();

create or replace function erp.validate_customer_account_entry()
returns trigger
language plpgsql
set search_path = erp, pg_catalog
as $$
begin
  if not exists (
    select 1 from erp.customer_receivables receivable
    where receivable.id = new.receivable_id
      and receivable.organization_id = new.organization_id
      and receivable.branch_id = new.branch_id
      and receivable.customer_id = new.customer_id
  ) then
    raise exception using errcode = 'check_violation', message = 'customer account entry must match its receivable owner';
  end if;
  if new.payment_id is not null and not exists (
    select 1
    from erp.customer_receivables receivable
    join erp.payments payment
      on payment.sale_id = receivable.sale_id
     and payment.organization_id = receivable.organization_id
     and payment.branch_id = receivable.branch_id
    where receivable.id = new.receivable_id
      and receivable.organization_id = new.organization_id
      and receivable.branch_id = new.branch_id
      and receivable.customer_id = new.customer_id
      and payment.id = new.payment_id
  ) then
    raise exception using errcode = 'check_violation', message = 'customer account payment must belong to the receivable sale';
  end if;
  return new;
end;
$$;

create trigger customer_account_entries_validate before insert on erp.customer_account_entries
for each row execute function erp.validate_customer_account_entry();

create or replace function erp.release_web_order_reservation_core(
  target_organization_id uuid,
  target_web_order_id uuid,
  target_batch_id uuid,
  release_reason text
)
returns void
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  target_branch_id uuid;
  reservation_row record;
begin
  select branch_id into target_branch_id
  from erp.stock_reservation_batches
  where id = target_batch_id
    and organization_id = target_organization_id
    and source_type = 'online_order'
    and source_id = target_web_order_id
    and status = 'active';
  if target_branch_id is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text || ':' || target_branch_id::text, 0));
  perform 1 from erp.stock_reservation_batches
  where id = target_batch_id
    and organization_id = target_organization_id
    and source_type = 'online_order'
    and source_id = target_web_order_id
    and status = 'active'
  for update;
  if not found then return; end if;
  perform set_config('erp.operation_reason', release_reason, true);
  for reservation_row in
    select * from erp.stock_reservations where batch_id = target_batch_id order by id for update
  loop
    update erp.stock_balances
    set quantity_reserved = quantity_reserved - reservation_row.quantity, updated_at = now()
    where organization_id = target_organization_id
      and location_id = reservation_row.location_id
      and product_id = reservation_row.product_id
      and variant_key = coalesce(reservation_row.variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and quantity_reserved >= reservation_row.quantity;
    if not found then
      raise exception using errcode = 'data_exception', message = 'reservation balance is inconsistent';
    end if;
    if reservation_row.inventory_unit_id is not null then
      update erp.inventory_units set status = 'available', updated_by = auth.uid()
      where id = reservation_row.inventory_unit_id
        and organization_id = target_organization_id and status = 'reserved';
      if not found then
        raise exception using errcode = 'data_exception', message = 'reserved inventory unit is inconsistent';
      end if;
    end if;
  end loop;
  update erp.stock_reservation_batches
  set status = case when expires_at <= now() then 'expired' else 'released' end,
      released_at = now(), reason = release_reason, updated_by = auth.uid()
  where id = target_batch_id and organization_id = target_organization_id;
end;
$$;

create or replace function erp.open_cash_session(
  target_cash_register_id uuid,
  operation_key text,
  operation_reason text,
  opening_counts jsonb
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  target_branch_id uuid;
  session_id uuid;
  operation_hash text;
  count_row jsonb;
begin
  select branch_id into target_branch_id from erp.cash_registers
  where id = target_cash_register_id and organization_id = actor_organization_id and is_active;
  if target_branch_id is null or not erp.has_permission('cash.open', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'cash.open permission is required';
  end if;
  if nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null
    or opening_counts is null or jsonb_typeof(opening_counts) <> 'array'
    or jsonb_array_length(opening_counts) = 0 or jsonb_array_length(opening_counts) > 20
    or pg_column_size(opening_counts) > 1048576 then
    raise exception using errcode = 'invalid_parameter_value', message = 'operation data and opening counts are required';
  end if;
  operation_hash := md5(jsonb_build_object('register_id', target_cash_register_id, 'reason', operation_reason, 'counts', opening_counts)::text);
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':cash:' || target_cash_register_id::text, 0));
  select id into session_id from erp.cash_sessions
  where organization_id = actor_organization_id and branch_id = target_branch_id
    and idempotency_key = operation_key and request_hash = operation_hash;
  if session_id is not null then return session_id; end if;
  if exists (
    select 1 from erp.cash_sessions session
    where session.cash_register_id = target_cash_register_id
      and session.organization_id = actor_organization_id
      and not exists (select 1 from erp.cash_closures closure where closure.cash_session_id = session.id)
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'cash register already has an open session';
  end if;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.cash_sessions (
    organization_id, branch_id, cash_register_id, idempotency_key, request_hash, reason, opened_by
  ) values (
    actor_organization_id, target_branch_id, target_cash_register_id, operation_key, operation_hash, operation_reason, auth.uid()
  ) returning id into session_id;
  for count_row in select value from jsonb_array_elements(opening_counts) loop
    if jsonb_typeof(count_row) <> 'object'
      or nullif(btrim(count_row->>'currency_code'), '') is null
      or not erp.is_finite_numeric_text(count_row->>'amount')
      or (count_row->>'amount')::numeric < 0 then
      raise exception using errcode = 'invalid_parameter_value', message = 'opening amounts must be finite and nonnegative';
    end if;
    insert into erp.cash_session_opening_counts (
      organization_id, cash_session_id, branch_id, currency_code, amount
    ) values (
      actor_organization_id, session_id, target_branch_id,
      upper(btrim(count_row->>'currency_code')), (count_row->>'amount')::numeric
    );
  end loop;
  return session_id;
end;
$$;

create or replace function erp.post_cash_movement(
  target_cash_session_id uuid,
  movement_kind erp.cash_movement_kind,
  movement_currency text,
  movement_amount numeric,
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
  movement_id uuid;
  signed_amount numeric(18,4);
  operation_hash text;
begin
  select branch_id into target_branch_id from erp.cash_sessions
  where id = target_cash_session_id and organization_id = actor_organization_id;
  if target_branch_id is null or not erp.has_permission('cash.adjust', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'cash.adjust permission is required';
  end if;
  if movement_kind not in ('contribution', 'withdrawal', 'expense')
    or movement_amount is null or movement_amount = 'NaN'::numeric or movement_amount <= 0
    or nullif(btrim(movement_currency), '') is null
    or nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'valid manual cash movement data is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':cash-session:' || target_cash_session_id::text, 0));
  if exists (select 1 from erp.cash_closures where cash_session_id = target_cash_session_id) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'cash session is closed';
  end if;
  signed_amount := case when movement_kind = 'contribution' then movement_amount else -movement_amount end;
  operation_hash := md5(jsonb_build_object('session_id', target_cash_session_id, 'kind', movement_kind, 'currency', upper(btrim(movement_currency)), 'amount', signed_amount, 'reason', operation_reason)::text);
  select id into movement_id from erp.cash_movements
  where organization_id = actor_organization_id and branch_id = target_branch_id
    and idempotency_key = operation_key and request_hash = operation_hash;
  if movement_id is not null then return movement_id; end if;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.cash_movements (
    organization_id, branch_id, cash_session_id, kind, currency_code, amount,
    idempotency_key, request_hash, reason, actor_id
  ) values (
    actor_organization_id, target_branch_id, target_cash_session_id, movement_kind,
    upper(btrim(movement_currency)), signed_amount, operation_key, operation_hash, operation_reason, auth.uid()
  ) returning id into movement_id;
  return movement_id;
end;
$$;

create or replace function erp.close_cash_session(
  target_cash_session_id uuid,
  operation_key text,
  operation_reason text,
  counted_amounts jsonb
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  target_branch_id uuid;
  closure_id uuid;
  operation_hash text;
  count_row jsonb;
  expected numeric(18,4);
  counted numeric(18,4);
begin
  select branch_id into target_branch_id from erp.cash_sessions
  where id = target_cash_session_id and organization_id = actor_organization_id;
  if target_branch_id is null or not erp.has_permission('cash.close', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'cash.close permission is required';
  end if;
  if counted_amounts is null or jsonb_typeof(counted_amounts) <> 'array'
    or jsonb_array_length(counted_amounts) = 0 or jsonb_array_length(counted_amounts) > 20
    or pg_column_size(counted_amounts) > 1048576
    or nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'operation data and counted amounts are required';
  end if;
  operation_hash := md5(jsonb_build_object('session_id', target_cash_session_id, 'reason', operation_reason, 'counts', counted_amounts)::text);
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':cash-session:' || target_cash_session_id::text, 0));
  select id into closure_id from erp.cash_closures
  where cash_session_id = target_cash_session_id and idempotency_key = operation_key and request_hash = operation_hash;
  if closure_id is not null then return closure_id; end if;
  if exists (select 1 from erp.cash_closures where cash_session_id = target_cash_session_id) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'cash session is already closed';
  end if;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.cash_closures (
    organization_id, branch_id, cash_session_id, idempotency_key, request_hash, reason, closed_by
  ) values (
    actor_organization_id, target_branch_id, target_cash_session_id, operation_key, operation_hash, operation_reason, auth.uid()
  ) returning id into closure_id;
  for count_row in select value from jsonb_array_elements(counted_amounts) loop
    if jsonb_typeof(count_row) <> 'object'
      or nullif(btrim(count_row->>'currency_code'), '') is null
      or not erp.is_finite_numeric_text(count_row->>'amount') or (count_row->>'amount')::numeric < 0 then
      raise exception using errcode = 'invalid_parameter_value', message = 'counted amounts must be finite and nonnegative';
    end if;
    counted := (count_row->>'amount')::numeric;
    select coalesce(opening.amount, 0) + coalesce(sum(movement.amount), 0)
    into expected
    from erp.cash_session_opening_counts opening
    left join erp.cash_movements movement
      on movement.cash_session_id = opening.cash_session_id and movement.currency_code = opening.currency_code
    where opening.cash_session_id = target_cash_session_id
      and opening.currency_code = upper(btrim(count_row->>'currency_code'))
    group by opening.amount;
    if expected is null then
      raise exception using errcode = 'foreign_key_violation', message = 'counted currency was not opened in this session';
    end if;
    if counted <> expected and not erp.has_permission('cash.adjust', target_branch_id) then
      raise exception using errcode = 'insufficient_privilege', message = 'cash.adjust permission is required for close differences';
    end if;
    insert into erp.cash_close_counts (
      organization_id, cash_closure_id, currency_code, expected_amount, counted_amount, difference_amount
    ) values (
      actor_organization_id, closure_id, upper(btrim(count_row->>'currency_code')),
      expected, counted, counted - expected
    );
  end loop;
  if exists (
    select 1 from erp.cash_session_opening_counts opening
    where opening.cash_session_id = target_cash_session_id
      and not exists (
        select 1 from erp.cash_close_counts closed
        where closed.cash_closure_id = closure_id and closed.currency_code = opening.currency_code
      )
  ) then
    raise exception using errcode = 'check_violation', message = 'every opened currency must be counted';
  end if;
  return closure_id;
end;
$$;

create or replace function erp.record_sale_payment_core(
  target_sale_id uuid,
  target_payment_method_id uuid,
  target_cash_session_id uuid,
  payment_amount numeric,
  operation_key text,
  operation_reason text,
  provider_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  sale_row erp.sales%rowtype;
  payment_id uuid;
  method_requires_cash boolean;
  operation_hash text;
  paid_total numeric(18,4);
  receivable_row erp.customer_receivables%rowtype;
  movement_id uuid;
  next_payment_state erp.sale_payment_state;
begin
  select * into sale_row from erp.sales where id = target_sale_id and organization_id = actor_organization_id for update;
  if sale_row.id is null then raise exception using errcode = 'no_data_found', message = 'sale not found'; end if;
  if not erp.has_permission('sales.create', sale_row.branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'sales.create permission is required';
  end if;
  if exists (
    select 1 from erp.sale_state_events
    where sale_id = target_sale_id and organization_id = actor_organization_id
      and sale_state = 'cancelled'
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'cancelled sale cannot receive payments';
  end if;
  if payment_amount is null or payment_amount = 'NaN'::numeric or payment_amount <= 0
    or nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'positive payment and operation data are required';
  end if;
  select requires_cash_session into method_requires_cash from erp.payment_methods
  where id = target_payment_method_id and organization_id = actor_organization_id and is_active;
  if method_requires_cash is null then raise exception using errcode = 'foreign_key_violation', message = 'active payment method not found'; end if;
  if method_requires_cash and target_cash_session_id is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'payment method requires an open cash session';
  end if;
  if not method_requires_cash and target_cash_session_id is not null then
    raise exception using errcode = 'invalid_parameter_value', message = 'non-cash payment method cannot reference a cash session';
  end if;
  if target_cash_session_id is not null and (
    not exists (select 1 from erp.cash_sessions where id = target_cash_session_id and organization_id = actor_organization_id and branch_id = sale_row.branch_id)
    or exists (select 1 from erp.cash_closures where cash_session_id = target_cash_session_id)
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'open branch cash session is required';
  end if;
  if target_cash_session_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      actor_organization_id::text || ':cash-session:' || target_cash_session_id::text, 0
    ));
    if exists (select 1 from erp.cash_closures where cash_session_id = target_cash_session_id) then
      raise exception using errcode = 'object_not_in_prerequisite_state', message = 'open branch cash session is required';
    end if;
  end if;
  operation_hash := md5(jsonb_build_object('sale_id', target_sale_id, 'method_id', target_payment_method_id, 'session_id', target_cash_session_id, 'amount', payment_amount, 'reason', operation_reason, 'provider_reference', provider_reference)::text);
  select id into payment_id from erp.payments
  where organization_id = actor_organization_id and branch_id = sale_row.branch_id
    and idempotency_key = operation_key and request_hash = operation_hash;
  if payment_id is not null then return payment_id; end if;
  select coalesce(sum(amount), 0) into paid_total from erp.payments
  where sale_id = target_sale_id and organization_id = actor_organization_id;
  if paid_total + payment_amount > sale_row.total_amount then
    raise exception using errcode = 'check_violation', message = 'payment exceeds outstanding sale amount';
  end if;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.payments (
    organization_id, branch_id, sale_id, payment_method_id, cash_session_id,
    currency_code, amount, amount_base, provider_reference,
    idempotency_key, request_hash, reason, actor_id
  ) values (
    actor_organization_id, sale_row.branch_id, target_sale_id, target_payment_method_id,
    target_cash_session_id, sale_row.currency_code, payment_amount,
    round(payment_amount * sale_row.exchange_rate, 4), nullif(btrim(provider_reference), ''),
    operation_key, operation_hash, operation_reason, auth.uid()
  ) returning id into payment_id;
  if method_requires_cash then
    insert into erp.cash_movements (
      organization_id, branch_id, cash_session_id, kind, currency_code, amount,
      payment_id, idempotency_key, request_hash, reason, actor_id
    ) values (
      actor_organization_id, sale_row.branch_id, target_cash_session_id, 'payment',
      sale_row.currency_code, payment_amount, payment_id, operation_key || ':cash',
      operation_hash, operation_reason, auth.uid()
    ) returning id into movement_id;
  end if;
  select * into receivable_row from erp.customer_receivables
  where sale_id = target_sale_id and organization_id = actor_organization_id;
  if receivable_row.id is not null then
    insert into erp.customer_account_entries (
      organization_id, branch_id, customer_id, receivable_id, payment_id,
      amount_base_delta, entry_kind, actor_id
    ) values (
      actor_organization_id, sale_row.branch_id, receivable_row.customer_id,
      receivable_row.id, payment_id, -round(payment_amount * sale_row.exchange_rate, 4),
      'payment', auth.uid()
    );
  end if;
  next_payment_state := case
    when paid_total + payment_amount = sale_row.total_amount then 'paid'::erp.sale_payment_state
    else 'partial'::erp.sale_payment_state
  end;
  if next_payment_state is distinct from (
    select event.payment_state from erp.sale_state_events event
    where event.sale_id = target_sale_id and event.payment_state is not null
    order by event.event_sequence desc limit 1
  ) then
    insert into erp.sale_state_events (
      organization_id, sale_id, branch_id, payment_state, idempotency_key, reason, actor_id
    ) values (
      actor_organization_id, target_sale_id, sale_row.branch_id, next_payment_state,
      operation_key || ':state', operation_reason, auth.uid()
    );
  end if;
  return payment_id;
end;
$$;

create or replace function erp.create_sale(
  target_branch_id uuid,
  target_customer_id uuid,
  sale_currency text,
  target_exchange_snapshot_id uuid,
  operation_key text,
  operation_reason text,
  lines jsonb,
  payment_lines jsonb default '[]'::jsonb,
  target_reservation_batch_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  sale_id uuid;
  posted_stock_document_id uuid;
  exchange_rate_value numeric(24,10);
  operation_hash text;
  line jsonb;
  payment_line jsonb;
  line_id uuid;
  line_no integer := 0;
  line_kind erp.sale_line_kind;
  product_kind erp.catalog_item_kind;
  quantity_value numeric(18,4);
  unit_price_value numeric(18,4);
  discount_value numeric(18,4);
  tax_rate_value numeric(7,4);
  tax_value numeric(18,4);
  subtotal_value numeric(18,4) := 0;
  discount_total numeric(18,4) := 0;
  tax_total numeric(18,4) := 0;
  total_value numeric(18,4);
  stock_lines jsonb := '[]'::jsonb;
  payment_total numeric(18,4) := 0;
  receivable_id uuid;
  parsed_product_id uuid;
  parsed_variant_id uuid;
  parsed_inventory_unit_id uuid;
  parsed_location_id uuid;
begin
  if actor_organization_id is null or not erp.has_permission('sales.create', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'sales.create permission is required';
  end if;
  if nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null
    or lines is null or jsonb_typeof(lines) <> 'array' or jsonb_array_length(lines) = 0
    or jsonb_array_length(lines) > 250 or pg_column_size(lines) > 1048576
    or payment_lines is null or jsonb_typeof(payment_lines) <> 'array'
    or jsonb_array_length(payment_lines) > 20 or pg_column_size(payment_lines) > 1048576 then
    raise exception using errcode = 'invalid_parameter_value', message = 'sale operation and lines are required';
  end if;
  select rate_to_base into exchange_rate_value from erp.exchange_rate_snapshots
  where id = target_exchange_snapshot_id and organization_id = actor_organization_id
    and quote_currency = upper(btrim(sale_currency));
  if exchange_rate_value is null then raise exception using errcode = 'foreign_key_violation', message = 'matching exchange-rate snapshot is required'; end if;
  if target_customer_id is not null and not exists (
    select 1 from erp.customers where id = target_customer_id and organization_id = actor_organization_id and is_active
  ) then raise exception using errcode = 'foreign_key_violation', message = 'active customer not found'; end if;
  operation_hash := md5(jsonb_build_object('branch_id', target_branch_id, 'customer_id', target_customer_id, 'currency', upper(btrim(sale_currency)), 'snapshot_id', target_exchange_snapshot_id, 'reason', operation_reason, 'lines', lines, 'payments', payment_lines, 'reservation_id', target_reservation_batch_id)::text);
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':' || target_branch_id::text, 0));
  select id into sale_id from erp.sales where organization_id = actor_organization_id
    and branch_id = target_branch_id and idempotency_key = operation_key and request_hash = operation_hash;
  if sale_id is not null then return sale_id; end if;
  perform set_config('erp.operation_reason', operation_reason, true);
  -- Validate and total every immutable line before writing the sale header.
  for line in select value from jsonb_array_elements(lines) loop
    line_no := line_no + 1;
    if jsonb_typeof(line) <> 'object' then
      raise exception using errcode = 'invalid_parameter_value', message = format('invalid sale line %s', line_no);
    end if;
    begin
      line_kind := (line->>'kind')::erp.sale_line_kind;
      quantity_value := (line->>'quantity')::numeric;
      unit_price_value := (line->>'unit_price')::numeric;
      discount_value := coalesce(nullif(line->>'discount_amount', '')::numeric, 0);
      tax_rate_value := coalesce(nullif(line->>'tax_rate_percent', '')::numeric, 0);
      tax_value := coalesce(nullif(line->>'tax_amount', '')::numeric, 0);
      parsed_product_id := nullif(line->>'product_id', '')::uuid;
      parsed_variant_id := nullif(line->>'variant_id', '')::uuid;
      parsed_inventory_unit_id := nullif(line->>'inventory_unit_id', '')::uuid;
      parsed_location_id := nullif(line->>'from_location_id', '')::uuid;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value', message = format('invalid sale line %s', line_no);
    end;
    if quantity_value <= 0 or unit_price_value < 0 or discount_value < 0 or tax_value < 0
      or tax_rate_value < 0 or tax_rate_value > 100
      or quantity_value = 'NaN'::numeric or unit_price_value = 'NaN'::numeric
      or discount_value = 'NaN'::numeric or tax_value = 'NaN'::numeric then
      raise exception using errcode = 'invalid_parameter_value', message = format('sale line %s has invalid finite amounts', line_no);
    end if;
    if line_kind in ('product', 'service') then
      select item_kind into product_kind from erp.products
      where id = parsed_product_id and organization_id = actor_organization_id and is_active and can_sell;
      if product_kind is null or product_kind::text <> line_kind::text then
        raise exception using errcode = 'foreign_key_violation', message = format('sale line %s catalog kind mismatch', line_no);
      end if;
    end if;
    if discount_value > 0 and (
      not erp.has_permission('sales.discount', target_branch_id)
      or nullif(btrim(line->>'discount_reason'), '') is null
    ) then
      raise exception using errcode = 'insufficient_privilege', message = 'discount requires sales.discount and an explicit reason';
    end if;
    if discount_value > round(quantity_value * unit_price_value, 4) then
      raise exception using errcode = 'check_violation', message = 'discount cannot exceed line subtotal';
    end if;
    subtotal_value := subtotal_value + round(quantity_value * unit_price_value, 4);
    discount_total := discount_total + discount_value;
    tax_total := tax_total + tax_value;
  end loop;
  total_value := subtotal_value - discount_total + tax_total;
  if total_value <= 0 then raise exception using errcode = 'check_violation', message = 'sale total must be positive'; end if;
  for payment_line in select value from jsonb_array_elements(payment_lines) loop
    if jsonb_typeof(payment_line) <> 'object'
      or nullif(btrim(payment_line->>'payment_method_id'), '') is null
      or not erp.is_finite_numeric_text(payment_line->>'amount') or (payment_line->>'amount')::numeric <= 0 then
      raise exception using errcode = 'invalid_parameter_value', message = 'payment amounts must be finite and positive';
    end if;
    begin
      perform (payment_line->>'payment_method_id')::uuid;
      perform nullif(payment_line->>'cash_session_id', '')::uuid;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value', message = 'payment identifiers must be valid UUIDs';
    end;
    payment_total := payment_total + (payment_line->>'amount')::numeric;
  end loop;
  if payment_total > total_value then raise exception using errcode = 'check_violation', message = 'payments cannot exceed sale total'; end if;
  if payment_total < total_value and target_customer_id is null then
    raise exception using errcode = 'check_violation', message = 'partial sales require a customer receivable';
  end if;
  insert into erp.sales (
    organization_id, branch_id, customer_id, currency_code, exchange_snapshot_id,
    exchange_rate, idempotency_key, request_hash, reason, subtotal_amount,
    discount_amount, tax_amount, total_amount, confirmed_by
  ) values (
    actor_organization_id, target_branch_id, target_customer_id, upper(btrim(sale_currency)),
    target_exchange_snapshot_id, exchange_rate_value, operation_key, operation_hash,
    operation_reason, subtotal_value, discount_total, tax_total, total_value, auth.uid()
  ) returning id into sale_id;
  line_no := 0;
  for line in select value from jsonb_array_elements(lines) loop
    line_no := line_no + 1;
    line_kind := (line->>'kind')::erp.sale_line_kind;
    quantity_value := (line->>'quantity')::numeric;
    unit_price_value := (line->>'unit_price')::numeric;
    discount_value := coalesce(nullif(line->>'discount_amount', '')::numeric, 0);
    tax_rate_value := coalesce(nullif(line->>'tax_rate_percent', '')::numeric, 0);
    tax_value := coalesce(nullif(line->>'tax_amount', '')::numeric, 0);
    insert into erp.sale_lines (
      organization_id, sale_id, branch_id, line_number, kind, product_id, variant_id,
      inventory_unit_id, from_location_id, description, quantity, unit_price,
      discount_amount, tax_rate_percent, tax_amount, line_total
    ) values (
      actor_organization_id, sale_id, target_branch_id, line_no, line_kind,
      case when line_kind = 'free_concept' then null else (line->>'product_id')::uuid end,
      nullif(line->>'variant_id', '')::uuid, nullif(line->>'inventory_unit_id', '')::uuid,
      nullif(line->>'from_location_id', '')::uuid,
      coalesce(nullif(btrim(line->>'description'), ''), 'Concepto de venta'),
      quantity_value, unit_price_value, discount_value, tax_rate_value, tax_value,
      round(quantity_value * unit_price_value, 4) - discount_value + tax_value
    ) returning id into line_id;
    if discount_value > 0 then
      insert into erp.sale_discount_authorizations (
        organization_id, sale_id, sale_line_id, authorized_amount, reason, authorized_by
      ) values (
        actor_organization_id, sale_id, line_id, discount_value, btrim(line->>'discount_reason'), auth.uid()
      );
    end if;
    if line_kind = 'product' then
      stock_lines := stock_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'product_id', line->>'product_id', 'variant_id', nullif(line->>'variant_id', ''),
        'inventory_unit_id', nullif(line->>'inventory_unit_id', ''),
        'from_location_id', line->>'from_location_id', 'quantity', quantity_value
      )));
    end if;
  end loop;
  if jsonb_array_length(stock_lines) > 0 then
    if target_reservation_batch_id is null then
      posted_stock_document_id := erp.post_stock_document('sale', target_branch_id, operation_key || ':stock', operation_reason, stock_lines, false, 'sale', sale_id);
    else
      if not exists (
        select 1 from erp.stock_reservation_batches batch
        where batch.id = target_reservation_batch_id
          and batch.organization_id = actor_organization_id
          and batch.branch_id = target_branch_id and batch.status = 'active'
      ) or exists (
        with sale_multiset as (
          select
            (item->>'from_location_id')::uuid as location_id,
            (item->>'product_id')::uuid as product_id,
            nullif(item->>'variant_id','')::uuid as variant_id,
            nullif(item->>'inventory_unit_id','')::uuid as inventory_unit_id,
            sum((item->>'quantity')::numeric) as quantity
          from jsonb_array_elements(stock_lines) item
          group by 1, 2, 3, 4
        ), reservation_multiset as (
          select location_id, product_id, variant_id, inventory_unit_id, sum(quantity) as quantity
          from erp.stock_reservations
          where batch_id = target_reservation_batch_id
          group by 1, 2, 3, 4
        )
        select 1 from (
          (select * from sale_multiset except select * from reservation_multiset)
          union all
          (select * from reservation_multiset except select * from sale_multiset)
        ) mismatch
      ) then
        raise exception using errcode = 'check_violation', message = 'sale product lines do not match the active reservation';
      end if;
      posted_stock_document_id := erp.fulfill_stock_reservation(target_reservation_batch_id, operation_key || ':stock', operation_reason);
    end if;
    perform set_config('erp.allow_sale_stock_link', 'on', true);
    update erp.sales set stock_document_id = posted_stock_document_id where id = sale_id;
    perform set_config('erp.allow_sale_stock_link', 'off', true);
  end if;
  insert into erp.sale_state_events (organization_id, sale_id, branch_id, sale_state, idempotency_key, reason, actor_id)
  values (actor_organization_id, sale_id, target_branch_id, 'confirmed', operation_key || ':sale-state', operation_reason, auth.uid());
  insert into erp.sale_state_events (organization_id, sale_id, branch_id, delivery_state, idempotency_key, reason, actor_id)
  values (actor_organization_id, sale_id, target_branch_id, 'pending', operation_key || ':delivery-state', operation_reason, auth.uid());
  if target_customer_id is not null then
    insert into erp.customer_receivables (
      organization_id, branch_id, customer_id, sale_id, currency_code, original_amount, original_amount_base
    ) values (
      actor_organization_id, target_branch_id, target_customer_id, sale_id, upper(btrim(sale_currency)),
      total_value, round(total_value * exchange_rate_value, 4)
    ) returning id into receivable_id;
    insert into erp.customer_account_entries (
      organization_id, branch_id, customer_id, receivable_id, amount_base_delta, entry_kind, actor_id
    ) values (
      actor_organization_id, target_branch_id, target_customer_id, receivable_id,
      round(total_value * exchange_rate_value, 4), 'sale', auth.uid()
    );
  end if;
  if jsonb_array_length(payment_lines) = 0 then
    insert into erp.sale_state_events (organization_id, sale_id, branch_id, payment_state, idempotency_key, reason, actor_id)
    values (actor_organization_id, sale_id, target_branch_id, 'unpaid', operation_key || ':payment-state', operation_reason, auth.uid());
  else
    line_no := 0;
    for payment_line in select value from jsonb_array_elements(payment_lines) loop
      line_no := line_no + 1;
      perform erp.record_sale_payment_core(
        sale_id, (payment_line->>'payment_method_id')::uuid,
        nullif(payment_line->>'cash_session_id', '')::uuid,
        (payment_line->>'amount')::numeric, operation_key || ':payment:' || line_no,
        operation_reason, payment_line->>'provider_reference'
      );
    end loop;
  end if;
  return sale_id;
end;
$$;

create or replace function erp.record_sale_payment(
  target_sale_id uuid,
  target_payment_method_id uuid,
  target_cash_session_id uuid,
  payment_amount numeric,
  operation_key text,
  operation_reason text,
  provider_reference text default null
)
returns uuid
language sql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
  select erp.record_sale_payment_core(
    target_sale_id, target_payment_method_id, target_cash_session_id,
    payment_amount, operation_key, operation_reason, provider_reference
  );
$$;

create or replace function erp.reverse_sale_payment(
  target_payment_id uuid,
  operation_key text,
  operation_reason text,
  target_refund_cash_session_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  original erp.payments%rowtype;
  reversal_id uuid;
  original_cash erp.cash_movements%rowtype;
  receivable erp.customer_receivables%rowtype;
  operation_hash text;
  net_paid numeric(18,4);
  next_payment_state erp.sale_payment_state;
  target_sale_id uuid;
  refund_cash_session_id uuid;
begin
  select sale_id into target_sale_id from erp.payments
  where id = target_payment_id and organization_id = actor_organization_id;
  if target_sale_id is null then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'reversible payment not found';
  end if;
  perform 1 from erp.sales
  where id = target_sale_id and organization_id = actor_organization_id for update;
  select * into original from erp.payments
  where id = target_payment_id and organization_id = actor_organization_id for update;
  if original.id is null or original.reversal_of_payment_id is not null then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'reversible payment not found';
  end if;
  if not erp.has_permission('sales.cancel', original.branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'sales.cancel permission is required';
  end if;
  if nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'payment reversal operation data is required';
  end if;
  operation_hash := md5(jsonb_build_object(
    'payment_id', target_payment_id, 'reason', operation_reason,
    'refund_cash_session_id', target_refund_cash_session_id
  )::text);
  select id into reversal_id from erp.payments where reversal_of_payment_id = target_payment_id
    and idempotency_key = operation_key and request_hash = operation_hash;
  if reversal_id is not null then return reversal_id; end if;
  select * into original_cash from erp.cash_movements where payment_id = original.id;
  if original_cash.id is not null then
    refund_cash_session_id := original_cash.cash_session_id;
    if exists (select 1 from erp.cash_closures where cash_session_id = refund_cash_session_id) then
      refund_cash_session_id := target_refund_cash_session_id;
      if refund_cash_session_id is null then
        raise exception using errcode = 'object_not_in_prerequisite_state', message = 'an open refund cash session is required after the original session closes';
      end if;
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
      actor_organization_id::text || ':cash-session:' || refund_cash_session_id::text, 0
    ));
    if exists (select 1 from erp.cash_closures where cash_session_id = refund_cash_session_id)
      or not exists (
        select 1
        from erp.cash_sessions session
        join erp.cash_session_opening_counts opening
          on opening.cash_session_id = session.id
         and opening.organization_id = session.organization_id
         and opening.branch_id = session.branch_id
        where session.id = refund_cash_session_id
          and session.organization_id = actor_organization_id
          and session.branch_id = original.branch_id
          and opening.currency_code = original.currency_code
      ) then
      raise exception using errcode = 'object_not_in_prerequisite_state', message = 'open same-branch refund session with the payment currency is required';
    end if;
  end if;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.payments (
    organization_id, branch_id, sale_id, payment_method_id, cash_session_id,
    currency_code, amount, amount_base, reversal_of_payment_id,
    idempotency_key, request_hash, reason, actor_id
  ) values (
    original.organization_id, original.branch_id, original.sale_id, original.payment_method_id,
    refund_cash_session_id, original.currency_code, -original.amount, -original.amount_base,
    original.id, operation_key, operation_hash, operation_reason, auth.uid()
  ) returning id into reversal_id;
  if original_cash.id is not null then
    insert into erp.cash_movements (
      organization_id, branch_id, cash_session_id, kind, currency_code, amount,
      payment_id, reversal_of_movement_id, idempotency_key, request_hash, reason, actor_id
    ) values (
      original_cash.organization_id, original_cash.branch_id, refund_cash_session_id,
      'refund', original_cash.currency_code, -original_cash.amount, reversal_id, original_cash.id,
      operation_key || ':cash', operation_hash, operation_reason, auth.uid()
    );
  end if;
  select * into receivable from erp.customer_receivables where sale_id = original.sale_id;
  if receivable.id is not null then
    insert into erp.customer_account_entries (
      organization_id, branch_id, customer_id, receivable_id, payment_id,
      amount_base_delta, entry_kind, actor_id
    ) values (
      original.organization_id, original.branch_id, receivable.customer_id, receivable.id,
      reversal_id, original.amount_base, 'payment_reversal', auth.uid()
    );
  end if;
  select coalesce(sum(amount), 0) into net_paid from erp.payments
  where sale_id = original.sale_id and organization_id = actor_organization_id;
  next_payment_state := case when net_paid = 0 then 'refunded'::erp.sale_payment_state else 'partial'::erp.sale_payment_state end;
  if next_payment_state is distinct from (
    select event.payment_state from erp.sale_state_events event
    where event.sale_id = original.sale_id and event.payment_state is not null
    order by event.event_sequence desc limit 1
  ) then
    insert into erp.sale_state_events (
      organization_id, sale_id, branch_id, payment_state, idempotency_key, reason, actor_id
    ) values (
      actor_organization_id, original.sale_id, original.branch_id, next_payment_state,
      operation_key || ':state', operation_reason, auth.uid()
    );
  end if;
  return reversal_id;
end;
$$;

create or replace function erp.cancel_sale(
  target_sale_id uuid,
  operation_key text,
  operation_reason text,
  target_refund_cash_session_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  sale_row erp.sales%rowtype;
  payment_row record;
  receivable erp.customer_receivables%rowtype;
  reversal_document_id uuid;
begin
  select * into sale_row from erp.sales where id = target_sale_id and organization_id = actor_organization_id for update;
  if sale_row.id is null or not erp.has_permission('sales.cancel', sale_row.branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'sales.cancel permission is required';
  end if;
  if exists (select 1 from erp.sale_state_events where sale_id = target_sale_id and sale_state = 'cancelled') then
    return (select id from erp.sale_state_events where sale_id = target_sale_id and sale_state = 'cancelled');
  end if;
  perform set_config('erp.operation_reason', operation_reason, true);
  if sale_row.stock_document_id is not null then
    reversal_document_id := erp.reverse_stock_document(sale_row.stock_document_id, operation_key || ':stock', operation_reason);
  end if;
  for payment_row in select id from erp.payments where sale_id = target_sale_id and reversal_of_payment_id is null order by occurred_at, id loop
    if not exists (select 1 from erp.payments where reversal_of_payment_id = payment_row.id) then
      perform erp.reverse_sale_payment(
        payment_row.id, operation_key || ':payment:' || payment_row.id,
        operation_reason, target_refund_cash_session_id
      );
    end if;
  end loop;
  select * into receivable from erp.customer_receivables where sale_id = target_sale_id;
  if receivable.id is not null then
    insert into erp.customer_account_entries (
      organization_id, branch_id, customer_id, receivable_id, amount_base_delta, entry_kind, actor_id
    ) values (
      actor_organization_id, sale_row.branch_id, receivable.customer_id, receivable.id,
      -receivable.original_amount_base, 'sale_cancellation', auth.uid()
    );
  end if;
  insert into erp.sale_state_events (organization_id, sale_id, branch_id, sale_state, idempotency_key, reason, actor_id)
  values (actor_organization_id, target_sale_id, sale_row.branch_id, 'cancelled', operation_key, operation_reason, auth.uid());
  insert into erp.sale_state_events (organization_id, sale_id, branch_id, payment_state, idempotency_key, reason, actor_id)
  select actor_organization_id, target_sale_id, sale_row.branch_id, 'refunded', operation_key || ':payment-state', operation_reason, auth.uid()
  where 'refunded'::erp.sale_payment_state is distinct from (
    select event.payment_state from erp.sale_state_events event
    where event.sale_id = target_sale_id and event.payment_state is not null
    order by event.event_sequence desc limit 1
  );
  return (select id from erp.sale_state_events where sale_id = target_sale_id and sale_state = 'cancelled');
end;
$$;

create or replace function erp.create_web_order(
  target_branch_id uuid,
  target_customer_id uuid,
  order_currency text,
  target_exchange_snapshot_id uuid,
  operation_key text,
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
  order_id uuid;
  reservation_id uuid;
  exchange_rate_value numeric(24,10);
  operation_hash text;
  line jsonb;
  line_no integer := 0;
  quantity_value numeric(18,4);
  unit_price_value numeric(18,4);
  tax_rate_value numeric(7,4);
  tax_value numeric(18,4);
  total_value numeric(18,4) := 0;
  reservation_lines jsonb := '[]'::jsonb;
  effective_expiration timestamptz := expiration_time;
  reservation_minutes integer;
  parsed_product_id uuid;
  parsed_variant_id uuid;
  parsed_inventory_unit_id uuid;
  parsed_location_id uuid;
begin
  if actor_organization_id is null or not erp.has_permission('orders.manage', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'orders.manage permission is required';
  end if;
  if effective_expiration is null then
    select (configuration.value #>> '{}')::integer into reservation_minutes
    from erp.configuration_values configuration
    where configuration.organization_id = actor_organization_id
      and configuration.branch_id is null
      and configuration.key = 'orders.reservation_minutes';
    if reservation_minutes is null or reservation_minutes not between 1 and 10080 then
      raise exception using errcode = 'object_not_in_prerequisite_state', message = 'valid orders.reservation_minutes configuration is required';
    end if;
    effective_expiration := now() + reservation_minutes * interval '1 minute';
  end if;
  if effective_expiration <= now() or lines is null or jsonb_typeof(lines) <> 'array'
    or jsonb_array_length(lines) = 0 or jsonb_array_length(lines) > 250
    or pg_column_size(lines) > 1048576
    or nullif(btrim(operation_key), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'future expiration and order lines are required';
  end if;
  select rate_to_base into exchange_rate_value from erp.exchange_rate_snapshots
  where id = target_exchange_snapshot_id and organization_id = actor_organization_id
    and quote_currency = upper(btrim(order_currency));
  if exchange_rate_value is null then raise exception using errcode = 'foreign_key_violation', message = 'matching exchange-rate snapshot is required'; end if;
  if target_customer_id is not null and not exists (
    select 1 from erp.customers
    where id = target_customer_id and organization_id = actor_organization_id and is_active
  ) then raise exception using errcode = 'foreign_key_violation', message = 'active customer not found'; end if;
  operation_hash := md5(jsonb_build_object('branch_id', target_branch_id, 'customer_id', target_customer_id, 'currency', upper(btrim(order_currency)), 'snapshot_id', target_exchange_snapshot_id, 'expires_at', expiration_time, 'lines', lines)::text);
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':' || target_branch_id::text, 0));
  select id into order_id from erp.web_orders where organization_id = actor_organization_id
    and branch_id = target_branch_id and idempotency_key = operation_key and request_hash = operation_hash;
  if order_id is not null then return order_id; end if;
  for line in select value from jsonb_array_elements(lines) loop
    if jsonb_typeof(line) <> 'object'
      or nullif(btrim(line->>'product_id'), '') is null
      or nullif(btrim(line->>'location_id'), '') is null
      or not erp.is_finite_numeric_text(line->>'quantity') or not erp.is_finite_numeric_text(line->>'unit_price')
      or not erp.is_finite_numeric_text(coalesce(line->>'tax_rate_percent', '0'))
      or not erp.is_finite_numeric_text(coalesce(line->>'tax_amount', '0')) then
      raise exception using errcode = 'invalid_parameter_value', message = 'web order amounts must be finite';
    end if;
    begin
      quantity_value := (line->>'quantity')::numeric;
      unit_price_value := (line->>'unit_price')::numeric;
      tax_rate_value := coalesce(nullif(line->>'tax_rate_percent', '')::numeric, 0);
      tax_value := coalesce(nullif(line->>'tax_amount', '')::numeric, 0);
      parsed_product_id := (line->>'product_id')::uuid;
      parsed_variant_id := nullif(line->>'variant_id', '')::uuid;
      parsed_inventory_unit_id := nullif(line->>'inventory_unit_id', '')::uuid;
      parsed_location_id := (line->>'location_id')::uuid;
    exception when others then
      raise exception using errcode = 'invalid_parameter_value', message = 'web order line identifiers and amounts are invalid';
    end;
    if quantity_value <= 0 or unit_price_value < 0 or tax_value < 0
      or tax_rate_value < 0 or tax_rate_value > 100 then
      raise exception using errcode = 'invalid_parameter_value', message = 'web order amounts are invalid';
    end if;
    if not exists (
      select 1 from erp.products product
      where product.id = parsed_product_id and product.organization_id = actor_organization_id
        and product.item_kind = 'product' and product.is_active and product.can_sell
        and product.publish_on_web and product.allow_online_sale
    ) then raise exception using errcode = 'foreign_key_violation', message = 'active web product not found'; end if;
    total_value := total_value + round(quantity_value * unit_price_value, 4) + tax_value;
    reservation_lines := reservation_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'location_id', line->>'location_id', 'product_id', line->>'product_id',
      'variant_id', nullif(line->>'variant_id', ''), 'inventory_unit_id', nullif(line->>'inventory_unit_id', ''),
      'quantity', quantity_value
    )));
  end loop;
  if total_value <= 0 then
    raise exception using errcode = 'check_violation', message = 'web order total must be positive';
  end if;
  perform set_config('erp.operation_reason', 'Create web order', true);
  insert into erp.web_orders (
    organization_id, branch_id, customer_id, currency_code, exchange_snapshot_id,
    exchange_rate, idempotency_key, request_hash, total_amount, expires_at, created_by
  ) values (
    actor_organization_id, target_branch_id, target_customer_id, upper(btrim(order_currency)),
    target_exchange_snapshot_id, exchange_rate_value, operation_key, operation_hash,
    total_value, effective_expiration, auth.uid()
  ) returning id into order_id;
  line_no := 0;
  for line in select value from jsonb_array_elements(lines) loop
    line_no := line_no + 1;
    quantity_value := (line->>'quantity')::numeric;
    unit_price_value := (line->>'unit_price')::numeric;
    tax_value := coalesce(nullif(line->>'tax_amount', '')::numeric, 0);
    insert into erp.web_order_lines (
      organization_id, web_order_id, branch_id, line_number, product_id, variant_id,
      inventory_unit_id, location_id, description, quantity, unit_price,
      tax_rate_percent, tax_amount, line_total
    ) values (
      actor_organization_id, order_id, target_branch_id, line_no, (line->>'product_id')::uuid,
      nullif(line->>'variant_id', '')::uuid, nullif(line->>'inventory_unit_id', '')::uuid,
      (line->>'location_id')::uuid, coalesce(nullif(btrim(line->>'description'), ''), 'Producto web'),
      quantity_value, unit_price_value, coalesce(nullif(line->>'tax_rate_percent', '')::numeric, 0),
      tax_value, round(quantity_value * unit_price_value, 4) + tax_value
    );
  end loop;
  reservation_id := erp.create_stock_reservation(
    target_branch_id, operation_key || ':reservation', 'online_order', order_id,
    effective_expiration, reservation_lines
  );
  perform set_config('erp.allow_web_reservation_link', 'on', true);
  update erp.web_orders set reservation_batch_id = reservation_id where id = order_id;
  perform set_config('erp.allow_web_reservation_link', 'off', true);
  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, order_state, idempotency_key, request_hash, reason, actor_id
  ) values (
    actor_organization_id, target_branch_id, order_id, 'placed', operation_key || ':state',
    md5(jsonb_build_object('web_order_id', order_id, 'state', 'placed')::text), 'Web order placed', auth.uid()
  );
  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, payment_state, idempotency_key, request_hash, reason, actor_id
  ) values (
    actor_organization_id, target_branch_id, order_id, 'unpaid', operation_key || ':payment-state',
    md5(jsonb_build_object('web_order_id', order_id, 'payment', 'unpaid')::text), 'Awaiting payment', auth.uid()
  );
  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, delivery_state, idempotency_key, request_hash, reason, actor_id
  ) values (
    actor_organization_id, target_branch_id, order_id, 'pending', operation_key || ':delivery-state',
    md5(jsonb_build_object('web_order_id', order_id, 'delivery', 'pending')::text), 'Awaiting preparation', auth.uid()
  );
  insert into erp.integration_outbox (organization_id, branch_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
  values (actor_organization_id, target_branch_id, 'web_order', order_id, 'web_order.placed', jsonb_build_object('web_order_id', order_id), operation_key || ':outbox');
  return order_id;
end;
$$;

create or replace function erp.record_web_payment_event(
  target_web_order_id uuid,
  provider_name text,
  provider_event_key text,
  provider_payment_key text,
  event_status erp.web_payment_status,
  target_payment_method_id uuid,
  event_amount numeric,
  provider_event_time timestamptz,
  event_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  order_row erp.web_orders%rowtype;
  event_id uuid;
  latest_time timestamptz;
  latest_rank integer;
  latest_amount numeric(18,4);
  event_rank integer;
  should_apply boolean;
  transition_error text;
  current_order_state text;
  normalized_provider text := nullif(btrim(provider_name), '');
  normalized_payment_id text := nullif(btrim(provider_payment_key), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = 'insufficient_privilege', message = 'service_role is required for provider event ingestion';
  end if;
  select * into order_row from erp.web_orders where id = target_web_order_id for update;
  if order_row.id is null then
    raise exception using errcode = 'no_data_found', message = 'web order not found';
  end if;
  if normalized_provider is null or nullif(btrim(provider_event_key), '') is null
    or event_status is null or provider_event_time is null
    or event_payload is null or jsonb_typeof(event_payload) <> 'object'
    or pg_column_size(event_payload) > 1048576
    or (event_amount is not null and (event_amount = 'NaN'::numeric or event_amount < 0))
    or (event_status in ('approved', 'refunded') and normalized_payment_id is null)
    or (event_status = 'approved' and (event_amount is null or event_amount = 'NaN'::numeric or event_amount <= 0 or target_payment_method_id is null)) then
    raise exception using errcode = 'invalid_parameter_value', message = 'complete finite provider event data is required';
  end if;
  if event_status = 'approved' and event_amount > order_row.total_amount then
    raise exception using errcode = 'check_violation', message = 'approved provider amount exceeds web order total';
  end if;
  if target_payment_method_id is not null and not exists (
    select 1 from erp.payment_methods method
    where method.id = target_payment_method_id
      and method.organization_id = order_row.organization_id and method.is_active
  ) then
    raise exception using errcode = 'foreign_key_violation', message = 'active payment method not found';
  end if;
  if normalized_payment_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      order_row.organization_id::text || ':provider-payment:' || normalized_provider || ':' || normalized_payment_id, 0
    ));
    insert into erp.web_provider_payments (
      organization_id, provider, provider_payment_id, web_order_id, branch_id
    ) values (
      order_row.organization_id, normalized_provider, normalized_payment_id,
      target_web_order_id, order_row.branch_id
    ) on conflict (organization_id, provider, provider_payment_id) do nothing;
    if not exists (
      select 1 from erp.web_provider_payments ownership
      where ownership.organization_id = order_row.organization_id
        and ownership.provider = normalized_provider
        and ownership.provider_payment_id = normalized_payment_id
        and ownership.web_order_id = target_web_order_id
    ) then
      raise exception using errcode = 'integrity_constraint_violation', message = 'provider payment is already owned by another web order';
    end if;
  end if;
  select event.id into event_id from erp.web_payment_events event
  where event.organization_id = order_row.organization_id and event.provider = normalized_provider
    and event.provider_event_id = btrim(provider_event_key);
  if event_id is not null then
    if exists (
      select 1 from erp.web_payment_events event
      where event.id = event_id and event.web_order_id = target_web_order_id
        and event.status = event_status
        and event.provider_payment_id is not distinct from nullif(btrim(provider_payment_key), '')
        and event.payment_method_id is not distinct from target_payment_method_id
        and event.amount is not distinct from event_amount
        and event.provider_occurred_at = provider_event_time
        and event.payload = event_payload
    ) then return event_id; end if;
    raise exception using errcode = 'integrity_constraint_violation', message = 'provider event key is already used by another payload';
  end if;
  event_rank := case event_status when 'pending' then 1 when 'rejected' then 2 when 'cancelled' then 3 when 'approved' then 4 when 'refunded' then 5 end;
  select payment_event.provider_occurred_at, payment_event.amount,
    case payment_event.status when 'pending' then 1 when 'rejected' then 2 when 'cancelled' then 3 when 'approved' then 4 when 'refunded' then 5 end
  into latest_time, latest_amount, latest_rank
  from erp.web_order_events order_event
  join erp.web_payment_events payment_event on payment_event.id = order_event.source_payment_event_id
  where order_event.web_order_id = target_web_order_id
    and order_event.organization_id = order_row.organization_id
  order by order_event.event_sequence desc limit 1;
  select event.order_state into current_order_state
  from erp.web_order_events event
  where event.web_order_id = target_web_order_id and event.order_state is not null
  order by event.event_sequence desc limit 1;
  should_apply := latest_rank is null
    or (provider_event_time >= latest_time and event_rank > latest_rank)
    or (
      event_rank = latest_rank and event_status = 'approved'
      and provider_event_time > latest_time and event_amount is distinct from latest_amount
    );
  if current_order_state in ('cancelled', 'refunded') and event_status not in ('cancelled', 'refunded') then
    should_apply := false;
    transition_error := 'Ignored because the web order is terminal';
  elsif current_order_state = 'fulfilled' and event_status = 'refunded' then
    should_apply := false;
    transition_error := 'Refund recorded but unapplied: fulfilled orders require an atomic refund command';
  elsif current_order_state = 'fulfilled' and event_status = 'cancelled' then
    should_apply := false;
    transition_error := 'Cancellation recorded but unapplied: fulfilled orders cannot release consumed stock';
  elsif current_order_state = 'fulfilled' then
    should_apply := false;
    transition_error := 'Ignored because the fulfilled web order is terminal';
  elsif not should_apply then
    transition_error := 'Ignored as an out-of-order business transition';
  end if;
  perform set_config('erp.operation_reason', 'Record web payment event', true);
  insert into erp.web_payment_events (
    organization_id, branch_id, web_order_id, provider, provider_event_id,
    provider_payment_id, status, payment_method_id, amount,
    provider_occurred_at, payload, applied, error_message, actor_id
  ) values (
    order_row.organization_id, order_row.branch_id, target_web_order_id, normalized_provider,
    btrim(provider_event_key), normalized_payment_id, event_status,
    target_payment_method_id, event_amount, provider_event_time, event_payload, should_apply,
    transition_error, auth.uid()
  ) returning id into event_id;
  if should_apply then
    if event_status in ('cancelled', 'refunded') then
      perform erp.release_web_order_reservation_core(
        order_row.organization_id, target_web_order_id, order_row.reservation_batch_id,
        'Provider payment status ' || event_status::text
      );
    end if;
    insert into erp.web_order_events (
      organization_id, branch_id, web_order_id, payment_state, source_payment_event_id,
      idempotency_key, request_hash, reason, occurred_at, actor_id
    ) values (
      order_row.organization_id, order_row.branch_id, target_web_order_id,
      case event_status when 'approved' then
          case when event_amount = order_row.total_amount then 'paid'::erp.sale_payment_state else 'partial'::erp.sale_payment_state end
        when 'refunded' then 'refunded'::erp.sale_payment_state else 'unpaid'::erp.sale_payment_state end,
      event_id, 'web-payment:' || md5(jsonb_build_array(
        normalized_provider, btrim(provider_event_key), 'payment'
      )::text),
      md5(jsonb_build_object('provider', normalized_provider, 'event_id', provider_event_key, 'axis', 'payment')::text),
      'Provider payment status ' || event_status::text, provider_event_time, auth.uid()
    );
    if event_status in ('cancelled', 'refunded') then
      insert into erp.web_order_events (
        organization_id, branch_id, web_order_id, order_state, source_payment_event_id,
        idempotency_key, request_hash, reason, occurred_at, actor_id
      ) values (
        order_row.organization_id, order_row.branch_id, target_web_order_id,
        case when event_status = 'refunded' then 'refunded' else 'cancelled' end,
        event_id, 'web-payment:' || md5(jsonb_build_array(
          normalized_provider, btrim(provider_event_key), 'order'
        )::text),
        md5(jsonb_build_object('provider', normalized_provider, 'event_id', provider_event_key, 'axis', 'order')::text),
        'Provider payment status ' || event_status::text, provider_event_time, auth.uid()
      );
    end if;
    insert into erp.integration_outbox (
      organization_id, branch_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key
    ) values (
      order_row.organization_id, order_row.branch_id, 'web_order', target_web_order_id,
      'web_payment.' || event_status::text, jsonb_build_object('web_order_id', target_web_order_id, 'event_id', event_id),
      'web-payment:' || md5(jsonb_build_array(
        normalized_provider, btrim(provider_event_key), 'outbox'
      )::text)
    );
  end if;
  return event_id;
end;
$$;

create or replace function erp.record_web_order_event(
  target_web_order_id uuid,
  target_order_state text,
  target_delivery_state erp.sale_delivery_state,
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
  event_id uuid;
  operation_hash text;
  existing_hash text;
  existing_order_id uuid;
  current_order_state text;
  current_delivery_state erp.sale_delivery_state;
  reservation_id uuid;
begin
  select branch_id, reservation_batch_id into target_branch_id, reservation_id
  from erp.web_orders
  where id = target_web_order_id and organization_id = actor_organization_id
  for update;
  if target_branch_id is null or not erp.has_permission('orders.manage', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'orders.manage permission is required';
  end if;
  if num_nonnulls(target_order_state, target_delivery_state) <> 1
    or nullif(btrim(operation_key), '') is null or nullif(btrim(operation_reason), '') is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'exactly one state axis and operation data are required';
  end if;
  if target_order_state is not null and target_order_state not in ('confirmed', 'cancelled') then
    raise exception using errcode = 'invalid_parameter_value', message = 'unsupported manual order state';
  end if;
  operation_hash := md5(jsonb_build_object(
    'web_order_id', target_web_order_id, 'order_state', target_order_state,
    'delivery_state', target_delivery_state, 'reason', operation_reason
  )::text);
  select event.id, event.request_hash, event.web_order_id
  into event_id, existing_hash, existing_order_id
  from erp.web_order_events event
  where event.organization_id = actor_organization_id
    and event.branch_id = target_branch_id and event.idempotency_key = operation_key;
  if event_id is not null then
    if existing_order_id = target_web_order_id and existing_hash = operation_hash then return event_id; end if;
    raise exception using errcode = 'integrity_constraint_violation', message = 'web order event idempotency key is already used by another request';
  end if;
  select event.order_state into current_order_state
  from erp.web_order_events event
  where event.web_order_id = target_web_order_id and event.order_state is not null
  order by event.event_sequence desc limit 1;
  select event.delivery_state into current_delivery_state
  from erp.web_order_events event
  where event.web_order_id = target_web_order_id and event.delivery_state is not null
  order by event.event_sequence desc limit 1;
  if target_order_state = 'confirmed' and current_order_state <> 'placed' then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'illegal web order state transition';
  elsif target_order_state = 'cancelled' and current_order_state not in ('placed', 'confirmed') then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'illegal web order state transition';
  elsif target_delivery_state is not null and current_order_state in ('cancelled', 'refunded', 'fulfilled') then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'terminal web order cannot change delivery state';
  elsif target_delivery_state is not null and not (
    (current_delivery_state = 'pending' and target_delivery_state = 'preparing')
    or (current_delivery_state = 'preparing' and target_delivery_state = 'ready')
    or (current_delivery_state = 'ready' and target_delivery_state = 'dispatched')
    or (current_delivery_state = 'dispatched' and target_delivery_state = 'delivered')
    or (current_delivery_state = 'delivered' and target_delivery_state = 'returned')
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'illegal web delivery state transition';
  end if;
  if target_order_state = 'cancelled' then
    perform erp.release_stock_reservation(reservation_id, operation_reason);
  end if;
  perform set_config('erp.operation_reason', operation_reason, true);
  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, order_state, delivery_state,
    idempotency_key, request_hash, reason, actor_id
  ) values (
    actor_organization_id, target_branch_id, target_web_order_id, target_order_state,
    target_delivery_state, operation_key, operation_hash, operation_reason, auth.uid()
  )
  returning id into event_id;
  return event_id;
end;
$$;

create or replace function erp.fulfill_web_order(
  target_web_order_id uuid,
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
  order_row erp.web_orders%rowtype;
  approved_event erp.web_payment_events%rowtype;
  sale_id uuid;
  sale_lines jsonb;
  payment_lines jsonb;
  fulfilled_stock_document_id uuid;
  current_order_state text;
  current_payment_state erp.sale_payment_state;
  current_delivery_state erp.sale_delivery_state;
begin
  select * into order_row from erp.web_orders where id = target_web_order_id and organization_id = actor_organization_id for update;
  if order_row.id is null or not erp.has_permission('orders.manage', order_row.branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'orders.manage permission is required';
  end if;
  select fulfillment.sale_id into sale_id from erp.web_order_fulfillments fulfillment
  where fulfillment.web_order_id = target_web_order_id and fulfillment.organization_id = actor_organization_id;
  if sale_id is not null then return sale_id; end if;
  select event.order_state into current_order_state from erp.web_order_events event
  where event.web_order_id = target_web_order_id and event.order_state is not null
  order by event.event_sequence desc limit 1;
  select event.payment_state into current_payment_state from erp.web_order_events event
  where event.web_order_id = target_web_order_id and event.payment_state is not null
  order by event.event_sequence desc limit 1;
  select event.delivery_state into current_delivery_state from erp.web_order_events event
  where event.web_order_id = target_web_order_id and event.delivery_state is not null
  order by event.event_sequence desc limit 1;
  if current_order_state not in ('placed', 'confirmed') then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'web order is not eligible for fulfillment';
  end if;
  if current_delivery_state not in ('preparing', 'ready') then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'web order delivery state is not eligible for fulfillment';
  end if;
  select payment_event.* into approved_event
  from erp.web_order_events order_event
  join erp.web_payment_events payment_event on payment_event.id = order_event.source_payment_event_id
  where order_event.web_order_id = target_web_order_id and order_event.payment_state is not null
  order by order_event.event_sequence desc limit 1;
  if current_payment_state <> 'paid' or approved_event.status <> 'approved' or approved_event.amount <> order_row.total_amount then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'fully approved web payment is required';
  end if;
  if not exists (
    select 1 from erp.stock_reservation_batches batch
    where batch.id = order_row.reservation_batch_id
      and batch.organization_id = actor_organization_id
      and batch.branch_id = order_row.branch_id
      and batch.source_type = 'online_order'
      and batch.source_id = target_web_order_id
      and batch.status = 'active'
  ) then
    raise exception using errcode = 'object_not_in_prerequisite_state', message = 'matching active web order reservation is required';
  end if;
  select jsonb_agg(jsonb_build_object(
    'kind', 'product', 'product_id', line.product_id, 'variant_id', line.variant_id,
    'inventory_unit_id', line.inventory_unit_id, 'from_location_id', line.location_id,
    'description', line.description, 'quantity', line.quantity, 'unit_price', line.unit_price,
    'discount_amount', 0, 'tax_rate_percent', line.tax_rate_percent, 'tax_amount', line.tax_amount
  ) order by line.line_number) into sale_lines
  from erp.web_order_lines line where line.web_order_id = target_web_order_id;
  payment_lines := jsonb_build_array(jsonb_build_object(
    'payment_method_id', approved_event.payment_method_id, 'amount', approved_event.amount,
    'provider_reference', approved_event.provider_payment_id
  ));
  sale_id := erp.create_sale(
    order_row.branch_id, order_row.customer_id, order_row.currency_code,
    order_row.exchange_snapshot_id, operation_key || ':sale', operation_reason,
    sale_lines, payment_lines, order_row.reservation_batch_id
  );
  select sale.stock_document_id into fulfilled_stock_document_id
  from erp.sales sale where sale.id = sale_id;
  insert into erp.web_order_fulfillments (
    organization_id, branch_id, web_order_id, sale_id, reservation_batch_id,
    stock_document_id, fulfilled_by
  ) values (
    actor_organization_id, order_row.branch_id, target_web_order_id, sale_id,
    order_row.reservation_batch_id, fulfilled_stock_document_id, auth.uid()
  );
  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, order_state, idempotency_key, request_hash, reason, actor_id
  ) values (
    actor_organization_id, order_row.branch_id, target_web_order_id, 'fulfilled', operation_key || ':state',
    md5(jsonb_build_object('web_order_id', target_web_order_id, 'state', 'fulfilled', 'reason', operation_reason)::text),
    operation_reason, auth.uid()
  );
  insert into erp.web_order_events (
    organization_id, branch_id, web_order_id, delivery_state, idempotency_key, request_hash, reason, actor_id
  ) values (
    actor_organization_id, order_row.branch_id, target_web_order_id, 'dispatched', operation_key || ':delivery',
    md5(jsonb_build_object('web_order_id', target_web_order_id, 'delivery', 'dispatched', 'reason', operation_reason)::text),
    operation_reason, auth.uid()
  );
  insert into erp.integration_outbox (organization_id, branch_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key)
  values (actor_organization_id, order_row.branch_id, 'web_order', target_web_order_id, 'web_order.fulfilled', jsonb_build_object('web_order_id', target_web_order_id, 'sale_id', sale_id), operation_key || ':outbox');
  return sale_id;
end;
$$;

create or replace function erp.record_integration_attempt(
  target_outbox_id uuid,
  attempt_status erp.integration_attempt_status,
  attempt_error text default null
)
returns uuid
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_organization_id uuid := erp.current_organization_id();
  target_branch_id uuid;
  attempt_id uuid;
  next_attempt integer;
begin
  select branch_id into target_branch_id from erp.integration_outbox
  where id = target_outbox_id and organization_id = actor_organization_id;
  if target_branch_id is null or not erp.has_permission('integrations.retry', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'integrations.retry permission is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor_organization_id::text || ':outbox:' || target_outbox_id::text, 0));
  select coalesce(max(attempt_number), 0) + 1 into next_attempt from erp.integration_attempts where outbox_id = target_outbox_id;
  insert into erp.integration_attempts (
    organization_id, outbox_id, attempt_number, status, error_message, attempted_by
  ) values (
    actor_organization_id, target_outbox_id, next_attempt, attempt_status,
    nullif(btrim(attempt_error), ''), auth.uid()
  ) returning id into attempt_id;
  return attempt_id;
end;
$$;

create or replace function erp.protect_sale_header()
returns trigger
language plpgsql
security definer
set search_path = erp, pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
    and current_setting('erp.allow_sale_stock_link', true) = 'on'
    and old.stock_document_id is null and new.stock_document_id is not null
    and (to_jsonb(new) - 'stock_document_id') = (to_jsonb(old) - 'stock_document_id')
    and exists (
      select 1 from erp.stock_documents document
      where document.id = new.stock_document_id and document.organization_id = new.organization_id
        and document.branch_id = new.branch_id
        and (
          (document.kind = 'sale' and document.source_type = 'sale' and document.source_id = new.id)
          or (document.kind = 'reservation_fulfillment' and document.source_type = 'stock_reservation')
        )
    ) then return new;
  end if;
  raise exception using errcode = 'integrity_constraint_violation', message = 'erp.sales facts are append-only';
end;
$$;

create or replace function erp.protect_web_order_header()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
    and current_setting('erp.allow_web_reservation_link', true) = 'on'
    and old.reservation_batch_id is null and new.reservation_batch_id is not null
    and (to_jsonb(new) - 'reservation_batch_id') = (to_jsonb(old) - 'reservation_batch_id')
    and exists (
      select 1 from erp.stock_reservation_batches batch
      where batch.id = new.reservation_batch_id
        and batch.organization_id = new.organization_id
        and batch.branch_id = new.branch_id
        and batch.source_type = 'online_order'
        and batch.source_id = new.id
    ) then
    return new;
  end if;
  raise exception using errcode = 'integrity_constraint_violation', message = 'erp.web_orders facts are append-only';
end;
$$;

create or replace function erp.validate_web_order_fulfillment()
returns trigger
language plpgsql
set search_path = erp, pg_catalog
as $$
begin
  if not exists (
    select 1
    from erp.web_orders orders
    join erp.stock_reservation_batches batch
      on batch.id = orders.reservation_batch_id
     and batch.organization_id = orders.organization_id
     and batch.branch_id = orders.branch_id
    join erp.sales sale
      on sale.id = new.sale_id
     and sale.organization_id = orders.organization_id
     and sale.branch_id = orders.branch_id
    join erp.stock_documents document
      on document.id = sale.stock_document_id
     and document.organization_id = sale.organization_id
     and document.branch_id = sale.branch_id
    where orders.id = new.web_order_id
      and orders.organization_id = new.organization_id
      and orders.branch_id = new.branch_id
      and orders.reservation_batch_id = new.reservation_batch_id
      and sale.stock_document_id = new.stock_document_id
      and batch.source_type = 'online_order'
      and batch.source_id = orders.id
      and document.kind = 'reservation_fulfillment'
      and document.source_type = 'stock_reservation'
      and document.source_id = batch.id
  ) then
    raise exception using errcode = 'check_violation', message = 'web fulfillment links must describe one order, reservation, sale and stock document';
  end if;
  return new;
end;
$$;

create trigger sales_immutable before update or delete on erp.sales
for each row execute function erp.protect_sale_header();
create trigger web_orders_immutable before update or delete on erp.web_orders
for each row execute function erp.protect_web_order_header();
create trigger web_order_fulfillments_validate before insert on erp.web_order_fulfillments
for each row execute function erp.validate_web_order_fulfillment();

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'cash_registers', 'cash_sessions', 'cash_session_opening_counts', 'cash_movements',
    'cash_closures', 'cash_close_counts', 'sale_lines', 'sale_discount_authorizations',
    'sale_state_events', 'payments', 'customer_receivables', 'customer_account_entries',
    'web_order_lines', 'web_payment_events', 'web_provider_payments', 'web_order_events', 'web_order_fulfillments',
    'integration_outbox', 'integration_attempts'
  ] loop
    execute format('create trigger %I_immutable before update or delete on erp.%I for each row execute function erp.prevent_fact_mutation()', table_name, table_name);
  end loop;
  foreach table_name in array array[
    'cash_registers', 'cash_sessions', 'cash_session_opening_counts', 'cash_movements',
    'cash_closures', 'cash_close_counts', 'sales', 'sale_lines', 'sale_discount_authorizations',
    'sale_state_events', 'payments', 'customer_receivables', 'customer_account_entries',
    'web_orders', 'web_order_lines', 'web_payment_events', 'web_provider_payments', 'web_order_events',
    'web_order_fulfillments', 'integration_outbox', 'integration_attempts'
  ] loop
    execute format('create trigger %I_audit after insert on erp.%I for each row execute function erp.audit_operational_fact()', table_name, table_name);
    execute format('alter table erp.%I enable row level security', table_name);
  end loop;
end;
$$;

create policy cash_registers_select on erp.cash_registers for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('cash.view', branch_id));
create policy cash_sessions_select on erp.cash_sessions for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('cash.view', branch_id));
create policy cash_opening_select on erp.cash_session_opening_counts for select to authenticated
using (organization_id = erp.current_organization_id() and exists (
  select 1 from erp.cash_sessions session where session.id = cash_session_id
    and session.organization_id = cash_session_opening_counts.organization_id
    and erp.has_permission('cash.view', session.branch_id)
));
create policy cash_movements_select on erp.cash_movements for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('cash.view', branch_id));
create policy cash_closures_select on erp.cash_closures for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('cash.view', branch_id));
create policy cash_close_counts_select on erp.cash_close_counts for select to authenticated
using (organization_id = erp.current_organization_id() and exists (
  select 1 from erp.cash_closures closure where closure.id = cash_closure_id
    and closure.organization_id = cash_close_counts.organization_id
    and erp.has_permission('cash.view', closure.branch_id)
));
create policy sales_select on erp.sales for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('sales.view', branch_id));
create policy sale_lines_select on erp.sale_lines for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('sales.view', branch_id));
create policy sale_discounts_select on erp.sale_discount_authorizations for select to authenticated
using (organization_id = erp.current_organization_id() and exists (
  select 1 from erp.sales sale where sale.id = sale_id
    and sale.organization_id = sale_discount_authorizations.organization_id
    and erp.has_permission('sales.view', sale.branch_id)
));
create policy sale_states_select on erp.sale_state_events for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('sales.view', branch_id));
create policy payments_select on erp.payments for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('sales.view', branch_id));
create policy receivables_select on erp.customer_receivables for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('accounts_receivable.view', branch_id));
create policy customer_accounts_select on erp.customer_account_entries for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('accounts_receivable.view', branch_id));
create policy web_orders_select on erp.web_orders for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('orders.view', branch_id));
create policy web_order_lines_select on erp.web_order_lines for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('orders.view', branch_id));
create policy web_payment_events_select on erp.web_payment_events for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('orders.view', branch_id));
create policy web_order_events_select on erp.web_order_events for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('orders.view', branch_id));
create policy web_fulfillments_select on erp.web_order_fulfillments for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('orders.view', branch_id));
create policy integration_outbox_select on erp.integration_outbox for select to authenticated
using (organization_id = erp.current_organization_id() and erp.has_permission('integrations.view', branch_id));
create policy integration_attempts_select on erp.integration_attempts for select to authenticated
using (organization_id = erp.current_organization_id() and exists (
  select 1 from erp.integration_outbox outbox where outbox.id = outbox_id
    and outbox.organization_id = integration_attempts.organization_id
    and erp.has_permission('integrations.view', outbox.branch_id)
));

revoke all on
  erp.cash_registers, erp.cash_sessions, erp.cash_session_opening_counts,
  erp.cash_movements, erp.cash_closures, erp.cash_close_counts,
  erp.sales, erp.sale_lines, erp.sale_discount_authorizations, erp.sale_state_events,
  erp.payments, erp.customer_receivables, erp.customer_account_entries,
  erp.web_orders, erp.web_order_lines, erp.web_payment_events, erp.web_provider_payments, erp.web_order_events,
  erp.web_order_fulfillments, erp.integration_outbox, erp.integration_attempts
from public, anon, authenticated, service_role;

grant select on
  erp.cash_registers, erp.cash_sessions, erp.cash_session_opening_counts,
  erp.cash_movements, erp.cash_closures, erp.cash_close_counts,
  erp.sales, erp.sale_lines, erp.sale_discount_authorizations, erp.sale_state_events,
  erp.customer_receivables, erp.customer_account_entries,
  erp.web_orders, erp.web_order_lines, erp.web_order_events,
  erp.web_order_fulfillments, erp.integration_outbox, erp.integration_attempts
to authenticated, service_role;

grant select on erp.payments, erp.web_payment_events, erp.web_provider_payments to service_role;
grant select (
  id, organization_id, branch_id, sale_id, payment_method_id, cash_session_id,
  currency_code, amount, amount_base, reversal_of_payment_id, idempotency_key,
  request_hash, reason, occurred_at, actor_id
) on erp.payments to authenticated;
grant select (
  id, organization_id, branch_id, web_order_id, status, payment_method_id,
  amount, provider_occurred_at, received_at, applied, actor_id
) on erp.web_payment_events to authenticated;

revoke all on sequence
  erp.customer_account_entries_id_seq,
  erp.sale_state_events_event_sequence_seq,
  erp.web_order_events_event_sequence_seq
from public, anon, authenticated, service_role;

revoke all on function erp.audit_operational_fact() from public, anon, authenticated, service_role;
revoke all on function erp.validate_payment_reversal() from public, anon, authenticated, service_role;
revoke all on function erp.validate_cash_reversal() from public, anon, authenticated, service_role;
revoke all on function erp.validate_customer_account_entry() from public, anon, authenticated, service_role;
revoke all on function erp.release_web_order_reservation_core(uuid, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function erp.record_sale_payment_core(uuid, uuid, uuid, numeric, text, text, text) from public, anon, authenticated, service_role;
revoke all on function erp.protect_sale_header() from public, anon, authenticated, service_role;
revoke all on function erp.protect_web_order_header() from public, anon, authenticated, service_role;
revoke all on function erp.validate_web_order_fulfillment() from public, anon, authenticated, service_role;

revoke all on function erp.open_cash_session(uuid, text, text, jsonb) from public, anon, service_role;
revoke all on function erp.post_cash_movement(uuid, erp.cash_movement_kind, text, numeric, text, text) from public, anon, service_role;
revoke all on function erp.close_cash_session(uuid, text, text, jsonb) from public, anon, service_role;
revoke all on function erp.create_sale(uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid) from public, anon, service_role;
revoke all on function erp.record_sale_payment(uuid, uuid, uuid, numeric, text, text, text) from public, anon, service_role;
revoke all on function erp.reverse_sale_payment(uuid, text, text, uuid) from public, anon, service_role;
revoke all on function erp.cancel_sale(uuid, text, text, uuid) from public, anon, service_role;
revoke all on function erp.create_web_order(uuid, uuid, text, uuid, text, timestamptz, jsonb) from public, anon, service_role;
revoke all on function erp.record_web_payment_event(uuid, text, text, text, erp.web_payment_status, uuid, numeric, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function erp.record_web_order_event(uuid, text, erp.sale_delivery_state, text, text) from public, anon, service_role;
revoke all on function erp.fulfill_web_order(uuid, text, text) from public, anon, service_role;
revoke all on function erp.record_integration_attempt(uuid, erp.integration_attempt_status, text) from public, anon, service_role;

grant execute on function erp.open_cash_session(uuid, text, text, jsonb) to authenticated;
grant execute on function erp.post_cash_movement(uuid, erp.cash_movement_kind, text, numeric, text, text) to authenticated;
grant execute on function erp.close_cash_session(uuid, text, text, jsonb) to authenticated;
grant execute on function erp.create_sale(uuid, uuid, text, uuid, text, text, jsonb, jsonb, uuid) to authenticated;
grant execute on function erp.record_sale_payment(uuid, uuid, uuid, numeric, text, text, text) to authenticated;
grant execute on function erp.reverse_sale_payment(uuid, text, text, uuid) to authenticated;
grant execute on function erp.cancel_sale(uuid, text, text, uuid) to authenticated;
grant execute on function erp.create_web_order(uuid, uuid, text, uuid, text, timestamptz, jsonb) to authenticated;
grant execute on function erp.record_web_payment_event(uuid, text, text, text, erp.web_payment_status, uuid, numeric, timestamptz, jsonb) to service_role;
grant execute on function erp.record_web_order_event(uuid, text, erp.sale_delivery_state, text, text) to authenticated;
grant execute on function erp.fulfill_web_order(uuid, text, text) to authenticated;
grant execute on function erp.record_integration_attempt(uuid, erp.integration_attempt_status, text) to authenticated;

comment on table erp.sales is
  'Immutable operational sales facts. Stage 9 will translate these facts to the general ledger.';
comment on table erp.customer_account_entries is
  'Operational customer account ledger only; this is not a stage-9 general ledger posting.';
comment on table erp.web_payment_events is
  'Local idempotent provider-event inbox. No remote provider call is performed here.';
