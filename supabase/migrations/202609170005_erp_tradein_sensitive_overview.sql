-- Keep the trade-in overview operational for readers while redacting
-- personally identifying and financial fields unless the caller is allowed
-- to work with the corresponding sensitive workflow.

begin;

create or replace view erp.trade_ins_overview as
select
  t.id,
  t.organization_id,
  t.branch_id,
  t.customer_id,
  c.display_name as customer_name,
  c.code as customer_code,
  c.phone as customer_phone,
  t.product_id,
  p.internal_name as product_name,
  p.internal_code as product_code,
  t.variant_id,
  pv.code as variant_code,
  pv.name as variant_name,
  t.inventory_unit_id,
  case when erp.has_permission('trade_ins.manage', t.branch_id)
          or erp.has_permission('trade_ins.approve', t.branch_id)
       then u.serial_number end as serial_number,
  case when erp.has_permission('trade_ins.manage', t.branch_id)
          or erp.has_permission('trade_ins.approve', t.branch_id)
       then u.imei end as imei,
  u.status as unit_status,
  (case when erp.has_permission('costs.view', t.branch_id)
        then t.declared_value_base end)::numeric(18,4) as declared_value_base,
  t.received_at,
  prov.decision as provenance_decision,
  prov.reviewed_at as provenance_reviewed_at,
  imei_req.request_version as imei_request_version,
  imei_res.status as imei_status,
  imei_res.source as imei_source,
  imei_res.checked_at as imei_checked_at,
  eval.id as evaluation_id,
  eval.version as evaluation_version,
  (case when erp.has_permission('costs.view', t.branch_id)
        then eval.appraised_value_base end)::numeric(18,4) as appraised_value_base,
  (case when erp.has_permission('costs.view', t.branch_id)
        then eval.estimated_refurbishment_cost_base end)::numeric(18,4) as estimated_refurbishment_cost_base,
  eval_rev.decision as evaluation_decision,
  case when erp.has_permission('costs.view', t.branch_id)
       then coalesce((select sum(r.actual_cost_base) from erp.trade_in_refurbishments r where r.trade_in_id = t.id), 0)
       end as actual_refurbishment_cost,
  rel.id as release_id,
  (case when erp.has_permission('costs.view', t.branch_id)
        then rel.total_cost_base end)::numeric(18,4) as release_total_cost,
  rel.destination_location_id as release_location_id,
  rel.released_at,
  pay.id as payment_id,
  pay.sale_id,
  (case when erp.has_permission('costs.view', t.branch_id)
        then pay.amount end)::numeric(18,4) as payment_amount,
  pay.occurred_at as payment_applied_at,
  case
    when pay.id is not null then 'applied_to_sale'
    when rel.id is not null then 'ready_for_stock'
    when eval.id is not null then 'evaluating'
    else 'quarantine'
  end as stage
from erp.trade_ins t
join erp.customers c on c.id = t.customer_id
join erp.products p on p.id = t.product_id
left join erp.product_variants pv on pv.id = t.variant_id
join erp.inventory_units u on u.id = t.inventory_unit_id
left join lateral (
  select pr.decision, pr.reviewed_at
    from erp.trade_in_provenance_reviews pr
   where pr.trade_in_id = t.id
   order by pr.event_sequence desc limit 1
) prov on true
left join lateral (
  select ir.id as request_id, ir.request_version
    from erp.trade_in_imei_requests ir
   where ir.trade_in_id = t.id
   order by ir.request_version desc limit 1
) imei_req on true
left join lateral (
  select res.status, res.source, res.checked_at
    from erp.trade_in_imei_results res
   where (imei_req.request_id is not null and res.request_id = imei_req.request_id)
      or (imei_req.request_id is null and res.trade_in_id = t.id and res.source = 'manual')
   order by res.event_sequence desc limit 1
) imei_res on true
left join lateral (
  select e.id, e.version, e.appraised_value_base, e.estimated_refurbishment_cost_base
    from erp.trade_in_evaluations e
   where e.trade_in_id = t.id
   order by e.version desc limit 1
) eval on true
left join lateral (
  select er.decision
    from erp.trade_in_evaluation_reviews er
   where er.evaluation_id = eval.id
   order by er.event_sequence desc limit 1
) eval_rev on true
left join erp.trade_in_releases rel on rel.trade_in_id = t.id
left join lateral (
  select sp.id, sp.sale_id, sp.amount, sp.occurred_at
    from erp.trade_in_sale_payment_events sp
   where sp.trade_in_id = t.id and sp.event_kind = 'applied'
   order by sp.occurred_at desc, sp.id desc limit 1
) pay on true
where t.organization_id = erp.current_organization_id()
  and erp.has_permission('trade_ins.view', t.branch_id);

alter view erp.trade_ins_overview set (security_invoker = false, security_barrier = true);
grant select on erp.trade_ins_overview to authenticated;

commit;
