import { z } from "zod";
import { channelMarket } from "./markets";

export const listingPublicationIntents = ["safe_test", "live"] as const;
export const listingPublicationIntentSchema = z.enum(listingPublicationIntents);
export const listingRemoteStateContractVersion = "verified_remote_state_v1" as const;
export const listingRemoteStateContractSchema = z.literal(listingRemoteStateContractVersion);

export type ListingPublicationIntent = z.infer<typeof listingPublicationIntentSchema>;

export const listingRemoteVisibilities = [
  "unknown",
  "non_public",
  "pending_review",
  "live",
  "withdrawn",
  "rejected",
] as const;

export const listingRemoteVisibilitySchema = z.enum(listingRemoteVisibilities);

const boundedJsonObjectSchema = (label: string, maxBytes = 32_768) => z
  .record(z.string().min(1).max(120), z.unknown())
  .superRefine((value, context) => {
    if (Object.keys(value).length === 0) {
      context.addIssue({ code: "custom", message: `${label} must not be empty` });
      return;
    }
    try {
      if (Buffer.byteLength(JSON.stringify(value), "utf8") > maxBytes) {
        context.addIssue({ code: "custom", message: `${label} is too large` });
      }
    } catch {
      context.addIssue({ code: "custom", message: `${label} must be serializable` });
    }
  });

const canonicalTimestampSchema = z.string()
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

/**
 * Provider state observed in an authoritative readback after a listing
 * mutation. `pending_review` is a known non-live state, while `unknown` exists
 * only for ledger compatibility and is rejected for new successful writes.
 */
export const listingPublicationLocaleSchema = z.string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u);

export const verifiedListingRemoteStateSchema = z.object({
  verified: z.literal(true),
  visibility: listingRemoteVisibilitySchema,
  providerStatus: z.string().trim().min(1).max(160).refine(
    (value) => [...value].every((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && (codePoint < 127 || codePoint > 159);
    }),
    "provider status cannot contain control characters",
  ),
  verifiedAt: canonicalTimestampSchema,
  evidence: boundedJsonObjectSchema("listing remote-state evidence"),
  resources: boundedJsonObjectSchema("listing remote resources"),
  locale: listingPublicationLocaleSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  imageCount: z.number().int().min(0).max(64),
  createdAt: canonicalTimestampSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.visibility === "unknown") {
    context.addIssue({ code: "custom", path: ["visibility"], message: "verified listing visibility cannot be unknown" });
  }
  if (new Date(value.verifiedAt).getTime() > Date.now() + 5 * 60 * 1_000) {
    context.addIssue({ code: "custom", path: ["verifiedAt"], message: "listing verification timestamp is in the future" });
  }
  for (const key of [
    "identityVerified",
    "statusVerified",
    "localeVerified",
    "fingerprintVerified",
    "imageCountVerified",
  ] as const) {
    if (value.evidence[key] !== true) {
      context.addIssue({ code: "custom", path: ["evidence", key], message: `listing evidence requires ${key}` });
    }
  }
});

export function listingRemoteStateVerifiedAtOrAfterJobBoundary(
  remoteState: unknown,
  jobBoundary: unknown,
) {
  const parsedState = verifiedListingRemoteStateSchema.safeParse(remoteState);
  const parsedBoundary = canonicalTimestampSchema.safeParse(jobBoundary);
  if (!parsedState.success || !parsedBoundary.success) return false;
  return new Date(parsedState.data.verifiedAt).getTime()
    >= new Date(parsedBoundary.data).getTime();
}

export type VerifiedListingRemoteState = z.infer<typeof verifiedListingRemoteStateSchema>;

const ebayPublicationLocales: Record<string, string> = {
  US: "en-US",
  GB: "en-GB",
  DE: "de-DE",
  AU: "en-AU",
  CA: "en-CA",
  FR: "fr-FR",
  IT: "it-IT",
  ES: "es-ES",
  AT: "de-AT",
  BE: "nl-BE",
  CH: "de-CH",
  HK: "zh-HK",
  IE: "en-IE",
  NL: "nl-NL",
  PL: "pl-PL",
};

/** Resolves the server-owned locale for a channel/market publication. */
export function listingExpectedPublicationLocale(channel: string, market: string) {
  const normalizedMarket = market.trim().toUpperCase();
  if (channel === "qoo10") return normalizedMarket === "JP" || !normalizedMarket ? "ja-JP" : undefined;
  if (["coupang", "elevenst", "smartstore", "temu"].includes(channel)) {
    return normalizedMarket === "KR" || !normalizedMarket ? "ko-KR" : undefined;
  }
  if (channel === "shopee" || channel === "lazada") {
    return channelMarket(channel, normalizedMarket)?.locale;
  }
  if (channel === "ebay") return ebayPublicationLocales[normalizedMarket];
  return undefined;
}

export function listingPublicationIntentFromArguments(
  argumentsValue: Record<string, unknown>,
): ListingPublicationIntent | undefined {
  const parsed = listingPublicationIntentSchema.safeParse(argumentsValue.publicationIntent);
  return parsed.success ? parsed.data : undefined;
}

export function listingOperationRequiresVerifiedRemoteState(operation: string) {
  // listing.activate is intentionally included so the same contract becomes
  // mandatory when the explicit activation operation is released.
  return operation === "listing.create"
    || operation === "listing.update"
    || operation === "listing.stop"
    || operation === "listing.publication.verify"
    || operation === "listing.activate";
}

