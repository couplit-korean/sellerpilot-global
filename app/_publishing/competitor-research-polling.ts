export type CompetitorResearchProviderSnapshot = { status?: unknown };

export type CompetitorResearchUiState = "idle" | "loading" | "ready" | "pending" | "stale" | "unavailable";

// The admin route allows provider work for 32 seconds. Leave enough room for
// authentication, response transfer, and mobile-network jitter before the
// browser aborts an otherwise valid response.
export const competitorResearchAttemptTimeoutMs = 45_000;

const competitorResearchIdentityFields = new Set([
  "researchInput",
  "productName",
  "categoryHint",
  "brandName",
  "manufacturer",
  "packageContents",
  "condition",
  "gtinStatus",
  "gtin",
]);

type CompetitorResearchRetryIdentity = Partial<Record<
  | "researchInput"
  | "productName"
  | "categoryHint"
  | "brandName"
  | "manufacturer"
  | "packageContents"
  | "condition"
  | "gtinStatus"
  | "gtin",
  string
>>;

function normalizedIdentityPart(value: unknown, maximumLength: number) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, maximumLength)
    : "";
}

function searchableBrandIdentity(value: string) {
  return /^(?:no\s*brand|unbranded|generic|무브랜드|브랜드\s*없음)$/iu.test(value) ? "" : value;
}

function stableProductModelParts(productName: string) {
  const candidates = productName.match(/[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)*/gu) ?? [];
  return [...new Set(candidates.filter((candidate) => (
    candidate.length >= 2
    && candidate.length <= 40
    && /[A-Za-z]/u.test(candidate)
    && /\d/u.test(candidate)
  )))].slice(0, 4);
}

function containsNormalizedIdentity(value: string, identity: string) {
  const normalizedValue = ` ${value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim()} `;
  const normalizedIdentity = identity.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
  return Boolean(normalizedIdentity) && normalizedValue.includes(` ${normalizedIdentity} `);
}

function identityProtectedAlias(
  alias: string,
  producerIdentity: string,
  productModels: string[],
  packageContents: string,
  gtin: string,
) {
  const normalizedAlias = normalizedIdentityPart(alias, 160);
  if (!normalizedAlias) return "";
  // Keep a confirmed brand, or the manufacturer for an explicitly unbranded
  // product, at the front of every localized query. Repeating the original
  // spelling is intentional: an unstructured translation cannot prove that a
  // localized token is a safe alias for that producer identity.
  const identityParts = [
    producerIdentity,
    ...productModels.filter((model) => !containsNormalizedIdentity(normalizedAlias, model)),
    !containsNormalizedIdentity(normalizedAlias, packageContents) ? packageContents : "",
    !containsNormalizedIdentity(normalizedAlias, gtin) ? gtin : "",
  ].filter(Boolean);
  return normalizedIdentityPart([...identityParts, normalizedAlias].join(" "), 160);
}

export function buildCompetitorResearchRetryPath(
  identity: CompetitorResearchRetryIdentity,
  localizedAliases: readonly string[] = [],
) {
  const brand = normalizedIdentityPart(identity.brandName, 80);
  const searchableBrand = searchableBrandIdentity(brand);
  const manufacturer = normalizedIdentityPart(identity.manufacturer, 80);
  const producerIdentity = searchableBrand || manufacturer;
  const productName = normalizedIdentityPart(identity.productName, 160);
  const productModels = stableProductModelParts(productName);
  const packageContents = normalizedIdentityPart(identity.packageContents, 40);
  const condition = normalizedIdentityPart(identity.condition, 24);
  const gtin = identity.gtinStatus === "NO_GTIN" ? "" : normalizedIdentityPart(identity.gtin, 14);
  const researchInput = normalizedIdentityPart(identity.researchInput, 160);
  const primaryParts = [searchableBrand, manufacturer !== searchableBrand ? manufacturer : "", productName, packageContents, condition !== "NEW" ? condition : "", gtin].filter(Boolean);
  const primary = (primaryParts.join(" ") || researchInput).slice(0, 500);
  if (primary.length < 2) return "";

  const params = new URLSearchParams({ query: primary });
  const aliases = [
    ...localizedAliases,
    productName,
    normalizedIdentityPart(identity.categoryHint, 120),
    !/^https?:\/\//i.test(researchInput) ? researchInput : "",
  ]
    .map((alias) => identityProtectedAlias(alias, producerIdentity, productModels, packageContents, gtin))
    .filter((value, index, values) => value.length >= 2 && value !== primary && values.indexOf(value) === index);
  for (const alias of aliases.slice(0, 12)) params.append("alias", alias);
  return `/api/admin/competitor-prices?${params.toString()}`;
}

