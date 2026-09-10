export const elevenstGatewayCredentialVersionRpc =
  "sellerpilot_service_elevenst_gateway_credential_version";

export const elevenstGatewayCredentialVersionContract =
  "sellerpilot-elevenst-gateway-credential-version/1";

type CredentialEnvironment = "sandbox" | "production";

export type ElevenstGatewayCredentialVersionReceipt = {
  contract: typeof elevenstGatewayCredentialVersionContract;
  status: "verified";
  jobId: string;
  credentialId: string;
  credentialVersion: number;
  environment: CredentialEnvironment;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseElevenstGatewayCredentialVersionReceipt(
  value: unknown,
): ElevenstGatewayCredentialVersionReceipt {
  const receipt = record(value);
  if (!receipt
    || receipt.contract !== elevenstGatewayCredentialVersionContract
    || receipt.status !== "verified"
    || typeof receipt.jobId !== "string"
    || typeof receipt.credentialId !== "string"
    || (receipt.environment !== "sandbox" && receipt.environment !== "production")
    || !Number.isSafeInteger(receipt.credentialVersion)
    || Number(receipt.credentialVersion) < 1) {
    throw new Error("ELEVENST_GATEWAY_CREDENTIAL_VERSION_RECEIPT_INVALID");
  }
  return receipt as ElevenstGatewayCredentialVersionReceipt;
}

export function assertElevenstGatewayCredentialVersionReceipt(input: {
  receipt: unknown;
  jobId: string;
  credentialId: string;
  environment: CredentialEnvironment;
}) {
  const receipt = parseElevenstGatewayCredentialVersionReceipt(input.receipt);
  if (receipt.jobId !== input.jobId
    || receipt.credentialId !== input.credentialId
    || receipt.environment !== input.environment
  ) {
    throw new Error("ELEVENST_GATEWAY_CREDENTIAL_VERSION_RECEIPT_INVALID");
  }
  return Number(receipt.credentialVersion);
}
