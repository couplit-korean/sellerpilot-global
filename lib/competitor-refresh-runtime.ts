import type {
  CompetitorPriceCandidate,
  CompetitorProviderStatus,
} from "./competitor-prices";

export type ClaimedCompetitorProduct = {
  productId: string;
  query: string;
  aliases: string[];
  claimToken: string;
};

export type CompetitorRefreshSearchResult = {
  items: CompetitorPriceCandidate[];
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

  if (searched.pending) {
    return {
      result: {
        productId: product.productId,
        ok: false,
        pending: true,
        count: 0,
        providers: searched.providers,
      },
      infrastructureFailure: false,
      failureStage: null,
    };
  }

  if (!searched.available) {
    return releaseAfterSearchFailure(product, searched.providers, release, false);
  }

  const items = searched.items.map((item) => ({ ...item, matcherVersion }));
  try {
    const savedCount = await complete({ product, items, providers: searched.providers });
    if (!Number.isFinite(savedCount) || savedCount < 0) {
      return {
        result: failedResult(product, searched.providers),
        infrastructureFailure: true,
        failureStage: "snapshot_complete",
      };
    }
    return {
      result: {
        productId: product.productId,
        ok: true,
        pending: false,
        count: savedCount,
        providers: searched.providers,
      },
      infrastructureFailure: false,
      failureStage: null,
    };
  } catch {
    // Completion may have committed before a response was lost. Never release
    // the claim here: the lease fence prevents a blind duplicate completion.
    return {
      result: failedResult(product, searched.providers),
      infrastructureFailure: true,
      failureStage: "snapshot_complete",
    };
  }
}
