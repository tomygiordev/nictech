import type { Page, Request } from '@playwright/test';
import { test, expect, paymentPath } from './fixtures';
import { addButton, cart, details, openCatalog, openDetails, openVariantCatalog, selectColor, storedCart, uuidPattern } from './storefront';

type CheckoutPayload = {
  checkout_id: string;
  expected_total: number;
  items: { id: string; variant_id: string | null; quantity: number }[];
  payer: { name: string; dni: string; email: string; phone: string; address: string };
};

const payload = (request: Request) => request.postDataJSON() as CheckoutPayload;
const pay = (page: Page) => page.getByRole('button', { name: /^Pagar \$/ });

async function enterCheckout(page: Page) {
  const products = await openCatalog(page);
  const product = products.find((item) => item.stock > 0 && item.price > 0 && !item.product_variants?.length);
  expect(product, 'Producto simple en stock').toBeDefined();
  await openDetails(page, product!);
  await addButton(page).click();
  await expect(details(page)).toHaveCount(0);
  await cart(page).click();
  await expect(page.getByRole('heading', { name: 'Tu Carrito' })).toBeVisible();
  await page.getByRole('button', { name: 'Proceder al Pago', exact: true }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(page.getByRole('heading', { name: 'Resumen del Pedido' })).toBeVisible();
  await expect(pay(page)).toBeEnabled();
  return product!;
}

async function fillPayer(page: Page) {
  await page.getByLabel(/Nombre Completo/).fill('Persona de Prueba');
  await page.getByLabel(/DNI \/ CUIL/).fill('12345678');
  await page.getByLabel(/Email/).fill('tienda-playwright@example.invalid');
  await page.getByLabel(/Teléfono \/ WhatsApp/).fill('1100000000');
}

test('04 Carrito: variantes separadas, cantidad, persistencia, eliminación y lecturas acotadas', async ({ page, network }, testInfo) => {
  const { product, first, second } = await openVariantCatalog(page, network, testInfo);
  for (const variant of [first, second]) {
    await openDetails(page, product);
    await selectColor(page, variant.color, variant.stock);
    await addButton(page).click();
    await expect(details(page)).toHaveCount(0);
  }
  await cart(page).click();
  await expect(page.getByText(`Color: ${first.color}`, { exact: true })).toBeVisible();
  await expect(page.getByText(`Color: ${second.color}`, { exact: true })).toBeVisible();
  const firstLine = page.getByRole('heading', { name: `${product.name} - ${first.color}`, exact: true }).locator('..');
  const secondLine = page.getByRole('heading', { name: `${product.name} - ${second.color}`, exact: true }).locator('..');
  await firstLine.getByRole('button', { name: 'Aumentar cantidad' }).click();
  await expect.poll(() => storedCart(page)).toMatchObject([
    { id: product.id, quantity: 2, variant: { id: first.id } },
    { id: product.id, quantity: 1, variant: { id: second.id } },
  ]);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await cart(page).click();
  await expect(firstLine.getByText('2', { exact: true })).toBeVisible();
  await expect(secondLine.getByText('1', { exact: true })).toBeVisible();
  await firstLine.getByRole('button', { name: 'Disminuir cantidad' }).click();
  await expect(firstLine.getByText('1', { exact: true })).toBeVisible();
  await secondLine.getByRole('button', { name: 'Eliminar producto' }).click();
  await expect(secondLine).toHaveCount(0);
  await expect.poll(() => storedCart(page)).toMatchObject([
    { id: product.id, quantity: 1, variant: { id: first.id } },
  ]);
  const reads = network.productReads.length;
  // A sampling window after effects settle detects a background validation loop.
  await page.waitForTimeout(750);
  expect(network.productReads.length, 'No debe volver a validar tras actualizar el carrito').toBe(reads);
  expect(reads, 'Catálogo, dos aperturas y recarga: máximo ocho GET a products').toBeLessThanOrEqual(8);
  testInfo.annotations.push({ type: 'GET products', description: String(reads) });
  await firstLine.getByRole('button', { name: 'Eliminar producto' }).click();
  await expect(page.getByText('Tu carrito está vacío')).toBeVisible();
});

test('05 Checkout: carrito vacío', async ({ page }) => {
  await page.goto('/checkout', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Tu carrito está vacío' })).toBeVisible();
  await expect(pay(page)).toHaveCount(0);
});

test('05 Checkout: validación de campos y formatos antes del pago', async ({ page, network }) => {
  await enterCheckout(page);
  network.checkout = () => ({ status: 400, json: {} });
  await pay(page).click();
  await expect(page.getByText(/campos obligatorios|ingresá tu nombre/i).first()).toBeVisible();
  await fillPayer(page);
  await page.getByLabel(/DNI \/ CUIL/).fill('abc');
  await page.getByLabel(/Email/).fill('no-es-un-email');
  await page.getByLabel(/Teléfono \/ WhatsApp/).fill('abc');
  await pay(page).click();
  await expect(page.getByText(/DNI o CUIL válido/i)).toBeVisible();
  await expect(page.getByText(/email válido/i)).toBeVisible();
  await expect(page.getByText(/teléfono válido/i)).toBeVisible();
  expect(network.checkoutCalls).toHaveLength(0);
});

test('05 Checkout: edge 200 redirige al init_point simulado', async ({ page, baseURL, network }) => {
  const product = await enterCheckout(page);
  const initPoint = new URL(paymentPath, baseURL!).href;
  network.checkout = () => ({ status: 200, json: { init_point: initPoint } });
  await fillPayer(page);
  await pay(page).click();
  await expect(page).toHaveURL(initPoint);
  await expect(page.getByRole('heading', { name: 'Pago simulado' })).toBeVisible();
  expect(network.checkoutCalls).toHaveLength(1);
  expect(payload(network.checkoutCalls[0])).toMatchObject({
    items: [{ id: product.id, variant_id: null, quantity: 1 }],
    payer: { email: 'tienda-playwright@example.invalid', address: expect.stringContaining('Urdinarrain') },
  });
  expect(payload(network.checkoutCalls[0]).expected_total).toBeGreaterThan(0);
});

test('05 Checkout: edge 409 actualiza el total y exige reconfirmación', async ({ page, baseURL, network }) => {
  const product = await enterCheckout(page);
  const initPoint = new URL(paymentPath, baseURL!).href;
  const increase = 1234;
  network.checkout = (request) => network.checkoutCalls.length === 1 ? {
    status: 409,
    json: { items: [{ product_id: product.id, variant_id: null, unit_price: payload(request).expected_total + increase }] },
  } : { status: 200, json: { init_point: initPoint } };
  await fillPayer(page);
  await pay(page).click();
  await expect(page.getByText(/El precio cambió\. Revisá el total actualizado antes de pagar/i)).toBeVisible();
  const first = payload(network.checkoutCalls[0]);
  const newPrice = first.expected_total + increase;
  await expect(pay(page)).toHaveText(`Pagar $ ${newPrice.toLocaleString('es-AR')}`);
  await expect(page).toHaveURL(/\/checkout$/);
  expect(network.checkoutCalls).toHaveLength(1);
  await pay(page).click();
  await expect(page).toHaveURL(initPoint);
  expect(network.checkoutCalls).toHaveLength(2);
  const second = payload(network.checkoutCalls[1]);
  expect(second.expected_total).toBe(newPrice);
  expect(second.checkout_id).toMatch(uuidPattern);
  expect(second.checkout_id).not.toBe(first.checkout_id);
});

test('05 Checkout: edge 400 muestra un mensaje y conserva el carrito', async ({ page, network }) => {
  await enterCheckout(page);
  network.checkout = () => ({ status: 400, json: { error: 'Solicitud inválida simulada' } });
  await fillPayer(page);
  await pay(page).click();
  await expect(page.getByText(/No se pudo iniciar el pago\. Intentá nuevamente/i)).toBeVisible();
  await expect(page).toHaveURL(/\/checkout$/);
  await expect(pay(page)).toBeEnabled();
  await expect(page.getByText('Cantidad: 1', { exact: true })).toBeVisible();
  expect(network.checkoutCalls).toHaveLength(1);
});
