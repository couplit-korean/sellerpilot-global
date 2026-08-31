import type {
  CompetitorPriceCandidate,
  CompetitorProductIdentity,
  CompetitorProviderStatus,
} from "./competitor-prices";

export type ClaimedCompetitorProduct = {
  productId: string;
  query: string;
  aliases: string[];
  claimToken: string;
  identity: CompetitorProductIdentity;
};

export type CompetitorRefreshSearchResult = {
  items: CompetitorPriceCandidate[];
  sourceItems?: CompetitorPriceCandidate[];
  providers: CompetitorProviderStatus[];
  available: boolean;
  pending: boolean;
};

export type CompetitorRefreshResult = {
  productId: string;
  ok: boolean;
  pending: boolean;
  count: number;
  providers: CompetitorProviderStatus[];
};

export type CompetitorRefreshFailureStage =
  | "provider_search"
  | "claim_release"
  | "snapshot_complete";

type RunCompetitorProductRefreshOptions = {
  product: ClaimedCompetitorProduct;
  unavailableProviders: CompetitorProviderStatus[];
  matcherVersion: string;
  terminalizePendingProviders?: readonly CompetitorProviderStatus["provider"][];
  search: (product: ClaimedCompetitorProduct) => Promise<CompetitorRefreshSearchResult>;
  release: (product: ClaimedCompetitorProduct) => Promise<boolean>;
  complete: (input: {
    product: ClaimedCompetitorProduct;
    items: Array<CompetitorPriceCandidate & { matcherVersion: string }>;
    providers: CompetitorProviderStatus[];
  }) => Promise<number>;
};

export type CompetitorProductRefreshOutcome = {
  result: CompetitorRefreshResult;
  infrastructureFailure: boolean;
  failureStage: CompetitorRefreshFailureStage | null;
};

const MAX_COMPETITOR_PRODUCT_CONCURRENCY = 3;

/**
 * Keeps a claimed refresh batch concurrent without allowing a caller to turn
 * one scheduler request into an unbounded marketplace fan-out. Results retain
 * claim order so the route response stays deterministic for operators/tests.
 */
export async function runBoundedCompetitorRefreshBatch<T>(
  products: readonly T[],
  requestedConcurrency: number,
  refresh: (product: T, index: number) => Promise<CompetitorProductRefreshOutcome>,
) {
  if (products.length === 0) return [];
  const concurrency = Math.max(
    1,
    Math.min(
      MAX_COMPETITOR_PRODUCT_CONCURRENCY,
      products.length,
      Number.isFinite(requestedConcurrency) ? Math.floor(requestedConcurrency) : 1,
    ),
  );
  const outcomes = new Array<CompetitorProductRefreshOutcome>(products.length);
  let nextIndex = 0;

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (nextIndex < products.length) {
      const index = nextIndex;
      nextIndex += 1;
      outcomes[index] = await refresh(products[index], index);
    }
  }));

  return outcomes;
}

function failedResult(
  product: ClaimedCompetitorProduct,
  providers: CompetitorProviderStatus[],
): CompetitorRefreshResult {
  return {
    productId: product.productId,
    ok: false,
    pending: false,
    count: 0,
    providers,
  };
}

async function releaseAfterSearchFailure(
  product: ClaimedCompetitorProduct,
  providers: CompetitorProviderStatus[],
  release: RunCompetitorProductRefreshOptions["release"],
  searchFailed: boolean,
): Promise<CompetitorProductRefreshOutcome> {
  const released = await release(product).catch(() => false);
  return {
    result: failedResult(product, providers),
    infrastructureFailure: !released,
    failureStage: !released ? "claim_release" : searchFailed ? "provider_search" : null,
  };
}

/**
 * Runs one already-fenced competitor refresh claim. All external and database
 * dependencies are injected so the exact scheduler lifecycle can be exercised
 * with synthetic providers without marketplace traffic or production writes.
 */
export async function runClaimedCompetitorProductRefresh({
  product,
  unavailableProviders,
  matcherVersion,
  terminalizePendingProviders = [],
  search,
  release,
  complete,
}: RunCompetitorProductRefreshOptions): Promise<CompetitorProductRefreshOutcome> {
  let searched: CompetitorRefreshSearchResult;
  try {
    searched = await search(product);
  } catch {
    return releaseAfterSearchFailure(product, unavailableProviders, release, true);
  }

  const terminalized = new Set(terminalizePendingProviders);
  const providers = searched.providers.map((provider) => (
    provider.status === "pending" && terminalized.has(provider.provider)
      ? { ...provider, status: "failed" as const, count: 0 }
      : provider
  ));
  const pending = providers.some((provider) => provider.status === "pending");

  if (pending) {
    return {
      result: {
        productId: product.productId,
        ok: false,
        pending: true,
        count: 0,
        providers,
      },
      infrastructureFailure: false,
      failureStage: null,
    };
  }

  // A completed search with no available provider is still durable provider
  // truth. Finish the fenced claim with an empty item snapshot so the UI can
  // distinguish failed/unavailable providers from a successful zero-match
  // search. Only an exception thrown by search itself takes the release path.
  const searchedProviders = new Set(
    providers
      .filter((provider) => provider.status === "searched")
      .map((provider) => provider.provider),
  );
  const available = searchedProviders.size > 0;
  const items = available
    ? (searched.sourceItems ?? searched.items)
        .filter((item) => searchedProviders.has(item.provider))
        .map((item) => ({ ...item, matcherVersion }))
    : [];
  try {
    const savedCount = await complete({ product, items, providers });
    if (!Number.isFinite(savedCount) || savedCount < 0) {
      return {
        result: failedResult(product, providers),
        infrastructureFailure: true,
        failureStage: "snapshot_complete",
      };
    }
    if (!available) {
      return {
        result: failedResult(product, providers),
        infrastructureFailure: false,
        failureStage: null,
      };
    }
    return {
      result: {
        productId: product.productId,
        ok: providers.every((provider) => provider.status === "searched"),
        pending: false,
        count: savedCount,
        providers,
      },
      infrastructureFailure: false,
      failureStage: null,
    };
  } catch {
    // Completion may have committed before a response was lost. Never release
    // the claim here: the lease fence prevents a blind duplicate completion.
    return {
      result: failedResult(product, providers),
      infrastructureFailure: true,
      failureStage: "snapshot_complete",
    };
  }
}
