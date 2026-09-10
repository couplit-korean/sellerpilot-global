import { createHash } from "node:crypto";

import { shopeeGlobalCreateBody } from "../../channels/shopee-create-preflight";
import {
  shopeeMerchantRequest,
  shopeeRequest,
  type RemoteResponse,
  type SecretPayload,
} from "../../channels/protocols";
import {
  listingPublicationIntentFromArguments,
  listingRemoteStateContractVersion,
} from "../../channels/listing-publication-state";
import { shopeeGlobalPublishArgumentsForIntent } from "../../channels/provider-shopee-publication-readback";
import type { ChannelOperationResult, ExecuteInput } from "../execution-shared";
import type {
  ShopeeSgCreateStageCompletion,
  ShopeeSgCreateStageInput,
} from "../execution-shared";
import {
  executeShopeeSgCreateOrchestration,
  executeShopeeSgLocalResumeOrchestration,
  assertShopeeSgExactGlobalReadback,
  type ShopeeSgCreateMutationStage,
  type ShopeeSgLocalPublicationReadback,
} from "./create-orchestration";
import { prepareShopeeSgProviderImagesOnly } from "./provider-images";
import {
  shopeeSgCreateExecutionLineageArgument,
  shopeeSgCreateExecutionLineageContract,
} from "./target-lineage-readiness";
import type {
  ShopeeSgCreateCredentialRevision,
} from "./create-prewrite-adapter";
import {
  prepareShopeeSgCreatePrewrite,
  readShopeeSgExactGlobalIdentity,
} from "./create-prewrite-adapter";
import {
  bindShopeeSgTransportBytes,
  parseShopeeSgTransportBody,
} from "./transport-json";
import type {
  ShopeeSgRequirementRemote,
} from "./provider-requirements";

type UnknownRecord = Record<string, unknown>;

export const shopeeSgCreateResumeContract =
  "sellerpilot-shopee-sg-create-resume/1" as const;
export const shopeeSgCreateStageContract =
  "sellerpilot-shopee-sg-create-stage/1" as const;

export type ShopeeSgCreateResumeReceipt = {
  contract: typeof shopeeSgCreateResumeContract;
  sourceJobId: string;
  credentialId: string;
  credentialVersion: number;
  merchantId: string;
  shopId: string;
  requestFingerprint: string;
  globalItemId: string;
  preparedArguments: UnknownRecord;
};

type RequestInput = Parameters<typeof shopeeRequest>[0];
type MerchantRequestInput = Parameters<typeof shopeeMerchantRequest>[0];

export type ShopeeSgRuntimeImageUpload = (
  payload: SecretPayload,
  environment: ExecuteInput["environment"],
  url: string,
  signal: AbortSignal,
  hooks: {
    assertLeaseHealthy: () => Promise<void>;
    beginProviderMutation: () => Promise<void>;
  },
  scene: "normal" | "desc",
) => Promise<string>;

export type ShopeeSgExecuteRuntimeDependencies = {
  shopRequest: (input: RequestInput) => Promise<RemoteResponse>;
  merchantRequest: (input: MerchantRequestInput) => Promise<RemoteResponse>;
  uploadImage: ShopeeSgRuntimeImageUpload;
  wait: (milliseconds: number, signal: AbortSignal) => Promise<void>;
};

const defaultDependencies: ShopeeSgExecuteRuntimeDependencies = {
  shopRequest: shopeeRequest,
  merchantRequest: shopeeMerchantRequest,
  uploadImage: async () => {
    throw new Error("SHOPEE_SG_IMAGE_UPLOAD_UNBOUND");
  },
  wait: async (milliseconds, signal) => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, milliseconds);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    });
  },
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function numericId(value: unknown) {
  const valueText = text(value);
  return /^[1-9][0-9]{0,31}$/u.test(valueText) ? valueText : "";
}

function uuid(value: unknown) {
  const valueText = text(value).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(valueText)
    ? valueText
    : "";
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as UnknownRecord)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stable(item)]));
}