export function listingOperationUsesPublicationIntent(operation: string) {
  return operation === "listing.create"
    || operation === "listing.update"
    || operation === "listing.publication.verify"
    || operation === "listing.activate";
}

export function listingRemoteStateMatchesIntent(
  intent: ListingPublicationIntent,
  state: VerifiedListingRemoteState,
) {
  if (intent === "safe_test") {
    return state.visibility === "non_public"
      || state.visibility === "withdrawn";
  }
  return state.visibility === "live" || state.visibility === "pending_review";
}

export function listingRemoteStateFulfillsIntent(
  intent: ListingPublicationIntent,
  state: VerifiedListingRemoteState,
) {
  if (intent === "safe_test") {
    return state.visibility === "non_public" || state.visibility === "withdrawn";
  }
  return state.visibility === "live";
}

export function listingRemoteStateMatchesOperation(
  operation: string,
  state: VerifiedListingRemoteState,
  intent?: ListingPublicationIntent,
) {
  if (operation === "listing.stop") {
    return state.visibility === "non_public"
      || state.visibility === "withdrawn";
  }
  if (operation === "listing.publication.verify") {
    return intent === "live" && state.visibility !== "unknown";
  }
  return Boolean(intent && listingRemoteStateMatchesIntent(intent, state));
}

export function listingRemoteStateFulfillsOperation(
  operation: string,
  state: VerifiedListingRemoteState,
  intent?: ListingPublicationIntent,
) {
  if (operation === "listing.stop") {
    return state.visibility === "non_public" || state.visibility === "withdrawn";
  }
  if (operation === "listing.publication.verify") {
    return intent === "live" && state.visibility === "live";
  }
  return Boolean(intent && listingRemoteStateFulfillsIntent(intent, state));
}

export type PersistedListingPublicationReplay =
  | {
    status: "verified";
    publicationIntent?: ListingPublicationIntent;
    remoteState: VerifiedListingRemoteState;
    publicationFulfilled: boolean;
  }
  | { status: "invalid" };

/**
 * Parses the persisted idempotency replay envelope. Listing stop deliberately
 * ignores safe/live intent but still requires a verified non-public readback.
 * Missing, legacy, or inconsistent remote state fails shut.
 */
export function persistedListingPublicationReplay(
  operation: string,
  publicationIntent: unknown,
  remoteState: unknown,
  requestedIntent?: ListingPublicationIntent,
): PersistedListingPublicationReplay {
  const parsedRemoteState = verifiedListingRemoteStateSchema.safeParse(remoteState);
  if (!parsedRemoteState.success) return { status: "invalid" };
  if (operation === "listing.stop") {
    if (!listingRemoteStateMatchesOperation(operation, parsedRemoteState.data)) {
      return { status: "invalid" };
    }
    return {
      status: "verified",
      remoteState: parsedRemoteState.data,
      publicationFulfilled: listingRemoteStateFulfillsOperation(operation, parsedRemoteState.data),
    };
  }
  const parsedIntent = listingPublicationIntentSchema.safeParse(publicationIntent);
  if (!parsedIntent.success
      || parsedIntent.data !== requestedIntent
      || !listingRemoteStateMatchesOperation(operation, parsedRemoteState.data, parsedIntent.data)) {
    return { status: "invalid" };
  }
  return {
    status: "verified",
    publicationIntent: parsedIntent.data,
    remoteState: parsedRemoteState.data,
    publicationFulfilled: listingRemoteStateFulfillsOperation(operation, parsedRemoteState.data, parsedIntent.data),
  };
}

function recordContainsExactString(value: unknown, expected: string, depth = 0): boolean {
  if (depth > 6 || value === null || value === undefined) return false;
  if (typeof value === "string" || typeof value === "number") return String(value) === expected;
  if (Array.isArray(value)) return value.some((item) => recordContainsExactString(item, expected, depth + 1));
  if (typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>)
    .some((item) => recordContainsExactString(item, expected, depth + 1));
}

export function verifiedListingPublicationResult(
  operation: string,
  result: Record<string, unknown>,
  requestedIntent?: ListingPublicationIntent,
  expected?: {
    locale?: string;
    fingerprint?: string;
    minimumImageCount?: number;
    jobBoundary?: string;
  },
): PersistedListingPublicationReplay {
  if (result.publicationStateContract !== listingRemoteStateContractVersion) return { status: "invalid" };
  const replay = persistedListingPublicationReplay(
    operation,
    result.publicationIntent,
    result.remoteState,
    requestedIntent,
  );
  if (replay.status !== "verified"
      || result.publicationFulfilled !== replay.publicationFulfilled) {
    return { status: "invalid" };
  }
  const remoteId = typeof result.remoteId === "string" ? result.remoteId.trim() : "";
  if (!remoteId || !recordContainsExactString(replay.remoteState.resources, remoteId)) {
    return { status: "invalid" };
  }
  if (expected?.locale && replay.remoteState.locale !== expected.locale) return { status: "invalid" };
  if (expected?.fingerprint && replay.remoteState.fingerprint !== expected.fingerprint) return { status: "invalid" };
  // The marketplace publication contract is an exact manifest, not a floor:
  // an extra image is source drift just as surely as a missing image.
  if (expected?.minimumImageCount !== undefined
      && replay.remoteState.imageCount !== expected.minimumImageCount) {
    return { status: "invalid" };
  }
  if (expected?.jobBoundary
      && !listingRemoteStateVerifiedAtOrAfterJobBoundary(replay.remoteState, expected.jobBoundary)) {
    return { status: "invalid" };
  }
  return replay;
}
