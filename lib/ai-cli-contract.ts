import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const studioCoreSchema = z.object({
  product: z.object({
    name: z.string().min(1).max(160),
    category: z.string().min(1).max(120),
    oneLine: z.string().min(1).max(240),
    targetCustomer: z.string().min(1).max(240),
    features: z.array(z.string().min(1).max(240)).min(3).max(5),
    cautions: z.array(z.string().min(1).max(320)).min(1).max(4),
  }),
  design: z.object({
    themeName: z.string().min(1).max(100),
    palette: z.object({ primary: hex, accent: hex, surface: hex, text: hex }),
    heroCopy: z.string().min(1).max(160),
    heroSubcopy: z.string().min(1).max(240),
    cta: z.string().min(1).max(80),
    sections: z.array(z.object({
      type: z.enum(["benefit", "story", "howto", "proof", "spec", "caution"]),
      eyebrow: z.string().min(1).max(80),
      title: z.string().min(1).max(160),
      body: z.string().min(1).max(800),
      points: z.array(z.string().min(1).max(240)).min(2).max(4),
    })).min(5).max(7),
  }),
  thumbnail: z.object({
    headline: z.string().min(1).max(120),
    subline: z.string().min(1).max(120),
    badge: z.string().min(1).max(60),
  }),
  warnings: z.array(z.string().min(1).max(400)).max(5),
});

export const cliStudioResultSchema = studioCoreSchema.extend({ mode: z.literal("cli") });

export const studioJobRequestSchema = z.object({
  jobId: z.string().uuid(),
  description: z.string().max(4_000).optional().default(""),
  productUrl: z.string().max(1_000).optional().default(""),
  imagePaths: z.array(z.string().min(1).max(400)).min(1).max(100),
});

export const workerCompletionSchema = z.discriminatedUnion("status", [
  z.object({
    jobId: z.string().uuid(),
    status: z.literal("succeeded"),
    result: cliStudioResultSchema,
    assetStoragePaths: z.record(
      z.enum(["hero", "square", "portrait", "wide"]),
      z.string().min(1).max(400),
    ),
  }),
  z.object({
    jobId: z.string().uuid(),
    status: z.literal("failed"),
    error: z.string().min(1).max(500),
  }),
]);

export type CliStudioResult = z.infer<typeof cliStudioResultSchema>;
