import { test as base, expect, type Route, type Request } from '@playwright/test';

export const site = 'https://www.nictech.com.ar';
export const supabaseHost = 'qatkzvlomuaoaxlfgjfa.supabase.co';
const checkoutPath = '/functions/v1/create-mercadopago-preference';
export const paymentPath = '/__e2e__/pago-simulado';
const trackingRpc = new Set(['get_repair_by_tracking_code', 'get_repair_by_tracking_code_erp']);
const readOnlyRpc = new Set(['get_product_click_counts']);
const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

type MockReply = { status: 200 | 400 | 409; json: Record<string, unknown> };
export type Network = {
  checkout?: (request: Request) => MockReply;
  catalogRead?: (url: URL) => object[] | undefined;
  checkoutCalls: Request[];
  trackingCalls: Request[];
  productReads: Request[];
};

function cors(request: Request) {
  const headers = request.headers();
  return {
    'access-control-allow-origin': headers.origin ?? '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': headers['access-control-request-headers']
      ?? 'apikey, authorization, content-type, x-client-info, x-supabase-api-version',
  };
}

function isMercadoPago(hostname: string) {
  const host = hostname.replace(/\.$/, '');
  return /(?:^|\.)mercadopago\.(?:com(?:\.[a-z]{2})?|[a-z]{2})$/.test(host)
    || /(?:^|\.)mpago\.la$/.test(host);
}

export const test = base.extend<{ network: Network }>({
  network: async ({}, use) => {
    await use({ checkoutCalls: [], trackingCalls: [], productReads: [] });
  },
  page: async ({ context, baseURL, network }, use, testInfo) => {
    const baseOrigin = new URL(baseURL!).origin;
    const knownConsole = new Set<string>();
    const abort = (route: Route) => route.abort('blockedbyclient');
    const guard = async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname.replace(/\/+$/, '');
      const method = request.method();
      const fromSupabase = url.hostname === supabaseHost && url.protocol === 'https:';

      if (isMercadoPago(url.hostname)) return abort(route);
      if (path === checkoutPath || path.startsWith(`${checkoutPath}/`)) {
        if (!fromSupabase || !network.checkout || path !== checkoutPath) return abort(route);
        const headers = cors(request);
        if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (method !== 'POST') return abort(route);
        network.checkoutCalls.push(request);
        const reply = network.checkout(request);
        if (reply.status !== 200) knownConsole.add(`${url.href} ${reply.status}`);
        return route.fulfill({ ...reply, headers });
      }
      if (url.origin === baseOrigin && path === paymentPath) {
        if (!network.checkout || method !== 'GET') return abort(route);
        return route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: '<!doctype html><html lang="es"><title>Pago simulado</title><h1>Pago simulado</h1></html>',
        });
      }
      if (path.startsWith('/functions/v1/') || path.startsWith('/auth/v1/')) return abort(route);
      if (path.startsWith('/rest/v1/orders') && method !== 'GET') return abort(route);
      if (path.startsWith('/rest/v1/rpc/')) {
        const name = path.slice('/rest/v1/rpc/'.length);
        if (!fromSupabase) return abort(route);
        if (trackingRpc.has(name)) {
          // Cutover can route the legacy RPC to ERP, which writes rate-limit counters.
          const headers = cors(request);
          if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
          if (method !== 'POST' && method !== 'GET') return abort(route);
          network.trackingCalls.push(request);
          return route.fulfill({ json: [], headers });
        }
        if (readOnlyRpc.has(name) && (safeMethods.has(method) || method === 'POST')) return route.continue();
        return abort(route);
      }
      if (!safeMethods.has(method)) {
        if (fromSupabase && path === '/rest/v1/product_clicks' && method === 'POST') {
          knownConsole.add(`${url.href} blocked`);
        }
        return abort(route);
      }
      if (fromSupabase && path === '/rest/v1/products' && method === 'GET') {
        network.productReads.push(request);
      }
      if (fromSupabase && method === 'GET'
        && ['/rest/v1/products', '/rest/v1/product_variants', '/rest/v1/storefront_promotion_prices'].includes(path)) {
        const rows = network.catalogRead?.(url);
        if (rows) return route.fulfill({ json: rows, headers: cors(request) });
      }
      return route.continue();
    };

    await context.route('**/*', guard);
    await context.routeWebSocket('**/*', (socket) => socket.close());
    const page = await context.newPage();
    await page.route('**/*', guard);

    const errors: string[] = [];
    const watch = (current: typeof page) => {
      current.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      current.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const source = msg.location().url;
        const message = msg.text();
        const status = /^Failed to load resource: the server responded with a status of (400|409)\b/.exec(message)?.[1];
        if (status && knownConsole.has(`${source} ${status}`)) return;
        if (/^Failed to load resource: net::ERR_(BLOCKED_BY_CLIENT|FAILED)$/.test(message)
          && knownConsole.has(`${source} blocked`)) return;
        if (message.startsWith('404 Error: User attempted to access non-existent route:')
          && new URL(current.url()).pathname === '/__e2e__/pagina-inexistente') return;
        errors.push(`${source || current.url()}: ${message}`);
      });
    };
    watch(page);
    context.on('page', watch);
    await use(page);
    if (errors.length) {
      await testInfo.attach('errores-de-consola', {
        body: JSON.stringify(errors, null, 2), contentType: 'application/json',
      });
    }
    expect(errors, 'Errores de consola no esperados').toEqual([]);
  },
});

export { expect };
