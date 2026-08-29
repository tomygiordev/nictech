-- Apply the document/communication corrections that were appended after
-- 202608260004 had already been recorded by the local migration runner.

revoke select on erp.products from authenticated, service_role;

drop function if exists erp.record_provider_webhook(uuid, text, text, text, text, boolean);

create or replace function erp.record_provider_webhook(
  target_branch_id uuid,
  target_provider text,
  target_provider_event_id text,
  target_event_type text,
  target_payload_sha256 text,
  target_signature_valid boolean
)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare
  org_id uuid;
  existing_event erp.provider_webhook_events%rowtype;
  result_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = 'insufficient_privilege', message = 'service role is required';
  end if;

  select branch.organization_id into org_id
    from erp.branches as branch
   where branch.id = target_branch_id;

  if org_id is null
     or nullif(btrim(target_provider), '') is null
     or length(target_provider) > 80
     or nullif(btrim(target_provider_event_id), '') is null
     or length(target_provider_event_id) > 200
     or nullif(btrim(target_event_type), '') is null
     or length(target_event_type) > 120
     or target_payload_sha256 !~ '^[0-9a-f]{64}$'
     or target_signature_valid is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'valid webhook metadata is required';
  end if;

  select event.* into existing_event
    from erp.provider_webhook_events as event
   where event.organization_id = org_id
     and event.provider = btrim(target_provider)
     and event.provider_event_id = btrim(target_provider_event_id);

  if existing_event.id is not null then
    if existing_event.branch_id <> target_branch_id
       or existing_event.event_type <> btrim(target_event_type)
       or existing_event.payload_sha256 <> target_payload_sha256
       or existing_event.signature_valid <> target_signature_valid then
      raise exception using errcode = 'integrity_constraint_violation', message = 'provider webhook event is already used by another payload';
    end if;
    return existing_event.id;
  end if;

  insert into erp.provider_webhook_events(
    organization_id, branch_id, provider, provider_event_id, event_type,
    payload_sha256, signature_valid
  ) values (
    org_id, target_branch_id, btrim(target_provider), btrim(target_provider_event_id),
    btrim(target_event_type), target_payload_sha256, target_signature_valid
  ) returning id into result_id;

  return result_id;
end;
$$;

grant execute on function erp.record_provider_webhook(uuid, text, text, text, text, boolean)
  to service_role;

drop function if exists erp.assign_conversation(uuid, uuid, text, text);

create or replace function erp.assign_conversation(
  target_conversation_id uuid,
  target_user_id uuid,
  operation_key text,
  operation_reason text
)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare
  org_id uuid := erp.current_organization_id();
  conversation erp.conversations%rowtype;
  command_row erp.stage8_commands%rowtype;
  result_id uuid;
begin
  select current_conversation.* into conversation
    from erp.conversations as current_conversation
   where current_conversation.id = target_conversation_id
     and current_conversation.organization_id = org_id
   for update;

  if conversation.id is null
     or not erp.has_permission('messages.manage', conversation.branch_id)
     or nullif(btrim(operation_reason), '') is null
     or (target_user_id is not null and not exists (
       select 1
         from erp.profiles as profile
        where profile.id = target_user_id
          and profile.organization_id = org_id
          and profile.is_active
     )) then
    raise exception using errcode = 'insufficient_privilege', message = 'active conversation, assignee, permission and reason are required';
  end if;

  perform set_config('erp.operation_reason', operation_reason, true);
  command_row := erp.claim_stage8_command(
    'conversation.assign', org_id, conversation.branch_id, operation_key,
    jsonb_build_object('conversation_id', conversation.id, 'user_id', target_user_id, 'reason', operation_reason)
  );

  if command_row.result_id is not null then
    return command_row.result_id;
  end if;

  insert into erp.conversation_assignments(
    organization_id, branch_id, conversation_id, assigned_user_id, reason, assigned_by
  ) values (
    org_id, conversation.branch_id, conversation.id, target_user_id, operation_reason, auth.uid()
  ) returning id into result_id;

  perform erp.complete_stage8_command(command_row.id, result_id);
  return result_id;
end;
$$;

grant execute on function erp.assign_conversation(uuid, uuid, text, text)
  to authenticated;

drop function if exists erp.record_inbound_message(uuid, erp.communication_channel, text, text, uuid, text, text, text, timestamptz);

