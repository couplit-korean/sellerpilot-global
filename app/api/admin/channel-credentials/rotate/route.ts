import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requiredCredentialKeys, type ActiveChannelKey } from "../../../../../lib/channels/catalog";
import {
  attestTemuCredentialIdentityForSave,
  hasTemuAccountIdentityFields,
  temuAccountIdentityContract,
  temuAccountIdentityEndpointHost,
  temuAccountIdentityPayloadKeys,
  temuCredentialReadinessRequiredApiScopes,
  withoutTemuAccountIdentityFields,
} from "../../../../../lib/product-registration/temu/account-identity";
import {
  temuCredentialIdentityEnvelopeSchema,
  temuCredentialPayloadFingerprintSha256,
  verifyTemuCredentialIdentityAttestation,
} from "../../../../../lib/product-registration/temu/credential-identity-attestation";
import { supabasePublishableKey, supabaseUrl } from "../../../../../lib/supabase/config";

export const runtime = "nodejs";

const requestSchema = z.object({
  credentialId: z.string().uuid().optional(),
  credentialVersion: z.number().int().positive().optional(),
  channel: z.enum(["qoo10", "coupang", "elevenst", "smartstore", "temu", "tracx"]),
  environment: z.enum(["sandbox", "production"]),
  secretPayload: z.record(z.string(), z.string().trim().max(8_000)),
  expiresAt: z.string().datetime().nullable(),
  rotationDays: z.number().int().min(1).max(365),
  warningDays: z.number().int().min(1).max(180),
  graceDays: z.number().int().min(0).max(30),
  // Temu only. Signed on the machine that owns the allowlisted address, because
  // Temu answers NOT_IN_IP_WHITE_LIST to every other caller.
  localIdentityAttestation: temuCredentialIdentityEnvelopeSchema.optional(),
});

function temuCredentialAttestationPublicKey() {
  const publicKeyPem = process.env.TEMU_CREDENTIAL_ATTESTATION_PUBLIC_KEY_PEM
    ?.replaceAll("\\n", "\n").trim();
  const keyId = process.env.TEMU_CREDENTIAL_ATTESTATION_KEY_ID?.trim();
  return publicKeyPem && keyId ? { publicKeyPem, keyId } : null;
}

type SecretPayload = Record<string, unknown>;

