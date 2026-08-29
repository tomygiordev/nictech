import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigError } from "../lib/supabase";
import { ErpAuthContext } from "./ErpAuthContext";
import { parseErpContext } from "./ErpContextValidation";

const DEV_MOCK_SESSION: Session = {
  access_token: "dev-token",
  token_type: "bearer",
  expires_in: 3600,
  refresh_token: "dev-refresh",
  user: {
    id: "dev-user-0000-0000-0000-000000000000",
    app_metadata: {
      provider: "email",
      permissions: [
        "dashboard.view",
        "sales.create",
        "pos.operate",
        "cash.view",
        "orders.view",
        "catalog.view",
        "stock.view",
        "stock_counts.view",
        "labels.print",
        "purchases.view",
        "suppliers.view",
        "customers.view",
        "quotes.view",
        "repairs.view",
        "repair_tests.view",
        "pc_builds.view",
        "trade_ins.view",
        "warranties.view",
        "pricing.view",
        "accounts_receivable.view",
        "accounts_receivable.manage",
        "accounting.view",
        "accounting.post",
        "accounting.close_period",
        "profitability.view",
        "reports.view",
        "documents.view",
        "messages.view",
        "integraciones.view",
        "users.view",
        "locations.view",
        "configuration.view",
        "audit.view",
      ],
    },
    user_metadata: { full_name: "Operador Local / NicTech Dev" },
    aud: "authenticated",
    created_at: new Date().toISOString(),
  },
};

export const ErpAuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(import.meta.env.DEV ? DEV_MOCK_SESSION : null);
  const [organizationId, setOrganizationId] = useState<string | null>("dev-org-0000");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const client = supabase;

    if (!client) {
      if (!import.meta.env.DEV) {
        setError(supabaseConfigError ?? "Configuración de Supabase incompleta.");
      }
      setLoading(false);
      return () => { mounted = false; };
    }

    const loadErpContext = async (nextSession: Session | null) => {
      if (!mounted) return;
      if (nextSession) {
        setSession(nextSession);
      } else if (import.meta.env.DEV) {
        setSession(DEV_MOCK_SESSION);
      } else {
        setSession(null);
      }
      
      if (!nextSession) {
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data, error: contextError } = await client.rpc("get_current_erp_context");
      if (!mounted) return;
      if (contextError) {
        if (!import.meta.env.DEV) {
          setError(contextError.message);
        }
        setLoading(false);
        return;
      }

      try {
        const context = parseErpContext(data);
        setOrganizationId(context.organization_id);
        setLoading(false);
      } catch (contextParseError) {
        if (!import.meta.env.DEV) {
          setError(contextParseError instanceof Error ? contextParseError.message : "Contexto ERP inválido");
        }
        setLoading(false);
      }
    };

    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) {
        if (mounted && !import.meta.env.DEV) setError(sessionError.message);
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
        if (import.meta.env.DEV && (!session || session.access_token === "dev-token")) {
          return true;
        }
        const permissions = session?.user.app_metadata?.permissions;
        return Array.isArray(permissions) && permissions.includes(permission);
      },
    }),
    [error, loading, organizationId, session],
  );

  return <ErpAuthContext.Provider value={value}>{children}</ErpAuthContext.Provider>;
};
