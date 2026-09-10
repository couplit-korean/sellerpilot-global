import { createHash } from "node:crypto";
import { elevenstVerifiedSkuAbsence } from "../../channels/elevenst-create-preflight";
import {
  elevenstOfficialXmlGet,
  type ElevenstGetTransportEvidence,
} from "../../channels/elevenst-official-get";
import {
  runWithProviderReadOnlyTransport,
  type SecretPayload,
} from "../../channels/protocols";
import {
  elevenstSellerCodeLookupProductNo,
  verifyElevenstCreateProductReadback,
  verifyElevenstCreateStockReadback,
} from "./create-verification";

export type RecoveryCredentialBinding = {
  credentialId: string;
  credentialVersion: number;
  credentialFingerprint: string;
  vaultSecretId: string;
  expectedApiKeySha256: string;
};

export type RecoveryReadEvidence = ElevenstGetTransportEvidence & {
  kind: "seller-product-code" | "seller-product-identity" | "product" | "stock";
  httpStatus: number;
  accepted: boolean;
};

export type RecoveryAuthoritativeSnapshot = {
  categoryId: string;
  priceKrw: number;
  stockQuantity: number;
  titleSha256: string;
  productImagesSha256: string;
  detailHtmlSha256: string;
};

export type ElevenstCreateRecoveryObservation = {
  contract: "sellerpilot_elevenst_create_get_only_recovery_v2";
  outcome: "unique" | "absent" | "ambiguous" | "unavailable";
  sellerProductCode: string;
  productNo: string | null;
  fullOfficialReadback: boolean;
  productMismatches: string[];
  stockMismatches: string[];
  providerReadbackUnavailableFields: string[];
  providerMutationPerformed: false;
  credentialEvidence: {
    credentialId: string;
    credentialVersion: number;
    credentialFingerprint: string;
    vaultSecretId: string;
    apiKeySha256: string;
  };
  authoritativeSnapshot: RecoveryAuthoritativeSnapshot;
  providerReads: RecoveryReadEvidence[];
  observedAt: string;
};

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function authoritativeSnapshot(
  product: Record<string, unknown>,
): RecoveryAuthoritativeSnapshot {
  return {
    categoryId: String(product.dispCtgrNo ?? "").trim(),
    priceKrw: Number(product.selPrc),
    stockQuantity: Number(product.prdSelQty),
    titleSha256: sha256(String(product.prdNm ?? "")),
    productImagesSha256: sha256([
      product.prdImage01,
      product.prdImage02,
      product.prdImage03,
      product.prdImage04,
    ].map((value) => String(value ?? "")).join("\n")),
    detailHtmlSha256: sha256(String(product.htmlDetail ?? "")),
  };
}

function credentialEvidence(
  payload: SecretPayload,
  binding: RecoveryCredentialBinding,
) {
  return {
    credentialId: binding.credentialId,
    credentialVersion: binding.credentialVersion,
    credentialFingerprint: binding.credentialFingerprint,
    vaultSecretId: binding.vaultSecretId,
    apiKeySha256: sha256(String(payload.api_key ?? "")),
  };
}

function readEvidence(
  kind: RecoveryReadEvidence["kind"],
  evidence: ElevenstGetTransportEvidence,
  status: number,
  accepted: boolean,
): RecoveryReadEvidence {
  return { kind, ...evidence, httpStatus: status, accepted };
}

function baseObservation(input: {
  payload: SecretPayload;
  credentialBinding: RecoveryCredentialBinding;
  expectedProduct: Record<string, unknown>;
  outcome: ElevenstCreateRecoveryObservation["outcome"];
  productNo?: string | null;
  providerReads?: RecoveryReadEvidence[];
}): ElevenstCreateRecoveryObservation {
  return {
    contract: "sellerpilot_elevenst_create_get_only_recovery_v2",
    outcome: input.outcome,
    sellerProductCode: String(input.expectedProduct.sellerPrdCd ?? "").trim(),
    productNo: input.productNo ?? null,
    fullOfficialReadback: false,
    productMismatches: [],
    stockMismatches: [],
    providerReadbackUnavailableFields: [],
    providerMutationPerformed: false,
    credentialEvidence: credentialEvidence(input.payload, input.credentialBinding),
    authoritativeSnapshot: authoritativeSnapshot(input.expectedProduct),
    providerReads: input.providerReads ?? [],
    observedAt: new Date().toISOString(),
  };
}

