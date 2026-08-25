import { z } from "zod";

const tracxDeliverySchema = z.object({
  PackingNo: z.string().trim().max(100).optional().default(""),
  TrackingNo: z.string().trim().max(100).optional().default(""),
  DeliveryCompanyCode: z.string().trim().max(40).optional().default(""),
  DeliveryCompanyName: z.string().trim().max(160).optional().default(""),
  StatusCode: z.string().trim().max(20).optional().default(""),
  StatusDesc: z.string().trim().max(240).optional().default(""),
  RefOrderNo: z.string().trim().max(240).optional().default(""),
  Date: z.string().trim().max(40).optional().default(""),
});

export type TracxDeliveryPayload = z.infer<typeof tracxDeliverySchema>;

export function parseTracxDeliveryPayload(input: unknown):
  | { kind: "probe"; event: TracxDeliveryPayload }
  | { kind: "event"; event: TracxDeliveryPayload }
  | null {
  const parsed = tracxDeliverySchema.safeParse(input);
  if (!parsed.success) return null;

  const event = parsed.data;
  const isProbe = !event.PackingNo
    && !event.TrackingNo
    && !event.DeliveryCompanyCode
    && !event.DeliveryCompanyName
    && !event.StatusCode
    && !event.StatusDesc
    && !event.RefOrderNo;
  if (isProbe) return { kind: "probe", event };
  if (!event.StatusCode || (!event.PackingNo && !event.TrackingNo && !event.RefOrderNo)) return null;
  return { kind: "event", event };
}
