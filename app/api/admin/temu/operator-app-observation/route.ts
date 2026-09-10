import { createHash, createHmac, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  authenticateAdminRequest,
  isAdminApiError,
} from "../../../../../lib/admin-api";
import {
  temuCollectorAttestationSha256,
  temuSignedCollectorEnvelopeSchema,
  temuVerifiedCollectorSource,
  verifyTemuCollectorAttestation,
} from "../../../../../lib/product-registration/temu/operator-app-observation";
import {
  TEMU_CREATE_APP_GATE_READ_RPC,
} from "../../../../../lib/product-registration/temu/create-authoritative-source-ledger";
import {
  TEMU_AUTHORITATIVE_SOURCE_READ_RPC,
} from "../../../../../lib/product-registration/temu/authoritative-ledger-read-adapter";
import { readProductRegistrationContext } from "../../../../../lib/server-product-registration-context";
import { temuProductRevisionFingerprint } from "../../../../../lib/product-registration/temu/product-revision";
import { temuCollectorUiContractSha256 } from
  "../../../../../lib/product-registration/temu/operator-ui-contract";
import { supabasePublishableKey, supabaseUrl } from
  "../../../../../lib/supabase/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store, max-age=0" };
const challengeSchema = z.object({
  productId: z.string().uuid(),
  credentialId: z.string().uuid(),
}).strict();

