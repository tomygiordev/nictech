-- Stage 6 keeps Storage transfer, signed URLs, QR/image rendering, PDFs, WhatsApp,
-- signature binaries, ARCA documents and general-ledger posting deferred. This
-- migration stores only private object metadata and immutable operational facts.
-- repair_credential_keys is only a local protected-key foundation. Production must
-- provision externally KMS/Vault-wrapped key material and disable SQL parameter
-- logging for key provisioning; no external KMS/Vault integration is invented here.

create type erp.repair_quote_decision as enum ('approved', 'rejected');
create type erp.repair_test_kind as enum ('intake', 'final');
create type erp.repair_test_result as enum ('pass', 'fail', 'not_applicable');
create type erp.repair_part_action as enum ('reserved', 'released', 'consumed', 'consumption_reversed');

create table erp.repair_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  command_name text not null check (command_name ~ '^[a-z][a-z0-9_.]+$'),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint repair_commands_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint repair_commands_identity_unique unique (
    command_name, organization_id, branch_id, idempotency_key
  )
);

create table erp.customer_equipment (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  brand_id uuid,
  model_id uuid,
  equipment_type text not null check (btrim(equipment_type) <> '' and length(equipment_type) <= 100),
  brand_snapshot text not null check (btrim(brand_snapshot) <> '' and length(brand_snapshot) <= 150),
  model_snapshot text not null check (btrim(model_snapshot) <> '' and length(model_snapshot) <= 150),
  serial_number text,
  imei text,
  normalized_serial_number text generated always as (
    nullif(upper(regexp_replace(btrim(serial_number), '[[:space:]-]+', '', 'g')), '')
  ) stored,
  normalized_imei text generated always as (
    nullif(regexp_replace(btrim(imei), '[^0-9]+', '', 'g'), '')
  ) stored,
  color_snapshot text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint customer_equipment_id_org_unique unique (id, organization_id),
  constraint customer_equipment_brand_fk foreign key (brand_id, organization_id)
    references erp.brands(id, organization_id) on delete restrict,
  constraint customer_equipment_model_fk foreign key (model_id, organization_id, brand_id)
    references erp.product_models(id, organization_id, brand_id) on delete restrict,
  constraint customer_equipment_model_requires_brand check (model_id is null or brand_id is not null),
  constraint customer_equipment_identifier_present check (
    normalized_serial_number is not null or normalized_imei is not null
  ),
  constraint customer_equipment_imei_format check (
    normalized_imei is null or normalized_imei ~ '^[0-9]{14,16}$'
  )
);
create unique index customer_equipment_serial_unique
  on erp.customer_equipment (organization_id, normalized_serial_number)
  where normalized_serial_number is not null;
create unique index customer_equipment_imei_unique
  on erp.customer_equipment (organization_id, normalized_imei)
  where normalized_imei is not null;

create table erp.equipment_ownership_events (
  id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  equipment_id uuid not null,
  customer_id uuid not null,
  effective_at timestamptz not null default now(),
  reason text not null check (btrim(reason) <> '' and length(reason) <= 500),
  actor_id uuid references auth.users(id) on delete restrict,
  constraint equipment_ownership_equipment_fk foreign key (equipment_id, organization_id)
    references erp.customer_equipment(id, organization_id) on delete restrict,
  constraint equipment_ownership_customer_fk foreign key (customer_id, organization_id)
    references erp.customers(id, organization_id) on delete restrict,
  constraint equipment_ownership_time_unique unique (equipment_id, effective_at)
);

create table erp.repair_statuses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  code text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null check (btrim(name) <> '' and length(name) <= 100),
  display_order integer not null check (display_order > 0),
  is_initial boolean not null default false,
  is_terminal boolean not null default false,
  requires_final_tests boolean not null default false,
  public_message text not null check (btrim(public_message) <> '' and length(public_message) <= 300),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint repair_statuses_id_org_unique unique (id, organization_id),
  constraint repair_statuses_code_unique unique (organization_id, code),
  constraint repair_statuses_order_unique unique (organization_id, display_order)
);
create unique index repair_statuses_initial_unique
  on erp.repair_statuses (organization_id) where is_initial and is_active;

create table erp.repair_status_transitions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  from_status_id uuid not null,
  to_status_id uuid not null,
  required_permission text not null default 'repairs.manage',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint repair_transition_from_fk foreign key (from_status_id, organization_id)
    references erp.repair_statuses(id, organization_id) on delete restrict,
  constraint repair_transition_to_fk foreign key (to_status_id, organization_id)
    references erp.repair_statuses(id, organization_id) on delete restrict,
  constraint repair_transition_distinct check (from_status_id <> to_status_id),
  constraint repair_transition_unique unique (organization_id, from_status_id, to_status_id)
);

create table erp.repair_number_counters (
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  next_number bigint not null check (next_number > 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, branch_id),
  constraint repair_number_counters_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict
);

create table erp.repair_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  order_number bigint not null check (order_number > 0),
  order_code text not null check (btrim(order_code) <> ''),
  tracking_token_digest text not null check (tracking_token_digest ~ '^[0-9a-f]{64}$'),
  customer_id uuid not null,
  equipment_id uuid not null,
  intake_accessories jsonb not null default '[]'::jsonb check (
    jsonb_typeof(intake_accessories) = 'array' and jsonb_array_length(intake_accessories) <= 100
    and pg_column_size(intake_accessories) <= 65536
  ),
  intake_condition text not null check (btrim(intake_condition) <> '' and length(intake_condition) <= 4000),
  intake_damage text check (intake_damage is null or length(intake_damage) <= 4000),
  intake_notes text check (intake_notes is null or length(intake_notes) <= 8000),
  reported_fault text not null check (btrim(reported_fault) <> '' and length(reported_fault) <= 8000),
  opened_at timestamptz not null default now(),
  opened_by uuid references auth.users(id) on delete restrict,
  constraint repair_orders_id_org_unique unique (id, organization_id),
  constraint repair_orders_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint repair_orders_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint repair_orders_customer_fk foreign key (customer_id, organization_id)
    references erp.customers(id, organization_id) on delete restrict,
  constraint repair_orders_equipment_fk foreign key (equipment_id, organization_id)
    references erp.customer_equipment(id, organization_id) on delete restrict,
  constraint repair_orders_number_unique unique (organization_id, branch_id, order_number),
  constraint repair_orders_code_unique unique (organization_id, order_code),
  constraint repair_orders_tracking_unique unique (tracking_token_digest)
);

create table erp.repair_tracking_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  repair_order_id uuid not null,
  token_digest text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint repair_tracking_tokens_order_fk foreign key (repair_order_id, organization_id, branch_id)
    references erp.repair_orders(id, organization_id, branch_id) on delete restrict,
  constraint repair_tracking_tokens_expiry check (
    expires_at > created_at and expires_at <= created_at + interval '365 days'
  )
);
create unique index repair_tracking_tokens_active_unique
  on erp.repair_tracking_tokens (repair_order_id) where revoked_at is null;

create table erp.repair_state_events (
  id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  repair_order_id uuid not null,
  status_id uuid not null,
  public_message text not null check (btrim(public_message) <> '' and length(public_message) <= 300),
  internal_reason text not null check (btrim(internal_reason) <> '' and length(internal_reason) <= 2000),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid references auth.users(id) on delete restrict,
  constraint repair_state_order_fk foreign key (repair_order_id, organization_id, branch_id)
    references erp.repair_orders(id, organization_id, branch_id) on delete restrict,
  constraint repair_state_status_fk foreign key (status_id, organization_id)
    references erp.repair_statuses(id, organization_id) on delete restrict
);
create index repair_state_order_sequence_idx
  on erp.repair_state_events (repair_order_id, event_sequence desc);

create table erp.repair_assignment_events (
  id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  repair_order_id uuid not null,
  assigned_profile_id uuid,
  reason text not null check (btrim(reason) <> '' and length(reason) <= 1000),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid references auth.users(id) on delete restrict,
  constraint repair_assignment_order_fk foreign key (repair_order_id, organization_id, branch_id)
    references erp.repair_orders(id, organization_id, branch_id) on delete restrict,
  constraint repair_assignment_profile_fk foreign key (assigned_profile_id, organization_id)
    references erp.profiles(id, organization_id) on delete restrict
);

create table erp.repair_credential_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  key_version integer not null check (key_version > 0),
  key_material bytea not null check (octet_length(key_material) >= 32),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  constraint repair_credential_keys_id_org_unique unique (id, organization_id),
  constraint repair_credential_keys_version_unique unique (organization_id, key_version),
  constraint repair_credential_keys_lifecycle check (
    (is_active and rotated_at is null) or (not is_active and rotated_at is not null)
  )
);
create unique index repair_credential_keys_active_unique
  on erp.repair_credential_keys (organization_id) where is_active;

create table erp.repair_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  repair_order_id uuid not null,
  key_id uuid not null,
  credential_version integer not null check (credential_version > 0),
  ciphertext bytea not null,
  cipher_version smallint not null default 1 check (cipher_version = 1),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint repair_credentials_id_org_unique unique (id, organization_id),
  constraint repair_credentials_order_fk foreign key (repair_order_id, organization_id, branch_id)
    references erp.repair_orders(id, organization_id, branch_id) on delete restrict,
  constraint repair_credentials_key_fk foreign key (key_id, organization_id)
    references erp.repair_credential_keys(id, organization_id) on delete restrict,
  constraint repair_credentials_version_unique unique (repair_order_id, credential_version)
);

create table erp.repair_test_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  code text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  kind erp.repair_test_kind not null,
  name text not null check (btrim(name) <> '' and length(name) <= 150),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint repair_test_templates_id_org_unique unique (id, organization_id),
  constraint repair_test_templates_code_unique unique (organization_id, code)
);

create table erp.repair_test_template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  template_id uuid not null,
  version integer not null check (version > 0),
  definition jsonb not null check (
    jsonb_typeof(definition) = 'array' and jsonb_array_length(definition) between 1 and 100
    and pg_column_size(definition) <= 262144
  ),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint repair_test_versions_id_org_unique unique (id, organization_id),
  constraint repair_test_versions_template_fk foreign key (template_id, organization_id)
    references erp.repair_test_templates(id, organization_id) on delete restrict,
  constraint repair_test_versions_unique unique (template_id, version)
);

create table erp.repair_test_runs (
  id uuid primary key default gen_random_uuid(),
  run_sequence bigint generated always as identity unique,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  repair_order_id uuid not null,
  template_version_id uuid not null,
  kind erp.repair_test_kind not null,
  completed_at timestamptz not null default clock_timestamp(),
  responsible_id uuid not null references auth.users(id) on delete restrict,
  notes text check (notes is null or length(notes) <= 4000),
  constraint repair_test_runs_id_org_unique unique (id, organization_id),
  constraint repair_test_runs_order_fk foreign key (repair_order_id, organization_id, branch_id)
    references erp.repair_orders(id, organization_id, branch_id) on delete restrict,
  constraint repair_test_runs_version_fk foreign key (template_version_id, organization_id)
    references erp.repair_test_template_versions(id, organization_id) on delete restrict
);

create table erp.repair_test_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  test_run_id uuid not null,
  item_key text not null check (item_key ~ '^[a-zA-Z0-9_.-]{1,100}$'),
  result erp.repair_test_result not null,
  measured_value jsonb check (measured_value is null or pg_column_size(measured_value) <= 16384),
  notes text check (notes is null or length(notes) <= 2000),
  constraint repair_test_results_run_fk foreign key (test_run_id, organization_id)
    references erp.repair_test_runs(id, organization_id) on delete restrict,
  constraint repair_test_results_item_unique unique (test_run_id, item_key)
);

create table erp.repair_quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  repair_order_id uuid not null,
  version integer not null check (version > 0),
  currency_code text not null,
  exchange_snapshot_id uuid not null,
  exchange_rate numeric(24,10) not null check (exchange_rate <> 'NaN'::numeric and exchange_rate > 0),
  subtotal_amount numeric(18,4) not null check (subtotal_amount <> 'NaN'::numeric and subtotal_amount >= 0),
  tax_amount numeric(18,4) not null check (tax_amount <> 'NaN'::numeric and tax_amount >= 0),
  total_amount numeric(18,4) not null check (
    total_amount <> 'NaN'::numeric and total_amount = subtotal_amount + tax_amount
  ),
  issued_at timestamptz,
  expires_at timestamptz,
  supersedes_quote_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint repair_quotes_id_org_unique unique (id, organization_id),
  constraint repair_quotes_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint repair_quotes_owner_unique unique (id, organization_id, branch_id, repair_order_id),
  constraint repair_quotes_order_fk foreign key (repair_order_id, organization_id, branch_id)
    references erp.repair_orders(id, organization_id, branch_id) on delete restrict,
  constraint repair_quotes_currency_fk foreign key (organization_id, currency_code)
    references erp.organization_currencies(organization_id, currency_code) on delete restrict,
  constraint repair_quotes_snapshot_fk foreign key (exchange_snapshot_id, organization_id)
    references erp.exchange_rate_snapshots(id, organization_id) on delete restrict,
  constraint repair_quotes_supersedes_fk foreign key (supersedes_quote_id, organization_id, branch_id, repair_order_id)
    references erp.repair_quotes(id, organization_id, branch_id, repair_order_id) on delete restrict,
  constraint repair_quotes_version_unique unique (repair_order_id, version),
  constraint repair_quotes_issue_shape check (
    (issued_at is null and expires_at is null) or (issued_at is not null and expires_at > issued_at)
  )
);

create table erp.repair_quote_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  quote_id uuid not null,
  line_number integer not null check (line_number > 0),
  kind erp.sale_line_kind not null,
  product_id uuid,
  variant_id uuid,
  inventory_unit_id uuid,
  description text not null check (btrim(description) <> '' and length(description) <= 1000),
  quantity numeric(18,4) not null check (quantity <> 'NaN'::numeric and quantity > 0),
  unit_price numeric(18,4) not null check (unit_price <> 'NaN'::numeric and unit_price >= 0),
  unit_cost_snapshot numeric(18,4) not null check (unit_cost_snapshot <> 'NaN'::numeric and unit_cost_snapshot >= 0),
  tax_rate_percent numeric(7,4) not null check (tax_rate_percent <> 'NaN'::numeric and tax_rate_percent between 0 and 100),
  tax_amount numeric(18,4) not null check (tax_amount <> 'NaN'::numeric and tax_amount >= 0),
  line_total numeric(18,4) not null check (
    line_total <> 'NaN'::numeric
    and tax_amount = round(round(quantity * unit_price, 4) * tax_rate_percent / 100, 4)
    and line_total = round(quantity * unit_price, 4) + tax_amount
  ),
  constraint repair_quote_lines_quote_fk foreign key (quote_id, organization_id)
    references erp.repair_quotes(id, organization_id) on delete restrict,
  constraint repair_quote_lines_product_fk foreign key (product_id, organization_id)
    references erp.products(id, organization_id) on delete restrict,
  constraint repair_quote_lines_variant_fk foreign key (variant_id, product_id, organization_id)
    references erp.product_variants(id, product_id, organization_id) on delete restrict,
  constraint repair_quote_lines_unit_fk foreign key (inventory_unit_id, organization_id)
    references erp.inventory_units(id, organization_id) on delete restrict,
  constraint repair_quote_lines_number_unique unique (quote_id, line_number),
  constraint repair_quote_lines_shape check (
    (kind = 'product' and product_id is not null)
    or (kind = 'service' and product_id is not null and inventory_unit_id is null)
    or (kind = 'free_concept' and product_id is null and variant_id is null and inventory_unit_id is null)
  )
);

