import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { test, expect, owner, workspace, tag, button, capture } from './fixtures';
import { balancesOf, createSheet, depotId, findProduct, publishSheet, stockedAccessory } from './catalog-fixtures';
import { literal, localClient, organizationId, publicClient, sql, sqlRows } from './local';

async function intakeRepair(page: Page, scope: string, screenshots: boolean) {
  await workspace(page, 'Servicio técnico');
  const name = `Cliente QA ${scope} ${tag()}`;
  const model = `Equipo QA ${scope} ${tag()}`;
  const dni = String((scope === 'Taller' ? 20_000_000 : 40_000_000) + parseInt(tag().slice(0, 6), 16));
  await button(page, 'Nueva Reparación').click();
  const intake = page.getByRole('dialog', { name: 'Ingreso de Reparación a Taller' });
  const submit = intake.getByRole('button', { name: 'Ingresar al taller' });
  await intake.getByRole('button', { name: 'Crear un cliente nuevo' }).click();
  if (screenshots) {
    await submit.click();
    await expect(intake.getByText('Indicá el modelo del equipo.')).toBeVisible();
    await capture(page, 'reparaciones-ingreso-validacion');
  }
  await intake.getByLabel('Sucursal').selectOption('20000000-0000-0000-0000-000000000001');
  await intake.getByLabel('Nombre completo').fill(name);
  await intake.getByLabel('DNI', { exact: true }).fill(dni);
  await intake.getByLabel('Teléfono / WhatsApp').fill('1155500040');
  await intake.getByLabel('Tipo de equipo').selectOption('Smartphone');
  await intake.getByLabel('Marca').selectOption('Apple');
  await intake.getByLabel('Modelo exacto').fill(model);
  await intake.getByLabel('Número de serie').fill(`SERIE-${scope}-${tag()}`);
  await intake.getByLabel('Falla declarada por el cliente').fill('Pantalla sin imagen al iniciar');
  await submit.click();
  await expect(intake).toBeHidden();
  await expect(page.getByText(/Orden .* ingresada\./)).toBeVisible();

  const order = sqlRows<{ id: string; public_tracking_code: string; order_code: string }>(`
    select id,public_tracking_code,order_code from erp.repair_orders_overview where model_snapshot=${literal(model)}`)[0];
  return { order, name, dni };
}

