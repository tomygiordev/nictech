import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminCutoverFlagRow } from '@/hooks/use-admin-cutover-flags';

type RpcResponse = {
  data: AdminCutoverFlagRow[] | null;
  error: { code?: string; message: string } | null;
};

const { mockRpc, mockToast } = vi.hoisted(() => ({
  mockRpc: vi.fn<(fn: string) => Promise<RpcResponse>>(),
  mockToast: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: mockRpc,
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  toast: mockToast,
  useToast: () => ({ toast: mockToast }),
}));

import {
  CUTOVER_GROUP_TO_TABS,
  buildHiddenAdminTabs,
  filterAdminTabs,
  useAdminCutoverFlags,
} from '@/hooks/use-admin-cutover-flags';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const SAMPLE_TABS = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'repairs', label: 'Reparaciones' },
  { value: 'inventory', label: 'Inventario' },
  { value: 'products', label: 'Productos' },
  { value: 'cases', label: 'Fundas' },
  { value: 'variants', label: 'Variantes' },
  { value: 'promos', label: 'Promos' },
  { value: 'banners', label: 'Banners' },
  { value: 'blog', label: 'Blog' },
] as const;

describe('useAdminCutoverFlags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('oculta las pestañas del grupo marcado como admin_tab_hidden = true', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [
        { group_code: 'catalog', admin_tab_hidden: true, legacy_write_mode: 'block' },
        { group_code: 'stock', admin_tab_hidden: false, legacy_write_mode: 'off' },
        { group_code: 'repairs', admin_tab_hidden: false, legacy_write_mode: 'off' },
      ],
      error: null,
    });

    const { result } = renderHook(() => useAdminCutoverFlags(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockRpc).toHaveBeenCalledWith('get_admin_cutover_flags');
    expect(Array.from(result.current.hiddenTabs).sort()).toEqual(['cases', 'products', 'variants']);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('falla abierto sin ocultar nada ni mostrar toast cuando la RPC devuelve error', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.get_admin_cutover_flags in the schema cache',
      },
    });

    const { result } = renderHook(() => useAdminCutoverFlags(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hiddenTabs.size).toBe(0);
    expect(result.current.flags).toEqual([]);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('falla abierto sin ocultar nada ni mostrar toast ante error de red o excepción', async () => {
    mockRpc.mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useAdminCutoverFlags(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.hiddenTabs.size).toBe(0);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('mapea cada grupo de corte a sus pestañas exactas', () => {
    expect(CUTOVER_GROUP_TO_TABS).toEqual({
      catalog: ['products', 'variants', 'cases'],
      stock: ['inventory'],
      prices_promos: ['promos'],
      repairs: ['repairs'],
      dashboard: ['dashboard'],
    });

    const allHidden = buildHiddenAdminTabs([
      { group_code: 'catalog', admin_tab_hidden: true, legacy_write_mode: 'block' },
      { group_code: 'stock', admin_tab_hidden: true, legacy_write_mode: 'block' },
      { group_code: 'prices_promos', admin_tab_hidden: true, legacy_write_mode: 'block' },
      { group_code: 'repairs', admin_tab_hidden: true, legacy_write_mode: 'block' },
      { group_code: 'dashboard', admin_tab_hidden: true, legacy_write_mode: 'block' },
      { group_code: 'unknown_group', admin_tab_hidden: true, legacy_write_mode: 'block' },
    ]);

    expect(Array.from(allHidden).sort()).toEqual([
      'cases',
      'dashboard',
      'inventory',
      'products',
      'promos',
      'repairs',
      'variants',
    ]);
    expect(allHidden.has('banners')).toBe(false);
    expect(allHidden.has('blog')).toBe(false);
  });
});

describe('filterAdminTabs', () => {
  it('mantiene todas las pestañas y la activa cuando no hay ocultas', () => {
    const result = filterAdminTabs(SAMPLE_TABS, new Set(), 'products');
    expect(result.visibleTabs).toHaveLength(SAMPLE_TABS.length);
    expect(result.nextActiveTab).toBe('products');
  });

  it('filtra pestañas ocultas y redirige a la primera visible si la activa quedó oculta', () => {
    const hidden = new Set(['products', 'variants', 'cases', 'dashboard']);
    const result = filterAdminTabs(SAMPLE_TABS, hidden, 'products');

    expect(result.visibleTabs.map((t) => t.value)).toEqual([
      'repairs',
      'inventory',
      'promos',
      'banners',
      'blog',
    ]);
    expect(result.nextActiveTab).toBe('repairs');
  });

  it('conserva la pestaña activa si sigue visible aunque otras se oculten', () => {
    const hidden = new Set(['products', 'variants', 'cases']);
    const result = filterAdminTabs(SAMPLE_TABS, hidden, 'promos');

    expect(result.nextActiveTab).toBe('promos');
  });

  it('nunca oculta banners ni blog aunque figuren en hiddenTabs', () => {
    const hidden = new Set([
      'dashboard',
      'repairs',
      'inventory',
      'products',
      'cases',
      'variants',
      'promos',
      'banners',
      'blog',
    ]);
    const result = filterAdminTabs(SAMPLE_TABS, hidden, 'repairs');

    expect(result.visibleTabs.map((t) => t.value)).toEqual(['banners', 'blog']);
    expect(result.nextActiveTab).toBe('banners');
  });
});
