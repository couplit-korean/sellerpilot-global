// CS ingestion must distinguish a verified empty list from a response we could
// not decode. Never acknowledge an unknown shape as successfully imported.
export function inquiryRows(channel: string, ...candidates: unknown[]): Record<string, unknown>[] {
  const value = candidates.find((candidate) => candidate !== undefined && candidate !== null);
  if (!Array.isArray(value) || value.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error(`INQUIRY_PAGE_INVALID:${channel}`);
  }
  return value as Record<string, unknown>[];
}

export function inquiryHasNextPage(input: {
  channel: string;
  count: number;
  page: number;
  pageSize: number;
  totalPages: number | null;
}) {
  const { channel, count, page, pageSize, totalPages } = input;
  if (totalPages !== null) {
    if (!Number.isInteger(totalPages) || (count === 0 && page < totalPages)) {
      throw new Error(`INQUIRY_PAGINATION_INCONSISTENT:${channel}`);
    }
    return page < totalPages;
  }
  return count >= pageSize;
}