function row(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function collectorConfiguration() {
  const publicKeyPem = process.env.TEMU_OPERATOR_ATTESTATION_PUBLIC_KEY_PEM
    ?.replaceAll("\\n", "\n").trim();
  const keyId = process.env.TEMU_OPERATOR_ATTESTATION_KEY_ID?.trim();
  const receiptSecretBase64 = process.env.TEMU_COLLECTOR_DB_RECEIPT_SECRET?.trim();
  const receiptKeyId = process.env.TEMU_COLLECTOR_DB_RECEIPT_KEY_ID?.trim();
  const verifierAccessToken = process.env.TEMU_COLLECTOR_VERIFIER_ACCESS_TOKEN?.trim();
  let receiptSecret: Buffer | null = null;
  try {
    if (receiptSecretBase64?.match(/^[A-Za-z0-9+/]+={0,2}$/u)) {
      const decoded = Buffer.from(receiptSecretBase64, "base64");
      if (decoded.length >= 32) receiptSecret = decoded;
    }
  } catch {
    receiptSecret = null;
  }
  if (!publicKeyPem || !keyId || !receiptSecret || !receiptKeyId
    || !verifierAccessToken || !supabaseUrl || !supabasePublishableKey) return null;
  const signingKeys = [{ publicKeyPem, keyId }];
  const receiptKeys = [{ receiptKeyId, receiptSecret }];
  const graceUntil = Date.parse(process.env.TEMU_OPERATOR_ATTESTATION_PREVIOUS_GRACE_UNTIL ?? "");
  const previousPublicKeyPem = process.env.TEMU_OPERATOR_ATTESTATION_PREVIOUS_PUBLIC_KEY_PEM
    ?.replaceAll("\\n", "\n").trim();
  const previousKeyId = process.env.TEMU_OPERATOR_ATTESTATION_PREVIOUS_KEY_ID?.trim();
  if (previousPublicKeyPem && previousKeyId && graceUntil > Date.now()) {
    signingKeys.push({ publicKeyPem: previousPublicKeyPem, keyId: previousKeyId });
  }
  const receiptGraceUntil = Date.parse(
    process.env.TEMU_COLLECTOR_DB_RECEIPT_PREVIOUS_GRACE_UNTIL ?? "");
  const previousReceiptKeyId = process.env.TEMU_COLLECTOR_DB_RECEIPT_PREVIOUS_KEY_ID?.trim();
  const previousReceiptSecretBase64 = process.env.TEMU_COLLECTOR_DB_RECEIPT_PREVIOUS_SECRET?.trim();
  if (previousReceiptKeyId && previousReceiptSecretBase64
    && receiptGraceUntil > Date.now()) {
    const decoded = Buffer.from(previousReceiptSecretBase64, "base64");
    if (decoded.length >= 32) receiptKeys.push({
      receiptKeyId: previousReceiptKeyId, receiptSecret: decoded,
    });
  }
  return { signingKeys, receiptKeys, verifierAccessToken };
}

function routeReceipt(input: {
  attestationSha256: string;
  signatureSha256: string;
  challengeId: string;
  appId: string;
  receiptKeyId: string;
  secret: Buffer;
}) {
  const material = ["temu_collector_route_receipt_v1", input.attestationSha256,
    input.signatureSha256, input.challengeId, input.appId,
    input.receiptKeyId].join("\n");
  return createHmac("sha256", input.secret).update(material, "utf8").digest("hex");
}

export async function GET(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const url = new URL(request.url);
  const parsed = challengeSchema.safeParse({
    productId: url.searchParams.get("productId"),
    credentialId: url.searchParams.get("credentialId"),
  });
  if (!parsed.success || !collectorConfiguration()) {
    return NextResponse.json({
      code: "TEMU_COLLECTOR_CHALLENGE_UNAVAILABLE",
      message: "Temu collector 서명키 또는 요청 범위를 확인하지 못했습니다.",
    }, { status: 503, headers });
  }
  try {
    const configuration = collectorConfiguration()!;
    const context = await readProductRegistrationContext(admin, parsed.data.productId);
    const productRevisionFingerprint = temuProductRevisionFingerprint(context);
    const nonce = randomBytes(32).toString("base64url");
    const nonceSha256 = createHash("sha256").update(nonce, "utf8").digest("hex");
    const result = await admin.serviceClient.rpc(
      "sellerpilot_service_issue_temu_collector_challenge_v1",
      {
        p_owner_id: admin.user.id,
        p_product_id: parsed.data.productId,
        p_credential_id: parsed.data.credentialId,
        p_product_revision_fingerprint: productRevisionFingerprint,
        p_nonce_sha256: nonceSha256,
        p_expected_key_id: configuration.signingKeys[0].keyId,
        p_receipt_key_id: configuration.receiptKeys[0].receiptKeyId,
      },
    );
    const challenge = row(result.data);
    if (result.error
      || challenge?.contract !== "temu_collector_challenge_v1"
      || typeof challenge.challengeId !== "string"
      || typeof challenge.expiresAt !== "string"
      || typeof challenge.expectedAppId !== "string"
      || !challenge.expectedAppId.trim()) throw new Error("challenge");
    return NextResponse.json({
      ...challenge,
      nonce,
      keyId: configuration.signingKeys[0].keyId,
      receiptKeyId: configuration.receiptKeys[0].receiptKeyId,
      ownerId: admin.user.id,
      productRevisionFingerprint,
    }, { headers });
  } catch {
    return NextResponse.json({
      code: "TEMU_COLLECTOR_CHALLENGE_UNAVAILABLE",
      message: "Temu collector용 일회성 challenge를 발급하지 못했습니다.",
    }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  const admin = await authenticateAdminRequest(request);
  if (isAdminApiError(admin)) return admin;
  const parsed = temuSignedCollectorEnvelopeSchema.safeParse(
    await request.json().catch(() => null),
  );
  const configuration = collectorConfiguration();
  if (!parsed.success || !configuration) {
    return NextResponse.json({
      code: "TEMU_COLLECTOR_ATTESTATION_INVALID",
      message: "서명된 Temu collector envelope를 확인해 주세요.",
    }, { status: 400, headers });
  }
  const { attestation, signature } = parsed.data;
  const signingKey = configuration?.signingKeys.find((key) => key.keyId === attestation.keyId);
  const receiptKey = configuration?.receiptKeys.find(
    (key) => key.receiptKeyId === attestation.receiptKeyId);
  const observedEpoch = Date.parse(attestation.observedAt);
  const now = Date.now();
  if (attestation.ownerId !== admin.user.id
    || attestation.uiContractSha256 !== temuCollectorUiContractSha256
    || observedEpoch > now
    || now - observedEpoch > 5 * 60_000
    || !signingKey || !receiptKey
    || !verifyTemuCollectorAttestation({
      attestation,
      signature,
      publicKeyPem: signingKey.publicKeyPem,
      expectedKeyId: signingKey.keyId,
    })) {
    return NextResponse.json({
      code: "TEMU_COLLECTOR_SIGNATURE_INVALID",
      message: "collector 서명, 소유자 또는 관측시각이 일치하지 않습니다.",
    }, { status: 409, headers });
  }
  try {
    const context = await readProductRegistrationContext(admin, attestation.productId);
    if (temuProductRevisionFingerprint(context)
      !== attestation.productRevisionFingerprint) {
      return NextResponse.json({
        code: "TEMU_COLLECTOR_PRODUCT_REVISION_CHANGED",
        message: "challenge 발급 뒤 상품 revision이 변경됐습니다.",
      }, { status: 409, headers });
    }
    const attestationSha256 = temuCollectorAttestationSha256(attestation);
    const signatureSha256 = createHash("sha256")
      .update(Buffer.from(signature, "base64")).digest("hex");
    const verifierClient = createClient(supabaseUrl, supabasePublishableKey, {
      global: { headers: { Authorization: `Bearer ${configuration.verifierAccessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const verifiedReceipt = await verifierClient.rpc(
      "sellerpilot_verifier_record_temu_collector_receipt_v1",
      {
        p_attestation: attestation,
        p_signature_base64: signature,
        p_attestation_sha256: attestationSha256,
        p_route_receipt_sha256: routeReceipt({
          attestationSha256,
          signatureSha256,
          challengeId: attestation.challengeId,
          appId: attestation.appId,
          receiptKeyId: attestation.receiptKeyId,
          secret: receiptKey.receiptSecret,
        }),
      },
    );
    const receipt = row(verifiedReceipt.data);
    if (verifiedReceipt.error
      || receipt?.contract !== "temu_collector_verified_receipt_v1"
      || typeof receipt.receiptId !== "string") throw new Error("verified-receipt");
    const recorded = await admin.serviceClient.rpc(
      "sellerpilot_service_consume_temu_collector_attestation_v2",
      {
        p_attestation: attestation,
        p_signature_base64: signature,
        p_attestation_sha256: attestationSha256,
        p_verified_receipt_id: receipt.receiptId,
      },
    );
    const result = row(recorded.data);
    if (recorded.error
      || result?.contract !== "temu_verified_collector_record_v1"
      || typeof result.attestationId !== "string"
      || !["allowed", "blocked"].includes(String(result.status))) throw new Error("record");

    const scope = {
      p_owner_id: admin.user.id,
      p_product_id: attestation.productId,
      p_credential_id: attestation.credentialId,
    };
    const [gateResult, sourcesResult] = await Promise.all([
      admin.serviceClient.rpc(TEMU_CREATE_APP_GATE_READ_RPC, scope),
      admin.serviceClient.rpc(TEMU_AUTHORITATIVE_SOURCE_READ_RPC, {
        p_owner_id: admin.user.id,
        p_product_id: attestation.productId,
        p_account_subject: attestation.partnerAccountSubject,
        p_mall_id: attestation.mallId,
        p_region_id: attestation.regionId,
        p_product_revision_fingerprint: attestation.productRevisionFingerprint,
      }),
    ]);
    const gate = row(gateResult.data);
    const sources = row(sourcesResult.data);
    const blocked = result.status === "blocked";
    if (gateResult.error || (!blocked && sourcesResult.error)
      || gate?.contract !== "temu_verified_create_app_gate_v1"
      || gate.collectorAttestationId !== result.attestationId
      || (!blocked && (sources?.contract !== "temu_verified_authoritative_source_bundle_v1"
        || sources.collectorAttestationId !== result.attestationId))) {
      throw new Error("readback");
    }
    return NextResponse.json({
      ok: true,
      source: temuVerifiedCollectorSource,
      attestationId: result.attestationId,
      status: result.status,
      denialCode: result.denialCode ?? null,
      appState: gate.appState,
      complianceState: gate.complianceState,
      verifiedSourceReadback: true,
      providerReadPerformed: false,
      providerWritePerformed: false,
      claimCreated: false,
      jobCreated: false,
    }, { headers });
  } catch {
    return NextResponse.json({
      code: "TEMU_COLLECTOR_ATTESTATION_STORAGE_UNAVAILABLE",
      message: "일회성 challenge 소비와 서명 원장 기록·재조회를 완료하지 못했습니다.",
    }, { status: 503, headers });
  }
}