create table erp.repair_quote_response_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  quote_id uuid not null,
  token_digest text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint repair_quote_tokens_identity_unique unique (id, organization_id, branch_id, quote_id),
  constraint repair_quote_tokens_quote_fk foreign key (quote_id, organization_id, branch_id)
    references erp.repair_quotes(id, organization_id, branch_id) on delete restrict,
  constraint repair_quote_tokens_expiry check (
    expires_at > created_at and expires_at <= created_at + interval '7 days'
  ),
  constraint repair_quote_tokens_terminal check (num_nonnulls(used_at, revoked_at) <= 1)
);

create table erp.repair_quote_response_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  repair_order_id uuid not null,
  quote_id uuid not null,
  token_id uuid not null unique,
  decision erp.repair_quote_decision not null,
  customer_message text check (customer_message is null or length(customer_message) <= 2000),
  occurred_at timestamptz not null default clock_timestamp(),
  constraint repair_quote_response_quote_fk foreign key (quote_id, organization_id, branch_id, repair_order_id)
    references erp.repair_quotes(id, organization_id, branch_id, repair_order_id) on delete restrict,
  constraint repair_quote_response_token_fk foreign key (token_id, organization_id, branch_id, quote_id)
    references erp.repair_quote_response_tokens(id, organization_id, branch_id, quote_id) on delete restrict,
  constraint repair_quote_response_once unique (repair_order_id)
);

create table erp.repair_part_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  repair_order_id uuid not null,
  action erp.repair_part_action not null,
  reservation_batch_id uuid,
  stock_document_id uuid,
  reverses_event_id uuid,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid references auth.users(id) on delete restrict,
  constraint repair_part_events_id_org_unique unique (id, organization_id),
  constraint repair_part_events_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint repair_part_order_fk foreign key (repair_order_id, organization_id, branch_id)
    references erp.repair_orders(id, organization_id, branch_id) on delete restrict,
  constraint repair_part_batch_fk foreign key (reservation_batch_id, organization_id)
    references erp.stock_reservation_batches(id, organization_id) on delete restrict,
  constraint repair_part_document_fk foreign key (stock_document_id, organization_id)
    references erp.stock_documents(id, organization_id) on delete restrict,
  constraint repair_part_reverse_fk foreign key (reverses_event_id, organization_id, branch_id)
    references erp.repair_part_events(id, organization_id, branch_id) on delete restrict,
  constraint repair_part_event_shape check (
    (action in ('reserved','released') and reservation_batch_id is not null and stock_document_id is null)
    or (action in ('consumed','consumption_reversed') and stock_document_id is not null)
  ),
  constraint repair_part_batch_action_unique unique (reservation_batch_id, action),
  constraint repair_part_document_unique unique (stock_document_id),
  constraint repair_part_reversal_unique unique (reverses_event_id)
);

create table erp.repair_labor_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  repair_order_id uuid not null,
  description text not null check (btrim(description) <> '' and length(description) <= 1000),
  quantity_hours numeric(12,4) not null check (quantity_hours <> 'NaN'::numeric and quantity_hours > 0),
  unit_cost_base numeric(18,4) not null check (unit_cost_base <> 'NaN'::numeric and unit_cost_base >= 0),
  total_cost_base numeric(18,4) generated always as (round(quantity_hours * unit_cost_base, 4)) stored,
  performed_at timestamptz not null default now(),
  performed_by uuid references auth.users(id) on delete restrict,
  constraint repair_labor_order_fk foreign key (repair_order_id, organization_id, branch_id)
    references erp.repair_orders(id, organization_id, branch_id) on delete restrict
);

create table erp.repair_media_upload_tokens (
  id uuid primary key default gen_random_uuid(),
  token_family_id uuid not null default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  repair_order_id uuid not null,
  token_digest text not null unique check (token_digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  max_file_count integer not null check (max_file_count between 1 and 100),
  max_total_bytes bigint not null check (max_total_bytes between 1 and 1073741824),
  allowed_mime_types text[] not null check (
    cardinality(allowed_mime_types) between 1 and 20
    and allowed_mime_types <@ array['image/jpeg','image/png','image/webp','video/mp4']::text[]
  ),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint repair_media_tokens_identity_unique unique (id, organization_id, branch_id, repair_order_id),
  constraint repair_media_tokens_order_fk foreign key (repair_order_id, organization_id, branch_id)
    references erp.repair_orders(id, organization_id, branch_id) on delete restrict,
  constraint repair_media_tokens_expiry check (
    expires_at > created_at and expires_at <= created_at + interval '24 hours'
  )
);
create index repair_media_tokens_family_idx
  on erp.repair_media_upload_tokens (organization_id, token_family_id);

create table erp.repair_private_media (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  repair_order_id uuid not null,
  upload_token_id uuid not null,
  file_slot integer not null check (file_slot between 1 and 100),
  object_path text not null check (btrim(object_path) <> '' and length(object_path) <= 1000),
  client_filename text not null check (btrim(client_filename) <> '' and length(client_filename) <= 255),
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  sha256_digest text not null check (sha256_digest ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now(),
  constraint repair_private_media_order_fk foreign key (repair_order_id, organization_id, branch_id)
    references erp.repair_orders(id, organization_id, branch_id) on delete restrict,
  constraint repair_private_media_token_fk foreign key (upload_token_id, organization_id, branch_id, repair_order_id)
    references erp.repair_media_upload_tokens(id, organization_id, branch_id, repair_order_id) on delete restrict,
  constraint repair_private_media_path_unique unique (organization_id, object_path),
  constraint repair_private_media_slot_unique unique (upload_token_id, file_slot)
);

create table erp.repair_label_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  repair_order_id uuid not null,
  template_code text not null check (btrim(template_code) <> '' and length(template_code) <= 100),
  copies integer not null check (copies between 1 and 20),
  printer_snapshot text check (printer_snapshot is null or length(printer_snapshot) <= 300),
  printed_at timestamptz not null default now(),
  printed_by uuid references auth.users(id) on delete restrict,
  constraint repair_label_order_fk foreign key (repair_order_id, organization_id, branch_id)
    references erp.repair_orders(id, organization_id, branch_id) on delete restrict
);

create table erp.repair_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  repair_order_id uuid not null unique,
  recipient_name text not null check (btrim(recipient_name) <> '' and length(recipient_name) <= 200),
  recipient_document_suffix text check (recipient_document_suffix ~ '^[0-9A-Za-z]{0,8}$'),
  signature_method text not null check (signature_method in ('typed_name','external_reference','none')),
  signature_reference text check (signature_reference is null or length(signature_reference) <= 500),
  delivered_at timestamptz not null default now(),
  delivered_by uuid references auth.users(id) on delete restrict,
  constraint repair_deliveries_id_org_unique unique (id, organization_id),
  constraint repair_deliveries_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint repair_deliveries_owner_unique unique (id, organization_id, branch_id, repair_order_id),
  constraint repair_delivery_order_fk foreign key (repair_order_id, organization_id, branch_id)
    references erp.repair_orders(id, organization_id, branch_id) on delete restrict,
  constraint repair_delivery_signature_shape check (
    (signature_method = 'none' and signature_reference is null)
    or (signature_method <> 'none' and nullif(btrim(signature_reference), '') is not null)
  )
);

create table erp.repair_warranties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  repair_order_id uuid not null unique,
  delivery_id uuid not null unique,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  terms_snapshot text not null check (btrim(terms_snapshot) <> '' and length(terms_snapshot) <= 8000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint repair_warranties_id_org_unique unique (id, organization_id),
  constraint repair_warranties_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint repair_warranty_order_fk foreign key (repair_order_id, organization_id, branch_id)
    references erp.repair_orders(id, organization_id, branch_id) on delete restrict,
  constraint repair_warranty_delivery_fk foreign key (delivery_id, organization_id, branch_id, repair_order_id)
    references erp.repair_deliveries(id, organization_id, branch_id, repair_order_id) on delete restrict,
  constraint repair_warranty_range check (ends_at > starts_at)
);

create table erp.repair_warranty_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  warranty_id uuid not null,
  claim_code text not null check (btrim(claim_code) <> ''),
  reported_issue text not null check (btrim(reported_issue) <> '' and length(reported_issue) <= 8000),
  opened_at timestamptz not null default now(),
  opened_by uuid references auth.users(id) on delete restrict,
  constraint repair_claim_warranty_fk foreign key (warranty_id, organization_id, branch_id)
    references erp.repair_warranties(id, organization_id, branch_id) on delete restrict,
  constraint repair_claim_code_unique unique (organization_id, claim_code)
);

-- A payment belongs to exactly one operational owner. Existing sale commands and
-- signatures remain unchanged; repair deposits never create customer-account rows.
alter table erp.payments alter column sale_id drop not null;
alter table erp.payments add column repair_order_id uuid;
alter table erp.payments add constraint payments_repair_order_fk
  foreign key (repair_order_id, organization_id, branch_id)
  references erp.repair_orders(id, organization_id, branch_id) on delete restrict;
alter table erp.payments add constraint payments_exactly_one_owner
  check (num_nonnulls(sale_id, repair_order_id) = 1);
create index payments_repair_time_idx
  on erp.payments (repair_order_id, occurred_at, id) where repair_order_id is not null;

create or replace function erp.validate_payment_reversal()
returns trigger
language plpgsql
set search_path = erp, pg_catalog
as $$
declare method_requires_cash boolean;
begin
  select requires_cash_session into method_requires_cash from erp.payment_methods
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
      and opening.branch_id = new.branch_id and opening.currency_code = new.currency_code
  ) then
    raise exception using errcode = 'foreign_key_violation', message = 'payment currency is not open in its cash session';
  end if;
  if new.reversal_of_payment_id is not null and not exists (
    select 1 from erp.payments original
    where original.id = new.reversal_of_payment_id
      and original.organization_id = new.organization_id and original.branch_id = new.branch_id
      and original.sale_id is not distinct from new.sale_id
      and original.repair_order_id is not distinct from new.repair_order_id
      and original.payment_method_id = new.payment_method_id
      and original.currency_code = new.currency_code
      and original.amount = -new.amount and original.amount_base = -new.amount_base
      and original.reversal_of_payment_id is null
  ) then
    raise exception using errcode = 'check_violation', message = 'payment reversal must exactly offset its original payment';
  end if;
  return new;
end;
$$;

create or replace function erp.claim_repair_command(
  command text, target_organization_id uuid, target_branch_id uuid,
  operation_key text, request_body jsonb
)
returns erp.repair_commands
language plpgsql
security definer
set search_path=pg_catalog,erp,extensions
as $$
declare command_row erp.repair_commands%rowtype;
declare expected_hash text;
begin
  if nullif(btrim(command), '') is null or nullif(btrim(operation_key), '') is null
    or request_body is null or pg_column_size(request_body) > 1048576 then
    raise exception using errcode = 'invalid_parameter_value', message = 'bounded command data is required';
  end if;
  expected_hash := encode(extensions.digest(convert_to(request_body::text, 'UTF8'), 'sha256'), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    target_organization_id::text || ':' || target_branch_id::text || ':' || command || ':' || operation_key, 0
  ));
  select * into command_row from erp.repair_commands
  where command_name = command and organization_id = target_organization_id
    and branch_id = target_branch_id and idempotency_key = operation_key;
  if found then
    if command_row.request_hash <> expected_hash then
      raise exception using errcode = 'integrity_constraint_violation', message = 'idempotency key is already used by another request';
    end if;
    return command_row;
  end if;
  insert into erp.repair_commands (
    organization_id, branch_id, command_name, idempotency_key, request_hash, created_by
  ) values (
    target_organization_id, target_branch_id, command, operation_key, expected_hash, auth.uid()
  ) returning * into command_row;
  return command_row;
end;
$$;

create or replace function erp.complete_repair_command(command_id uuid, command_result_id uuid)
returns void language plpgsql security definer
set search_path=pg_catalog,erp
as $$
begin
  perform set_config('erp.allow_repair_command_completion', 'on', true);
  update erp.repair_commands set result_id = command_result_id
  where id = command_id and result_id is null;
  if not found then raise exception using errcode = 'data_exception', message = 'command completion failed'; end if;
  perform set_config('erp.allow_repair_command_completion', 'off', true);
end;
$$;

create or replace function erp.protect_repair_command()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if tg_op = 'UPDATE' and current_setting('erp.allow_repair_command_completion', true) = 'on'
    and old.result_id is null and new.result_id is not null
    and (to_jsonb(new) - 'result_id') = (to_jsonb(old) - 'result_id') then return new;
  end if;
  raise exception using errcode = 'integrity_constraint_violation', message = 'repair commands are immutable';
end;
$$;
create trigger repair_commands_immutable before update or delete on erp.repair_commands
for each row execute function erp.protect_repair_command();

