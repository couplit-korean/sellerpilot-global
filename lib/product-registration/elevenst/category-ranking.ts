type CategoryText = {categoryName: string; categoryPath: string; depth: number};

// Size/pack count describe the item, not its category. In the actual receipt,
// bare "500" matched HDD capacities and "제로" matched "주제로 읽는 역사".
const nonCategoryWords = new Set([
  "제로", "zero", "세트", "set", "개입", "묶음", "입", "개", "병", "팩", "박스",
  "ml", "l", "g", "kg", "mg", "mm", "cm", "m", "gb", "tb", "mb", "oz", "pcs", "pack",
]);
const normalize = (value: string) => value.normalize("NFKC").toLowerCase();
function words(value: string) {
  return [...new Set((normalize(value).match(/[\p{L}]+/gu) ?? [])
    .filter(word => word.length > 1 && !nonCategoryWords.has(word)))];
}
function matches(queryWord: string, categoryWord: string) {
  // Category terms embedded in a Korean product name still count (for example
  // 나랑드사이다 -> 사이다). The inverse only accepts a category-word prefix;
  // an arbitrary interior substring must not turn 제로 into 주제로.
  return queryWord.includes(categoryWord) || categoryWord.startsWith(queryWord);
}
function measurements(value: string) {
  return normalize(value).match(/\d+(?:\.\d+)?\s*(?:ml|kg|mg|mm|cm|gb|tb|mb|oz|l|g)(?![a-z])/gu)
    ?.map(item => item.replace(/\s+/gu, "")) ?? [];
}

export function scoreElevenstCategory(query: string, category: CategoryText) {
  const queryWords = words(query);
  if (!queryWords.length) return 0;
  const leafWords = words(category.categoryName);
  const pathWords = words(category.categoryPath.split(">").slice(0, -1).join(" "));
  const leafMatches = leafWords.filter(word => queryWords.some(queryWord => matches(queryWord, word))).length;
  const pathMatches = pathWords.filter(word => queryWords.some(queryWord => matches(queryWord, word))).length;
  const normalizedQuery = normalize(query);
  const candidate = normalize(`${category.categoryPath} ${category.categoryName}`);
  // Preserve the already verified cable-organizer distinction from cable ties.
  const cableOrganizerBoost = /(케이블|전선|cable|cord)/u.test(normalizedQuery)
    && /(정리|클립|홀더|organizer|clip)/u.test(normalizedQuery)
    && /(케이블|전선).*(정리|클립|홀더)|(?:정리|클립|홀더).*(?:케이블|전선)/u.test(candidate) ? 1_000 : 0;
  const cableClipLeafBoost = /(클립|clip|holder)/u.test(normalizedQuery)
    && /케이블\s*정리소품/u.test(category.categoryName) ? 400 : 0;
  const relevance = leafMatches * 450 + pathMatches * 100 + cableOrganizerBoost + cableClipLeafBoost;
  if (relevance === 0) return 0;
  // Matching capacity can break a tie after HDD/SSD (or another meaningful
  // category term) matches; a number or unit can never admit a candidate.
  const candidateMeasurements = new Set(measurements(candidate));
  const measurementTie = measurements(query).filter(value => candidateMeasurements.has(value)).length;
  return relevance + Math.min(measurementTie, 3) + Math.min(Math.max(category.depth, 0), 20) / 100;
}
