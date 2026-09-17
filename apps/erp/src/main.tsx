import React from "react";
import ReactDOM from "react-dom/client";
import type { ErrorInfo, ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import "@fontsource-variable/source-sans-3";
import App from "./App";
import { ErpAuthProvider } from "./auth/ErpAuthProvider";
import { queryClient } from "./lib/queryClient";
import "./styles.css";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

class AppErrorBoundary extends React.Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("El ERP encontró un error no recuperable.", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="app-error-boundary" role="alert">
          <div className="module-state-card">
            <h1>No pudimos mostrar el ERP</h1>
            <p>
              Ocurrió un error inesperado. Recargá la aplicación para recuperar la sesión y
              volver a intentarlo.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => window.location.reload()}
            >
              Recargar aplicación
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ErpAuthProvider>
          <App />
        </ErpAuthProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  </React.StrictMode>,
);
