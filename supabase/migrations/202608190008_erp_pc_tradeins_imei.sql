-- Stage 7 composes the existing reservation, cost, payment, repair-test and
-- customer-equipment contracts. Provider transport is represented by a durable
-- outbox only; no external provider or network behavior is implemented here.

create type erp.pc_build_state as enum ('draft','reserved','tested','completed','cancelled');
create type erp.pc_compatibility_outcome as enum ('pass','warning','fail');
create type erp.trade_in_review_decision as enum ('approved','rejected');
create type erp.imei_check_status as enum ('clear','blocked','not_required','unavailable','error');

create table erp.stage7_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  command_name text not null check (command_name ~ '^[a-z][a-z0-9_.]+$'),
  idempotency_key text not null check (btrim(idempotency_key) <> '' and length(idempotency_key) <= 200),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint stage7_commands_branch_fk foreign key(branch_id,organization_id)
    references erp.branches(id,organization_id) on delete restrict,
  constraint stage7_commands_identity_unique unique(command_name,organization_id,branch_id,idempotency_key)
);

create table erp.pc_compatibility_specs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  code text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  name text not null check (btrim(name) <> '' and length(name) <= 150),
  is_active boolean not null default true,
  constraint pc_compatibility_specs_id_org_unique unique(id,organization_id),
  constraint pc_compatibility_specs_code_unique unique(organization_id,code)
);

create table erp.pc_compatibility_spec_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  spec_id uuid not null,
  version integer not null check(version > 0),
  required_slots jsonb not null check(jsonb_typeof(required_slots)='array' and jsonb_array_length(required_slots) between 1 and 100 and pg_column_size(required_slots)<=262144),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint pc_spec_versions_id_org_unique unique(id,organization_id),
  constraint pc_spec_versions_spec_fk foreign key(spec_id,organization_id) references erp.pc_compatibility_specs(id,organization_id) on delete restrict,
  constraint pc_spec_versions_unique unique(spec_id,version)
);

create table erp.pc_compatibility_rule_sets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  code text not null check(code ~ '^[a-z][a-z0-9_]*$'),
  name text not null check(btrim(name)<>'' and length(name)<=150),
  is_active boolean not null default true,
  constraint pc_rule_sets_id_org_unique unique(id,organization_id),
  constraint pc_rule_sets_code_unique unique(organization_id,code)
);

create table erp.pc_compatibility_rule_set_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  rule_set_id uuid not null,
  version integer not null check(version>0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint pc_rule_set_versions_id_org_unique unique(id,organization_id),
  constraint pc_rule_set_versions_set_fk foreign key(rule_set_id,organization_id) references erp.pc_compatibility_rule_sets(id,organization_id) on delete restrict,
  constraint pc_rule_set_versions_unique unique(rule_set_id,version)
);

create table erp.pc_compatibility_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  rule_set_version_id uuid not null,
  rule_order integer not null check(rule_order>0),
  code text not null check(code ~ '^[a-z][a-z0-9_]*$'),
  severity erp.pc_compatibility_outcome not null check(severity in ('warning','fail')),
  definition jsonb not null check(jsonb_typeof(definition)='object' and pg_column_size(definition)<=65536),
  message text not null check(btrim(message)<>'' and length(message)<=1000),
  constraint pc_rules_id_org_unique unique(id,organization_id),
  constraint pc_rules_version_fk foreign key(rule_set_version_id,organization_id) references erp.pc_compatibility_rule_set_versions(id,organization_id) on delete restrict,
  constraint pc_rules_order_unique unique(rule_set_version_id,rule_order),
  constraint pc_rules_code_unique unique(rule_set_version_id,code)
);

create table erp.pc_test_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  code text not null check(code ~ '^[a-z][a-z0-9_]*$'),
  name text not null check(btrim(name)<>'' and length(name)<=150),
  is_active boolean not null default true,
  constraint pc_test_templates_id_org_unique unique(id,organization_id),
  constraint pc_test_templates_code_unique unique(organization_id,code)
);

create table erp.pc_test_template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  template_id uuid not null,
  version integer not null check(version>0),
  definition jsonb not null check(jsonb_typeof(definition)='array' and jsonb_array_length(definition) between 1 and 100 and pg_column_size(definition)<=262144),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint pc_test_versions_id_org_unique unique(id,organization_id),
  constraint pc_test_versions_template_fk foreign key(template_id,organization_id) references erp.pc_test_templates(id,organization_id) on delete restrict,
  constraint pc_test_versions_unique unique(template_id,version)
);

create table erp.pc_build_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  customer_id uuid not null,
  title text not null check(btrim(title)<>'' and length(title)<=200),
  notes text check(notes is null or length(notes)<=8000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint pc_projects_id_org_unique unique(id,organization_id),
  constraint pc_projects_id_org_branch_unique unique(id,organization_id,branch_id),
  constraint pc_projects_branch_fk foreign key(branch_id,organization_id) references erp.branches(id,organization_id) on delete restrict,
  constraint pc_projects_customer_fk foreign key(customer_id,organization_id) references erp.customers(id,organization_id) on delete restrict
);

create table erp.pc_build_state_events (
  id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  project_id uuid not null,
  state erp.pc_build_state not null,
  reason text not null check(btrim(reason)<>'' and length(reason)<=2000),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid references auth.users(id) on delete restrict,
  constraint pc_state_project_fk foreign key(project_id,organization_id,branch_id) references erp.pc_build_projects(id,organization_id,branch_id) on delete restrict
);

create table erp.pc_build_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  project_id uuid not null,
  version integer not null check(version>0),
  supersedes_revision_id uuid,
  spec_version_id uuid not null,
  rule_set_version_id uuid not null,
  configuration jsonb not null check(jsonb_typeof(configuration)='object' and pg_column_size(configuration)<=262144),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint pc_revisions_id_org_unique unique(id,organization_id),
  constraint pc_revisions_owner_unique unique(id,organization_id,branch_id,project_id),
  constraint pc_revisions_project_fk foreign key(project_id,organization_id,branch_id) references erp.pc_build_projects(id,organization_id,branch_id) on delete restrict,
  constraint pc_revisions_supersedes_fk foreign key(supersedes_revision_id,organization_id,branch_id,project_id) references erp.pc_build_revisions(id,organization_id,branch_id,project_id) on delete restrict,
  constraint pc_revisions_spec_fk foreign key(spec_version_id,organization_id) references erp.pc_compatibility_spec_versions(id,organization_id) on delete restrict,
  constraint pc_revisions_rules_fk foreign key(rule_set_version_id,organization_id) references erp.pc_compatibility_rule_set_versions(id,organization_id) on delete restrict,
  constraint pc_revisions_version_unique unique(project_id,version)
);

create table erp.pc_build_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  revision_id uuid not null,
  line_number integer not null check(line_number>0),
  slot_code text not null check(slot_code ~ '^[a-z][a-z0-9_]*$'),
  product_id uuid not null,
  variant_id uuid,
  inventory_unit_id uuid,
  quantity numeric(18,4) not null check(quantity<>'NaN'::numeric and quantity>0),
  specification_snapshot jsonb not null check(jsonb_typeof(specification_snapshot)='object' and pg_column_size(specification_snapshot)<=65536),
  unit_cost_snapshot numeric(18,4) not null check(unit_cost_snapshot<>'NaN'::numeric and unit_cost_snapshot>=0),
  serial_snapshot text,
  warranty_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(warranty_snapshot)='object' and pg_column_size(warranty_snapshot)<=65536),
  constraint pc_components_id_org_unique unique(id,organization_id),
  constraint pc_components_revision_fk foreign key(revision_id,organization_id) references erp.pc_build_revisions(id,organization_id) on delete restrict,
  constraint pc_components_product_fk foreign key(product_id,organization_id) references erp.products(id,organization_id) on delete restrict,
  constraint pc_components_variant_fk foreign key(variant_id,product_id,organization_id) references erp.product_variants(id,product_id,organization_id) on delete restrict,
  constraint pc_components_unit_fk foreign key(inventory_unit_id,organization_id) references erp.inventory_units(id,organization_id) on delete restrict,
  constraint pc_components_line_unique unique(revision_id,line_number),
  constraint pc_components_slot_unique unique(revision_id,slot_code)
);

create table erp.pc_compatibility_runs (
  id uuid primary key default gen_random_uuid(),
  run_sequence bigint generated always as identity unique,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  project_id uuid not null,
  revision_id uuid not null,
  outcome erp.pc_compatibility_outcome not null,
  completed_at timestamptz not null default clock_timestamp(),
  responsible_id uuid references auth.users(id) on delete restrict,
  constraint pc_runs_id_org_unique unique(id,organization_id),
  constraint pc_runs_revision_fk foreign key(revision_id,organization_id,branch_id,project_id) references erp.pc_build_revisions(id,organization_id,branch_id,project_id) on delete restrict
);

create table erp.pc_compatibility_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  run_id uuid not null,
  rule_id uuid,
  result_code text not null check(result_code ~ '^[a-z][a-z0-9_]*$'),
  outcome erp.pc_compatibility_outcome not null,
  message text not null check(btrim(message)<>'' and length(message)<=1000),
  details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object' and pg_column_size(details)<=65536),
  constraint pc_results_run_fk foreign key(run_id,organization_id) references erp.pc_compatibility_runs(id,organization_id) on delete restrict,
  constraint pc_results_rule_fk foreign key(rule_id,organization_id) references erp.pc_compatibility_rules(id,organization_id) on delete restrict,
  constraint pc_results_code_unique unique(run_id,result_code)
);

create table erp.pc_build_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  project_id uuid not null,
  revision_id uuid not null,
  reservation_batch_id uuid not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint pc_reservations_project_fk foreign key(project_id,organization_id,branch_id) references erp.pc_build_projects(id,organization_id,branch_id) on delete restrict,
  constraint pc_reservations_revision_fk foreign key(revision_id,organization_id,branch_id,project_id) references erp.pc_build_revisions(id,organization_id,branch_id,project_id) on delete restrict,
  constraint pc_reservations_batch_fk foreign key(reservation_batch_id,organization_id) references erp.stock_reservation_batches(id,organization_id) on delete restrict
);

create table erp.pc_test_runs (
  id uuid primary key default gen_random_uuid(),
  run_sequence bigint generated always as identity unique,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  project_id uuid not null,
  revision_id uuid not null,
  template_version_id uuid not null,
  completed_at timestamptz not null default clock_timestamp(),
  responsible_id uuid not null references auth.users(id) on delete restrict,
  notes text check(notes is null or length(notes)<=4000),
  constraint pc_test_runs_id_org_unique unique(id,organization_id),
  constraint pc_test_runs_revision_fk foreign key(revision_id,organization_id,branch_id,project_id) references erp.pc_build_revisions(id,organization_id,branch_id,project_id) on delete restrict,
  constraint pc_test_runs_template_fk foreign key(template_version_id,organization_id) references erp.pc_test_template_versions(id,organization_id) on delete restrict
);

create table erp.pc_test_results (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  test_run_id uuid not null,
  item_key text not null check(item_key ~ '^[a-zA-Z0-9_.-]{1,100}$'),
  result erp.repair_test_result not null,
  measured_value jsonb check(measured_value is null or pg_column_size(measured_value)<=16384),
  notes text check(notes is null or length(notes)<=2000),
  constraint pc_test_results_run_fk foreign key(test_run_id,organization_id) references erp.pc_test_runs(id,organization_id) on delete restrict,
  constraint pc_test_results_item_unique unique(test_run_id,item_key)
);

create table erp.pc_build_completions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  project_id uuid not null unique,
  revision_id uuid not null unique,
  reservation_batch_id uuid not null unique,
  stock_document_id uuid not null unique,
  equipment_id uuid not null unique,
  completed_at timestamptz not null default clock_timestamp(),
  completed_by uuid references auth.users(id) on delete restrict,
  constraint pc_completions_id_org_unique unique(id,organization_id),
  constraint pc_completions_revision_fk foreign key(revision_id,organization_id,branch_id,project_id) references erp.pc_build_revisions(id,organization_id,branch_id,project_id) on delete restrict,
  constraint pc_completions_batch_fk foreign key(reservation_batch_id,organization_id) references erp.stock_reservation_batches(id,organization_id) on delete restrict,
  constraint pc_completions_stock_fk foreign key(stock_document_id,organization_id) references erp.stock_documents(id,organization_id) on delete restrict,
  constraint pc_completions_equipment_fk foreign key(equipment_id,organization_id) references erp.customer_equipment(id,organization_id) on delete restrict
);

create table erp.pc_component_lineage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  completion_id uuid not null,
  component_id uuid not null unique,
  product_id uuid not null,
  variant_id uuid,
  inventory_unit_id uuid,
  quantity numeric(18,4) not null check(quantity<>'NaN'::numeric and quantity>0),
  serial_snapshot text,
  unit_cost_snapshot numeric(18,4) not null check(unit_cost_snapshot<>'NaN'::numeric and unit_cost_snapshot>=0),
  warranty_snapshot jsonb not null check(jsonb_typeof(warranty_snapshot)='object' and pg_column_size(warranty_snapshot)<=65536),
  constraint pc_lineage_completion_fk foreign key(completion_id,organization_id) references erp.pc_build_completions(id,organization_id) on delete restrict,
  constraint pc_lineage_component_fk foreign key(component_id,organization_id) references erp.pc_build_components(id,organization_id) on delete restrict,
  constraint pc_lineage_product_fk foreign key(product_id,organization_id) references erp.products(id,organization_id) on delete restrict,
  constraint pc_lineage_variant_fk foreign key(variant_id,product_id,organization_id) references erp.product_variants(id,product_id,organization_id) on delete restrict,
  constraint pc_lineage_unit_fk foreign key(inventory_unit_id,organization_id) references erp.inventory_units(id,organization_id) on delete restrict
);