create or replace function erp.create_customer_equipment(
  target_branch_id uuid, target_customer_id uuid, target_brand_id uuid, target_model_id uuid,
  equipment_type text, brand_snapshot text, model_snapshot text, serial_number text, imei text,
  operation_key text, operation_reason text
)
returns uuid language plpgsql security definer
set search_path=pg_catalog,erp,extensions
as $$
declare org_id uuid := erp.current_organization_id(); declare cmd erp.repair_commands%rowtype; declare equipment_id uuid; declare key_row erp.repair_credential_keys%rowtype; declare candidate_key erp.repair_credential_keys%rowtype; declare normalized_serial text:=nullif(upper(regexp_replace(btrim(serial_number),'[[:space:]-]+','','g')),''); declare normalized_imei text:=nullif(regexp_replace(btrim(imei),'[^0-9]+','','g'),''); declare command_payload jsonb; declare prior_hash text;
begin
  if org_id is null or not erp.has_permission('repairs.manage', target_branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'repairs.manage permission is required';
  end if;
  if not exists (select 1 from erp.customers where id = target_customer_id and organization_id = org_id) then
    raise exception using errcode = 'foreign_key_violation', message = 'customer not found';
  end if;
  select request_hash into prior_hash from erp.repair_commands where command_name='repair.equipment.create' and organization_id=org_id and branch_id=target_branch_id and idempotency_key=operation_key;
  if prior_hash is not null then
    for candidate_key in select * from erp.repair_credential_keys where organization_id=org_id order by key_version loop
      command_payload:=jsonb_build_object('customer_id',target_customer_id,'brand_id',target_brand_id,'model_id',target_model_id,'type',equipment_type,'brand',brand_snapshot,'model',model_snapshot,
        'serial_hmac',case when normalized_serial is null then null else encode(extensions.hmac(convert_to(normalized_serial,'UTF8'),candidate_key.key_material,'sha256'),'hex') end,
        'imei_hmac',case when normalized_imei is null then null else encode(extensions.hmac(convert_to(normalized_imei,'UTF8'),candidate_key.key_material,'sha256'),'hex') end,'identifier_key_id',candidate_key.id,'reason',operation_reason);
      if encode(extensions.digest(convert_to(command_payload::text,'UTF8'),'sha256'),'hex')=prior_hash then key_row:=candidate_key; exit; end if;
    end loop;
    if key_row.id is null then raise exception using errcode='integrity_constraint_violation',message='idempotency key is already used by another request'; end if;
  else
    select * into key_row from erp.repair_credential_keys where organization_id=org_id and is_active for share;
  end if;
  if key_row.id is null then raise exception using errcode='object_not_in_prerequisite_state',message='protected repair identifier key is unavailable'; end if;
  command_payload:=jsonb_build_object('customer_id',target_customer_id,'brand_id',target_brand_id,'model_id',target_model_id,'type',equipment_type,'brand',brand_snapshot,'model',model_snapshot,
    'serial_hmac',case when normalized_serial is null then null else encode(extensions.hmac(convert_to(normalized_serial,'UTF8'),key_row.key_material,'sha256'),'hex') end,
    'imei_hmac',case when normalized_imei is null then null else encode(extensions.hmac(convert_to(normalized_imei,'UTF8'),key_row.key_material,'sha256'),'hex') end,'identifier_key_id',key_row.id,'reason',operation_reason);
  cmd := erp.claim_repair_command('repair.equipment.create',org_id,target_branch_id,operation_key,command_payload);
  if cmd.result_id is not null then return cmd.result_id; end if;
  insert into erp.customer_equipment (
    organization_id, brand_id, model_id, equipment_type, brand_snapshot, model_snapshot,
    serial_number, imei, created_by
  ) values (org_id,target_brand_id,target_model_id,btrim(equipment_type),btrim(brand_snapshot),btrim(model_snapshot),
    nullif(btrim(serial_number),''),nullif(btrim(imei),''),auth.uid()) returning id into equipment_id;
  insert into erp.equipment_ownership_events (organization_id,equipment_id,customer_id,reason,actor_id)
  values (org_id,equipment_id,target_customer_id,operation_reason,auth.uid());
  perform erp.complete_repair_command(cmd.id,equipment_id); return equipment_id;
end;
$$;

create or replace function erp.transfer_customer_equipment(
  target_branch_id uuid, target_equipment_id uuid, target_customer_id uuid,
  operation_key text, operation_reason text
)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid := erp.current_organization_id(); declare cmd erp.repair_commands%rowtype; declare event_id uuid;
begin
  if org_id is null or not erp.has_permission('repairs.manage',target_branch_id) then raise exception using errcode='insufficient_privilege',message='repairs.manage permission is required'; end if;
  perform 1 from erp.customer_equipment where id=target_equipment_id and organization_id=org_id for update;
  if not found then raise exception using errcode='foreign_key_violation',message='equipment not found'; end if;
  cmd := erp.claim_repair_command('repair.equipment.transfer',org_id,target_branch_id,operation_key,
    jsonb_build_object('equipment_id',target_equipment_id,'customer_id',target_customer_id,'reason',operation_reason));
  if cmd.result_id is not null then return cmd.result_id; end if;
  if not exists (select 1 from erp.customers where id=target_customer_id and organization_id=org_id) then
    raise exception using errcode='foreign_key_violation',message='customer not found';
  end if;
  if target_customer_id = (select customer_id from erp.equipment_ownership_events where equipment_id=target_equipment_id order by event_sequence desc limit 1) then
    raise exception using errcode='check_violation',message='equipment already belongs to customer';
  end if;
  insert into erp.equipment_ownership_events(organization_id,equipment_id,customer_id,reason,actor_id)
  values(org_id,target_equipment_id,target_customer_id,operation_reason,auth.uid()) returning id into event_id;
  perform erp.complete_repair_command(cmd.id,event_id); return event_id;
end; $$;

create or replace function erp.create_repair_order(
  target_branch_id uuid, target_customer_id uuid, target_equipment_id uuid,
  accessories jsonb, intake_condition text, intake_damage text, intake_notes text, reported_fault text,
  operation_key text, operation_reason text
)
returns table (repair_order_id uuid, order_code text, tracking_token text)
language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare org_id uuid := erp.current_organization_id(); declare cmd erp.repair_commands%rowtype;
declare next_no bigint; declare prefix text; declare initial_status erp.repair_statuses%rowtype; declare raw_token text;
begin
  if org_id is null or not erp.has_permission('repairs.manage',target_branch_id) then raise exception using errcode='insufficient_privilege',message='repairs.manage permission is required'; end if;
  if accessories is null or jsonb_typeof(accessories)<>'array' or jsonb_array_length(accessories)>100 or pg_column_size(accessories)>65536
    or nullif(btrim(intake_condition),'') is null or nullif(btrim(reported_fault),'') is null then
    raise exception using errcode='invalid_parameter_value',message='bounded intake data is required';
  end if;
  cmd := erp.claim_repair_command('repair.order.create',org_id,target_branch_id,operation_key,
    jsonb_build_object('customer_id',target_customer_id,'equipment_id',target_equipment_id,'accessories',accessories,
      'condition',intake_condition,'damage',intake_damage,'notes',intake_notes,'fault',reported_fault,'reason',operation_reason));
  if cmd.result_id is not null then
    raise exception using errcode='object_not_in_prerequisite_state',message='tracking token was already returned; rotate it to recover access';
  end if;
  perform 1 from erp.customer_equipment where id=target_equipment_id and organization_id=org_id for update;
  if not found then raise exception using errcode='foreign_key_violation',message='equipment not found'; end if;
  if target_customer_id is distinct from (select customer_id from erp.equipment_ownership_events where equipment_id=target_equipment_id order by event_sequence desc limit 1) then
    raise exception using errcode='check_violation',message='customer is not the current equipment owner';
  end if;
  select * into initial_status from erp.repair_statuses where organization_id=org_id and is_initial and is_active;
  if initial_status.id is null then raise exception using errcode='object_not_in_prerequisite_state',message='one active initial repair status is required'; end if;
  insert into erp.repair_number_counters(organization_id,branch_id,next_number) values(org_id,target_branch_id,2)
  on conflict(organization_id,branch_id) do update set next_number=erp.repair_number_counters.next_number+1,updated_at=now()
  returning next_number-1 into next_no;
  select coalesce(nullif(value#>>'{}',''),'NT') into prefix from erp.configuration_values
  where organization_id=org_id and branch_id is null and key='repairs.order_prefix';
  prefix := coalesce(prefix,'NT'); raw_token := encode(extensions.gen_random_bytes(32),'hex');
  insert into erp.repair_orders(organization_id,branch_id,order_number,order_code,tracking_token_digest,
    customer_id,equipment_id,intake_accessories,intake_condition,intake_damage,intake_notes,reported_fault,opened_by)
  values(org_id,target_branch_id,next_no,prefix||'-'||lpad(next_no::text,8,'0'),
    encode(extensions.digest(convert_to(raw_token,'UTF8'),'sha256'),'hex'),target_customer_id,target_equipment_id,
    accessories,btrim(intake_condition),intake_damage,intake_notes,btrim(reported_fault),auth.uid())
  returning id,erp.repair_orders.order_code into repair_order_id,order_code;
  insert into erp.repair_state_events(organization_id,branch_id,repair_order_id,status_id,public_message,internal_reason,actor_id)
  values(org_id,target_branch_id,repair_order_id,initial_status.id,initial_status.public_message,operation_reason,auth.uid());
  insert into erp.repair_tracking_tokens(organization_id,branch_id,repair_order_id,token_digest,expires_at,created_by)
  values(org_id,target_branch_id,repair_order_id,encode(extensions.digest(convert_to(raw_token,'UTF8'),'sha256'),'hex'),now()+interval '180 days',auth.uid());
  perform erp.complete_repair_command(cmd.id,repair_order_id); tracking_token:=raw_token; return next;
end; $$;

create or replace function erp.provision_repair_credential_key(target_organization_id uuid,new_key_material bytea,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare key_id uuid; declare next_version integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='insufficient_privilege',message='service role is required to provision repair credential keys'; end if;
  if not exists(select 1 from erp.organizations where id=target_organization_id)
    or new_key_material is null or octet_length(new_key_material)<32
    or nullif(btrim(operation_reason),'') is null then
    raise exception using errcode='invalid_parameter_value',message='organization, 256-bit key material and reason are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':repair-credential-key',0));
  select coalesce(max(key_version),0)+1 into next_version from erp.repair_credential_keys where organization_id=target_organization_id;
  perform set_config('erp.allow_credential_key_rotation','on',true);
  update erp.repair_credential_keys set is_active=false,rotated_at=clock_timestamp()
  where organization_id=target_organization_id and is_active;
  perform set_config('erp.allow_credential_key_rotation','off',true);
  insert into erp.repair_credential_keys(organization_id,key_version,key_material)
  values(target_organization_id,next_version,new_key_material) returning id into key_id;
  insert into erp.audit_events(organization_id,actor_user_id,schema_name,table_name,record_id,action,reason,metadata)
  values(target_organization_id,auth.uid(),'erp','repair_credential_keys',key_id::text,'execute',operation_reason,jsonb_build_object('key_version',next_version));
  return key_id;
end; $$;

create or replace function erp.rotate_repair_credentials(target_repair_order_id uuid,credentials jsonb,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare org_id uuid:=erp.current_organization_id(); declare branch uuid; declare key_row erp.repair_credential_keys%rowtype; declare next_version integer; declare credential_id uuid;
begin
  select branch_id into branch from erp.repair_orders where id=target_repair_order_id and organization_id=org_id for update;
  if branch is null or not erp.has_permission('repairs.manage',branch) then raise exception using errcode='insufficient_privilege',message='repairs.manage permission is required'; end if;
  if credentials is null or jsonb_typeof(credentials)<>'object' or credentials='{}'::jsonb or pg_column_size(credentials)>65536 or nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='bounded credential object and reason are required'; end if;
  select * into key_row from erp.repair_credential_keys where organization_id=org_id and is_active for share;
  if key_row.id is null then raise exception using errcode='object_not_in_prerequisite_state',message='active repair credential key is unavailable'; end if;
  select coalesce(max(credential_version),0)+1 into next_version from erp.repair_credentials where repair_order_id=target_repair_order_id;
  insert into erp.repair_credentials(organization_id,branch_id,repair_order_id,key_id,credential_version,ciphertext,created_by)
  values(org_id,branch,target_repair_order_id,key_row.id,next_version,extensions.pgp_sym_encrypt(credentials::text,encode(key_row.key_material,'hex'),'cipher-algo=aes256'),auth.uid()) returning id into credential_id;
  insert into erp.audit_events(organization_id,branch_id,actor_user_id,schema_name,table_name,record_id,action,metadata)
  values(org_id,branch,auth.uid(),'erp','repair_credentials',credential_id::text,'execute',jsonb_build_object('repair_order_id',target_repair_order_id,'credential_version',next_version));
  return credential_id;
end; $$;

create or replace function erp.get_repair_credentials(target_repair_order_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare org_id uuid:=erp.current_organization_id(); declare branch uuid; declare encrypted bytea; declare key_material bytea; declare credential_id uuid; declare answer jsonb;
begin
  select o.branch_id,c.id,c.ciphertext,k.key_material into branch,credential_id,encrypted,key_material
  from erp.repair_orders o join erp.repair_credentials c on c.repair_order_id=o.id and c.organization_id=o.organization_id
  join erp.repair_credential_keys k on k.id=c.key_id and k.organization_id=c.organization_id
  where o.id=target_repair_order_id and o.organization_id=org_id order by c.credential_version desc limit 1;
  if branch is null or not erp.has_permission('repairs.view',branch) or not erp.has_permission('repairs.view_credentials',branch) then raise exception using errcode='insufficient_privilege',message='repair credential permissions are required'; end if;
  answer:=extensions.pgp_sym_decrypt(encrypted,encode(key_material,'hex'))::jsonb;
  insert into erp.audit_events(organization_id,branch_id,actor_user_id,schema_name,table_name,record_id,action,metadata)
  values(org_id,branch,auth.uid(),'erp','repair_credentials',credential_id::text,'read_sensitive',jsonb_build_object('repair_order_id',target_repair_order_id));
  return answer;
end; $$;

create or replace function erp.repair_latest_final_test_passes(target_repair_order_id uuid,target_organization_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,erp as $$
  with progression as (
    select max(e.occurred_at) as occurred_at
    from erp.repair_state_events e join erp.repair_statuses s
      on s.id=e.status_id and s.organization_id=e.organization_id
    where e.repair_order_id=target_repair_order_id and e.organization_id=target_organization_id
      and not s.is_terminal
  ), latest_run as (
    select r.id,r.template_version_id,r.completed_at
    from erp.repair_test_runs r
    where r.repair_order_id=target_repair_order_id and r.organization_id=target_organization_id and r.kind='final'
    order by r.run_sequence desc limit 1
  ), required_keys as (
    select item->>'key' as item_key
    from latest_run r join erp.repair_test_template_versions v on v.id=r.template_version_id and v.organization_id=target_organization_id
    cross join lateral jsonb_array_elements(v.definition) item
    where coalesce((item->>'required')::boolean,true)
  )
  select coalesce(
    (select r.completed_at>=p.occurred_at
      and (select count(*) from required_keys)>0
      and not exists(select 1 from required_keys k where not exists(
        select 1 from erp.repair_test_results x where x.test_run_id=r.id and x.item_key=k.item_key and x.result='pass'
      ))
     from latest_run r cross join progression p),false
  );
$$;

create or replace function erp.transition_repair_order(target_repair_order_id uuid,target_status_id uuid,public_message text,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); declare order_row erp.repair_orders%rowtype; declare current_status uuid; declare transition_permission text; declare status_row erp.repair_statuses%rowtype; declare cmd erp.repair_commands%rowtype; declare event_id uuid;
begin
  select * into order_row from erp.repair_orders where id=target_repair_order_id and organization_id=org_id for update;
  if order_row.id is null then raise exception using errcode='no_data_found',message='repair order not found'; end if;
  cmd:=erp.claim_repair_command('repair.order.transition',org_id,order_row.branch_id,operation_key,jsonb_build_object('order_id',target_repair_order_id,'status_id',target_status_id,'message',public_message,'reason',operation_reason));
  if cmd.result_id is not null then return cmd.result_id; end if;
  select status_id into current_status from erp.repair_state_events where repair_order_id=target_repair_order_id order by event_sequence desc limit 1;
  select t.required_permission into transition_permission from erp.repair_status_transitions t join erp.repair_statuses s on s.id=t.to_status_id and s.organization_id=t.organization_id where t.organization_id=org_id and t.from_status_id=current_status and t.to_status_id=target_status_id and t.is_active and s.is_active;
  select s into status_row from erp.repair_status_transitions t join erp.repair_statuses s on s.id=t.to_status_id and s.organization_id=t.organization_id where t.organization_id=org_id and t.from_status_id=current_status and t.to_status_id=target_status_id and t.is_active and s.is_active;
  if transition_permission is null or not erp.has_permission(transition_permission,order_row.branch_id) then raise exception using errcode='insufficient_privilege',message='authorized repair transition is required'; end if;
  if status_row.requires_final_tests and not erp.repair_latest_final_test_passes(target_repair_order_id,org_id) then raise exception using errcode='object_not_in_prerequisite_state',message='latest final test must follow repair progression and pass every required item'; end if;
  insert into erp.repair_state_events(organization_id,branch_id,repair_order_id,status_id,public_message,internal_reason,actor_id)
  values(org_id,order_row.branch_id,target_repair_order_id,target_status_id,coalesce(nullif(btrim(public_message),''),status_row.public_message),operation_reason,auth.uid()) returning id into event_id;
  perform erp.complete_repair_command(cmd.id,event_id); return event_id;
end; $$;

create or replace function erp.assign_repair_order(target_repair_order_id uuid,target_profile_id uuid,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); declare branch uuid; declare cmd erp.repair_commands%rowtype; declare event_id uuid;
begin
  select branch_id into branch from erp.repair_orders where id=target_repair_order_id and organization_id=org_id for update;
  if branch is null or not erp.has_permission('repairs.manage',branch) then raise exception using errcode='insufficient_privilege',message='repairs.manage permission is required'; end if;
  if target_profile_id is not null and not exists(select 1 from erp.profiles where id=target_profile_id and organization_id=org_id and is_active) then raise exception using errcode='foreign_key_violation',message='active assignee not found'; end if;
  cmd:=erp.claim_repair_command('repair.order.assign',org_id,branch,operation_key,jsonb_build_object('order_id',target_repair_order_id,'profile_id',target_profile_id,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  insert into erp.repair_assignment_events(organization_id,branch_id,repair_order_id,assigned_profile_id,reason,actor_id) values(org_id,branch,target_repair_order_id,target_profile_id,operation_reason,auth.uid()) returning id into event_id;
  perform erp.complete_repair_command(cmd.id,event_id); return event_id;
end; $$;

create or replace function erp.record_repair_test_run(target_repair_order_id uuid,target_template_version_id uuid,results jsonb,run_notes text,operation_key text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); declare branch uuid; declare test_kind erp.repair_test_kind; declare definition jsonb; declare cmd erp.repair_commands%rowtype; declare run_id uuid; declare item jsonb;
begin
  select branch_id into branch from erp.repair_orders where id=target_repair_order_id and organization_id=org_id;
  if branch is null or not erp.has_permission('repair_tests.manage',branch) then raise exception using errcode='insufficient_privilege',message='repair_tests.manage permission is required'; end if;
  select t.kind,v.definition into test_kind,definition from erp.repair_test_template_versions v join erp.repair_test_templates t on t.id=v.template_id and t.organization_id=v.organization_id where v.id=target_template_version_id and v.organization_id=org_id and t.is_active;
  if test_kind is null or results is null or jsonb_typeof(results)<>'array' or jsonb_array_length(results)<1 or jsonb_array_length(results)>100 or pg_column_size(results)>262144 then raise exception using errcode='invalid_parameter_value',message='active template and bounded results are required'; end if;
  if exists(select 1 from jsonb_array_elements(definition) d where jsonb_typeof(d)<>'object' or nullif(d->>'key','') is null)
    or (select count(*) from jsonb_array_elements(definition) d where coalesce((d->>'required')::boolean,true))
       <> jsonb_array_length(results)
    or exists(select 1 from jsonb_array_elements(results) r where jsonb_typeof(r)<>'object' or nullif(r->>'item_key','') is null or r->>'result' not in('pass','fail','not_applicable')
      or not exists(select 1 from jsonb_array_elements(definition) d where d->>'key'=r->>'item_key' and coalesce((d->>'required')::boolean,true)))
    or exists(select 1 from jsonb_array_elements(definition) d where coalesce((d->>'required')::boolean,true)
      and not exists(select 1 from jsonb_array_elements(results) r where r->>'item_key'=d->>'key'))
    or (select count(distinct r->>'item_key') from jsonb_array_elements(results) r)<>jsonb_array_length(results) then
    raise exception using errcode='invalid_parameter_value',message='result keys must exactly match required template keys';
  end if;
  cmd:=erp.claim_repair_command('repair.test.run',org_id,branch,operation_key,jsonb_build_object('order_id',target_repair_order_id,'version_id',target_template_version_id,'results',results,'notes',run_notes)); if cmd.result_id is not null then return cmd.result_id; end if;
  insert into erp.repair_test_runs(organization_id,branch_id,repair_order_id,template_version_id,kind,responsible_id,notes) values(org_id,branch,target_repair_order_id,target_template_version_id,test_kind,auth.uid(),run_notes) returning id into run_id;
  for item in select value from jsonb_array_elements(results) loop insert into erp.repair_test_results(organization_id,test_run_id,item_key,result,measured_value,notes) values(org_id,run_id,item->>'item_key',(item->>'result')::erp.repair_test_result,item->'value',item->>'notes'); end loop;
  perform erp.complete_repair_command(cmd.id,run_id); return run_id;
end; $$;

create or replace function erp.create_repair_quote_version(target_repair_order_id uuid,quote_currency text,target_exchange_snapshot_id uuid,lines jsonb,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); declare branch uuid; declare rate numeric; declare cmd erp.repair_commands%rowtype; declare quote_id uuid; declare prior uuid; declare version_no int; declare line jsonb; declare normalized_lines jsonb:='[]'::jsonb; declare n int:=0; declare subtotal numeric:=0; declare tax_total numeric:=0; declare q numeric; declare price numeric; declare cost numeric; declare tax_rate numeric; declare tax numeric; declare line_kind erp.sale_line_kind; declare product_id uuid; declare variant_id uuid; declare inventory_unit_id uuid; declare tracking_mode erp.inventory_tracking_mode;
begin
  select branch_id into branch from erp.repair_orders where id=target_repair_order_id and organization_id=org_id for update;
  if branch is null or not erp.has_permission('quotes.manage',branch) then raise exception using errcode='insufficient_privilege',message='quotes.manage permission is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(org_id::text||':'||branch::text,0));
  if exists(select 1 from erp.repair_quote_response_events where repair_order_id=target_repair_order_id and organization_id=org_id) then raise exception using errcode='object_not_in_prerequisite_state',message='customer quote decision is already terminal for this repair'; end if;
  if lines is null or jsonb_typeof(lines)<>'array' or jsonb_array_length(lines)<1 or jsonb_array_length(lines)>250 or pg_column_size(lines)>1048576 then raise exception using errcode='invalid_parameter_value',message='quote requires bounded lines'; end if;
  select snapshot.rate_to_base into rate from erp.exchange_rate_snapshots snapshot where snapshot.id=target_exchange_snapshot_id and snapshot.organization_id=org_id and snapshot.quote_currency=upper(btrim(create_repair_quote_version.quote_currency)); if rate is null then raise exception using errcode='foreign_key_violation',message='matching exchange snapshot not found'; end if;
  cmd:=erp.claim_repair_command('repair.quote.create_version',org_id,branch,operation_key,jsonb_build_object('order_id',target_repair_order_id,'currency',upper(btrim(quote_currency)),'snapshot_id',target_exchange_snapshot_id,'lines',lines,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  select id,version into prior,version_no from erp.repair_quotes where repair_order_id=target_repair_order_id order by version desc limit 1 for update; version_no:=coalesce(version_no,0)+1;
  for line in select value from jsonb_array_elements(lines) loop
    n:=n+1; if jsonb_typeof(line)<>'object' or line->>'kind' is null or line->>'kind' not in('product','service','free_concept') or not erp.is_finite_numeric_text(line->>'quantity') or not erp.is_finite_numeric_text(line->>'unit_price') or not erp.is_finite_numeric_text(line->>'tax_rate_percent') then raise exception using errcode='invalid_parameter_value',message=format('invalid quote line %s',n); end if;
    begin
      line_kind:=(line->>'kind')::erp.sale_line_kind; q:=(line->>'quantity')::numeric; price:=(line->>'unit_price')::numeric; tax_rate:=(line->>'tax_rate_percent')::numeric;
      product_id:=nullif(line->>'product_id','')::uuid; variant_id:=nullif(line->>'variant_id','')::uuid; inventory_unit_id:=nullif(line->>'inventory_unit_id','')::uuid;
    exception when others then raise exception using errcode='invalid_parameter_value',message=format('invalid quote line %s',n); end;
    if line_kind='product' then
      select p.inventory_tracking into tracking_mode from erp.products p where p.id=product_id and p.organization_id=org_id and p.item_kind='product' and p.can_use_as_repair_part and p.is_active;
      if tracking_mode is null then raise exception using errcode='foreign_key_violation',message=format('active repair-part product unavailable on quote line %s',n); end if;
      if tracking_mode='quantity' then
        if inventory_unit_id is not null then raise exception using errcode='invalid_parameter_value',message=format('quantity repair-part quote line %s cannot reference an inventory unit',n); end if;
        select b.weighted_average_cost into cost from erp.inventory_cost_balances b
        where b.organization_id=org_id and b.branch_id=branch and b.product_id=product_id
          and b.variant_key=coalesce(variant_id,'00000000-0000-0000-0000-000000000000'::uuid) and b.valued_quantity>0;
      else
        if inventory_unit_id is null then raise exception using errcode='invalid_parameter_value',message=format('serialized repair-part quote line %s requires an inventory unit',n); end if;
        if q<>1 then raise exception using errcode='invalid_parameter_value',message=format('serialized repair-part quote line %s must have quantity one',n); end if;
        select coalesce(sc.acquisition_cost_base,u.acquisition_cost) into cost
        from erp.inventory_units u join erp.locations location on location.id=u.current_location_id and location.organization_id=u.organization_id
        left join erp.serialized_acquisition_costs sc on sc.inventory_unit_id=u.id and sc.organization_id=u.organization_id
        where u.id=inventory_unit_id and u.organization_id=org_id and u.product_id=product_id
          and u.variant_id is not distinct from variant_id and u.is_active and u.status='available' and location.branch_id=branch;
      end if;
      if cost is null then raise exception using errcode='object_not_in_prerequisite_state',message=format('authoritative repair-part cost unavailable on quote line %s',n); end if;
    else
      if not erp.has_permission('costs.manage',branch) or not erp.is_finite_numeric_text(line->>'unit_cost') then raise exception using errcode='insufficient_privilege',message='costs.manage is required for editable labor or free-concept costs'; end if;
      cost:=(line->>'unit_cost')::numeric;
    end if;
    if q<=0 or price<0 or not erp.is_finite_numeric_text(cost::text) or cost<0 or tax_rate<0 or tax_rate>100 or nullif(btrim(line->>'description'),'') is null then raise exception using errcode='invalid_parameter_value',message=format('invalid quote line %s',n); end if;
    tax:=round(round(q*price,4)*tax_rate/100,4); subtotal:=subtotal+round(q*price,4); tax_total:=tax_total+tax;
    normalized_lines:=normalized_lines||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('line_number',n,'kind',line_kind,'product_id',product_id,'variant_id',variant_id,'inventory_unit_id',inventory_unit_id,'description',btrim(line->>'description'),'quantity',q,'unit_price',price,'unit_cost_snapshot',cost,'tax_rate_percent',tax_rate,'tax_amount',tax,'line_total',round(q*price,4)+tax)));
  end loop;
  insert into erp.repair_quotes(organization_id,branch_id,repair_order_id,version,currency_code,exchange_snapshot_id,exchange_rate,subtotal_amount,tax_amount,total_amount,supersedes_quote_id,created_by) values(org_id,branch,target_repair_order_id,version_no,upper(btrim(quote_currency)),target_exchange_snapshot_id,rate,subtotal,tax_total,subtotal+tax_total,prior,auth.uid()) returning id into quote_id;
  update erp.repair_quote_response_tokens token set revoked_at=clock_timestamp()
  from erp.repair_quotes old_quote where token.quote_id=old_quote.id and old_quote.repair_order_id=target_repair_order_id
    and old_quote.id<>quote_id and token.used_at is null and token.revoked_at is null;
  for line in select value from jsonb_array_elements(normalized_lines) loop
    insert into erp.repair_quote_lines(organization_id,quote_id,line_number,kind,product_id,variant_id,inventory_unit_id,description,quantity,unit_price,unit_cost_snapshot,tax_rate_percent,tax_amount,line_total)
    values(org_id,quote_id,(line->>'line_number')::integer,(line->>'kind')::erp.sale_line_kind,nullif(line->>'product_id','')::uuid,nullif(line->>'variant_id','')::uuid,nullif(line->>'inventory_unit_id','')::uuid,line->>'description',(line->>'quantity')::numeric,(line->>'unit_price')::numeric,(line->>'unit_cost_snapshot')::numeric,(line->>'tax_rate_percent')::numeric,(line->>'tax_amount')::numeric,(line->>'line_total')::numeric);
  end loop;
  perform erp.complete_repair_command(cmd.id,quote_id); return quote_id;
end; $$;

create or replace function erp.issue_repair_quote(target_quote_id uuid,expires_at timestamptz,operation_key text,operation_reason text)
returns table(quote_id uuid,response_token text) language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare org_id uuid:=erp.current_organization_id(); declare quote_row erp.repair_quotes%rowtype; declare cmd erp.repair_commands%rowtype; declare raw text;
begin
  select * into quote_row from erp.repair_quotes where id=target_quote_id and organization_id=org_id;
  if quote_row.id is null or not erp.has_permission('quotes.manage',quote_row.branch_id) then raise exception using errcode='insufficient_privilege',message='quotes.manage permission is required'; end if;
  perform 1 from erp.repair_orders where id=quote_row.repair_order_id and organization_id=org_id for update;
  select * into quote_row from erp.repair_quotes where id=target_quote_id and organization_id=org_id for update;
  cmd:=erp.claim_repair_command('repair.quote.issue',org_id,quote_row.branch_id,operation_key,jsonb_build_object('quote_id',target_quote_id,'expires_at',expires_at,'reason',operation_reason));
  if cmd.result_id is not null then raise exception using errcode='object_not_in_prerequisite_state',message='quote token was already returned; reissue it to recover access'; end if;
  if expires_at is null then raise exception using errcode='invalid_parameter_value',message='quote token expiry is required'; end if;
  if quote_row.issued_at is not null or expires_at<=now() or expires_at>now()+interval '7 days' or exists(select 1 from erp.repair_quotes newer where newer.repair_order_id=quote_row.repair_order_id and newer.version>quote_row.version) then raise exception using errcode='object_not_in_prerequisite_state',message='only latest draft quote can be issued for at most seven days'; end if;
  perform set_config('erp.allow_quote_issue','on',true); update erp.repair_quotes set issued_at=clock_timestamp(),expires_at=issue_repair_quote.expires_at where id=target_quote_id; perform set_config('erp.allow_quote_issue','off',true);
  raw:=encode(extensions.gen_random_bytes(32),'hex'); insert into erp.repair_quote_response_tokens(organization_id,branch_id,quote_id,token_digest,expires_at) values(org_id,quote_row.branch_id,target_quote_id,encode(extensions.digest(convert_to(raw,'UTF8'),'sha256'),'hex'),expires_at);
  perform erp.complete_repair_command(cmd.id,target_quote_id); quote_id:=target_quote_id; response_token:=raw; return next;
end; $$;

create or replace function erp.reissue_repair_quote_token(target_quote_id uuid,new_expires_at timestamptz,operation_reason text)
returns table(quote_id uuid,response_token text) language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare org_id uuid:=erp.current_organization_id(); declare quote_row erp.repair_quotes%rowtype; declare raw text;
begin
  select * into quote_row from erp.repair_quotes where id=target_quote_id and organization_id=org_id;
  if quote_row.id is null or not erp.has_permission('quotes.manage',quote_row.branch_id) then raise exception using errcode='insufficient_privilege',message='quotes.manage permission is required'; end if;
  perform 1 from erp.repair_orders where id=quote_row.repair_order_id and organization_id=org_id for update;
  if new_expires_at is null then raise exception using errcode='invalid_parameter_value',message='quote token expiry is required'; end if;
  if quote_row.issued_at is null or quote_row.expires_at<=now() or new_expires_at<=now() or new_expires_at>quote_row.expires_at or new_expires_at>now()+interval '7 days' or nullif(btrim(operation_reason),'') is null
    or quote_row.id<>(select q.id from erp.repair_quotes q where q.repair_order_id=quote_row.repair_order_id order by q.version desc limit 1)
    or exists(select 1 from erp.repair_quote_response_events where repair_order_id=quote_row.repair_order_id) then raise exception using errcode='object_not_in_prerequisite_state',message='only undecided latest quote tokens can be reissued for at most seven days'; end if;
  update erp.repair_quote_response_tokens set revoked_at=clock_timestamp() where quote_id=target_quote_id and used_at is null and revoked_at is null;
  raw:=encode(extensions.gen_random_bytes(32),'hex');
  insert into erp.repair_quote_response_tokens(organization_id,branch_id,quote_id,token_digest,expires_at)
  values(org_id,quote_row.branch_id,target_quote_id,encode(extensions.digest(convert_to(raw,'UTF8'),'sha256'),'hex'),new_expires_at);
  insert into erp.audit_events(organization_id,branch_id,actor_user_id,schema_name,table_name,record_id,action,reason,metadata)
  values(org_id,quote_row.branch_id,auth.uid(),'erp','repair_quote_response_tokens',target_quote_id::text,'execute',operation_reason,jsonb_build_object('reissued',true));
  quote_id:=target_quote_id; response_token:=raw; return next;
end; $$;

create or replace function public.respond_repair_quote(response_token text,decision text,customer_message text default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare token_row erp.repair_quote_response_tokens%rowtype; declare quote_row erp.repair_quotes%rowtype; declare event_id uuid;
begin
  if response_token is null or response_token!~'^[0-9a-f]{64}$' or decision is null or decision not in('approved','rejected') or length(coalesce(customer_message,''))>2000 then raise exception using errcode='invalid_parameter_value',message='valid quote response is required'; end if;
  select * into token_row from erp.repair_quote_response_tokens where token_digest=encode(extensions.digest(convert_to(response_token,'UTF8'),'sha256'),'hex');
  if token_row.id is null or token_row.used_at is not null or token_row.revoked_at is not null or token_row.expires_at<=now() then raise exception using errcode='object_not_in_prerequisite_state',message='quote response token is unavailable'; end if;
  select * into quote_row from erp.repair_quotes where id=token_row.quote_id and organization_id=token_row.organization_id;
  perform 1 from erp.repair_orders where id=quote_row.repair_order_id and organization_id=quote_row.organization_id for update;
  select * into token_row from erp.repair_quote_response_tokens where id=token_row.id for update;
  if token_row.used_at is not null or token_row.revoked_at is not null or token_row.expires_at<=now()
    or quote_row.issued_at is null or quote_row.expires_at<=now()
    or quote_row.id<>(select q.id from erp.repair_quotes q where q.repair_order_id=quote_row.repair_order_id order by q.version desc limit 1)
    or exists(select 1 from erp.repair_quote_response_events where repair_order_id=quote_row.repair_order_id) then raise exception using errcode='object_not_in_prerequisite_state',message='quote response token is unavailable'; end if;
  update erp.repair_quote_response_tokens set used_at=clock_timestamp() where id=token_row.id;
  insert into erp.repair_quote_response_events(organization_id,branch_id,repair_order_id,quote_id,token_id,decision,customer_message) values(token_row.organization_id,token_row.branch_id,quote_row.repair_order_id,token_row.quote_id,token_row.id,decision::erp.repair_quote_decision,nullif(btrim(customer_message),'')) returning id into event_id; return event_id;
end; $$;

create or replace function erp.get_repair_quote_costs(target_quote_id uuid)
returns table(line_id uuid,line_number integer,unit_cost_snapshot numeric) language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); declare branch uuid;
begin
  select branch_id into branch from erp.repair_quotes where id=target_quote_id and organization_id=org_id;
  if branch is null or not erp.has_permission('quotes.view',branch) or not erp.has_permission('costs.view',branch) then raise exception using errcode='insufficient_privilege',message='quotes.view and costs.view are required'; end if;
  insert into erp.audit_events(organization_id,branch_id,actor_user_id,schema_name,table_name,record_id,action,metadata)
  values(org_id,branch,auth.uid(),'erp','repair_quote_lines',target_quote_id::text,'read_sensitive',jsonb_build_object('costs',true));
  return query select l.id,l.line_number,l.unit_cost_snapshot from erp.repair_quote_lines l where l.quote_id=target_quote_id and l.organization_id=org_id order by l.line_number;
end; $$;

create or replace function erp.reserve_repair_parts(target_repair_order_id uuid,expires_at timestamptz,lines jsonb,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); declare branch uuid; declare cmd erp.repair_commands%rowtype; declare batch uuid; declare event_id uuid;
begin
  select branch_id into branch from erp.repair_orders where id=target_repair_order_id and organization_id=org_id;
  if branch is null or not erp.has_permission('repairs.manage',branch) then raise exception using errcode='insufficient_privilege',message='repairs.manage permission is required'; end if;
  cmd:=erp.claim_repair_command('repair.parts.reserve',org_id,branch,operation_key,jsonb_build_object('order_id',target_repair_order_id,'expires_at',expires_at,'lines',lines,'reason',operation_reason)); if cmd.result_id is not null then return (select reservation_batch_id from erp.repair_part_events where id=cmd.result_id); end if;
  batch:=erp.create_stock_reservation(branch,operation_key||':stock','repair',target_repair_order_id,expires_at,lines);
  insert into erp.repair_part_events(organization_id,branch_id,repair_order_id,action,reservation_batch_id,actor_id) values(org_id,branch,target_repair_order_id,'reserved',batch,auth.uid()) returning id into event_id; perform erp.complete_repair_command(cmd.id,event_id); return batch;
end; $$;

create or replace function erp.release_repair_parts(target_repair_order_id uuid,target_batch_id uuid,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); declare branch uuid; declare cmd erp.repair_commands%rowtype; declare event_id uuid;
begin
  select branch_id into branch from erp.repair_orders where id=target_repair_order_id and organization_id=org_id;
  if branch is null or not erp.has_permission('repairs.manage',branch) or not exists(select 1 from erp.stock_reservation_batches where id=target_batch_id and organization_id=org_id and branch_id=branch and source_type='repair' and source_id=target_repair_order_id) then raise exception using errcode='insufficient_privilege',message='owned repair reservation is required'; end if;
  cmd:=erp.claim_repair_command('repair.parts.release',org_id,branch,operation_key,jsonb_build_object('order_id',target_repair_order_id,'batch_id',target_batch_id,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  perform erp.release_stock_reservation(target_batch_id,operation_reason); insert into erp.repair_part_events(organization_id,branch_id,repair_order_id,action,reservation_batch_id,actor_id) values(org_id,branch,target_repair_order_id,'released',target_batch_id,auth.uid()) returning id into event_id; perform erp.complete_repair_command(cmd.id,event_id); return event_id;
end; $$;

create or replace function erp.consume_repair_parts(target_repair_order_id uuid,target_batch_id uuid,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); declare branch uuid; declare cmd erp.repair_commands%rowtype; declare document uuid; declare event_id uuid; declare consumption_lines jsonb;
begin
  select branch_id into branch from erp.repair_orders where id=target_repair_order_id and organization_id=org_id for update;
  if branch is null or not erp.has_permission('repairs.manage',branch) then raise exception using errcode='insufficient_privilege',message='repairs.manage permission is required'; end if;
  cmd:=erp.claim_repair_command('repair.parts.consume',org_id,branch,operation_key,jsonb_build_object('order_id',target_repair_order_id,'batch_id',target_batch_id,'reason',operation_reason)); if cmd.result_id is not null then return (select stock_document_id from erp.repair_part_events where id=cmd.result_id); end if;
  perform pg_advisory_xact_lock(hashtextextended(org_id::text||':'||branch::text,0));
  perform 1 from erp.stock_reservation_batches where id=target_batch_id and organization_id=org_id and branch_id=branch and source_type='repair' and source_id=target_repair_order_id and status='active' for update;
  if not found then raise exception using errcode='object_not_in_prerequisite_state',message='active owned repair reservation is required'; end if;
  select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'product_id',r.product_id,'variant_id',r.variant_id,'inventory_unit_id',r.inventory_unit_id,
    'from_location_id',r.location_id,'quantity',r.quantity
  )) order by r.location_id,r.product_id,r.id) into consumption_lines
  from erp.stock_reservations r where r.batch_id=target_batch_id and r.organization_id=org_id;
  if consumption_lines is null then raise exception using errcode='data_exception',message='repair reservation has no lines'; end if;
  perform erp.release_stock_reservation(target_batch_id,operation_reason||' (consume release)');
  document:=erp.post_stock_document('repair_consumption',branch,operation_key||':stock',operation_reason,consumption_lines,false,'repair',target_repair_order_id);
  insert into erp.repair_part_events(organization_id,branch_id,repair_order_id,action,reservation_batch_id,stock_document_id,actor_id) values(org_id,branch,target_repair_order_id,'consumed',target_batch_id,document,auth.uid()) returning id into event_id; perform erp.complete_repair_command(cmd.id,event_id); return document;
end; $$;

create or replace function erp.reverse_repair_part_consumption(target_repair_order_id uuid,target_stock_document_id uuid,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); declare branch uuid; declare original_event uuid; declare cmd erp.repair_commands%rowtype; declare document uuid; declare event_id uuid;
begin
  select branch_id into branch from erp.repair_orders where id=target_repair_order_id and organization_id=org_id for update;
  select id into original_event from erp.repair_part_events where repair_order_id=target_repair_order_id and stock_document_id=target_stock_document_id and action='consumed';
  if branch is null or original_event is null or not erp.has_permission('repairs.manage',branch) or not erp.has_permission('stock.adjust',branch) then raise exception using errcode='insufficient_privilege',message='repair and stock reversal permissions are required'; end if;
  cmd:=erp.claim_repair_command('repair.parts.reverse',org_id,branch,operation_key,jsonb_build_object('order_id',target_repair_order_id,'document_id',target_stock_document_id,'reason',operation_reason)); if cmd.result_id is not null then return (select stock_document_id from erp.repair_part_events where id=cmd.result_id); end if;
  document:=erp.reverse_stock_document(target_stock_document_id,operation_key||':stock',operation_reason); insert into erp.repair_part_events(organization_id,branch_id,repair_order_id,action,stock_document_id,reverses_event_id,actor_id) values(org_id,branch,target_repair_order_id,'consumption_reversed',document,original_event,auth.uid()) returning id into event_id; perform erp.complete_repair_command(cmd.id,event_id); return document;
end; $$;

create or replace function erp.record_repair_labor(target_repair_order_id uuid,description text,quantity_hours numeric,unit_cost_base numeric,operation_key text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); declare branch uuid; declare cmd erp.repair_commands%rowtype; declare fact_id uuid;
begin
  select branch_id into branch from erp.repair_orders where id=target_repair_order_id and organization_id=org_id;
  if branch is null or not erp.has_permission('repairs.manage',branch) or not erp.has_permission('costs.manage',branch) then raise exception using errcode='insufficient_privilege',message='repair and cost permissions are required'; end if;
  if quantity_hours is null or quantity_hours='NaN'::numeric or quantity_hours<=0 or unit_cost_base is null or unit_cost_base='NaN'::numeric or unit_cost_base<0 then raise exception using errcode='invalid_parameter_value',message='finite labor values are required'; end if;
  cmd:=erp.claim_repair_command('repair.labor.record',org_id,branch,operation_key,jsonb_build_object('order_id',target_repair_order_id,'description',description,'hours',quantity_hours,'unit_cost',unit_cost_base)); if cmd.result_id is not null then return cmd.result_id; end if;
  insert into erp.repair_labor_facts(organization_id,branch_id,repair_order_id,description,quantity_hours,unit_cost_base,performed_by) values(org_id,branch,target_repair_order_id,description,quantity_hours,unit_cost_base,auth.uid()) returning id into fact_id; perform erp.complete_repair_command(cmd.id,fact_id); return fact_id;
end; $$;

create or replace function erp.record_repair_payment(target_repair_order_id uuid,target_payment_method_id uuid,target_cash_session_id uuid,payment_amount numeric,payment_currency text,target_exchange_snapshot_id uuid,operation_key text,operation_reason text,provider_reference text default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); declare branch uuid; declare rate numeric; declare requires_cash boolean; declare cmd erp.repair_commands%rowtype; declare payment_id uuid;
begin
  select branch_id into branch from erp.repair_orders where id=target_repair_order_id and organization_id=org_id for update;
  if branch is null or not erp.has_permission('repairs.manage',branch) then raise exception using errcode='insufficient_privilege',message='repairs.manage permission is required'; end if;
  if payment_amount is null or payment_amount='NaN'::numeric or payment_amount<=0 then raise exception using errcode='invalid_parameter_value',message='positive finite payment is required'; end if;
  select rate_to_base into rate from erp.exchange_rate_snapshots where id=target_exchange_snapshot_id and organization_id=org_id and quote_currency=upper(btrim(payment_currency)); if rate is null then raise exception using errcode='foreign_key_violation',message='matching exchange snapshot not found'; end if;
  select requires_cash_session into requires_cash from erp.payment_methods where id=target_payment_method_id and organization_id=org_id and is_active; if requires_cash is null or (requires_cash and target_cash_session_id is null) or (not requires_cash and target_cash_session_id is not null) then raise exception using errcode='check_violation',message='payment cash session does not match its payment method'; end if;
  if target_cash_session_id is not null then perform pg_advisory_xact_lock(hashtextextended(org_id::text||':cash-session:'||target_cash_session_id::text,0)); if exists(select 1 from erp.cash_closures where cash_session_id=target_cash_session_id) or not exists(select 1 from erp.cash_sessions s join erp.cash_session_opening_counts o on o.cash_session_id=s.id and o.organization_id=s.organization_id and o.branch_id=s.branch_id where s.id=target_cash_session_id and s.organization_id=org_id and s.branch_id=branch and o.currency_code=upper(btrim(payment_currency))) then raise exception using errcode='object_not_in_prerequisite_state',message='open same-branch cash session with payment currency is required'; end if; end if;
  cmd:=erp.claim_repair_command('repair.payment.record',org_id,branch,operation_key,jsonb_build_object('order_id',target_repair_order_id,'method_id',target_payment_method_id,'session_id',target_cash_session_id,'amount',payment_amount,'currency',upper(btrim(payment_currency)),'snapshot_id',target_exchange_snapshot_id,'reason',operation_reason,'provider_reference',provider_reference)); if cmd.result_id is not null then return cmd.result_id; end if;
  perform set_config('erp.operation_reason',operation_reason,true); insert into erp.payments(organization_id,branch_id,repair_order_id,payment_method_id,cash_session_id,currency_code,amount,amount_base,provider_reference,idempotency_key,request_hash,reason,actor_id) values(org_id,branch,target_repair_order_id,target_payment_method_id,target_cash_session_id,upper(btrim(payment_currency)),payment_amount,round(payment_amount*rate,4),nullif(btrim(provider_reference),''),operation_key,cmd.request_hash,operation_reason,auth.uid()) returning id into payment_id;
  if requires_cash then insert into erp.cash_movements(organization_id,branch_id,cash_session_id,kind,currency_code,amount,payment_id,idempotency_key,request_hash,reason,actor_id) values(org_id,branch,target_cash_session_id,'payment',upper(btrim(payment_currency)),payment_amount,payment_id,operation_key||':cash',cmd.request_hash,operation_reason,auth.uid()); end if;
  perform erp.complete_repair_command(cmd.id,payment_id); return payment_id;
end; $$;

create or replace function erp.reverse_repair_payment(target_payment_id uuid,operation_key text,operation_reason text,target_refund_cash_session_id uuid default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); declare original erp.payments%rowtype; declare original_cash erp.cash_movements%rowtype; declare refund_session uuid; declare cmd erp.repair_commands%rowtype; declare reversal_id uuid;
begin
  select * into original from erp.payments where id=target_payment_id and organization_id=org_id and repair_order_id is not null for update;
  if original.id is null or original.reversal_of_payment_id is not null or not erp.has_permission('repairs.manage',original.branch_id) then raise exception using errcode='object_not_in_prerequisite_state',message='reversible repair payment not found'; end if;
  cmd:=erp.claim_repair_command('repair.payment.reverse',org_id,original.branch_id,operation_key,jsonb_build_object('payment_id',target_payment_id,'reason',operation_reason,'refund_session_id',target_refund_cash_session_id)); if cmd.result_id is not null then return cmd.result_id; end if;
  select * into original_cash from erp.cash_movements where payment_id=original.id; if original_cash.id is not null then refund_session:=original_cash.cash_session_id; if exists(select 1 from erp.cash_closures where cash_session_id=refund_session) then refund_session:=target_refund_cash_session_id; end if; if refund_session is null then raise exception using errcode='object_not_in_prerequisite_state',message='an open refund cash session is required'; end if; perform pg_advisory_xact_lock(hashtextextended(org_id::text||':cash-session:'||refund_session::text,0)); if exists(select 1 from erp.cash_closures where cash_session_id=refund_session) or not exists(select 1 from erp.cash_sessions s join erp.cash_session_opening_counts o on o.cash_session_id=s.id and o.organization_id=s.organization_id and o.branch_id=s.branch_id where s.id=refund_session and s.organization_id=org_id and s.branch_id=original.branch_id and o.currency_code=original.currency_code) then raise exception using errcode='object_not_in_prerequisite_state',message='open same-branch refund session with payment currency is required'; end if; end if;
  perform set_config('erp.operation_reason',operation_reason,true); insert into erp.payments(organization_id,branch_id,repair_order_id,payment_method_id,cash_session_id,currency_code,amount,amount_base,reversal_of_payment_id,idempotency_key,request_hash,reason,actor_id) values(original.organization_id,original.branch_id,original.repair_order_id,original.payment_method_id,refund_session,original.currency_code,-original.amount,-original.amount_base,original.id,operation_key,cmd.request_hash,operation_reason,auth.uid()) returning id into reversal_id;
  if original_cash.id is not null then insert into erp.cash_movements(organization_id,branch_id,cash_session_id,kind,currency_code,amount,payment_id,reversal_of_movement_id,idempotency_key,request_hash,reason,actor_id) values(org_id,original.branch_id,refund_session,'refund',original.currency_code,-original_cash.amount,reversal_id,original_cash.id,operation_key||':cash',cmd.request_hash,operation_reason,auth.uid()); end if;
  perform erp.complete_repair_command(cmd.id,reversal_id); return reversal_id;
end; $$;

create or replace function erp.create_repair_media_upload_token(target_repair_order_id uuid,expires_at timestamptz,max_file_count integer,max_total_bytes bigint,allowed_mime_types text[],operation_key text)
returns table(upload_token_id uuid,upload_token text) language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare org_id uuid:=erp.current_organization_id(); declare branch uuid; declare cmd erp.repair_commands%rowtype; declare raw text;
begin
  select branch_id into branch from erp.repair_orders where id=target_repair_order_id and organization_id=org_id;
  if branch is null or not erp.has_permission('repairs.manage',branch) then raise exception using errcode='insufficient_privilege',message='repairs.manage permission is required'; end if;
  if expires_at is null or expires_at<=now() or expires_at>now()+interval '24 hours' or max_file_count is null or max_file_count not between 1 and 100 or max_total_bytes is null or max_total_bytes<=0 or max_total_bytes>1073741824 or allowed_mime_types is null or cardinality(allowed_mime_types)=0 or cardinality(allowed_mime_types)>20 or exists(select 1 from unnest(allowed_mime_types) mime where mime is null or mime not in('image/jpeg','image/png','image/webp','video/mp4')) then raise exception using errcode='invalid_parameter_value',message='bounded media token policy and TTL within 24 hours are required'; end if;
  cmd:=erp.claim_repair_command('repair.media.token.create',org_id,branch,operation_key,jsonb_build_object('order_id',target_repair_order_id,'expires_at',expires_at,'max_files',max_file_count,'max_bytes',max_total_bytes,'mime_types',allowed_mime_types)); if cmd.result_id is not null then raise exception using errcode='object_not_in_prerequisite_state',message='media token was already returned; reissue it to recover access'; end if;
  raw:=encode(extensions.gen_random_bytes(32),'hex'); insert into erp.repair_media_upload_tokens(organization_id,branch_id,repair_order_id,token_digest,expires_at,max_file_count,max_total_bytes,allowed_mime_types,created_by) values(org_id,branch,target_repair_order_id,encode(extensions.digest(convert_to(raw,'UTF8'),'sha256'),'hex'),expires_at,max_file_count,max_total_bytes,allowed_mime_types,auth.uid()) returning id into upload_token_id; perform erp.complete_repair_command(cmd.id,upload_token_id); upload_token:=raw; return next;
end; $$;

create or replace function erp.reissue_repair_media_upload_token(target_upload_token_id uuid,new_expires_at timestamptz,operation_reason text)
returns table(upload_token_id uuid,upload_token text) language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare org_id uuid:=erp.current_organization_id(); declare old_token erp.repair_media_upload_tokens%rowtype; declare raw text;
begin
  select * into old_token from erp.repair_media_upload_tokens where id=target_upload_token_id and organization_id=org_id for update;
  if old_token.id is null or not erp.has_permission('repairs.manage',old_token.branch_id) then raise exception using errcode='insufficient_privilege',message='repairs.manage permission is required'; end if;
  perform 1 from erp.repair_orders where id=old_token.repair_order_id and organization_id=org_id for update;
  if new_expires_at is null then raise exception using errcode='invalid_parameter_value',message='media token expiry is required'; end if;
  if old_token.revoked_at is not null or old_token.expires_at<=now() or new_expires_at<=now() or new_expires_at>now()+interval '24 hours' or nullif(btrim(operation_reason),'') is null then raise exception using errcode='object_not_in_prerequisite_state',message='active token and TTL within 24 hours are required'; end if;
  perform set_config('erp.allow_media_token_revocation','on',true);
  update erp.repair_media_upload_tokens set revoked_at=clock_timestamp() where id=old_token.id;
  perform set_config('erp.allow_media_token_revocation','off',true);
  raw:=encode(extensions.gen_random_bytes(32),'hex');
  insert into erp.repair_media_upload_tokens(token_family_id,organization_id,branch_id,repair_order_id,token_digest,expires_at,max_file_count,max_total_bytes,allowed_mime_types,created_by)
  values(old_token.token_family_id,org_id,old_token.branch_id,old_token.repair_order_id,encode(extensions.digest(convert_to(raw,'UTF8'),'sha256'),'hex'),new_expires_at,old_token.max_file_count,old_token.max_total_bytes,old_token.allowed_mime_types,auth.uid()) returning id into upload_token_id;
  insert into erp.audit_events(organization_id,branch_id,actor_user_id,schema_name,table_name,record_id,action,reason,metadata)
  values(org_id,old_token.branch_id,auth.uid(),'erp','repair_media_upload_tokens',upload_token_id::text,'execute',operation_reason,jsonb_build_object('reissued_from',old_token.id));
  upload_token:=raw; return next;
end; $$;

create or replace function erp.revoke_repair_media_upload_token(target_upload_token_id uuid,operation_reason text)
returns void language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); declare branch uuid;
begin
  select branch_id into branch from erp.repair_media_upload_tokens where id=target_upload_token_id and organization_id=org_id for update;
  if branch is null or not erp.has_permission('repairs.manage',branch) then raise exception using errcode='insufficient_privilege',message='repairs.manage permission is required'; end if;
  if nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='revocation reason is required'; end if;
  perform set_config('erp.allow_media_token_revocation','on',true);
  update erp.repair_media_upload_tokens set revoked_at=clock_timestamp() where id=target_upload_token_id and revoked_at is null;
  if not found then raise exception using errcode='object_not_in_prerequisite_state',message='upload token is already revoked'; end if;
  perform set_config('erp.allow_media_token_revocation','off',true);
  insert into erp.audit_events(organization_id,branch_id,actor_user_id,schema_name,table_name,record_id,action,reason,metadata)
  values(org_id,branch,auth.uid(),'erp','repair_media_upload_tokens',target_upload_token_id::text,'execute',operation_reason,jsonb_build_object('revoked',true));
end; $$;

create or replace function erp.record_repair_label_event(target_repair_order_id uuid,template_code text,copies integer,printer_snapshot text,operation_key text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); declare branch uuid; declare cmd erp.repair_commands%rowtype; declare event_id uuid;
begin
  select branch_id into branch from erp.repair_orders where id=target_repair_order_id and organization_id=org_id;
  if branch is null or not erp.has_permission('repairs.view',branch) or not erp.has_permission('labels.print',branch) then raise exception using errcode='insufficient_privilege',message='repair view and label print permissions are required'; end if;
  cmd:=erp.claim_repair_command('repair.label.record',org_id,branch,operation_key,jsonb_build_object('order_id',target_repair_order_id,'template',template_code,'copies',copies,'printer',printer_snapshot)); if cmd.result_id is not null then return cmd.result_id; end if;
  insert into erp.repair_label_events(organization_id,branch_id,repair_order_id,template_code,copies,printer_snapshot,printed_by) values(org_id,branch,target_repair_order_id,template_code,copies,printer_snapshot,auth.uid()) returning id into event_id;
  perform erp.complete_repair_command(cmd.id,event_id); return event_id;
end; $$;

create or replace function public.register_repair_private_media(upload_token text,file_slot integer,client_filename text,mime_type text,byte_size bigint,sha256_digest text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare token_row erp.repair_media_upload_tokens%rowtype; declare media_id uuid; declare used_count bigint; declare used_bytes numeric; declare canonical_path text; declare extension text;
begin
  if upload_token is null or upload_token!~'^[0-9a-f]{64}$' or file_slot is null or file_slot not between 1 and 100
    or nullif(btrim(client_filename),'') is null or length(client_filename)>255 or mime_type is null or mime_type not in('image/jpeg','image/png','image/webp','video/mp4')
    or byte_size is null or byte_size<=0 or byte_size>1073741824 or sha256_digest is null or sha256_digest!~'^[0-9a-f]{64}$' then raise exception using errcode='invalid_parameter_value',message='bounded media metadata and a 256-bit token are required'; end if;
  select * into token_row from erp.repair_media_upload_tokens where token_digest=encode(extensions.digest(convert_to(upload_token,'UTF8'),'sha256'),'hex') for update;
  if token_row.id is null or token_row.revoked_at is not null or token_row.expires_at<=now() or mime_type<>all(token_row.allowed_mime_types) then raise exception using errcode='object_not_in_prerequisite_state',message='upload token or file metadata is invalid'; end if;
  select count(*),coalesce(sum(m.byte_size),0) into used_count,used_bytes
  from erp.repair_private_media m join erp.repair_media_upload_tokens family_token
    on family_token.id=m.upload_token_id and family_token.organization_id=m.organization_id
  where family_token.organization_id=token_row.organization_id and family_token.token_family_id=token_row.token_family_id;
  if used_count+1>token_row.max_file_count or used_bytes+byte_size>token_row.max_total_bytes then raise exception using errcode='check_violation',message='upload token limits exceeded'; end if;
  extension:=case mime_type when 'image/jpeg' then '.jpg' when 'image/png' then '.png' when 'image/webp' then '.webp' when 'video/mp4' then '.mp4' end;
  canonical_path:=format('repair-private/%s/%s/%s/%s%s',token_row.organization_id,token_row.repair_order_id,token_row.id,lpad(file_slot::text,3,'0'),extension);
  insert into erp.repair_private_media(organization_id,branch_id,repair_order_id,upload_token_id,file_slot,object_path,client_filename,mime_type,byte_size,sha256_digest) values(token_row.organization_id,token_row.branch_id,token_row.repair_order_id,token_row.id,file_slot,canonical_path,btrim(client_filename),mime_type,byte_size,sha256_digest) returning id into media_id; return media_id;
end; $$;

create or replace function public.get_repair_tracking(tracking_token text)
returns table(order_code text,status_code text,status_name text,public_message text,status_at timestamptz,opened_at timestamptz)
language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
begin
  if tracking_token is null or tracking_token!~'^[0-9a-f]{64}$' then raise exception using errcode='invalid_parameter_value',message='tracking token must be exactly 64 lowercase hexadecimal characters'; end if;
  return query select o.order_code,s.code,s.name,s.public_message,date_trunc('hour',e.occurred_at),date_trunc('day',o.opened_at)
  from erp.repair_tracking_tokens token join erp.repair_orders o on o.id=token.repair_order_id and o.organization_id=token.organization_id and o.branch_id=token.branch_id
  join lateral (select x.* from erp.repair_state_events x where x.repair_order_id=o.id and x.organization_id=o.organization_id order by x.event_sequence desc limit 1) e on true
  join erp.repair_statuses s on s.id=e.status_id and s.organization_id=e.organization_id
  where token.token_digest=encode(extensions.digest(convert_to(tracking_token,'UTF8'),'sha256'),'hex') and token.revoked_at is null and token.expires_at>now();
end;
$$;

create or replace function erp.rotate_repair_tracking_token(target_repair_order_id uuid,new_expires_at timestamptz,operation_reason text)
returns text language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare org_id uuid:=erp.current_organization_id(); declare branch uuid; declare raw text;
begin
  select branch_id into branch from erp.repair_orders where id=target_repair_order_id and organization_id=org_id for update;
  if branch is null or not erp.has_permission('repairs.manage',branch) then raise exception using errcode='insufficient_privilege',message='repairs.manage permission is required'; end if;
  if new_expires_at is null or new_expires_at<=now() or new_expires_at>now()+interval '365 days' or nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='tracking TTL must be within 365 days and include a reason'; end if;
  perform set_config('erp.allow_tracking_token_revocation','on',true);
  update erp.repair_tracking_tokens set revoked_at=clock_timestamp() where repair_order_id=target_repair_order_id and revoked_at is null;
  perform set_config('erp.allow_tracking_token_revocation','off',true);
  raw:=encode(extensions.gen_random_bytes(32),'hex');
  insert into erp.repair_tracking_tokens(organization_id,branch_id,repair_order_id,token_digest,expires_at,created_by) values(org_id,branch,target_repair_order_id,encode(extensions.digest(convert_to(raw,'UTF8'),'sha256'),'hex'),new_expires_at,auth.uid());
  insert into erp.audit_events(organization_id,branch_id,actor_user_id,schema_name,table_name,record_id,action,reason,metadata) values(org_id,branch,auth.uid(),'erp','repair_tracking_tokens',target_repair_order_id::text,'execute',operation_reason,jsonb_build_object('rotated',true));
  return raw;
end; $$;

create or replace function erp.revoke_repair_tracking_token(target_repair_order_id uuid,operation_reason text)
returns void language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); declare branch uuid;
begin
  select branch_id into branch from erp.repair_orders where id=target_repair_order_id and organization_id=org_id for update;
  if branch is null or not erp.has_permission('repairs.manage',branch) or nullif(btrim(operation_reason),'') is null then raise exception using errcode='insufficient_privilege',message='repairs.manage and revocation reason are required'; end if;
  perform set_config('erp.allow_tracking_token_revocation','on',true); update erp.repair_tracking_tokens set revoked_at=clock_timestamp() where repair_order_id=target_repair_order_id and revoked_at is null; perform set_config('erp.allow_tracking_token_revocation','off',true);
end; $$;

create or replace function erp.deliver_repair_order(target_repair_order_id uuid,recipient_name text,recipient_document_suffix text,signature_method text,signature_reference text,warranty_days integer,warranty_terms text,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); declare order_row erp.repair_orders%rowtype; declare latest erp.repair_statuses%rowtype; declare cmd erp.repair_commands%rowtype; declare delivery_id uuid; declare delivered_time timestamptz:=clock_timestamp();
begin
  select * into order_row from erp.repair_orders where id=target_repair_order_id and organization_id=org_id for update;
  select s into latest from erp.repair_state_events e join erp.repair_statuses s on s.id=e.status_id and s.organization_id=e.organization_id where e.repair_order_id=target_repair_order_id order by e.event_sequence desc limit 1;
  if order_row.id is null or not erp.has_permission('repairs.manage',order_row.branch_id) then raise exception using errcode='insufficient_privilege',message='repairs.manage permission is required'; end if;
  if not latest.is_terminal or latest.requires_final_tests and not erp.repair_latest_final_test_passes(target_repair_order_id,org_id) then raise exception using errcode='object_not_in_prerequisite_state',message='terminal status and latest passing final tests are required for delivery'; end if;
  if warranty_days is null or warranty_days<0 or warranty_days>3650 then raise exception using errcode='invalid_parameter_value',message='warranty days are invalid'; end if;
  cmd:=erp.claim_repair_command('repair.delivery.create',org_id,order_row.branch_id,operation_key,jsonb_build_object('order_id',target_repair_order_id,'recipient',recipient_name,'document_suffix',recipient_document_suffix,'signature_method',signature_method,'signature_reference',signature_reference,'warranty_days',warranty_days,'warranty_terms',warranty_terms,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  insert into erp.repair_deliveries(organization_id,branch_id,repair_order_id,recipient_name,recipient_document_suffix,signature_method,signature_reference,delivered_at,delivered_by) values(org_id,order_row.branch_id,target_repair_order_id,recipient_name,recipient_document_suffix,signature_method,signature_reference,delivered_time,auth.uid()) returning id into delivery_id;
  if warranty_days>0 then insert into erp.repair_warranties(organization_id,branch_id,repair_order_id,delivery_id,starts_at,ends_at,terms_snapshot,created_by) values(org_id,order_row.branch_id,target_repair_order_id,delivery_id,delivered_time,delivered_time+make_interval(days=>warranty_days),warranty_terms,auth.uid()); end if;
  perform erp.complete_repair_command(cmd.id,delivery_id); return delivery_id;
end; $$;

create or replace function erp.open_repair_warranty_claim(target_warranty_id uuid,reported_issue text,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare org_id uuid:=erp.current_organization_id(); declare warranty_row erp.repair_warranties%rowtype; declare cmd erp.repair_commands%rowtype; declare claim_id uuid;
begin
  select * into warranty_row from erp.repair_warranties where id=target_warranty_id and organization_id=org_id;
  if warranty_row.id is null or not erp.has_permission('warranties.manage',warranty_row.branch_id) then raise exception using errcode='insufficient_privilege',message='warranties.manage permission is required'; end if;
  if clock_timestamp()<warranty_row.starts_at or clock_timestamp()>warranty_row.ends_at then raise exception using errcode='object_not_in_prerequisite_state',message='warranty is not currently active'; end if;
  cmd:=erp.claim_repair_command('repair.warranty.claim',org_id,warranty_row.branch_id,operation_key,jsonb_build_object('warranty_id',target_warranty_id,'issue',reported_issue,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  insert into erp.repair_warranty_claims(organization_id,branch_id,warranty_id,claim_code,reported_issue,opened_by) values(org_id,warranty_row.branch_id,target_warranty_id,'WC-'||upper(substr(replace(extensions.gen_random_uuid()::text,'-',''),1,12)),reported_issue,auth.uid()) returning id into claim_id; perform erp.complete_repair_command(cmd.id,claim_id); return claim_id;
end; $$;

create or replace function erp.get_customer_equipment_identifiers(target_equipment_id uuid)
returns table(equipment_id uuid,serial_number text,imei text,normalized_serial_number text,normalized_imei text)
language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id();
begin
  if org_id is null or not erp.has_permission('repairs.view') or not erp.has_permission('repairs.view_identifiers') then raise exception using errcode='insufficient_privilege',message='repairs.view and repairs.view_identifiers are required'; end if;
  if not exists(select 1 from erp.customer_equipment where id=target_equipment_id and organization_id=org_id) then raise exception using errcode='no_data_found',message='customer equipment not found'; end if;
  insert into erp.audit_events(organization_id,actor_user_id,schema_name,table_name,record_id,action,metadata)
  values(org_id,auth.uid(),'erp','customer_equipment',target_equipment_id::text,'read_sensitive',jsonb_build_object('identifiers',true));
  return query select e.id,e.serial_number,e.imei,e.normalized_serial_number,e.normalized_imei from erp.customer_equipment e where e.id=target_equipment_id and e.organization_id=org_id;
end; $$;

create or replace function erp.protect_quote_header()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='UPDATE' and current_setting('erp.allow_quote_issue',true)='on' and old.issued_at is null and new.issued_at is not null and new.expires_at is not null and (to_jsonb(new)-'issued_at'-'expires_at')=(to_jsonb(old)-'issued_at'-'expires_at') then return new; end if;
  raise exception using errcode='integrity_constraint_violation',message='repair quotes are immutable';
end; $$;
create trigger repair_quotes_immutable before update or delete on erp.repair_quotes for each row execute function erp.protect_quote_header();

create or replace function erp.audit_repair_fact()
returns trigger language plpgsql security definer set search_path=pg_catalog,erp as $$
begin
  insert into erp.audit_events(organization_id,branch_id,actor_user_id,schema_name,table_name,record_id,action,reason,metadata)
  values(new.organization_id,nullif(to_jsonb(new)->>'branch_id','')::uuid,auth.uid(),tg_table_schema,tg_table_name,coalesce(to_jsonb(new)->>'id',to_jsonb(new)->>'repair_order_id'),'insert',nullif(current_setting('erp.operation_reason',true),''),jsonb_build_object('redacted',true,'trigger',tg_name)); return null;
end; $$;

do $$ declare table_name text; begin
  foreach table_name in array array[
    'repair_commands','customer_equipment','equipment_ownership_events','repair_statuses','repair_status_transitions','repair_number_counters','repair_orders','repair_tracking_tokens','repair_state_events','repair_assignment_events','repair_credential_keys','repair_credentials','repair_test_templates','repair_test_template_versions','repair_test_runs','repair_test_results','repair_quotes','repair_quote_lines','repair_quote_response_tokens','repair_quote_response_events','repair_part_events','repair_labor_facts','repair_media_upload_tokens','repair_private_media','repair_label_events','repair_deliveries','repair_warranties','repair_warranty_claims'
  ] loop execute format('alter table erp.%I enable row level security',table_name); end loop;
  foreach table_name in array array[
    'customer_equipment','equipment_ownership_events','repair_orders','repair_state_events','repair_assignment_events','repair_credentials','repair_test_runs','repair_test_results','repair_quotes','repair_quote_lines','repair_quote_response_tokens','repair_quote_response_events','repair_part_events','repair_labor_facts','repair_media_upload_tokens','repair_private_media','repair_label_events','repair_deliveries','repair_warranties','repair_warranty_claims'
  ] loop execute format('create trigger %I_audit after insert on erp.%I for each row execute function erp.audit_repair_fact()',table_name,table_name); end loop;
  foreach table_name in array array[
    'customer_equipment','equipment_ownership_events','repair_orders','repair_state_events','repair_assignment_events','repair_credentials','repair_test_runs','repair_test_results','repair_quote_lines','repair_quote_response_events','repair_part_events','repair_labor_facts','repair_private_media','repair_label_events','repair_deliveries','repair_warranties','repair_warranty_claims'
  ] loop if table_name<>'repair_orders' then execute format('create trigger %I_immutable before update or delete on erp.%I for each row execute function erp.prevent_fact_mutation()',table_name,table_name); else execute format('create trigger %I_immutable before update or delete on erp.%I for each row execute function erp.prevent_fact_mutation()',table_name,table_name); end if; end loop;
end $$;

create or replace function erp.protect_repair_test_template_version()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='UPDATE' and current_setting('erp.allow_seed_template_update',true)='on' then return new; end if;
  raise exception using errcode='integrity_constraint_violation',message='repair test template versions are immutable outside deterministic seed convergence';
end; $$;
create trigger repair_test_template_versions_immutable before update or delete on erp.repair_test_template_versions
for each row execute function erp.protect_repair_test_template_version();

create trigger repair_statuses_prevent_delete before delete on erp.repair_statuses
for each row execute function erp.prevent_delete();
create trigger repair_transitions_prevent_delete before delete on erp.repair_status_transitions
for each row execute function erp.prevent_delete();
create trigger repair_test_templates_prevent_delete before delete on erp.repair_test_templates
for each row execute function erp.prevent_delete();
create trigger repair_number_counters_prevent_delete before delete on erp.repair_number_counters
for each row execute function erp.prevent_delete();

-- Token lifecycle rows allow only tightly-scoped server commands to mark use/revocation.
create or replace function erp.protect_token_lifecycle()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='UPDATE' and (to_jsonb(new)-'used_at'-'revoked_at')=(to_jsonb(old)-'used_at'-'revoked_at') and old.used_at is null and old.revoked_at is null and num_nonnulls(new.used_at,new.revoked_at)=1 then return new; end if;
  raise exception using errcode='integrity_constraint_violation',message='token lifecycle is append-only';
end; $$;
create or replace function erp.protect_media_token_lifecycle()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='UPDATE' and current_setting('erp.allow_media_token_revocation',true)='on'
    and old.revoked_at is null and new.revoked_at is not null
    and (to_jsonb(new)-'revoked_at')=(to_jsonb(old)-'revoked_at') then return new; end if;
  raise exception using errcode='integrity_constraint_violation',message='media token lifecycle is append-only';
end; $$;
create or replace function erp.protect_tracking_token_lifecycle()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='UPDATE' and current_setting('erp.allow_tracking_token_revocation',true)='on'
    and old.revoked_at is null and new.revoked_at is not null
    and (to_jsonb(new)-'revoked_at')=(to_jsonb(old)-'revoked_at') then return new; end if;
  raise exception using errcode='integrity_constraint_violation',message='tracking token lifecycle is append-only';
end; $$;
create or replace function erp.protect_credential_key_lifecycle()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin
  if tg_op='UPDATE' and current_setting('erp.allow_credential_key_rotation',true)='on'
    and old.is_active and not new.is_active and old.rotated_at is null and new.rotated_at is not null
    and (to_jsonb(new)-'is_active'-'rotated_at')=(to_jsonb(old)-'is_active'-'rotated_at') then return new; end if;
  raise exception using errcode='integrity_constraint_violation',message='repair credential keys are append-only';
end; $$;
create trigger repair_quote_tokens_lifecycle before update or delete on erp.repair_quote_response_tokens for each row execute function erp.protect_token_lifecycle();
create trigger repair_media_tokens_lifecycle before update or delete on erp.repair_media_upload_tokens for each row execute function erp.protect_media_token_lifecycle();
create trigger repair_tracking_tokens_lifecycle before update or delete on erp.repair_tracking_tokens for each row execute function erp.protect_tracking_token_lifecycle();
create trigger repair_credential_keys_lifecycle before update or delete on erp.repair_credential_keys for each row execute function erp.protect_credential_key_lifecycle();

create policy repair_operational_select on erp.repair_orders for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('repairs.view',branch_id));
create policy repair_state_select on erp.repair_state_events for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('repairs.view',branch_id));
create policy repair_assignment_select on erp.repair_assignment_events for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('repairs.view',branch_id));
create policy repair_equipment_select on erp.customer_equipment for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('repairs.view'));
create policy repair_ownership_select on erp.equipment_ownership_events for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('repairs.view'));
create policy repair_config_select on erp.repair_statuses for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('repairs.view'));
create policy repair_transitions_select on erp.repair_status_transitions for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('repairs.view'));
create policy repair_test_templates_select on erp.repair_test_templates for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('repair_tests.view'));
create policy repair_test_versions_select on erp.repair_test_template_versions for select to authenticated using(organization_id=erp.current_organization_id() and exists(select 1 from erp.repair_test_templates t where t.id=template_id and t.organization_id=repair_test_template_versions.organization_id and erp.has_permission('repair_tests.view')));
create policy repair_tests_select on erp.repair_test_runs for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('repair_tests.view',branch_id));
create policy repair_test_results_select on erp.repair_test_results for select to authenticated using(organization_id=erp.current_organization_id() and exists(select 1 from erp.repair_test_runs r where r.id=test_run_id and r.organization_id=repair_test_results.organization_id and erp.has_permission('repair_tests.view',r.branch_id)));
create policy repair_quotes_select on erp.repair_quotes for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('quotes.view',branch_id));
create policy repair_quote_lines_select on erp.repair_quote_lines for select to authenticated using(organization_id=erp.current_organization_id() and exists(select 1 from erp.repair_quotes q where q.id=quote_id and q.organization_id=repair_quote_lines.organization_id and erp.has_permission('quotes.view',q.branch_id)));
create policy repair_parts_select on erp.repair_part_events for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('repairs.view',branch_id));
create policy repair_labor_select on erp.repair_labor_facts for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('costs.view',branch_id));
create policy repair_delivery_select on erp.repair_deliveries for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('repairs.view',branch_id));
create policy repair_warranty_select on erp.repair_warranties for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('warranties.view',branch_id));
create policy repair_claim_select on erp.repair_warranty_claims for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('warranties.view',branch_id));
create policy repair_labels_select on erp.repair_label_events for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('repairs.view',branch_id) and erp.has_permission('labels.print',branch_id));

