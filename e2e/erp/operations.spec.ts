import { randomUUID } from 'node:crypto';
import { test, expect, owner, workspace, tag, button } from './fixtures';
import { balancesOf, depotId, publishSheet, stockedAccessory } from './catalog-fixtures';
import { literal, localClient, organizationId, publicClient, sql, sqlRows } from './local';

test('reparación: DNI, seguimiento público, notas, control de calidad y entrega', async ({ page }) => {
  await owner(page);
  await workspace(page, 'Servicio técnico');
  const name = `Cliente QA ${tag()}`;
  const model = `Equipo QA ${tag()}`;
  const dni = String(20_000_000 + parseInt(tag().slice(0, 6), 16));
  await button(page, 'Nueva Reparación').click();
  const intake = page.getByRole('dialog', { name: 'Ingreso de Reparación a Taller' });
  await intake.getByRole('button', { name: '+ Crear nuevo cliente' }).click();
  await intake.getByPlaceholder('Ej. Martín Gómez').fill(name);
  await intake.getByPlaceholder('Ej. 38123456').fill(dni);
  await intake.getByPlaceholder('Ej. 11 4444-5555').fill('1155500040');
  await intake.getByPlaceholder('Ej. iPhone 13 Pro 128GB').fill(model);
  await intake.getByPlaceholder('Ej. F2LXXXXX').fill(`SERIE-${tag()}`);
  await intake.getByPlaceholder(/No enciende tras caída/).fill('Pantalla sin imagen al iniciar');
  await intake.getByRole('button', { name: 'Ingresar al Taller' }).click();
  await expect(intake).toBeHidden();
  await expect(page.getByText(/ingresada. Código de seguimiento:/)).toBeVisible();

  const order = sqlRows<{ id: string; public_tracking_code: string; order_code: string }>(`
    select id,public_tracking_code,order_code from erp.repair_orders_overview where model_snapshot=${literal(model)}`)[0];
  expect(order.public_tracking_code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const search = page.getByPlaceholder(/Buscar seguimiento, DNI/);
  await search.fill(dni);
  const row = page.getByRole('button', { name: new RegExp(`Abrir reparación ${order.order_code}`) });
  await expect(row).toContainText(order.public_tracking_code);
  await row.click();
  const detail = page.getByRole('dialog', { name: /Ficha de Reparación/ });
  await expect(detail.getByText(order.public_tracking_code, { exact: true }).first()).toBeVisible();

  const notes = detail.getByRole('region', { name: 'Notas de reparación' });
  const publicNote = `La revisión de pantalla comenzó ${tag()}`;
  const privateNote = `Costo interno de pantalla QA ${tag()}`;
  for (const [note, visible] of [[privateNote, false], [publicNote, true]] as const) {
    await notes.getByLabel('Nueva nota').fill(note);
    await notes.getByRole('checkbox', { name: 'El cliente la ve en la web' }).setChecked(visible);
    await notes.getByRole('button', { name: 'Guardar nota' }).click();
    await expect(notes.getByText(note, { exact: true })).toBeVisible();
  }
  const { data, error } = await publicClient().rpc('get_repair_by_tracking_code_erp', {
    search_code: order.public_tracking_code,
  });
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(JSON.stringify(data)).toContain(publicNote);
  expect(JSON.stringify(data)).not.toContain(privateNote);
  expect(JSON.stringify(data)).not.toContain(dni);

  await detail.getByRole('button', { name: /Avanzar a Diagn[oó]stico/i }).click();
  await detail.getByRole('button', { name: /Avanzar a Reparaci[oó]n/i }).click();
  await detail.getByRole('button', { name: 'Iniciar control final' }).click();
  const qc = page.getByRole('dialog', { name: /Control de calidad/ });
  const checks = qc.getByRole('group', { name: /Resultado de/ });
  await expect(checks).toHaveCount(3);
  for (const check of await checks.all()) await check.getByRole('button', { name: 'Aprobado' }).click();
  await qc.getByRole('button', { name: 'Guardar control de calidad' }).click();
  await expect(qc).toBeHidden();
  await detail.getByRole('button', { name: /Avanzar a Listo/i }).click();
  await detail.getByRole('button', { name: 'Entregar al Cliente' }).click();
  const delivery = page.getByRole('dialog', { name: /Entrega Formal de Equipo/ });
  await delivery.getByRole('textbox').nth(0).fill(name);
  await delivery.getByRole('textbox').nth(1).fill(dni.slice(-4));
  await delivery.getByRole('button', { name: 'Confirmar Entrega y Póliza' }).click();
  await expect(delivery).toBeHidden();
  expect(sqlRows(`select repair_order_id from erp.repair_deliveries where repair_order_id=${literal(order.id)}`))
    .toEqual([{ repair_order_id: order.id }]);
});

test('webhook aprobado local: pedido y venta, stock descontado una sola vez', async ({ page }) => {
  await owner(page);
  const product = await stockedAccessory(page, 'Pedido Web', 4);
  await publishSheet(page, product.internal_name);
  const orderId = randomUUID();
  const customerId = randomUUID();
  const variant = balancesOf(product.id)[0].variant_id;
  expect(variant).toBeTruthy();
  const payer = { name: `Comprador QA ${tag()}`, email: `qa-${tag()}@nictech.test` };
  const items = [{ product_id: product.id, variant_id: variant, inventory_unit_id: null, quantity: 1, unit_price: 1210, title: product.internal_name }];
  sql(`begin;
    insert into erp.customers(id,organization_id,code,display_name)
      values (${literal(customerId)}, '${organizationId}', 'QA-WEB-${tag()}', ${literal(payer.name)});
    insert into public.orders(id,items,payer,total,status)
      values (${literal(orderId)}, ${literal(JSON.stringify(items))}::jsonb, ${literal(JSON.stringify(payer))}::jsonb, 1210, 'pending');
    commit;`);
  const snapshot = process.env.ERP_E2E_ARS_SNAPSHOT;
  if (!snapshot) throw new Error('Falta el snapshot ARS del setup local.');
  const paymentId = `e2e-${tag()}`;
  const client = localClient('ERP_E2E_SERVICE').schema('erp');
  const payload = {
    p_organization_id: organizationId, p_branch_id: '20000000-0000-0000-0000-000000000001',
    p_location_id: depotId, p_storefront_order_id: orderId, p_customer_id: customerId,
    p_exchange_snapshot_id: snapshot, p_payment_method_id: '82000000-0000-0000-0000-000000000003',
    p_provider_payment_id: paymentId, p_provider_event_id: `approved-${tag()}`, p_status: 'approved',
    p_total: 1210, p_currency_code: 'ARS', p_external_reference: orderId, p_payer: payer, p_items: items,
    p_provider_occurred_at: new Date().toISOString(), p_raw_data: { id: paymentId, payment_method_id: 'account_money' },
  };
  const { data, error } = await client.rpc('process_mercadopago_payment', payload);
  expect(error).toBeNull();
  expect(data).toMatchObject({ web_order_id: expect.any(String), sale_id: expect.any(String), idempotent: false });
  const replay = await client.rpc('process_mercadopago_payment', payload);
  expect(replay.error).toBeNull();
  expect(replay.data).toMatchObject({ idempotent: true });
  expect(balancesOf(product.id)).toMatchObject([{ qty: 3, reserved: 0 }]);
  expect(sqlRows(`select status,payment_id,stock_decremented from public.orders where id=${literal(orderId)}`))
    .toEqual([{ status: 'approved', payment_id: paymentId, stock_decremented: true }]);
  expect(sqlRows(`select amount from erp.payments where provider_reference=${literal(paymentId)}`))
    .toEqual([{ amount: 1210 }]);
  if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.web_order_id !== 'string') {
    throw new Error('Respuesta del webhook sin identificador ERP.');
  }
  const short = data.web_order_id.slice(0, 8).toUpperCase();
  await workspace(page, 'Pedidos online');
  const row = button(page, `Abrir pedido ${short}`);
  await expect(row).toContainText('Aprobado');
  await expect(row).toContainText('Cumplido');
  await row.click();
  const detail = page.getByRole('dialog', { name: `Pedido Web: ORD-${short}` });
  await expect(detail).toContainText('Stock: remitido');
  await expect(detail).toContainText('payment_state: paid');
});
