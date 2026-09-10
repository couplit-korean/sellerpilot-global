import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateAdminRequest, isAdminApiError } from "../../../../lib/admin-api";
import { resolveRuntimeReleaseIdentity, type RuntimeReleaseIdentity } from "../../../../lib/internal-scheduler-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "cache-control": "no-store" } as const;
const releaseShaSchema = z.string().regex(/^[a-f0-9]{40}$/).nullable();

const publicationChannels = [
  "qoo10",
  "shopee",
  "lazada",
  "coupang",
  "elevenst",
  "smartstore",
  "ebay",
  "temu",
] as const;

const scopedPublicationChannels = ["qoo10", "coupang", "smartstore"] as const;

const channelLabels: Record<(typeof publicationChannels)[number], string> = {
  qoo10: "Qoo10",
  shopee: "Shopee",
  lazada: "Lazada",
  coupang: "쿠팡",
  elevenst: "11번가",
  smartstore: "네이버 스마트스토어",
  ebay: "eBay",
  temu: "Temu",
};

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("attest_adapter"),
    channel: z.enum(publicationChannels),
  }).strict(),
  z.object({ action: z.literal("attest_rechecker") }).strict(),
  z.object({ action: z.literal("open_gate") }).strict(),
  z.object({
    action: z.literal("open_channel_gate"),
    channel: z.enum(scopedPublicationChannels),
  }).strict(),
  z.object({ action: z.literal("close_gate") }).strict(),
]);

const gateStatusSchema = z.object({
  contract: z.literal("verified_publication_release_gate_v1"),
  open: z.boolean(),
  state: z.enum(["open", "closed"]),
  effectiveOpen: z.boolean(),
  openedAt: z.string().nullable(),
  updatedAt: z.string(),
  openedRelease: releaseShaSchema,
  openedChannel: z.enum(scopedPublicationChannels).nullable(),
  attestedRelease: releaseShaSchema,
  activeRuntimeRelease: releaseShaSchema,
  publicationAdaptersReady: z.number().int().min(0).max(publicationChannels.length),
  publicationRecheckerReady: z.boolean(),
  publicationReleaseConsistent: z.boolean(),
  runtimeReleaseMatches: z.boolean(),
  orphanPendingReviews: z.number().int().nonnegative(),
  listingMutationsRunning: z.number().int().nonnegative(),
  queuedOrRunning: z.number().int().nonnegative(),
  reconciliationRequired: z.number().int().nonnegative(),
  qoo10AdapterReady: z.boolean(),
  qoo10AttestedRelease: releaseShaSchema,
  qoo10ReleaseConsistent: z.boolean(),
  qoo10RuntimeReleaseMatches: z.boolean(),
  qoo10ReviewViolations: z.number().int().nonnegative(),
  qoo10QueuedOrRunning: z.number().int().nonnegative(),
  qoo10ReconciliationRequired: z.number().int().nonnegative(),
  qoo10EffectiveOpen: z.boolean(),
  coupangAdapterReady: z.boolean(),
  coupangAttestedRelease: releaseShaSchema,
  coupangReleaseConsistent: z.boolean(),
  coupangRuntimeReleaseMatches: z.boolean(),
  coupangReviewViolations: z.number().int().nonnegative(),
  coupangQueuedOrRunning: z.number().int().nonnegative(),
  coupangReconciliationRequired: z.number().int().nonnegative(),
  coupangEffectiveOpen: z.boolean(),
  smartstoreAdapterReady: z.boolean(),
  smartstoreAttestedRelease: releaseShaSchema,
  smartstoreReleaseConsistent: z.boolean(),
  smartstoreRuntimeReleaseMatches: z.boolean(),
  smartstoreReviewViolations: z.number().int().nonnegative(),
  smartstoreQueuedOrRunning: z.number().int().nonnegative(),
  smartstoreReconciliationRequired: z.number().int().nonnegative(),
  smartstoreEffectiveOpen: z.boolean(),
}).superRefine((value, context) => {
  if (value.state !== (value.open ? "open" : "closed")) {
    context.addIssue({ code: "custom", message: "listing release gate state mismatch" });
  }
  if (value.effectiveOpen && !value.open) {
    context.addIssue({ code: "custom", message: "listing release gate cannot be effective while closed" });
  }
  if (value.effectiveOpen && value.openedChannel !== null) {
    context.addIssue({ code: "custom", message: "global listing release gate cannot have a channel scope" });
  }
  if (
    value.qoo10EffectiveOpen
    && (!value.open || (value.openedChannel !== "qoo10" && value.openedChannel !== null))
  ) {
    // openedChannel is null for the eight-channel global gate, which also
    // covers Qoo10; it is "qoo10" only for the exact-SHA Qoo10-only gate.
    // qoo10EffectiveOpen is legitimately true in both cases.
    context.addIssue({ code: "custom", message: "Qoo10 release gate scope mismatch" });
  }
  if (
    value.coupangEffectiveOpen
    && (!value.open || (value.openedChannel !== "coupang" && value.openedChannel !== null))
  ) {
    // A null scope is the global gate, which covers Coupang after every
    // channel passes. A "coupang" scope grants only the Coupang boundary.
    context.addIssue({ code: "custom", message: "Coupang release gate scope mismatch" });
  }
  if (
    value.smartstoreEffectiveOpen
    && (!value.open || (value.openedChannel !== "smartstore" && value.openedChannel !== null))
  ) {
    context.addIssue({ code: "custom", message: "SmartStore release gate scope mismatch" });
  }
  if (!value.open && value.openedChannel !== null) {
    context.addIssue({ code: "custom", message: "closed listing release gate cannot retain a channel scope" });
  }
});

