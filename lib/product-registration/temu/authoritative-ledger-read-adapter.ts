import { temuReadinessEvidenceMaxAgeMs } from "./create-readiness-builder";
import type {
  TemuAuthoritativeClock,
  TemuAuthoritativeReadDependencies,
  TemuOfficialAppRow,
} from "./authoritative-source-collector";
import type {
  TemuPartnerAppServiceSnapshot,
  TemuSellerShippingServiceSnapshot,
} from "./authoritative-preparation-read-adapter";

export const TEMU_AUTHORITATIVE_SOURCE_READ_RPC =
  "sellerpilot_service_read_temu_verified_authoritative_sources_v1";

export type TemuAuthoritativeSourceRpc = (
  name: typeof TEMU_AUTHORITATIVE_SOURCE_READ_RPC,
  parameters: {
    p_owner_id: string;
    p_product_id: string;
    p_account_subject: string;
    p_mall_id: string;
    p_region_id: string;
    p_product_revision_fingerprint: string;
  },
) => Promise<{
  data: unknown;
  error: { message?: string } | null;
}>;

export type TemuAuthoritativeLedgerReadAdapter = {
  readCurrentAppSnapshot: () => Promise<TemuPartnerAppServiceSnapshot | null>;
  readCurrentShippingSnapshot: () => Promise<TemuSellerShippingServiceSnapshot | null>;
  readGlobalEgressAttestation:
    TemuAuthoritativeReadDependencies["readGlobalEgressAttestation"];
};

export type TemuAuthoritativeLedgerReadErrorCode =
  | "TEMU_AUTHORITATIVE_LEDGER_CONFIGURATION_INVALID"
  | "TEMU_AUTHORITATIVE_LEDGER_UNAVAILABLE"
  | "TEMU_AUTHORITATIVE_LEDGER_CONTRACT_INVALID"
  | "TEMU_AUTHORITATIVE_LEDGER_SCOPE_MISMATCH"
  | "TEMU_AUTHORITATIVE_LEDGER_APP_INVALID"
  | "TEMU_AUTHORITATIVE_LEDGER_SHIPPING_INVALID"
  | "TEMU_AUTHORITATIVE_LEDGER_EGRESS_INVALID";

export class TemuAuthoritativeLedgerReadError extends Error {
  readonly code: TemuAuthoritativeLedgerReadErrorCode;

  constructor(code: TemuAuthoritativeLedgerReadErrorCode) {
    super(code);
    this.name = "TemuAuthoritativeLedgerReadError";
    this.code = code;
  }
}

type CreateTemuAuthoritativeLedgerReadAdapterInput = {
  rpc: TemuAuthoritativeSourceRpc;
  ownerId: string;
  productId: string;
  accountSubject: string;
  mallId: string;
  regionId: string;
  productRevisionFingerprint: string;
  clock: TemuAuthoritativeClock;
};

type ParsedBundle = {
  appSnapshot: TemuPartnerAppServiceSnapshot | null;
  shippingSnapshot: TemuSellerShippingServiceSnapshot | null;
  egressAttestation: Awaited<ReturnType<
    TemuAuthoritativeReadDependencies["readGlobalEgressAttestation"]
  >> | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactUuid(value: unknown) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(value);
}

function positiveIntegerText(value: unknown) {
  return typeof value === "string" && /^[1-9]\d{0,31}$/u.test(value);
}

function accountSubject(value: unknown) {
  return typeof value === "string"
    && /^temu-account:sha256:[a-f0-9]{64}$/u.test(value);
}

function fingerprint(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function evidenceDigest(value: unknown) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function positiveRevision(value: unknown) {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value > 0;
}

function observedEpoch(value: unknown, nowEpochMs: number) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed)
    && parsed <= nowEpochMs
    && nowEpochMs - parsed <= temuReadinessEvidenceMaxAgeMs
    ? parsed
    : null;
}