export async function recoverElevenstCreateGetOnly(input: {
  payload: SecretPayload;
  credentialBinding: RecoveryCredentialBinding;
  expectedProduct: Record<string, unknown>;
}): Promise<ElevenstCreateRecoveryObservation> {
  return runWithProviderReadOnlyTransport(async () => {
    const sellerProductCode = String(input.expectedProduct.sellerPrdCd ?? "").trim();
    const lookupPath = `/rest/prodmarketservice/sellerprodcode/${encodeURIComponent(sellerProductCode)}`;
    let lookup;
    try {
      lookup = await elevenstOfficialXmlGet({
        payload: input.payload,
        path: lookupPath,
      });
    } catch {
      return baseObservation({ ...input, outcome: "unavailable" });
    }
    const providerReads: RecoveryReadEvidence[] = [readEvidence(
      "seller-product-code",
      lookup.evidence,
      lookup.remote.response.status,
      lookup.remote.data.accepted === true,
    )];
    let productNo: string | null = null;
    try {
      productNo = elevenstSellerCodeLookupProductNo({
        remote: lookup.remote,
        sellerProductCode,
      });
    } catch (error) {
      return baseObservation({
        ...input,
        outcome: error instanceof Error && error.message.includes("AMBIGUOUS")
          ? "ambiguous"
          : "unavailable",
        providerReads,
      });
    }
    if (!productNo) {
      return baseObservation({
        ...input,
        outcome: elevenstVerifiedSkuAbsence(lookup.remote) ? "absent" : "unavailable",
        providerReads,
      });
    }
    const identityPath = `/rest/prodmarketservice/prodmarket/${encodeURIComponent(productNo)}`;
    let identity;
    try {
      identity = await elevenstOfficialXmlGet({
        payload: input.payload,
        path: identityPath,
      });
    } catch {
      return baseObservation({
        ...input,
        outcome: "unavailable",
        productNo,
        providerReads,
      });
    }
    const identityProduct = identity.remote.data.product as Record<string, unknown> | undefined;
    providerReads.push(readEvidence(
      "seller-product-identity",
      identity.evidence,
      identity.remote.response.status,
      identity.remote.data.accepted === true
        && String(identity.remote.data.productNo ?? identityProduct?.prdNo ?? "") === productNo
        && String(identityProduct?.sellerPrdCd ?? "") === sellerProductCode,
    ));
    let productRemote;
    let stockRemote;
    try {
      productRemote = await elevenstOfficialXmlGet({
        payload: input.payload,
        path: identityPath,
      });
      providerReads.push(readEvidence(
        "product",
        productRemote.evidence,
        productRemote.remote.response.status,
        productRemote.remote.data.accepted === true,
      ));
      stockRemote = await elevenstOfficialXmlGet({
        payload: input.payload,
        path: `/rest/prodmarketservice/prodmarket/stck/${encodeURIComponent(productNo)}`,
      });
    } catch {
      return baseObservation({
        ...input,
        outcome: "unavailable",
        productNo,
        providerReads,
      });
    }
    providerReads.push(readEvidence(
      "stock",
      stockRemote.evidence,
      stockRemote.remote.response.status,
      stockRemote.remote.data.accepted === true,
    ));
    let product;
    let stock;
    try {
      product = verifyElevenstCreateProductReadback({
        expectedProduct: input.expectedProduct,
        remote: productRemote.remote,
        productNo,
      });
      stock = verifyElevenstCreateStockReadback({
        remote: stockRemote.remote,
        productNo,
        expectedQuantity: Number(input.expectedProduct.prdSelQty),
      });
    } catch {
      return baseObservation({
        ...input,
        outcome: "unique",
        productNo,
        providerReads,
      });
    }
    const observation = baseObservation({
      ...input,
      outcome: "unique",
      productNo,
      providerReads,
    });
    return {
      ...observation,
      fullOfficialReadback: product.ok
        && stock.ok
        && product.providerReadbackUnavailableFields.length === 0
        && observation.credentialEvidence.apiKeySha256
          === input.credentialBinding.expectedApiKeySha256,
      productMismatches: product.mismatches,
      stockMismatches: stock.mismatches,
      providerReadbackUnavailableFields: product.providerReadbackUnavailableFields,
    };
  });
}