drop policy payments_select on erp.payments;
create policy payments_select on erp.payments for select to authenticated using(
  organization_id=erp.current_organization_id() and (
    (sale_id is not null and erp.has_permission('sales.view',branch_id))
    or (repair_order_id is not null and erp.has_permission('repairs.view',branch_id))
  )
);

revoke all on
  erp.repair_commands,erp.customer_equipment,erp.equipment_ownership_events,erp.repair_statuses,
  erp.repair_status_transitions,erp.repair_number_counters,erp.repair_orders,erp.repair_state_events,
  erp.repair_tracking_tokens,erp.repair_assignment_events,erp.repair_credential_keys,erp.repair_credentials,erp.repair_test_templates,
  erp.repair_test_template_versions,erp.repair_test_runs,erp.repair_test_results,erp.repair_quotes,
  erp.repair_quote_lines,erp.repair_quote_response_tokens,erp.repair_quote_response_events,
  erp.repair_part_events,erp.repair_labor_facts,erp.repair_media_upload_tokens,erp.repair_private_media,
  erp.repair_label_events,erp.repair_deliveries,erp.repair_warranties,erp.repair_warranty_claims
from public,anon,authenticated,service_role;

grant select(id,organization_id,brand_id,model_id,equipment_type,brand_snapshot,model_snapshot,color_snapshot,notes,created_at,created_by)
  on erp.customer_equipment to authenticated,service_role;
