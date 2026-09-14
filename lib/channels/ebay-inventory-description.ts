const namedEntities: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  bull: "•", middot: "·", hellip: "…", copy: "©", reg: "®", trade: "™",
};

function inventoryPlainText(html: string): string {
  return html
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
}

/**
 * The full Offer keeps the approved detail and source annotations. Inventory
 * has a separate 4,000-character limit: when necessary, omit only the marked
 * editorial questions and provenance notes of our eight-section renderer.
 * Keep every product paragraph, section heading/body, and classification.
 * Unmarked HTML and oversized factual content still fail without truncation.
 */
export function ebayInventoryDescription(value: unknown): string {
  const html = typeof value === "string" ? value : "";
  let plain = inventoryPlainText(html);
  if (plain.length > 4000
      && /<div\b[^>]*\bdata-sellerpilot-localized-detail="true"[^>]*\bdata-sellerpilot-section-count="8"[^>]*>/u.test(html)
      && (html.match(/<section\b[^>]*\bdata-sellerpilot-section="(?:overview|feature|howto|spec|routine|contents|care|proof)"[^>]*>/gu) ?? []).length === 8) {
    plain = inventoryPlainText(html
      .replace(/<p\b[^>]*\bdata-sellerpilot-buyer-question="true"[^>]*>[\s\S]*?<\/p\s*>/gu, " ")
      .replace(/<aside\b[^>]*\bdata-sellerpilot-evidence="true"[^>]*>[\s\S]*?<\/aside\s*>/gu, " "));
  }
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
