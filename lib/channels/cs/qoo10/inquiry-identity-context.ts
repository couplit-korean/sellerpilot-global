import type { Qoo10InquiryAccountIdentity } from "./inquiry-identity.ts";

export const qoo10InquiryIdentityContextContract =
  "sellerpilot-qoo10-inquiry-identity-context/1" as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ACCOUNT_KEY_RE = /^[a-f0-9]{64}$/u;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function qoo10InquiryIdentityContextRpcArguments(input: {
  tokenHash: string;
  jobId: string;
  claimToken: string;
}) {
  return {
    p_token_hash: input.tokenHash,
    p_job_id: input.jobId,
    p_claim_token: input.claimToken,
  };
}

export function parseQoo10InquiryIdentityContext(
  value: unknown,
  expected: { credentialId: string; environment: "sandbox" | "production" },
): { account: Qoo10InquiryAccountIdentity; sourceCredentialId: string } {
  const context = record(value);
  const ownerId = typeof context?.ownerId === "string" ? context.ownerId.toLowerCase() : "";
  const sellerAccountKey = typeof context?.sellerAccountKey === "string"
    ? context.sellerAccountKey.toLowerCase()
    : "";
  const sourceCredentialId = typeof context?.sourceCredentialId === "string"
    ? context.sourceCredentialId.toLowerCase()
    : "";
  if (context?.contract !== qoo10InquiryIdentityContextContract
      || !UUID_RE.test(ownerId)
      || !ACCOUNT_KEY_RE.test(sellerAccountKey)
      || !UUID_RE.test(sourceCredentialId)
      || sourceCredentialId !== expected.credentialId.toLowerCase()
      || context.environment !== expected.environment) {
    throw new Error("QOO10_INQUIRY_IDENTITY_CONTEXT_INVALID");
  }
  return Object.freeze({
    account: Object.freeze({ ownerId, sellerAccountKey, environment: expected.environment }),
    sourceCredentialId,
  });
}