create or replace function erp.record_inbound_message(
  target_webhook_id uuid,
  target_channel erp.communication_channel,
  target_provider_conversation_id text,
  target_provider_message_id text,
  target_customer_id uuid,
  target_sender_address text,
  target_body text,
  target_response_sha256 text,
  target_occurred_at timestamptz
)
returns uuid language plpgsql security definer set search_path = pg_catalog, erp as $$
declare
  webhook erp.provider_webhook_events%rowtype;
  conversation_id uuid;
  existing_message_id uuid;
  result_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = 'insufficient_privilege', message = 'service role is required';
  end if;

  select event.* into webhook
    from erp.provider_webhook_events as event
   where event.id = target_webhook_id
   for update;

  if webhook.id is null
     or not webhook.signature_valid
     or target_channel is null
     or nullif(btrim(target_provider_conversation_id), '') is null
     or nullif(btrim(target_provider_message_id), '') is null
     or nullif(btrim(target_sender_address), '') is null
     or length(target_sender_address) > 320
     or nullif(btrim(target_body), '') is null
     or length(target_body) > 16000
     or target_response_sha256 !~ '^[0-9a-f]{64}$'
     or target_occurred_at is null then
    raise exception using errcode = 'invalid_parameter_value', message = 'verified webhook and bounded inbound message data are required';
  end if;

  if target_customer_id is not null and not exists (
    select 1
      from erp.customers as customer
     where customer.id = target_customer_id
       and customer.organization_id = webhook.organization_id
  ) then
    raise exception using errcode = 'foreign_key_violation', message = 'inbound message customer is invalid';
  end if;

  select event.message_id into existing_message_id
    from erp.communication_message_events as event
   where event.organization_id = webhook.organization_id
     and event.provider = webhook.provider
     and event.provider_message_id = btrim(target_provider_message_id)
     and event.status = 'delivered';

  if existing_message_id is not null then
    if not exists (
      select 1
        from erp.communication_messages as message
        join erp.communication_message_events as event on event.message_id = message.id
       where message.id = existing_message_id
         and message.organization_id = webhook.organization_id
         and message.branch_id = webhook.branch_id
         and message.channel = target_channel
         and message.customer_id is not distinct from target_customer_id
         and message.recipient_address = btrim(target_sender_address)
         and message.body_snapshot = target_body
         and event.provider = webhook.provider
         and event.provider_event_id = webhook.provider_event_id
         and event.provider_message_id = btrim(target_provider_message_id)
         and event.response_sha256 = target_response_sha256
         and event.occurred_at = target_occurred_at
    ) then
      raise exception using errcode = 'integrity_constraint_violation', message = 'provider message is already used by another inbound payload';
    end if;
    return existing_message_id;
  end if;

  select conversation.id into conversation_id
    from erp.conversations as conversation
   where conversation.organization_id = webhook.organization_id
     and conversation.channel = target_channel
     and conversation.provider_conversation_id = btrim(target_provider_conversation_id)
   for update;

  if conversation_id is null then
    insert into erp.conversations(
      organization_id, branch_id, customer_id, channel, provider_conversation_id
    ) values (
      webhook.organization_id, webhook.branch_id, target_customer_id, target_channel,
      btrim(target_provider_conversation_id)
    ) returning id into conversation_id;
  end if;

  perform set_config('erp.operation_reason', 'Verified inbound provider message', true);
  insert into erp.communication_messages(
    organization_id, branch_id, conversation_id, customer_id, channel, direction,
    recipient_address, body_snapshot, variables_snapshot
  ) values (
    webhook.organization_id, webhook.branch_id, conversation_id, target_customer_id,
    target_channel, 'inbound', btrim(target_sender_address), target_body, '{}'
  ) returning id into result_id;

  insert into erp.communication_message_events(
    organization_id, branch_id, message_id, status, provider, provider_event_id,
    provider_message_id, response_sha256, occurred_at
  ) values (
    webhook.organization_id, webhook.branch_id, result_id, 'delivered', webhook.provider,
    webhook.provider_event_id, btrim(target_provider_message_id), target_response_sha256,
    target_occurred_at
  );

  return result_id;
end;
$$;

grant execute on function erp.record_inbound_message(uuid, erp.communication_channel, text, text, uuid, text, text, text, timestamptz)
  to service_role;
