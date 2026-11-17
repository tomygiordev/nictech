-- Official, permission-checked and audited bulk exports for ERP reports.
-- The browser may render paginated/read-only views, but downloadable datasets
-- must be obtained through this RPC so the export permission and audit trail
-- cannot be skipped by calling the Data API directly.

set search_path = erp, pg_catalog;

create or replace function erp.export_report_rows(
  report_code text,
  operation_reason text,
  filters jsonb default '{}'::jsonb,
  date_from date default null,
  date_to date default null,
  target_branch_id uuid default null,
  row_limit integer default 5000
)
returns jsonb
language plpgsql
security definer
set search_path = erp, pg_catalog, pg_temp
as $$
declare
  actor_id uuid := auth.uid();
  organization_id_value uuid := erp.current_organization_id();
  normalized_code text := lower(nullif(btrim(report_code), ''));
  normalized_reason text := nullif(btrim(operation_reason), '');
  normalized_filters jsonb := coalesce(filters, '{}'::jsonb);
  exported_rows jsonb := '[]'::jsonb;
  exported_count integer := 0;
  was_truncated boolean := false;
  allowed_filter_keys text[] := array[]::text[];
  unknown_filter_key text;
  search_filter text;
  schema_filter text;
  table_filter text;
  action_filter text;
  status_filter text;