function exactOptionalText(value: unknown, maxLength: number) {
  return value === null
    || (typeof value === "string"
      && value === value.trim()
      && value.length > 0
      && value.length <= maxLength
      && !/\p{Cc}/u.test(value));
}

function appRows(value: unknown): TemuOfficialAppRow[] | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const rows: TemuOfficialAppRow[] = [];
  for (const item of value) {
    const row = record(item);
    if (!row
      || typeof row.appId !== "string"
      || row.appId !== row.appId.trim()
      || row.appId.length < 1
      || row.appId.length > 256
      || !["active", "inactive", "unknown"].includes(String(row.state))
      || !["approved", "rejected", "reviewing", "unknown"]
        .includes(String(row.complianceState))
      || !exactOptionalText(row.rejectionReason, 1_000)) {
      return null;
    }
    rows.push({
      appId: row.appId,
      state: row.state as TemuOfficialAppRow["state"],
      complianceState:
        row.complianceState as TemuOfficialAppRow["complianceState"],
      rejectionReason: row.rejectionReason as string | null,
    });
  }
  return rows;
}

function envelopeValid(value: Record<string, unknown>, nowEpochMs: number) {
  return positiveRevision(value.sourceRevision)
    && evidenceDigest(value.evidenceSha256)
    && observedEpoch(value.observedAt, nowEpochMs) !== null;
}

