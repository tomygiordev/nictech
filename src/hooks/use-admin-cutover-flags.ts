import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { storefrontSupabase } from '@/integrations/supabase/types.extensions';

export type AdminCutoverGroupCode =
  | 'catalog'
  | 'stock'
  | 'prices_promos'
  | 'repairs'
  | 'dashboard';

export interface AdminCutoverFlagRow {
  group_code: string;
  admin_tab_hidden: boolean;
  legacy_write_mode: string;
}

export const CUTOVER_GROUP_TO_TABS: Record<AdminCutoverGroupCode, readonly string[]> = {
  catalog: ['products', 'variants', 'cases'],
  stock: ['inventory'],
  prices_promos: ['promos'],
  repairs: ['repairs'],
  dashboard: ['dashboard'],
};

export const NEVER_HIDDEN_ADMIN_TABS: ReadonlySet<string> = new Set(['banners', 'blog']);

const ADMIN_CUTOVER_FLAGS_STALE_TIME_MS = 60_000;
const EMPTY_FLAGS: readonly AdminCutoverFlagRow[] = [];

const cutoverFlagRowSchema = z.object({
  group_code: z.string(),
  admin_tab_hidden: z.boolean(),
  legacy_write_mode: z.string(),
});

const cutoverFlagRowsSchema = z.array(cutoverFlagRowSchema);

function isCutoverGroupCode(value: string): value is AdminCutoverGroupCode {
  return Object.prototype.hasOwnProperty.call(CUTOVER_GROUP_TO_TABS, value);
}

/**
 * Maps cutover group flags to the set of legacy admin tab values that should be hidden.
 * Tabs in NEVER_HIDDEN_ADMIN_TABS (banners, blog) are never included.
 */
export function buildHiddenAdminTabs(
  flags: readonly AdminCutoverFlagRow[] | null | undefined,
): Set<string> {
  const hidden = new Set<string>();
  if (!Array.isArray(flags)) return hidden;

  for (const flag of flags) {
    if (flag.admin_tab_hidden !== true) continue;
    if (!isCutoverGroupCode(flag.group_code)) continue;

    for (const tab of CUTOVER_GROUP_TO_TABS[flag.group_code]) {
      if (!NEVER_HIDDEN_ADMIN_TABS.has(tab)) {
        hidden.add(tab);
      }
    }
  }

  return hidden;
}

/**
 * Filters admin tabs by hiddenTabs while preserving `banners` and `blog`,
 * and falls back to the first visible tab if `activeTab` is hidden or missing.
 */
export function filterAdminTabs<T extends { value: string }>(
  tabs: readonly T[],
  hiddenTabs: ReadonlySet<string>,
  activeTab: string,
): { visibleTabs: T[]; nextActiveTab: string } {
  const visibleTabs = tabs.filter(
    (tab) => NEVER_HIDDEN_ADMIN_TABS.has(tab.value) || !hiddenTabs.has(tab.value),
  );

  const activeStillVisible = visibleTabs.some((tab) => tab.value === activeTab);
  const nextActiveTab = activeStillVisible
    ? activeTab
    : (visibleTabs[0]?.value ?? activeTab);

  return { visibleTabs, nextActiveTab };
}

async function fetchAdminCutoverFlags(): Promise<readonly AdminCutoverFlagRow[]> {
  try {
    const { data, error } = await storefrontSupabase.rpc('get_admin_cutover_flags');
    if (error) {
      return EMPTY_FLAGS;
    }

    const parsed = cutoverFlagRowsSchema.safeParse(data ?? []);
    if (!parsed.success) {
      return EMPTY_FLAGS;
    }

    return parsed.data.map((row) => ({
      group_code: row.group_code ?? '',
      admin_tab_hidden: row.admin_tab_hidden ?? false,
      legacy_write_mode: row.legacy_write_mode ?? 'off',
    }));
  } catch {
    return EMPTY_FLAGS;
  }
}

export interface UseAdminCutoverFlagsOptions {
  enabled?: boolean;
}

export interface UseAdminCutoverFlagsResult {
  hiddenTabs: Set<string>;
  flags: readonly AdminCutoverFlagRow[];
  isLoading: boolean;
  isFetching: boolean;
}

export function useAdminCutoverFlags(
  options?: UseAdminCutoverFlagsOptions,
): UseAdminCutoverFlagsResult {
  const query = useQuery({
    queryKey: ['admin-cutover-flags'],
    queryFn: fetchAdminCutoverFlags,
    enabled: options?.enabled ?? true,
    staleTime: ADMIN_CUTOVER_FLAGS_STALE_TIME_MS,
    retry: false,
  });

  const flags = query.data ?? EMPTY_FLAGS;
  const hiddenTabs = useMemo(() => buildHiddenAdminTabs(flags), [flags]);

  return {
    hiddenTabs,
    flags,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
  };
}
