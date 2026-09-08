import { z } from "zod";

export const ebayCaseDisputePageSize = 25;

export const ebayCaseDisputeAvailabilitySchema = z.enum([
  "readable",
  "authorization_required",
  "not_available_or_not_found",
  "rate_limited",
  "provider_unverified",
  "sandbox_unsupported",
]);

const environmentSchema = z.enum(["sandbox", "production"]);
const identifierSchema = z.string().min(1).max(240);
const providerCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(120);
const timestampSchema = z.string().datetime({ offset: true });
const amountSchema = z.object({
  value: z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/).max(80),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

export const ebayCaseDisputeAccountsSchema = z.object({
  accounts: z.array(z.object({
    id: z.string().uuid(),
    label: z.string().min(1).max(200),
    environment: environmentSchema,
  })).max(100),
});

const pageBase = {
  credentialId: z.string().uuid(),
  environment: environmentSchema,
  availability: ebayCaseDisputeAvailabilitySchema,
  httpStatus: z.number().int().min(100).max(599).nullable(),
  total: z.number().int().nonnegative().nullable(),
  offset: z.number().int().nonnegative(),
  nextOffset: z.number().int().nonnegative().nullable(),
};

export const ebayPaymentDisputePageResponseSchema = z.object({
  kind: z.literal("payment_disputes"),
  ...pageBase,
  entries: z.array(z.object({
    paymentDisputeId: identifierSchema,
    orderId: identifierSchema,
    status: providerCodeSchema,
    reason: providerCodeSchema,
    openDate: timestampSchema,
    respondByDate: timestampSchema.nullable(),
    closedDate: timestampSchema.nullable(),
    amount: amountSchema,
  })).max(ebayCaseDisputePageSize),
}).superRefine((value, context) => validatePage(value, context));

export const ebayResolutionCasePageResponseSchema = z.object({
  kind: z.literal("resolution_cases"),
  ...pageBase,
  startTime: timestampSchema,
  endTime: timestampSchema,
  entries: z.array(z.object({
    caseId: identifierSchema,
    status: providerCodeSchema,
    itemId: identifierSchema,
    transactionId: identifierSchema,
    creationDate: timestampSchema,
    lastModifiedDate: timestampSchema,
    respondByDate: timestampSchema.nullable(),
    claimAmount: amountSchema,
    sellerBinding: z.enum(["matched", "redacted", "not_checked"]),
  })).max(ebayCaseDisputePageSize),
}).superRefine((value, context) => {
  validatePage(value, context);
  if (Date.parse(value.startTime) >= Date.parse(value.endTime)
      || Date.parse(value.endTime) - Date.parse(value.startTime) > 31 * 86_400_000) {
    context.addIssue({ code: "custom", message: "invalid case range" });
  }
});

function validatePage(
  value: {
    availability: z.infer<typeof ebayCaseDisputeAvailabilitySchema>;
    httpStatus: number | null;
    entries: unknown[];
    total: number | null;
    offset: number;
    nextOffset: number | null;
  },
  context: z.RefinementCtx,
) {
  if (value.offset % ebayCaseDisputePageSize !== 0
      || value.nextOffset !== null && value.nextOffset !== value.offset + ebayCaseDisputePageSize) {
    context.addIssue({ code: "custom", message: "invalid page offset" });
  }
  if (value.availability === "readable") {
    if (value.httpStatus !== 200) context.addIssue({ code: "custom", message: "readable response requires HTTP 200" });
    return;
  }
  if (value.entries.length || value.total !== null || value.nextOffset !== null) {
    context.addIssue({ code: "custom", message: "unavailable response cannot claim entries or totals" });
  }
}

const offsetSchema = z.string().regex(/^(0|[1-9]\d*)$/).transform(Number)
  .pipe(z.number().int().min(0).max(10_000_000));

export const ebayCaseDisputeQuerySchema = z.object({
  view: z.enum(["accounts", "payment_disputes", "resolution_cases"]).default("accounts"),
  credentialId: z.string().uuid().optional(),
  offset: offsetSchema.default(0),
  startTime: timestampSchema.optional(),
  endTime: timestampSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.view !== "accounts" && !value.credentialId) {
    context.addIssue({ code: "custom", message: "credential required" });
  }
  if (value.view === "accounts" && (value.credentialId || value.offset !== 0 || value.startTime || value.endTime)) {
    context.addIssue({ code: "custom", message: "accounts view cannot carry selection" });
  }
  if (value.view === "resolution_cases") {
    if (!value.startTime || !value.endTime) context.addIssue({ code: "custom", message: "case range required" });
    else if (Date.parse(value.startTime) >= Date.parse(value.endTime)
        || Date.parse(value.endTime) - Date.parse(value.startTime) > 31 * 86_400_000) {
      context.addIssue({ code: "custom", message: "invalid case range" });
    }
  } else if (value.startTime || value.endTime) {
    context.addIssue({ code: "custom", message: "range not supported for this view" });
  }
  if (value.view !== "accounts" && value.offset % ebayCaseDisputePageSize !== 0) {
    context.addIssue({ code: "custom", message: "invalid page offset" });
  }
});

export type EbayCaseDisputeAccounts = z.infer<typeof ebayCaseDisputeAccountsSchema>["accounts"];
export type EbayPaymentDisputePageResponse = z.infer<typeof ebayPaymentDisputePageResponseSchema>;
export type EbayResolutionCasePageResponse = z.infer<typeof ebayResolutionCasePageResponseSchema>;

export type EbayCaseDisputeView = "accounts" | "payment_disputes" | "resolution_cases";
export type EbayCaseDisputeAuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;
export type EbayCaseDisputeUiResponse =
  | z.infer<typeof ebayCaseDisputeAccountsSchema>
  | EbayPaymentDisputePageResponse
  | EbayResolutionCasePageResponse;

export async function readEbayCaseDisputeUiResponse(input: {
  authenticatedFetch: EbayCaseDisputeAuthenticatedFetch;
  view: EbayCaseDisputeView;
  credentialId?: string;
  offset?: number;
  startTime?: string;
  endTime?: string;
  signal?: AbortSignal;
}): Promise<EbayCaseDisputeUiResponse> {
  const params = new URLSearchParams({ view: input.view });
  if (input.view !== "accounts") {
    if (input.credentialId) params.set("credentialId", input.credentialId);
    params.set("offset", String(input.offset ?? 0));
  }
  if (input.view === "resolution_cases") {
    if (input.startTime) params.set("startTime", input.startTime);
    if (input.endTime) params.set("endTime", input.endTime);
  }
  ebayCaseDisputeQuerySchema.parse(Object.fromEntries(params));
  const response = await input.authenticatedFetch(
    `/api/admin/cs/channels/ebay/cases-disputes?${params}`,
    { cache: "no-store", ...(input.signal ? { signal: input.signal } : {}) },
  );
  const data: unknown = await response.json();
  if (!response.ok) {
    const message = data && typeof data === "object" && "message" in data && typeof data.message === "string"
      ? data.message
      : "eBay 케이스·분쟁 조회에 실패했습니다.";
    throw new Error(message);
  }
  if (input.view === "accounts") return ebayCaseDisputeAccountsSchema.parse(data);
  return input.view === "payment_disputes"
    ? ebayPaymentDisputePageResponseSchema.parse(data)
    : ebayResolutionCasePageResponseSchema.parse(data);
}
