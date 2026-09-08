export function finiteCount(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function objectValue(source: Record<string, unknown>, key: string, required = true) {
  const value = source[key];
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (!required) return {};
  throw new Error(`CHANNEL_ARGUMENT_REQUIRED:${key}`);
}

export function stringArgument(source: Record<string, unknown>, key: string, required = true) {
  const value = source[key];
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (!required) return "";
  throw new Error(`CHANNEL_ARGUMENT_REQUIRED:${key}`);
}

export function integerArgument(source: Record<string, unknown>, key: string, options?: { min?: number; max?: number }) {
  const raw = source[key];
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isInteger(value) || value < (options?.min ?? 0) || value > (options?.max ?? Number.MAX_SAFE_INTEGER)) {
    throw new Error(`CHANNEL_ARGUMENT_INVALID:${key}`);
  }
  return value;
}

export function objectArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

export function boundedPageSize(value: unknown, fallback: number, max: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

export function nestedObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function providerRecordCount(data: Record<string, unknown>, keys: string[]) {
  for (const value of [data.data, data.response, data.result]) {
    if (Array.isArray(value)) return value.length;
  }
  const roots = [data, nestedObject(data.data), nestedObject(data.response), nestedObject(data.result)];
  for (const root of roots) {
    for (const key of keys) {
      if (Array.isArray(root[key])) return root[key].length;
    }
    const content = nestedObject(root.content);
    for (const key of keys) {
      if (Array.isArray(content[key])) return content[key].length;
    }
  }
  return 0;
}

export function stringMap(source: Record<string, unknown>, key: string, required = false) {
  const value = objectValue(source, key, required);
  const entries = Object.entries(value).filter((entry): entry is [string, string | number | boolean] =>
    typeof entry[1] === "string" || typeof entry[1] === "number" || typeof entry[1] === "boolean",
  );
  return Object.fromEntries(entries.map(([name, item]) => [name, String(item)]));
}

export function queryParams(source: Record<string, unknown>, key = "query") {
  return new URLSearchParams(stringMap(source, key));
}

export function pathSegment(value: string) {
  return encodeURIComponent(value);
}
