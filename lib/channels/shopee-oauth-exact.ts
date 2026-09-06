import { z } from "zod";
import { gatewayClaimSchema } from "./gateway-contract";
export const shopeeExactAdminInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare"), credentialId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("start"), sessionId: z.string().uuid(), credentialId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("bind"), sessionId: z.string().uuid(), credentialId: z.string().uuid(), state: z.string().min(24).max(180), code: z.string().min(1).max(8000), mainAccountId: z.string().regex(/^\d+$/) }).strict(),
]);
export const shopeeExactWorkerInput = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["pulse", "claim"]), sessionId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("heartbeat"), sessionId: z.string().uuid(), jobId: z.string().uuid(), claimToken: z.string().uuid() }).strict(),
]);
export function shopeeExactAuthenticatedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const timeout = AbortSignal.timeout(25_000);
  return fetch(input, { ...init, redirect: "error", signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
}
export function parseShopeeExactClaim(value: unknown, sessionId: string) {
  const job = gatewayClaimSchema.parse(value);
  if (job.channel !== "shopee" || job.operation !== "oauth.exchange" || job.environment !== "production"
      || job.attempt_count !== 1 || job.request.shopeeExactSession !== sessionId
      || String(job.credential.partner_id) !== "2031489" || String(job.credential.shop_id) !== "1719148844"
      || !/^\d+$/.test(String(job.request.mainAccountId))
      || String(job.request.mainAccountId) !== String(job.credential.main_account_id)
      || !Array.isArray(job.credential.shop_ids) || job.credential.shop_ids.length !== 8
      || new Set(job.credential.shop_ids.map(String)).size !== 8
      || !job.credential.shop_ids.map(String).includes("1719148844")
      || job.credential.shop_ids.some((id) => !/^\d+$/.test(String(id)))) {
    throw new Error("SHOPEE_EXACT_CLAIM_INVALID");
  }
  return job;
}
