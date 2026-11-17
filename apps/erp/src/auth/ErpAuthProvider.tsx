import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigError } from "../lib/supabase";
import { ErpAuthContext } from "./ErpAuthContext";
import { parseErpContext } from "./ErpContextValidation";

export const ErpAuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);

  useEffect(() => {
    let mounted = true;
    let revision = 0;
    let pendingLoad: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;

    if (supabaseConfigError) {
      setError(supabaseConfigError);
      setLoading(false);
      return () => {
        mounted = false;
      };
    }

    const client = supabase;

    const loadErpContext = async (nextSession: Session, currentRevision: number) => {
      const controller = new AbortController();
      request = controller;
      try {
        const { data, error: contextError } = await client
          .rpc("get_current_erp_context")
          .abortSignal(controller.signal);
        if (!mounted || currentRevision !== revision) return;
        if (contextError) throw new Error(contextError.message);
        const context = parseErpContext(data);
        if (context.user_id !== nextSession.user.id) throw new Error("El contexto ERP no corresponde a la sesión actual.");
        setOrganizationId(context.organization_id);
        setBranchIds(context.branch_ids);
        setPermissions(context.permissions);
        setError(null);
        setLoading(false);
      } catch (contextParseError) {
        if (!mounted || currentRevision !== revision) return;
        setOrganizationId(null);
        setBranchIds([]);
        setPermissions([]);
        setError(contextParseError instanceof Error ? contextParseError.message : "Contexto ERP inválido");
        setLoading(false);
      }
    };

    const acceptSession = (nextSession: Session | null, sessionError: string | null = null) => {
      if (!mounted) return;
      revision += 1;
      clearTimeout(pendingLoad);
      request?.abort();
      setSession(nextSession);
      setOrganizationId(null);
      setBranchIds([]);
      setPermissions([]);
      setError(sessionError);
      setLoading(Boolean(nextSession) && !sessionError);
      if (nextSession && !sessionError) {
        const currentRevision = revision;
        // Supabase auth callbacks run under its auth lock. Start RPCs only
        // after the callback has returned, including INITIAL_SESSION events.
        pendingLoad = setTimeout(() => {
          if (mounted && currentRevision === revision) void loadErpContext(nextSession, currentRevision);
        }, 0);
      }
    };

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      acceptSession(nextSession);
    });

    // A later auth event is authoritative over this initial snapshot.
    void client.auth.getSession().then(({ data: sessionData, error: sessionError }) => {
      if (!mounted || revision !== 0) return;
      acceptSession(sessionData.session, sessionError?.message ?? null);
    }).catch((sessionError: unknown) => {
      if (!mounted || revision !== 0) return;
      acceptSession(null, sessionError instanceof Error ? sessionError.message : "No se pudo recuperar la sesión.");
    });

    return () => {
      mounted = false;
      revision += 1;
      clearTimeout(pendingLoad);
      request?.abort();
      data.subscription.unsubscribe();
    };
  }, [retryAttempt]);

  const value = useMemo(
    () => ({
      session,
      organizationId,
      branchIds,
      permissions,
      loading,
      error,
      retry: () => setRetryAttempt((attempt) => attempt + 1),
      hasPermission: (permission: string) => {
        if (!session) return false;
        return permissions.includes(permission);
      },
    }),
    [branchIds, error, loading, organizationId, permissions, session],
  );

  return <ErpAuthContext.Provider value={value}>{children}</ErpAuthContext.Provider>;
};