create table erp.trade_ins (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  customer_id uuid not null,
  product_id uuid not null,
  variant_id uuid,
  inventory_unit_id uuid not null unique,
  quarantine_location_id uuid not null,
  declared_value_base numeric(18,4) not null check(declared_value_base<>'NaN'::numeric and declared_value_base>=0),
  received_at timestamptz not null default clock_timestamp(),
  received_by uuid references auth.users(id) on delete restrict,
  constraint trade_ins_id_org_unique unique(id,organization_id),
  constraint trade_ins_id_org_branch_unique unique(id,organization_id,branch_id),
  constraint trade_ins_branch_fk foreign key(branch_id,organization_id) references erp.branches(id,organization_id) on delete restrict,
  constraint trade_ins_customer_fk foreign key(customer_id,organization_id) references erp.customers(id,organization_id) on delete restrict,
  constraint trade_ins_product_fk foreign key(product_id,organization_id) references erp.products(id,organization_id) on delete restrict,
  constraint trade_ins_variant_fk foreign key(variant_id,product_id,organization_id) references erp.product_variants(id,product_id,organization_id) on delete restrict,
  constraint trade_ins_unit_fk foreign key(inventory_unit_id,organization_id) references erp.inventory_units(id,organization_id) on delete restrict,
  constraint trade_ins_location_fk foreign key(quarantine_location_id,organization_id,branch_id) references erp.locations(id,organization_id,branch_id) on delete restrict
);

create table erp.trade_in_provenance_declarations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null, trade_in_id uuid not null unique,
  declaration text not null check(btrim(declaration)<>'' and length(declaration)<=8000),
  declared_owner_name text not null check(btrim(declared_owner_name)<>'' and length(declared_owner_name)<=300),
  declared_at timestamptz not null default clock_timestamp(), declared_by uuid references auth.users(id) on delete restrict,
  constraint trade_provenance_trade_fk foreign key(trade_in_id,organization_id,branch_id) references erp.trade_ins(id,organization_id,branch_id) on delete restrict,
  constraint trade_provenance_id_org_unique unique(id,organization_id)
);

create table erp.trade_in_provenance_evidence (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null, trade_in_id uuid not null, evidence_type text not null check(evidence_type ~ '^[a-z][a-z0-9_]*$'),
  private_object_path text not null check(btrim(private_object_path)<>'' and length(private_object_path)<=1000),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'), metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object' and pg_column_size(metadata)<=65536),
  captured_at timestamptz not null default clock_timestamp(), captured_by uuid references auth.users(id) on delete restrict,
  constraint trade_evidence_trade_fk foreign key(trade_in_id,organization_id,branch_id) references erp.trade_ins(id,organization_id,branch_id) on delete restrict
);

create table erp.trade_in_provenance_reviews (
  id uuid primary key default gen_random_uuid(), event_sequence bigint generated always as identity unique,
  organization_id uuid not null references erp.organizations(id) on delete restrict, branch_id uuid not null, trade_in_id uuid not null,
  decision erp.trade_in_review_decision not null, reason text not null check(btrim(reason)<>'' and length(reason)<=4000),
  reviewed_at timestamptz not null default clock_timestamp(), reviewed_by uuid not null references auth.users(id) on delete restrict,
  constraint trade_provenance_review_fk foreign key(trade_in_id,organization_id,branch_id) references erp.trade_ins(id,organization_id,branch_id) on delete restrict
);

create table erp.trade_in_imei_requests (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null, trade_in_id uuid not null, key_id uuid not null, request_version integer not null check(request_version>0),
  imei_hmac text not null check(imei_hmac ~ '^[0-9a-f]{64}$'), imei_ciphertext bytea not null,
  provider text not null check(btrim(provider)<>'' and length(provider)<=100), requested_at timestamptz not null default clock_timestamp(),
  requested_by uuid references auth.users(id) on delete restrict,
  constraint trade_imei_requests_id_org_unique unique(id,organization_id),
  constraint trade_imei_requests_trade_fk foreign key(trade_in_id,organization_id,branch_id) references erp.trade_ins(id,organization_id,branch_id) on delete restrict,
  constraint trade_imei_requests_key_fk foreign key(key_id,organization_id) references erp.repair_credential_keys(id,organization_id) on delete restrict,
  constraint trade_imei_requests_version_unique unique(trade_in_id,request_version)
);

create table erp.trade_in_imei_results (
  id uuid primary key default gen_random_uuid(), event_sequence bigint generated always as identity unique,
  organization_id uuid not null references erp.organizations(id) on delete restrict, branch_id uuid not null,
  trade_in_id uuid not null, request_id uuid, source text not null check(source in ('provider','manual')),
  status erp.imei_check_status not null, provider_reference text,
  evidence jsonb not null default '{}'::jsonb check(jsonb_typeof(evidence)='object' and pg_column_size(evidence)<=262144),
  reason text not null check(btrim(reason)<>'' and length(reason)<=4000), checked_at timestamptz not null default clock_timestamp(),
  checked_by uuid references auth.users(id) on delete restrict,
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  constraint trade_imei_results_trade_fk foreign key(trade_in_id,organization_id,branch_id) references erp.trade_ins(id,organization_id,branch_id) on delete restrict,
  constraint trade_imei_results_request_fk foreign key(request_id,organization_id) references erp.trade_in_imei_requests(id,organization_id) on delete restrict,
  constraint trade_imei_results_source_shape check((source='provider' and request_id is not null and status<>'not_required') or (source='manual' and provider_reference is null))
);

create table erp.trade_in_evaluations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null, trade_in_id uuid not null, version integer not null check(version>0), supersedes_evaluation_id uuid,
  condition_snapshot jsonb not null check(jsonb_typeof(condition_snapshot)='object' and pg_column_size(condition_snapshot)<=262144),
  appraised_value_base numeric(18,4) not null check(appraised_value_base<>'NaN'::numeric and appraised_value_base>=0),
  estimated_refurbishment_cost_base numeric(18,4) not null check(estimated_refurbishment_cost_base<>'NaN'::numeric and estimated_refurbishment_cost_base>=0),
  created_at timestamptz not null default clock_timestamp(), created_by uuid references auth.users(id) on delete restrict,
  constraint trade_evaluations_id_org_unique unique(id,organization_id),
  constraint trade_evaluations_owner_unique unique(id,organization_id,branch_id,trade_in_id),
  constraint trade_evaluations_trade_fk foreign key(trade_in_id,organization_id,branch_id) references erp.trade_ins(id,organization_id,branch_id) on delete restrict,
  constraint trade_evaluations_supersedes_fk foreign key(supersedes_evaluation_id,organization_id,branch_id,trade_in_id) references erp.trade_in_evaluations(id,organization_id,branch_id,trade_in_id) on delete restrict,
  constraint trade_evaluations_version_unique unique(trade_in_id,version)
);

create table erp.trade_in_evaluation_reviews (
  id uuid primary key default gen_random_uuid(), event_sequence bigint generated always as identity unique,
  organization_id uuid not null references erp.organizations(id) on delete restrict, branch_id uuid not null,
  trade_in_id uuid not null, evaluation_id uuid not null, decision erp.trade_in_review_decision not null,
  reason text not null check(btrim(reason)<>'' and length(reason)<=4000), reviewed_at timestamptz not null default clock_timestamp(),
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  constraint trade_eval_reviews_eval_fk foreign key(evaluation_id,organization_id,branch_id,trade_in_id) references erp.trade_in_evaluations(id,organization_id,branch_id,trade_in_id) on delete restrict
);

create table erp.trade_in_refurbishments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null, trade_in_id uuid not null, repair_order_id uuid,
  description text not null check(btrim(description)<>'' and length(description)<=2000),
  actual_cost_base numeric(18,4) not null check(actual_cost_base<>'NaN'::numeric and actual_cost_base>=0),
  completed_at timestamptz, created_at timestamptz not null default clock_timestamp(), created_by uuid references auth.users(id) on delete restrict,
  constraint trade_refurb_trade_fk foreign key(trade_in_id,organization_id,branch_id) references erp.trade_ins(id,organization_id,branch_id) on delete restrict,
  constraint trade_refurb_repair_fk foreign key(repair_order_id,organization_id,branch_id) references erp.repair_orders(id,organization_id,branch_id) on delete restrict,
  constraint trade_refurb_repair_unique unique(repair_order_id)
);

create table erp.trade_in_releases (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null, trade_in_id uuid not null unique, evaluation_id uuid not null,
  stock_document_id uuid not null unique, destination_location_id uuid not null,
  accepted_value_base numeric(18,4) not null check(accepted_value_base<>'NaN'::numeric and accepted_value_base>=0),
  refurbishment_cost_base numeric(18,4) not null check(refurbishment_cost_base<>'NaN'::numeric and refurbishment_cost_base>=0),
  total_cost_base numeric(18,4) not null check(total_cost_base<>'NaN'::numeric and total_cost_base=accepted_value_base+refurbishment_cost_base),
  released_at timestamptz not null default clock_timestamp(), released_by uuid references auth.users(id) on delete restrict,
  constraint trade_releases_id_org_unique unique(id,organization_id),
  constraint trade_releases_trade_fk foreign key(trade_in_id,organization_id,branch_id) references erp.trade_ins(id,organization_id,branch_id) on delete restrict,
  constraint trade_releases_eval_fk foreign key(evaluation_id,organization_id,branch_id,trade_in_id) references erp.trade_in_evaluations(id,organization_id,branch_id,trade_in_id) on delete restrict,
  constraint trade_releases_stock_fk foreign key(stock_document_id,organization_id) references erp.stock_documents(id,organization_id) on delete restrict,
  constraint trade_releases_location_fk foreign key(destination_location_id,organization_id,branch_id) references erp.locations(id,organization_id,branch_id) on delete restrict
);

create table erp.trade_in_sale_payment_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null, trade_in_id uuid not null, sale_id uuid not null, payment_id uuid not null unique,
  event_kind text not null check(event_kind in ('applied','reversed')), reverses_event_id uuid,
  amount numeric(18,4) not null check(amount<>'NaN'::numeric and amount<>0), occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid references auth.users(id) on delete restrict,
  constraint trade_payment_events_id_org_unique unique(id,organization_id),
  constraint trade_payment_trade_fk foreign key(trade_in_id,organization_id,branch_id) references erp.trade_ins(id,organization_id,branch_id) on delete restrict,
  constraint trade_payment_sale_fk foreign key(sale_id,organization_id,branch_id) references erp.sales(id,organization_id,branch_id) on delete restrict,
  constraint trade_payment_payment_fk foreign key(payment_id,organization_id,branch_id) references erp.payments(id,organization_id,branch_id) on delete restrict,
  constraint trade_payment_reverses_fk foreign key(reverses_event_id,organization_id) references erp.trade_in_sale_payment_events(id,organization_id) on delete restrict,
  constraint trade_payment_reversal_unique unique(reverses_event_id),
  constraint trade_payment_shape check((event_kind='applied' and reverses_event_id is null and amount>0) or (event_kind='reversed' and reverses_event_id is not null and amount<0))
);

alter table erp.trade_in_imei_requests
  add constraint trade_imei_requests_owner_unique
  unique(id,organization_id,branch_id,trade_in_id);

alter table erp.trade_in_imei_results
  add constraint trade_imei_results_request_owner_fk
  foreign key(request_id,organization_id,branch_id,trade_in_id)
  references erp.trade_in_imei_requests(id,organization_id,branch_id,trade_in_id)
  on delete restrict;

create unique index trade_imei_provider_result_once
  on erp.trade_in_imei_results(request_id)
  where source='provider';
create index pc_state_latest_idx on erp.pc_build_state_events(project_id,event_sequence desc);
create index pc_compatibility_latest_idx on erp.pc_compatibility_runs(revision_id,run_sequence desc);
create index pc_test_latest_idx on erp.pc_test_runs(revision_id,run_sequence desc);
create index trade_provenance_latest_idx on erp.trade_in_provenance_reviews(trade_in_id,event_sequence desc);
create index trade_imei_request_latest_idx on erp.trade_in_imei_requests(trade_in_id,request_version desc);
create index trade_imei_result_latest_idx on erp.trade_in_imei_results(request_id,event_sequence desc);
create index trade_evaluation_latest_idx on erp.trade_in_evaluations(trade_in_id,version desc);
create index trade_evaluation_review_latest_idx on erp.trade_in_evaluation_reviews(evaluation_id,event_sequence desc);
create index trade_refurbishment_trade_idx on erp.trade_in_refurbishments(trade_in_id);
create unique index trade_refurbishment_repair_once on erp.trade_in_refurbishments(repair_order_id) where repair_order_id is not null;
create index trade_payment_trade_idx on erp.trade_in_sale_payment_events(trade_in_id,occurred_at desc);

