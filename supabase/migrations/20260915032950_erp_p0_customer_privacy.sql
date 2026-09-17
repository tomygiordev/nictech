-- P0 customer privacy: public customer identifiers must never contain DNI/CUIT.
-- Sensitive identity data remains in customer_private_details and is only
-- available through permission-checked, audited RPCs.

do $$
declare
  customer_row record;
  normalized_document text;
  private_row erp.customer_private_details%rowtype;
  migrated_to_canonical_field boolean;
  migration_note text;
begin
  for customer_row in
    select customer.id, customer.organization_id, customer.code, customer.kind
    from erp.customers customer
    where btrim(customer.code) ~ '^[0-9][0-9 .-]*$'
      and case
        when customer.kind = 'business'::erp.party_kind then
          regexp_replace(customer.code, '[^0-9]', '', 'g') ~ '^[0-9]{11}$'
        else
          regexp_replace(customer.code, '[^0-9]', '', 'g') ~ '^[0-9]{7,8}$'
      end
    order by customer.organization_id, customer.id
    for update
  loop
    normalized_document := regexp_replace(customer_row.code, '[^0-9]', '', 'g');
    migrated_to_canonical_field := false;

    select details.*
      into private_row
    from erp.customer_private_details details
    where details.customer_id = customer_row.id
    for update;

    if not found then
      if customer_row.kind = 'business'::erp.party_kind
         and not exists (
           select 1
           from erp.customer_private_details details
           where details.organization_id = customer_row.organization_id
             and regexp_replace(details.tax_id, '[^0-9]', '', 'g') = normalized_document
         ) then
        insert into erp.customer_private_details (
          organization_id, customer_id, tax_id
        ) values (
          customer_row.organization_id, customer_row.id, normalized_document
        );
        migrated_to_canonical_field := true;
      elsif customer_row.kind = 'person'::erp.party_kind
         and not exists (
           select 1
           from erp.customer_private_details details
           where details.organization_id = customer_row.organization_id
             and regexp_replace(details.identity_document, '[^0-9]', '', 'g') = normalized_document
         ) then
        insert into erp.customer_private_details (
          organization_id, customer_id, identity_document
        ) values (
          customer_row.organization_id, customer_row.id, normalized_document
        );
        migrated_to_canonical_field := true;
      else
        insert into erp.customer_private_details (
          organization_id, customer_id, internal_notes
        ) values (
          customer_row.organization_id,
          customer_row.id,
          'Documento historico migrado desde customers.code: ' || customer_row.code
        );
      end if;
    elsif customer_row.kind = 'business'::erp.party_kind
          and private_row.tax_id is null
          and not exists (
            select 1
            from erp.customer_private_details details
            where details.organization_id = customer_row.organization_id
              and details.customer_id <> customer_row.id
              and regexp_replace(details.tax_id, '[^0-9]', '', 'g') = normalized_document
          ) then
      update erp.customer_private_details
      set tax_id = normalized_document
      where customer_id = customer_row.id;
      migrated_to_canonical_field := true;
    elsif customer_row.kind = 'person'::erp.party_kind
          and private_row.identity_document is null
          and not exists (
            select 1
            from erp.customer_private_details details
            where details.organization_id = customer_row.organization_id
              and details.customer_id <> customer_row.id
              and regexp_replace(details.identity_document, '[^0-9]', '', 'g') = normalized_document
          ) then
      update erp.customer_private_details
      set identity_document = normalized_document
      where customer_id = customer_row.id;
      migrated_to_canonical_field := true;
    end if;

    if not migrated_to_canonical_field then
      migration_note := 'Documento historico migrado desde customers.code: ' || customer_row.code;
      update erp.customer_private_details
      set internal_notes = case
        when coalesce(internal_notes, '') like '%' || migration_note || '%' then internal_notes
        when nullif(btrim(internal_notes), '') is null then migration_note
        else internal_notes || E'\n' || migration_note
      end
      where customer_id = customer_row.id;
    end if;

    update erp.customers
    set code = 'CLI-' || upper(substr(md5(
      customer_row.organization_id::text || ':' || customer_row.id::text
    ), 1, 16))
    where id = customer_row.id;
  end loop;
end;
$$;

alter table erp.customers
  add constraint customers_code_not_sensitive_document
  check (
    btrim(code) !~ '^[0-9][0-9 .-]*$'
    or regexp_replace(code, '[^0-9]', '', 'g') !~ '^([0-9]{7,8}|[0-9]{11})$'
  ) not valid;

alter table erp.customers
  validate constraint customers_code_not_sensitive_document;

