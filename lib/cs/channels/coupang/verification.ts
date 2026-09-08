import { z } from "zod";

const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
});

export const coupangCsVerificationKindSchema = z.enum([
  "product",
  "call-center",
  "return_request",
  "cancel_request",
  "exchange_request",
]);

export const coupangCsVerificationQuerySchema = z.object({
  credentialId: z.string().uuid(),
  from: calendarDateSchema,
  to: calendarDateSchema,
  kind: coupangCsVerificationKindSchema,
  limit: z.coerce.number().int().min(1).max(100).default(100),
}).superRefine((value, context) => {
  const from = Date.parse(`${value.from}T00:00:00.000Z`);
  const to = Date.parse(`${value.to}T00:00:00.000Z`);
  if (to < from || to - from > 30 * 86_400_000) {
    context.addIssue({ code: "custom", path: ["to"], message: "COUPANG_CS_VERIFICATION_RANGE_INVALID" });
  }
});

const messageSchema = z.object({
  inboundKey: z.string().startsWith("coupang:").max(500),
  remoteMessageId: z.string().max(240).nullable(),
  senderRole: z.enum(["customer", "seller", "system"]),
  body: z.string().min(1).max(20_000),
  receivedAt: z.string().datetime({ offset: true }),
  parentAnswerId: z.string().regex(/^[1-9]\d*$/u).nullable(),
}).strict();

const ticketSchema = z.object({
  externalTicketId: z.string().min(1).max(240),
  externalOrderReference: z.string().max(240).nullable(),
  ticketKind: z.enum(["conversation", "after_sales"]),
  status: z.enum(["waiting", "resolved"]),
  providerStatus: z.enum(["unknown", "waiting", "answered", "closed"]),
  receivedAt: z.string().datetime({ offset: true }),
  messages: z.array(messageSchema).max(500),
}).strict();

export const coupangCsVerificationResultSchema = z.object({
  contract: z.literal("sellerpilot-coupang-cs-verification/1"),
  credentialId: z.string().uuid(),
  kind: coupangCsVerificationKindSchema,
  fromDate: calendarDateSchema,
  toDate: calendarDateSchema,
  totalTickets: z.number().int().nonnegative(),
  displayedTickets: z.number().int().nonnegative(),
  tickets: z.array(ticketSchema).max(100),
}).strict().superRefine((value, context) => {
  if (value.displayedTickets !== value.tickets.length) {
    context.addIssue({ code: "custom", path: ["displayedTickets"], message: "COUPANG_CS_VERIFICATION_DISPLAY_COUNT_MISMATCH" });
  }
  if (value.totalTickets < value.displayedTickets) {
    context.addIssue({ code: "custom", path: ["totalTickets"], message: "COUPANG_CS_VERIFICATION_TOTAL_COUNT_INVALID" });
  }
  if (value.tickets.some((ticket) => !ticket.externalTicketId.startsWith(`${value.kind}:`))) {
    context.addIssue({ code: "custom", path: ["tickets"], message: "COUPANG_CS_VERIFICATION_TICKET_KIND_MISMATCH" });
  }
});

export type CoupangCsVerificationQuery = z.infer<typeof coupangCsVerificationQuerySchema>;
export type CoupangCsVerificationResult = z.infer<typeof coupangCsVerificationResultSchema>;

export function coupangCsVerificationResultMatchesQuery(
  result: CoupangCsVerificationResult,
  query: CoupangCsVerificationQuery,
) {
  return result.credentialId === query.credentialId
    && result.kind === query.kind
    && result.fromDate === query.from
    && result.toDate === query.to
    && result.displayedTickets <= query.limit;
}
