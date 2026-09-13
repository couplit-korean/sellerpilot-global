import type { CompetitorResearchUiState } from "./competitor-research-polling";

/** Read the dispatched request, not the subsequently edited product fields. */
export function competitorSearchTerms(requestPath: string) {
  if (!requestPath.startsWith("/api/admin/competitor-prices?")) return null;
  const params = new URLSearchParams(requestPath.slice(requestPath.indexOf("?") + 1));
  const query = params.get("query")?.trim();
  if (!query) return null;
  return {
    productName: params.get("productName")?.trim() || null,
    query,
    aliases: [...new Set(params.getAll("alias").map((value) => value.trim()).filter((value) => value && value !== query))],
  };
}

export function CompetitorSearchTerms({ requestPath, state }: {
  requestPath: string;
  state: CompetitorResearchUiState;
}) {
  const terms = competitorSearchTerms(requestPath);
  if (!terms || state === "idle") return null;
  const stale = state === "stale";
  return <section aria-label="유사상품 검색 기준" style={{ padding: "12px 14px", border: "1px solid var(--border, #e5e7eb)", borderRadius: 10, overflowWrap: "anywhere" }}>
    <b>{stale ? "다음 유사상품 검색 기준" : "이번 유사상품 검색 기준"}</b>
    <dl style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "6px 12px", margin: "10px 0" }}>
      {terms.productName && <><dt>기준 상품명</dt><dd style={{ margin: 0 }}>{terms.productName}</dd></>}
      <dt>{stale ? "검색 예정어" : "검색 요청어"}</dt><dd style={{ margin: 0 }}><strong>{terms.query}</strong></dd>
    </dl>
    {terms.aliases.length > 0 && <details><summary>보조 검색어 {terms.aliases.length}개 보기</summary><ul>{terms.aliases.map((alias) => <li key={alias}>{alias}</li>)}</ul></details>}
    <small>{stale
      ? "상품 정보가 변경되어 아직 이 검색어로 조회하지 않았습니다. 다시 확인하면 새 기준으로 검색합니다."
      : "수량·묶음 표현을 정리한 상품명과 보조 검색어를 요청했습니다. 채널별 조회 완료 여부는 아래에 표시됩니다."}</small>
  </section>;
}
