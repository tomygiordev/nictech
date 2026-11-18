import type { Page } from '@playwright/test';
import { button, expect } from './fixtures';

export async function addPromotion(page: Page, target: string, promo: {
  name: string; kind: 'porcentaje' | 'precio_fijo'; value: string;
  channel: 'Web' | 'POS'; active: boolean;
}) {
  await button(page, 'Nueva promoción').click();
  await page.getByLabel('Nombre de la promoción').fill(promo.name);
  await page.getByLabel('Tipo de promoción').selectOption(promo.kind);
  await page.getByLabel(/Porcentaje de descuento|Precio promocional/).fill(promo.value);
  const now = Date.now() - 3 * 3600_000;
  const localTime = (delta: number) => new Date(now + delta).toISOString().slice(0, 16);
  await page.getByLabel('Inicio de vigencia').fill(localTime(-3600_000));
  await page.getByLabel('Fin de vigencia (opcional)').fill(localTime(3600_000));
  for (const channel of ['Web', 'POS']) {
    await page.getByRole('checkbox', { name: channel, exact: true }).setChecked(channel === promo.channel);
  }
  await page.getByLabel('Promoción activa').setChecked(promo.active);
  await page.getByLabel('Buscar producto o variante').fill(target);
  await expect(page.getByText(target).first()).toBeVisible();
  await button(page, 'Agregar producto').click();
  await button(page, 'Guardar promoción').click();
  const row = page.getByRole('row').filter({ hasText: promo.name });
  await expect(row).toBeVisible();
  return row;
}