begin
  if actor_id is null or organization_id_value is null then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'authenticated ERP context is required';
  end if;

  if normalized_code is null or normalized_code not in (
    'audit', 'iva_ventas', 'iva_compras', 'trial_balance', 'profitability'
  ) then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'unsupported ERP report code';
  end if;

  if normalized_reason is null or length(normalized_reason) < 3 then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'an export reason of at least 3 characters is required';
  end if;

  if length(normalized_reason) > 500 then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'the export reason cannot exceed 500 characters';
  end if;

  if row_limit is null or row_limit < 1 or row_limit > 5000 then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'row_limit must be between 1 and 5000';
  end if;

  if date_from is not null and date_to is not null and date_from > date_to then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'date_from cannot be after date_to';
  end if;

  if jsonb_typeof(normalized_filters) <> 'object' then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'filters must be a JSON object';
  end if;

  if target_branch_id is not null and not exists (
    select 1
    from erp.branches branch
    where branch.id = target_branch_id
      and branch.organization_id = organization_id_value
      and branch.is_active
  ) then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'target branch does not belong to the active organization';
  end if;

  -- Organization-wide exports require an organization-wide grant. A grant for
  -- one branch must never become a bulk export of every branch.
  if target_branch_id is null then
    if not erp.has_permission('reports.export') then
      raise exception using
        errcode = 'insufficient_privilege',
        message = 'organization-wide reports.export permission is required';
    end if;
  elsif not erp.has_permission('reports.export', target_branch_id) then
    raise exception using
      errcode = 'insufficient_privilege',
      message = 'reports.export permission is required for the target branch';
  end if;

  if normalized_code = 'audit' then
    allowed_filter_keys := array['search', 'schema', 'table', 'action', 'status'];
  end if;

  select key
    into unknown_filter_key
  from jsonb_object_keys(normalized_filters) as key
  where not (key = any(allowed_filter_keys))
  limit 1;

  if unknown_filter_key is not null then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = format('unsupported filter key: %s', unknown_filter_key);
  end if;

  search_filter := nullif(btrim(normalized_filters ->> 'search'), '');
  schema_filter := nullif(btrim(normalized_filters ->> 'schema'), '');
  table_filter := nullif(btrim(normalized_filters ->> 'table'), '');
  action_filter := nullif(lower(btrim(normalized_filters ->> 'action')), '');
  status_filter := nullif(lower(btrim(normalized_filters ->> 'status')), '');

  if status_filter is not null and status_filter not in ('success', 'warning') then
    raise exception using
      errcode = 'invalid_parameter_value',
      message = 'audit status filter must be success or warning';
  end if;

  if normalized_code = 'audit' then
    if not (
      (target_branch_id is null and (
        erp.has_permission('audit.view')
        or exists (
          select 1 from erp.branches branch
          where branch.organization_id = organization_id_value
            and branch.is_active
            and erp.has_permission('audit.view', branch.id)
        )
      ))
      or (target_branch_id is not null and erp.has_permission('audit.view', target_branch_id))
    ) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = 'audit.view permission is required for the export scope';
    end if;

    with limited as (
      select
        row_number() over (order by event.occurred_at desc, event.id desc) as ordinal,
        jsonb_build_object(
          'id', event.id,
          'occurred_at', event.occurred_at,
          'actor_user_id', event.actor_user_id,
          'schema_name', event.schema_name,
          'table_name', event.table_name,
          'record_id', event.record_id,
          'action', event.action,
          'reason', event.reason,
          'correlation_id', event.correlation_id,
          'metadata', event.metadata
        ) as payload
      from erp.audit_events event
      where event.organization_id = organization_id_value
        and (target_branch_id is null or event.branch_id = target_branch_id)
        and erp.has_permission('reports.export', event.branch_id)
        and erp.has_permission('audit.view', event.branch_id)
        and (date_from is null or event.occurred_at::date >= date_from)
        and (date_to is null or event.occurred_at::date <= date_to)
        and (schema_filter is null or event.schema_name = schema_filter)
        and (table_filter is null or event.table_name = table_filter)
        and (action_filter is null or lower(event.action) = action_filter)
        and (
          status_filter is null
          or (status_filter = 'warning' and event.action in ('delete', 'reject'))
          or (status_filter = 'success' and event.action not in ('delete', 'reject'))
        )
        and (
          search_filter is null
          or event.actor_user_id::text ilike '%' || search_filter || '%'
          or event.action ilike '%' || search_filter || '%'
          or event.table_name ilike '%' || search_filter || '%'
          or coalesce(event.record_id, '') ilike '%' || search_filter || '%'
          or coalesce(event.reason, '') ilike '%' || search_filter || '%'
        )
      order by event.occurred_at desc, event.id desc
      limit row_limit + 1
    )
    select
      coalesce(jsonb_agg(payload order by ordinal) filter (where ordinal <= row_limit), '[]'::jsonb),
      count(*) > row_limit
    into exported_rows, was_truncated
    from limited;

  elsif normalized_code = 'iva_ventas' then
    if not (
      (target_branch_id is null and erp.has_permission('reports.view'))
      or (target_branch_id is not null
        and erp.has_permission('reports.view', target_branch_id)
        and erp.has_permission('sales.view', target_branch_id))
    ) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = 'reports.view and sales.view permissions are required';
    end if;

    with limited as (
      select
        row_number() over (order by report.sale_date desc nulls last, report.sale_id) as ordinal,
        to_jsonb(report) as payload
      from (
        select
          value.organization_id, value.branch_id, value.sale_id, value.sale_date,
          value.alicuota, value.base_imponible, value.iva
        from erp.v_iva_ventas value
        where value.organization_id = organization_id_value
          and (target_branch_id is null or value.branch_id = target_branch_id)
          and erp.has_permission('reports.export', value.branch_id)
          and erp.has_permission('reports.view', value.branch_id)
          and erp.has_permission('sales.view', value.branch_id)
          and (date_from is null or value.sale_date >= date_from)
          and (date_to is null or value.sale_date <= date_to)
        order by value.sale_date desc nulls last, value.sale_id
        limit row_limit + 1
      ) report
    )
    select
      coalesce(jsonb_agg(payload order by ordinal) filter (where ordinal <= row_limit), '[]'::jsonb),
      count(*) > row_limit
    into exported_rows, was_truncated
    from limited;

  elsif normalized_code = 'iva_compras' then
    if not (
      (target_branch_id is null and erp.has_permission('reports.view'))
      or (target_branch_id is not null
        and erp.has_permission('reports.view', target_branch_id)
        and erp.has_permission('purchases.view', target_branch_id)
        and erp.has_permission('costs.view', target_branch_id))
    ) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = 'reports.view, purchases.view and costs.view permissions are required';
    end if;

    with limited as (
      select
        row_number() over (order by report.purchase_date desc nulls last, report.purchase_order_id) as ordinal,
        to_jsonb(report) as payload
      from (
        select
          value.organization_id, value.branch_id, value.purchase_order_id,
          value.purchase_date, value.alicuota, value.base_imponible, value.iva
        from erp.v_iva_compras value
        where value.organization_id = organization_id_value
          and (target_branch_id is null or value.branch_id = target_branch_id)
          and erp.has_permission('reports.export', value.branch_id)
          and erp.has_permission('reports.view', value.branch_id)
          and erp.has_permission('purchases.view', value.branch_id)
          and erp.has_permission('costs.view', value.branch_id)
          and (date_from is null or value.purchase_date >= date_from)
          and (date_to is null or value.purchase_date <= date_to)
        order by value.purchase_date desc nulls last, value.purchase_order_id
        limit row_limit + 1
      ) report
    )
    select
      coalesce(jsonb_agg(payload order by ordinal) filter (where ordinal <= row_limit), '[]'::jsonb),
      count(*) > row_limit
    into exported_rows, was_truncated
    from limited;

  elsif normalized_code = 'trial_balance' then
    if not (
      (target_branch_id is null
        and erp.has_permission('reports.view')
        and erp.has_permission('accounting.view'))
      or (target_branch_id is not null
        and erp.has_permission('reports.view', target_branch_id)
        and erp.has_permission('accounting.view', target_branch_id))
    ) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = 'reports.view and accounting.view permissions are required';
    end if;

    with report as (
      select
        entry.organization_id,
        entry.period_id,
        period.period_start,
        period.period_end,
        line.account_id,
        account.code as account_code,
        account.name as account_name,
        sum(round(line.debit * line.exchange_rate, 2))::numeric(18, 2) as total_debit,
        sum(round(line.credit * line.exchange_rate, 2))::numeric(18, 2) as total_credit,
        (
          sum(round(line.debit * line.exchange_rate, 2))
          - sum(round(line.credit * line.exchange_rate, 2))
        )::numeric(18, 2) as balance
      from erp.journal_entry_lines line
      join erp.journal_entries entry
        on entry.id = line.journal_entry_id
       and entry.organization_id = line.organization_id
      join erp.accounting_periods period
        on period.id = entry.period_id
       and period.organization_id = entry.organization_id
      join erp.chart_of_accounts account
        on account.id = line.account_id
       and account.organization_id = line.organization_id
      where entry.organization_id = organization_id_value
        and (target_branch_id is null or entry.branch_id = target_branch_id)
        and erp.has_permission('reports.export', entry.branch_id)
        and erp.has_permission('reports.view', entry.branch_id)
        and erp.has_permission('accounting.view', entry.branch_id)
        and (date_from is null or period.period_start >= date_from)
        and (date_to is null or period.period_end <= date_to)
        and period.status = 'closed'
        and entry.status in ('posted', 'reversed')
      group by
        entry.organization_id, entry.period_id, period.period_start, period.period_end,
        line.account_id, account.code, account.name
    ),
    limited as (
      select
        row_number() over (order by report.account_code, report.period_start, report.account_id) as ordinal,
        to_jsonb(report) as payload
      from report
      order by report.account_code, report.period_start, report.account_id
      limit row_limit + 1
    )
    select
      coalesce(jsonb_agg(payload order by ordinal) filter (where ordinal <= row_limit), '[]'::jsonb),
      count(*) > row_limit
    into exported_rows, was_truncated
    from limited;

  else
    if not (
      (target_branch_id is null and erp.has_permission('profitability.view'))
      or (target_branch_id is not null and erp.has_permission('profitability.view', target_branch_id))
    ) then
      raise exception using
        errcode = 'insufficient_privilege',
        message = 'profitability.view permission is required';
    end if;

    if date_from is not null or date_to is not null then
      raise exception using
        errcode = 'invalid_parameter_value',
        message = 'profitability export does not support date filters';
    end if;

    with sales_agg as (
      select
        line.organization_id,
        line.product_id,
        sum(line.quantity)::numeric(18, 4) as quantity_sold,
        sum(round(line.line_total * sale.exchange_rate, 4))::numeric(18, 4) as gross_revenue
      from erp.sale_lines line
      join erp.sales sale
        on sale.id = line.sale_id
       and sale.organization_id = line.organization_id
      where line.organization_id = organization_id_value
        and line.kind = 'product'
        and line.product_id is not null
        and (target_branch_id is null or sale.branch_id = target_branch_id)
        and erp.has_permission('reports.export', sale.branch_id)
        and erp.has_permission('profitability.view', sale.branch_id)
        and erp.has_permission('sales.view', sale.branch_id)
        and coalesce((
          select event.sale_state
          from erp.sale_state_events event
          where event.sale_id = sale.id
            and event.organization_id = sale.organization_id
            and event.sale_state is not null
          order by event.event_sequence desc
          limit 1
        ), 'confirmed'::erp.sale_state) <> 'cancelled'::erp.sale_state
      group by line.organization_id, line.product_id
    ),
    cost_agg as (
      select
        line.organization_id,
        line.product_id,
        sum(line.landed_cost_base)::numeric(18, 4) as total_landed_cost,
        sum(line.quantity)::numeric(18, 4) as quantity_received
      from erp.purchase_receipt_lines line
      join erp.purchase_receipts receipt
        on receipt.id = line.receipt_id
       and receipt.organization_id = line.organization_id
      where line.organization_id = organization_id_value
        and line.product_id is not null
        and (target_branch_id is null or receipt.branch_id = target_branch_id)
        and erp.has_permission('reports.export', receipt.branch_id)
        and erp.has_permission('profitability.view', receipt.branch_id)
        and erp.has_permission('purchases.view', receipt.branch_id)
        and erp.has_permission('costs.view', receipt.branch_id)
      group by line.organization_id, line.product_id
    ),
    report as (
      select
        product.organization_id,
        product.id as product_id,
        product.internal_code,
        product.internal_name,
        sales.quantity_sold,
        sales.gross_revenue,
        case
          when costs.quantity_received is null or costs.quantity_received = 0 then null
          else (costs.total_landed_cost / costs.quantity_received)::numeric(24, 8)
        end as avg_unit_landed_cost,
        case
          when costs.quantity_received is null or costs.quantity_received = 0 or sales.quantity_sold is null then null
          else (sales.quantity_sold * costs.total_landed_cost / costs.quantity_received)::numeric(18, 4)
        end as estimated_cost,
        case
          when costs.quantity_received is null or costs.quantity_received = 0 or sales.quantity_sold is null then null
          else (
            sales.gross_revenue - sales.quantity_sold * costs.total_landed_cost / costs.quantity_received
          )::numeric(18, 4)
        end as margin
      from erp.products product
      left join sales_agg sales
        on sales.product_id = product.id
       and sales.organization_id = product.organization_id
      left join cost_agg costs
        on costs.product_id = product.id
       and costs.organization_id = product.organization_id
      where product.organization_id = organization_id_value
        and (sales.quantity_sold is not null or costs.quantity_received is not null)
    ),
    limited as (
      select
        row_number() over (order by report.gross_revenue desc nulls last, report.product_id) as ordinal,
        to_jsonb(report) as payload
      from report
      order by report.gross_revenue desc nulls last, report.product_id
      limit row_limit + 1
    )
    select
      coalesce(jsonb_agg(payload order by ordinal) filter (where ordinal <= row_limit), '[]'::jsonb),
      count(*) > row_limit
    into exported_rows, was_truncated
    from limited;
  end if;

  exported_count := jsonb_array_length(exported_rows);

  insert into erp.audit_events (
    organization_id,
    branch_id,
    actor_user_id,
    schema_name,
    table_name,
    record_id,
    action,
    reason,
    request_id,
    metadata
  ) values (
    organization_id_value,
    target_branch_id,
    actor_id,
    'erp',
    'report_exports',
    normalized_code,
    'execute',
    normalized_reason,
    nullif(current_setting('request.id', true), ''),
    jsonb_strip_nulls(jsonb_build_object(
      'report_code', normalized_code,
      'date_from', date_from,
      'date_to', date_to,
      'filters', normalized_filters,
      'row_limit', row_limit,
      'row_count', exported_count,
      'truncated', was_truncated,
      'format', 'csv'
    ))
  );

  return jsonb_build_object(
    'report_code', normalized_code,
    'rows', exported_rows,
    'row_count', exported_count,
    'truncated', was_truncated
  );
end;
$$;

revoke all on function erp.export_report_rows(text, text, jsonb, date, date, uuid, integer)
  from public, anon, service_role;
grant execute on function erp.export_report_rows(text, text, jsonb, date, date, uuid, integer)
  to authenticated;

comment on function erp.export_report_rows(text, text, jsonb, date, date, uuid, integer) is
  'Official ERP CSV dataset endpoint. Enforces reports.export, source permissions, tenant/branch scope, limits and append-only audit metadata.';