create or replace function erp.claim_stage7_command(command text,target_organization_id uuid,target_branch_id uuid,operation_key text,request_body jsonb)
returns erp.stage7_commands language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare row_value erp.stage7_commands%rowtype; expected text;
begin
  if nullif(btrim(command),'') is null or nullif(btrim(operation_key),'') is null or request_body is null or pg_column_size(request_body)>1048576 then raise exception using errcode='invalid_parameter_value',message='bounded command data is required'; end if;
  expected:=encode(extensions.digest(convert_to(request_body::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':'||target_branch_id::text||':'||command||':'||operation_key,0));
  select * into row_value from erp.stage7_commands where command_name=command and organization_id=target_organization_id and branch_id=target_branch_id and idempotency_key=operation_key;
  if found then if row_value.request_hash<>expected then raise exception using errcode='integrity_constraint_violation',message='idempotency key is already used by another request'; end if; return row_value; end if;
  insert into erp.stage7_commands(organization_id,branch_id,command_name,idempotency_key,request_hash,created_by) values(target_organization_id,target_branch_id,command,operation_key,expected,auth.uid()) returning * into row_value; return row_value;
end $$;

create or replace function erp.complete_stage7_command(command_id uuid,command_result_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,erp as $$
begin perform set_config('erp.allow_stage7_command_completion','on',true); update erp.stage7_commands set result_id=command_result_id where id=command_id and result_id is null; perform set_config('erp.allow_stage7_command_completion','off',true); if not found then raise exception using errcode='data_exception',message='command completion failed'; end if; end $$;

create or replace function erp.protect_stage7_command()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin if tg_op='UPDATE' and current_setting('erp.allow_stage7_command_completion',true)='on' and old.result_id is null and new.result_id is not null and (to_jsonb(new)-'result_id')=(to_jsonb(old)-'result_id') then return new; end if; raise exception using errcode='integrity_constraint_violation',message='stage 7 commands are immutable'; end $$;
create trigger stage7_commands_immutable before update or delete on erp.stage7_commands for each row execute function erp.protect_stage7_command();

create or replace function erp.assert_pc_project_mutable(target_project_id uuid,target_organization_id uuid)
returns erp.pc_build_projects language plpgsql security definer set search_path=pg_catalog,erp as $$
declare project erp.pc_build_projects%rowtype; latest_state erp.pc_build_state;
begin
  select * into project from erp.pc_build_projects
  where id=target_project_id and organization_id=target_organization_id for update;
  if project.id is null then
    raise exception using errcode='no_data_found',message='PC project not found';
  end if;
  select state into latest_state from erp.pc_build_state_events
  where project_id=project.id order by event_sequence desc limit 1;
  if latest_state in('completed','cancelled') or exists(
    select 1 from erp.pc_build_completions where project_id=project.id
  ) then
    raise exception using errcode='object_not_in_prerequisite_state',message='PC project is terminal';
  end if;
  return project;
end $$;

create or replace function erp.create_pc_build_project(target_branch_id uuid,target_customer_id uuid,project_title text,project_notes text,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); cmd erp.stage7_commands%rowtype; project_id uuid;
begin
  if org_id is null or not erp.has_permission('pc_builds.manage',target_branch_id) then raise exception using errcode='insufficient_privilege',message='pc_builds.manage permission is required'; end if;
  if nullif(btrim(project_title),'') is null or length(project_title)>200 or length(coalesce(project_notes,''))>8000 or nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='valid project data and reason are required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  cmd:=erp.claim_stage7_command('pc.project.create',org_id,target_branch_id,operation_key,jsonb_build_object('customer_id',target_customer_id,'title',project_title,'notes',project_notes,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  insert into erp.pc_build_projects(organization_id,branch_id,customer_id,title,notes,created_by) values(org_id,target_branch_id,target_customer_id,btrim(project_title),project_notes,auth.uid()) returning id into project_id;
  insert into erp.pc_build_state_events(organization_id,branch_id,project_id,state,reason,actor_id) values(org_id,target_branch_id,project_id,'draft',operation_reason,auth.uid()); perform erp.complete_stage7_command(cmd.id,project_id); return project_id;
end $$;

create or replace function erp.create_pc_build_revision(target_project_id uuid,target_spec_version_id uuid,target_rule_set_version_id uuid,configuration jsonb,components jsonb,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); branch uuid; cmd erp.stage7_commands%rowtype; revision_id uuid; prior uuid; next_version int; item jsonb; n int:=0; product_id uuid; variant_id uuid; unit_id uuid; qty numeric; tracking erp.inventory_tracking_mode; cost numeric; serial text;
begin
  select branch_id into branch from erp.assert_pc_project_mutable(target_project_id,org_id);
  if branch is null or not erp.has_permission('pc_builds.manage',branch) then raise exception using errcode='insufficient_privilege',message='pc_builds.manage permission is required'; end if;
  if configuration is null or jsonb_typeof(configuration)<>'object' or pg_column_size(configuration)>262144 or components is null or jsonb_typeof(components)<>'array' or jsonb_array_length(components) not between 1 and 100 or pg_column_size(components)>1048576 or nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='bounded configuration, components and reason are required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  cmd:=erp.claim_stage7_command('pc.revision.create',org_id,branch,operation_key,jsonb_build_object('project_id',target_project_id,'spec_version_id',target_spec_version_id,'rule_set_version_id',target_rule_set_version_id,'configuration',configuration,'components',components,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  select id,version into prior,next_version from erp.pc_build_revisions where project_id=target_project_id order by version desc limit 1; next_version:=coalesce(next_version,0)+1;
  insert into erp.pc_build_revisions(organization_id,branch_id,project_id,version,supersedes_revision_id,spec_version_id,rule_set_version_id,configuration,created_by) values(org_id,branch,target_project_id,next_version,prior,target_spec_version_id,target_rule_set_version_id,configuration,auth.uid()) returning id into revision_id;
  for item in select value from jsonb_array_elements(components) loop
    n:=n+1; if jsonb_typeof(item)<>'object' or nullif(item->>'slot_code','') is null or not erp.is_finite_numeric_text(item->>'quantity') then raise exception using errcode='invalid_parameter_value',message=format('invalid component %s',n); end if;
    begin product_id:=(item->>'product_id')::uuid; variant_id:=nullif(item->>'variant_id','')::uuid; unit_id:=nullif(item->>'inventory_unit_id','')::uuid; qty:=(item->>'quantity')::numeric; exception when others then raise exception using errcode='invalid_parameter_value',message=format('invalid component %s',n); end;
    select inventory_tracking into tracking from erp.products where id=product_id and organization_id=org_id and item_kind='product' and is_active;
    if tracking is null or qty<=0 or (tracking in('serial','imei') and (unit_id is null or qty<>1)) or (tracking='quantity' and unit_id is not null) then raise exception using errcode='check_violation',message=format('component %s stock identity is invalid',n); end if;
    if tracking='quantity' then select weighted_average_cost into cost from erp.inventory_cost_balances where organization_id=org_id and branch_id=branch and product_id=create_pc_build_revision.product_id and variant_key=coalesce(variant_id,'00000000-0000-0000-0000-000000000000'::uuid) and valued_quantity>0;
    else select coalesce(sc.acquisition_cost_base,u.acquisition_cost),coalesce(u.serial_number,u.imei) into cost,serial from erp.inventory_units u left join erp.serialized_acquisition_costs sc on sc.inventory_unit_id=u.id and sc.organization_id=u.organization_id join erp.locations l on l.id=u.current_location_id and l.organization_id=u.organization_id where u.id=unit_id and u.organization_id=org_id and u.product_id=create_pc_build_revision.product_id and u.variant_id is not distinct from variant_id and u.status='available' and u.is_active and l.branch_id=branch; end if;
    if cost is null then raise exception using errcode='object_not_in_prerequisite_state',message=format('component %s authoritative cost is unavailable',n); end if;
    insert into erp.pc_build_components(organization_id,revision_id,line_number,slot_code,product_id,variant_id,inventory_unit_id,quantity,specification_snapshot,unit_cost_snapshot,serial_snapshot,warranty_snapshot) values(org_id,revision_id,n,btrim(item->>'slot_code'),product_id,variant_id,unit_id,qty,coalesce(item->'specifications','{}'),cost,serial,coalesce(item->'warranty','{}'));
  end loop;
  perform erp.complete_stage7_command(cmd.id,revision_id); return revision_id;
end $$;

create or replace function erp.record_pc_compatibility_run(target_revision_id uuid,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); rev erp.pc_build_revisions%rowtype; project erp.pc_build_projects%rowtype; cmd erp.stage7_commands%rowtype; run_id uuid; rule record; left_value jsonb; right_value jsonb; matched boolean; overall erp.pc_compatibility_outcome:='pass'; missing text;
begin
  select * into rev from erp.pc_build_revisions where id=target_revision_id and organization_id=org_id;
  if rev.id is null or not erp.has_permission('pc_builds.manage',rev.branch_id) then raise exception using errcode='insufficient_privilege',message='pc_builds.manage permission is required'; end if;
  project:=erp.assert_pc_project_mutable(rev.project_id,org_id);
  if nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='operation reason is required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  cmd:=erp.claim_stage7_command('pc.compatibility.run',org_id,rev.branch_id,operation_key,jsonb_build_object('revision_id',target_revision_id,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  select string_agg(slot,',') into missing from (select value#>>'{}' slot from erp.pc_compatibility_spec_versions v cross join lateral jsonb_array_elements(v.required_slots) where v.id=rev.spec_version_id except select slot_code from erp.pc_build_components where revision_id=rev.id) x;
  if missing is not null then overall:='fail'; end if;
  insert into erp.pc_compatibility_runs(organization_id,branch_id,project_id,revision_id,outcome,responsible_id) values(org_id,rev.branch_id,rev.project_id,rev.id,'pass',auth.uid()) returning id into run_id;
  if missing is not null then insert into erp.pc_compatibility_results(organization_id,run_id,result_code,outcome,message,details) values(org_id,run_id,'required_slots','fail','Required component slots are missing',jsonb_build_object('missing',missing)); end if;
  for rule in select * from erp.pc_compatibility_rules where rule_set_version_id=rev.rule_set_version_id and organization_id=org_id order by rule_order loop
    select specification_snapshot->(rule.definition->>'left_key') into left_value from erp.pc_build_components where revision_id=rev.id and slot_code=rule.definition->>'left_slot';
    select specification_snapshot->(rule.definition->>'right_key') into right_value from erp.pc_build_components where revision_id=rev.id and slot_code=rule.definition->>'right_slot';
    matched:=coalesce(case rule.definition->>'operator'
      when 'eq' then left_value=right_value
      when 'gte' then case when erp.is_finite_numeric_text(left_value#>>'{}') and erp.is_finite_numeric_text(right_value#>>'{}') then (left_value#>>'{}')::numeric >= (right_value#>>'{}')::numeric else false end
      else false end,false);
    insert into erp.pc_compatibility_results(organization_id,run_id,rule_id,result_code,outcome,message,details) values(org_id,run_id,rule.id,rule.code,case when matched then 'pass' else rule.severity end,case when matched then 'Compatible' else rule.message end,jsonb_build_object('left',left_value,'right',right_value));
    if matched is not true and rule.severity='fail' then overall:='fail'; elsif matched is not true and rule.severity='warning' and overall='pass' then overall:='warning'; end if;
  end loop;
  perform set_config('erp.allow_pc_run_completion','on',true);
  update erp.pc_compatibility_runs set outcome=overall where id=run_id;
  perform set_config('erp.allow_pc_run_completion','off',true);
  perform erp.complete_stage7_command(cmd.id,run_id); return run_id;
end $$;

create or replace function erp.reserve_pc_build_components(target_project_id uuid,target_revision_id uuid,expires_at timestamptz,lines jsonb,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); rev erp.pc_build_revisions%rowtype; project erp.pc_build_projects%rowtype; cmd erp.stage7_commands%rowtype; batch uuid; bridge uuid;
begin
  select * into rev from erp.pc_build_revisions where id=target_revision_id and project_id=target_project_id and organization_id=org_id;
  if rev.id is null or not erp.has_permission('pc_builds.manage',rev.branch_id) then raise exception using errcode='insufficient_privilege',message='pc_builds.manage permission is required'; end if;
  project:=erp.assert_pc_project_mutable(target_project_id,org_id);
  if nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='operation reason is required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  if rev.id<>(select id from erp.pc_build_revisions where project_id=target_project_id order by version desc limit 1) or coalesce((select outcome<>'fail' from erp.pc_compatibility_runs where revision_id=rev.id order by run_sequence desc limit 1),false)=false then raise exception using errcode='object_not_in_prerequisite_state',message='latest compatible revision is required'; end if;
  cmd:=erp.claim_stage7_command('pc.components.reserve',org_id,rev.branch_id,operation_key,jsonb_build_object('project_id',target_project_id,'revision_id',target_revision_id,'expires_at',expires_at,'lines',lines,'reason',operation_reason)); if cmd.result_id is not null then return (select reservation_batch_id from erp.pc_build_reservations where id=cmd.result_id); end if;
  batch:=erp.create_stock_reservation(rev.branch_id,operation_key||':stock','pc_build',target_project_id,expires_at,lines);
  if exists(with expected as(select product_id,variant_id,inventory_unit_id,sum(quantity) quantity from erp.pc_build_components where revision_id=rev.id group by 1,2,3), actual as(select product_id,variant_id,inventory_unit_id,sum(quantity) quantity from erp.stock_reservations where batch_id=batch group by 1,2,3) select 1 from((select * from expected except select * from actual) union all(select * from actual except select * from expected)) mismatch) then raise exception using errcode='check_violation',message='reservation must exactly match revision components'; end if;
  insert into erp.pc_build_reservations(organization_id,branch_id,project_id,revision_id,reservation_batch_id,created_by) values(org_id,rev.branch_id,target_project_id,rev.id,batch,auth.uid()) returning id into bridge;
  insert into erp.pc_build_state_events(organization_id,branch_id,project_id,state,reason,actor_id) values(org_id,rev.branch_id,target_project_id,'reserved',operation_reason,auth.uid()); perform erp.complete_stage7_command(cmd.id,bridge); return batch;
end $$;

create or replace function erp.record_pc_test_run(target_revision_id uuid,target_template_version_id uuid,results jsonb,run_notes text,operation_key text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); rev erp.pc_build_revisions%rowtype; project erp.pc_build_projects%rowtype; definition jsonb; required_template uuid; cmd erp.stage7_commands%rowtype; run_id uuid; item jsonb;
begin
  select * into rev from erp.pc_build_revisions where id=target_revision_id and organization_id=org_id;
  if rev.id is not null then project:=erp.assert_pc_project_mutable(rev.project_id,org_id); end if;
  select nullif(value#>>'{}','')::uuid into required_template from erp.configuration_values where organization_id=org_id and branch_id is null and key='pc_builds.final_test_template_version';
  select v.definition into definition from erp.pc_test_template_versions v join erp.pc_test_templates t on t.id=v.template_id and t.organization_id=v.organization_id where v.id=target_template_version_id and v.id=required_template and v.organization_id=org_id and t.is_active;
  if rev.id is null or not erp.has_permission('pc_builds.manage',rev.branch_id) then raise exception using errcode='insufficient_privilege',message='pc_builds.manage permission is required'; end if;
  if definition is null or results is null or jsonb_typeof(results)<>'array' or jsonb_array_length(results) not between 1 and 100 or pg_column_size(results)>262144 or (select count(*) from jsonb_array_elements(definition) d where coalesce((d->>'required')::boolean,true))<>jsonb_array_length(results) or exists(select 1 from jsonb_array_elements(results) r where r->>'result' not in('pass','fail','not_applicable') or not exists(select 1 from jsonb_array_elements(definition) d where d->>'key'=r->>'item_key' and coalesce((d->>'required')::boolean,true))) or (select count(distinct r->>'item_key') from jsonb_array_elements(results) r)<>jsonb_array_length(results) then raise exception using errcode='invalid_parameter_value',message='results must exactly match required PC test keys'; end if;
  if not exists(select 1 from erp.pc_build_reservations r join erp.stock_reservation_batches b on b.id=r.reservation_batch_id and b.organization_id=r.organization_id where r.revision_id=rev.id and b.status='active' and b.expires_at>clock_timestamp()) then raise exception using errcode='object_not_in_prerequisite_state',message='active component reservation is required before final tests'; end if;
  perform set_config('erp.operation_reason','PC final test run recorded',true);
  cmd:=erp.claim_stage7_command('pc.test.run',org_id,rev.branch_id,operation_key,jsonb_build_object('revision_id',target_revision_id,'template_version_id',target_template_version_id,'results',results,'notes',run_notes)); if cmd.result_id is not null then return cmd.result_id; end if;
  insert into erp.pc_test_runs(organization_id,branch_id,project_id,revision_id,template_version_id,responsible_id,notes) values(org_id,rev.branch_id,rev.project_id,rev.id,target_template_version_id,auth.uid(),run_notes) returning id into run_id;
  for item in select value from jsonb_array_elements(results) loop insert into erp.pc_test_results(organization_id,test_run_id,item_key,result,measured_value,notes) values(org_id,run_id,item->>'item_key',(item->>'result')::erp.repair_test_result,item->'value',item->>'notes'); end loop;
  insert into erp.pc_build_state_events(organization_id,branch_id,project_id,state,reason,actor_id) values(org_id,rev.branch_id,rev.project_id,'tested','PC test run recorded',auth.uid()); perform erp.complete_stage7_command(cmd.id,run_id); return run_id;
end $$;

create or replace function erp.complete_pc_build(target_project_id uuid,target_revision_id uuid,target_reservation_batch_id uuid,build_serial text,warranty_snapshot jsonb,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare org_id uuid:=erp.current_organization_id(); rev erp.pc_build_revisions%rowtype; project erp.pc_build_projects%rowtype; cmd erp.stage7_commands%rowtype; key_row erp.repair_credential_keys%rowtype; candidate erp.repair_credential_keys%rowtype; payload jsonb; prior_hash text; normalized text:=nullif(upper(regexp_replace(btrim(build_serial),'[[:space:]-]+','','g')),''); stock_id uuid; equipment_id uuid; completion_id uuid; latest_test uuid; required_template uuid; reservation_created_at timestamptz;
begin
  select * into project from erp.pc_build_projects where id=target_project_id and organization_id=org_id for update; select * into rev from erp.pc_build_revisions where id=target_revision_id and project_id=target_project_id and organization_id=org_id;
  if project.id is null or rev.id is null or not erp.has_permission('pc_builds.manage',project.branch_id) then raise exception using errcode='insufficient_privilege',message='pc_builds.manage permission is required'; end if;
  if normalized is null or length(build_serial)>200 or warranty_snapshot is null or jsonb_typeof(warranty_snapshot)<>'object' or pg_column_size(warranty_snapshot)>65536 or nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='build serial, bounded warranty and reason are required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  select request_hash into prior_hash from erp.stage7_commands where command_name='pc.project.complete' and organization_id=org_id and branch_id=project.branch_id and idempotency_key=operation_key;
  if prior_hash is not null then for candidate in select * from erp.repair_credential_keys where organization_id=org_id order by key_version loop payload:=jsonb_build_object('project_id',target_project_id,'revision_id',target_revision_id,'batch_id',target_reservation_batch_id,'serial_hmac',encode(extensions.hmac(convert_to(normalized,'UTF8'),candidate.key_material,'sha256'),'hex'),'identifier_key_id',candidate.id,'warranty_hmac',encode(extensions.hmac(convert_to(warranty_snapshot::text,'UTF8'),candidate.key_material,'sha256'),'hex'),'reason_hmac',encode(extensions.hmac(convert_to(operation_reason,'UTF8'),candidate.key_material,'sha256'),'hex')); if encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex')=prior_hash then key_row:=candidate; exit; end if; end loop; if key_row.id is null then raise exception using errcode='integrity_constraint_violation',message='idempotency key is already used by another request'; end if;
  else select * into key_row from erp.repair_credential_keys where organization_id=org_id and is_active for share; end if;
  if key_row.id is null then raise exception using errcode='object_not_in_prerequisite_state',message='protected repair identifier key is unavailable'; end if;
  payload:=jsonb_build_object('project_id',target_project_id,'revision_id',target_revision_id,'batch_id',target_reservation_batch_id,'serial_hmac',encode(extensions.hmac(convert_to(normalized,'UTF8'),key_row.key_material,'sha256'),'hex'),'identifier_key_id',key_row.id,'warranty_hmac',encode(extensions.hmac(convert_to(warranty_snapshot::text,'UTF8'),key_row.key_material,'sha256'),'hex'),'reason_hmac',encode(extensions.hmac(convert_to(operation_reason,'UTF8'),key_row.key_material,'sha256'),'hex')); cmd:=erp.claim_stage7_command('pc.project.complete',org_id,project.branch_id,operation_key,payload); if cmd.result_id is not null then return (select equipment_id from erp.pc_build_completions where id=cmd.result_id); end if;
  if exists(select 1 from erp.pc_build_completions where project_id=project.id) or coalesce((select state in('completed','cancelled') from erp.pc_build_state_events where project_id=project.id order by event_sequence desc limit 1),false) then raise exception using errcode='object_not_in_prerequisite_state',message='PC project is terminal'; end if;
  if rev.id<>(select id from erp.pc_build_revisions where project_id=project.id order by version desc limit 1) or coalesce((select outcome<>'fail' from erp.pc_compatibility_runs where revision_id=rev.id order by run_sequence desc limit 1),false)=false then raise exception using errcode='object_not_in_prerequisite_state',message='latest compatible revision is required'; end if;
  select r.created_at into reservation_created_at from erp.pc_build_reservations r join erp.stock_reservation_batches b on b.id=r.reservation_batch_id and b.organization_id=r.organization_id where r.project_id=project.id and r.revision_id=rev.id and r.reservation_batch_id=target_reservation_batch_id and b.status='active' and b.expires_at>clock_timestamp();
  select nullif(value#>>'{}','')::uuid into required_template from erp.configuration_values where organization_id=org_id and branch_id is null and key='pc_builds.final_test_template_version';
  select id into latest_test from erp.pc_test_runs where revision_id=rev.id and template_version_id=required_template and completed_at>=reservation_created_at order by run_sequence desc limit 1;
  if reservation_created_at is null or latest_test is null or exists(select 1 from erp.pc_test_results where test_run_id=latest_test and result<>'pass') or (select count(*) from erp.pc_test_results where test_run_id=latest_test)<>(select count(*) from jsonb_array_elements((select definition from erp.pc_test_template_versions where id=required_template)) d where coalesce((d->>'required')::boolean,true)) then raise exception using errcode='object_not_in_prerequisite_state',message='exact active reservation and current complete passing PC test are required'; end if;
  stock_id:=erp.fulfill_stock_reservation(target_reservation_batch_id,operation_key||':stock',operation_reason);
  insert into erp.customer_equipment(organization_id,equipment_type,brand_snapshot,model_snapshot,serial_number,notes,created_by) values(org_id,'PC','NicTech','Custom build',btrim(build_serial),'PC build '||project.id,auth.uid()) returning id into equipment_id;
  insert into erp.equipment_ownership_events(organization_id,equipment_id,customer_id,reason,actor_id) values(org_id,equipment_id,project.customer_id,operation_reason,auth.uid());
  insert into erp.pc_build_completions(organization_id,branch_id,project_id,revision_id,reservation_batch_id,stock_document_id,equipment_id,completed_by) values(org_id,project.branch_id,project.id,rev.id,target_reservation_batch_id,stock_id,equipment_id,auth.uid()) returning id into completion_id;
  insert into erp.pc_component_lineage(organization_id,completion_id,component_id,product_id,variant_id,inventory_unit_id,quantity,serial_snapshot,unit_cost_snapshot,warranty_snapshot)
  select org_id,completion_id,c.id,c.product_id,c.variant_id,c.inventory_unit_id,c.quantity,
    coalesce(u.serial_number,u.imei,c.serial_snapshot),cost.unit_cost,
    case when c.warranty_snapshot='{}' then complete_pc_build.warranty_snapshot else c.warranty_snapshot end
  from erp.pc_build_components c
  left join erp.inventory_units u on u.id=c.inventory_unit_id and u.organization_id=org_id
  cross join lateral (
    select round(sum(abs(m.value_delta_base))/sum(abs(m.quantity_delta)),8) unit_cost
    from erp.stock_cost_movements m
    where m.organization_id=org_id and m.document_id=stock_id
      and m.product_id=c.product_id and m.variant_id is not distinct from c.variant_id
      and m.inventory_unit_id is not distinct from c.inventory_unit_id
  ) cost
  where c.revision_id=rev.id and cost.unit_cost is not null;
  if (select count(*) from erp.pc_component_lineage l where l.completion_id=complete_pc_build.completion_id)<>(select count(*) from erp.pc_build_components where revision_id=rev.id) then raise exception using errcode='check_violation',message='fulfillment cost lineage does not exactly match build components'; end if;
  insert into erp.pc_build_state_events(organization_id,branch_id,project_id,state,reason,actor_id) values(org_id,project.branch_id,project.id,'completed',operation_reason,auth.uid()); perform erp.complete_stage7_command(cmd.id,completion_id); return equipment_id;
end $$;

create or replace function erp.create_trade_in(target_branch_id uuid,target_customer_id uuid,target_product_id uuid,target_variant_id uuid,serial_number text,imei text,declared_owner_name text,provenance_declaration text,evidence jsonb,declared_value_base numeric,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare org_id uuid:=erp.current_organization_id(); cmd erp.stage7_commands%rowtype; key_row erp.repair_credential_keys%rowtype; candidate erp.repair_credential_keys%rowtype; payload jsonb; prior_hash text; normalized_serial text:=nullif(upper(regexp_replace(btrim(serial_number),'[[:space:]-]+','','g')),''); normalized_imei text:=nullif(regexp_replace(btrim(imei),'[^0-9]+','','g'),''); location_id uuid; unit_id uuid; trade_id uuid; item jsonb;
begin
  if org_id is null or not erp.has_permission('trade_ins.manage',target_branch_id) then raise exception using errcode='insufficient_privilege',message='trade_ins.manage permission is required'; end if;
  if (normalized_serial is null and normalized_imei is null) or normalized_imei is not null and normalized_imei!~'^[0-9]{14,16}$' or evidence is null or jsonb_typeof(evidence)<>'array' or jsonb_array_length(evidence) not between 1 and 50 or pg_column_size(evidence)>524288 or not erp.is_finite_numeric_text(declared_value_base::text) or declared_value_base<0 or nullif(btrim(declared_owner_name),'') is null or nullif(btrim(provenance_declaration),'') is null or nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='bounded trade-in identifiers, provenance, evidence and value are required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  select id into location_id from erp.locations where organization_id=org_id and branch_id=target_branch_id and code='CUARENTENA-CANJES' and is_active and not allows_sale and not contributes_to_web_stock; if location_id is null then raise exception using errcode='object_not_in_prerequisite_state',message='active trade-in quarantine location is required'; end if;
  select request_hash into prior_hash from erp.stage7_commands where command_name='trade_in.create' and organization_id=org_id and branch_id=target_branch_id and idempotency_key=operation_key;
  if prior_hash is not null then for candidate in select * from erp.repair_credential_keys where organization_id=org_id order by key_version loop payload:=jsonb_build_object('customer_id',target_customer_id,'product_id',target_product_id,'variant_id',target_variant_id,'serial_hmac',case when normalized_serial is null then null else encode(extensions.hmac(convert_to(normalized_serial,'UTF8'),candidate.key_material,'sha256'),'hex') end,'imei_hmac',case when normalized_imei is null then null else encode(extensions.hmac(convert_to(normalized_imei,'UTF8'),candidate.key_material,'sha256'),'hex') end,'identifier_key_id',candidate.id,'owner_hmac',encode(extensions.hmac(convert_to(declared_owner_name,'UTF8'),candidate.key_material,'sha256'),'hex'),'declaration_hmac',encode(extensions.hmac(convert_to(provenance_declaration,'UTF8'),candidate.key_material,'sha256'),'hex'),'evidence_hmac',encode(extensions.hmac(convert_to(evidence::text,'UTF8'),candidate.key_material,'sha256'),'hex'),'value',declared_value_base,'reason_hmac',encode(extensions.hmac(convert_to(operation_reason,'UTF8'),candidate.key_material,'sha256'),'hex')); if encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex')=prior_hash then key_row:=candidate; exit; end if; end loop; if key_row.id is null then raise exception using errcode='integrity_constraint_violation',message='idempotency key is already used by another request'; end if;
  else select * into key_row from erp.repair_credential_keys where organization_id=org_id and is_active for share; end if;
  if key_row.id is null then raise exception using errcode='object_not_in_prerequisite_state',message='protected repair identifier key is unavailable'; end if;
  payload:=jsonb_build_object('customer_id',target_customer_id,'product_id',target_product_id,'variant_id',target_variant_id,'serial_hmac',case when normalized_serial is null then null else encode(extensions.hmac(convert_to(normalized_serial,'UTF8'),key_row.key_material,'sha256'),'hex') end,'imei_hmac',case when normalized_imei is null then null else encode(extensions.hmac(convert_to(normalized_imei,'UTF8'),key_row.key_material,'sha256'),'hex') end,'identifier_key_id',key_row.id,'owner_hmac',encode(extensions.hmac(convert_to(declared_owner_name,'UTF8'),key_row.key_material,'sha256'),'hex'),'declaration_hmac',encode(extensions.hmac(convert_to(provenance_declaration,'UTF8'),key_row.key_material,'sha256'),'hex'),'evidence_hmac',encode(extensions.hmac(convert_to(evidence::text,'UTF8'),key_row.key_material,'sha256'),'hex'),'value',declared_value_base,'reason_hmac',encode(extensions.hmac(convert_to(operation_reason,'UTF8'),key_row.key_material,'sha256'),'hex')); cmd:=erp.claim_stage7_command('trade_in.create',org_id,target_branch_id,operation_key,payload); if cmd.result_id is not null then return cmd.result_id; end if;
  insert into erp.inventory_units(organization_id,product_id,variant_id,current_location_id,serial_number,imei,status,acquisition_cost,acquired_at,created_by,updated_by) values(org_id,target_product_id,target_variant_id,null,nullif(btrim(serial_number),''),nullif(btrim(imei),''),'quarantine',0,clock_timestamp(),auth.uid(),auth.uid()) returning id into unit_id;
  insert into erp.trade_ins(organization_id,branch_id,customer_id,product_id,variant_id,inventory_unit_id,quarantine_location_id,declared_value_base,received_by) values(org_id,target_branch_id,target_customer_id,target_product_id,target_variant_id,unit_id,location_id,declared_value_base,auth.uid()) returning id into trade_id;
  insert into erp.trade_in_provenance_declarations(organization_id,branch_id,trade_in_id,declaration,declared_owner_name,declared_by) values(org_id,target_branch_id,trade_id,btrim(provenance_declaration),btrim(declared_owner_name),auth.uid());
  for item in select value from jsonb_array_elements(evidence) loop if jsonb_typeof(item)<>'object' or nullif(item->>'type','') is null or nullif(item->>'private_object_path','') is null or item->>'sha256'!~'^[0-9a-f]{64}$' then raise exception using errcode='invalid_parameter_value',message='valid private provenance evidence is required'; end if; insert into erp.trade_in_provenance_evidence(organization_id,branch_id,trade_in_id,evidence_type,private_object_path,sha256,metadata,captured_by) values(org_id,target_branch_id,trade_id,item->>'type',item->>'private_object_path',item->>'sha256',coalesce(item->'metadata','{}'),auth.uid()); end loop;
  perform erp.complete_stage7_command(cmd.id,trade_id); return trade_id;
end $$;

create or replace function erp.review_trade_in_provenance(target_trade_in_id uuid,decision erp.trade_in_review_decision,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); branch uuid; result_id uuid;
begin select branch_id into branch from erp.trade_ins where id=target_trade_in_id and organization_id=org_id for update; if branch is null or not erp.has_permission('trade_ins.approve',branch) then raise exception using errcode='insufficient_privilege',message='trade_ins.approve permission is required'; end if; if decision is null or nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='decision and reason are required'; end if; if decision='approved' and (not exists(select 1 from erp.trade_in_provenance_declarations where trade_in_id=target_trade_in_id and organization_id=org_id) or not exists(select 1 from erp.trade_in_provenance_evidence where trade_in_id=target_trade_in_id and organization_id=org_id and evidence_type in('identity','ownership'))) then raise exception using errcode='object_not_in_prerequisite_state',message='identity or ownership evidence is required for provenance approval'; end if; perform set_config('erp.operation_reason',operation_reason,true); insert into erp.trade_in_provenance_reviews(organization_id,branch_id,trade_in_id,decision,reason,reviewed_by) values(org_id,branch,target_trade_in_id,decision,operation_reason,auth.uid()) returning id into result_id; return result_id; end $$;

create or replace function erp.request_trade_in_imei_check(target_trade_in_id uuid,provider_name text,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare org_id uuid:=erp.current_organization_id(); trade erp.trade_ins%rowtype; key_row erp.repair_credential_keys%rowtype; candidate erp.repair_credential_keys%rowtype; raw_imei text; cmd erp.stage7_commands%rowtype; request_id uuid; next_version int; digest text; payload jsonb; prior_hash text;
begin
  select * into trade from erp.trade_ins where id=target_trade_in_id and organization_id=org_id for update; if trade.id is null or not erp.has_permission('trade_ins.manage',trade.branch_id) then raise exception using errcode='insufficient_privilege',message='trade_ins.manage permission is required'; end if;
  if nullif(btrim(provider_name),'') is null or length(provider_name)>120 or nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='provider and operation reason are required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  select normalized_imei into raw_imei from erp.inventory_units where id=trade.inventory_unit_id and organization_id=org_id; if raw_imei is null then raise exception using errcode='object_not_in_prerequisite_state',message='trade-in has no IMEI; record documented not-required fallback'; end if;
  select request_hash into prior_hash from erp.stage7_commands where command_name='trade_in.imei.request' and organization_id=org_id and branch_id=trade.branch_id and idempotency_key=operation_key;
  if prior_hash is not null then for candidate in select * from erp.repair_credential_keys where organization_id=org_id order by key_version loop digest:=encode(extensions.hmac(convert_to(raw_imei,'UTF8'),candidate.key_material,'sha256'),'hex'); payload:=jsonb_build_object('trade_in_id',target_trade_in_id,'provider',provider_name,'imei_hmac',digest,'identifier_key_id',candidate.id,'reason_hmac',encode(extensions.hmac(convert_to(operation_reason,'UTF8'),candidate.key_material,'sha256'),'hex')); if encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex')=prior_hash then key_row:=candidate; exit; end if; end loop; if key_row.id is null then raise exception using errcode='integrity_constraint_violation',message='idempotency key is already used by another request'; end if; else select * into key_row from erp.repair_credential_keys where organization_id=org_id and is_active for share; end if;
  if key_row.id is null then raise exception using errcode='object_not_in_prerequisite_state',message='protected repair identifier key is unavailable'; end if;
  digest:=encode(extensions.hmac(convert_to(raw_imei,'UTF8'),key_row.key_material,'sha256'),'hex'); payload:=jsonb_build_object('trade_in_id',target_trade_in_id,'provider',provider_name,'imei_hmac',digest,'identifier_key_id',key_row.id,'reason_hmac',encode(extensions.hmac(convert_to(operation_reason,'UTF8'),key_row.key_material,'sha256'),'hex')); cmd:=erp.claim_stage7_command('trade_in.imei.request',org_id,trade.branch_id,operation_key,payload); if cmd.result_id is not null then return cmd.result_id; end if;
  select coalesce(max(request_version),0)+1 into next_version from erp.trade_in_imei_requests where trade_in_id=target_trade_in_id;
  insert into erp.trade_in_imei_requests(organization_id,branch_id,trade_in_id,key_id,request_version,imei_hmac,imei_ciphertext,provider,requested_by) values(org_id,trade.branch_id,target_trade_in_id,key_row.id,next_version,digest,extensions.pgp_sym_encrypt(raw_imei,encode(key_row.key_material,'hex'),'cipher-algo=aes256'),btrim(provider_name),auth.uid()) returning id into request_id;
  insert into erp.integration_outbox(organization_id,branch_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key) values(org_id,trade.branch_id,'trade_in',target_trade_in_id,'trade_in.imei.requested',jsonb_build_object('request_id',request_id,'provider',btrim(provider_name),'redacted',true),operation_key||':outbox'); perform erp.complete_stage7_command(cmd.id,request_id); return request_id;
end $$;

create or replace function erp.get_trade_in_imei_provider_request(target_request_id uuid)
returns table(request_id uuid,provider text,imei text) language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare row_value erp.trade_in_imei_requests%rowtype; material bytea;
begin if auth.role() is distinct from 'service_role' then raise exception using errcode='insufficient_privilege',message='service role is required'; end if; select * into row_value from erp.trade_in_imei_requests where id=target_request_id; if row_value.id is null then raise exception using errcode='no_data_found',message='IMEI request not found'; end if; select key_material into material from erp.repair_credential_keys where id=row_value.key_id and organization_id=row_value.organization_id; insert into erp.audit_events(organization_id,branch_id,actor_user_id,schema_name,table_name,record_id,action,metadata) values(row_value.organization_id,row_value.branch_id,auth.uid(),'erp','trade_in_imei_requests',row_value.id::text,'read_sensitive',jsonb_build_object('provider_dispatch',true,'redacted',true)); request_id:=row_value.id; provider:=row_value.provider; imei:=extensions.pgp_sym_decrypt(row_value.imei_ciphertext,encode(material,'hex')); return next; end $$;

create or replace function erp.record_trade_in_imei_provider_result(target_request_id uuid,result_status erp.imei_check_status,provider_reference text,result_evidence jsonb,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare request_row erp.trade_in_imei_requests%rowtype; trade_row erp.trade_ins%rowtype; result_id uuid; expected_hash text; existing_hash text; material bytea;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='insufficient_privilege',message='service role is required'; end if;
  select * into request_row from erp.trade_in_imei_requests where id=target_request_id;
  if request_row.id is null or result_status is null or result_status='not_required' or result_evidence is null or jsonb_typeof(result_evidence)<>'object' or pg_column_size(result_evidence)>262144 or nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='valid provider result is required'; end if;
  select * into trade_row from erp.trade_ins where id=request_row.trade_in_id and organization_id=request_row.organization_id for update;
  select * into request_row from erp.trade_in_imei_requests where id=target_request_id and trade_in_id=trade_row.id for update;
  perform set_config('erp.operation_reason',operation_reason,true);
  select key_material into material from erp.repair_credential_keys where id=request_row.key_id and organization_id=request_row.organization_id;
  expected_hash:=encode(extensions.hmac(convert_to(jsonb_build_object('request_id',target_request_id,'status',result_status,'provider_reference',nullif(btrim(provider_reference),''),'evidence',result_evidence,'reason',operation_reason)::text,'UTF8'),material,'sha256'),'hex');
  select id,request_hash into result_id,existing_hash from erp.trade_in_imei_results where request_id=target_request_id and source='provider';
  if result_id is not null then if existing_hash<>expected_hash then raise exception using errcode='integrity_constraint_violation',message='provider request already has a different result'; end if; return result_id; end if;
  insert into erp.trade_in_imei_results(organization_id,branch_id,trade_in_id,request_id,source,status,provider_reference,evidence,reason,checked_by,request_hash) values(request_row.organization_id,request_row.branch_id,request_row.trade_in_id,request_row.id,'provider',result_status,nullif(btrim(provider_reference),''),result_evidence,operation_reason,auth.uid(),expected_hash) returning id into result_id;
  return result_id;
end $$;

create or replace function erp.record_trade_in_imei_manual_fallback(target_trade_in_id uuid,fallback_status erp.imei_check_status,documentation jsonb,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); trade erp.trade_ins%rowtype; latest_request erp.trade_in_imei_requests%rowtype; latest_provider_status erp.imei_check_status; cmd erp.stage7_commands%rowtype; result_id uuid; has_imei boolean; key_row erp.repair_credential_keys%rowtype; candidate erp.repair_credential_keys%rowtype; payload jsonb; prior_hash text;
begin
  select * into trade from erp.trade_ins where id=target_trade_in_id and organization_id=org_id for update; if trade.id is null or not erp.has_permission('trade_ins.approve',trade.branch_id) then raise exception using errcode='insufficient_privilege',message='trade_ins.approve permission is required'; end if;
  select normalized_imei is not null into has_imei from erp.inventory_units where id=trade.inventory_unit_id;
  if fallback_status not in('clear','not_required') or documentation is null or jsonb_typeof(documentation)<>'object' or documentation='{}' or pg_column_size(documentation)>262144 or nullif(btrim(operation_reason),'') is null or (fallback_status='not_required' and has_imei) then raise exception using errcode='invalid_parameter_value',message='documented clear or applicable not-required fallback is required'; end if;
  select * into latest_request from erp.trade_in_imei_requests where trade_in_id=trade.id order by request_version desc limit 1;
  select status into latest_provider_status from erp.trade_in_imei_results where request_id=latest_request.id and source='provider' order by event_sequence desc limit 1;
  if latest_provider_status='blocked' then raise exception using errcode='object_not_in_prerequisite_state',message='manual fallback cannot override a blocked IMEI'; end if;
  if has_imei and (latest_request.id is null or latest_provider_status not in('unavailable','error')) then raise exception using errcode='object_not_in_prerequisite_state',message='latest provider request must end unavailable or error for manual fallback'; end if;
  select request_hash into prior_hash from erp.stage7_commands where command_name='trade_in.imei.manual' and organization_id=org_id and branch_id=trade.branch_id and idempotency_key=operation_key;
  if prior_hash is not null then for candidate in select * from erp.repair_credential_keys where organization_id=org_id order by key_version loop payload:=jsonb_build_object('trade_in_id',trade.id,'status',fallback_status,'documentation_hmac',encode(extensions.hmac(convert_to(documentation::text,'UTF8'),candidate.key_material,'sha256'),'hex'),'reason_hmac',encode(extensions.hmac(convert_to(operation_reason,'UTF8'),candidate.key_material,'sha256'),'hex'),'identifier_key_id',candidate.id); if encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex')=prior_hash then key_row:=candidate; exit; end if; end loop; if key_row.id is null then raise exception using errcode='integrity_constraint_violation',message='idempotency key is already used by another request'; end if; else select * into key_row from erp.repair_credential_keys where organization_id=org_id and is_active for share; end if;
  if key_row.id is null then raise exception using errcode='object_not_in_prerequisite_state',message='protected repair identifier key is unavailable'; end if;
  payload:=jsonb_build_object('trade_in_id',trade.id,'status',fallback_status,'documentation_hmac',encode(extensions.hmac(convert_to(documentation::text,'UTF8'),key_row.key_material,'sha256'),'hex'),'reason_hmac',encode(extensions.hmac(convert_to(operation_reason,'UTF8'),key_row.key_material,'sha256'),'hex'),'identifier_key_id',key_row.id); cmd:=erp.claim_stage7_command('trade_in.imei.manual',org_id,trade.branch_id,operation_key,payload); if cmd.result_id is not null then return cmd.result_id; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  insert into erp.trade_in_imei_results(organization_id,branch_id,trade_in_id,request_id,source,status,evidence,reason,checked_by,request_hash) values(org_id,trade.branch_id,trade.id,case when has_imei then latest_request.id end,'manual',fallback_status,documentation,operation_reason,auth.uid(),encode(extensions.hmac(convert_to(jsonb_build_object('trade_in_id',trade.id,'request_id',case when has_imei then latest_request.id end,'status',fallback_status,'documentation',documentation,'reason',operation_reason)::text,'UTF8'),key_row.key_material,'sha256'),'hex')) returning id into result_id; perform erp.complete_stage7_command(cmd.id,result_id); return result_id;
end $$;

create or replace function erp.create_trade_in_evaluation(target_trade_in_id uuid,condition_snapshot jsonb,appraised_value_base numeric,estimated_refurbishment_cost_base numeric,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); trade erp.trade_ins%rowtype; cmd erp.stage7_commands%rowtype; prior uuid; next_version int; result_id uuid;
begin select * into trade from erp.trade_ins where id=target_trade_in_id and organization_id=org_id for update; if trade.id is null or not erp.has_permission('trade_ins.manage',trade.branch_id) then raise exception using errcode='insufficient_privilege',message='trade_ins.manage permission is required'; end if; if condition_snapshot is null or jsonb_typeof(condition_snapshot)<>'object' or condition_snapshot='{}' or pg_column_size(condition_snapshot)>262144 or not erp.is_finite_numeric_text(appraised_value_base::text) or appraised_value_base<0 or not erp.is_finite_numeric_text(estimated_refurbishment_cost_base::text) or estimated_refurbishment_cost_base<0 or nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='bounded evaluation, finite values and reason are required'; end if; if exists(select 1 from erp.trade_in_releases where trade_in_id=trade.id) then raise exception using errcode='object_not_in_prerequisite_state',message='released trade-in cannot be reevaluated'; end if; perform set_config('erp.operation_reason',operation_reason,true); cmd:=erp.claim_stage7_command('trade_in.evaluation.create',org_id,trade.branch_id,operation_key,jsonb_build_object('trade_in_id',trade.id,'condition',condition_snapshot,'appraised_value',appraised_value_base,'estimated_refurbishment',estimated_refurbishment_cost_base,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if; select id,version into prior,next_version from erp.trade_in_evaluations where trade_in_id=trade.id order by version desc limit 1; next_version:=coalesce(next_version,0)+1; insert into erp.trade_in_evaluations(organization_id,branch_id,trade_in_id,version,supersedes_evaluation_id,condition_snapshot,appraised_value_base,estimated_refurbishment_cost_base,created_by) values(org_id,trade.branch_id,trade.id,next_version,prior,condition_snapshot,appraised_value_base,estimated_refurbishment_cost_base,auth.uid()) returning id into result_id; perform erp.complete_stage7_command(cmd.id,result_id); return result_id; end $$;

create or replace function erp.review_trade_in_evaluation(target_evaluation_id uuid,decision erp.trade_in_review_decision,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); evaluation erp.trade_in_evaluations%rowtype; result_id uuid;
begin select * into evaluation from erp.trade_in_evaluations where id=target_evaluation_id and organization_id=org_id for update; if evaluation.id is null or not erp.has_permission('trade_ins.approve',evaluation.branch_id) then raise exception using errcode='insufficient_privilege',message='trade_ins.approve permission is required'; end if; perform 1 from erp.trade_ins where id=evaluation.trade_in_id and organization_id=org_id for update; if decision is null or nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='decision and reason are required'; end if; if evaluation.id<>(select id from erp.trade_in_evaluations where trade_in_id=evaluation.trade_in_id order by version desc limit 1) then raise exception using errcode='object_not_in_prerequisite_state',message='only latest evaluation can be reviewed'; end if; perform set_config('erp.operation_reason',operation_reason,true); insert into erp.trade_in_evaluation_reviews(organization_id,branch_id,trade_in_id,evaluation_id,decision,reason,reviewed_by) values(org_id,evaluation.branch_id,evaluation.trade_in_id,evaluation.id,decision,operation_reason,auth.uid()) returning id into result_id; return result_id; end $$;

create or replace function erp.record_trade_in_refurbishment(target_trade_in_id uuid,target_repair_order_id uuid,description text,actual_cost_base numeric,completed boolean,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); trade erp.trade_ins%rowtype; cmd erp.stage7_commands%rowtype; result_id uuid; authoritative_repair_cost numeric;
begin select * into trade from erp.trade_ins where id=target_trade_in_id and organization_id=org_id for update; if trade.id is null or not erp.has_permission('trade_ins.manage',trade.branch_id) or not erp.has_permission('costs.manage',trade.branch_id) then raise exception using errcode='insufficient_privilege',message='trade_ins.manage and costs.manage are required'; end if; if nullif(btrim(description),'') is null or length(description)>2000 or not erp.is_finite_numeric_text(actual_cost_base::text) or actual_cost_base<0 or completed is distinct from true or nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='completed refurbishment, description, finite cost and reason are required'; end if; if exists(select 1 from erp.trade_in_releases where trade_in_id=trade.id) then raise exception using errcode='object_not_in_prerequisite_state',message='released trade-in cannot receive refurbishment costs'; end if; if target_repair_order_id is not null then if not exists(select 1 from erp.repair_orders r where r.id=target_repair_order_id and r.organization_id=org_id and r.branch_id=trade.branch_id and r.customer_id=trade.customer_id and exists(select 1 from erp.repair_delivery_events d where d.repair_order_id=r.id and d.organization_id=r.organization_id)) then raise exception using errcode='foreign_key_violation',message='refurbishment repair must belong to the same customer and be delivered'; end if; select round(coalesce((select sum(abs(m.value_delta_base)) from erp.repair_part_events p join erp.stock_cost_movements m on m.document_id=p.stock_document_id and m.organization_id=p.organization_id where p.repair_order_id=target_repair_order_id and p.action='consumed' and not exists(select 1 from erp.repair_part_events x where x.reverses_event_id=p.id)),0)+coalesce((select sum(total_cost_base) from erp.repair_labor_facts where repair_order_id=target_repair_order_id and organization_id=org_id),0),4) into authoritative_repair_cost; if actual_cost_base<>authoritative_repair_cost then raise exception using errcode='check_violation',message='refurbishment cost must equal authoritative repair parts and labor'; end if; end if; perform set_config('erp.operation_reason',operation_reason,true); cmd:=erp.claim_stage7_command('trade_in.refurbishment.record',org_id,trade.branch_id,operation_key,jsonb_build_object('trade_in_id',trade.id,'repair_order_id',target_repair_order_id,'description',description,'cost',actual_cost_base,'completed',completed,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if; insert into erp.trade_in_refurbishments(organization_id,branch_id,trade_in_id,repair_order_id,description,actual_cost_base,completed_at,created_by) values(org_id,trade.branch_id,trade.id,target_repair_order_id,btrim(description),actual_cost_base,clock_timestamp(),auth.uid()) returning id into result_id; perform erp.complete_stage7_command(cmd.id,result_id); return result_id; end $$;

-- Generic stock commands may move released trade-ins out, but can never admit a
-- linked trade-in unit. Only release_trade_in_to_stock calls the hidden core.
alter function erp.post_stock_document(erp.stock_document_kind,uuid,text,text,jsonb,boolean,text,uuid) rename to post_stock_document_stage7_core;
create or replace function erp.post_stock_document(document_kind erp.stock_document_kind,target_branch_id uuid,operation_key text,operation_reason text,lines jsonb,allow_negative boolean default false,source_type text default null,source_id uuid default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare item jsonb; unit_id uuid;
begin
  if lines is null or jsonb_typeof(lines)<>'array' then raise exception using errcode='invalid_parameter_value',message='stock lines must be an array'; end if;
  for item in select value from jsonb_array_elements(lines) loop
    if jsonb_typeof(item)<>'object' then raise exception using errcode='invalid_parameter_value',message='stock lines must contain objects'; end if;
    begin unit_id:=nullif(item->>'inventory_unit_id','')::uuid; exception when invalid_text_representation then raise exception using errcode='invalid_parameter_value',message='stock line inventory unit is invalid'; end;
    if unit_id is not null and nullif(item->>'to_location_id','') is not null and nullif(item->>'from_location_id','') is null and exists(select 1 from erp.trade_ins t where t.inventory_unit_id=unit_id) then raise exception using errcode='object_not_in_prerequisite_state',message='trade-in quarantine admission requires approved release command'; end if;
  end loop;
  return erp.post_stock_document_stage7_core(document_kind,target_branch_id,operation_key,operation_reason,lines,allow_negative,source_type,source_id);
end $$;

alter function erp.reverse_stock_document(uuid,text,text) rename to reverse_stock_document_stage7_core;
create or replace function erp.reverse_stock_document(original_document_id uuid,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
begin
  if exists(select 1 from erp.trade_in_releases where stock_document_id=original_document_id) then
    raise exception using errcode='feature_not_supported',message='trade-in releases require a dedicated compensating workflow';
  end if;
  return erp.reverse_stock_document_stage7_core(original_document_id,operation_key,operation_reason);
end $$;

create or replace function erp.release_trade_in_to_stock(target_trade_in_id uuid,target_location_id uuid,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); trade erp.trade_ins%rowtype; cmd erp.stage7_commands%rowtype; evaluation erp.trade_in_evaluations%rowtype; latest_request_id uuid; has_imei boolean; refurb numeric; total numeric; document_id uuid; release_id uuid; imei_status erp.imei_check_status;
begin
  select * into trade from erp.trade_ins where id=target_trade_in_id and organization_id=org_id for update; if trade.id is null or not erp.has_permission('trade_ins.approve',trade.branch_id) or not erp.has_permission('stock.move',trade.branch_id) or not erp.has_permission('purchases.manage',trade.branch_id) or not erp.has_permission('costs.manage',trade.branch_id) then raise exception using errcode='insufficient_privilege',message='trade-in approval, stock, purchase and cost permissions are required'; end if;
  if nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='operation reason is required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  cmd:=erp.claim_stage7_command('trade_in.release',org_id,trade.branch_id,operation_key,jsonb_build_object('trade_in_id',trade.id,'location_id',target_location_id,'reason',operation_reason)); if cmd.result_id is not null then return (select stock_document_id from erp.trade_in_releases where id=cmd.result_id); end if;
  if coalesce((select decision='approved' from erp.trade_in_provenance_reviews where trade_in_id=trade.id order by event_sequence desc limit 1),false)=false then raise exception using errcode='object_not_in_prerequisite_state',message='latest provenance review must approve release'; end if;
  select normalized_imei is not null into has_imei from erp.inventory_units where id=trade.inventory_unit_id and organization_id=org_id;
  if has_imei then
    select id into latest_request_id from erp.trade_in_imei_requests where trade_in_id=trade.id order by request_version desc limit 1;
    select status into imei_status from erp.trade_in_imei_results where request_id=latest_request_id order by event_sequence desc limit 1;
  else
    select status into imei_status from erp.trade_in_imei_results where trade_in_id=trade.id and source='manual' and status='not_required' order by event_sequence desc limit 1;
  end if;
  if imei_status not in('clear','not_required') then raise exception using errcode='object_not_in_prerequisite_state',message='latest IMEI request must have an effective clear or applicable not-required result'; end if;
  select * into evaluation from erp.trade_in_evaluations where trade_in_id=trade.id order by version desc limit 1; if evaluation.id is null or coalesce((select decision='approved' from erp.trade_in_evaluation_reviews where evaluation_id=evaluation.id order by event_sequence desc limit 1),false)=false then raise exception using errcode='object_not_in_prerequisite_state',message='latest evaluation must be approved'; end if;
  if exists(select 1 from erp.trade_in_refurbishments where trade_in_id=trade.id and completed_at is null) then raise exception using errcode='object_not_in_prerequisite_state',message='all refurbishment work must be completed'; end if;
  select coalesce(sum(actual_cost_base),0) into refurb from erp.trade_in_refurbishments where trade_in_id=trade.id; total:=evaluation.appraised_value_base+refurb;
  if not exists(select 1 from erp.locations where id=target_location_id and organization_id=org_id and branch_id=trade.branch_id and is_active and allows_sale) then raise exception using errcode='foreign_key_violation',message='active sale location in the trade-in branch is required'; end if;
  update erp.inventory_units set acquisition_cost=total,updated_by=auth.uid() where id=trade.inventory_unit_id and organization_id=org_id and status='quarantine' and current_location_id is null; if not found then raise exception using errcode='object_not_in_prerequisite_state',message='trade-in unit is not quarantined'; end if;
  document_id:=erp.post_stock_document_core('receipt',trade.branch_id,operation_key||':stock',operation_reason,jsonb_build_array(jsonb_build_object('product_id',trade.product_id,'variant_id',trade.variant_id,'inventory_unit_id',trade.inventory_unit_id,'to_location_id',target_location_id,'quantity',1,'unit_cost',total)),false,'trade_in',trade.id);
  perform erp.process_stock_document_costs(document_id);
  insert into erp.trade_in_releases(organization_id,branch_id,trade_in_id,evaluation_id,stock_document_id,destination_location_id,accepted_value_base,refurbishment_cost_base,total_cost_base,released_by) values(org_id,trade.branch_id,trade.id,evaluation.id,document_id,target_location_id,evaluation.appraised_value_base,refurb,total,auth.uid()) returning id into release_id; perform erp.complete_stage7_command(cmd.id,release_id); return document_id;
end $$;

alter function erp.reverse_sale_payment(uuid,text,text,uuid) rename to reverse_sale_payment_stage7_core;
create or replace function erp.reverse_sale_payment(target_payment_id uuid,operation_key text,operation_reason text,target_refund_cash_session_id uuid default null)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
begin
  if exists(select 1 from erp.trade_in_sale_payment_events where payment_id=target_payment_id and event_kind='applied') then
    raise exception using errcode='feature_not_supported',message='trade-in payments require reverse_trade_in_sale_payment';
  end if;
  return erp.reverse_sale_payment_stage7_core(target_payment_id,operation_key,operation_reason,target_refund_cash_session_id);
end $$;

create or replace function erp.apply_trade_in_sale_payment(target_trade_in_id uuid,target_sale_id uuid,payment_amount numeric,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); trade erp.trade_ins%rowtype; sale_row erp.sales%rowtype; cmd erp.stage7_commands%rowtype; accepted_value numeric; method_id uuid; payment_id uuid; event_id uuid;
begin
  select * into trade from erp.trade_ins where id=target_trade_in_id and organization_id=org_id for update;
  select * into sale_row from erp.sales where id=target_sale_id and organization_id=org_id;
  if trade.id is null or sale_row.id is null or sale_row.branch_id<>trade.branch_id or sale_row.customer_id is distinct from trade.customer_id or not erp.has_permission('trade_ins.manage',trade.branch_id) or nullif(btrim(operation_reason),'') is null or not erp.is_finite_numeric_text(payment_amount::text) or payment_amount<=0 then raise exception using errcode='object_not_in_prerequisite_state',message='released trade-in, same customer sale, finite amount and reason are required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  cmd:=erp.claim_stage7_command('trade_in.sale_payment.apply',org_id,trade.branch_id,operation_key,jsonb_build_object('trade_in_id',trade.id,'sale_id',sale_row.id,'amount',payment_amount,'reason',operation_reason));
  if cmd.result_id is not null then return (select payment_id from erp.trade_in_sale_payment_events where id=cmd.result_id); end if;
  select e.appraised_value_base into accepted_value from erp.trade_in_releases r join erp.trade_in_evaluations e on e.id=r.evaluation_id and e.organization_id=r.organization_id where r.trade_in_id=trade.id and r.organization_id=org_id;
  if accepted_value is null or round(payment_amount*sale_row.exchange_rate,4)<>accepted_value then raise exception using errcode='object_not_in_prerequisite_state',message='payment must equal the released trade-in accepted value'; end if;
  select id into method_id from erp.payment_methods where organization_id=org_id and code='TRADE_IN' and is_active and not requires_cash_session;
  if method_id is null then raise exception using errcode='object_not_in_prerequisite_state',message='active non-cash TRADE_IN payment method is required'; end if;
  if exists(select 1 from erp.trade_in_sale_payment_events a where a.trade_in_id=trade.id and a.event_kind='applied' and not exists(select 1 from erp.trade_in_sale_payment_events r where r.reverses_event_id=a.id)) then raise exception using errcode='unique_violation',message='trade-in already funds an unreversed sale payment'; end if;
  payment_id:=erp.record_sale_payment(target_sale_id,method_id,null,payment_amount,operation_key||':payment',operation_reason,'trade-in:'||trade.id);
  insert into erp.trade_in_sale_payment_events(organization_id,branch_id,trade_in_id,sale_id,payment_id,event_kind,amount,actor_id) values(org_id,trade.branch_id,trade.id,target_sale_id,payment_id,'applied',payment_amount,auth.uid()) returning id into event_id;
  perform erp.complete_stage7_command(cmd.id,event_id);
  return payment_id;
end $$;

create or replace function erp.reverse_trade_in_sale_payment(target_payment_id uuid,operation_key text,operation_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); original erp.trade_in_sale_payment_events%rowtype; trade erp.trade_ins%rowtype; cmd erp.stage7_commands%rowtype; reversal_payment uuid; event_id uuid;
begin
  select a.* into original from erp.trade_in_sale_payment_events a where a.payment_id=target_payment_id and a.organization_id=org_id and a.event_kind='applied';
  if original.id is null then raise exception using errcode='object_not_in_prerequisite_state',message='reversible trade-in payment is required'; end if;
  select * into trade from erp.trade_ins where id=original.trade_in_id and organization_id=org_id for update;
  select * into original from erp.trade_in_sale_payment_events where id=original.id for update;
  if not erp.has_permission('trade_ins.manage',original.branch_id) or nullif(btrim(operation_reason),'') is null then raise exception using errcode='insufficient_privilege',message='trade_ins.manage permission and reason are required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  cmd:=erp.claim_stage7_command('trade_in.sale_payment.reverse',org_id,original.branch_id,operation_key,jsonb_build_object('payment_id',target_payment_id,'event_id',original.id,'reason',operation_reason));
  if cmd.result_id is not null then return (select payment_id from erp.trade_in_sale_payment_events where id=cmd.result_id); end if;
  if exists(select 1 from erp.trade_in_sale_payment_events where reverses_event_id=original.id) then raise exception using errcode='object_not_in_prerequisite_state',message='trade-in payment is already reversed'; end if;
  reversal_payment:=erp.reverse_sale_payment_stage7_core(target_payment_id,operation_key||':payment',operation_reason,null);
  insert into erp.trade_in_sale_payment_events(organization_id,branch_id,trade_in_id,sale_id,payment_id,event_kind,reverses_event_id,amount,actor_id) values(org_id,original.branch_id,original.trade_in_id,original.sale_id,reversal_payment,'reversed',original.id,-original.amount,auth.uid()) returning id into event_id;
  perform erp.complete_stage7_command(cmd.id,event_id);
  return reversal_payment;
end $$;

create or replace function erp.get_pc_build_costs(target_completion_id uuid)
returns table(component_id uuid,quantity numeric,unit_cost_snapshot numeric) language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); branch uuid;
begin select branch_id into branch from erp.pc_build_completions where id=target_completion_id and organization_id=org_id; if branch is null or not erp.has_permission('pc_builds.view',branch) or not erp.has_permission('costs.view',branch) then raise exception using errcode='insufficient_privilege',message='pc_builds.view and costs.view are required'; end if; insert into erp.audit_events(organization_id,branch_id,actor_user_id,schema_name,table_name,record_id,action,metadata) values(org_id,branch,auth.uid(),'erp','pc_component_lineage',target_completion_id::text,'read_sensitive',jsonb_build_object('costs',true,'redacted',true)); return query select l.component_id,l.quantity,l.unit_cost_snapshot from erp.pc_component_lineage l where l.completion_id=target_completion_id and l.organization_id=org_id order by l.component_id; end $$;

create or replace function erp.get_trade_in_costs(target_trade_in_id uuid)
returns table(intake_declared_value_base numeric,accepted_value_base numeric,refurbishment_cost_base numeric,total_cost_base numeric) language plpgsql security definer set search_path=pg_catalog,erp as $$
declare org_id uuid:=erp.current_organization_id(); branch uuid;
begin select branch_id into branch from erp.trade_ins where id=target_trade_in_id and organization_id=org_id; if branch is null or not erp.has_permission('trade_ins.view',branch) or not erp.has_permission('costs.view',branch) then raise exception using errcode='insufficient_privilege',message='trade_ins.view and costs.view are required'; end if; insert into erp.audit_events(organization_id,branch_id,actor_user_id,schema_name,table_name,record_id,action,metadata) values(org_id,branch,auth.uid(),'erp','trade_ins',target_trade_in_id::text,'read_sensitive',jsonb_build_object('costs',true,'redacted',true)); return query select t.declared_value_base,coalesce(r.accepted_value_base,(select e.appraised_value_base from erp.trade_in_evaluations e where e.trade_in_id=t.id order by e.version desc limit 1)),coalesce(r.refurbishment_cost_base,(select coalesce(sum(x.actual_cost_base),0) from erp.trade_in_refurbishments x where x.trade_in_id=t.id)),r.total_cost_base from erp.trade_ins t left join erp.trade_in_releases r on r.trade_in_id=t.id where t.id=target_trade_in_id and t.organization_id=org_id; end $$;

create or replace function erp.audit_stage7_fact()
returns trigger language plpgsql security definer set search_path=pg_catalog,erp as $$
begin insert into erp.audit_events(organization_id,branch_id,actor_user_id,schema_name,table_name,record_id,action,reason,metadata) values(new.organization_id,nullif(to_jsonb(new)->>'branch_id','')::uuid,auth.uid(),tg_table_schema,tg_table_name,coalesce(to_jsonb(new)->>'id',to_jsonb(new)->>'trade_in_id'),'insert',nullif(current_setting('erp.operation_reason',true),''),jsonb_build_object('redacted',true,'trigger',tg_name)); return null; end $$;

create or replace function erp.protect_stage7_seed_version()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin if tg_op='UPDATE' and current_setting('erp.allow_stage7_seed_update',true)='on' then return new; end if; raise exception using errcode='integrity_constraint_violation',message='versioned stage 7 configuration is immutable outside deterministic seed convergence'; end $$;

create or replace function erp.protect_pc_compatibility_run()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin if tg_op='UPDATE' and current_setting('erp.allow_pc_run_completion',true)='on' and old.outcome='pass' and (to_jsonb(new)-'outcome')=(to_jsonb(old)-'outcome') then return new; end if; raise exception using errcode='integrity_constraint_violation',message='PC compatibility runs are immutable'; end $$;

create or replace function erp.validate_trade_in_release()
returns trigger language plpgsql set search_path=pg_catalog,erp as $$
begin
  if not exists(
    select 1 from erp.stock_documents d
    join erp.locations l on l.id=new.destination_location_id and l.organization_id=new.organization_id
    where d.id=new.stock_document_id and d.organization_id=new.organization_id
      and d.branch_id=new.branch_id and d.kind='receipt'
      and d.source_type='trade_in' and d.source_id=new.trade_in_id
      and l.branch_id=new.branch_id and l.allows_sale
  ) then raise exception using errcode='foreign_key_violation',message='trade-in release stock document relationship is invalid'; end if;
  return new;
end $$;

create or replace function erp.validate_trade_in_sale_payment_event()
returns trigger language plpgsql set search_path=pg_catalog,erp as $$
declare payment erp.payments%rowtype; original erp.trade_in_sale_payment_events%rowtype;
begin
  select * into payment from erp.payments where id=new.payment_id and organization_id=new.organization_id;
  if payment.id is null or payment.sale_id is distinct from new.sale_id or payment.branch_id<>new.branch_id or payment.amount<>new.amount then
    raise exception using errcode='foreign_key_violation',message='trade-in payment event does not match its payment';
  end if;
  if new.event_kind='applied' then
    if payment.reversal_of_payment_id is not null or not exists(select 1 from erp.payment_methods m where m.id=payment.payment_method_id and m.organization_id=new.organization_id and m.code='TRADE_IN' and not m.requires_cash_session) then
      raise exception using errcode='check_violation',message='applied trade-in payment must use the non-cash TRADE_IN method';
    end if;
  else
    select * into original from erp.trade_in_sale_payment_events where id=new.reverses_event_id and organization_id=new.organization_id;
    if original.id is null or original.trade_in_id<>new.trade_in_id or original.sale_id<>new.sale_id or original.branch_id<>new.branch_id or payment.reversal_of_payment_id<>original.payment_id or new.amount<>-original.amount then
      raise exception using errcode='foreign_key_violation',message='trade-in payment reversal relationship is invalid';
    end if;
  end if;
  return new;
end $$;

create trigger trade_in_releases_relationship before insert on erp.trade_in_releases for each row execute function erp.validate_trade_in_release();
create trigger trade_in_payment_relationship before insert on erp.trade_in_sale_payment_events for each row execute function erp.validate_trade_in_sale_payment_event();

do $$ declare name text; begin
  foreach name in array array['stage7_commands','pc_compatibility_specs','pc_compatibility_spec_versions','pc_compatibility_rule_sets','pc_compatibility_rule_set_versions','pc_compatibility_rules','pc_test_templates','pc_test_template_versions','pc_build_projects','pc_build_state_events','pc_build_revisions','pc_build_components','pc_compatibility_runs','pc_compatibility_results','pc_build_reservations','pc_test_runs','pc_test_results','pc_build_completions','pc_component_lineage','trade_ins','trade_in_provenance_declarations','trade_in_provenance_evidence','trade_in_provenance_reviews','trade_in_imei_requests','trade_in_imei_results','trade_in_evaluations','trade_in_evaluation_reviews','trade_in_refurbishments','trade_in_releases','trade_in_sale_payment_events'] loop execute format('alter table erp.%I enable row level security',name); end loop;
  foreach name in array array['pc_build_projects','pc_build_state_events','pc_build_revisions','pc_build_components','pc_compatibility_results','pc_build_reservations','pc_test_runs','pc_test_results','pc_build_completions','pc_component_lineage','trade_ins','trade_in_provenance_declarations','trade_in_provenance_evidence','trade_in_provenance_reviews','trade_in_imei_requests','trade_in_imei_results','trade_in_evaluations','trade_in_evaluation_reviews','trade_in_refurbishments','trade_in_releases','trade_in_sale_payment_events'] loop execute format('create trigger %I_audit after insert on erp.%I for each row execute function erp.audit_stage7_fact()',name,name); execute format('create trigger %I_immutable before update or delete on erp.%I for each row execute function erp.prevent_fact_mutation()',name,name); end loop;
end $$;

create trigger pc_compatibility_runs_audit after insert on erp.pc_compatibility_runs for each row execute function erp.audit_stage7_fact();
create trigger pc_compatibility_runs_immutable before update or delete on erp.pc_compatibility_runs for each row execute function erp.protect_pc_compatibility_run();

create trigger pc_spec_versions_immutable before update or delete on erp.pc_compatibility_spec_versions for each row execute function erp.protect_stage7_seed_version();
create trigger pc_rule_set_versions_immutable before update or delete on erp.pc_compatibility_rule_set_versions for each row execute function erp.protect_stage7_seed_version();
create trigger pc_rules_immutable before update or delete on erp.pc_compatibility_rules for each row execute function erp.protect_stage7_seed_version();
create trigger pc_test_versions_immutable before update or delete on erp.pc_test_template_versions for each row execute function erp.protect_stage7_seed_version();

create policy pc_config_select on erp.pc_compatibility_specs for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('pc_builds.view'));
create policy pc_spec_versions_select on erp.pc_compatibility_spec_versions for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('pc_builds.view'));
create policy pc_rule_sets_select on erp.pc_compatibility_rule_sets for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('pc_builds.view'));
create policy pc_rule_versions_select on erp.pc_compatibility_rule_set_versions for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('pc_builds.view'));
create policy pc_rules_select on erp.pc_compatibility_rules for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('pc_builds.view'));
create policy pc_templates_select on erp.pc_test_templates for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('pc_builds.view'));
create policy pc_template_versions_select on erp.pc_test_template_versions for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('pc_builds.view'));
create policy pc_projects_select on erp.pc_build_projects for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('pc_builds.view',branch_id));
create policy pc_states_select on erp.pc_build_state_events for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('pc_builds.view',branch_id));
create policy pc_revisions_select on erp.pc_build_revisions for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('pc_builds.view',branch_id));
create policy pc_components_select on erp.pc_build_components for select to authenticated using(organization_id=erp.current_organization_id() and exists(select 1 from erp.pc_build_revisions r where r.id=revision_id and r.organization_id=pc_build_components.organization_id and erp.has_permission('pc_builds.view',r.branch_id)));
create policy pc_runs_select on erp.pc_compatibility_runs for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('pc_builds.view',branch_id));
create policy pc_results_select on erp.pc_compatibility_results for select to authenticated using(organization_id=erp.current_organization_id() and exists(select 1 from erp.pc_compatibility_runs r where r.id=run_id and r.organization_id=pc_compatibility_results.organization_id and erp.has_permission('pc_builds.view',r.branch_id)));
create policy pc_reservations_select on erp.pc_build_reservations for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('pc_builds.view',branch_id));
create policy pc_tests_select on erp.pc_test_runs for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('pc_builds.view',branch_id));
create policy pc_test_results_select on erp.pc_test_results for select to authenticated using(organization_id=erp.current_organization_id() and exists(select 1 from erp.pc_test_runs r where r.id=test_run_id and r.organization_id=pc_test_results.organization_id and erp.has_permission('pc_builds.view',r.branch_id)));
create policy pc_completions_select on erp.pc_build_completions for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('pc_builds.view',branch_id));
create policy pc_lineage_select on erp.pc_component_lineage for select to authenticated using(organization_id=erp.current_organization_id() and exists(select 1 from erp.pc_build_completions c where c.id=completion_id and c.organization_id=pc_component_lineage.organization_id and erp.has_permission('pc_builds.view',c.branch_id)));
create policy trade_ins_select on erp.trade_ins for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('trade_ins.view',branch_id));
create policy trade_provenance_select on erp.trade_in_provenance_declarations for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('trade_ins.view',branch_id));
create policy trade_evidence_select on erp.trade_in_provenance_evidence for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('trade_ins.view',branch_id));
create policy trade_provenance_reviews_select on erp.trade_in_provenance_reviews for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('trade_ins.view',branch_id));
create policy trade_imei_results_select on erp.trade_in_imei_results for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('trade_ins.view',branch_id));
create policy trade_evaluations_select on erp.trade_in_evaluations for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('trade_ins.view',branch_id));
create policy trade_eval_reviews_select on erp.trade_in_evaluation_reviews for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('trade_ins.view',branch_id));
create policy trade_refurb_select on erp.trade_in_refurbishments for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('trade_ins.view',branch_id));
create policy trade_releases_select on erp.trade_in_releases for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('trade_ins.view',branch_id));
create policy trade_payments_select on erp.trade_in_sale_payment_events for select to authenticated using(organization_id=erp.current_organization_id() and erp.has_permission('trade_ins.view',branch_id));

