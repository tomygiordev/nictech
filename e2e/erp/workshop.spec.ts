import { randomUUID } from 'node:crypto';
import { balancesOf, depotId } from './catalog-fixtures';
import { button, capture, expect, owner, setProfile, tag, test, workspace } from './fixtures';
import { literal, organizationId, ownerClient, sql, sqlRows } from './local';

const branchId = '20000000-0000-0000-0000-000000000001';
const unitId = '50000000-0000-0000-0000-000000000001';
const quantityTypeId = '60000000-0000-0000-0000-000000000001';
const serialTypeId = '60000000-0000-0000-0000-000000000002';

function seedCustomer(scope: string) {
  const id = randomUUID();
  const name = `QA Cliente ${scope} ${tag()}`;
  sql(`insert into erp.customers (id, organization_id, code, display_name)
    values (${literal(id)}, '${organizationId}', ${literal(`QA-${scope}-${tag()}`)}, ${literal(name)});`);
  return { id, name };
}

function seedProduct(label: string, tracking: 'quantity' | 'serial') {
  const id = randomUUID();
  const code = `QA-${label}-${tag()}`;
  const name = `QA ${label} ${tag()}`;
  sql(`insert into erp.products (id, organization_id, product_type_id, item_kind, unit_id,
    internal_code, internal_name, inventory_tracking, base_sale_price, tax_rate_percent, can_sell)
    values (${literal(id)}, '${organizationId}', '${tracking === 'serial' ? serialTypeId : quantityTypeId}',
      'product', '${unitId}', ${literal(code)}, ${literal(name)}, ${literal(tracking)}, 1210, 0, true);`);
  return { id, name };
}

async function seedStock(ids: string[], scope: string) {
  const erp = (await ownerClient()).schema('erp');
  const { error } = await erp.rpc('post_stock_document', {
    document_kind: 'opening', target_branch_id: branchId, operation_key: `qa-stock-${scope}-${tag()}`,
    operation_reason: `Existencias iniciales para ${scope} QA`,
    lines: ids.map((product_id) => ({ product_id, to_location_id: depotId, quantity: 3, unit_cost: 400 })),
  });
  expect(error).toBeNull();
}