export function shouldInvalidateCompetitorResearch(
  field: string,
  currentValue: unknown,
  nextValue: unknown,
) {
  return competitorResearchIdentityFields.has(field) && !Object.is(currentValue, nextValue);
}

export function competitorResearchEmptySlot(state: Exclude<CompetitorResearchUiState, "idle">) {
  if (state === "loading" || state === "pending") {
    return { label: "동일 상품 확인 중", value: "확인 중", loading: true } as const;
  }
  if (state === "stale") {
    return { label: "식별정보 변경 · 재확인 필요", value: "재확인", loading: false } as const;
  }
  if (state === "unavailable") {
    return { label: "가격 정보 확인 불가", value: "—", loading: false } as const;
  }
  return { label: "동일 상품을 찾지 못함", value: "—", loading: false } as const;
}

export function isCompetitorResearchBlockingAnalysis(
  state: CompetitorResearchUiState,
  pendingWithoutPricesConfirmed = false,
) {
  return state === "loading"
    || ((state === "pending" || state === "stale") && !pendingWithoutPricesConfirmed);
}

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
  perAttemptTimeoutMs?: number;
};

type CompetitorResearchPollingCoordinatorOptions<
  Item extends object,
  Provider extends CompetitorResearchProviderSnapshot,
> = {
  fetcher: CompetitorResearchPollOptions<Item, Provider>["fetcher"];
  onSnapshot: (snapshot: CompetitorResearchPollSnapshot<Item, Provider>) => void;
  maxAttempts?: number;
  delayMs?: number;
  perAttemptTimeoutMs?: number;
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

async function withCompetitorAttemptDeadline<T>(
  action: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
) {
  if (signal.aborted) throw abortError(signal);
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(abortError(signal));
  signal.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new DOMException("가격 비교 조회 시간이 초과되었습니다.", "TimeoutError"));
  }, timeoutMs);
  let onAttemptAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_, reject) => {
    onAttemptAbort = () => reject(controller.signal.reason ?? new DOMException("가격 비교 조회가 중단되었습니다.", "AbortError"));
    controller.signal.addEventListener("abort", onAttemptAbort, { once: true });
  });
  try {
    return await Promise.race([action(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onParentAbort);
    if (onAttemptAbort) controller.signal.removeEventListener("abort", onAttemptAbort);
  }
}

export async function pollCompetitorResearch<Item extends object, Provider extends CompetitorResearchProviderSnapshot>({
  fetcher,
  input,
  signal,
  onSnapshot,
  initialSnapshot,
  maxAttempts = 3,
  delayMs = 1_500,
  perAttemptTimeoutMs = competitorResearchAttemptTimeoutMs,
}: CompetitorResearchPollOptions<Item, Provider>): Promise<CompetitorResearchPollSnapshot<Item, Provider>> {
  const attempts = Math.max(1, Math.min(Number.isFinite(maxAttempts) ? Math.trunc(maxAttempts) : 3, 3));
  const attemptTimeout = Math.max(1_000, Math.min(
    Number.isFinite(perAttemptTimeoutMs) ? Math.trunc(perAttemptTimeoutMs) : competitorResearchAttemptTimeoutMs,
    60_000,
  ));
  let latest: CompetitorResearchPollSnapshot<Item, Provider> = {
    items: initialSnapshot?.items ?? [],
    providers: initialSnapshot?.providers ?? [],
    state: "unavailable",
    retryAvailable: false,
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal.aborted) throw abortError(signal);
    let response: Response;
    let payload: { items?: unknown; providers?: unknown } | null;
    try {
      ({ response, payload } = await withCompetitorAttemptDeadline(async (attemptSignal) => {
        const attemptResponse = await fetcher(input, { signal: attemptSignal });
        const attemptPayload = await attemptResponse.json().catch(() => null) as { items?: unknown; providers?: unknown } | null;
        return { response: attemptResponse, payload: attemptPayload };
      }, signal, attemptTimeout));
    } catch {
      if (signal.aborted) throw abortError(signal);
      if (attempt + 1 < attempts) {
        await abortableDelay(delayMs * (attempt + 1), signal);
        continue;
      }
      latest = { ...latest, state: "unavailable", retryAvailable: true };
      onSnapshot?.(latest);
      return latest;
    }
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
  perAttemptTimeoutMs = competitorResearchAttemptTimeoutMs,
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
        perAttemptTimeoutMs,
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
