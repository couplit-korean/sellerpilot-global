import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompetitorSearchTerms, competitorSearchTerms } from "../../app/_publishing/competitor-search-terms";
import { buildCompetitorResearchRetryPath } from "../../app/_publishing/competitor-research-polling";

test("shows the normalized dispatched product name and localized aliases", () => {
  const requestPath = buildCompetitorResearchRetryPath({ productName: "나랑드 사이다 350ml 24개" }, ["Narangd Cider 350ml 24 cans"]);
  const params = new URLSearchParams(requestPath.split("?")[1]);
  const terms = competitorSearchTerms(requestPath)!;
  assert.equal(terms.query, params.get("query"));
  assert.equal(terms.productName, "나랑드 사이다 350ml 24개");
  const html = renderToStaticMarkup(createElement(CompetitorSearchTerms, { requestPath, state: "ready" }));
  assert.ok(html.includes(terms.query));
  assert.ok(html.includes(terms.aliases[0]));
  assert.match(html, /검색 요청어/);
});

test("edited identity is shown as the next request, never as already searched", () => {
  const requestPath = buildCompetitorResearchRetryPath({ productName: "변경한 상품" });
  const html = renderToStaticMarkup(createElement(CompetitorSearchTerms, { requestPath, state: "stale" }));
  assert.match(html, /검색 예정어/);
  assert.match(html, /아직 이 검색어로 조회하지 않았습니다/);
  assert.doesNotMatch(html, /검색 요청어/);
});

test("failed request does not claim success and query text cannot inject markup", () => {
  const requestPath = `/api/admin/competitor-prices?${new URLSearchParams({ query: '<script>alert("x")</script>' })}`;
  const html = renderToStaticMarkup(createElement(CompetitorSearchTerms, { requestPath, state: "unavailable" }));
  assert.doesNotMatch(html, /<script>|검색 완료/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(competitorSearchTerms(""), null);
  assert.equal(renderToStaticMarkup(createElement(CompetitorSearchTerms, { requestPath, state: "idle" })), "");
});