function hasText(payload: SecretPayload, key: string) {
  return typeof payload[key] === "string" && payload[key].trim().length > 0;
}

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? "";
  if (!token) return NextResponse.json({ message: "로그인이 필요합니다." }, { status: 401 });
  if (!supabaseUrl || !supabasePublishableKey || !secretKey) {
    return NextResponse.json({ message: "서버 보안 연결이 완료되지 않았습니다." }, { status: 503 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ message: "키 교체 요청 형식이 올바르지 않습니다." }, { status: 400 });

  const userClient = createClient(supabaseUrl, supabasePublishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: userData, error: userError }, { data: isAdmin, error: adminError }, { data: credentialRows, error: credentialError }] = await Promise.all([
    userClient.auth.getUser(token),
    userClient.rpc("sellerpilot_is_admin"),
    userClient.rpc("sellerpilot_list_credentials"),
  ]);
  if (userError || !userData.user || adminError || credentialError || isAdmin !== true) {
    return NextResponse.json({ message: "관리자 권한이 필요합니다." }, { status: 403 });
  }
  if (parsed.data.channel === "temu"
    && hasTemuAccountIdentityFields(parsed.data.secretPayload)) {
    return NextResponse.json({
      code: "TEMU_ACCOUNT_IDENTITY_FIELDS_SERVER_ONLY",
      message: "Temu 판매자 identity 값은 서버의 공식 서명 조회로만 저장할 수 있습니다.",
    }, { status: 400 });
  }

  const serviceClient = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let nextSecret: SecretPayload = {};
  if (parsed.data.credentialId) {
    const metadata = Array.isArray(credentialRows)
      ? credentialRows.find((row) => row && typeof row === "object" && "id" in row && row.id === parsed.data.credentialId)
      : null;
    if (!metadata || !("channel" in metadata) || metadata.channel !== parsed.data.channel || !("status" in metadata) || metadata.status !== "active") {
      return NextResponse.json({ message: "활성 키와 교체 요청이 일치하지 않습니다." }, { status: 409 });
    }
    const { data, error } = await serviceClient.rpc("sellerpilot_decrypt_credential", { p_credential_id: parsed.data.credentialId });
    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      return NextResponse.json({ message: "기존 키를 안전하게 불러오지 못했습니다." }, { status: 404 });
    }
    nextSecret = parsed.data.channel === "temu"
      ? withoutTemuAccountIdentityFields(data as SecretPayload)
      : data as SecretPayload;
  }
  nextSecret = { ...nextSecret, ...parsed.data.secretPayload };

  const requiredKeys = parsed.data.channel === "tracx"
    ? ["api_key", "webhook_secret"]
    : requiredCredentialKeys(parsed.data.channel as ActiveChannelKey);
  const missing = requiredKeys.filter((key) => !hasText(nextSecret, key));
  if (missing.length) return NextResponse.json({ message: `필수 키 값이 누락됐습니다 · ${missing.join(", ")}` }, { status: 400 });
  if (parsed.data.channel === "tracx" && String(nextSecret.webhook_secret).trim().length < 32) {
    return NextResponse.json({ message: "SmartShip 배송 Webhook 보안 토큰은 32자 이상이어야 합니다." }, { status: 400 });
  }
  if (parsed.data.channel === "smartstore") {
    const tokenType = typeof nextSecret.token_type === "string" ? nextSecret.token_type.trim().toUpperCase() : "SELF";
    if (!["SELF", "SELLER"].includes(tokenType) || (tokenType === "SELLER" && !hasText(nextSecret, "account_id"))) {
      return NextResponse.json({ message: "내 스토어 앱은 SELF, 솔루션 판매자 연동은 SELLER + account_id가 필요합니다." }, { status: 400 });
    }
    nextSecret.token_type = tokenType;
  }
  if (parsed.data.channel === "temu") {
    const localAttestation = parsed.data.localIdentityAttestation;
    let attestedLocally = false;
    try {
      nextSecret = (await attestTemuCredentialIdentityForSave({
        payload: nextSecret,
      })).payload;
    } catch (error) {
      const attestationKey = temuCredentialAttestationPublicKey();
      if (localAttestation && attestationKey) {
        const verified = verifyTemuCredentialIdentityAttestation({
          attestation: localAttestation.attestation,
          signature: localAttestation.signature,
          publicKeyPem: attestationKey.publicKeyPem,
          expectedKeyId: attestationKey.keyId,
          ownerId: userData.user.id,
          payloadFingerprintSha256: temuCredentialPayloadFingerprintSha256(nextSecret),
          requiredScopes: temuCredentialReadinessRequiredApiScopes,
        });
        if (verified) {
          const { attestation } = localAttestation;
          nextSecret = {
            ...nextSecret,
            [temuAccountIdentityPayloadKeys.contract]: temuAccountIdentityContract,
            [temuAccountIdentityPayloadKeys.endpointHost]: temuAccountIdentityEndpointHost,
            [temuAccountIdentityPayloadKeys.mallId]: attestation.mallId,
            [temuAccountIdentityPayloadKeys.regionId]: attestation.regionId,
            [temuAccountIdentityPayloadKeys.mallType]: String(attestation.mallType),
            ...(attestation.semiUniqueId ? {
              [temuAccountIdentityPayloadKeys.semiUniqueId]: attestation.semiUniqueId,
            } : {}),
          };
          attestedLocally = true;
          console.error("[temu-credential] local identity attestation accepted",
            attestation.keyId, attestation.egress.verificationMethod);
        } else {
          console.error("[temu-credential] local identity attestation rejected",
            localAttestation.attestation.keyId);
        }
      }
      if (!attestedLocally) {
        const errorMessage = error
          && typeof error === "object"
          && "message" in error
          && typeof error.message === "string"
          ? error.message
          : "";
        const verification = /^TEMU_ACCOUNT_IDENTITY_[A-Z_]+$/u.test(errorMessage)
          ? errorMessage
          : "TEMU_ACCOUNT_IDENTITY_ATTESTATION_FAILED";
        return NextResponse.json({
          code: verification,
          message: "Temu 운영 토큰의 판매자·지역·권한 identity를 공식 조회로 확인하지 못했습니다.",
        }, { status: 422 });
      }
    }
  }

  const isExactElevenstRotation = parsed.data.channel === "elevenst"
    && Boolean(parsed.data.credentialId);
  const rotation = isExactElevenstRotation
    ? await userClient.rpc("sellerpilot_rotate_elevenst_credential_exact", {
      p_expected_credential_id: parsed.data.credentialId,
      p_expected_version: parsed.data.credentialVersion,
      p_environment: parsed.data.environment,
      p_secret_payload: nextSecret,
      p_expires_at: parsed.data.expiresAt,
      p_rotation_interval_days: parsed.data.rotationDays,
      p_warning_days: parsed.data.warningDays,
      p_grace_days: parsed.data.graceDays,
    })
    : await userClient.rpc("sellerpilot_rotate_credential", {
      p_channel: parsed.data.channel,
      p_environment: parsed.data.environment,
      p_secret_payload: nextSecret,
      p_expires_at: parsed.data.expiresAt,
      p_rotation_interval_days: parsed.data.rotationDays,
      p_warning_days: parsed.data.warningDays,
      p_grace_days: parsed.data.credentialId ? parsed.data.graceDays : 0,
    });
  if (rotation.error) {
    const staleElevenstSource = isExactElevenstRotation
      && /ELEVENST_CREDENTIAL_SOURCE_STALE/u.test(rotation.error.message ?? "");
    return NextResponse.json({
      ...(staleElevenstSource ? { code: "ELEVENST_CREDENTIAL_SOURCE_STALE" } : {}),
      message: staleElevenstSource
        ? "11번가 활성 키가 변경되었습니다. 최신 버전을 다시 불러와 주세요."
        : "키를 Vault에 저장하지 못했습니다.",
    }, { status: staleElevenstSource ? 409 : 500 });
  }

  return NextResponse.json({ message: "키 교체와 Vault 저장이 완료됐습니다." }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
