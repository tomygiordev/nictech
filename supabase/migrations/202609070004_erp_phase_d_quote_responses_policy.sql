-- Migration: 202609070004_erp_phase_d_quote_responses_policy.sql
-- Description: Grant select and add RLS policy for repair_quote_response_events to authenticated users with quotes.view

grant select on erp.repair_quote_response_events to authenticated;

create policy repair_quote_responses_select on erp.repair_quote_response_events
  for select to authenticated
  using (organization_id = erp.current_organization_id() and erp.has_permission('quotes.view', branch_id));
