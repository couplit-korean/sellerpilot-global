export type CompetitorResearchProviderSnapshot = { status?: unknown };

export type CompetitorResearchPollSnapshot<Item extends object, Provider extends object> = {
  items: Item[];
  providers: Provider[];
  state: "ready" | "pending" | "unavailable";
};

type CompetitorResearchPollOptions<Item extends object, Provider extends CompetitorResearchProviderSnapshot> = {
  fetcher: (input: string, init?: RequestInit) => Promise<Response>;
  input: string;
  signal: AbortSignal;
  onSnapshot?: (snapshot: CompetitorResearchPollSnapshot<Item, Provider>) => void;
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
  maxAttempts = 3,
  delayMs = 1_500,
}: CompetitorResearchPollOptions<Item, Provider>): Promise<CompetitorResearchPollSnapshot<Item, Provider>> {
  const attempts = Math.max(1, Math.min(Number.isFinite(maxAttempts) ? Math.trunc(maxAttempts) : 3, 5));
  let latest: CompetitorResearchPollSnapshot<Item, Provider> = { items: [], providers: [], state: "unavailable" };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal.aborted) throw abortError(signal);
    const response = await fetcher(input, { signal });
    const payload = await response.json().catch(() => null) as { items?: unknown; providers?: unknown } | null;
    const validPayload = Boolean(
      payload
      && Array.isArray(payload.items)
      && payload.items.every((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      && Array.isArray(payload.providers)
      && payload.providers.every((provider) => Boolean(provider) && typeof provider === "object" && !Array.isArray(provider)),
    );
    const items = validPayload ? payload!.items as Item[] : [];
    const providers = validPayload ? payload!.providers as Provider[] : [];
    const pending = response.status === 202 || providers.some((provider) => provider?.status === "pending");
    latest = {
      items,
      providers,
      state: validPayload && pending ? "pending" : validPayload && response.ok ? "ready" : "unavailable",
    };
    onSnapshot?.(latest);
    if (!validPayload || !pending || attempt === attempts - 1) return latest;
    await abortableDelay(delayMs * (attempt + 1), signal);
  }

  return latest;
}
