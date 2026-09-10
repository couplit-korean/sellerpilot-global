import { z } from "zod";

export const elevenstCsAccountIdentitySchema = z.object({
  contract: z.literal("sellerpilot-elevenst-cs-account-identity/1"),
  credentialId: z.string().uuid(),
  sellerId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/u),
  sellerName: z.string().trim().min(1).max(160),
  environment: z.literal("production"),
  version: z.number().int().positive(),
  verifiedAt: z.string().datetime({ offset: true }),
}).strict();

export type ElevenstCsAccountIdentity = z.infer<typeof elevenstCsAccountIdentitySchema>;

type RpcResult = { data: unknown; error: unknown };

export async function readElevenstCsAccountIdentity(
  credentialId: string,
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>,
) {
  const result = await rpc("sellerpilot_service_elevenst_cs_account_identity_v1", {
    p_credential_id: credentialId,
  });
  if (result.error) throw new Error("ELEVENST_CS_ACCOUNT_IDENTITY_UNAVAILABLE");
  const identity = elevenstCsAccountIdentitySchema.parse(result.data);
  if (identity.credentialId !== credentialId) {
    throw new Error("ELEVENST_CS_ACCOUNT_IDENTITY_MISMATCH");
  }
  return identity;
}
