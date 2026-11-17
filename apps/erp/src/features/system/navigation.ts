import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { ERP_MODULES, getVisibleErpModules, type ErpModuleId } from "@nictech/domain";
import { navigationSchema, type NavigationForm } from "./navigationSchema";
export { navigationSchema, type NavigationForm } from "./navigationSchema";
import { useErpAuth } from "../../auth/ErpAuthContext";
import { listSystemSettings } from "./api";

export const NAVIGATION_SETTING_KEY = "navigation.module_profile";
const moduleIds = ERP_MODULES.map((module) => module.id);
export const navigationQueryKey = (organizationId: string | null) => ["navigation-profile", organizationId] as const;

export const useNavigationSetting = () => {
  const { organizationId } = useErpAuth();
  return useQuery({
    queryKey: navigationQueryKey(organizationId),
    queryFn: async () => {
      const settings = await listSystemSettings();
      const setting = settings.find((entry) => entry.key === NAVIGATION_SETTING_KEY && entry.branch_id === null);
      if (!setting) return { profile: "salida" as const };
      const result = navigationSchema.safeParse(setting.value);
      if (!result.success) throw new Error("El perfil de módulos guardado no es válido.");
      return result.data;
    },
    enabled: Boolean(organizationId),
    retry: false,
  });
};

export const NavigationVisibilityContext = createContext<readonly ErpModuleId[]>(moduleIds);
export const useNavigationVisibility = () => useContext(NavigationVisibilityContext);
export const visibleFromSetting = (setting: NavigationForm): readonly ErpModuleId[] =>
  getVisibleErpModules({ profile: setting.profile, visible: setting.visible ? [...setting.visible, "settings"] as ErpModuleId[] : undefined });