grant select on erp.equipment_ownership_events,erp.repair_statuses,
  erp.repair_status_transitions,erp.repair_orders,erp.repair_state_events,erp.repair_assignment_events,
  erp.repair_test_templates,erp.repair_test_template_versions,erp.repair_test_runs,erp.repair_test_results,
  erp.repair_quotes,erp.repair_part_events,erp.repair_labor_facts,
  erp.repair_label_events,erp.repair_deliveries,erp.repair_warranties,erp.repair_warranty_claims
to authenticated,service_role;
grant select(id,organization_id,quote_id,line_number,kind,product_id,variant_id,inventory_unit_id,description,quantity,unit_price,tax_rate_percent,tax_amount,line_total)
  on erp.repair_quote_lines to authenticated,service_role;
grant select on erp.repair_commands,erp.repair_number_counters,erp.repair_quote_response_tokens,
  erp.repair_quote_response_events,erp.repair_tracking_tokens,erp.repair_media_upload_tokens,erp.repair_private_media to service_role;

revoke select on erp.payments from authenticated;
grant select(id,organization_id,branch_id,sale_id,repair_order_id,payment_method_id,cash_session_id,
  currency_code,amount,amount_base,reversal_of_payment_id,idempotency_key,request_hash,reason,occurred_at,actor_id)
