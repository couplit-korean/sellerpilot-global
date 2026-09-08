import { z } from "zod";
import { activeChannelKeys } from "../channels/catalog";

const nullableTime = z.string().datetime({ offset: true }).nullable();
const nullableFingerprint = z.string().min(1).max(128).nullable();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u).nullable();

export const csCredentialBindingsSchema = z.object({
  contract: z.literal("sellerpilot-cs-credential-bindings-read/1"),
  checkedAt: z.string().datetime({ offset: true }),
  bindings: z.array(z.object({
    credentialId: z.string().uuid(),
    channel: z.enum(activeChannelKeys),
    credentialFingerprint: nullableFingerprint,
    sellerAccountBinding: z.enum(["provider_certified", "unverified"]),
    credentialStatus: z.enum(["active", "grace", "revoked", "invalid"]),
    credentialExpiresAt: nullableTime,
    operation: z.enum(["inquiries.list", "inquiries.reply"]).nullable(),
    country: z.string().min(1).max(40).nullable(),
    appFingerprint: sha256,
    tokenFingerprint: sha256,
    targetFingerprint: sha256,
    bindingStatus: z.enum(["active", "superseded", "revoked", "expired", "unverified"]),
    verifiedAt: nullableTime,
  }).strict()).max(2_000),
}).strict();

export type CsCredentialBindings = z.infer<typeof csCredentialBindingsSchema>;
