-- The repair overview is security-invoker and calls this helper while it is
-- being read. Keep the helper private to the API surface, but allow the same
-- authenticated operators who can read the overview to execute it indirectly.
grant execute on function erp.repair_latest_final_test_passes(uuid, uuid) to authenticated;
