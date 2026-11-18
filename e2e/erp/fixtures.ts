import { test as base, expect, type Page } from '@playwright/test';
import { account, apiUrl } from './local';
import { localUrl } from './local-url.mjs';

export const test = base.extend<{ loopbackOnly: void }>({
  loopbackOnly: [async ({ context }, use, testInfo) => {
    const external = new Set<string>();
    const allowed = new Set([apiUrl().origin, 'http://127.0.0.1:4181']);
    function permitted(raw: string) {
      const url = new URL(raw);
      if (['blob:', 'data:', 'about:'].includes(url.protocol)) return true;
      try {
        localUrl(raw, 'Navegador', ['http:', 'https:', 'ws:', 'wss:']);
        if (allowed.has(url.origin.replace(/^ws/, 'http'))) return true;
      } catch {
        // Report only the origin, without URL credentials or parameters.
      }
      external.add(url.origin);
      return false;
    }
    await context.route('**/*', (route) => permitted(route.request().url()) ? route.continue() : route.abort());
    await context.routeWebSocket('**/*', (route) => {
      if (permitted(route.url())) route.connectToServer();
      else void route.close();
    });
    await use();
    if (external.size) {
      testInfo.attach('orígenes bloqueados', { body: Array.from(external).join('\n'), contentType: 'text/plain' });
      throw new Error(`ERP E2E abortado: orígenes no autorizados (${[...external].join(', ')}).`);
    }
  }, { auto: true }],
});

export { expect };
export const nav = (page: Page) => page.getByRole('complementary', { name: 'Navegación del ERP' }).getByRole('navigation');
export const main = (page: Page) => page.getByRole('main');
export const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });
export function tag() {
  const run = process.env.ERP_E2E_RUN;
  if (!run) throw new Error('Falta iniciar el setup E2E.');
  return run;
}

export async function submitLogin(page: Page, email: string, password: string) {
  await page.getByLabel('Correo Electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await button(page, 'Ingresar al Sistema').click();
}

export async function login(page: Page, kind: 'OWNER' | 'NOROLE' = 'OWNER') {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const { email, password } = account(kind);
  await submitLogin(page, email, password);
}

export async function owner(page: Page) {
  await login(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Centro Operativo' })).toBeVisible();
  await expect(nav(page).getByRole('button', { name: 'Configuración y accesos' })).toBeVisible();
}

export async function workspace(page: Page, name: string) {
  const entry = nav(page).getByRole('button', { name, exact: true });
  await entry.click();
  await expect(entry).toHaveAttribute('aria-current', 'page');
  await expect(main(page)).not.toContainText('Cargando módulo…');
}

export async function setProfile(page: Page, mode: 'salida' | 'completo') {
  await workspace(page, 'Configuración y accesos');
  await page.getByRole('tab', { name: 'Configuracion', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Módulos visibles' });
  await settings.getByLabel('Perfil').selectOption(mode);
  await settings.getByRole('button', { name: 'Guardar módulos' }).click();
  await expect(settings.getByRole('status')).toHaveText('Visibilidad de módulos guardada.');
}
