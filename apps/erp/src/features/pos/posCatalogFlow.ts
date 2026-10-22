import { PosCoordinator, normalizePosError } from "./posCoordinator";

export interface PosCatalogOwner {
  kind: "fetch" | "requote";
  token: number;
}

/** A queued fetch already owns its token; it must not try to acquire it again. */
export async function runPosCatalogFetch<T, TResult>(
  coordinator: PosCoordinator,
  params: {
    owner?: PosCatalogOwner;
    load: () => Promise<T>;
    apply: (value: T) => TResult;
    onLoading: (loading: boolean) => void;
    onError: (message: string) => void;
  },
): Promise<TResult | null> {
  const token = params.owner?.token ?? coordinator.beginFetch();
  if (token === null) return null;
  const owner: PosCatalogOwner = params.owner ?? { kind: "fetch", token };
  const owns = () => {
    const operation = coordinator.getActiveOperation();
    return operation.kind === owner.kind && operation.token === owner.token;
  };
  const valid = () => owner.kind === "requote"
    ? coordinator.isRequoteValid(token)
    : coordinator.isFetchValid(token);
  if (!owns() || !valid()) {
    if (owns() && owner.kind === "fetch") coordinator.endFetch(token);
    return null;
  }
  params.onLoading(true);
  try {
    const value = await params.load();
    return valid() ? params.apply(value) : null;
  } catch (error: unknown) {
    if (valid()) params.onError(normalizePosError(error).message);
    return null;
  } finally {
    if (owner.kind === "fetch" && owns()) {
      params.onLoading(false);
      coordinator.endFetch(token);
    }
  }
}
