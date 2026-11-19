import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { account, literal, localClient, organizationId, ownerClient, sql, sqlRows } from './local';

export default async function globalSetup() {
  const organizations = sqlRows<{ id: string }>('select id from erp.organizations');
  if (organizations.length !== 1 || organizations[0].id !== organizationId) {
    throw new Error('La base local no contiene exclusivamente la organización esperada del seed ERP.');
  }
  const unrelatedUsers = sqlRows<{ count: number }>(`select count(*)::int as count from auth.users
    where email not in ('e2e-owner@nictech.test', 'e2e-norole@nictech.test') or email is null`)[0].count;
  if (unrelatedUsers > 0) throw new Error('La base local contiene otras cuentas. Usá un stack E2E descartable.');
  sql(readFileSync('e2e/erp/storefront-fixture.sql', 'utf8'));

  const admin = localClient('ERP_E2E_SERVICE');
  for (const [kind, displayName] of [['OWNER', 'QA ERP Owner'], ['NOROLE', 'QA ERP Sin Rol']]) {
    const email = `e2e-${kind.toLowerCase()}@nictech.test`;
    const password = randomBytes(24).toString('base64url');
    const existing = sqlRows<{ id: string }>(`select id from auth.users where email = ${literal(email)}`)[0];
    const attrs = { password, email_confirm: true, user_metadata: { display_name: displayName, full_name: displayName } };
    const { data, error } = existing
      ? await admin.auth.admin.updateUserById(existing.id, attrs)
      : await admin.auth.admin.createUser({ email, ...attrs });
    if (error || !data.user) throw new Error(`Auth admin local (${kind}): ${error?.message ?? 'sin usuario'}`);
    const id = data.user.id;
    process.env[`ERP_E2E_${kind}_PASSWORD`] = password;
    process.env[`ERP_E2E_${kind}_ID`] = id;
    if (kind === 'NOROLE') {
      sql(`update erp.profile_roles set valid_until = now()
        where profile_id = ${literal(id)} and organization_id = '${organizationId}'
        and valid_from < now() and (valid_until is null or valid_until > now());`);
      continue;
    }
    const roles = sqlRows<{ code: string }>(`select r.code from erp.profile_roles pr
      join erp.roles r on r.id = pr.role_id where pr.profile_id = ${literal(id)}
      and r.is_active and pr.valid_from <= now() and (pr.valid_until is null or pr.valid_until > now())`);
    if (!roles.some(({ code }) => code === 'owner')) {
      const { error: bootstrapError } = await admin.schema('erp').rpc('bootstrap_first_owner', { p_profile_id: id });
      if (bootstrapError) throw new Error(`bootstrap_first_owner local: ${bootstrapError.message}`);
    }
  }
  const run = randomUUID().slice(0, 8).toUpperCase();
  process.env.ERP_E2E_RUN = run;
  const owner = await ownerClient();
  const openQaCash = sqlRows<{ id: string; counts: { currency_code: string; amount: number }[] }>(`
    select s.id, json_agg(json_build_object('currency_code', o.currency_code, 'amount',
      o.amount + coalesce((select sum(m.amount) from erp.cash_movements m
        where m.cash_session_id=s.id and m.currency_code=o.currency_code), 0))) as counts
    from erp.cash_sessions s join erp.cash_session_opening_counts o on o.cash_session_id=s.id
    where s.opened_by=${literal(account('OWNER').id)} and s.reason ~ '^Caja QA (Diferencia )?[0-9A-F]{8}$'
      and not exists (select 1 from erp.cash_closures c where c.cash_session_id=s.id)
    group by s.id`);
  for (const { id, counts } of openQaCash) {
    const { error } = await owner.schema('erp').rpc('close_cash_session', {
      target_cash_session_id: id, counted_amounts: counts,
      operation_key: `qa-recuperar-caja-${id}`, operation_reason: 'Cierre de una corrida E2E interrumpida',
    });
    if (error) throw new Error(`Cierre de caja QA previa: ${error.message}`);
  }
  for (const [currency, rate] of [['ARS', 1], ['USD', 1000]] as const) {
    const { data, error } = await owner.schema('erp').rpc('capture_exchange_rate', {
      target_quote_currency: currency, captured_rate_to_base: rate, rate_source: 'qa-e2e',
      quote_time: new Date().toISOString(), operation_key: `qa-fx-${currency}-${run}`,
      operation_reason: 'Cotización sintética para E2E local',
    });
    if (error || !data) throw new Error(`Cotización local ${currency}: ${error?.message ?? 'sin resultado'}`);
    if (currency === 'ARS') process.env.ERP_E2E_ARS_SNAPSHOT = data;
  }
}
