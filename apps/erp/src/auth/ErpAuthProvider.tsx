import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigError } from "../lib/supabase";
import { ErpAuthContext } from "./ErpAuthContext";
import { parseErpContext } from "./ErpContextValidation";

export const ErpAuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const client = supabase;

    if (!client) {
      setError(supabaseConfigError ?? "Configuración de Supabase incompleta.");
      setLoading(false);
      return () => { mounted = false; };
    }

    const loadErpContext = async (nextSession: Session | null) => {
      if (!mounted) return;
      setSession(nextSession);
      setOrganizationId(null);
      setError(null);
      if (!nextSession) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data, error: contextError } = await client.rpc("get_current_erp_context");
      if (!mounted) return;
      if (contextError) {
        setError(contextError.message);
        setLoading(false);
        return;
      }

      try {
        const context = parseErpContext(data);
        setOrganizationId(context.organization_id);
        setLoading(false);
      } catch (contextParseError) {
        setError(contextParseError instanceof Error ? contextParseError.message : "Contexto ERP inválido");
        setLoading(false);
      }
    };

    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) {
        if (mounted) setError(sessionError.message);
        return;
      }
      void loadErpContext(data.session);
    });

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      void loadErpContext(nextSession);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => ({
      session,
      organizationId,
      loading,
      error,
        hasPermission: (permission: string) => {
        const permissions = session?.user.app_metadata?.permissions;
        return Array.isArray(permissions) && permissions.includes(permission);
      },
    }),
    [error, loading, organizationId, session],
  );

  return <ErpAuthContext.Provider value={value}>{children}</ErpAuthContext.Provider>;
};
