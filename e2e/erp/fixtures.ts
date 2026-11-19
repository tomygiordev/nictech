import { test as base, expect, type Page, type Response } from '@playwright/test';
import { account, apiUrl } from './local';
import { localUrl } from './local-url.mjs';

type ExpectedHttp = { method: string; path: string; status: number; reason: string };

export const test = base.extend<{
  loopbackOnly: void;
  browserDiagnostics: void;
  expectedHttpErrors: ExpectedHttp[];
  expectHttpError: (expected: ExpectedHttp) => void;
}>({
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
      await testInfo.attach('orígenes bloqueados', { body: Array.from(external).join('\n'), contentType: 'text/plain' });
      throw new Error(`ERP E2E abortado: orígenes no autorizados (${[...external].join(', ')}).`);
    }
  }, { auto: true }],
  expectedHttpErrors: async ({}, use) => { await use([]); },
  expectHttpError: async ({ expectedHttpErrors }, use) => {
    await use((expected) => expectedHttpErrors.push(expected));
  },
  browserDiagnostics: [async ({ context, loopbackOnly, expectedHttpErrors: expected }, use, info) => {
    void loopbackOnly;
    const responses: Response[] = [];
    const faults: string[] = [];
    const consoleErrors: { message: string; url: string }[] = [];
    context.on('weberror', (event) => faults.push(`Excepción: ${event.error().message}`));
    context.on('console', (event) => {
      if (event.type() === 'error') consoleErrors.push({ message: event.text(), url: event.location().url });
    });
    context.on('response', (response) => {
      if (response.status() >= 400) responses.push(response);
    });
    await use();
    const tolerated: string[] = [];
    const expectedResources = new Map<string, number>();
    for (const response of responses) {
      const method = response.request().method();
      const { origin, pathname } = new URL(response.url());
      const status = response.status();
      const index = expected.findIndex((item) => origin === apiUrl().origin && item.method === method && item.path === pathname && item.status === status);
      const entry = `HTTP ${status} ${method} ${origin}${pathname}`;
      if (index < 0) {
        faults.push(entry);
      } else {
        const [exception] = expected.splice(index, 1);
        tolerated.push(`${entry}: ${exception.reason}`);
        const key = `${status} ${response.url()}`;
        expectedResources.set(key, (expectedResources.get(key) ?? 0) + 1);
      }
    }
    for (const { message, url } of consoleErrors) {
      const status = /^Failed to load resource: the server responded with a status of (\d{3})\b/.exec(message)?.[1];
      const key = `${status} ${url}`;
      const count = expectedResources.get(key) ?? 0;
      if (status && count > 0) {
        expectedResources.set(key, count - 1);
        tolerated.push(`Consola: ${message}`);
      } else {
        faults.push(`Consola: ${message}`);
      }
    }
    for (const item of expected) faults.push(`No se recibió el HTTP esperado: ${item.status} ${item.method} ${item.path}`);
    await info.attach('diagnóstico del navegador', {
      body: [...faults, ...tolerated].join('\n') || 'Sin errores de consola ni respuestas HTTP >= 400.',
      contentType: 'text/plain',
    });
    expect(faults, 'Errores inesperados del navegador').toEqual([]);
  }, { auto: true }],
});

export { expect };
export const nav = (page: Page) => page.getByRole('complementary', { name: 'Navegación del ERP' }).getByRole('navigation');
export const main = (page: Page) => page.getByRole('main');
export const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' });

export function screenName(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export async function capture(page: Page, name: string, { workspaceTop = false } = {}) {
  if (name !== screenName(name)) throw new Error(`Nombre inválido para una captura: ${name}`);
  const original = page.viewportSize();
  try {
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    for (const width of [1366, 1024]) {
      await page.setViewportSize({ width, height: 768 });
      if (workspaceTop) {
        await main(page).evaluate((element) => {
          element.scrollTop = 0;
          window.scrollTo(0, 0);
        });
      }
      const suffix = width === 1366 ? '' : '-1024';
      await page.screenshot({ path: `test-results/erp-screens/${name}${suffix}.png`, animations: 'disabled', caret: 'hide' });
    }
  } finally {
    if (original) await page.setViewportSize(original);
  }
}
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
  await page.getByRole('tab', { name: 'Configuración', exact: true }).click();
  const settings = page.getByRole('region', { name: 'Módulos visibles' });
  await settings.getByLabel('Perfil').selectOption(mode);
  await settings.getByRole('button', { name: 'Guardar módulos' }).click();
  await expect(settings.getByRole('status')).toHaveText('Visibilidad de módulos guardada.');
}
