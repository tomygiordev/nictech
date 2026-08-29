-- Phase A: correct stale-preview visibility and repair command row handling.
do $$
declare
  definition text;
begin
  select pg_get_functiondef('erp.apply_price_change(uuid,text,text)'::regprocedure) into definition;
  definition := replace(definition, 'and entry.effective_at <= now()', 'and entry.effective_at <= effective_time');
  execute definition;

  select pg_get_functiondef('erp.transition_repair_order(uuid,uuid,text,text,text)'::regprocedure) into definition;
  definition := replace(
    definition,
    'select s into status_row from erp.repair_status_transitions t join erp.repair_statuses s',
    'select s.id, s.organization_id, s.code, s.name, s.display_order, s.is_initial, s.is_terminal, s.requires_final_tests, s.public_message, s.is_active, s.created_at into status_row from erp.repair_status_transitions t join erp.repair_statuses s'
  );
  execute definition;

  select pg_get_functiondef('erp.create_repair_quote_version(uuid,text,uuid,jsonb,text,text)'::regprocedure) into definition;
  definition := replace(definition, 'where u.id=inventory_unit_id', 'where u.id=erp.create_repair_quote_version.inventory_unit_id');
  execute definition;
end;
$$;
