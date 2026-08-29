create type erp.document_status as enum ('issued', 'voided');
create type erp.fiscal_status as enum ('queued', 'authorized', 'rejected', 'failed');
create type erp.communication_channel as enum ('whatsapp', 'email');
create type erp.communication_direction as enum ('inbound', 'outbound');
create type erp.communication_status as enum ('queued', 'sent', 'delivered', 'read', 'failed');

create table erp.stage8_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  command_name text not null check (btrim(command_name) <> ''),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint stage8_commands_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint stage8_commands_operation_unique unique (organization_id, branch_id, command_name, idempotency_key)
);

create table erp.document_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  code text not null check (code ~ '^[A-Z0-9_]{2,80}$'),
  name text not null check (btrim(name) <> '' and length(name) <= 200),
  document_kind text not null check (document_kind in ('sale', 'payment', 'repair', 'warranty', 'pc_build', 'trade_in')),
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint document_templates_id_org_unique unique (id, organization_id),
  constraint document_templates_code_unique unique (organization_id, code)
);

create table erp.document_template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  template_id uuid not null,
  version integer not null check (version > 0),
  definition jsonb not null check (jsonb_typeof(definition) = 'object' and pg_column_size(definition) <= 262144),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint document_template_versions_id_org_unique unique (id, organization_id),
  constraint document_template_versions_template_fk foreign key (template_id, organization_id)
    references erp.document_templates(id, organization_id) on delete restrict,
  constraint document_template_versions_number_unique unique (template_id, version)
);

create table erp.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  template_version_id uuid not null,
  owner_type text not null check (owner_type in ('sale', 'payment', 'repair', 'warranty', 'pc_build', 'trade_in')),
  owner_id uuid not null,
  document_number text not null check (btrim(document_number) <> '' and length(document_number) <= 120),
  customer_snapshot jsonb not null check (jsonb_typeof(customer_snapshot) = 'object' and pg_column_size(customer_snapshot) <= 524288),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  private_object_path text check (private_object_path is null or (btrim(private_object_path) <> '' and length(private_object_path) <= 1000)),
  status erp.document_status not null default 'issued',
  issued_at timestamptz not null default clock_timestamp(),
  issued_by uuid references auth.users(id) on delete restrict,
  constraint documents_id_org_unique unique (id, organization_id),
  constraint documents_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint documents_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint documents_template_fk foreign key (template_version_id, organization_id)
    references erp.document_template_versions(id, organization_id) on delete restrict,
  constraint documents_number_unique unique (organization_id, branch_id, document_number),
  constraint documents_owner_template_unique unique (organization_id, owner_type, owner_id, template_version_id)
);

create table erp.document_events (
  id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  document_id uuid not null,
  status erp.document_status not null,
  reason text not null check (btrim(reason) <> '' and length(reason) <= 1000),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid references auth.users(id) on delete restrict,
  constraint document_events_document_fk foreign key (document_id, organization_id, branch_id)
    references erp.documents(id, organization_id, branch_id) on delete restrict,
  constraint document_events_status_unique unique (document_id, status)
);

create table erp.fiscal_points (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  code integer not null check (code between 1 and 99999),
  name text not null check (btrim(name) <> '' and length(name) <= 160),
  environment text not null check (environment in ('local_stub', 'testing', 'production')),
  is_active boolean not null default true,
  constraint fiscal_points_id_org_unique unique (id, organization_id),
  constraint fiscal_points_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint fiscal_points_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint fiscal_points_code_unique unique (organization_id, code)
);

create table erp.fiscal_counters (
  organization_id uuid not null,
  fiscal_point_id uuid not null,
  voucher_type text not null check (voucher_type ~ '^[A-Z0-9_]{1,40}$'),
  last_number bigint not null default 0 check (last_number >= 0),
  primary key (fiscal_point_id, voucher_type),
  constraint fiscal_counters_point_fk foreign key (fiscal_point_id, organization_id)
    references erp.fiscal_points(id, organization_id) on delete restrict
);

create table erp.fiscal_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  document_id uuid not null unique,
  fiscal_point_id uuid not null,
  voucher_type text not null,
  voucher_number bigint not null check (voucher_number > 0),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz not null default clock_timestamp(),
  requested_by uuid references auth.users(id) on delete restrict,
  constraint fiscal_requests_id_org_unique unique (id, organization_id),
  constraint fiscal_requests_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint fiscal_requests_document_fk foreign key (document_id, organization_id, branch_id)
    references erp.documents(id, organization_id, branch_id) on delete restrict,
  constraint fiscal_requests_point_fk foreign key (fiscal_point_id, organization_id, branch_id)
    references erp.fiscal_points(id, organization_id, branch_id) on delete restrict,
  constraint fiscal_requests_number_unique unique (organization_id, fiscal_point_id, voucher_type, voucher_number)
);

create table erp.fiscal_events (
  id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  fiscal_request_id uuid not null,
  provider text not null check (btrim(provider) <> '' and length(provider) <= 80),
  provider_event_id text not null check (btrim(provider_event_id) <> '' and length(provider_event_id) <= 200),
  status erp.fiscal_status not null,
  cae text check (cae is null or cae ~ '^[0-9]{10,20}$'),
  cae_expires_on date,
  response_sha256 text not null check (response_sha256 ~ '^[0-9a-f]{64}$'),
  error_code text check (error_code is null or length(error_code) <= 120),
  error_message text check (error_message is null or length(error_message) <= 4000),
  occurred_at timestamptz not null default clock_timestamp(),
  constraint fiscal_events_request_fk foreign key (fiscal_request_id, organization_id, branch_id)
    references erp.fiscal_requests(id, organization_id, branch_id) on delete restrict,
  constraint fiscal_events_provider_unique unique (organization_id, provider, provider_event_id),
  constraint fiscal_events_authorized_shape check (
    (status = 'authorized' and cae is not null and cae_expires_on is not null and error_code is null and error_message is null)
    or (status in ('rejected','failed') and cae is null and cae_expires_on is null and (error_code is not null or error_message is not null))
  )
);

create table erp.communication_consents (
  id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  customer_id uuid not null,
  channel erp.communication_channel not null,
  granted boolean not null,
  source text not null check (btrim(source) <> '' and length(source) <= 120),
  reason text not null check (btrim(reason) <> '' and length(reason) <= 1000),
  recorded_at timestamptz not null default clock_timestamp(),
  recorded_by uuid references auth.users(id) on delete restrict,
  constraint communication_consents_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint communication_consents_customer_fk foreign key (customer_id, organization_id)
    references erp.customers(id, organization_id) on delete restrict
);

create table erp.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  code text not null check (code ~ '^[A-Z0-9_]{2,80}$'),
  channel erp.communication_channel not null,
  name text not null check (btrim(name) <> '' and length(name) <= 200),
  is_active boolean not null default true,
  constraint message_templates_id_org_unique unique (id, organization_id),
  constraint message_templates_code_unique unique (organization_id, channel, code)
);

create table erp.message_template_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  template_id uuid not null,
  version integer not null check (version > 0),
  provider_template_name text,
  language_code text not null default 'es_AR' check (language_code ~ '^[a-z]{2}_[A-Z]{2}$'),
  body text not null check (btrim(body) <> '' and length(body) <= 16000),
  variable_keys jsonb not null default '[]' check (jsonb_typeof(variable_keys) = 'array' and jsonb_array_length(variable_keys) <= 50),
  created_at timestamptz not null default clock_timestamp(),
  constraint message_template_versions_id_org_unique unique (id, organization_id),
  constraint message_template_versions_template_fk foreign key (template_id, organization_id)
    references erp.message_templates(id, organization_id) on delete restrict,
  constraint message_template_versions_number_unique unique (template_id, version)
);

