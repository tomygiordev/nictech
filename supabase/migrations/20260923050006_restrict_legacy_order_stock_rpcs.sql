-- Legacy payment and stock helpers must remain callable by the deployed
-- service-role webhook until cutover, but never by browser/anonymous clients.
-- The legacy public schema is not present in local ERP-only resets.
do $$
begin
  if to_regprocedure('public.decrement_stock(uuid,integer)') is not null then
    revoke all on function public.decrement_stock(uuid, integer)
      from public, anon, authenticated;
    grant execute on function public.decrement_stock(uuid, integer)
      to service_role;
  end if;

  if to_regprocedure('public.process_approved_order(text,text,numeric,jsonb,jsonb,text,text,text,text)') is not null then
    revoke all on function public.process_approved_order(
      text, text, numeric, jsonb, jsonb, text, text, text, text
    ) from public, anon, authenticated;
    grant execute on function public.process_approved_order(
      text, text, numeric, jsonb, jsonb, text, text, text, text
    ) to service_role;
  end if;
end;
$$;