type GateStatus = z.infer<typeof gateStatusSchema>;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

function withNoStore(response: NextResponse) {
  response.headers.set("cache-control", "no-store");
  return response;
}

function publicRuntimeRelease(identity: RuntimeReleaseIdentity) {
  return identity.status === "valid"
    ? { status: "valid" as const, currentRelease: identity.release }
    : { status: "unavailable" as const, currentRelease: null };
}

function readyForOpen(gate: GateStatus, currentRelease: string) {
  return gate.publicationAdaptersReady === publicationChannels.length
    && gate.publicationRecheckerReady
    && gate.publicationReleaseConsistent
    && gate.attestedRelease === currentRelease
    && gate.activeRuntimeRelease === currentRelease
    && gate.runtimeReleaseMatches
    && gate.orphanPendingReviews === 0
    && gate.queuedOrRunning === 0
    && gate.reconciliationRequired === 0;
}

function readyForQoo10Open(gate: GateStatus, currentRelease: string) {
  return gate.qoo10AdapterReady
    && gate.publicationRecheckerReady
    && gate.qoo10ReleaseConsistent
    && gate.qoo10AttestedRelease === currentRelease
    && gate.activeRuntimeRelease === currentRelease
    && gate.qoo10RuntimeReleaseMatches
    && gate.qoo10ReviewViolations === 0
    && gate.qoo10QueuedOrRunning === 0
    && gate.qoo10ReconciliationRequired === 0
    && gate.listingMutationsRunning === 0;
}

function readyForCoupangOpen(gate: GateStatus, currentRelease: string) {
  return gate.coupangAdapterReady
    && gate.publicationRecheckerReady
    && gate.coupangReleaseConsistent
    && gate.coupangAttestedRelease === currentRelease
    && gate.activeRuntimeRelease === currentRelease
    && gate.coupangRuntimeReleaseMatches
    && gate.coupangReviewViolations === 0
    && gate.coupangQueuedOrRunning === 0
    && gate.coupangReconciliationRequired === 0
    && gate.listingMutationsRunning === 0;
}

function readyForSmartstoreOpen(gate: GateStatus, currentRelease: string) {
  return gate.smartstoreAdapterReady
    && gate.publicationRecheckerReady
    && gate.smartstoreReleaseConsistent
    && gate.smartstoreAttestedRelease === currentRelease
    && gate.activeRuntimeRelease === currentRelease
    && gate.smartstoreRuntimeReleaseMatches
    && gate.smartstoreReviewViolations === 0
    && gate.smartstoreQueuedOrRunning === 0
    && gate.smartstoreReconciliationRequired === 0
    && gate.listingMutationsRunning === 0;
}

