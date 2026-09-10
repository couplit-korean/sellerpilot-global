import { z } from "zod";

const incarnationSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().min(1),
  fingerprint: z.string().regex(/^[A-Fa-f0-9]{12,64}$/u),
}).strict();

export async function ebayCreateCredentialRefreshIncarnationFromResponse(
  response: Response | null | undefined,
  required: boolean,
) {
  if (response == null || typeof response !== "object" || typeof response.ok !== "boolean") {
    throw new Error("EBAY_CREATE_CREDENTIAL_REFRESH_RECEIPT_REJECTED");
  }
  if (!response.ok) {
    throw new Error("EBAY_CREATE_CREDENTIAL_REFRESH_RECEIPT_REJECTED");
  }
  const body = await response.json().catch(() => null) as unknown;
  if (!required) return undefined;
  const value = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).credentialIncarnation
    : undefined;
  const parsed = incarnationSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("EBAY_CREATE_CREDENTIAL_INCARNATION_REFRESH_REQUIRED");
  }
  return parsed.data;
}
