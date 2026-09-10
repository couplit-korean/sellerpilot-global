import type { ChannelOperationName as TransportOperationName } from "../channels/operation-names";
import { step, type ChannelOperationStep } from "../channels/operation-step";
import { stringArgument, integerArgument } from "../channels/operation-values";
import { type RemoteResponse, type SecretPayload } from "../channels/protocols";
import { channelCatalog, type ActiveChannelKey } from "../channels/catalog";
import { qoo10ResultMessage } from "../channels/qoo10";

import { verifyListingUpdateReadback } from "../channels/listing-update";
import {
  listingOperationRequiresVerifiedRemoteState,
  listingOperationUsesPublicationIntent,
  listingPublicationIntentFromArguments,
  listingRemoteStateContractVersion,
  listingRemoteStateFulfillsOperation,
  listingRemoteStateMatchesOperation,
  verifiedListingRemoteStateSchema,
  type ListingPublicationIntent,
  type VerifiedListingRemoteState,
} from "../channels/listing-publication-state";
import { channelOperationCapabilities } from "../channels/operation-names";

export const channelOperationNames = [
  "categories.list",
  "categories.suggest",
  "categories.attributes",
  "categories.validate",
  "listing.create",
  "listing.update",
  "listing.stop",
  "listing.activate",
  "listing.publication.verify",
  "price.update",
  "inventory.update",
] as const;

export type ChannelOperationName = Exclude<
  TransportOperationName,
  "inquiries.list" | "inquiries.reply"
>;

export const writeChannelOperations = new Set<ChannelOperationName>([
  "listing.create",
  "listing.update",
  "listing.stop",
  "listing.activate",
  "price.update",
  "inventory.update",
]);

export type ChannelOperationResult = {
  ok: boolean;
  channel: ActiveChannelKey;
  operation: TransportOperationName;
  steps: ChannelOperationStep[];
  remoteId?: string;
  publicUrl?: string;
  publicationIntent?: ListingPublicationIntent;
  publicationStateContract?: typeof listingRemoteStateContractVersion;
  remoteState?: VerifiedListingRemoteState;
  publicationFulfilled?: boolean;
  continuation?: {
    reason: "page_cap_reached";
    arguments: Record<string, unknown>;
  };
  smartstoreContentRepair?: {
    contract: "smartstore_existing_content_repair_mutation_v1";
    originProductNo: string;
    channelProductNo: string;
    baselineBodySha256: string;
    prewriteProtectedBodySha256: string;
    prewriteOriginResponseSha256: string;
    prewriteChannelResponseSha256: string;
  };
  shopeeSgCreateCompletionMap?: {
    sameTransactionAsLocalPublish: true;
    globalItemId: string;
    localItemId: string;
  };
  safeMessage: string;
};

export type ShopeeSgCreateStageName =
  | "image-upload"
  | "global-item-create"
  | "local-publish";

export type ShopeeSgCreateStageInput = {
  sequence: number;
  stage: ShopeeSgCreateStageName;
  preparedPayloadSha256: string;
  sourceUrl?: string;
  sourceSha256?: string;
  globalItemId?: string;
};

export type ShopeeSgCreateStageCompletion = ShopeeSgCreateStageInput & {
  outputId: string;
  result?: Record<string, unknown>;
};

export type ExecuteInput = {
  channel: ActiveChannelKey;
  operation: ChannelOperationName;
  payload: SecretPayload;
  shopeeShopCredential?: SecretPayload;
  arguments: Record<string, unknown>;
  environment: "sandbox" | "production";
  providerMutationHooks?: {
    begin: (input?: { providerBody?: Record<string, unknown> }) => Promise<void>;
    assertLeaseHealthy: () => Promise<void>;
    gatewayCredentialId?: string;
    readShopeeSgCreateStageState?: () => Promise<unknown>;
    beginShopeeSgCreateStage?: (stage: ShopeeSgCreateStageInput) => Promise<unknown>;
    completeShopeeSgCreateStage?: (
      completion: ShopeeSgCreateStageCompletion,
    ) => Promise<unknown>;
    readShopeeSgCreateResume?: () => Promise<unknown>;
    recordShopeeSgGlobalCreateReadback?: (value: {
      globalItemId: string;
      createResponse: Record<string, unknown>;
      readbackResponse?: Record<string, unknown>;
      officialReadback?: Record<string, unknown>;
      preparedArguments?: Record<string, unknown>;
    }) => Promise<void>;
    captureShopeeSgPreparedArguments?: (value: Record<string, unknown>) => void;
  };
  signal?: AbortSignal;
};