async function readGateStatus(serviceClient: SupabaseClient) {
  const { data, error } = await serviceClient.rpc("sellerpilot_service_listing_mutation_release_gate_status");
  if (error) return null;
  const parsed = gateStatusSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

function rpcErrorCode(error: unknown) {
  if (!error || typeof error !== "object" || Array.isArray(error)) return "";
  return typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : "";
}

function statusPayload(gate: GateStatus, identity: RuntimeReleaseIdentity) {
  const runtimeRelease = publicRuntimeRelease(identity);
  return {
    ok: identity.status === "valid",
    runtimeRelease,
    gate,
    readyForOpen: identity.status === "valid" && readyForOpen(gate, identity.release),
    readyForQoo10Open: identity.status === "valid"
      && readyForQoo10Open(gate, identity.release),
    readyForCoupangOpen: identity.status === "valid"
      && readyForCoupangOpen(gate, identity.release),
    readyForSmartstoreOpen: identity.status === "valid"
      && readyForSmartstoreOpen(gate, identity.release),
  };
}

async function readGateStatusOrTimeout(serviceClient: Parameters<typeof readGateStatus>[0], timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readGateStatus(serviceClient),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request, {
    timeoutMs: 30_000,
    verifyAsymmetricClaimsLocally: true,
  });
  if (isAdminApiError(admin)) return withNoStore(admin);

  const identity = resolveRuntimeReleaseIdentity();
  const gate = await readGateStatusOrTimeout(admin.serviceClient, 20_000);
  if (!gate) {
    return json({
      ok: identity.status === "valid",
      code: "listing_release_status_unavailable",
      runtimeRelease: publicRuntimeRelease(identity),
      gate: null,
      readyForOpen: false,
      readyForQoo10Open: false,
      readyForCoupangOpen: false,
      readyForSmartstoreOpen: false,
      message: identity.status === "valid"
        ? "배포 SHA는 확인했습니다. 게이트 상세는 잠시 후 다시 불러옵니다."
        : "게시 릴리스 게이트 상태를 안전하게 확인하지 못했습니다.",
    }, identity.status === "valid" ? 200 : 503);
  }
  if (identity.status !== "valid") {
    return json({
      ...statusPayload(gate, identity),
      code: "runtime_release_unavailable",
      message: "현재 운영 배포 식별자를 확인할 수 없습니다. 게시 게이트는 닫힌 상태로 유지해 주세요.",
    }, 503);
  }
  return json({
    ...statusPayload(gate, identity),
    message: "현재 배포의 게시 릴리스 게이트 상태를 확인했습니다.",
  });
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request, {
    timeoutMs: 30_000,
    verifyAsymmetricClaimsLocally: true,
  });
  if (isAdminApiError(admin)) return withNoStore(admin);

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({
      ok: false,
      code: "invalid_listing_release_action",
      message: "게시 릴리스 관리 요청을 확인하지 못했습니다.",
    }, 400);
  }

  const identity = resolveRuntimeReleaseIdentity();
  if (parsed.data.action !== "close_gate" && identity.status !== "valid") {
    return json({
      ok: false,
      code: "runtime_release_unavailable",
      runtimeRelease: publicRuntimeRelease(identity),
      message: "현재 운영 배포 식별자를 확인할 수 없어 이 작업을 실행하지 않았습니다.",
    }, 503);
  }

  let error: unknown = null;
  let message = "";
  if (parsed.data.action === "attest_adapter") {
    const result = await admin.serviceClient.rpc("sellerpilot_service_set_listing_publication_adapter_ready", {
      p_channel: parsed.data.channel,
      p_ready: true,
      p_release_sha: identity.status === "valid" ? identity.release : null,
    });
    error = result.error;
    message = `${channelLabels[parsed.data.channel]} 게시 어댑터를 현재 배포로 확인했습니다.`;
  } else if (parsed.data.action === "attest_rechecker") {
    const result = await admin.serviceClient.rpc("sellerpilot_service_set_listing_publication_rechecker_ready", {
      p_ready: true,
      p_release_sha: identity.status === "valid" ? identity.release : null,
    });
    error = result.error;
    message = "게시 결과 재조회기를 현재 배포로 확인했습니다.";
  } else if (parsed.data.action === "open_channel_gate") {
    const result = await admin.serviceClient.rpc(
      "sellerpilot_service_set_listing_channel_mutation_release_gate",
      {
        p_channel: parsed.data.channel,
        p_open: true,
        p_release_sha: identity.status === "valid" ? identity.release : null,
      },
    );
    error = result.error;
    message = `현재 배포에서 ${channelLabels[parsed.data.channel]} 상품 작업만 허용했습니다.`;
  } else {
    const result = await admin.serviceClient.rpc("sellerpilot_service_set_listing_mutation_release_gate", {
      p_open: parsed.data.action === "open_gate",
      p_release_sha: parsed.data.action === "open_gate" && identity.status === "valid"
        ? identity.release
        : null,
    });
    error = result.error;
    message = parsed.data.action === "open_gate"
      ? "현재 배포의 게시 릴리스 게이트를 열었습니다."
      : "게시 릴리스 게이트를 닫았습니다.";
  }

  if (error) {
    const preconditionFailure = (
      parsed.data.action === "open_gate"
      || parsed.data.action === "open_channel_gate"
    )
      && ["22023", "55000"].includes(rpcErrorCode(error));
    return json({
      ok: false,
      code: preconditionFailure
        ? "listing_release_gate_preconditions_unmet"
        : "listing_release_update_failed",
      message: preconditionFailure
        ? parsed.data.action === "open_channel_gate"
          ? `${channelLabels[parsed.data.channel]} 어댑터·재조회기·현재 런타임 SHA와 ${channelLabels[parsed.data.channel]} 미처리 작업을 모두 확인한 뒤 다시 열어 주세요.`
          : "8개 어댑터·재조회기·현재 런타임 SHA와 미처리 작업을 모두 확인한 뒤 다시 열어 주세요."
        : "게시 릴리스 상태 변경 결과를 확정하지 못했습니다. 상태를 다시 조회해 주세요.",
    }, preconditionFailure ? 409 : 503);
  }

  const gate = await readGateStatus(admin.serviceClient);
  if (!gate) {
    return json({
      ok: false,
      code: "listing_release_reconciliation_required",
      runtimeRelease: publicRuntimeRelease(identity),
      message: "변경 요청 후 상태를 재조회하지 못했습니다. 같은 작업을 반복하지 말고 현재 상태를 먼저 확인해 주세요.",
    }, 503);
  }

  return json({
    ...statusPayload(gate, identity),
    ok: true,
    message,
  });
}