revoke all on erp.stage7_commands,erp.pc_compatibility_specs,erp.pc_compatibility_spec_versions,erp.pc_compatibility_rule_sets,erp.pc_compatibility_rule_set_versions,erp.pc_compatibility_rules,erp.pc_test_templates,erp.pc_test_template_versions,erp.pc_build_projects,erp.pc_build_state_events,erp.pc_build_revisions,erp.pc_build_components,erp.pc_compatibility_runs,erp.pc_compatibility_results,erp.pc_build_reservations,erp.pc_test_runs,erp.pc_test_results,erp.pc_build_completions,erp.pc_component_lineage,erp.trade_ins,erp.trade_in_provenance_declarations,erp.trade_in_provenance_evidence,erp.trade_in_provenance_reviews,erp.trade_in_imei_requests,erp.trade_in_imei_results,erp.trade_in_evaluations,erp.trade_in_evaluation_reviews,erp.trade_in_refurbishments,erp.trade_in_releases,erp.trade_in_sale_payment_events from public,authenticated,service_role;
grant select on erp.pc_compatibility_specs,erp.pc_compatibility_spec_versions,erp.pc_compatibility_rule_sets,erp.pc_compatibility_rule_set_versions,erp.pc_compatibility_rules,erp.pc_test_templates,erp.pc_test_template_versions,erp.pc_build_projects,erp.pc_build_state_events,erp.pc_build_revisions,erp.pc_compatibility_runs,erp.pc_build_reservations,erp.pc_test_runs,erp.pc_test_results,erp.pc_build_completions,erp.trade_ins,erp.trade_in_provenance_declarations,erp.trade_in_provenance_reviews,erp.trade_in_evaluation_reviews,erp.trade_in_sale_payment_events to authenticated,service_role;
grant select(id,organization_id,revision_id,line_number,slot_code,product_id,variant_id,inventory_unit_id,quantity,specification_snapshot,warranty_snapshot) on erp.pc_build_components to authenticated,service_role;
grant select(id,organization_id,run_id,rule_id,result_code,outcome,message,details) on erp.pc_compatibility_results to authenticated,service_role;
grant select(id,organization_id,completion_id,component_id,product_id,variant_id,inventory_unit_id,quantity,warranty_snapshot) on erp.pc_component_lineage to authenticated,service_role;
grant select(id,organization_id,branch_id,trade_in_id,evidence_type,metadata,captured_at,captured_by) on erp.trade_in_provenance_evidence to authenticated,service_role;
grant select(id,organization_id,branch_id,trade_in_id,source,status,checked_at,checked_by) on erp.trade_in_imei_results to authenticated,service_role;
grant select(id,organization_id,branch_id,trade_in_id,version,supersedes_evaluation_id,condition_snapshot,created_at,created_by) on erp.trade_in_evaluations to authenticated,service_role;
grant select(id,organization_id,branch_id,trade_in_id,repair_order_id,description,completed_at,created_at,created_by) on erp.trade_in_refurbishments to authenticated,service_role;
grant select(id,organization_id,branch_id,trade_in_id,evaluation_id,stock_document_id,destination_location_id,released_at,released_by) on erp.trade_in_releases to authenticated,service_role;
grant select on erp.stage7_commands to service_role;

