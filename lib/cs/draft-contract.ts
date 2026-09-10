import { z } from "zod";
export const supportReplyLocaleSchema = z.enum([
  "ko-KR", "en-US", "ja-JP", "zh-TW", "th-TH", "vi-VN", "id-ID", "ms-MY", "pt-BR", "es-MX",
]);

export const supportReplyJobRequestSchema = z.object({
  jobId: z.string().uuid(),
  ticketId: z.string().uuid(),
  expectedInboundKey: z.string().min(1).max(500),
  targetLocale: supportReplyLocaleSchema,
  tone: z.enum(["polite", "concise", "apologetic"]).default("polite"),
});

export const supportReplyResultSchema = z.object({
  mode: z.literal("support-reply"),
  targetLocale: supportReplyLocaleSchema,
  draft: z.string().trim().min(10).max(4_000),
  sourceSummary: z.string().trim().min(1).max(1_000),
  cautions: z.array(z.string().trim().min(1).max(300)).max(5),
});

export const supportReplyWorkerRequestSchema = z.object({
  ticket_id: z.string().uuid(),
  sellerpilotInboundKey: z.string().min(1).max(500),
  channel: z.enum(["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu"]),
  target_locale: supportReplyLocaleSchema,
  tone: z.enum(["polite", "concise", "apologetic"]),
  subject: z.string().trim().max(500),
  message: z.string().trim().min(1).max(12_000),
  order: z.object({
    external_order_id: z.string().trim().max(240),
    product_name: z.string().trim().max(500),
    quantity: z.number().int().min(0).max(1_000_000),
    status: z.string().trim().max(80),
    ordered_at: z.string().datetime({ offset: true }).nullable(),
    shipped_at: z.string().datetime({ offset: true }).nullable(),
  }).strict().nullable(),
}).strict();

export type SupportReplyResult = z.infer<typeof supportReplyResultSchema>;