function credentialRevision(input: ExecuteInput): ShopeeSgCreateCredentialRevision {
  const hooks = input.providerMutationHooks;
  const lineage = record(input.arguments[shopeeSgCreateExecutionLineageArgument]);
  const credentialId = uuid(hooks?.gatewayCredentialId);
  const lineageCredentialId = uuid(lineage.credentialId);
  const credentialVersion = Number(lineage.credentialVersion);
  const merchantId = numericId(input.payload.merchant_id);
  const shopId = numericId(input.shopeeShopCredential?.shop_id);
  if (!hooks || lineage.contract !== shopeeSgCreateExecutionLineageContract
      || !credentialId || lineageCredentialId !== credentialId
      || !Number.isSafeInteger(credentialVersion) || credentialVersion < 1
      || numericId(lineage.targetId) !== shopId || lineage.marketCode !== "SG"
      || !merchantId || !shopId) {
    throw new Error("SHOPEE_SG_EXECUTE_LINEAGE_INVALID");
  }
  const credentialSnapshotSha256 = createHash("sha256")
    .update(JSON.stringify(stable({
      credentialId,
      credentialVersion,
      merchantCredential: input.payload,
      shopCredential: input.shopeeShopCredential,
    })), "utf8")
    .digest("hex");
  return {
    credentialId,
    credentialVersion,
    credentialSnapshotSha256,
    merchantId,
    shopId,
    region: "SG",
  };
}

function exactResumeReceipt(
  value: unknown,
  input: ExecuteInput,
  credential: ShopeeSgCreateCredentialRevision,
): ShopeeSgCreateResumeReceipt | null {
  if (value === null || value === undefined) return null;
  const row = record(value);
  const preparedArguments = record(row.preparedArguments);
  const requestFingerprint = text(input.arguments.publicationExpectedFingerprint);
  const receipt: ShopeeSgCreateResumeReceipt = {
    contract: shopeeSgCreateResumeContract,
    sourceJobId: uuid(row.sourceJobId),
    credentialId: uuid(row.credentialId),
    credentialVersion: Number(row.credentialVersion),
    merchantId: numericId(row.merchantId),
    shopId: numericId(row.shopId),
    requestFingerprint: text(row.requestFingerprint),
    globalItemId: numericId(row.globalItemId),
    preparedArguments,
  };
  if (row.contract !== shopeeSgCreateResumeContract
      || !receipt.sourceJobId
      || receipt.credentialId !== credential.credentialId
      || receipt.credentialVersion !== credential.credentialVersion
      || receipt.merchantId !== credential.merchantId
      || receipt.shopId !== credential.shopId
      || !/^[a-f0-9]{64}$/u.test(requestFingerprint)
      || receipt.requestFingerprint !== requestFingerprint
      || !receipt.globalItemId || !Object.keys(preparedArguments).length) {
    throw new Error("SHOPEE_SG_STORED_RESUME_INVALID");
  }
  return receipt;
}

function providerStep(name: string, remote: ShopeeSgRequirementRemote) {
  const status = Number((remote.response as { status?: unknown }).status);
  return {
    name,
    ok: remote.response.ok && !text(record(remote.data).error),
    status: Number.isInteger(status) ? status : remote.response.ok ? 200 : 502,
    data: record(remote.data),
  };
}

function publishedLinks(remote: ShopeeSgRequirementRemote, globalItemId: string, shopId: string) {
  const response = record(record(remote.data).response);
  const rows = Array.isArray(response.published_item)
    ? response.published_item.map(record)
    : [];
  return rows.filter((row) => (
    numericId(row.global_item_id ?? globalItemId) === globalItemId
      && numericId(row.shop_id) === shopId
      && numericId(row.item_id)
  ));
}

function forbiddenBrowserResume(argumentsValue: UnknownRecord) {
  return [
    "globalItemId",
    "publishTaskId",
    "recoverPublished",
    "resumeOnly",
    "sellerpilotShopeeSgResumeGlobalItemId",
  ].some((key) => Object.hasOwn(argumentsValue, key));
}

type CompletedStage = ShopeeSgCreateStageInput & { outputId: string };

