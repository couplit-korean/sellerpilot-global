import { createHash } from "node:crypto";
import { z } from "zod";
import { activeChannelKeys, type ActiveChannelKey } from "../channels/catalog";
import { csImportMaxFileBytes, csImportMaxRows } from "./import-limits";

export const csImportContract = "sellerpilot-normalized-cs-export/1" as const;
export const csImportSourceFormat = z.enum(["normalized_json_v1"]);
const sourceRecord = z.object({
  sourceRecordId: z.string().trim().min(1).max(240).nullable().default(null),
  externalTicketId: z.string().trim().min(1).max(240).nullable().default(null),
  remoteMessageId: z.string().trim().min(1).max(240).nullable().default(null),
  customerName: z.string().trim().min(1).max(240),
  subject: z.string().trim().min(1).max(500),
  message: z.string().trim().min(1).max(20_000),
  status: z.enum(["waiting", "resolved"]),
  priority: z.number().int().min(1).max(5).default(3),
  receivedAt: z.string().datetime({ offset: true }),
  senderRole: z.enum(["customer", "seller", "system"]).default("customer"),
  ticketKind: z.enum(["conversation", "after_sales"]).default("conversation"),
  externalOrderReference: z.string().trim().min(1).max(240).nullable().default(null),
  providerContext: z.record(z.string(), z.unknown()).default({}),
}).strict().superRefine((row, context) => {
  if (!row.sourceRecordId && (row.externalTicketId || row.remoteMessageId)) {
    context.addIssue({ code: "custom", message: "provider identifiers require sourceRecordId" });
  }
  if (Buffer.byteLength(JSON.stringify(row.providerContext), "utf8") > 60_000) {
    context.addIssue({ code: "custom", path: ["providerContext"], message: "provider context too large" });
  }
});

export const normalizedCsExportSchema = z.object({
  contract: z.literal(csImportContract),
  channel: z.enum(activeChannelKeys),
  sourceAccountKey: z.string().regex(/^[a-f0-9]{64}$/u),
  records: z.array(sourceRecord).min(1).max(csImportMaxRows),
}).strict();

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export type StagedCsImportRow = z.infer<typeof sourceRecord> & { rowNumber: number; rowDigest: string };
export function prepareCsImportRows(
  records: unknown,
  startRowNumber: number,
  sourceDigest: string,
) {
  if (!Number.isSafeInteger(startRowNumber) || startRowNumber < 1
      || !/^[a-f0-9]{64}$/u.test(sourceDigest)) {
    throw new Error("CS_IMPORT_CHUNK_INVALID");
  }
  const parsed = z.array(sourceRecord).min(1).max(500).parse(records);
  const rows = parsed.map((row, index): StagedCsImportRow => {
    const rowNumber = startRowNumber + index;
    if (!Number.isSafeInteger(rowNumber) || rowNumber > csImportMaxRows) {
      throw new Error("CS_IMPORT_ROW_NUMBER_INVALID");
    }
    return {
      ...row,
      rowNumber,
      rowDigest: sha256(stable(row.sourceRecordId ? row : { sourceDigest, rowNumber, row })),
    };
  });
  for (const row of rows) {
    if (jsonbByteUpperBound(row) > 64_000) throw new Error("CS_IMPORT_ROW_TOO_LARGE");
  }
  return rows;
}
export function prepareCsImport(payload: unknown, expectedChannel: ActiveChannelKey) {
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > csImportMaxFileBytes) throw new Error("CS_IMPORT_FILE_TOO_LARGE");
  const parsed = normalizedCsExportSchema.parse(payload);
  if (parsed.channel !== expectedChannel) throw new Error("CS_IMPORT_CHANNEL_MISMATCH");
  const canonical = stable(parsed);
  const sourceDigest = sha256(canonical);
  const rows = parsed.records.flatMap((_, offset) => offset % 500 === 0
    ? prepareCsImportRows(parsed.records.slice(offset, offset + 500), offset + 1, sourceDigest)
    : []);
  return {
    contract: csImportContract,
    sourceFormat: "normalized_json_v1" as const,
    channel: parsed.channel,
    sourceAccountKey: parsed.sourceAccountKey,
    sourceDigest,
    declaredRowCount: parsed.records.length,
    rows,
  };
}

export const providerExportAdapterInventory = activeChannelKeys.map((channel) => ({
  channel,
  state: "sample_required" as const,
  reason: "판매자센터가 생성한 원본 export와 계정 식별 필드를 검증한 뒤에만 활성화",
}));

// Pretty JSON includes at least the separator whitespace emitted by jsonb::text.
// This conservative UTF-8 bound also covers Korean and escaped characters.
function jsonbByteUpperBound(value: unknown): number {
  const numberExpansion = (item: unknown): number => {
    // jsonb expands exponent notation; any finite JS double fits in 400 bytes.
    if (typeof item === "number") return 400;
    if (Array.isArray(item)) return item.reduce((sum, child) => sum + numberExpansion(child), 0);
    if (item && typeof item === "object") return Object.values(item).reduce<number>((sum, child) => sum + numberExpansion(child), 0);
    return 0;
  };
  return Buffer.byteLength(JSON.stringify(value, null, 1), "utf8") + numberExpansion(value);
}
export function chunkCsImportRows(rows: StagedCsImportRow[]): StagedCsImportRow[][] {
  const chunks: StagedCsImportRow[][] = [];
  let chunk: StagedCsImportRow[] = [];
  let bytes = 2;
  for (const row of rows) {
    const rowBytes = jsonbByteUpperBound(row);
    if (rowBytes > 64_000) throw new Error("CS_IMPORT_ROW_TOO_LARGE");
    if (chunk.length === 500 || bytes + rowBytes + 2 > 1_000_000) {
      chunks.push(chunk); chunk = []; bytes = 2;
    }
    chunk.push(row); bytes += rowBytes + 2;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}
