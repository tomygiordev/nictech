import { createContext, useContext } from "react";
import type { Session } from "@supabase/supabase-js";

export type ErpAuthContextValue = {
  session: Session | null;
  organizationId: string | null;
  loading: boolean;
  error: string | null;
  hasPermission: (permission: string) => boolean;
};

export const ErpAuthContext = createContext<ErpAuthContextValue | null>(null);
export const useErpAuth = (): ErpAuthContextValue => {
  const context = useContext(ErpAuthContext);
  if (!context) throw new Error("useErpAuth must be used inside ErpAuthProvider");
  return context;
};
