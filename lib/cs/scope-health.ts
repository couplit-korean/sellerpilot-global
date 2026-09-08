import { z } from "zod";
import { activeChannelKeys } from "../channels/catalog";
const time=z.string().datetime({offset:true}).nullable();
export const csScopeHealthSchema=z.object({
 contract:z.literal("sellerpilot-cs-scope-health/1"),checkedAt:z.string().datetime({offset:true}),
 scopes:z.array(z.object({
  channel:z.enum(activeChannelKeys),credentialId:z.string().uuid(),shopId:z.string().nullable(),ticketKind:z.enum(["conversation","after_sales"]),
  credentialStatus:z.enum(["active","grace","invalid","revoked"]),credentialExpiresAt:time,permissionCheckedAt:time,
  permissionStatus:z.enum(["passed","failed","manual","unverified"]),lastAttemptAt:time,lastSuccessAt:time,lastInboundAt:time,
  oldestPendingAt:time,queueAgeSeconds:z.number().int().nonnegative().nullable(),pendingReplyCount:z.number().int().nonnegative(),
  uncertainReplyCount:z.number().int().nonnegative(),archiveGapCount:z.number().int().nonnegative(),rateLimitRetryAt:time,
  zeroResultIsComplete:z.literal(false),state:z.enum(["needs_attention","unverified","zero_unverified","observed"]),
 }).strict()).max(500),
}).strict();
export type CsScopeHealth=z.infer<typeof csScopeHealthSchema>;