export function booleanArgument(
  source: Record<string, unknown>,
  key: string,
  fallback = false,
) {
  const value = source[key];
  return typeof value === "boolean" ? value : fallback;
}

export function inventoryQuantityVerificationStep(
  name: string,
  remote: RemoteResponse,
  expectedQuantity: number,
  actualQuantity: unknown,
): ChannelOperationStep {
  const verifiedStep = step(name, remote);
  const normalizedActual =
    typeof actualQuantity === "number"
      ? actualQuantity
      : Number(actualQuantity);
  const verified =
    verifiedStep.ok &&
    Number.isFinite(normalizedActual) &&
    normalizedActual === expectedQuantity;
  return {
    ...verifiedStep,
    ok: verified,
    data: {
      ...verifiedStep.data,
      expectedQuantity,
      actualQuantity: Number.isFinite(normalizedActual)
        ? normalizedActual
        : null,
      sellerpilotVerification: verified
        ? "INVENTORY_QUANTITY_VERIFIED"
        : "INVENTORY_QUANTITY_MISMATCH",
    },
  };
}

export function listingUpdateReadbackStep(
  name: string,
  remote: RemoteResponse,
  channel: ActiveChannelKey,
  argumentsValue: Record<string, unknown>,
): ChannelOperationStep {
  const readbackStep = step(name, remote);
  const verification = verifyListingUpdateReadback(
    channel,
    argumentsValue,
    remote.data,
  );
  readbackStep.ok = readbackStep.ok && verification.ok;
  readbackStep.data = {
    ...readbackStep.data,
    sellerpilotVerification: readbackStep.ok
      ? "LISTING_MUTABLE_FIELDS_VERIFIED"
      : "LISTING_MUTABLE_FIELDS_MISMATCH",
    sellerpilotMismatchPaths: verification.mismatches.slice(0, 40),
  };
  return readbackStep;
}

