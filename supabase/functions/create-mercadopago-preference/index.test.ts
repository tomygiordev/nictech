import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), insert: vi.fn() }));
vi.mock('./client', () => ({ createClient: mocks.createClient }));

describe('create-mercadopago-preference', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('responde 409 antes de insertar la orden si cambia el total', async () => {
    const productId = '11111111-1111-4111-8111-111111111111';
    let handler: ((request: Request) => Promise<Response>) | undefined;
    vi.stubGlobal('Deno', {
      env: { get: (key: string) => ({
        MERCADOPAGO_ACCESS_TOKEN: 'local-test',
        SUPABASE_URL: 'http://localhost:54321',
        SUPABASE_SERVICE_ROLE_KEY: 'local-test',
        ERP_ORGANIZATION_ID: '22222222-2222-4222-8222-222222222222',
      } as Record<string, string>)[key] },
      serve: (callback: typeof handler) => { handler = callback; },
    });
    const query = (data: unknown) => {
      const result = { data, error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return builder;
    };
    mocks.createClient.mockReturnValue({
      from: (table: string) => {
        if (table === 'orders') return { insert: mocks.insert };
        if (table === 'products') return query([{ id: productId, name: 'Producto', stock: 2, image_url: null }]);
        return query([]);
      },
      schema: () => ({
        from: () => query([{ id: productId, inventory_tracking: 'quantity' }]),
        rpc: () => Promise.resolve({ data: { final_price_ars: 125 }, error: null }),
      }),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await import('./index');
    expect(handler).toBeDefined();
    const response = await handler!(new Request('http://localhost/functions/v1/create-mercadopago-preference', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checkout_id: '33333333-3333-4333-8333-333333333333',
        expected_total: 100,
        items: [{ id: productId, quantity: 1 }],
        payer: { name: 'Prueba', email: 'test@example.test', phone: '123456', dni: '12345678', address: 'Retiro' },
      }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      total: 125,
      items: [{ product_id: productId, variant_id: null, unit_price: 125 }],
    });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
