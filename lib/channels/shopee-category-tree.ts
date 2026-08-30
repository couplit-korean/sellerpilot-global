type UnknownRecord = Record<string, unknown>;

export const shopeeSgCableClipCategory = {
  id: "100479",
  ids: ["100013", "100075", "100284", "100479"],
  path: [
    "Mobile & Gadgets",
    "Accessories",
    "Cables, Chargers & Converters",
    "Cable Cases, Protectors, & Winders",
  ],
} as const;

export type ShopeeExactCategoryPath = {
  ids: string[];
  names: string[];
  leafId: string;
};

function recordValue(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function exactText(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function categoryRows(value: unknown) {
  const root = recordValue(value);
  const response = recordValue(root.response);
  const rows = Array.isArray(response.category_list) ? response.category_list : [];
  return rows.map(recordValue).filter((row) => exactText(row.category_id));
}

function booleanValue(value: unknown) {
  return value === true || value === 1 || value === "1" || exactText(value).toLowerCase() === "true";
}

function categoryPath(
  byId: Map<string, UnknownRecord>,
  leaf: UnknownRecord,
): ShopeeExactCategoryPath | null {
  const chain: UnknownRecord[] = [];
  const visited = new Set<string>();
  let current: UnknownRecord | undefined = leaf;
  while (current) {
    const id = exactText(current.category_id);
    if (!id || visited.has(id)) return null;
    visited.add(id);
    chain.unshift(current);
    const parentId = exactText(current.parent_category_id);
    if (!parentId || parentId === "0") break;
    current = byId.get(parentId);
    if (!current) return null;
  }
  const ids = chain.map((row) => exactText(row.category_id));
  const names = chain.map((row) => exactText(row.display_category_name || row.original_category_name));
  if (ids.length < 2 || names.some((name) => !name)
      || chain.slice(0, -1).some((row) => !booleanValue(row.has_children))) return null;
  return { ids, names, leafId: ids.at(-1) ?? "" };
}

export function shopeeExactGlobalCategoryPath(
  remoteData: unknown,
  categoryId: string,
): ShopeeExactCategoryPath | null {
  const rows = categoryRows(remoteData);
  const byId = new Map<string, UnknownRecord>();
  for (const row of rows) {
    const id = exactText(row.category_id);
    if (byId.has(id)) return null;
    byId.set(id, row);
  }
  const leaf = byId.get(categoryId);
  if (!leaf || booleanValue(leaf.has_children)) return null;
  const path = categoryPath(byId, leaf);
  return path?.leafId === categoryId ? path : null;
}

export function shopeeGlobalLeafCategoryPaths(remoteData: unknown) {
  const rows = categoryRows(remoteData);
  const byId = new Map<string, UnknownRecord>();
  for (const row of rows) {
    const id = exactText(row.category_id);
    if (byId.has(id)) return [];
    byId.set(id, row);
  }
  return rows.flatMap((row) => {
    const categoryId = exactText(row.category_id);
    if (!categoryId || booleanValue(row.has_children)) return [];
    const path = categoryPath(byId, row);
    return path ? [path] : [];
  });
}