create or replace function erp.get_customer_private_details(target_customer_id uuid)
returns table (
  customer_id uuid,
  tax_id text,
  identity_document text,
  address jsonb,
  internal_notes text,
  communication_consent boolean,
  consent_recorded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := erp.current_organization_id();
begin
  if target_organization_id is null
    or not erp.has_permission('customers.view_sensitive') then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'customers.view_sensitive is required';
  end if;

  if not exists (
    select 1
    from erp.customers customer
    where customer.id = target_customer_id
      and customer.organization_id = target_organization_id
  ) then
    raise exception using
      errcode = 'no_data_found',
      message = 'customer not found';
  end if;

  insert into erp.audit_events (
    organization_id, actor_user_id, schema_name, table_name,
    record_id, action, metadata
  ) values (
    target_organization_id,
    auth.uid(),
    'erp',
    'customer_private_details',
    target_customer_id::text,
    'read_sensitive',
    pg_catalog.jsonb_build_object('customer_id', target_customer_id)
  );

  return query
  select
    details.customer_id,
    details.tax_id,
    details.identity_document,
    details.address,
    details.internal_notes,
    details.communication_consent,
    details.consent_recorded_at
  from erp.customer_private_details details
  where details.customer_id = target_customer_id
    and details.organization_id = target_organization_id;
end;
$$;

create or replace function erp.upsert_customer_private_details(
  target_customer_id uuid,
  new_tax_id text default null,
  new_identity_document text default null,
  new_address jsonb default '{}'::jsonb,
  new_internal_notes text default null,
  new_communication_consent boolean default false,
  new_consent_recorded_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := erp.current_organization_id();
  details_id uuid;
  normalized_tax_id text := nullif(
    pg_catalog.regexp_replace(coalesce(new_tax_id, ''), '[^0-9]', '', 'g'),
    ''
  );
  normalized_identity_document text := nullif(
    pg_catalog.regexp_replace(coalesce(new_identity_document, ''), '[^0-9]', '', 'g'),
    ''
  );
begin
  if target_organization_id is null
    or not erp.has_permission('customers.manage')
    or not erp.has_permission('customers.view_sensitive') then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'customers.manage and customers.view_sensitive are required';
  end if;

  if not exists (
    select 1
    from erp.customers customer
    where customer.id = target_customer_id
      and customer.organization_id = target_organization_id
  ) then
    raise exception using
      errcode = 'no_data_found',
      message = 'customer not found';
  end if;

  if normalized_tax_id is not null and normalized_tax_id !~ '^[0-9]{11}$' then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'tax_id must contain exactly 11 digits';
  end if;

  if normalized_identity_document is not null
     and normalized_identity_document !~ '^[0-9]{7,8}$' then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'identity_document must contain 7 or 8 digits';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(new_address, '{}'::jsonb)) <> 'object' then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'customer address must be a JSON object';
  end if;

  if normalized_tax_id is not null and exists (
    select 1
    from erp.customer_private_details details
    where details.organization_id = target_organization_id
      and details.customer_id <> target_customer_id
      and pg_catalog.regexp_replace(coalesce(details.tax_id, ''), '[^0-9]', '', 'g') = normalized_tax_id
  ) then
    raise exception using
      errcode = 'unique_violation',
      message = 'tax_id already belongs to another customer';
  end if;

  if normalized_identity_document is not null and exists (
    select 1
    from erp.customer_private_details details
    where details.organization_id = target_organization_id
      and details.customer_id <> target_customer_id
      and pg_catalog.regexp_replace(coalesce(details.identity_document, ''), '[^0-9]', '', 'g') = normalized_identity_document
  ) then
    raise exception using
      errcode = 'unique_violation',
      message = 'identity_document already belongs to another customer';
  end if;

  insert into erp.customer_private_details (
    organization_id, customer_id, tax_id, identity_document, address,
    internal_notes, communication_consent, consent_recorded_at, updated_by
  ) values (
    target_organization_id,
    target_customer_id,
    normalized_tax_id,
    normalized_identity_document,
    coalesce(new_address, '{}'::jsonb),
    nullif(pg_catalog.btrim(new_internal_notes), ''),
    new_communication_consent,
    new_consent_recorded_at,
    auth.uid()
  )
  on conflict (customer_id) do update
  set tax_id = excluded.tax_id,
      identity_document = excluded.identity_document,
      address = excluded.address,
      internal_notes = excluded.internal_notes,
      communication_consent = excluded.communication_consent,
      consent_recorded_at = excluded.consent_recorded_at,
      updated_by = auth.uid()
  returning id into details_id;

  return details_id;
end;
$$;

create or replace function erp.create_customer_with_private_details(
  new_kind erp.party_kind,
  new_display_name text,
  new_legal_name text default null,
  new_email text default null,
  new_phone text default null,
  new_tax_id text default null,
  new_identity_document text default null,
  new_address jsonb default '{}'::jsonb,
  new_internal_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := erp.current_organization_id();
  customer_id_value uuid := gen_random_uuid();
  customer_code_value text;
  has_private_values boolean;
  normalized_tax_id text := nullif(
    pg_catalog.regexp_replace(coalesce(new_tax_id, ''), '[^0-9]', '', 'g'),
    ''
  );
  normalized_identity_document text := nullif(
    pg_catalog.regexp_replace(coalesce(new_identity_document, ''), '[^0-9]', '', 'g'),
    ''
  );
begin
  if target_organization_id is null
    or not erp.has_permission('customers.manage') then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'customers.manage is required';
  end if;

  if new_kind is null or nullif(pg_catalog.btrim(new_display_name), '') is null then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'customer kind and display name are required';
  end if;

  if normalized_tax_id is not null and normalized_tax_id !~ '^[0-9]{11}$' then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'tax_id must contain exactly 11 digits';
  end if;

  if normalized_identity_document is not null
     and normalized_identity_document !~ '^[0-9]{7,8}$' then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'identity_document must contain 7 or 8 digits';
  end if;

  if (new_kind = 'person'::erp.party_kind and normalized_tax_id is not null)
     or (new_kind = 'business'::erp.party_kind and normalized_identity_document is not null) then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'document type does not match customer kind';
  end if;

  if pg_catalog.jsonb_typeof(coalesce(new_address, '{}'::jsonb)) <> 'object' then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'customer address must be a JSON object';
  end if;

  has_private_values :=
    normalized_tax_id is not null
    or normalized_identity_document is not null
    or coalesce(new_address, '{}'::jsonb) <> '{}'::jsonb
    or nullif(pg_catalog.btrim(new_internal_notes), '') is not null;

  if has_private_values and not erp.has_permission('customers.view_sensitive') then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'customers.view_sensitive is required for private customer data';
  end if;

  if normalized_tax_id is not null and exists (
    select 1
    from erp.customer_private_details details
    where details.organization_id = target_organization_id
      and pg_catalog.regexp_replace(coalesce(details.tax_id, ''), '[^0-9]', '', 'g') = normalized_tax_id
  ) then
    raise exception using
      errcode = 'unique_violation',
      message = 'tax_id already belongs to another customer';
  end if;

  if normalized_identity_document is not null and exists (
    select 1
    from erp.customer_private_details details
    where details.organization_id = target_organization_id
      and pg_catalog.regexp_replace(coalesce(details.identity_document, ''), '[^0-9]', '', 'g') = normalized_identity_document
  ) then
    raise exception using
      errcode = 'unique_violation',
      message = 'identity_document already belongs to another customer';
  end if;

  customer_code_value := 'CLI-' || upper(substr(md5(
    target_organization_id::text || ':' || customer_id_value::text
  ), 1, 16));

  insert into erp.customers (
    id, organization_id, code, kind, display_name, legal_name,
    email, phone, is_active, created_by, updated_by
  ) values (
    customer_id_value,
    target_organization_id,
    customer_code_value,
    new_kind,
    pg_catalog.btrim(new_display_name),
    nullif(pg_catalog.btrim(new_legal_name), ''),
    nullif(pg_catalog.btrim(new_email), ''),
    nullif(pg_catalog.btrim(new_phone), ''),
    true,
    auth.uid(),
    auth.uid()
  );

  if has_private_values then
    insert into erp.customer_private_details (
      organization_id, customer_id, tax_id, identity_document,
      address, internal_notes, updated_by
    ) values (
      target_organization_id,
      customer_id_value,
      normalized_tax_id,
      normalized_identity_document,
      coalesce(new_address, '{}'::jsonb),
      nullif(pg_catalog.btrim(new_internal_notes), ''),
      auth.uid()
    );
  end if;

  return customer_id_value;
end;
$$;

revoke all on function erp.get_customer_private_details(uuid)
  from public, anon;
revoke all on function erp.upsert_customer_private_details(uuid, text, text, jsonb, text, boolean, timestamptz)
  from public, anon;
revoke all on function erp.create_customer_with_private_details(erp.party_kind, text, text, text, text, text, text, jsonb, text)
  from public, anon, service_role;

grant execute on function erp.get_customer_private_details(uuid)
  to authenticated, service_role;
grant execute on function erp.upsert_customer_private_details(uuid, text, text, jsonb, text, boolean, timestamptz)
  to authenticated, service_role;
grant execute on function erp.create_customer_with_private_details(erp.party_kind, text, text, text, text, text, text, jsonb, text)
  to authenticated;