revoke all on function erp.claim_stage7_command(text,uuid,uuid,text,jsonb),erp.complete_stage7_command(uuid,uuid),erp.protect_stage7_command(),erp.audit_stage7_fact(),erp.protect_stage7_seed_version(),erp.protect_pc_compatibility_run(),erp.assert_pc_project_mutable(uuid,uuid),erp.validate_trade_in_release(),erp.validate_trade_in_sale_payment_event(),erp.post_stock_document_stage7_core(erp.stock_document_kind,uuid,text,text,jsonb,boolean,text,uuid),erp.reverse_stock_document_stage7_core(uuid,text,text),erp.reverse_sale_payment_stage7_core(uuid,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function erp.get_trade_in_imei_provider_request(uuid),erp.record_trade_in_imei_provider_result(uuid,erp.imei_check_status,text,jsonb,text) from public,anon,authenticated;
grant execute on function erp.get_trade_in_imei_provider_request(uuid),erp.record_trade_in_imei_provider_result(uuid,erp.imei_check_status,text,jsonb,text) to service_role;

revoke all on function erp.get_pc_build_costs(uuid),erp.get_trade_in_costs(uuid) from public,anon,service_role;
grant execute on function erp.get_pc_build_costs(uuid),erp.get_trade_in_costs(uuid) to authenticated;

revoke all on function erp.create_pc_build_project(uuid,uuid,text,text,text,text),erp.create_pc_build_revision(uuid,uuid,uuid,jsonb,jsonb,text,text),erp.record_pc_compatibility_run(uuid,text,text),erp.reserve_pc_build_components(uuid,uuid,timestamptz,jsonb,text,text),erp.record_pc_test_run(uuid,uuid,jsonb,text,text),erp.complete_pc_build(uuid,uuid,uuid,text,jsonb,text,text),erp.create_trade_in(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,numeric,text,text),erp.review_trade_in_provenance(uuid,erp.trade_in_review_decision,text),erp.request_trade_in_imei_check(uuid,text,text,text),erp.record_trade_in_imei_manual_fallback(uuid,erp.imei_check_status,jsonb,text,text),erp.create_trade_in_evaluation(uuid,jsonb,numeric,numeric,text,text),erp.review_trade_in_evaluation(uuid,erp.trade_in_review_decision,text),erp.record_trade_in_refurbishment(uuid,uuid,text,numeric,boolean,text,text),erp.release_trade_in_to_stock(uuid,uuid,text,text),erp.apply_trade_in_sale_payment(uuid,uuid,numeric,text,text),erp.reverse_trade_in_sale_payment(uuid,text,text) from public,anon,service_role;
grant execute on function erp.create_pc_build_project(uuid,uuid,text,text,text,text),erp.create_pc_build_revision(uuid,uuid,uuid,jsonb,jsonb,text,text),erp.record_pc_compatibility_run(uuid,text,text),erp.reserve_pc_build_components(uuid,uuid,timestamptz,jsonb,text,text),erp.record_pc_test_run(uuid,uuid,jsonb,text,text),erp.complete_pc_build(uuid,uuid,uuid,text,jsonb,text,text),erp.create_trade_in(uuid,uuid,uuid,uuid,text,text,text,text,jsonb,numeric,text,text),erp.review_trade_in_provenance(uuid,erp.trade_in_review_decision,text),erp.request_trade_in_imei_check(uuid,text,text,text),erp.record_trade_in_imei_manual_fallback(uuid,erp.imei_check_status,jsonb,text,text),erp.create_trade_in_evaluation(uuid,jsonb,numeric,numeric,text,text),erp.review_trade_in_evaluation(uuid,erp.trade_in_review_decision,text),erp.record_trade_in_refurbishment(uuid,uuid,text,numeric,boolean,text,text),erp.release_trade_in_to_stock(uuid,uuid,text,text),erp.apply_trade_in_sale_payment(uuid,uuid,numeric,text,text),erp.reverse_trade_in_sale_payment(uuid,text,text) to authenticated;
revoke all on function erp.post_stock_document(erp.stock_document_kind,uuid,text,text,jsonb,boolean,text,uuid) from public,anon,service_role;
grant execute on function erp.post_stock_document(erp.stock_document_kind,uuid,text,text,jsonb,boolean,text,uuid) to authenticated;
revoke all on function erp.reverse_stock_document(uuid,text,text),erp.reverse_sale_payment(uuid,text,text,uuid) from public,anon,service_role;
grant execute on function erp.reverse_stock_document(uuid,text,text),erp.reverse_sale_payment(uuid,text,text,uuid) to authenticated;

comment on table erp.trade_in_imei_requests is 'Encrypted IMEI provider queue. Direct table access is service metadata only; decrypted values require the audited service-role RPC.';
comment on function erp.record_trade_in_imei_manual_fallback(uuid,erp.imei_check_status,jsonb,text,text) is 'Documented fallback only after provider error/unavailability, or not-required when no IMEI exists. It never overrides a blocked result.';
comment on table erp.pc_component_lineage is 'Immutable component identity, serial, cost and warranty lineage frozen when the build reservation is cost-integrated and fulfilled.';