export function result(
  input: ExecuteInput,
  steps: ChannelOperationStep[],
  remoteId?: string,
  continuation?: ChannelOperationResult["continuation"],
  verifiedRemoteState?: VerifiedListingRemoteState,
): ChannelOperationResult {
  const providerStepsSucceeded =
    steps.length > 0 && steps.every((item) => item.ok);
  // A create response is not a durable success until the provider identity is
  // known. Some marketplace APIs can acknowledge the mutation while omitting
  // the identifier from a malformed/delayed response. Treating that response
  // as successful would publish a listing that cannot be updated and, after a
  // retry, can create a duplicate remote product.
  const createIdentityMissing =
    input.operation === "listing.create" && !remoteId?.trim();
  // Direct provider protocol callers that predate the remote-state contract
  // remain parseable for fixture and recovery compatibility. Every new admin
  // listing write injects the contract before enqueueing, so the strict fence
  // is activated whenever the marker is present (including an invalid marker).
  // Gateway completion still rejects a legacy `ok` result without the marker.
  const publicationVerificationRequested =
    listingOperationRequiresVerifiedRemoteState(input.operation) &&
    Object.hasOwn(input.arguments, "publicationStateContract");
  const publicationStateContract =
    publicationVerificationRequested &&
      input.arguments.publicationStateContract ===
      listingRemoteStateContractVersion
      ? listingRemoteStateContractVersion
      : undefined;
  const publicationIntent = listingOperationUsesPublicationIntent(
    input.operation,
  )
    ? listingPublicationIntentFromArguments(input.arguments)
    : undefined;
  const parsedRemoteState =
    verifiedListingRemoteStateSchema.safeParse(verifiedRemoteState);
  const remoteState = parsedRemoteState.success
    ? parsedRemoteState.data
    : undefined;
  const publicationContractMissing =
    providerStepsSucceeded &&
    !createIdentityMissing &&
    publicationVerificationRequested &&
    !publicationStateContract;
  const publicationIntentMissing =
    providerStepsSucceeded &&
    !createIdentityMissing &&
    publicationVerificationRequested &&
    listingOperationUsesPublicationIntent(input.operation) &&
    !publicationIntent;
  const publicationStateMissing =
    providerStepsSucceeded &&
    !createIdentityMissing &&
    publicationVerificationRequested &&
    !remoteState;
  const publicationStateMismatch = Boolean(
    publicationStateContract &&
    remoteState &&
    !listingRemoteStateMatchesOperation(
      input.operation,
      remoteState,
      publicationIntent,
    ),
  );
  const publicationFulfilled =
    publicationStateContract && remoteState
      ? listingRemoteStateFulfillsOperation(
        input.operation,
        remoteState,
        publicationIntent,
      )
      : undefined;
  const ok =
    providerStepsSucceeded &&
    !createIdentityMissing &&
    !publicationContractMissing &&
    !publicationIntentMissing &&
    !publicationStateMissing &&
    !publicationStateMismatch;
  const providerMessage =
    steps
      .filter((item) => !item.ok)
      .map((item) => {
        const message =
          input.channel === "qoo10"
            ? qoo10ResultMessage(item.data)
            : safeProviderError(item.data);
        return message ? `${item.name}: ${message}` : "";
      })
      .find(Boolean) ?? "";
  return {
    ok,
    channel: input.channel,
    operation: input.operation,
    steps,
    remoteId,
    ...(publicationIntent ? { publicationIntent } : {}),
    ...(publicationStateContract ? { publicationStateContract } : {}),
    ...(remoteState ? { remoteState } : {}),
    ...(publicationFulfilled === undefined ? {} : { publicationFulfilled }),
    ...(ok && continuation ? { continuation } : {}),
    safeMessage: ok
      ? continuation
        ? `${channelCatalog[input.channel].name} ${input.operation} 현재 구간이 정상 응답했고 다음 페이지 구간을 이어서 처리합니다.`
        : `${channelCatalog[input.channel].name} ${input.operation} 작업이 정상 응답했습니다.`
      : createIdentityMissing && providerStepsSucceeded
        ? `${channelCatalog[input.channel].name} 상품 생성 응답은 수신했지만 원격 상품 식별값을 확인할 수 없습니다. 판매자센터 수동 확인이 필요합니다.`
        : publicationContractMissing
          ? `${channelCatalog[input.channel].name} 상품 작업에 검증된 원격 상태 계약이 없어 성공으로 처리하지 않았습니다.`
          : publicationIntentMissing
            ? `${channelCatalog[input.channel].name} 상품 작업의 원장 게시 의도를 확인할 수 없어 성공으로 처리하지 않았습니다.`
            : publicationStateMissing
              ? `${channelCatalog[input.channel].name} 원격 상품 응답은 수신했지만 게시 상태 검증값을 확인할 수 없습니다. 판매자센터 수동 확인이 필요합니다.`
              : publicationStateMismatch
                ? `${channelCatalog[input.channel].name} 원격 상품 가시성이 요청한 작업과 일치하지 않습니다. 판매자센터 수동 확인이 필요합니다.`
                : `${channelCatalog[input.channel].name} ${input.operation} 작업이 원격 오류로 종료됐습니다.${providerMessage ? ` · ${providerMessage}` : ""}`,
  };
}

