import { z } from "zod";

export const productDetailDataQuerySchema = z.object({
  productId: z.string().uuid(),
});

export const productDetailDataBodySchema = z.object({
  productId: z.string().uuid(),
  detailData: z.object({
    root: z.record(z.string(), z.unknown()).optional(),
    content: z.array(z.object({ type: z.string().min(1).max(80) }).passthrough()).max(200),
    zones: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
});

