-- Resolve POS document amounts through the document authorization boundary.
-- This avoids granting direct sales reads merely to render a document KPI.

begin;

create or replace function erp.list_document_sale_amounts(target_document_ids uuid[])
returns table(document_id uuid, amount_ars numeric)
language sql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
  select
    d.id,
    case
      when upper(s.currency_code) = 'ARS' then s.total_amount
      when s.exchange_rate is not null then s.total_amount * s.exchange_rate
      else null
    end as amount_ars
  from erp.documents d
  join erp.sales s on s.id = d.owner_id and s.organization_id = d.organization_id
  where d.organization_id = erp.current_organization_id()
    and d.owner_type = 'sale'
    and d.id = any(coalesce(target_document_ids, '{}'::uuid[]))
    and erp.has_permission('documents.view', d.branch_id);
$$;

revoke all on function erp.list_document_sale_amounts(uuid[]) from public, anon, service_role;
grant execute on function erp.list_document_sale_amounts(uuid[]) to authenticated;

commit;