function exactStageState(value: unknown) {
  const row = record(value);
  const completedRows = Array.isArray(row.completedStages)
    ? row.completedStages.map(record)
    : [];
  const completed = new Map<number, CompletedStage>();
  for (const stageRow of completedRows) {
    const sequence = Number(stageRow.sequence);
    const stage = text(stageRow.stage) as CompletedStage["stage"];
    const preparedPayloadSha256 = text(stageRow.preparedPayloadSha256);
    const outputId = text(stageRow.outputId);
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 10
        || !["image-upload", "global-item-create", "local-publish"].includes(stage)
        || !/^[a-f0-9]{64}$/u.test(preparedPayloadSha256) || !outputId
        || completed.has(sequence)) {
      throw new Error("SHOPEE_SG_STAGE_STATE_INVALID");
    }
    completed.set(sequence, {
      sequence,
      stage,
      preparedPayloadSha256,
      outputId,
      ...(text(stageRow.sourceUrl) ? { sourceUrl: text(stageRow.sourceUrl) } : {}),
      ...(text(stageRow.sourceSha256) ? { sourceSha256: text(stageRow.sourceSha256) } : {}),
      ...(numericId(stageRow.globalItemId)
        ? { globalItemId: numericId(stageRow.globalItemId) }
        : {}),
    });
  }
  const nextSequence = Number(row.nextSequence);
  const startedRow = record(row.startedStage);
  let started: ShopeeSgCreateStageInput | null = null;
  if (Object.keys(startedRow).length) {
    const sequence = Number(startedRow.sequence);
    const stage = text(startedRow.stage) as ShopeeSgCreateStageInput["stage"];
    const preparedPayloadSha256 = text(startedRow.preparedPayloadSha256);
    if (!Number.isSafeInteger(sequence) || sequence !== nextSequence
        || !["image-upload", "global-item-create", "local-publish"].includes(stage)
        || !/^[a-f0-9]{64}$/u.test(preparedPayloadSha256)) {
      throw new Error("SHOPEE_SG_STAGE_STATE_INVALID");
    }
    started = {
      sequence,
      stage,
      preparedPayloadSha256,
      ...(text(startedRow.sourceUrl) ? { sourceUrl: text(startedRow.sourceUrl) } : {}),
      ...(text(startedRow.sourceSha256)
        ? { sourceSha256: text(startedRow.sourceSha256) }
        : {}),
      ...(numericId(startedRow.globalItemId)
        ? { globalItemId: numericId(startedRow.globalItemId) }
        : {}),
    };
  }
  if (row.contract !== shopeeSgCreateStageContract || row.status !== "ready"
      || typeof row.genericProviderMutationStarted !== "boolean"
      || !Number.isSafeInteger(nextSequence) || nextSequence < 0 || nextSequence > 11
      || completed.size !== nextSequence) {
    throw new Error("SHOPEE_SG_STAGE_STATE_INVALID");
  }
  return {
    genericProviderMutationStarted: row.genericProviderMutationStarted,
    nextSequence,
    completed,
    started,
  };
}

function sameStage(left: CompletedStage, right: ShopeeSgCreateStageInput) {
  return left.sequence === right.sequence
    && left.stage === right.stage
    && left.preparedPayloadSha256 === right.preparedPayloadSha256
    && (left.sourceUrl ?? "") === (right.sourceUrl ?? "")
    && (left.sourceSha256 ?? "") === (right.sourceSha256 ?? "")
    && (left.globalItemId ?? "") === (right.globalItemId ?? "");
}

function preparedPayloadSha256(argumentsValue: UnknownRecord) {
  const evidence = record(argumentsValue.sellerpilotShopeeSgCreatePrewriteEvidence);
  const digest = text(evidence.payloadSha256);
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw new Error("SHOPEE_SG_STAGE_PREPARED_DIGEST_INVALID");
  }
  return digest;
}

/**
 * Owns the strict SG create/resume provider sequence used by executeShopee.
 * A resume identity can enter only through the server hook backed by the
 * immutable Global-create response plus exact official readback receipt.
 */
