export const gatewayCompletionSchemaErrorCode = "GATEWAY_COMPLETION_SCHEMA_INVALID";
const issueCodes = new Set(["invalid_type", "invalid_value", "invalid_format", "too_small", "too_big", "unrecognized_keys", "not_multiple_of", "invalid_union", "invalid_key", "invalid_element", "custom"]);
// Record keys can be provider-controlled. Retain known contract paths only,
// replacing all other names instead of logging customer values as path text.
const pathNames = new Set(["jobId", "claimToken", "status", "result", "ok", "channel", "operation", "steps", "name", "data", "safeMessage", "error", "credentialRefresh", "credentialBinding", "retryContinuation", "payload", "expiresAt", "contract", "contractVersion", "version", "source", "environment", "providerAccountSubject", "credentialId", "credentialVersion", "sellerAccountKey", "target", "targetId", "targetType", "market", "marketCode", "observedAt", "items", "inquiries", "evidence"]);
type Issue = { path: Array<string | number>; code: string };
type Diagnostic = { code: typeof gatewayCompletionSchemaErrorCode; issues: Issue[] };
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function safeCompletionSchemaIssues(value: unknown): Issue[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap(item => {
    const issue = record(item);
    if (!issue || typeof issue.code !== "string" || !issueCodes.has(issue.code) || !Array.isArray(issue.path)) return [];
    return [{ code: issue.code, path: issue.path.slice(0, 12).map(segment => {
      if (typeof segment === "number" && Number.isSafeInteger(segment) && segment >= 0 && segment <= 1_000_000) return segment;
      return typeof segment === "string" && pathNames.has(segment) ? segment : "[field]";
    }) }];
  });
}

export function completionSchemaDiagnostic(value: unknown): Diagnostic | null {
  const body = record(value);
  if (body?.code !== gatewayCompletionSchemaErrorCode || !Array.isArray(body.issues)) return null;
  return { code: gatewayCompletionSchemaErrorCode, issues: safeCompletionSchemaIssues(body.issues) };
}

/** Inspect only the fixed diagnostic response; never log an arbitrary body. */
export async function readCompletionSchemaDiagnostic(response: Response): Promise<Diagnostic | null> {
  if (response.status !== 400) return null;
  const reader = response.clone().body?.getReader();
  if (!reader) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    const chunks: Uint8Array[] = []; let bytes = 0;
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > 16_384) return null;
      chunks.push(part.value);
    }
    const body = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    try { return completionSchemaDiagnostic(JSON.parse(new TextDecoder().decode(body))); } catch { return null; }
  };
  try {
    return await Promise.race([read(), new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2_000); })]);
  } catch { return null; }
  finally { if (timer) clearTimeout(timer); void reader.cancel().catch(() => {}); }
}

export function gatewayCompletionFailureLog(input: { jobId: unknown; channel: unknown; operation: unknown; status: number; diagnostic?: unknown; now?: Date }) {
  const jobId = typeof input.jobId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(input.jobId) ? input.jobId : "unknown";
  const channel = ["shopee", "lazada", "coupang", "smartstore", "elevenst", "ebay", "qoo10", "temu"].includes(String(input.channel)) ? String(input.channel) : "unknown";
  const operation = typeof input.operation === "string" && /^(inquiries\.(list|reply)|shops\.get|orders\.(list|get)|listing\.(create|update|stop|activate|lineage\.verify|publication\.verify)|categories\.(list|suggest|attributes|validate)|diagnostic\.test|oauth\.exchange|price\.update|inventory\.update|shipment\.(acknowledge|confirm)|competitor\.search)$/u.test(input.operation) ? input.operation : "unknown";
  const diagnostic = completionSchemaDiagnostic(input.diagnostic);
  return { jobId, recordedAt: (input.now ?? new Date()).toISOString(), channel, operation,
    status: Number.isInteger(input.status) && input.status >= 0 && input.status <= 599 ? input.status : 0,
    ...(diagnostic ? { diagnostic } : {}),
  };
}
