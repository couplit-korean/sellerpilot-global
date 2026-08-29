import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const receiptVersion = "v1";
const keyDerivationDomain = "sellerpilot:product-research-lineage:v1:key";
const signingDomain = "sellerpilot:product-research-lineage:v1:receipt";
const sha256Pattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ProductResearchLineageReceiptPayload = {
  v: 1;
  ownerId: string;
  researchJobId: string;
  researchInputSha256: string;
  sourcePhotoSha256: string;
};

export type ProductResearchLineageReceiptExpectation = {
  ownerId: string;
  researchJobId: string;
  researchInput: string;
  sourcePhotoSha256: string;
};

export type ProductResearchLineageReceiptVerification =
  | { valid: true; researchInputSha256: string }
  | {
    valid: false;
    reason:
      | "configuration_missing"
      | "invalid_expectation"
      | "malformed"
      | "signature_mismatch"
      | "owner_mismatch"
      | "job_mismatch"
      | "research_input_mismatch"
      | "source_photo_mismatch";
  };

export function productResearchInputSha256(researchInput: string) {
  return createHash("sha256").update(researchInput.trim(), "utf8").digest("hex");
}

function receiptKey(secret: string) {
  return createHmac("sha256", secret).update(keyDerivationDomain, "utf8").digest();
}

function receiptSignature(secret: string, encodedPayload: string) {
  return createHmac("sha256", receiptKey(secret))
    .update(`${signingDomain}.${encodedPayload}`, "utf8")
    .digest();
}

function validExpectation(expectation: ProductResearchLineageReceiptExpectation) {
  return uuidPattern.test(expectation.ownerId)
    && uuidPattern.test(expectation.researchJobId)
    && expectation.researchInput.trim().length >= 2
    && expectation.researchInput.trim().length <= 12_000
    && sha256Pattern.test(expectation.sourcePhotoSha256);
}

export function createProductResearchLineageReceipt(
  secret: string,
  expectation: ProductResearchLineageReceiptExpectation,
) {
  const normalizedSecret = secret.trim();
  if (normalizedSecret.length < 16) throw new Error("product_research_lineage_secret_unavailable");
  if (!validExpectation(expectation)) throw new Error("invalid_product_research_lineage_expectation");
  const payload: ProductResearchLineageReceiptPayload = {
    v: 1,
    ownerId: expectation.ownerId.toLowerCase(),
    researchJobId: expectation.researchJobId.toLowerCase(),
    researchInputSha256: productResearchInputSha256(expectation.researchInput),
    sourcePhotoSha256: expectation.sourcePhotoSha256,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = receiptSignature(normalizedSecret, encodedPayload).toString("base64url");
  return `${receiptVersion}.${encodedPayload}.${signature}`;
}

export function verifyProductResearchLineageReceipt(
  secret: string,
  receipt: string,
  expectation: ProductResearchLineageReceiptExpectation,
): ProductResearchLineageReceiptVerification {
  const normalizedSecret = secret.trim();
  if (normalizedSecret.length < 16) return { valid: false, reason: "configuration_missing" };
  if (!validExpectation(expectation)) return { valid: false, reason: "invalid_expectation" };
  if (receipt.length < 32 || receipt.length > 2_000) return { valid: false, reason: "malformed" };
  const [version, encodedPayload, encodedSignature, ...extra] = receipt.split(".");
  if (version !== receiptVersion || !encodedPayload || !encodedSignature || extra.length) {
    return { valid: false, reason: "malformed" };
  }

  let suppliedSignature: Buffer;
  let decodedPayload: unknown;
  try {
    suppliedSignature = Buffer.from(encodedSignature, "base64url");
    decodedPayload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as unknown;
  } catch {
    return { valid: false, reason: "malformed" };
  }
  const expectedSignature = receiptSignature(normalizedSecret, encodedPayload);
  if (suppliedSignature.length !== expectedSignature.length
      || !timingSafeEqual(suppliedSignature, expectedSignature)) {
    return { valid: false, reason: "signature_mismatch" };
  }
  if (!decodedPayload || typeof decodedPayload !== "object" || Array.isArray(decodedPayload)) {
    return { valid: false, reason: "malformed" };
  }
  const payloadKeys = Object.keys(decodedPayload).sort();
  const expectedPayloadKeys = [
    "ownerId",
    "researchInputSha256",
    "researchJobId",
    "sourcePhotoSha256",
    "v",
  ];
  if (payloadKeys.length !== expectedPayloadKeys.length
      || payloadKeys.some((key, index) => key !== expectedPayloadKeys[index])) {
    return { valid: false, reason: "malformed" };
  }
  const payload = decodedPayload as ProductResearchLineageReceiptPayload;
  if (!payload || payload.v !== 1
      || !uuidPattern.test(payload.ownerId)
      || !uuidPattern.test(payload.researchJobId)
      || !sha256Pattern.test(payload.researchInputSha256)
      || !sha256Pattern.test(payload.sourcePhotoSha256)) {
    return { valid: false, reason: "malformed" };
  }
  if (payload.ownerId !== expectation.ownerId.toLowerCase()) return { valid: false, reason: "owner_mismatch" };
  if (payload.researchJobId !== expectation.researchJobId.toLowerCase()) return { valid: false, reason: "job_mismatch" };
  const researchInputSha256 = productResearchInputSha256(expectation.researchInput);
  if (payload.researchInputSha256 !== researchInputSha256) {
    return { valid: false, reason: "research_input_mismatch" };
  }
  if (payload.sourcePhotoSha256 !== expectation.sourcePhotoSha256) {
    return { valid: false, reason: "source_photo_mismatch" };
  }
  return { valid: true, researchInputSha256 };
}
