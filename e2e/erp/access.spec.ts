import type { Page } from '@playwright/test';
import { ERP_WORKSPACES } from '@nictech/domain';
import { test, expect, button, capture, owner, nav, main, screenName, submitLogin, workspace } from './fixtures';
import { account, literal, localClient, sqlRows } from './local';

async function profile(page: Page, mode: 'salida' | 'completo') {
  const settings = page.getByRole('region', { name: 'Módulos visibles' });
  await settings.getByLabel('Perfil').selectOption(mode);
  await settings.getByRole('button', { name: 'Guardar módulos' }).click();
  await expect(settings.getByRole('status')).toHaveText('Visibilidad de módulos guardada.');
}

async function settings(page: Page) {
  await workspace(page, 'Configuración y accesos');
  await page.getByRole('tab', { name: 'Configuración', exact: true }).click();
}

test('credenciales inválidas, usuario sin rol, owner y cierre de sesión', async ({ page, expectHttpError }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await capture(page, 'acceso-login');
  expectHttpError({ method: 'POST', path: '/auth/v1/token', status: 400, reason: 'Contraseña incorrecta ingresada deliberadamente.' });
  await submitLogin(page, account('OWNER').email, 'contraseña-incorrecta');
  await expect(page.getByText('Correo o contraseña incorrectos.')).toBeVisible({ timeout: 20_000 });

  await submitLogin(page, account('NOROLE').email, account('NOROLE').password);
  await expect(page.getByText(/Permiso Requerido|No se pudo habilitar el acceso al ERP/)).toBeVisible({ timeout: 20_000 });
  await expect(nav(page).getByRole('button')).toHaveCount(0);

  await button(page, /^Cerrar sesión$/i).click();
  const confirmation = page.getByRole('dialog', { name: 'Cerrar Sesión del ERP' });
  if (await confirmation.isVisible()) await confirmation.getByRole('button', { name: 'Cerrar Sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Ingreso NicTech ERP' })).toBeVisible();
  await submitLogin(page, account('OWNER').email, account('OWNER').password);
  await expect(page.getByRole('heading', { name: 'Centro Operativo', exact: true, level: 1 })).toBeVisible({ timeout: 20_000 });
  await expect(nav(page).getByRole('button', { name: 'Configuración y accesos' })).toBeVisible();
  await button(page, 'Cerrar Sesión').click();
  await page.getByRole('dialog', { name: 'Cerrar Sesión del ERP' }).getByRole('button', { name: 'Cerrar Sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Ingreso NicTech ERP' })).toBeVisible();
  await expect(nav(page).getByRole('button')).toHaveCount(0);
});

test('configuración: tarjeta web y perfiles Salida/Completo persistidos', async ({ page }) => {
  await owner(page);
  await settings(page);
  await expect(page.getByRole('heading', { name: 'Actualizaciones' })).toBeVisible();
  await expect(page.getByText('Disponible solo en la app de escritorio')).toBeVisible();
  await expect(button(page, 'Buscar actualizaciones')).toBeDisabled();

  await profile(page, 'completo');
  await expect(nav(page).getByRole('button', { name: 'Armados de PC' })).toBeVisible();
  await profile(page, 'salida');
  await expect(nav(page).getByRole('button', { name: 'Armados de PC' })).toHaveCount(0);
  expect(sqlRows<{ profile: string }>(`select value->>'profile' as profile
    from erp.system_settings where key='navigation.module_profile' and branch_id is null`))
    .toEqual([{ profile: 'salida' }]);
  await page.reload();
  await expect(nav(page).getByRole('button', { name: 'Configuración y accesos' })).toBeVisible();
  await settings(page);
  await expect(page.getByLabel('Perfil', { exact: true })).toHaveValue('salida');
});

