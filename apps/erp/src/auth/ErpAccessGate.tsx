import { useState, type ReactNode, type FormEvent } from "react";
import { useErpAuth } from "./ErpAuthContext";
import { StatePanel } from "../components/erp/WorkspaceUi";
import { supabase } from "../lib/supabase";
import { Lock, Mail, KeyRound, Loader2, AlertCircle } from "lucide-react";

type ErpAccessGateProps = {
  permission?: string;
  children: ReactNode;
};

export const ErpAccessGate = ({ permission, children }: ErpAccessGateProps) => {
  const { session, loading, error, hasPermission } = useErpAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    try {
      setLoginLoading(true);
      setLoginError(null);
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (authErr) {
        setLoginError(authErr.message);
      }
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : "Error inesperado al iniciar sesión.");
    } finally {
      setLoginLoading(false);
    }
  };

  if (loading) {
    return <StatePanel type="loading" message="Cargando sesión del ERP…" />;
  }

  if (error) {
    return <StatePanel type="error" title="Error de autenticación / configuración" message={error} />;
  }

  if (!session) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "60vh",
          padding: "24px",
        }}
      >
        <div
          className="flow-card"
          style={{
            maxWidth: "420px",
            width: "100%",
            padding: "32px",
            borderRadius: "16px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
          }}
        >
          <div style={{ textAlign: "center", marginBottom: "24px" }}>
            <div
              className="flow-kpi-card__icon-box navy"
              style={{ width: "48px", height: "48px", margin: "0 auto 12px auto" }}
            >
              <Lock size={24} />
            </div>
            <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 6px 0", color: "var(--text-main)" }}>
              Ingreso NicTech ERP
            </h2>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: 0 }}>
              Iniciá sesión con tus credenciales autorizadas de operador.
            </p>
          </div>

          {loginError && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 14px",
                borderRadius: "8px",
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                color: "#ef4444",
                fontSize: "13px",
                marginBottom: "18px",
              }}
            >
              <AlertCircle size={16} />
              <span>{loginError}</span>
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label
                htmlFor="erp-login-email"
                style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}
              >
                Correo Electrónico
              </label>
              <div style={{ position: "relative" }}>
                <Mail
                  size={16}
                  style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}
                />
                <input
                  id="erp-login-email"
                  type="email"
                  required
                  placeholder="operador@nictech.com.ar"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px 10px 38px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-line)",
                    backgroundColor: "var(--canvas-bg)",
                    fontSize: "14px",
                  }}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="erp-login-password"
                style={{ display: "block", fontSize: "12px", fontWeight: 600, marginBottom: "6px" }}
              >
                Contraseña
              </label>
              <div style={{ position: "relative" }}>
                <KeyRound
                  size={16}
                  style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)" }}
                />
                <input
                  id="erp-login-password"
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px 10px 38px",
                    borderRadius: "8px",
                    border: "1px solid var(--border-line)",
                    backgroundColor: "var(--canvas-bg)",
                    fontSize: "14px",
                  }}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              className="action-btn primary"
              style={{
                width: "100%",
                padding: "12px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "8px",
                fontWeight: 600,
                marginTop: "8px",
              }}
            >
              {loginLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Iniciando sesión…</span>
                </>
              ) : (
                <span>Ingresar al Sistema</span>
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (permission && !hasPermission(permission)) {
    return (
      <StatePanel
        type="error"
        title="Permiso Requerido"
        message={`No tenés el permiso (${permission}) requerido para operar este módulo.`}
      />
    );
  }

  return <>{children}</>;
};

