export type CompetitorResearchProviderSnapshot = { status?: unknown };

export type CompetitorResearchPollSnapshot<Item extends object, Provider extends object> = {
  items: Item[];
  providers: Provider[];
  state: "ready" | "pending" | "unavailable";
  retryAvailable: boolean;
};

export type CompetitorResearchSnapshotSeed<Item extends object, Provider extends object> = Pick<
  CompetitorResearchPollSnapshot<Item, Provider>,
  "items" | "providers"
>;

export type CompetitorResearchPollOptions<Item extends object, Provider extends CompetitorResearchProviderSnapshot> = {
  fetcher: (input: string, init?: RequestInit) => Promise<Response>;
  input: string;
  signal: AbortSignal;
  onSnapshot?: (snapshot: CompetitorResearchPollSnapshot<Item, Provider>) => void;
  initialSnapshot?: CompetitorResearchSnapshotSeed<Item, Provider>;
  maxAttempts?: number;
  delayMs?: number;
};

type CompetitorResearchPollingCoordinatorOptions<
  Item extends object,
  Provider extends CompetitorResearchProviderSnapshot,
> = {
  fetcher: CompetitorResearchPollOptions<Item, Provider>["fetcher"];
  onSnapshot: (snapshot: CompetitorResearchPollSnapshot<Item, Provider>) => void;
  maxAttempts?: number;
  delayMs?: number;
};

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("가격 비교 조회가 취소되었습니다.", "AbortError");
}

function abortableDelay(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function pollCompetitorResearch<Item extends object, Provider extends CompetitorResearchProviderSnapshot>({
  fetcher,
  input,
  signal,
  onSnapshot,
  initialSnapshot,
  maxAttempts = 3,
  delayMs = 1_500,
}: CompetitorResearchPollOptions<Item, Provider>): Promise<CompetitorResearchPollSnapshot<Item, Provider>> {
  const attempts = Math.max(1, Math.min(Number.isFinite(maxAttempts) ? Math.trunc(maxAttempts) : 3, 3));
  let latest: CompetitorResearchPollSnapshot<Item, Provider> = {
    items: initialSnapshot?.items ?? [],
    providers: initialSnapshot?.providers ?? [],
    state: "unavailable",
    retryAvailable: false,
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal.aborted) throw abortError(signal);
    let response: Response;
    try {
      response = await fetcher(input, { signal });
    } catch {
      if (signal.aborted) throw abortError(signal);
      latest = { ...latest, state: "unavailable", retryAvailable: true };
      onSnapshot?.(latest);
      return latest;
    }
    if (signal.aborted) throw abortError(signal);
    const payload = await response.json().catch(() => null) as { items?: unknown; providers?: unknown } | null;
    if (signal.aborted) throw abortError(signal);
    const validPayload = Boolean(
      payload
      && Array.isArray(payload.items)
      && payload.items.every((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      && Array.isArray(payload.providers)
      && payload.providers.every((provider) => Boolean(provider) && typeof provider === "object" && !Array.isArray(provider)),
    );
    if (!validPayload || !response.ok) {
      latest = { ...latest, state: "unavailable", retryAvailable: true };
      onSnapshot?.(latest);
      return latest;
    }
    const items = payload!.items as Item[];
    const providers = payload!.providers as Provider[];
    const pending = response.status === 202 || providers.some((provider) => provider?.status === "pending");
    latest = {
      items,
      providers,
      state: pending ? "pending" : "ready",
      retryAvailable: pending && attempt === attempts - 1,
    };
    onSnapshot?.(latest);
    if (!pending || attempt === attempts - 1) return latest;
    await abortableDelay(delayMs * (attempt + 1), signal);
  }

  return latest;
}

export function createCompetitorResearchPollingCoordinator<
  Item extends object,
  Provider extends CompetitorResearchProviderSnapshot,
>({
  fetcher,
  onSnapshot,
  maxAttempts = 3,
  delayMs = 1_500,
}: CompetitorResearchPollingCoordinatorOptions<Item, Provider>) {
  let mounted = true;
  let activeController: AbortController | null = null;
  let retryInput = "";
  let latestSnapshot: CompetitorResearchPollSnapshot<Item, Provider> = {
    items: [],
    providers: [],
    state: "unavailable",
    retryAvailable: false,
  };

  const isCurrent = (controller: AbortController) => mounted
    && activeController === controller
    && !controller.signal.aborted;

  const run = async (
    input: string,
    initialSnapshot: CompetitorResearchSnapshotSeed<Item, Provider> = { items: [], providers: [] },
  ): Promise<CompetitorResearchPollSnapshot<Item, Provider> | null> => {
    if (!mounted) return null;
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;
    retryInput = "";
    latestSnapshot = {
      items: initialSnapshot.items,
      providers: initialSnapshot.providers,
      state: "unavailable",
      retryAvailable: false,
    };

    try {
      const result = await pollCompetitorResearch<Item, Provider>({
        fetcher,
        input,
        signal: controller.signal,
        initialSnapshot,
        maxAttempts,
        delayMs,
        onSnapshot: (snapshot) => {
          if (!isCurrent(controller)) return;
          latestSnapshot = snapshot;
          retryInput = snapshot.retryAvailable ? input : "";
          onSnapshot(snapshot);
        },
      });
      return isCurrent(controller) ? result : null;
    } catch (error) {
      if (!isCurrent(controller) || (error instanceof Error && error.name === "AbortError")) return null;
      throw error;
    } finally {
      if (activeController === controller) activeController = null;
    }
  };

  return {
    run,
    retry() {
      if (!mounted || !retryInput || !latestSnapshot.retryAvailable) return Promise.resolve(null);
      return run(retryInput, latestSnapshot);
    },
    reset() {
      activeController?.abort();
      activeController = null;
      retryInput = "";
      latestSnapshot = { items: [], providers: [], state: "unavailable", retryAvailable: false };
    },
    dispose() {
      mounted = false;
      activeController?.abort();
      activeController = null;
      retryInput = "";
    },
    get retryAvailable() {
      return mounted && Boolean(retryInput) && latestSnapshot.retryAvailable;
    },
    get active() {
      return activeController !== null;
    },
  };
}