test('navegación completa: módulos, submódulos y búsqueda por F2', async ({ page }) => {
  test.setTimeout(210_000);

  await owner(page);
  await settings(page);
  await profile(page, 'completo');
  await expect(nav(page).getByRole('button')).toHaveCount(ERP_WORKSPACES.length);

  async function opened() {
    await expect(main(page)).not.toBeEmpty();
    await expect(main(page)).not.toContainText('Cargando módulo…');
    await expect(main(page).getByRole('alert').filter({ hasText: /no se pud|error|permiso requerido/i })).toHaveCount(0);
  }
  async function captureWorkspace(name: string) {
    await opened();
    await expect(main(page).getByText(/^Cargando\b/i)).toHaveCount(0);
    await capture(page, name, { workspaceTop: true });
  }
  async function internalTabs(prefix: string) {
    const localTabs = main(page).getByRole('tablist', { name: /^((?!Submódulos del área).)*$/ });
    for (const list of await localTabs.all()) {
      const tabs = list.getByRole('tab');
      for (const name of await tabs.allTextContents()) {
        const tab = list.getByRole('tab', { name: name.trim(), exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await captureWorkspace(`${prefix}-${screenName(name)}`);
      }
    }
  }
  for (const { label } of ERP_WORKSPACES) {
    await test.step(label, async () => {
      await workspace(page, label);
      const prefix = screenName(label);
      await captureWorkspace(`${prefix}-inicio`);
      const modules = main(page).getByRole('tablist', { name: 'Submódulos del área' });
      const tabNames = await modules.getByRole('tab').allTextContents();
      if (!tabNames.length) await internalTabs(prefix);
      for (const name of tabNames) {
        const tab = modules.getByRole('tab', { name: name.trim(), exact: true });
        await tab.click();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        const submodule = `${prefix}-${screenName(name)}`;
        await captureWorkspace(submodule);
        await internalTabs(submodule);
      }
    });
  }

  await page.keyboard.press('F2');
  const search = page.getByRole('textbox', { name: /Buscar módulos y funciones/ });
  await expect(search).toBeFocused();
  await search.fill('conciliacion');
  await expect(nav(page).getByRole('button', { name: 'Contabilidad y análisis' })).toBeVisible();
  await expect(nav(page).getByRole('button', { name: 'Punto de venta' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  await expect(nav(page).getByRole('button')).toHaveCount(ERP_WORKSPACES.length);
});

test('el owner asigna técnico; el ERP y el servidor limitan permisos', async ({ page }) => {
  await owner(page);
  await workspace(page, 'Configuración y accesos');
  await page.getByRole('tab', { name: 'Usuarios y permisos' }).click();
  const roles = page.getByRole('region', { name: 'Roles de operadores' });
  await expect(roles.getByRole('listitem').filter({ hasText: 'QA ERP Sin Rol' })).toContainText('Sin rol');
  await roles.getByLabel('Operador').selectOption({ label: 'QA ERP Sin Rol' });
  const role = roles.getByLabel('Rol', { exact: true });
  await role.selectOption({ label: 'Tecnico' });
  await roles.getByRole('button', { name: 'Asignar rol' }).click();
  await expect(roles.getByRole('listitem').filter({ hasText: 'QA ERP Sin Rol' })).not.toContainText('Sin rol —');
  const { id, email, password } = account('NOROLE');
  const limited = sqlRows<{ code: string; id: string }>(`select r.code, r.id from erp.profile_roles pr
    join erp.roles r on r.id = pr.role_id where pr.profile_id = ${literal(id)}
    and pr.valid_from <= now() and pr.valid_until is null`);
  expect(limited).toMatchObject([{ code: 'technician' }]);

  await button(page, 'Cerrar Sesión').click();
  await page.getByRole('dialog', { name: 'Cerrar Sesión del ERP' }).getByRole('button', { name: 'Cerrar Sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Ingreso NicTech ERP' })).toBeVisible();
  await submitLogin(page, email, password);
  await expect(nav(page).getByRole('button', { name: 'Servicio técnico' })).toBeVisible();
  await expect(nav(page).getByRole('button', { name: 'Punto de venta' })).toHaveCount(0);
  await expect(nav(page).getByRole('button', { name: /Usuarios y permisos/ })).toHaveCount(0);
  await workspace(page, 'Servicio técnico');
  await expect(page.getByRole('heading', { name: 'Reparaciones', level: 1 })).toBeVisible();
  await expect(button(page, 'Nueva Venta POS')).toHaveCount(0);
  await expect(nav(page).getByRole('button', { name: 'Contabilidad y análisis' })).toHaveCount(0);

  const restricted = localClient();
  const { error: loginError } = await restricted.auth.signInWithPassword({ email, password });
  expect(loginError).toBeNull();
  const { error } = await restricted.schema('erp').rpc('assign_profile_role', {
    p_profile_id: account('OWNER').id,
    p_role_id: limited[0].id,
  });
  expect(error?.code).toBe('42501');
});
