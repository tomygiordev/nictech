-- Phase A: remove default PUBLIC execution from service-only communication commands.
revoke execute on function erp.record_provider_webhook(uuid,text,text,text,text,boolean) from public, authenticated, anon;
revoke execute on function erp.record_communication_automation_execution(uuid,text,uuid,uuid,text,text) from public, authenticated, anon;
grant execute on function erp.record_provider_webhook(uuid,text,text,text,text,boolean) to service_role;
grant execute on function erp.record_communication_automation_execution(uuid,text,uuid,uuid,text,text) to service_role;
