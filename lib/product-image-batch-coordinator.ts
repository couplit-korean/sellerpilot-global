import {
  findDuplicateShot,
  MAXIMUM_SHOT_GENERATION_ATTEMPTS,
  type DuplicateShotMatch,
  type ShotFingerprint,
} from "./image-shot-uniqueness";

export const PRODUCT_IMAGE_BATCH_SIZE = 3;

export type ProductImageBackgroundShot = ShotFingerprint & {
  plateFile?: string;
  plateDigest?: string;
  plateBytes?: number;
  semanticAssetId?: string;
  maskPlacements?: Array<{ left: number; top: number; width: number; height: number }>;
};

export type ProductImageBackgroundProps = {
  assetId: string;
  propKeys: string[];
};

export type ProductImageHistory = {
  shots: ShotFingerprint[];
  backgroundShots: ProductImageBackgroundShot[];
  backgroundProps: ProductImageBackgroundProps[];
};

export type ProductImageCandidate<T> = {
  assetId: string;
  specIndex: number;
  fingerprint: ShotFingerprint;
  backgroundShot: ProductImageBackgroundShot | null;
  backgroundProps: ProductImageBackgroundProps | null;
  value: T;
};

export type ProductImageBatchConflict =
  | ({ kind: "shot" | "background" } & DuplicateShotMatch)
  | { kind: "prop"; assetId: string; propKey: string }
  | {
      kind: "semantic";
      assetId: string;
      conflictingAssetIds: string[];
      retryAuditFeedback: {
        failedDimensions?: string[];
        hardNegativeLocationKeys?: string[];
        hardNegativeMomentKeys?: string[];
        hardNegativeSurfaceKeys?: string[];
        hardNegativeCameraKeys?: string[];
        hardNegativePaletteKeys?: string[];
        hardNegativeSpatialDepthKeys?: string[];
        hardNegativeCueKeys?: string[];
      };
      safeForRetryComparison: boolean;
    };

export type ProductImageGenerationOutcome<T> =
  | {
      status: "accepted";
      attemptsUsed?: number;
      fingerprint: ShotFingerprint;
      backgroundShot?: ProductImageBackgroundShot | null;
      backgroundProps?: ProductImageBackgroundProps | null;
      value: T;
    }
  | { status: "retry"; attemptsUsed?: number; reason: string };

type ProductImageSpec = { id: string };

type ProductImageBatchOptions<TSpec extends ProductImageSpec, TValue> = {
  specs: readonly TSpec[];
  signal?: AbortSignal;
  batchSize?: number;
  maximumAttempts?: number;
  getCommittedHistory: () => ProductImageHistory;
  generateCandidate: (input: {
    spec: TSpec;
    specIndex: number;
    attempt: number;
    history: ProductImageHistory;
    signal: AbortSignal;
  }) => Promise<ProductImageGenerationOutcome<TValue>>;
  findPostGenerationConflict?: (input: {
    spec: TSpec;
    attempt: number;
    candidate: ProductImageCandidate<TValue>;
    acceptedCandidates: readonly ProductImageCandidate<TValue>[];
    signal: AbortSignal;
  }) => Promise<ProductImageBatchConflict | null>;
  onBarrierRejected?: (input: {
    spec: TSpec;
    attempt: number;
    candidate: ProductImageCandidate<TValue>;
    conflict: ProductImageBatchConflict;
  }) => Promise<void> | void;
  onAttemptsExhausted?: (input: {
    spec: TSpec;
    attempt: number;
    candidate: ProductImageCandidate<TValue> | null;
    conflict: ProductImageBatchConflict | null;
    reason: string;
  }) => Promise<never> | never;
  commitCandidate: (input: {
    spec: TSpec;
    candidate: ProductImageCandidate<TValue>;
    signal: AbortSignal;
  }) => Promise<void>;
};