create table erp.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  customer_id uuid,
  channel erp.communication_channel not null,
  provider_conversation_id text,
  opened_at timestamptz not null default clock_timestamp(),
  closed_at timestamptz,
  constraint conversations_id_org_unique unique (id, organization_id),
  constraint conversations_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint conversations_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint conversations_customer_fk foreign key (customer_id, organization_id)
    references erp.customers(id, organization_id) on delete restrict,
  constraint conversations_provider_unique unique (organization_id, channel, provider_conversation_id),
  constraint conversations_close_order check (closed_at is null or closed_at >= opened_at)
);

create table erp.conversation_assignments (
  id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  conversation_id uuid not null,
  assigned_user_id uuid references auth.users(id) on delete restrict,
  reason text not null check (btrim(reason) <> ''),
  assigned_at timestamptz not null default clock_timestamp(),
  assigned_by uuid references auth.users(id) on delete restrict,
  constraint conversation_assignments_conversation_fk foreign key (conversation_id, organization_id, branch_id)
    references erp.conversations(id, organization_id, branch_id) on delete restrict
);

create table erp.communication_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  conversation_id uuid not null,
  customer_id uuid,
  channel erp.communication_channel not null,
  direction erp.communication_direction not null,
  template_version_id uuid,
  recipient_address text,
  body_snapshot text not null check (length(body_snapshot) between 1 and 16000),
  variables_snapshot jsonb not null default '{}' check (jsonb_typeof(variables_snapshot) = 'object' and pg_column_size(variables_snapshot) <= 131072),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id) on delete restrict,
  constraint communication_messages_id_org_unique unique (id, organization_id),
  constraint communication_messages_id_org_branch_unique unique (id, organization_id, branch_id),
  constraint communication_messages_conversation_fk foreign key (conversation_id, organization_id, branch_id)
    references erp.conversations(id, organization_id, branch_id) on delete restrict,
  constraint communication_messages_customer_fk foreign key (customer_id, organization_id)
    references erp.customers(id, organization_id) on delete restrict,
  constraint communication_messages_template_fk foreign key (template_version_id, organization_id)
    references erp.message_template_versions(id, organization_id) on delete restrict
);

create table erp.communication_message_events (
  id uuid primary key default gen_random_uuid(),
  event_sequence bigint generated always as identity unique,
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  message_id uuid not null,
  status erp.communication_status not null,
  provider text,
  provider_event_id text,
  provider_message_id text,
  response_sha256 text,
  error_message text check (error_message is null or length(error_message) <= 4000),
  occurred_at timestamptz not null default clock_timestamp(),
  constraint communication_message_events_message_fk foreign key (message_id, organization_id, branch_id)
    references erp.communication_messages(id, organization_id, branch_id) on delete restrict,
  constraint communication_message_events_provider_unique unique (organization_id, provider, provider_event_id),
  constraint communication_message_events_digest check (response_sha256 is null or response_sha256 ~ '^[0-9a-f]{64}$'),
  constraint communication_message_events_provider_shape check (
    (status='queued' and provider is null and provider_event_id is null and provider_message_id is null and response_sha256 is null and error_message is null)
    or (status='failed' and nullif(btrim(provider),'') is not null and nullif(btrim(provider_event_id),'') is not null and response_sha256 is not null and nullif(btrim(error_message),'') is not null)
    or (status in('sent','delivered','read') and nullif(btrim(provider),'') is not null and nullif(btrim(provider_event_id),'') is not null and nullif(btrim(provider_message_id),'') is not null and response_sha256 is not null and error_message is null)
  )
);

create table erp.communication_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  message_id uuid not null,
  private_object_path text not null check (btrim(private_object_path) <> '' and length(private_object_path) <= 1000),
  mime_type text not null check (mime_type ~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$'),
  byte_size bigint not null check (byte_size between 1 and 1073741824),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  constraint communication_attachments_message_fk foreign key (message_id, organization_id, branch_id)
    references erp.communication_messages(id, organization_id, branch_id) on delete restrict,
  constraint communication_attachments_path_unique unique (organization_id, private_object_path)
);

create table erp.provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  provider text not null check (btrim(provider) <> '' and length(provider) <= 80),
  provider_event_id text not null check (btrim(provider_event_id) <> '' and length(provider_event_id) <= 200),
  event_type text not null check (btrim(event_type) <> '' and length(event_type) <= 120),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  signature_valid boolean not null,
  received_at timestamptz not null default clock_timestamp(),
  constraint provider_webhook_events_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint provider_webhook_events_unique unique (organization_id, provider, provider_event_id)
);

alter table erp.integration_outbox
  add constraint integration_outbox_id_org_branch_unique unique (id, organization_id, branch_id);

create table erp.integration_dead_letters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  outbox_id uuid not null unique,
  reason text not null check (btrim(reason) <> '' and length(reason) <= 4000),
  moved_at timestamptz not null default clock_timestamp(),
  moved_by uuid references auth.users(id) on delete restrict,
  constraint integration_dead_letters_outbox_fk foreign key (outbox_id, organization_id, branch_id)
    references erp.integration_outbox(id, organization_id, branch_id) on delete restrict
);

create table erp.communication_automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid,
  code text not null check (code ~ '^[A-Z0-9_]{2,80}$'),
  event_type text not null check (btrim(event_type) <> '' and length(event_type) <= 120),
  template_version_id uuid not null,
  conditions jsonb not null default '{}' check (jsonb_typeof(conditions) = 'object' and pg_column_size(conditions) <= 131072),
  is_active boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references auth.users(id) on delete restrict,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id) on delete restrict,
  constraint communication_automation_rules_id_org_unique unique (id, organization_id),
  constraint communication_automation_rules_branch_fk foreign key (branch_id, organization_id)
    references erp.branches(id, organization_id) on delete restrict,
  constraint communication_automation_rules_template_fk foreign key (template_version_id, organization_id)
    references erp.message_template_versions(id, organization_id) on delete restrict,
  constraint communication_automation_rules_code_unique unique nulls not distinct (organization_id, branch_id, code)
);

create table erp.communication_automation_executions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references erp.organizations(id) on delete restrict,
  branch_id uuid not null,
  rule_id uuid not null,
  source_event_type text not null check (btrim(source_event_type) <> ''),
  source_event_id uuid not null,
  message_id uuid,
  outcome text not null check (outcome in ('queued','skipped','failed')),
  reason text not null check (btrim(reason) <> '' and length(reason) <= 1000),
  executed_at timestamptz not null default clock_timestamp(),
  constraint communication_automation_executions_rule_fk foreign key (rule_id, organization_id)
    references erp.communication_automation_rules(id, organization_id) on delete restrict,
  constraint communication_automation_executions_message_fk foreign key (message_id, organization_id, branch_id)
    references erp.communication_messages(id, organization_id, branch_id) on delete restrict,
  constraint communication_automation_executions_source_unique unique (rule_id, source_event_type, source_event_id)
);

create unique index communication_message_events_provider_message_status_unique
  on erp.communication_message_events (organization_id, provider, provider_message_id, status)
  where provider_message_id is not null;

create index fiscal_events_request_sequence_idx
  on erp.fiscal_events (fiscal_request_id, event_sequence desc);
create index document_events_document_sequence_idx
  on erp.document_events (document_id, event_sequence desc);
create index communication_consents_customer_channel_sequence_idx
  on erp.communication_consents (organization_id, customer_id, channel, event_sequence desc);
create index communication_message_events_message_sequence_idx
  on erp.communication_message_events (message_id, event_sequence desc);
create index conversation_assignments_conversation_sequence_idx
  on erp.conversation_assignments (conversation_id, event_sequence desc);