test('armados: alta compatible, reserva de la revisión, checklist y entrega del equipo', async ({ page }) => {
  test.setTimeout(130_000);
  const customer = seedCustomer('PC');
  const slots = [
    ['motherboard', seedProduct('Placa', 'quantity')],
    ['cpu', seedProduct('CPU', 'quantity')],
    ['memory', seedProduct('RAM', 'quantity')],
    ['storage', seedProduct('SSD', 'quantity')],
    ['power_supply', seedProduct('Fuente', 'quantity')],
  ] as const;
  await seedStock(slots.map(([, product]) => product.id), 'PC');
  await owner(page);
  await setProfile(page, 'completo');
  await workspace(page, 'Armados de PC');
  await button(page, 'Nuevo armado').click();
  const form = page.getByRole('dialog', { name: 'Nuevo armado de PC' });
  const save = form.getByRole('button', { name: 'Crear armado' });
  await save.click();
  await expect(form.getByText('Ingresá el título del armado.')).toBeVisible();
  await capture(page, 'armados-alta-validacion');
  const title = `PC taller QA ${tag()}`;
  await form.getByLabel('Título del armado').fill(title);
  await form.getByLabel('Sucursal').selectOption(branchId);
  await form.getByLabel('Cliente').selectOption(customer.id);
  for (const [index, [slot, product]] of slots.entries()) {
    if (index > 0) await form.getByRole('button', { name: '+ Agregar componente' }).click();
    await form.getByLabel('Slot').nth(index).selectOption(slot);
    await form.getByLabel(/^Producto \(/).nth(index).selectOption(product.id);
  }
  for (const socket of await form.getByLabel('Socket', { exact: true }).all()) await socket.fill('AM4');
  for (const memory of await form.getByLabel('Tipo de memoria', { exact: true }).all()) await memory.fill('DDR4');
  await form.getByLabel('Potencia de fuente recomendada (W)').fill('500');
  await form.getByLabel('Potencia nominal de la fuente (W)').fill('650');
  await save.click();
  await expect(form).toBeHidden();
  const detail = page.getByRole('dialog', { name: `Armado: ${title}` });
  await expect(detail).toBeVisible();
  await expect(detail.getByText(/^Compatible •/)).toBeVisible();
  await detail.getByRole('tab', { name: /Compatibilidad/ }).click();
  await capture(page, 'armados-compatibilidad');
  await detail.getByRole('tab', { name: /Reserva/ }).click();
  const reserve = detail.getByRole('button', { name: 'Reservar componentes' });
  await reserve.click();
  await expect(detail.getByText('Elegí una ubicación para reservar los componentes.')).toBeVisible();
  await capture(page, 'armados-reserva-validacion');
  await detail.getByLabel('Ubicación de stock').selectOption(depotId);
  await reserve.click();

  const record = detail.getByRole('button', { name: 'Registrar testeo' });
  const checks = detail.getByRole('group', { name: /^Resultado de / });
  await expect(checks).toHaveCount(4);
  await record.click();
  await expect(detail.getByRole('alert')).toContainText('Registrá un resultado para cada control obligatorio');
  await capture(page, 'armados-checklist-validacion');
  for (const check of await checks.all()) await check.getByRole('button', { name: 'Aprobado' }).click();
  await record.click();
  const complete = detail.getByRole('button', { name: 'Completar armado' });
  await complete.click();
  await expect(detail.getByText('Ingresá el número de serie del equipo armado.')).toBeVisible();
  await capture(page, 'armados-entrega-validacion');
  const serial = `PCQA${tag()}`;
  await detail.getByLabel('Número de serie').fill(serial);
  await detail.getByLabel('Días de garantía').fill('90');
  await detail.getByLabel('Condiciones', { exact: true }).fill('Garantía del armado por 90 días.');
  await complete.click();
  await expect(detail.getByRole('button', { name: 'Ver costos' })).toBeVisible();
  await expect(detail.getByText(serial, { exact: true })).toBeVisible();
  await capture(page, 'armados-entrega-completada');
  await detail.getByRole('button', { name: 'Cerrar modal' }).click();
  await expect(button(page, `Abrir proyecto ${title} de ${customer.name}`)).toContainText('Completado');
  expect(sqlRows(`select e.state from erp.pc_build_state_events e
    join erp.pc_build_projects p on p.id=e.project_id where p.title=${literal(title)}
    order by e.event_sequence desc limit 1`)).toEqual([{ state: 'completed' }]);
  for (const [, product] of slots) expect(balancesOf(product.id)).toMatchObject([{ qty: 2, reserved: 0 }]);
});

test('equipos usados: recepción por serie, tasación, pago de venta y reversión', async ({ page }) => {
  test.setTimeout(130_000);
  const customer = seedCustomer('Canje');
  const used = seedProduct('Notebook usada', 'serial');
  const saleProduct = seedProduct('Venta canje', 'quantity');
  await seedStock([saleProduct.id], 'canje');
  const erp = (await ownerClient()).schema('erp');
  const snapshot = process.env.ERP_E2E_ARS_SNAPSHOT;
  if (!snapshot) throw new Error('Falta la cotización ARS del setup local.');
  const { data: sale, error } = await erp.rpc('create_sale_with_invoice', {
    target_branch_id: branchId, target_customer_id: customer.id, sale_currency: 'ARS',
    target_exchange_snapshot_id: snapshot, target_invoice_kind: 'non_fiscal',
    operation_key: `qa-venta-canje-${tag()}`, operation_reason: 'Venta con saldo pendiente para canje QA',
    lines: [{ kind: 'product', product_id: saleProduct.id, from_location_id: depotId, quantity: 1,
      expected_unit_price: 1210, expected_tax_rate: 0, gross_discount_amount: 0 }],
    payment_lines: [],
  });
  expect(error).toBeNull();
  if (!sale || typeof sale !== 'object' || Array.isArray(sale) || typeof sale.sale_id !== 'string') throw new Error('La venta QA no devolvió su ID.');

  await owner(page);
  await setProfile(page, 'completo');
  await workspace(page, 'Equipos usados');
  await button(page, 'Recibir equipo en parte de pago').click();
  const intake = page.getByRole('dialog', { name: 'Recibir equipo en parte de pago' });
  const receive = intake.getByRole('button', { name: 'Registrar recepción' });
  await receive.click();
  await expect(intake.getByRole('alert').filter({ hasText: /cliente/i })).toBeVisible();
  await capture(page, 'canjes-ingreso-validacion');
  await intake.getByLabel('Sucursal').selectOption(branchId);
  await intake.getByLabel('Cliente').selectOption(customer.id);
  await intake.getByLabel('Producto compatible').selectOption(used.id);
  await intake.getByLabel('Serie del equipo').fill(`CANJE${tag()}`);
  await intake.getByLabel('Titular del equipo').fill(customer.name);
  await intake.getByLabel('Declaración de procedencia').fill('Equipo sintético de titularidad declarada para la prueba.');
  await intake.getByLabel('Valor declarado (base)').fill('900');
  await intake.getByLabel('Documento de evidencia').fill('Declaración QA de titularidad');
  await receive.click();
  await expect(intake).toBeHidden();
  const row = button(page, `Abrir equipo usado ${used.name}`);
  await row.click();
  const detail = page.getByRole('dialog', { name: `Equipo usado: ${used.name}` });
  await detail.getByLabel('Motivo operativo (para cualquier acción)').fill('Recepción y tasación QA');
  await detail.getByRole('button', { name: 'Aprobar procedencia' }).click();
  await expect(detail.getByText('Procedencia aprobada.', { exact: true })).toBeVisible();
  await detail.getByLabel('Respaldo manual').selectOption('not_required');
  await detail.getByLabel('DNI del vendedor verificado').check();
  await detail.getByLabel('Observaciones').fill('Notebook identificada solamente por serie');
  await detail.getByRole('button', { name: 'Registrar respaldo manual' }).click();
  await expect(detail.getByText('Respaldo manual de IMEI registrado.', { exact: true })).toBeVisible();

  const evaluate = detail.getByRole('button', { name: 'Crear tasación' });
  await evaluate.click();
  await expect(detail.getByRole('alert').filter({ hasText: /tasado/i })).toBeVisible();
  await capture(page, 'canjes-tasacion-validacion');
  await detail.getByLabel('Valor tasado (base)').fill('800');
  await detail.getByLabel('Costo reacond. estimado').fill('0');
  await detail.getByLabel('Estado / condición').fill('Funcional, sin daños de pantalla');
  await evaluate.click();
  await expect(detail.getByText('Tasación del equipo registrada.', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: 'Aprobar tasación' }).click();
  await expect(detail.getByText('Tasación aprobada.', { exact: true })).toBeVisible();
  await detail.getByLabel('Depósito destino').selectOption(depotId);
  await detail.getByRole('button', { name: 'Liberar a stock' }).click();
  await expect(detail.getByText('Equipo liberado a stock.', { exact: true })).toBeVisible();
  const apply = detail.getByRole('button', { name: 'Aplicar pago' });
  await apply.click();
  await expect(detail.getByRole('alert').filter({ hasText: /venta/i })).toBeVisible();
  await capture(page, 'canjes-aplicar-pago-validacion');
  await detail.getByLabel('Venta destino').selectOption(sale.sale_id);
  await detail.getByLabel('Monto', { exact: false }).fill('800');
  await apply.click();
  await expect(detail.getByText('Equipo aplicado como pago de la venta.', { exact: true })).toBeVisible();
  await capture(page, 'canjes-pago-aplicado');
  const reverse = detail.getByRole('button', { name: 'Revertir pago' });
  await reverse.click();
  await expect(detail.getByText('Pago aplicado revertido.', { exact: true })).toBeVisible();
  await expect(reverse).toBeDisabled();
  const events = sqlRows<{ reverses_event_id: string | null; id: string; amount: number }>(`
    select id,reverses_event_id,amount from erp.trade_in_sale_payment_events
    where sale_id=${literal(sale.sale_id)} order by reverses_event_id nulls first`);
  expect(events).toHaveLength(2);
  expect(events[1].reverses_event_id).toBe(events[0].id);
  expect(events.map(({ amount }) => amount)).toEqual([800, -800]);
  await capture(page, 'canjes-pago-revertido');
});
