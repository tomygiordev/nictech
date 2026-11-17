-- Internal trigger functions are not public RPCs.
revoke execute on function erp.enforce_variant_creation_stock_granularity() from public, anon;
revoke execute on function erp.enforce_parent_stock_balance_granularity() from public, anon;
revoke execute on function erp.enforce_parent_stock_reservation_granularity() from public, anon;
revoke execute on function erp.enforce_parent_inventory_unit_granularity() from public, anon;