create or replace function erp.claim_stage8_command(command text, target_organization_id uuid, target_branch_id uuid, operation_key text, request_body jsonb)
returns erp.stage8_commands language plpgsql security definer set search_path = pg_catalog, erp, extensions as $$
declare row_value erp.stage8_commands%rowtype; expected text;
begin
  if nullif(btrim(command),'') is null or nullif(btrim(operation_key),'') is null or request_body is null or pg_column_size(request_body) > 1048576 then raise exception using errcode='invalid_parameter_value',message='bounded command data is required'; end if;
  expected := encode(extensions.digest(convert_to(request_body::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(target_organization_id::text||':'||target_branch_id::text||':'||command||':'||operation_key,0));
  select * into row_value from erp.stage8_commands where organization_id=target_organization_id and branch_id=target_branch_id and command_name=command and idempotency_key=operation_key;
  if found then if row_value.request_hash<>expected then raise exception using errcode='integrity_constraint_violation',message='idempotency key is already used by another request'; end if; return row_value; end if;
  insert into erp.stage8_commands(organization_id,branch_id,command_name,idempotency_key,request_hash,created_by) values(target_organization_id,target_branch_id,command,operation_key,expected,auth.uid()) returning * into row_value; return row_value;
end $$;

create or replace function erp.complete_stage8_command(command_id uuid, command_result_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog, erp as $$
begin perform set_config('erp.allow_stage8_command_completion','on',true); update erp.stage8_commands set result_id=command_result_id where id=command_id and result_id is null; perform set_config('erp.allow_stage8_command_completion','off',true); if not found then raise exception using errcode='data_exception',message='command completion failed'; end if; end $$;

create or replace function erp.protect_stage8_command()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin if tg_op='UPDATE' and current_setting('erp.allow_stage8_command_completion',true)='on' and old.result_id is null and new.result_id is not null and (to_jsonb(new)-'result_id')=(to_jsonb(old)-'result_id') then return new; end if; raise exception using errcode='integrity_constraint_violation',message='stage 8 commands are immutable'; end $$;

create trigger stage8_commands_immutable before update or delete on erp.stage8_commands for each row execute function erp.protect_stage8_command();

create or replace function erp.stage8_json_has_forbidden_key(value jsonb, forbidden_keys text[])
returns boolean language sql immutable set search_path = pg_catalog as $$
  select case jsonb_typeof(value)
    when 'object' then exists (
      select 1 from jsonb_each(value) as item(key, child)
      where lower(item.key) = any(forbidden_keys)
         or erp.stage8_json_has_forbidden_key(item.child, forbidden_keys)
    )
    when 'array' then exists (
      select 1 from jsonb_array_elements(value) as item(child)
      where erp.stage8_json_has_forbidden_key(item.child, forbidden_keys)
    )
    else false
  end
$$;

create or replace function erp.create_document_template_version(target_template_id uuid, definition jsonb, operation_key text, operation_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare org_id uuid:=erp.current_organization_id(); cmd erp.stage8_commands%rowtype; result_id uuid:=gen_random_uuid(); next_version integer; command_branch_id uuid;
begin
  select id into command_branch_id from erp.branches where organization_id=org_id and is_active order by id limit 1;
  if org_id is null or command_branch_id is null or not erp.has_permission('documents.issue') or definition is null or jsonb_typeof(definition)<>'object' or pg_column_size(definition)>262144 or nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='active template, bounded definition, permission and reason are required'; end if;
  perform 1 from erp.document_templates where id=target_template_id and organization_id=org_id and is_active for update;
  if not found then raise exception using errcode='object_not_in_prerequisite_state',message='active template, bounded definition, permission and reason are required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  cmd:=erp.claim_stage8_command('document.template.version',org_id,command_branch_id,operation_key,jsonb_build_object('template_id',target_template_id,'definition',definition,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  select coalesce(max(version),0)+1 into next_version from erp.document_template_versions where template_id=target_template_id;
  insert into erp.document_template_versions(id,organization_id,template_id,version,definition,created_by) values(result_id,org_id,target_template_id,next_version,definition,auth.uid());
  perform erp.complete_stage8_command(cmd.id,result_id); return result_id;
end $$;

create or replace function erp.create_message_template_version(target_template_id uuid, provider_template_name text, language_code text, body text, variable_keys jsonb, operation_key text, operation_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare org_id uuid:=erp.current_organization_id(); cmd erp.stage8_commands%rowtype; result_id uuid:=gen_random_uuid(); next_version integer; command_branch_id uuid;
begin
  select id into command_branch_id from erp.branches where organization_id=org_id and is_active order by id limit 1;
  if org_id is null or command_branch_id is null or not erp.has_permission('messages.manage') or nullif(btrim(language_code),'') is null or language_code !~ '^[a-z]{2}_[A-Z]{2}$' or nullif(btrim(body),'') is null or length(body)>16000 or variable_keys is null or jsonb_typeof(variable_keys)<>'array' or jsonb_array_length(variable_keys)>50 or exists(select 1 from jsonb_array_elements(variable_keys) as item(value) where jsonb_typeof(item.value)<>'string' or btrim(item.value#>>'{}')='' or length(item.value#>>'{}')>80) or (select count(*) from jsonb_array_elements_text(variable_keys))<>(select count(distinct item.value) from jsonb_array_elements_text(variable_keys) as item(value)) or nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='active template, bounded message definition, permission and reason are required'; end if;
  perform 1 from erp.message_templates where id=target_template_id and organization_id=org_id and is_active for update;
  if not found then raise exception using errcode='object_not_in_prerequisite_state',message='active template, bounded message definition, permission and reason are required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  cmd:=erp.claim_stage8_command('message.template.version',org_id,command_branch_id,operation_key,jsonb_build_object('template_id',target_template_id,'provider_template_name',provider_template_name,'language_code',language_code,'body',body,'variable_keys',variable_keys,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  select coalesce(max(version),0)+1 into next_version from erp.message_template_versions where template_id=target_template_id;
  insert into erp.message_template_versions(id,organization_id,template_id,version,provider_template_name,language_code,body,variable_keys) values(result_id,org_id,target_template_id,next_version,nullif(btrim(provider_template_name),''),language_code,body,variable_keys);
  perform erp.complete_stage8_command(cmd.id,result_id); return result_id;
end $$;

create or replace function erp.issue_document(target_branch_id uuid, target_template_version_id uuid, owner_type text, owner_id uuid, document_number text, customer_snapshot jsonb, content_sha256 text, private_object_path text, operation_key text, operation_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare org_id uuid:=erp.current_organization_id(); cmd erp.stage8_commands%rowtype; result_id uuid:=gen_random_uuid(); template_kind text; canonical_path text;
begin
  if org_id is null or not erp.has_permission('documents.issue',target_branch_id) then raise exception using errcode='insufficient_privilege',message='documents.issue permission is required'; end if;
  if owner_type not in('sale','payment','repair','warranty','pc_build','trade_in') or nullif(btrim(document_number),'') is null or customer_snapshot is null or jsonb_typeof(customer_snapshot)<>'object' or pg_column_size(customer_snapshot)>524288 or content_sha256 !~ '^[0-9a-f]{64}$' or nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='bounded customer-safe document data and reason are required'; end if;
  if erp.stage8_json_has_forbidden_key(customer_snapshot,array['internal_notes','credentials','credential','costs','cost','unit_cost','base_cost','private_object_path','provider_payload','audit','imei','serial_number']) then raise exception using errcode='invalid_parameter_value',message='customer document snapshot contains internal fields'; end if;
  select t.document_kind into template_kind from erp.document_template_versions v join erp.document_templates t on t.id=v.template_id and t.organization_id=v.organization_id where v.id=target_template_version_id and v.organization_id=org_id and t.is_active;
  if template_kind is distinct from owner_type then raise exception using errcode='foreign_key_violation',message='active matching document template is required'; end if;
  if not (case owner_type when 'sale' then exists(select 1 from erp.sales x where x.id=owner_id and x.organization_id=org_id and x.branch_id=target_branch_id) when 'payment' then exists(select 1 from erp.payments x where x.id=owner_id and x.organization_id=org_id and x.branch_id=target_branch_id) when 'repair' then exists(select 1 from erp.repair_orders x where x.id=owner_id and x.organization_id=org_id and x.branch_id=target_branch_id) when 'warranty' then exists(select 1 from erp.repair_warranties x where x.id=owner_id and x.organization_id=org_id and x.branch_id=target_branch_id) when 'pc_build' then exists(select 1 from erp.pc_build_completions x where x.id=owner_id and x.organization_id=org_id and x.branch_id=target_branch_id) when 'trade_in' then exists(select 1 from erp.trade_in_releases x where x.id=owner_id and x.organization_id=org_id and x.branch_id=target_branch_id) else false end) then raise exception using errcode='foreign_key_violation',message='document owner is invalid'; end if;
  canonical_path:='documents/'||org_id||'/'||target_branch_id||'/'||owner_type||'/'||owner_id||'/'||content_sha256||'.pdf';
  if private_object_path is not null and btrim(private_object_path)<>canonical_path then raise exception using errcode='invalid_parameter_value',message='document object path must use the canonical private path'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  cmd:=erp.claim_stage8_command('document.issue',org_id,target_branch_id,operation_key,jsonb_build_object('template',target_template_version_id,'owner_type',owner_type,'owner_id',owner_id,'number',document_number,'snapshot',customer_snapshot,'digest',content_sha256,'path',canonical_path,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  insert into erp.documents(id,organization_id,branch_id,template_version_id,owner_type,owner_id,document_number,customer_snapshot,content_sha256,private_object_path,issued_by) values(result_id,org_id,target_branch_id,target_template_version_id,owner_type,owner_id,btrim(document_number),customer_snapshot,content_sha256,canonical_path,auth.uid());
  insert into erp.document_events(organization_id,branch_id,document_id,status,reason,actor_id) values(org_id,target_branch_id,result_id,'issued',operation_reason,auth.uid());
  perform erp.complete_stage8_command(cmd.id,result_id); return result_id;
end $$;

create or replace function erp.void_document(target_document_id uuid, operation_key text, operation_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare org_id uuid:=erp.current_organization_id(); document_row erp.documents%rowtype; cmd erp.stage8_commands%rowtype; result_id uuid;
begin
  select * into document_row from erp.documents where id=target_document_id and organization_id=org_id for update;
  if document_row.id is null or not erp.has_permission('documents.issue',document_row.branch_id) or nullif(btrim(operation_reason),'') is null then raise exception using errcode='object_not_in_prerequisite_state',message='issued document, permission and reason are required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  cmd:=erp.claim_stage8_command('document.void',org_id,document_row.branch_id,operation_key,jsonb_build_object('document_id',document_row.id,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  if exists(select 1 from erp.document_events where document_id=document_row.id and status='voided') then raise exception using errcode='object_not_in_prerequisite_state',message='document is already voided'; end if;
  insert into erp.document_events(organization_id,branch_id,document_id,status,reason,actor_id) values(org_id,document_row.branch_id,document_row.id,'voided',operation_reason,auth.uid()) returning id into result_id;
  perform erp.complete_stage8_command(cmd.id,result_id); return result_id;
end $$;

create or replace function erp.request_fiscal_issuance(target_document_id uuid, target_fiscal_point_id uuid, voucher_type text, operation_key text, operation_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp, extensions as $$
declare org_id uuid:=erp.current_organization_id(); document_row erp.documents%rowtype; point_row erp.fiscal_points%rowtype; cmd erp.stage8_commands%rowtype; next_number bigint; result_id uuid; digest text;
begin
  select * into document_row from erp.documents where id=target_document_id and organization_id=org_id for update;
  select * into point_row from erp.fiscal_points where id=target_fiscal_point_id and organization_id=org_id and branch_id=document_row.branch_id and is_active for update;
  if document_row.id is null or point_row.id is null or not erp.has_permission('documents.issue',document_row.branch_id) or voucher_type !~ '^[A-Z0-9_]{1,40}$' or nullif(btrim(operation_reason),'') is null or (select status from erp.document_events where document_id=document_row.id order by event_sequence desc limit 1) is distinct from 'issued'::erp.document_status then raise exception using errcode='object_not_in_prerequisite_state',message='active fiscal point, issued document, permission and reason are required'; end if;
  digest:=encode(extensions.digest(convert_to(jsonb_build_object('document_id',document_row.id,'point_id',point_row.id,'voucher_type',voucher_type,'snapshot',document_row.customer_snapshot)::text,'UTF8'),'sha256'),'hex');
  perform set_config('erp.operation_reason',operation_reason,true);
  cmd:=erp.claim_stage8_command('fiscal.request',org_id,document_row.branch_id,operation_key,jsonb_build_object('document_id',document_row.id,'point_id',point_row.id,'voucher_type',voucher_type,'request_digest',digest,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  insert into erp.fiscal_counters(organization_id,fiscal_point_id,voucher_type,last_number) values(org_id,point_row.id,voucher_type,1) on conflict(fiscal_point_id,voucher_type) do update set last_number=erp.fiscal_counters.last_number+1 returning last_number into next_number;
  insert into erp.fiscal_requests(organization_id,branch_id,document_id,fiscal_point_id,voucher_type,voucher_number,request_sha256,requested_by) values(org_id,document_row.branch_id,document_row.id,point_row.id,voucher_type,next_number,digest,auth.uid()) returning id into result_id;
  insert into erp.integration_outbox(organization_id,branch_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key) values(org_id,document_row.branch_id,'fiscal_request',result_id,'fiscal.issue.requested',jsonb_build_object('request_id',result_id,'redacted',true),'stage8:fiscal:'||result_id);
  perform erp.complete_stage8_command(cmd.id,result_id); return result_id;
end $$;

create or replace function erp.record_fiscal_provider_result(target_request_id uuid, provider text, provider_event_id text, result_status erp.fiscal_status, cae text, cae_expires_on date, response_sha256 text, error_code text, error_message text)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare request_row erp.fiscal_requests%rowtype; existing erp.fiscal_events%rowtype; result_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='insufficient_privilege',message='service role is required'; end if;
  select * into request_row from erp.fiscal_requests where id=target_request_id for update;
  if request_row.id is null or nullif(btrim(provider),'') is null or length(provider)>80 or nullif(btrim(provider_event_id),'') is null or length(provider_event_id)>200 or result_status is null or result_status not in('authorized','rejected','failed') or response_sha256 !~ '^[0-9a-f]{64}$' or (result_status='authorized' and (cae !~ '^[0-9]{10,20}$' or cae_expires_on is null or error_code is not null or error_message is not null)) or (result_status in('rejected','failed') and nullif(btrim(error_code),'') is null and nullif(btrim(error_message),'') is null) or length(coalesce(error_code,''))>120 or length(coalesce(error_message,''))>4000 then raise exception using errcode='invalid_parameter_value',message='valid fiscal provider result is required'; end if;
  select e.* into existing from erp.fiscal_events e where e.organization_id=request_row.organization_id and e.provider=btrim(record_fiscal_provider_result.provider) and e.provider_event_id=btrim(record_fiscal_provider_result.provider_event_id);
  if existing.id is not null then if existing.fiscal_request_id<>request_row.id or existing.status<>result_status or existing.response_sha256<>response_sha256 or existing.cae is distinct from cae or existing.cae_expires_on is distinct from cae_expires_on or existing.error_code is distinct from nullif(btrim(error_code),'') or existing.error_message is distinct from nullif(btrim(error_message),'') then raise exception using errcode='integrity_constraint_violation',message='provider event is already used by another fiscal result'; end if; return existing.id; end if;
  if exists(select 1 from erp.fiscal_events e where e.fiscal_request_id=request_row.id and e.status in('authorized','rejected')) then raise exception using errcode='object_not_in_prerequisite_state',message='fiscal request already has a terminal result'; end if;
  perform set_config('erp.operation_reason','Fiscal provider result: '||btrim(provider),true);
  insert into erp.fiscal_events(organization_id,branch_id,fiscal_request_id,provider,provider_event_id,status,cae,cae_expires_on,response_sha256,error_code,error_message) values(request_row.organization_id,request_row.branch_id,request_row.id,btrim(provider),btrim(provider_event_id),result_status,cae,cae_expires_on,response_sha256,nullif(btrim(error_code),''),nullif(btrim(error_message),'')) returning id into result_id;
  return result_id;
end $$;

create or replace function erp.record_communication_consent(target_branch_id uuid, target_customer_id uuid, target_channel erp.communication_channel, granted boolean, source text, operation_key text, operation_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare org_id uuid:=erp.current_organization_id(); cmd erp.stage8_commands%rowtype; result_id uuid;
begin
  if org_id is null or not erp.has_permission('customers.manage',target_branch_id) or not exists(select 1 from erp.customers where id=target_customer_id and organization_id=org_id) or target_channel is null or granted is null or nullif(btrim(source),'') is null or nullif(btrim(operation_reason),'') is null then raise exception using errcode='invalid_parameter_value',message='customer, channel, consent source and reason are required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  cmd:=erp.claim_stage8_command('communication.consent',org_id,target_branch_id,operation_key,jsonb_build_object('customer_id',target_customer_id,'channel',target_channel,'granted',granted,'source',source,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  insert into erp.communication_consents(organization_id,branch_id,customer_id,channel,granted,source,reason,recorded_by) values(org_id,target_branch_id,target_customer_id,target_channel,granted,btrim(source),operation_reason,auth.uid()) returning id into result_id;
  perform erp.complete_stage8_command(cmd.id,result_id); return result_id;
end $$;

create or replace function erp.queue_customer_message(target_branch_id uuid, target_customer_id uuid, target_conversation_id uuid, target_template_version_id uuid, recipient_address text, variables jsonb, operation_key text, operation_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare org_id uuid:=erp.current_organization_id(); cmd erp.stage8_commands%rowtype; conversation_id uuid; channel erp.communication_channel; body text; expected_keys jsonb; result_id uuid;
begin
  select t.channel,v.body,v.variable_keys into channel,body,expected_keys from erp.message_template_versions v join erp.message_templates t on t.id=v.template_id and t.organization_id=v.organization_id where v.id=target_template_version_id and v.organization_id=org_id and t.is_active;
  if org_id is null or not erp.has_permission('messages.manage',target_branch_id) or channel is null or variables is null or jsonb_typeof(variables)<>'object' or pg_column_size(variables)>131072 or exists(select 1 from jsonb_array_elements_text(expected_keys) as expected_key(value) where not variables ? expected_key.value) or exists(select 1 from jsonb_object_keys(variables) as supplied_key(value) where not expected_keys ? supplied_key.value) or nullif(btrim(recipient_address),'') is null or length(recipient_address)>320 or nullif(btrim(operation_reason),'') is null or not exists(select 1 from erp.customers c where c.id=target_customer_id and c.organization_id=org_id) or not coalesce((select granted from erp.communication_consents where organization_id=org_id and customer_id=target_customer_id and channel=queue_customer_message.channel order by event_sequence desc limit 1),false) then raise exception using errcode='object_not_in_prerequisite_state',message='active template, customer, consent, recipient, exact variables and permission are required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  cmd:=erp.claim_stage8_command('message.queue',org_id,target_branch_id,operation_key,jsonb_build_object('customer_id',target_customer_id,'conversation_id',target_conversation_id,'template_id',target_template_version_id,'recipient',recipient_address,'variables',variables,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  if target_conversation_id is null then insert into erp.conversations(organization_id,branch_id,customer_id,channel) values(org_id,target_branch_id,target_customer_id,channel) returning id into conversation_id; else select id into conversation_id from erp.conversations where id=target_conversation_id and organization_id=org_id and branch_id=target_branch_id and customer_id=target_customer_id and channel=queue_customer_message.channel and closed_at is null for update; end if;
  if conversation_id is null then raise exception using errcode='foreign_key_violation',message='active matching conversation is required'; end if;
  insert into erp.communication_messages(organization_id,branch_id,conversation_id,customer_id,channel,direction,template_version_id,recipient_address,body_snapshot,variables_snapshot,created_by) values(org_id,target_branch_id,conversation_id,target_customer_id,channel,'outbound',target_template_version_id,btrim(recipient_address),body,variables,auth.uid()) returning id into result_id;
  insert into erp.communication_message_events(organization_id,branch_id,message_id,status) values(org_id,target_branch_id,result_id,'queued');
  insert into erp.integration_outbox(organization_id,branch_id,aggregate_type,aggregate_id,event_type,payload,idempotency_key) values(org_id,target_branch_id,'communication_message',result_id,'message.send.requested',jsonb_build_object('message_id',result_id,'channel',channel,'redacted',true),'stage8:message:'||result_id);
  perform erp.complete_stage8_command(cmd.id,result_id); return result_id;
end $$;

create or replace function erp.record_provider_message_event(target_message_id uuid, provider text, provider_event_id text, new_status erp.communication_status, provider_message_id text, response_sha256 text, error_message text)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare message_row erp.communication_messages%rowtype; current_rank int; new_rank int; existing erp.communication_message_events%rowtype; result_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='insufficient_privilege',message='service role is required'; end if;
  select * into message_row from erp.communication_messages where id=target_message_id for update;
  if message_row.id is null or nullif(btrim(provider),'') is null or length(provider)>80 or nullif(btrim(provider_event_id),'') is null or length(provider_event_id)>200 or new_status is null or new_status='queued' or response_sha256 !~ '^[0-9a-f]{64}$' or (new_status='failed' and nullif(btrim(error_message),'') is null) or (new_status<>'failed' and (nullif(btrim(provider_message_id),'') is null or error_message is not null)) or length(coalesce(error_message,''))>4000 then raise exception using errcode='invalid_parameter_value',message='valid provider message event is required'; end if;
  select e.* into existing from erp.communication_message_events e where e.organization_id=message_row.organization_id and e.provider=btrim(record_provider_message_event.provider) and e.provider_event_id=btrim(record_provider_message_event.provider_event_id);
  if existing.id is not null then if existing.message_id<>message_row.id or existing.status<>new_status or existing.response_sha256<>response_sha256 or existing.provider_message_id is distinct from nullif(btrim(provider_message_id),'') or existing.error_message is distinct from nullif(btrim(error_message),'') then raise exception using errcode='integrity_constraint_violation',message='provider event is already used by another message result'; end if; return existing.id; end if;
  select coalesce(max(case status when 'queued' then 1 when 'sent' then 2 when 'delivered' then 3 when 'read' then 4 else 0 end),0) into current_rank from erp.communication_message_events where message_id=message_row.id;
  new_rank:=case new_status when 'queued' then 1 when 'sent' then 2 when 'delivered' then 3 when 'read' then 4 else 0 end;
  if new_status<>'failed' and new_rank<coalesce(current_rank,0) then raise exception using errcode='object_not_in_prerequisite_state',message='message delivery status cannot move backwards'; end if;
  perform set_config('erp.operation_reason','Message provider result: '||btrim(provider),true);
  insert into erp.communication_message_events(organization_id,branch_id,message_id,status,provider,provider_event_id,provider_message_id,response_sha256,error_message) values(message_row.organization_id,message_row.branch_id,message_row.id,new_status,btrim(provider),btrim(provider_event_id),nullif(btrim(provider_message_id),''),response_sha256,nullif(btrim(error_message),'')) returning id into result_id;
  return result_id;
end $$;

create or replace function erp.record_provider_webhook(target_branch_id uuid, provider text, provider_event_id text, event_type text, payload_sha256 text, signature_valid boolean)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare org_id uuid; existing erp.provider_webhook_events%rowtype; result_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='insufficient_privilege',message='service role is required'; end if;
  select organization_id into org_id from erp.branches where id=target_branch_id;
  if org_id is null or nullif(btrim(provider),'') is null or length(provider)>80 or nullif(btrim(provider_event_id),'') is null or length(provider_event_id)>200 or nullif(btrim(event_type),'') is null or length(event_type)>120 or payload_sha256 !~ '^[0-9a-f]{64}$' or signature_valid is null then raise exception using errcode='invalid_parameter_value',message='valid webhook metadata is required'; end if;
  select * into existing from erp.provider_webhook_events where organization_id=org_id and provider=btrim(record_provider_webhook.provider) and provider_event_id=btrim(record_provider_webhook.provider_event_id);
  if existing.id is not null then if existing.branch_id<>target_branch_id or existing.event_type<>btrim(event_type) or existing.payload_sha256<>payload_sha256 or existing.signature_valid<>signature_valid then raise exception using errcode='integrity_constraint_violation',message='provider webhook event is already used by another payload'; end if; return existing.id; end if;
  insert into erp.provider_webhook_events(organization_id,branch_id,provider,provider_event_id,event_type,payload_sha256,signature_valid) values(org_id,target_branch_id,btrim(provider),btrim(provider_event_id),btrim(event_type),payload_sha256,signature_valid) returning id into result_id; return result_id;
end $$;

create or replace function erp.record_inbound_message(target_webhook_id uuid, target_channel erp.communication_channel, provider_conversation_id text, provider_message_id text, target_customer_id uuid, sender_address text, body text, response_sha256 text, occurred_at timestamptz)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare webhook erp.provider_webhook_events%rowtype; conversation_id uuid; existing_message_id uuid; result_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='insufficient_privilege',message='service role is required'; end if;
  select * into webhook from erp.provider_webhook_events where id=target_webhook_id for update;
  if webhook.id is null or not webhook.signature_valid or target_channel is null or nullif(btrim(provider_conversation_id),'') is null or nullif(btrim(provider_message_id),'') is null or nullif(btrim(sender_address),'') is null or length(sender_address)>320 or nullif(btrim(body),'') is null or length(body)>16000 or response_sha256 !~ '^[0-9a-f]{64}$' or occurred_at is null then raise exception using errcode='invalid_parameter_value',message='verified webhook and bounded inbound message data are required'; end if;
  if target_customer_id is not null and not exists(select 1 from erp.customers c where c.id=target_customer_id and c.organization_id=webhook.organization_id) then raise exception using errcode='foreign_key_violation',message='inbound message customer is invalid'; end if;
  select e.message_id into existing_message_id from erp.communication_message_events e where e.organization_id=webhook.organization_id and e.provider=webhook.provider and e.provider_message_id=btrim(record_inbound_message.provider_message_id) and e.status='delivered';
  if existing_message_id is not null then
    if not exists(select 1 from erp.communication_messages m join erp.communication_message_events e on e.message_id=m.id where m.id=existing_message_id and m.organization_id=webhook.organization_id and m.branch_id=webhook.branch_id and m.channel=target_channel and m.customer_id is not distinct from target_customer_id and m.recipient_address=btrim(sender_address) and m.body_snapshot=body and e.provider=webhook.provider and e.provider_event_id=webhook.provider_event_id and e.provider_message_id=btrim(record_inbound_message.provider_message_id) and e.response_sha256=record_inbound_message.response_sha256 and e.occurred_at=record_inbound_message.occurred_at) then raise exception using errcode='integrity_constraint_violation',message='provider message is already used by another inbound payload'; end if;
    return existing_message_id;
  end if;
  select c.id into conversation_id from erp.conversations c where c.organization_id=webhook.organization_id and c.channel=target_channel and c.provider_conversation_id=btrim(record_inbound_message.provider_conversation_id) for update;
  if conversation_id is null then insert into erp.conversations(organization_id,branch_id,customer_id,channel,provider_conversation_id) values(webhook.organization_id,webhook.branch_id,target_customer_id,target_channel,btrim(provider_conversation_id)) returning id into conversation_id; end if;
  perform set_config('erp.operation_reason','Verified inbound provider message',true);
  insert into erp.communication_messages(organization_id,branch_id,conversation_id,customer_id,channel,direction,recipient_address,body_snapshot,variables_snapshot) values(webhook.organization_id,webhook.branch_id,conversation_id,target_customer_id,target_channel,'inbound',btrim(sender_address),body,'{}') returning id into result_id;
  insert into erp.communication_message_events(organization_id,branch_id,message_id,status,provider,provider_event_id,provider_message_id,response_sha256,occurred_at) values(webhook.organization_id,webhook.branch_id,result_id,'delivered',webhook.provider,webhook.provider_event_id,btrim(provider_message_id),response_sha256,occurred_at);
  return result_id;
end $$;

create or replace function erp.assign_conversation(target_conversation_id uuid, target_user_id uuid, operation_key text, operation_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare org_id uuid:=erp.current_organization_id(); conversation erp.conversations%rowtype; cmd erp.stage8_commands%rowtype; result_id uuid;
begin
  select * into conversation from erp.conversations c where c.id=target_conversation_id and c.organization_id=org_id for update;
  if conversation.id is null or not erp.has_permission('messages.manage',conversation.branch_id) or nullif(btrim(operation_reason),'') is null or (target_user_id is not null and not exists(select 1 from erp.profiles p where p.user_id=target_user_id and p.organization_id=org_id and p.is_active)) then raise exception using errcode='insufficient_privilege',message='active conversation, assignee, permission and reason are required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  cmd:=erp.claim_stage8_command('conversation.assign',org_id,conversation.branch_id,operation_key,jsonb_build_object('conversation_id',conversation.id,'user_id',target_user_id,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  insert into erp.conversation_assignments(organization_id,branch_id,conversation_id,assigned_user_id,reason,assigned_by) values(org_id,conversation.branch_id,conversation.id,target_user_id,operation_reason,auth.uid()) returning id into result_id;
  perform erp.complete_stage8_command(cmd.id,result_id); return result_id;
end $$;

create or replace function erp.register_communication_attachment(target_message_id uuid, mime_type text, byte_size bigint, sha256 text)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare message erp.communication_messages%rowtype; existing_id uuid; result_id uuid; canonical_path text;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='insufficient_privilege',message='service role is required'; end if;
  select * into message from erp.communication_messages m where m.id=target_message_id for update;
  if message.id is null or mime_type !~ '^[a-z0-9.+-]+/[a-z0-9.+-]+$' or byte_size is null or byte_size not between 1 and 1073741824 or sha256 !~ '^[0-9a-f]{64}$' then raise exception using errcode='invalid_parameter_value',message='message and bounded attachment metadata are required'; end if;
  canonical_path:='communications/'||message.organization_id||'/'||message.branch_id||'/'||message.id||'/'||sha256;
  select a.id into existing_id from erp.communication_attachments a where a.organization_id=message.organization_id and a.private_object_path=canonical_path;
  if existing_id is not null then if not exists(select 1 from erp.communication_attachments where id=existing_id and message_id=message.id and mime_type=register_communication_attachment.mime_type and byte_size=register_communication_attachment.byte_size and sha256=register_communication_attachment.sha256) then raise exception using errcode='integrity_constraint_violation',message='attachment digest is already used by different metadata'; end if; return existing_id; end if;
  perform set_config('erp.operation_reason','Communication attachment metadata registered',true);
  insert into erp.communication_attachments(organization_id,branch_id,message_id,private_object_path,mime_type,byte_size,sha256) values(message.organization_id,message.branch_id,message.id,canonical_path,mime_type,byte_size,sha256) returning id into result_id;
  return result_id;
end $$;

create or replace function erp.configure_communication_automation(target_branch_id uuid, rule_code text, event_type text, target_template_version_id uuid, conditions jsonb, active boolean, operation_key text, operation_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare org_id uuid:=erp.current_organization_id(); cmd erp.stage8_commands%rowtype; result_id uuid;
begin
  if org_id is null or not erp.has_permission('messages.manage',target_branch_id) or rule_code !~ '^[A-Z0-9_]{2,80}$' or nullif(btrim(event_type),'') is null or conditions is null or jsonb_typeof(conditions)<>'object' or pg_column_size(conditions)>131072 or active is null or nullif(btrim(operation_reason),'') is null or not exists(select 1 from erp.message_template_versions v join erp.message_templates t on t.id=v.template_id and t.organization_id=v.organization_id where v.id=target_template_version_id and v.organization_id=org_id and t.is_active) then raise exception using errcode='invalid_parameter_value',message='valid automation rule, template, conditions and reason are required'; end if;
  perform set_config('erp.operation_reason',operation_reason,true);
  cmd:=erp.claim_stage8_command('communication.automation.configure',org_id,target_branch_id,operation_key,jsonb_build_object('code',rule_code,'event_type',event_type,'template_version_id',target_template_version_id,'conditions',conditions,'active',active,'reason',operation_reason)); if cmd.result_id is not null then return cmd.result_id; end if;
  insert into erp.communication_automation_rules(organization_id,branch_id,code,event_type,template_version_id,conditions,is_active,created_by,updated_by) values(org_id,target_branch_id,rule_code,btrim(event_type),target_template_version_id,conditions,active,auth.uid(),auth.uid()) on conflict(organization_id,branch_id,code) do update set event_type=excluded.event_type,template_version_id=excluded.template_version_id,conditions=excluded.conditions,is_active=excluded.is_active,updated_at=clock_timestamp(),updated_by=auth.uid() returning id into result_id;
  perform erp.complete_stage8_command(cmd.id,result_id); return result_id;
end $$;

create or replace function erp.record_communication_automation_execution(target_rule_id uuid, source_event_type text, source_event_id uuid, target_message_id uuid, execution_outcome text, execution_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare rule_row erp.communication_automation_rules%rowtype; existing erp.communication_automation_executions%rowtype; result_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception using errcode='insufficient_privilege',message='service role is required'; end if;
  select * into rule_row from erp.communication_automation_rules where id=target_rule_id and is_active for update;
  if rule_row.id is null or rule_row.branch_id is null or nullif(btrim(source_event_type),'') is null or length(source_event_type)>120 or source_event_id is null or execution_outcome is null or execution_outcome not in('queued','skipped','failed') or nullif(btrim(execution_reason),'') is null or length(execution_reason)>1000 or (execution_outcome='queued')<>(target_message_id is not null) or (target_message_id is not null and not exists(select 1 from erp.communication_messages where id=target_message_id and organization_id=rule_row.organization_id and branch_id=rule_row.branch_id)) then raise exception using errcode='invalid_parameter_value',message='active rule and bounded automation result are required'; end if;
  select * into existing from erp.communication_automation_executions where rule_id=rule_row.id and source_event_type=btrim(record_communication_automation_execution.source_event_type) and source_event_id=record_communication_automation_execution.source_event_id;
  if existing.id is not null then if existing.message_id is distinct from target_message_id or existing.outcome<>execution_outcome or existing.reason<>execution_reason then raise exception using errcode='integrity_constraint_violation',message='automation source already has a different execution result'; end if; return existing.id; end if;
  perform set_config('erp.operation_reason','Communication automation execution',true);
  insert into erp.communication_automation_executions(organization_id,branch_id,rule_id,source_event_type,source_event_id,message_id,outcome,reason) values(rule_row.organization_id,rule_row.branch_id,rule_row.id,btrim(source_event_type),source_event_id,target_message_id,execution_outcome,execution_reason) returning id into result_id;
  return result_id;
end $$;

create or replace function erp.move_integration_to_dead_letter(target_outbox_id uuid, operation_reason text)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare org_id uuid:=erp.current_organization_id(); outbox erp.integration_outbox%rowtype; result_id uuid;
begin select * into outbox from erp.integration_outbox where id=target_outbox_id and organization_id=org_id for update; if outbox.id is null or not erp.has_permission('integrations.retry',outbox.branch_id) or nullif(btrim(operation_reason),'') is null or not exists(select 1 from erp.integration_attempts a where a.outbox_id=outbox.id and a.organization_id=org_id and a.status='failed') then raise exception using errcode='insufficient_privilege',message='failed outbox item, integration retry permission and reason are required'; end if; select id into result_id from erp.integration_dead_letters where outbox_id=outbox.id; if result_id is not null then if not exists(select 1 from erp.integration_dead_letters where id=result_id and reason=operation_reason) then raise exception using errcode='integrity_constraint_violation',message='outbox item already has a different dead-letter reason'; end if; return result_id; end if; perform set_config('erp.operation_reason',operation_reason,true); insert into erp.integration_dead_letters(organization_id,branch_id,outbox_id,reason,moved_by) values(org_id,outbox.branch_id,outbox.id,operation_reason,auth.uid()) returning id into result_id; return result_id; end $$;

create or replace function erp.protect_stage8_fact()
returns trigger language plpgsql set search_path = pg_catalog as $$ begin raise exception using errcode='integrity_constraint_violation',message='stage 8 facts are append-only'; end $$;

create or replace function erp.audit_stage8_fact()
returns trigger language plpgsql security definer set search_path = pg_catalog, erp as $$
begin insert into erp.audit_events(organization_id,branch_id,actor_user_id,schema_name,table_name,record_id,action,reason,metadata) values(new.organization_id,nullif(to_jsonb(new)->>'branch_id','')::uuid,auth.uid(),tg_table_schema,tg_table_name,coalesce(to_jsonb(new)->>'id',to_jsonb(new)->>'document_id'),'insert',nullif(current_setting('erp.operation_reason',true),''),jsonb_build_object('redacted',true,'trigger',tg_name)); return null; end $$;

do $$ declare name text; begin
  foreach name in array array['stage8_commands','document_templates','document_template_versions','documents','document_events','fiscal_points','fiscal_counters','fiscal_requests','fiscal_events','communication_consents','message_templates','message_template_versions','conversations','conversation_assignments','communication_messages','communication_message_events','communication_attachments','provider_webhook_events','integration_dead_letters','communication_automation_rules','communication_automation_executions'] loop execute format('alter table erp.%I enable row level security',name); end loop;
  foreach name in array array['document_template_versions','documents','document_events','fiscal_requests','fiscal_events','communication_consents','message_template_versions','conversation_assignments','communication_messages','communication_message_events','communication_attachments','provider_webhook_events','integration_dead_letters','communication_automation_executions'] loop execute format('create trigger %I_immutable before update or delete on erp.%I for each row execute function erp.protect_stage8_fact()',name,name); execute format('create trigger %I_audit after insert on erp.%I for each row execute function erp.audit_stage8_fact()',name,name); end loop;
end $$;

create trigger communication_automation_rules_touch before update on erp.communication_automation_rules for each row execute function erp.touch_updated_at();
create trigger communication_automation_rules_audit after insert or update on erp.communication_automation_rules for each row execute function erp.audit_row_change();
create trigger communication_automation_rules_no_delete before delete on erp.communication_automation_rules for each row execute function erp.prevent_delete();

create policy document_templates_select on erp.document_templates for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('documents.view'));
create policy document_template_versions_select on erp.document_template_versions for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('documents.view'));
create policy documents_select on erp.documents for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('documents.view',branch_id));
create policy document_events_select on erp.document_events for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('documents.view',branch_id));
create policy fiscal_points_select on erp.fiscal_points for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('documents.view',branch_id));
create policy fiscal_requests_select on erp.fiscal_requests for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('documents.view',branch_id));
create policy fiscal_events_select on erp.fiscal_events for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('documents.view',branch_id));
create policy communication_consents_select on erp.communication_consents for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('messages.view',branch_id));
create policy message_templates_select on erp.message_templates for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('messages.view'));
create policy message_template_versions_select on erp.message_template_versions for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('messages.view'));
create policy conversations_select on erp.conversations for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('messages.view',branch_id));
create policy conversation_assignments_select on erp.conversation_assignments for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('messages.view',branch_id));
create policy communication_messages_select on erp.communication_messages for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('messages.view',branch_id));
create policy communication_message_events_select on erp.communication_message_events for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('messages.view',branch_id));
create policy communication_attachments_select on erp.communication_attachments for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('messages.view',branch_id));
create policy provider_webhooks_select on erp.provider_webhook_events for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('integrations.view',branch_id));
create policy integration_dead_letters_select on erp.integration_dead_letters for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('integrations.view',branch_id));
create policy communication_automation_rules_select on erp.communication_automation_rules for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('messages.view',branch_id));
create policy communication_automation_executions_select on erp.communication_automation_executions for select to authenticated using (organization_id=erp.current_organization_id() and erp.has_permission('messages.view',branch_id));

revoke all on erp.stage8_commands,erp.document_templates,erp.document_template_versions,erp.documents,erp.document_events,erp.fiscal_points,erp.fiscal_counters,erp.fiscal_requests,erp.fiscal_events,erp.communication_consents,erp.message_templates,erp.message_template_versions,erp.conversations,erp.conversation_assignments,erp.communication_messages,erp.communication_message_events,erp.communication_attachments,erp.provider_webhook_events,erp.integration_dead_letters,erp.communication_automation_rules,erp.communication_automation_executions from public,anon,authenticated,service_role;
grant select on erp.document_templates,erp.document_template_versions,erp.fiscal_points,erp.message_templates,erp.message_template_versions,erp.conversation_assignments,erp.communication_consents,erp.communication_automation_rules,erp.communication_automation_executions to authenticated,service_role;
grant select(id,organization_id,branch_id,customer_id,channel,opened_at,closed_at) on erp.conversations to authenticated,service_role;
grant select(id,organization_id,branch_id,template_version_id,owner_type,owner_id,document_number,customer_snapshot,content_sha256,status,issued_at,issued_by) on erp.documents to authenticated,service_role;
grant select on erp.document_events to authenticated,service_role;
grant select(id,organization_id,branch_id,document_id,fiscal_point_id,voucher_type,voucher_number,requested_at,requested_by) on erp.fiscal_requests to authenticated,service_role;
grant select(id,event_sequence,organization_id,branch_id,fiscal_request_id,provider,status,cae,cae_expires_on,error_code,occurred_at) on erp.fiscal_events to authenticated,service_role;
grant select(id,organization_id,branch_id,conversation_id,customer_id,channel,direction,template_version_id,body_snapshot,variables_snapshot,created_at,created_by) on erp.communication_messages to authenticated,service_role;
grant select(id,event_sequence,organization_id,branch_id,message_id,status,provider,occurred_at) on erp.communication_message_events to authenticated,service_role;
grant select(id,organization_id,branch_id,message_id,mime_type,byte_size,sha256) on erp.communication_attachments to authenticated,service_role;
grant select(id,organization_id,branch_id,provider,event_type,signature_valid,received_at) on erp.provider_webhook_events to authenticated,service_role;
grant select on erp.integration_dead_letters,erp.stage8_commands to service_role;

revoke all on function erp.claim_stage8_command(text,uuid,uuid,text,jsonb),erp.complete_stage8_command(uuid,uuid),erp.protect_stage8_command(),erp.stage8_json_has_forbidden_key(jsonb,text[]),erp.protect_stage8_fact(),erp.audit_stage8_fact() from public,anon,authenticated,service_role;
revoke all on function erp.create_document_template_version(uuid,jsonb,text,text),erp.create_message_template_version(uuid,text,text,text,jsonb,text,text),erp.issue_document(uuid,uuid,text,uuid,text,jsonb,text,text,text,text),erp.void_document(uuid,text,text),erp.request_fiscal_issuance(uuid,uuid,text,text,text),erp.record_communication_consent(uuid,uuid,erp.communication_channel,boolean,text,text,text),erp.queue_customer_message(uuid,uuid,uuid,uuid,text,jsonb,text,text),erp.assign_conversation(uuid,uuid,text,text),erp.configure_communication_automation(uuid,text,text,uuid,jsonb,boolean,text,text),erp.move_integration_to_dead_letter(uuid,text) from public,anon,service_role;
grant execute on function erp.create_document_template_version(uuid,jsonb,text,text),erp.create_message_template_version(uuid,text,text,text,jsonb,text,text),erp.issue_document(uuid,uuid,text,uuid,text,jsonb,text,text,text,text),erp.void_document(uuid,text,text),erp.request_fiscal_issuance(uuid,uuid,text,text,text),erp.record_communication_consent(uuid,uuid,erp.communication_channel,boolean,text,text,text),erp.queue_customer_message(uuid,uuid,uuid,uuid,text,jsonb,text,text),erp.assign_conversation(uuid,uuid,text,text),erp.configure_communication_automation(uuid,text,text,uuid,jsonb,boolean,text,text),erp.move_integration_to_dead_letter(uuid,text) to authenticated;
revoke all on function erp.record_fiscal_provider_result(uuid,text,text,erp.fiscal_status,text,date,text,text,text),erp.record_provider_message_event(uuid,text,text,erp.communication_status,text,text,text),erp.record_provider_webhook(uuid,text,text,text,text,boolean),erp.record_inbound_message(uuid,erp.communication_channel,text,text,uuid,text,text,text,timestamptz),erp.register_communication_attachment(uuid,text,bigint,text),erp.record_communication_automation_execution(uuid,text,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function erp.record_fiscal_provider_result(uuid,text,text,erp.fiscal_status,text,date,text,text,text),erp.record_provider_message_event(uuid,text,text,erp.communication_status,text,text,text),erp.record_provider_webhook(uuid,text,text,text,text,boolean),erp.record_inbound_message(uuid,erp.communication_channel,text,text,uuid,text,text,text,timestamptz),erp.register_communication_attachment(uuid,text,bigint,text),erp.record_communication_automation_execution(uuid,text,uuid,uuid,text,text) to service_role;

comment on table erp.documents is 'Immutable customer-safe metadata. PDF rendering and private object upload are external adapters.';
comment on table erp.fiscal_requests is 'Idempotent ARCA issuance metadata. No provider call or unrestricted payload is stored here.';
comment on table erp.communication_messages is 'Official-channel message facts. Provider calls are performed by a future outbox worker.';