export async function executeShopeeSgCreateRuntime(
  input: ExecuteInput,
  dependencies: ShopeeSgExecuteRuntimeDependencies = defaultDependencies,
): Promise<ChannelOperationResult> {
  if (input.channel !== "shopee" || input.operation !== "listing.create"
      || !input.shopeeShopCredential || !input.providerMutationHooks
      || !input.providerMutationHooks.readShopeeSgCreateStageState
      || !input.providerMutationHooks.beginShopeeSgCreateStage
      || !input.providerMutationHooks.completeShopeeSgCreateStage
      || !input.providerMutationHooks.readShopeeSgCreateResume
      || !input.providerMutationHooks.recordShopeeSgGlobalCreateReadback) {
    throw new Error("SHOPEE_SG_EXECUTE_RUNTIME_REQUIRED");
  }
  if (forbiddenBrowserResume(input.arguments)) {
    throw new Error("SHOPEE_SG_BROWSER_RESUME_ID_FORBIDDEN");
  }
  const signal = input.signal ?? new AbortController().signal;
  const hooks = input.providerMutationHooks;
  const readStageState = hooks.readShopeeSgCreateStageState;
  const beginStageRpc = hooks.beginShopeeSgCreateStage;
  const completeStageRpc = hooks.completeShopeeSgCreateStage;
  const readStoredResume = hooks.readShopeeSgCreateResume;
  const recordGlobalCreateReadback = hooks.recordShopeeSgGlobalCreateReadback;
  if (!readStageState || !beginStageRpc || !completeStageRpc
      || !readStoredResume || !recordGlobalCreateReadback) {
    throw new Error("SHOPEE_SG_EXECUTE_RUNTIME_REQUIRED");
  }
  const credential = credentialRevision(input);
  const durable = exactStageState(await readStageState());
  if (durable.started?.stage === "image-upload") {
    throw new Error("SHOPEE_SG_IMAGE_STAGE_RESPONSE_UNCERTAIN");
  }
  const beginStage = async (stage: ShopeeSgCreateStageInput) => {
    const completed = durable.completed.get(stage.sequence);
    if (completed) {
      if (!sameStage(completed, stage)) {
        throw new Error("SHOPEE_SG_STAGE_REPLAY_MISMATCH");
      }
      return completed.outputId;
    }
    if (durable.nextSequence !== stage.sequence) {
      throw new Error("SHOPEE_SG_STAGE_SEQUENCE_INVALID");
    }
    if (durable.started) {
      throw new Error("SHOPEE_SG_STAGE_RESPONSE_UNCERTAIN");
    }
    if (!durable.genericProviderMutationStarted) {
      await hooks.begin();
      durable.genericProviderMutationStarted = true;
    }
    await hooks.assertLeaseHealthy();
    const begun = record(await beginStageRpc(stage));
    if (begun.contract !== shopeeSgCreateStageContract
        || begun.status !== "started"
        || Number(begun.sequence) !== stage.sequence) {
      throw new Error("SHOPEE_SG_STAGE_BEGIN_INVALID");
    }
    await hooks.assertLeaseHealthy();
    return undefined;
  };
  const completeStage = async (completion: ShopeeSgCreateStageCompletion) => {
    const completed = durable.completed.get(completion.sequence);
    if (completed) {
      if (!sameStage(completed, completion)
          || completed.outputId !== completion.outputId) {
        throw new Error("SHOPEE_SG_STAGE_REPLAY_MISMATCH");
      }
      return;
    }
    await hooks.assertLeaseHealthy();
    const result = record(await completeStageRpc(completion));
    if (result.contract !== shopeeSgCreateStageContract
        || result.status !== "completed"
        || Number(result.sequence) !== completion.sequence) {
      throw new Error("SHOPEE_SG_STAGE_COMPLETE_INVALID");
    }
    durable.completed.set(completion.sequence, {
      sequence: completion.sequence,
      stage: completion.stage,
      preparedPayloadSha256: completion.preparedPayloadSha256,
      outputId: completion.outputId,
      ...(completion.sourceUrl ? { sourceUrl: completion.sourceUrl } : {}),
      ...(completion.sourceSha256 ? { sourceSha256: completion.sourceSha256 } : {}),
      ...(completion.globalItemId ? { globalItemId: completion.globalItemId } : {}),
    });
    durable.nextSequence = completion.sequence + 1;
    await hooks.assertLeaseHealthy();
  };
  const readCurrentCredential = async () => credential;
  const observations: Array<{ name: string; remote: ShopeeSgRequirementRemote }> = [];
  const merchantGet = async (path: string, query: URLSearchParams) => {
    await hooks.assertLeaseHealthy();
    const remote = await dependencies.merchantRequest({
      payload: input.payload,
      environment: input.environment,
      method: "GET",
      path,
      query,
    });
    await hooks.assertLeaseHealthy();
    return remote;
  };
  const merchantPostRead = async (path: string, body: UnknownRecord) => {
    await hooks.assertLeaseHealthy();
    const remote = await dependencies.merchantRequest({
      payload: input.payload,
      environment: input.environment,
      method: "POST",
      path,
      body,
    });
    await hooks.assertLeaseHealthy();
    return remote;
  };
  const shopGet = async (path: string, query: URLSearchParams) => {
    await hooks.assertLeaseHealthy();
    const remote = await dependencies.shopRequest({
      payload: input.shopeeShopCredential as SecretPayload,
      environment: input.environment,
      method: "GET",
      path,
      query,
    });
    await hooks.assertLeaseHealthy();
    return remote;
  };
  const readers = { merchantGet, merchantPost: merchantPostRead, shopGet };
  const prepareProviderImages = (argumentsValue: UnknownRecord) => (
    prepareShopeeSgProviderImagesOnly({
      argumentsValue,
      dependencies: {
        merchantGet,
        shopGet,
        assertLeaseHealthy: hooks.assertLeaseHealthy,
        uploadImage: async (url, scene, identity) => {
          const stage: ShopeeSgCreateStageInput = {
            sequence: identity.index,
            stage: "image-upload",
            preparedPayloadSha256: preparedPayloadSha256(argumentsValue),
            sourceUrl: url,
            sourceSha256: identity.sourceSha256,
          };
          const imageId = await dependencies.uploadImage(
            input.shopeeShopCredential as SecretPayload,
            input.environment,
            url,
            signal,
            {
              assertLeaseHealthy: hooks.assertLeaseHealthy,
              beginProviderMutation: () => beginStage(stage),
            },
            scene,
          );
          await completeStage({
            ...stage,
            outputId: imageId,
            result: { imageId },
          });
          return imageId;
        },
      },
    })
  );
  const readGlobalItem = async (globalItemId: string) => {
    const remote = await merchantGet(
      "/api/v2/global_product/get_global_item_info",
      new URLSearchParams({ global_item_id_list: globalItemId }),
    );
    observations.push({ name: "global-item-readback", remote });
    return remote;
  };
  const createLocalPublish = async (body: UnknownRecord) => {
    const intent = listingPublicationIntentFromArguments(input.arguments);
    if (!intent) throw new Error("SHOPEE_VERIFIED_PUBLISH_ARGUMENTS_REQUIRED");
    const transport = bindShopeeSgTransportBytes(
      shopeeGlobalPublishArgumentsForIntent(body, intent),
    );
    const remote = await dependencies.merchantRequest({
      payload: input.payload,
      environment: input.environment,
      method: "POST",
      path: "/api/v2/global_product/create_publish_task",
      body: parseShopeeSgTransportBody(transport),
    });
    observations.push({ name: "publish-task-create", remote });
    return remote;
  };
  const readExistingLocalPublication = async ({
    globalItemId,
    shopId,
  }: { globalItemId: string; shopId: string }) => {
    const publishedRemote = await merchantGet(
      "/api/v2/global_product/get_published_list",
      new URLSearchParams({ global_item_id: globalItemId }),
    );
    const links = publishedLinks(publishedRemote, globalItemId, shopId);
    if (!publishedRemote.response.ok || text(record(publishedRemote.data).error)) {
      throw new Error("SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID");
    }
    if (links.length === 0) return null;
    if (links.length !== 1) throw new Error("SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID");
    const localRemote = await shopGet(
      "/api/v2/product/get_item_base_info",
      new URLSearchParams({ item_id_list: numericId(links[0].item_id) }),
    );
    observations.push(
      { name: "published-item-readback", remote: publishedRemote },
      { name: "local-item-readback", remote: localRemote },
    );
    return { publishedRemote, localRemote };
  };
  const readLocalPublication = async ({
    globalItemId,
    publishTaskId,
    shopId,
  }: { globalItemId: string; publishTaskId: string; shopId: string }): Promise<ShopeeSgLocalPublicationReadback> => {
    let terminal = false;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (attempt > 0) await dependencies.wait(2_000, signal);
      const taskRemote = await merchantGet(
        "/api/v2/global_product/get_publish_task_result",
        new URLSearchParams({ publish_task_id: publishTaskId }),
      );
      observations.push({ name: `publish-task-result-${attempt + 1}`, remote: taskRemote });
      const response = record(record(taskRemote.data).response);
      const status = text(response.publish_status ?? response.status).toUpperCase();
      if (!taskRemote.response.ok || text(record(taskRemote.data).error)
          || ["FAILED", "FAIL"].includes(status)) {
        throw new Error("SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID");
      }
      if (["SUCCESS", "COMPLETED", "DONE"].includes(status)) {
        terminal = true;
        break;
      }
    }
    if (!terminal) throw new Error("SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID");
    const publishedRemote = await merchantGet(
      "/api/v2/global_product/get_published_list",
      new URLSearchParams({ global_item_id: globalItemId }),
    );
    const links = publishedLinks(publishedRemote, globalItemId, shopId);
    if (links.length !== 1) throw new Error("SHOPEE_SG_LOCAL_PUBLISH_READBACK_INVALID");
    const localRemote = await shopGet(
      "/api/v2/product/get_item_base_info",
      new URLSearchParams({ item_id_list: numericId(links[0].item_id) }),
    );
    observations.push(
      { name: "published-item-readback", remote: publishedRemote },
      { name: "local-item-readback", remote: localRemote },
    );
    return { publishedRemote, localRemote };
  };

  await hooks.assertLeaseHealthy();
  let receipt = exactResumeReceipt(
    await readStoredResume(),
    input,
    credential,
  );
  if (!receipt && durable.started?.stage === "global-item-create") {
    const body = record(input.arguments.body);
    const globalItemId = await readShopeeSgExactGlobalIdentity({
      merchantRead: merchantGet,
      sku: text(body.global_item_sku),
      globalName: text(body.global_item_name),
    });
    const reconciled = await prepareShopeeSgCreatePrewrite({
      argumentsValue: input.arguments,
      credential,
      readCurrentCredential,
      readers,
      resumeGlobalItemId: globalItemId,
      now: new Date(),
    });
    const preparedArguments = await prepareProviderImages(reconciled.argumentsValue);
    const readbackRemote = await readGlobalItem(globalItemId);
    assertShopeeSgExactGlobalReadback({
      remote: readbackRemote,
      globalItemId,
      expectedBody: record(preparedArguments.body),
    });
    await recordGlobalCreateReadback({
      globalItemId,
      createResponse: {
        error: "",
        response: { global_item_id: globalItemId },
        sellerpilotReconciliation: "official-exact-global-readback",
      },
      readbackResponse: record(readbackRemote.data),
      preparedArguments,
    });
    durable.completed.set(9, {
      sequence: 9,
      stage: "global-item-create",
      preparedPayloadSha256: preparedPayloadSha256(preparedArguments),
      globalItemId,
      outputId: globalItemId,
    });
    durable.nextSequence = 10;
    durable.started = null;
    receipt = exactResumeReceipt(
      await readStoredResume(),
      input,
      credential,
    );
    if (!receipt) throw new Error("SHOPEE_SG_GLOBAL_RECONCILIATION_RECEIPT_MISSING");
  }
  if (durable.started?.stage === "local-publish" && !receipt) {
    throw new Error("SHOPEE_SG_LOCAL_RECONCILIATION_RECEIPT_MISSING");
  }
  const sharedDependencies = {
    readers,
    readCurrentCredential,
    assertLeaseHealthy: hooks.assertLeaseHealthy,
    beginProviderMutation: async (
      stage: ShopeeSgCreateMutationStage,
      argumentsValue: UnknownRecord,
    ) => {
      await hooks.assertLeaseHealthy();
      const sequence = stage === "global-item-create" ? 9 : 10;
      const globalItemId = stage === "local-publish"
        ? numericId(argumentsValue.globalItemId)
        : "";
      await beginStage({
        sequence,
        stage,
        preparedPayloadSha256: preparedPayloadSha256(argumentsValue),
        ...(globalItemId ? { globalItemId } : {}),
      });
      await hooks.assertLeaseHealthy();
    },
    completeProviderMutation: async (
      stage: ShopeeSgCreateMutationStage,
      argumentsValue: UnknownRecord,
      resultValue: {
        globalItemId: string;
        outputId: string;
        result: UnknownRecord;
      },
    ) => {
      const sequence = stage === "global-item-create" ? 9 : 10;
      const globalItemId = numericId(resultValue.globalItemId);
      await completeStage({
        sequence,
        stage,
        preparedPayloadSha256: preparedPayloadSha256(argumentsValue),
        ...(globalItemId ? { globalItemId } : {}),
        outputId: text(resultValue.outputId),
        result: record(resultValue.result),
      });
    },
    prepareProviderImages,
    readGlobalItem,
    createLocalPublish,
    readLocalPublication,
  };
  const execution = receipt
    ? await executeShopeeSgLocalResumeOrchestration({
      argumentsValue: receipt.preparedArguments,
      credential,
      globalItemId: receipt.globalItemId,
      dependencies: {
        ...sharedDependencies,
        readExistingLocalPublication,
      },
    })
    : await executeShopeeSgCreateOrchestration({
      argumentsValue: input.arguments,
      credential,
      dependencies: {
        ...sharedDependencies,
        createGlobalItem: async (body) => {
          const transport = bindShopeeSgTransportBytes(shopeeGlobalCreateBody(body, true));
          const remote = await dependencies.merchantRequest({
            payload: input.payload,
            environment: input.environment,
            method: "POST",
            path: "/api/v2/global_product/add_global_item",
            body: parseShopeeSgTransportBody(transport),
          });
          observations.push({ name: "global-item-create", remote });
          return remote;
        },
        recordGlobalCreateReadback: async ({
          globalItemId,
          createRemote,
          readbackRemote,
          preparedArguments,
        }) => {
          await recordGlobalCreateReadback({
            globalItemId,
            createResponse: record(createRemote.data),
            readbackResponse: record(readbackRemote.data),
            preparedArguments,
          });
          durable.completed.set(9, {
            sequence: 9,
            stage: "global-item-create",
            preparedPayloadSha256: preparedPayloadSha256(preparedArguments),
            globalItemId,
            outputId: globalItemId,
          });
          durable.nextSequence = 10;
        },
      },
    });
  const preparedArguments: UnknownRecord | undefined = "argumentsValue" in execution
    ? execution.argumentsValue
    : receipt?.preparedArguments;
  if (!preparedArguments) throw new Error("SHOPEE_SG_PREPARED_ARGUMENTS_MISSING");
  // This value is injected only into the in-process post-publish verifier.
  // It never comes from request arguments and is not part of the stored
  // prepared payload, so browser input cannot select a Global identity.
  hooks.captureShopeeSgPreparedArguments?.({
    ...preparedArguments,
    globalItemId: execution.globalItemId,
  });
  const steps = observations.map(({ name, remote }) => providerStep(name, remote));
  if (!steps.length) throw new Error("SHOPEE_SG_PROVIDER_READBACK_MISSING");
  return {
    ok: true,
    channel: "shopee",
    operation: "listing.create",
    steps,
    remoteId: execution.localItemId,
    publicationIntent: listingPublicationIntentFromArguments(preparedArguments),
    ...(preparedArguments.publicationStateContract === listingRemoteStateContractVersion
      ? { publicationStateContract: listingRemoteStateContractVersion }
      : {}),
    shopeeSgCreateCompletionMap: {
      sameTransactionAsLocalPublish: true,
      globalItemId: execution.globalItemId,
      localItemId: execution.localItemId,
    },
    safeMessage: receipt
      ? "Shopee 저장 Global 계보에서 SG 로컬 상품을 공식 조회·재개했습니다."
      : "Shopee SG Global 생성과 로컬 발행의 공식 조회를 완료했습니다.",
  };
}