test('reparación: ingreso, DNI, notas, mano de obra, repuesto, cobro, entrega y reclamo', async ({ page }) => {
  test.setTimeout(135_000);
  await owner(page);
  const part = await createSheet(page, `QA Repuesto ${tag()}`, 'accesorio', []);
  sql(`update erp.products set can_use_as_repair_part=true where id=${literal(part.id)};`);
  await (await findProduct(page, part.internal_name)).getByRole('button', { name: 'Cargar stock' }).click();
  const stock = page.getByRole('dialog', { name: 'Cargar stock' });
  await stock.getByLabel('Ubicación de ingreso').selectOption(depotId);
  await stock.getByLabel('Cantidad a ingresar').fill('3');
  await stock.getByLabel('Costo unitario (ARS)').fill('400');
  await stock.getByRole('button', { name: 'Confirmar ingreso' }).click();
  await expect(stock).toBeHidden();
  const { order, name, dni } = await intakeRepair(page, 'Taller', true);
  expect(order.public_tracking_code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const search = page.getByRole('textbox', { name: 'Buscar reparaciones' });
  await search.fill(dni);
  const row = page.getByRole('button', { name: new RegExp(`Abrir reparación ${order.order_code}`) });
  await expect(row).toContainText(order.public_tracking_code);
  await row.click();
  const detail = page.getByRole('dialog', { name: /Ficha de Reparación/ });
  await expect(detail.getByText(order.public_tracking_code, { exact: true }).first()).toBeVisible();
  await capture(page, 'reparaciones-ficha');

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

  async function advance(status: RegExp) {
    await detail.getByRole('button', { name: status }).click();
    await page.getByPlaceholder('Motivo o aclaración sobre el cambio de estado…').fill('Verificado en taller');
    await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
    await expect(page.getByPlaceholder('Motivo o aclaración sobre el cambio de estado…')).toBeHidden();
  }
  await advance(/Avanzar a Diagn[oó]stico/i);
  await advance(/Avanzar a En reparaci[oó]n/i);
  await detail.getByRole('button', { name: 'Registrar trabajo' }).click();
  const labor = page.getByRole('dialog', { name: 'Registrar mano de obra' });
  await labor.locator('button[type=submit]').click();
  await expect(labor.getByText('Ingresá las horas trabajadas.')).toBeVisible();
  await capture(page, 'reparaciones-mano-de-obra-validacion');
  await labor.getByLabel('Trabajo realizado').fill('Limpieza de conectores');
  await labor.getByLabel('Horas').fill('2');
  await labor.getByLabel('Costo por hora en moneda base').fill('350');
  await labor.locator('button[type=submit]').click();
  await expect(labor).toBeHidden();
  expect(sqlRows(`select id from erp.repair_labor_facts where repair_order_id=${literal(order.id)}`)).toHaveLength(1);

  await detail.getByRole('tab', { name: /Repuestos & Stock/ }).click();
  await detail.getByRole('button', { name: 'Consumir repuesto' }).click();
  const consume = page.getByRole('dialog', { name: /Consumir repuesto/ });
  await consume.locator('button[type=submit]').click();
  await expect(consume.getByRole('alert').filter({ hasText: /repuesto/i })).toBeVisible();
  await capture(page, 'reparaciones-consumo-repuesto-validacion');
  await consume.getByLabel('Ubicación de stock').selectOption(depotId);
  await consume.getByLabel('Repuesto del catálogo').selectOption(part.id);
  await consume.getByLabel('Cantidad').fill('1');
  await consume.getByLabel('Motivo técnico').fill('Repuesto reemplazado en taller');
  await consume.locator('button[type=submit]').click();
  await expect(consume).toBeHidden();
  expect(balancesOf(part.id)).toMatchObject([{ qty: 2 }]);
  await capture(page, 'reparaciones-repuestos');

  await detail.getByRole('button', { name: 'Registrar cobro o seña' }).click();
  const payment = page.getByRole('dialog', { name: 'Cobro o seña de reparación' });
  await payment.locator('button[type=submit]').click();
  await expect(payment.getByText('Ingresá el importe.')).toBeVisible();
  await capture(page, 'reparaciones-cobro-validacion');
  await payment.getByLabel('Medio de pago').selectOption({ label: 'Tarjeta' });
  await payment.getByLabel('Moneda').selectOption('ARS');
  const rate = process.env.ERP_E2E_ARS_SNAPSHOT;
  if (!rate) throw new Error('Falta la cotización ARS del setup local.');
  await payment.getByLabel('Cotización').selectOption(rate);
  await payment.getByLabel('Importe').fill('2000');
  await payment.getByLabel('Motivo del cobro').fill('Cobro de reparación E2E');
  await payment.locator('button[type=submit]').click();
  await expect(payment).toBeHidden();
  expect(sqlRows(`select amount from erp.payments where repair_order_id=${literal(order.id)}`)).toEqual([{ amount: 2000 }]);

  await detail.getByRole('button', { name: 'Iniciar control final' }).click();
  const qc = page.getByRole('dialog', { name: /Control de calidad/ });
  const checks = qc.getByRole('group', { name: /Resultado de/ });
  await expect(checks).toHaveCount(3);
  for (const check of await checks.all()) await check.getByRole('button', { name: 'Aprobado' }).click();
  await capture(page, 'reparaciones-control-final');
  await qc.getByRole('button', { name: 'Guardar control de calidad' }).click();
  await expect(qc).toBeHidden();
  await expect(detail.getByRole('button', { name: 'Reinspeccionar equipo' })).toBeVisible();
  await advance(/Avanzar a Listo/i);
  await detail.getByRole('button', { name: 'Entregar al Cliente' }).click();
  const delivery = page.getByRole('dialog', { name: /Entrega formal de equipo/i });
  const deliver = delivery.getByRole('button', { name: 'Confirmar entrega y póliza' });
  await deliver.click();
  await expect(delivery.getByRole('alert')).toHaveText('Ingresá el nombre de quien retira.');
  await capture(page, 'reparaciones-entrega-validacion');
  await delivery.getByLabel('Nombre del receptor').fill(name);
  await delivery.getByLabel('Terminación DNI').fill(dni.slice(-4));
  await deliver.click();
  await expect(delivery).toBeHidden();
  expect(sqlRows(`select repair_order_id from erp.repair_deliveries where repair_order_id=${literal(order.id)}`))
    .toEqual([{ repair_order_id: order.id }]);
  const [warranty] = sqlRows<{ id: string }>(`select id from erp.repair_warranties where repair_order_id=${literal(order.id)}`);
  await detail.getByRole('button', { name: 'Cerrar modal' }).click();
  await expect(detail).toBeHidden();
  await page.getByRole('tab', { name: /Garantías/ }).click();
  await button(page, 'Abrir reclamo de garantía').click();
  const claim = page.getByRole('dialog', { name: 'Apertura de reclamo de garantía' });
  const register = claim.getByRole('button', { name: 'Registrar reclamo' });
  await register.click();
  await expect(claim.getByRole('alert').filter({ hasText: /falla|defecto/i })).toBeVisible();
  await capture(page, 'reparaciones-reclamo-garantia-validacion');
  const issue = `Pantalla vuelve a fallar ${tag()}`;
  await claim.getByLabel('Póliza vigente').selectOption(warranty.id);
  await claim.getByLabel('Defecto o falla reportada').fill(issue);
  await register.click();
  await expect(claim).toBeHidden();
  await expect(detail).toBeHidden();
  await expect(page.getByText(issue, { exact: true })).toBeVisible();
});

test('presupuesto de taller: alta, emisión automática y aceptación del cliente', async ({ page }) => {
  await owner(page);
  const { order } = await intakeRepair(page, 'Presupuesto', false);
  await workspace(page, 'Presupuestos');
  await button(page, 'Nuevo presupuesto').click();
  const create = page.getByRole('dialog', { name: 'Nuevo presupuesto' });
  const save = create.getByRole('button', { name: 'Guardar presupuesto formal' });
  await save.click();
  await expect(create.getByRole('alert').filter({ hasText: /orden|motivo/i }).first()).toBeVisible();
  await capture(page, 'presupuestos-alta-validacion');
  await create.getByLabel('Orden de reparación').selectOption(order.id);
  await create.getByLabel('Motivo o razón de emisión').fill('Presupuesto tras diagnóstico del equipo');
  await create.getByLabel('Tipo', { exact: true }).selectOption('free_concept');
  await create.getByLabel('Descripción').fill('Diagnóstico y mantenimiento');
  await create.getByLabel('Cantidad').fill('1');
  await create.getByLabel('Costo unitario').fill('250');
  await create.getByLabel('Precio unitario').fill('1000');
  await save.click();
  await expect(create).toBeHidden();
  const row = page.getByRole('row').filter({ hasText: order.order_code });
  await row.getByRole('button', { name: 'Decisión' }).click();
  const decision = page.getByRole('dialog', { name: 'Registrar decisión del cliente' });
  await decision.locator('button[type=submit]').click();
  await expect(decision.getByRole('alert')).toBeVisible();
  await capture(page, 'presupuestos-decision-validacion');
  await decision.getByRole('radio', { name: 'Aprobado' }).check();
  await decision.getByLabel(/Mensaje o notas del cliente/).fill('El cliente autorizó el trabajo.');
  await decision.locator('button[type=submit]').click();
  await expect(decision).toBeHidden();
  await expect(row).toContainText('Aprobado');
  await expect(row.getByRole('button', { name: 'WhatsApp' })).toBeVisible();
  await row.getByRole('button', { name: 'Ver', exact: true }).click();
  const detail = page.getByRole('dialog', { name: /^Presupuesto:/ });
  await expect(detail).toContainText('Diagnóstico y mantenimiento');
  await capture(page, 'presupuestos-ficha-aprobada');
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
  await expect(row).toContainText('Pagado');
  await expect(row).toContainText('Despachado');
  await row.click();
  const detail = page.getByRole('dialog', { name: `Pedido Web: ORD-${short}` });
  await expect(detail).toContainText('Movimiento de stock');
  await expect(detail).toContainText('Pago: Pagado');
  await expect(detail).toContainText('Entrega: Despachado');
  await capture(page, 'pedidos-online-detalle-pagado');
  await detail.getByRole('button', { name: 'Confirmar entrega' }).click();
  const delivery = page.getByRole('dialog', { name: 'Confirmar entrega' });
  const confirm = delivery.getByRole('button', { name: 'Confirmar acción' });
  await confirm.click();
  await expect(delivery.getByRole('alert')).toHaveText('Ingresá un motivo de al menos 3 caracteres.');
  await capture(page, 'pedidos-online-entrega-validacion');
  await delivery.getByLabel('Motivo de la operación').fill('Cliente recibió el pedido QA');
  await confirm.click();
  await expect(delivery).toBeHidden();
  await expect(page.getByText('Confirmar entrega registrado con trazabilidad.')).toBeVisible();
  await row.click();
  await expect(detail).toContainText('Entrega: Entregado');
  expect(balancesOf(product.id)).toMatchObject([{ qty: 3, reserved: 0 }]);
});
