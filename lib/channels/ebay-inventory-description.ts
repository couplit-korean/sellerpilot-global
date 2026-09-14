const namedEntities: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  bull: "•", middot: "·", hellip: "…", copy: "©", reg: "®", trade: "™",
};

/** Full factual text only: never truncate an ingredient, warning, or quantity. */
export function ebayInventoryDescription(value: unknown): string {
  const html = typeof value === "string" ? value : "";
  const plain = html
    .replace(/<!--[\s\S]*?-->/gu, " ")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, " ")
    .replace(/\{\{SELLERPILOT_IMAGE:[^{}]+\}\}/gu, " ")
    .replace(/<\/?[A-Za-z][^>"']*(?:(?:"[^"]*"|'[^']*')[^>"']*)*>/gu, " ")
    .replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/giu, (entity, key: string) => {
      if (!key.startsWith("#")) return namedEntities[key] ?? entity;
      const hex = /^#x/iu.test(key);
      const point = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
        ? String.fromCodePoint(point) : entity;
    })
    .replace(/\s+/gu, " ").trim();
  if (!plain) throw new Error("EBAY_INVENTORY_DESCRIPTION_EMPTY");
  // UTF-16 length is conservative for supplementary Unicode characters.
  if (plain.length > 4000) throw new Error("EBAY_INVENTORY_DESCRIPTION_TOO_LONG:4000");
  return plain;
}

export function ebayInventoryDescriptionMatches(inventory: unknown, listing: unknown) {
  try {
    return inventory === ebayInventoryDescription(listing);
  } catch {
    return false;
  }
}