export function safeProviderError(data: Record<string, unknown>) {
  const values: string[] = [];
  const keys = new Set([
    "error",
    "errors",
    "errorcode",
    "error_code",
    "errormsg",
    "error_msg",
    "errormessage",
    "error_message",
    "message",
    "resultmessage",
    "authmessage",
    "msg",
    "detail",
    "details",
    "reason",
    "failure_reason",
    "issue",
    "issues",
    "invalidinputs",
    "invalid_inputs",
  ]);
  const visit = (value: unknown, depth: number, keyed = false) => {
    if (
      depth > 6 ||
      values.length >= 16 ||
      value === null ||
      value === undefined
    )
      return;
    if (typeof value === "string" || typeof value === "number") {
      if (keyed && String(value).trim()) values.push(String(value).trim());
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1, keyed);
      return;
    }
    if (typeof value !== "object") return;
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const normalizedKey = key.toLocaleLowerCase().replace(/[^a-z_]/g, "");
      if (keys.has(normalizedKey)) visit(child, depth + 1, true);
      else if (keyed) visit(child, depth + 1, true);
    }
  };
  visit(data, 0);
  return [...new Set(values)]
    .join(" · ")
    .replace(/https?:\/\/\S+/gi, "[URL]")
    .replace(
      /\b(key|token|secret|authorization|signature)=\S+/gi,
      "$1=[redacted]",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

export function ensureProviderSupport(
  channel: ActiveChannelKey,
  operation: ChannelOperationName,
) {
  const capability =
    channelCatalog[channel].capabilities[
    channelOperationCapabilities[operation]
    ];
  if (capability.mode === "unsupported")
    throw new Error(`CHANNEL_OPERATION_UNSUPPORTED:${operation}`);
  if (capability.mode === "vendor_docs_required")
    throw new Error(`CHANNEL_VENDOR_SPEC_REQUIRED:${operation}`);
}

export function operationDelay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function verifiedPublicationArguments(input: ExecuteInput) {
  return {
    expectedLocale: stringArgument(
      input.arguments,
      "publicationExpectedLocale",
    ),
    expectedFingerprint: stringArgument(
      input.arguments,
      "publicationExpectedFingerprint",
    ),
    expectedImageCount: integerArgument(
      input.arguments,
      "publicationExpectedImageCount",
      { min: 0, max: 64 },
    ),
  };
}

// ---------------------------------------------------------------------------
// Channel-native image upload (Shopee media_space, Lazada MigrateImage /
// UploadImage). The normalization pipeline leaves public Supabase URLs in
// arguments.imageUrls; before a listing.create write these URLs are migrated
// into the channel's own media space and the resulting native references are
// injected back into the request payload. When native upload is not possible
// (no source URLs, missing credentials, missing target structure) or fails,
// the existing URL injection is preserved and the original arguments are used
// unchanged.
// ---------------------------------------------------------------------------

export function nativeImageSourceUrls(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

export function listingPublicationReadbackRequested(input: ExecuteInput) {
  return (
    listingOperationRequiresVerifiedRemoteState(input.operation) &&
    input.arguments.publicationStateContract ===
    listingRemoteStateContractVersion
  );
}

export function publicationStateVerificationStep(
  channel: ActiveChannelKey,
  state: VerifiedListingRemoteState | undefined,
  failureCode: string | undefined,
): ChannelOperationStep {
  return {
    name: "publication-state-verification",
    ok: Boolean(state),
    status: state ? 200 : 422,
    data: state
      ? {
        sellerpilotVerification: "VERIFIED_REMOTE_PUBLICATION_STATE",
        visibility: state.visibility,
        providerStatus: state.providerStatus,
        imageCount: state.imageCount,
      }
      : {
        sellerpilotVerification: "REMOTE_PUBLICATION_STATE_UNVERIFIED",
        code:
          failureCode ??
          `${channel.toUpperCase()}_PUBLICATION_READBACK_UNVERIFIED`,
      },
  };
}