export function createTemuAuthoritativeLedgerReadAdapter(
  input: CreateTemuAuthoritativeLedgerReadAdapterInput,
): TemuAuthoritativeLedgerReadAdapter {
  if (!exactUuid(input.ownerId)
    || !exactUuid(input.productId)
    || !accountSubject(input.accountSubject)
    || !positiveIntegerText(input.mallId)
    || !positiveIntegerText(input.regionId)
    || !fingerprint(input.productRevisionFingerprint)) {
    throw new TemuAuthoritativeLedgerReadError(
      "TEMU_AUTHORITATIVE_LEDGER_CONFIGURATION_INVALID",
    );
  }
  const now = input.clock.nowEpochMs;
  let pending: Promise<ParsedBundle> | null = null;

  async function load(): Promise<ParsedBundle> {
    if (pending) return pending;
    pending = (async () => {
      let response: Awaited<ReturnType<TemuAuthoritativeSourceRpc>>;
      try {
        response = await input.rpc(TEMU_AUTHORITATIVE_SOURCE_READ_RPC, {
          p_owner_id: input.ownerId,
          p_product_id: input.productId,
          p_account_subject: input.accountSubject,
          p_mall_id: input.mallId,
          p_region_id: input.regionId,
          p_product_revision_fingerprint: input.productRevisionFingerprint,
        });
      } catch {
        throw new TemuAuthoritativeLedgerReadError(
          "TEMU_AUTHORITATIVE_LEDGER_UNAVAILABLE",
        );
      }
      if (response.error) {
        throw new TemuAuthoritativeLedgerReadError(
          "TEMU_AUTHORITATIVE_LEDGER_UNAVAILABLE",
        );
      }
      const bundle = record(response.data);
      const nowEpochMs = now();
      if (!bundle
        || bundle.contract !== "temu_verified_authoritative_source_bundle_v1"
        || bundle.ownerId !== input.ownerId
        || bundle.productId !== input.productId
        || bundle.accountSubject !== input.accountSubject
        || bundle.mallId !== input.mallId
        || bundle.regionId !== input.regionId
        || bundle.productRevisionFingerprint
          !== input.productRevisionFingerprint
        || bundle.maxAgeSeconds !== 300
        || observedEpoch(bundle.readAt, nowEpochMs) === null) {
        throw new TemuAuthoritativeLedgerReadError(
          "TEMU_AUTHORITATIVE_LEDGER_SCOPE_MISMATCH",
        );
      }

      let app: TemuPartnerAppServiceSnapshot | null = null;
      if (bundle.appSnapshot !== null) {
        const value = record(bundle.appSnapshot);
        const rows = appRows(value?.rows);
        const epoch = observedEpoch(value?.observedAt, nowEpochMs);
        if (!value
          || value.source !== "temu_authenticated_partner_app_management_v1"
          || !envelopeValid(value, nowEpochMs)
          || rows === null
          || epoch === null) {
          throw new TemuAuthoritativeLedgerReadError(
            "TEMU_AUTHORITATIVE_LEDGER_APP_INVALID",
          );
        }
        app = {
          source: "temu_authenticated_partner_app_management_v1",
          accountSubject: input.accountSubject,
          observedAtEpochMs: epoch,
          rows,
        };
      }

      let shipping: TemuSellerShippingServiceSnapshot | null = null;
      if (bundle.shippingSnapshot !== null) {
        const value = record(bundle.shippingSnapshot);
        const epoch = observedEpoch(value?.observedAt, nowEpochMs);
        if (!value
          || value.source !== "temu_authenticated_seller_center_shipping_v1"
          || !envelopeValid(value, nowEpochMs)
          || epoch === null
          || !exactOptionalText(value.defaultTemplateId, 256)
          || typeof value.warehouseVerified !== "boolean"
          || typeof value.feeRuleVerified !== "boolean"
          || typeof value.returnPolicyVerified !== "boolean") {
          throw new TemuAuthoritativeLedgerReadError(
            "TEMU_AUTHORITATIVE_LEDGER_SHIPPING_INVALID",
          );
        }
        shipping = {
          source: "temu_authenticated_seller_center_shipping_v1",
          accountSubject: input.accountSubject,
          observedAtEpochMs: epoch,
          mallId: input.mallId,
          defaultTemplateId: value.defaultTemplateId as string | null,
          warehouseVerified: value.warehouseVerified,
          feeRuleVerified: value.feeRuleVerified,
          returnPolicyVerified: value.returnPolicyVerified,
        };
      }

      let egress: ParsedBundle["egressAttestation"] = null;
      if (bundle.egressAttestation !== null) {
        const value = record(bundle.egressAttestation);
        const epoch = observedEpoch(value?.observedAt, nowEpochMs);
        if (!value
          || value.source !== "temu_global_endpoint_egress_attestation_v1"
          || !envelopeValid(value, nowEpochMs)
          || epoch === null
          || value.endpointHost !== "openapi-b-global.temu.com"
          || ![
            "static_ip_verified",
            "provider_confirmed_no_allowlist",
            "blocked_until_stable_ip",
            "unknown",
          ].includes(String(value.state))) {
          throw new TemuAuthoritativeLedgerReadError(
            "TEMU_AUTHORITATIVE_LEDGER_EGRESS_INVALID",
          );
        }
        egress = {
          observedAtEpochMs: epoch,
          endpointHost: "openapi-b-global.temu.com",
          state: value.state as NonNullable<
            ParsedBundle["egressAttestation"]
          >["state"],
        };
      }
      return {
        appSnapshot: app,
        shippingSnapshot: shipping,
        egressAttestation: egress,
      };
    })();
    return pending;
  }

  return {
    readCurrentAppSnapshot: async () => (await load()).appSnapshot,
    readCurrentShippingSnapshot: async () => (await load()).shippingSnapshot,
    readGlobalEgressAttestation: async ({ endpointHost }) => {
      if (endpointHost !== "openapi-b-global.temu.com") {
        throw new TemuAuthoritativeLedgerReadError(
          "TEMU_AUTHORITATIVE_LEDGER_SCOPE_MISMATCH",
        );
      }
      const attestation = (await load()).egressAttestation;
      if (!attestation) {
        throw new TemuAuthoritativeLedgerReadError(
          "TEMU_AUTHORITATIVE_LEDGER_EGRESS_INVALID",
        );
      }
      return attestation;
    },
  };
}
