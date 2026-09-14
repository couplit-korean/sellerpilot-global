import { readProviderAccountIdentity } from "../../channels/provider-account-identity";
import { exactShopeeTargetStoreBinding, shopeeShopDiscoveryEvidenceFromGatewayResult, type ShopeeCredentialSnapshot } from "./target-lineage-readiness";

type Row = Record<string, unknown>;
type Rpc = (name: string, args: Row) => PromiseLike<{ data: unknown; error: unknown }>;
const record = (value: unknown): Row | null => value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
const fail = () => { throw new Error("SHOPEE_SG_DISCOVERY_RECEIPT_INVALID"); };

export function canRenewExpiredShopeeDiscovery(existing: { status: number; body: Row } | null, expectedJobId?: string) {
  return Boolean(existing && expectedJobId && uuid(expectedJobId) && existing.status === 409
    && existing.body.code === "SHOPEE_TARGET_DISCOVERY_RECEIPT_EXPIRED"
    && existing.body.refreshable === true && existing.body.jobId === expectedJobId);
}

/** Consume only a DB-attested existing exact SG read. Never enqueue/refresh. */
export async function completeExistingShopeeDiscovery(input: {
  actorId: string; snapshot: ShopeeCredentialSnapshot; targetId: string; rpc: Rpc; nowMs?: number;
}): Promise<{ status: number; body: Row } | null> {
  const { snapshot, targetId } = input;
  const read = await input.rpc("sellerpilot_service_read_shopee_sg_discovery", {
    p_actor_id: input.actorId, p_credential_id: snapshot.credentialId,
    p_credential_version: snapshot.version, p_target_id: targetId,
  });
  if (read.error) throw new Error("SHOPEE_SG_DISCOVERY_READ_UNAVAILABLE");
  const value = record(read.data);
  if (value?.contract !== "shopee_sg_discovery_read_v1" || value.actorId !== input.actorId
      || value.credentialId !== snapshot.credentialId || value.credentialVersion !== snapshot.version
      || value.targetId !== targetId || value.marketCode !== "SG") return fail();
  if (value.status === "none") return null;
  const job = record(value.job), request = record(job?.request);
  if (!job || !uuid(job.id) || !uuid(job.ownerId) || job.ownerId !== job.credentialOwnerId
      || job.channel !== "shopee" || job.environment !== "production" || job.operation !== "shops.get"
      || !request || Object.keys(request).length !== 1 || request.shopId !== targetId
      || !Number.isSafeInteger(job.sourceCredentialVersion) || Number(job.sourceCredentialVersion) < 1
      || !(job.sourceCredentialId === snapshot.credentialId && job.sourceCredentialVersion === snapshot.version
        || uuid(job.sourceCredentialId) && job.preparedCredentialId === snapshot.credentialId
          && Number(job.sourceCredentialVersion) < snapshot.version && Number.isFinite(Date.parse(String(job.preparedAt))))) return fail();
  const base = { channel: "shopee", credentialId: snapshot.credentialId, credentialVersion: snapshot.version, targets: [], jobId: job.id };
  if (value.status === "queued" || value.status === "running") return { status: 202, body: {
    ...base, code: "SHOPEE_TARGET_DISCOVERY_PENDING", pending: true,
    message: "기존 숍 조회 작업이 처리 중입니다. 같은 숍의 상태 확인은 새 조회를 전송하지 않습니다.",
  } };
  if (value.status !== "succeeded") return { status: 409, body: {
    ...base, code: "SHOPEE_TARGET_DISCOVERY_REVIEW_REQUIRED", pending: true,
    message: "앞선 숍 조회 결과를 확인해야 합니다. 새 조회를 중복 전송하지 않았습니다.",
  } };
  const observedAt = String(job.completedAt), timestamp = Date.parse(observedAt), nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(timestamp) || timestamp > nowMs + 5_000) return fail();
  const evidence = shopeeShopDiscoveryEvidenceFromGatewayResult({ result: job.response, requestedTargetId: targetId });
  if (timestamp < nowMs - 10 * 60_000) return { status: 409, body: {
    ...base, code: "SHOPEE_TARGET_DISCOVERY_RECEIPT_EXPIRED", pending: false, refreshable: true,
    message: "기존 숍 조회는 성공했지만 확인 유효시간이 지났습니다. 기존 연결로 최신 숍 정보를 다시 조회할 수 있습니다.",
  } };
  // The reader attests same-owner/subject source and the exact prepared successor;
  // the active snapshot still supplies the existing target/token freshness guard.
  const binding = exactShopeeTargetStoreBinding({
    requestedCredentialId: snapshot.credentialId, requestedTargetId: targetId, requestedMarketCode: "SG",
    before: snapshot, after: snapshot, ...evidence, observedAt, nowMs,
  });
  const identity = readProviderAccountIdentity(snapshot.secretPayload, "shopee");
  if (!identity) return fail();
  const stored = await input.rpc("sellerpilot_service_upsert_shopee_market_target_v2", {
    p_owner_id: input.actorId, p_expected_credential_id: snapshot.credentialId,
    p_expected_credential_version: snapshot.version, p_target_id: targetId,
    p_display_name: binding.target.displayName, p_market_code: "SG", p_locale: binding.target.locale,
    p_language: binding.target.language, p_currency: binding.target.currency,
    p_remote_status: binding.target.status ?? "", p_provider_subject: identity.subject,
    p_observed_at: binding.target.verifiedAt,
  });
  const receipt = record(stored.data);
  if (stored.error || receipt?.contractVersion !== 2 || receipt.credentialId !== snapshot.credentialId
      || receipt.credentialVersion !== snapshot.version || receipt.targetId !== targetId || receipt.marketCode !== "SG")
    throw new Error("SHOPEE_TARGET_CACHE_STORE_FAILED");
  return { status: 200, body: { ...base, contractVersion: 2, targets: [{ ...binding.target, credentialVersion: snapshot.version }], storeReceipt: receipt } };
}