on erp.payments to authenticated;

revoke all on sequence erp.equipment_ownership_events_event_sequence_seq,
  erp.repair_state_events_event_sequence_seq,
  erp.repair_assignment_events_event_sequence_seq,
  erp.repair_test_runs_run_sequence_seq
from public,anon,authenticated,service_role;

revoke all on function erp.claim_repair_command(text,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function erp.complete_repair_command(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function erp.protect_repair_command() from public,anon,authenticated,service_role;
revoke all on function erp.protect_quote_header() from public,anon,authenticated,service_role;
revoke all on function erp.protect_token_lifecycle() from public,anon,authenticated,service_role;
revoke all on function erp.protect_media_token_lifecycle() from public,anon,authenticated,service_role;
revoke all on function erp.protect_tracking_token_lifecycle() from public,anon,authenticated,service_role;
revoke all on function erp.protect_credential_key_lifecycle() from public,anon,authenticated,service_role;
revoke all on function erp.protect_repair_test_template_version() from public,anon,authenticated,service_role;
revoke all on function erp.audit_repair_fact() from public,anon,authenticated,service_role;
revoke all on function erp.repair_latest_final_test_passes(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function erp.provision_repair_credential_key(uuid,bytea,text) from public,anon,authenticated;
revoke all on function erp.rotate_repair_credentials(uuid,jsonb,text) from public,anon,service_role;
revoke all on function erp.get_repair_credentials(uuid) from public,anon,service_role;
revoke all on function erp.get_customer_equipment_identifiers(uuid) from public,anon,service_role;
revoke all on function erp.get_repair_quote_costs(uuid) from public,anon,service_role;
revoke all on function public.respond_repair_quote(text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.register_repair_private_media(text,integer,text,text,bigint,text) from public,anon,authenticated,service_role;
revoke all on function public.get_repair_tracking(text) from public,anon,authenticated,service_role;

revoke all on function erp.create_customer_equipment(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text) from public,anon,service_role;
revoke all on function erp.transfer_customer_equipment(uuid,uuid,uuid,text,text) from public,anon,service_role;
revoke all on function erp.create_repair_order(uuid,uuid,uuid,jsonb,text,text,text,text,text,text) from public,anon,service_role;
revoke all on function erp.transition_repair_order(uuid,uuid,text,text,text) from public,anon,service_role;
revoke all on function erp.assign_repair_order(uuid,uuid,text,text) from public,anon,service_role;
revoke all on function erp.record_repair_test_run(uuid,uuid,jsonb,text,text) from public,anon,service_role;
revoke all on function erp.create_repair_quote_version(uuid,text,uuid,jsonb,text,text) from public,anon,service_role;
revoke all on function erp.issue_repair_quote(uuid,timestamptz,text,text) from public,anon,service_role;
revoke all on function erp.reissue_repair_quote_token(uuid,timestamptz,text) from public,anon,service_role;
revoke all on function erp.reserve_repair_parts(uuid,timestamptz,jsonb,text,text) from public,anon,service_role;
revoke all on function erp.release_repair_parts(uuid,uuid,text,text) from public,anon,service_role;
revoke all on function erp.consume_repair_parts(uuid,uuid,text,text) from public,anon,service_role;
revoke all on function erp.reverse_repair_part_consumption(uuid,uuid,text,text) from public,anon,service_role;
revoke all on function erp.record_repair_labor(uuid,text,numeric,numeric,text) from public,anon,service_role;
revoke all on function erp.record_repair_payment(uuid,uuid,uuid,numeric,text,uuid,text,text,text) from public,anon,service_role;
revoke all on function erp.reverse_repair_payment(uuid,text,text,uuid) from public,anon,service_role;
revoke all on function erp.create_repair_media_upload_token(uuid,timestamptz,integer,bigint,text[],text) from public,anon,service_role;
revoke all on function erp.reissue_repair_media_upload_token(uuid,timestamptz,text) from public,anon,service_role;
revoke all on function erp.revoke_repair_media_upload_token(uuid,text) from public,anon,service_role;
revoke all on function erp.rotate_repair_tracking_token(uuid,timestamptz,text) from public,anon,service_role;
revoke all on function erp.revoke_repair_tracking_token(uuid,text) from public,anon,service_role;
revoke all on function erp.record_repair_label_event(uuid,text,integer,text,text) from public,anon,service_role;
revoke all on function erp.deliver_repair_order(uuid,text,text,text,text,integer,text,text,text) from public,anon,service_role;
revoke all on function erp.open_repair_warranty_claim(uuid,text,text,text) from public,anon,service_role;

grant execute on function erp.create_customer_equipment(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text) to authenticated;
grant execute on function erp.transfer_customer_equipment(uuid,uuid,uuid,text,text) to authenticated;
grant execute on function erp.create_repair_order(uuid,uuid,uuid,jsonb,text,text,text,text,text,text) to authenticated;
grant execute on function erp.provision_repair_credential_key(uuid,bytea,text) to service_role;
grant execute on function erp.rotate_repair_credentials(uuid,jsonb,text) to authenticated;
grant execute on function erp.get_repair_credentials(uuid) to authenticated;
grant execute on function erp.get_customer_equipment_identifiers(uuid) to authenticated;
grant execute on function erp.get_repair_quote_costs(uuid) to authenticated;
grant execute on function erp.transition_repair_order(uuid,uuid,text,text,text) to authenticated;
grant execute on function erp.assign_repair_order(uuid,uuid,text,text) to authenticated;
grant execute on function erp.record_repair_test_run(uuid,uuid,jsonb,text,text) to authenticated;
grant execute on function erp.create_repair_quote_version(uuid,text,uuid,jsonb,text,text) to authenticated;
grant execute on function erp.issue_repair_quote(uuid,timestamptz,text,text) to authenticated;
grant execute on function erp.reissue_repair_quote_token(uuid,timestamptz,text) to authenticated;
grant execute on function erp.reserve_repair_parts(uuid,timestamptz,jsonb,text,text) to authenticated;
grant execute on function erp.release_repair_parts(uuid,uuid,text,text) to authenticated;
grant execute on function erp.consume_repair_parts(uuid,uuid,text,text) to authenticated;
grant execute on function erp.reverse_repair_part_consumption(uuid,uuid,text,text) to authenticated;
grant execute on function erp.record_repair_labor(uuid,text,numeric,numeric,text) to authenticated;
grant execute on function erp.record_repair_payment(uuid,uuid,uuid,numeric,text,uuid,text,text,text) to authenticated;
grant execute on function erp.reverse_repair_payment(uuid,text,text,uuid) to authenticated;
grant execute on function erp.create_repair_media_upload_token(uuid,timestamptz,integer,bigint,text[],text) to authenticated;
grant execute on function erp.reissue_repair_media_upload_token(uuid,timestamptz,text) to authenticated;
grant execute on function erp.revoke_repair_media_upload_token(uuid,text) to authenticated;
grant execute on function erp.rotate_repair_tracking_token(uuid,timestamptz,text) to authenticated;
grant execute on function erp.revoke_repair_tracking_token(uuid,text) to authenticated;
grant execute on function erp.record_repair_label_event(uuid,text,integer,text,text) to authenticated;
grant execute on function erp.deliver_repair_order(uuid,text,text,text,text,integer,text,text,text) to authenticated;
grant execute on function erp.open_repair_warranty_claim(uuid,text,text,text) to authenticated;
grant execute on function public.respond_repair_quote(text,text,text) to anon,authenticated;
grant execute on function public.register_repair_private_media(text,integer,text,text,bigint,text) to anon,authenticated;
grant execute on function public.get_repair_tracking(text) to anon,authenticated;

comment on table erp.repair_credentials is
  'Versioned AES-256 pgcrypto ciphertext only. Key material is isolated in repair_credential_keys and never exposed or audited.';
comment on table erp.repair_credential_keys is
  'Local protected-key foundation. No API role, including service_role, has direct SELECT. Production deployments must provision externally KMS/Vault-wrapped key material and disable SQL parameter logging for provisioning; this migration does not implement an external KMS/Vault integration.';
comment on table erp.repair_quote_response_events is
  'Customer decisions are operational repair facts only; they create no sale, payment, stock or accounting fact.';
comment on table erp.repair_private_media is
  'Private object metadata only. Storage upload, signed URL and binary handling are intentionally deferred.';