function abortError(signal?: AbortSignal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new DOMException("상품 이미지 배치가 취소됐습니다.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal);
}

function cloneFingerprint<T extends ShotFingerprint>(fingerprint: T): T {
  return {
    ...fingerprint,
    visualHash: fingerprint.visualHash.slice(),
    ...(Array.isArray((fingerprint as ProductImageBackgroundShot).maskPlacements)
      ? {
          maskPlacements: (fingerprint as ProductImageBackgroundShot).maskPlacements?.map((placement) => ({
            ...placement,
          })),
        }
      : {}),
  } as T;
}

export function immutableProductImageHistory(history: ProductImageHistory): ProductImageHistory {
  return {
    shots: Object.freeze(history.shots.map((shot) => Object.freeze(cloneFingerprint(shot)))) as unknown as ShotFingerprint[],
    backgroundShots: Object.freeze(
      history.backgroundShots.map((shot) => Object.freeze(cloneFingerprint(shot))),
    ) as unknown as ProductImageBackgroundShot[],
    backgroundProps: Object.freeze(history.backgroundProps.map((entry) => Object.freeze({
      assetId: entry.assetId,
      propKeys: Object.freeze([...entry.propKeys]) as unknown as string[],
    }))) as unknown as ProductImageBackgroundProps[],
  };
}

function appendCandidateToHistory<T>(
  history: ProductImageHistory,
  candidate: ProductImageCandidate<T>,
) {
  return immutableProductImageHistory({
    shots: [...history.shots, candidate.fingerprint],
    backgroundShots: candidate.backgroundShot
      ? [...history.backgroundShots, candidate.backgroundShot]
      : [...history.backgroundShots],
    backgroundProps: candidate.backgroundProps
      ? [...history.backgroundProps, candidate.backgroundProps]
      : [...history.backgroundProps],
  });
}

export function findProductImageBatchConflict<T>(
  candidate: ProductImageCandidate<T>,
  history: ProductImageHistory,
): ProductImageBatchConflict | null {
  const shot = findDuplicateShot(candidate.fingerprint, history.shots);
  if (shot) return { kind: "shot", ...shot };

  if (candidate.backgroundShot) {
    const background = findDuplicateShot(candidate.backgroundShot, history.backgroundShots);
    if (background) return { kind: "background", ...background };
  }

  for (const propKey of candidate.backgroundProps?.propKeys ?? []) {
    const repeated = history.backgroundProps.find((entry) => entry.propKeys.includes(propKey));
    if (repeated) return { kind: "prop", assetId: repeated.assetId, propKey };
  }
  return null;
}

function candidateFromOutcome<T>(
  assetId: string,
  specIndex: number,
  outcome: Extract<ProductImageGenerationOutcome<T>, { status: "accepted" }>,
): ProductImageCandidate<T> {
  if (outcome.fingerprint.assetId !== assetId) {
    throw new Error(`상품 이미지 후보 역할이 일치하지 않습니다. expected=${assetId} actual=${outcome.fingerprint.assetId}`);
  }
  const fingerprint = Object.freeze(cloneFingerprint(outcome.fingerprint));
  const backgroundShot = outcome.backgroundShot
    ? Object.freeze(cloneFingerprint(outcome.backgroundShot))
    : null;
  const backgroundProps = outcome.backgroundProps
    ? Object.freeze({
        assetId: outcome.backgroundProps.assetId,
        propKeys: Object.freeze([...outcome.backgroundProps.propKeys]) as unknown as string[],
      })
    : null;
  return Object.freeze({
    assetId,
    specIndex,
    fingerprint,
    backgroundShot,
    backgroundProps,
    value: outcome.value,
  });
}

async function exhausted<TSpec extends ProductImageSpec, TValue>(
  options: ProductImageBatchOptions<TSpec, TValue>,
  input: Parameters<NonNullable<ProductImageBatchOptions<TSpec, TValue>["onAttemptsExhausted"]>>[0],
): Promise<never> {
  if (options.onAttemptsExhausted) return options.onAttemptsExhausted(input);
  throw new Error(`${input.spec.id} 이미지가 ${input.attempt}회 시도 후에도 승인되지 않았습니다. · ${input.reason}`);
}

function waveSignal(parent: AbortSignal | undefined, controller: AbortController) {
  return parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
}

export async function runDeterministicProductImageBatches<
  TSpec extends ProductImageSpec,
  TValue,
>(options: ProductImageBatchOptions<TSpec, TValue>) {
  const batchSize = options.batchSize ?? PRODUCT_IMAGE_BATCH_SIZE;
  const maximumAttempts = options.maximumAttempts ?? MAXIMUM_SHOT_GENERATION_ATTEMPTS;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > PRODUCT_IMAGE_BATCH_SIZE) {
    throw new Error(`상품 이미지 배치 크기는 1~${PRODUCT_IMAGE_BATCH_SIZE}이어야 합니다.`);
  }
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > MAXIMUM_SHOT_GENERATION_ATTEMPTS) {
    throw new Error(`상품 이미지 역할별 시도 횟수는 1~${MAXIMUM_SHOT_GENERATION_ATTEMPTS}이어야 합니다.`);
  }
  const seen = new Set<string>();
  for (const spec of options.specs) {
    if (!spec.id || seen.has(spec.id)) throw new Error("상품 이미지 역할 ID는 비어 있지 않고 고유해야 합니다.");
    seen.add(spec.id);
  }

  const committed: ProductImageCandidate<TValue>[] = [];
  for (let batchOffset = 0; batchOffset < options.specs.length; batchOffset += batchSize) {
    throwIfAborted(options.signal);
    const batchSpecs = options.specs.slice(batchOffset, batchOffset + batchSize);
    const accepted = new Map<string, ProductImageCandidate<TValue>>();
    const attempts = new Map(batchSpecs.map((spec) => [spec.id, 0]));
    const committedHistory = immutableProductImageHistory(options.getCommittedHistory());

    while (accepted.size < batchSpecs.length) {
      throwIfAborted(options.signal);
      const pending = batchSpecs.filter((spec) => !accepted.has(spec.id));
      const acceptedHistory = batchSpecs.reduce((history, spec) => {
        const candidate = accepted.get(spec.id);
        return candidate ? appendCandidateToHistory(history, candidate) : history;
      }, committedHistory);
      const controller = new AbortController();
      const signal = waveSignal(options.signal, controller);
      let firstFailure: unknown = null;
      const settled = await Promise.allSettled(pending.map(async (spec) => {
        const attemptsBefore = attempts.get(spec.id) ?? 0;
        const startingAttempt = attemptsBefore + 1;
        try {
          const outcome = await options.generateCandidate({
            spec,
            specIndex: batchOffset + batchSpecs.indexOf(spec),
            attempt: startingAttempt,
            history: immutableProductImageHistory(acceptedHistory),
            signal,
          });
          const attemptsUsed = outcome.attemptsUsed ?? 1;
          if (!Number.isSafeInteger(attemptsUsed)
              || attemptsUsed < 1
              || attemptsBefore + attemptsUsed > maximumAttempts) {
            throw new Error(`${spec.id} 이미지 후보가 허용되지 않은 시도 예산을 사용했습니다.`);
          }
          const attempt = attemptsBefore + attemptsUsed;
          attempts.set(spec.id, attempt);
          return { spec, attempt, outcome };
        } catch (error) {
          firstFailure ??= error;
          if (!controller.signal.aborted) controller.abort(error);
          throw error;
        }
      }));
      if (options.signal?.aborted) throw abortError(options.signal);
      if (firstFailure) throw firstFailure;
      const rejectedExecution = settled.find((entry) => entry.status === "rejected");
      if (rejectedExecution?.status === "rejected") throw rejectedExecution.reason;

      let barrierHistory = acceptedHistory;
      for (const entry of settled) {
        if (entry.status !== "fulfilled") continue;
        const { spec, attempt, outcome } = entry.value;
        if (outcome.status === "retry") {
          if (attempt >= maximumAttempts) {
            await exhausted(options, {
              spec,
              attempt,
              candidate: null,
              conflict: null,
              reason: outcome.reason,
            });
          }
          continue;
        }
        const candidate = candidateFromOutcome(
          spec.id,
          batchOffset + batchSpecs.indexOf(spec),
          outcome,
        );
        throwIfAborted(options.signal);
        const deterministicConflict = findProductImageBatchConflict(candidate, barrierHistory);
        const acceptedCandidates = Object.freeze(
          [...accepted.values()].sort((left, right) => left.specIndex - right.specIndex),
        );
        let postGenerationConflict: ProductImageBatchConflict | null = null;
        if (!deterministicConflict && options.findPostGenerationConflict) {
          postGenerationConflict = await options.findPostGenerationConflict({
            spec,
            attempt,
            candidate,
            acceptedCandidates,
            signal,
          });
        }
        throwIfAborted(options.signal);
        const conflict = deterministicConflict ?? postGenerationConflict;
        if (conflict) {
          if (attempt >= maximumAttempts) {
            await exhausted(options, {
              spec,
              attempt,
              candidate,
              conflict,
              reason: `${conflict.kind}:${conflict.assetId}`,
            });
          }
          await options.onBarrierRejected?.({ spec, attempt, candidate, conflict });
          continue;
        }
        accepted.set(spec.id, candidate);
        barrierHistory = appendCandidateToHistory(barrierHistory, candidate);
      }
    }

    for (const spec of batchSpecs) {
      throwIfAborted(options.signal);
      const candidate = accepted.get(spec.id);
      if (!candidate) throw new Error(`${spec.id} 승인 후보를 결정적으로 복구하지 못했습니다.`);
      await options.commitCandidate({ spec, candidate, signal: options.signal ?? new AbortController().signal });
      committed.push(candidate);
    }
  }
  return committed;
}
