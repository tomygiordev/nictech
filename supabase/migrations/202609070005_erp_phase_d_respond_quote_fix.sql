-- Migration: 202609070005_erp_phase_d_respond_quote_fix.sql
-- Description: Fix issue_repair_quote expiry in respond_quote_direct to fit within 7-day cap

create or replace function erp.respond_quote_direct(
  target_quote_id uuid,
  decision text,
  customer_message text default null
)
returns uuid language plpgsql security definer set search_path=pg_catalog,erp,extensions as $$
declare
  org_id uuid := erp.current_organization_id();
  quote_row erp.repair_quotes%rowtype;
  token_record record;
  active_token text;
  event_id uuid;
begin
  select * into quote_row from erp.repair_quotes where id = target_quote_id and organization_id = org_id;
  if quote_row.id is null then raise exception using errcode = 'no_data_found', message = 'quote not found'; end if;
  if not erp.has_permission('quotes.manage', quote_row.branch_id) then
    raise exception using errcode = 'insufficient_privilege', message = 'quotes.manage permission is required';
  end if;

  -- If not yet issued, issue it now with expiry within 7 days
  if quote_row.issued_at is null then
    select * into token_record from erp.issue_repair_quote(
      target_quote_id,
      now() + interval '6 days',
      'auto-issue-' || extensions.gen_random_uuid()::text,
      'Emisión para registro de respuesta del cliente'
    );
    active_token := token_record.response_token;
  else
    -- If already issued, reissue to obtain unconsumed active token
    select response_token into active_token from erp.reissue_repair_quote_token(
      target_quote_id,
      least(quote_row.expires_at, now() + interval '6 days'),
      'Reemisión para registrar decisión del cliente'
    );
  end if;

  event_id := public.respond_repair_quote(active_token, decision, customer_message);
  return event_id;
end;
$$;

grant execute on function erp.respond_quote_direct(uuid,text,text) to authenticated;
