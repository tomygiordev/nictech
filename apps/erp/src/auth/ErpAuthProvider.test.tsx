import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErpAuthProvider } from "./ErpAuthProvider";
import { useErpAuth } from "./ErpAuthContext";
import { ErpAccessGate } from "./ErpAccessGate";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  unsubscribe: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabaseConfigError: null,
  supabase: { rpc: mocks.rpc, auth: mocks },
}));

let onAuthChange: (event: AuthChangeEvent, session: Session | null) => void;
const userId = "88000000-0000-0000-0000-000000000001";
const otherUserId = "88000000-0000-0000-0000-000000000002";
const organizationId = "10000000-0000-0000-0000-000000000001";

const sessionFor = (id = userId): Session => ({
  access_token: `token-${id}`,
  refresh_token: "refresh",
  token_type: "bearer",
  expires_in: 3600,
  user: { id, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-01-01" },
});

const contextFor = (id = userId) => ({
  organization_id: organizationId,
  user_id: id,
  branch_ids: [],
  permissions: ["sales.create"],
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
};

const Probe = () => {
  const auth = useErpAuth();
  return <output data-testid="auth-state">{JSON.stringify({
    user: auth.session?.user.id ?? null,
    organization: auth.organizationId,
    loading: auth.loading,
    error: auth.error,
    allowed: auth.hasPermission("sales.create"),
  })}</output>;
};

const state = () => JSON.parse(screen.getByTestId("auth-state").textContent ?? "{}");
const renderAuth = (withGate = false) => render(
  <ErpAuthProvider>
    <Probe />
    {withGate && <ErpAccessGate><p>Acceso habilitado</p></ErpAccessGate>}
  </ErpAuthProvider>,
);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mocks.onAuthStateChange.mockImplementation((callback: typeof onAuthChange) => {
    onAuthChange = callback;
    return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
  });
  mocks.rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data: contextFor(), error: null }) }));
  mocks.signOut.mockImplementation(async () => {
    onAuthChange("SIGNED_OUT", null);
    return { error: null };
  });
});

afterEach(cleanup);

describe("ERP auth session and permission lifecycle", () => {
  it("defers authenticated RPCs until after the auth callback returns", async () => {
    renderAuth();
    await waitFor(() => expect(state().loading).toBe(false));
    act(() => {
      onAuthChange("SIGNED_IN", sessionFor());
      expect(mocks.rpc).not.toHaveBeenCalled();
    });
    await waitFor(() => expect(state()).toMatchObject({ user: userId, organization: organizationId, loading: false, allowed: true }));
  });

  it("cancels the pending context on sign out and ignores its late response", async () => {
    const pending = deferred<{ data: ReturnType<typeof contextFor>; error: null }>();
    let signal: AbortSignal | undefined;
    mocks.rpc.mockImplementation(() => ({ abortSignal: (nextSignal: AbortSignal) => {
      signal = nextSignal;
      return pending.promise;
    } }));
    renderAuth();
    act(() => onAuthChange("SIGNED_IN", sessionFor()));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    act(() => onAuthChange("SIGNED_OUT", null));
    expect(signal?.aborted).toBe(true);
    await act(async () => pending.resolve({ data: contextFor(), error: null }));
    expect(state()).toMatchObject({ user: null, organization: null, allowed: false, loading: false, error: null });
  });

  it("does not overwrite a new account with the previous account's context", async () => {
    const oldRequest = deferred<{ data: ReturnType<typeof contextFor>; error: null }>();
    mocks.rpc.mockImplementationOnce(() => ({ abortSignal: () => oldRequest.promise }));
    renderAuth();
    act(() => onAuthChange("SIGNED_IN", sessionFor()));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    mocks.rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data: contextFor(otherUserId), error: null }) }));
    act(() => onAuthChange("SIGNED_IN", sessionFor(otherUserId)));
    expect(state()).toMatchObject({ user: otherUserId, allowed: false, organization: null });
    await waitFor(() => expect(state().allowed).toBe(true));
    await act(async () => oldRequest.resolve({ data: contextFor(), error: null }));
    expect(state()).toMatchObject({ user: otherUserId, allowed: true, error: null });
  });

  it("ignores an initial getSession snapshot that resolves after an auth event", async () => {
    const snapshot = deferred<{ data: { session: Session | null }; error: null }>();
    mocks.getSession.mockReturnValue(snapshot.promise);
    renderAuth();
    act(() => onAuthChange("SIGNED_IN", sessionFor()));
    await waitFor(() => expect(state().allowed).toBe(true));
    await act(async () => snapshot.resolve({ data: { session: null }, error: null }));
    expect(state()).toMatchObject({ user: userId, allowed: true });
  });

  it("handles transport errors and allows retrying a provisioned Dashboard account", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: sessionFor() }, error: null });
    mocks.rpc.mockImplementationOnce(() => ({ abortSignal: () => Promise.reject(new Error("Sin conexión")) }));
    renderAuth(true);
    await screen.findByText("Sin conexión");
    expect(state()).toMatchObject({ allowed: false, loading: false });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByText("Acceso habilitado");
    expect(state()).toMatchObject({ allowed: true, error: null });
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it("allows a valid Auth account without ERP context to close its local session", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: sessionFor() }, error: null });
    mocks.rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve({ data: null, error: { message: "Cuenta sin organización" } }) }));
    renderAuth(true);
    await screen.findByText("Cuenta sin organización");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await screen.findByRole("button", { name: "Ingresar al Sistema" });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(state()).toMatchObject({ user: null, allowed: false, error: null });
  });

  it("rejects a valid context for a different user", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: sessionFor(otherUserId) }, error: null });
    renderAuth();
    await waitFor(() => expect(state()).toMatchObject({ loading: false, allowed: false, organization: null, error: "El contexto ERP no corresponde a la sesión actual." }));
  });

  it("shows a rejected session lookup and recovers on retry", async () => {
    mocks.getSession.mockRejectedValueOnce(new Error("No se pudo recuperar la sesión"));
    renderAuth(true);
    await screen.findByText("No se pudo recuperar la sesión");
    expect(state()).toMatchObject({ loading: false, user: null, allowed: false });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByRole("button", { name: "Ingresar al Sistema" });
    expect(state().error).toBeNull();
  });

  it("unsubscribes and cancels scheduled work when unmounted", () => {
    const view = renderAuth();
    act(() => onAuthChange("SIGNED_IN", sessionFor()));
    view.unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
