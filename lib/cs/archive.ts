import { z } from "zod";
import { activeChannelKeys } from "../channels/catalog";

export const archiveCursorSchema=z.object({beforeTime:z.string().datetime({offset:true}),beforeId:z.string().uuid(),asOf:z.string().datetime({offset:true})});
export const archiveFiltersSchema=z.object({
 query:z.string().trim().max(120).default(""),channel:z.enum(activeChannelKeys).nullable().default(null),
 status:z.enum(["waiting","urgent","in_progress","resolved"]).nullable().default(null),
 from:z.string().date().nullable().default(null),to:z.string().date().nullable().default(null),
}).refine(value=>!value.from||!value.to||value.from<=value.to,{message:"시작일은 종료일보다 늦을 수 없습니다."});
export const archivePageSchema=z.object({
 tickets:z.array(z.object({id:z.string().uuid(),channel:z.enum(activeChannelKeys),externalId:z.string(),customer:z.string(),subject:z.string(),preview:z.string(),
  status:z.enum(["waiting","urgent","in_progress","resolved"]),receivedAt:z.string().datetime({offset:true})})).max(50),
 asOf:z.string().datetime({offset:true}),nextCursor:archiveCursorSchema.nullable(),
});
export type ArchiveFilters=z.infer<typeof archiveFiltersSchema>;
export type ArchivePage=z.infer<typeof archivePageSchema>;
