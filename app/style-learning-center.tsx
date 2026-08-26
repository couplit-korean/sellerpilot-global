"use client";

import {
  ExternalLink,
  Globe2,
  ImageIcon,
  PackageSearch,
  Search,
  Sparkles,
  Store,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  STYLE_LEARNING_RESEARCH_DATE,
  STYLE_LEARNING_VERSION,
  categoryStyleProfiles,
  channelStyleProfiles,
  learnedProductExamples,
  styleLearningSummary,
  styleTargetMarkets,
} from "../lib/marketplace-style-learning";
const channelMarks: Record<string, string> = {
  qoo10: "큐텐",
  shopee: "쇼피",
  lazada: "라자다",
  coupang: "쿠팡",
  elevenst: "11번가",
  smartstore: "네이버",
  ebay: "이베이",
  temu: "테무",
};

export function StyleLearningCenter() {
  const [categoryId, setCategoryId] = useState(categoryStyleProfiles[0].id);
  const [channelFilter, setChannelFilter] = useState("all");
  const [localeFilter, setLocaleFilter] = useState("all");
  const [query, setQuery] = useState("");

  const category = categoryStyleProfiles.find((item) => item.id === categoryId)
    ?? categoryStyleProfiles[0];
  const categoryExamples = learnedProductExamples.filter((item) => item.categoryId === category.id);
  const filteredExamples = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return categoryExamples.filter((item) => (
      (channelFilter === "all" || item.channel === channelFilter)
      && (localeFilter === "all" || item.locale === localeFilter)
      && (
        !normalizedQuery
        || [item.id, item.product, item.localSearchQuery, item.country, item.language]
          .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
      )
    ));
  }, [categoryExamples, channelFilter, localeFilter, query]);

  const locales = [...new Set(styleTargetMarkets.map((item) => item.locale))];

  return (
    <div className="style-learning-page">
      <section className="style-learning-hero">
        <div>
          <span className="style-learning-kicker">
            <Sparkles size={14} /> PROMPT STYLE REGISTRY · {STYLE_LEARNING_VERSION}
          </span>
          <h2>채널·국가별 상품 스타일 학습 검증</h2>
          <p>
            6개 문안 카테고리의 상품군을 200개씩 나누고, 9개 설정샷 상품군과 8개 채널의
            20개 스타일 검증 프로필을 제목·설명·상세 배치·썸네일·촬영 지침에 연결했습니다.
            실제 AI 등록 문안은 별도의 27개 채널·국가 현지화 계약으로 생성합니다.
          </p>
        </div>
        <div className="style-learning-version">
          <span>조사 기준일</span>
          <strong>{STYLE_LEARNING_RESEARCH_DATE}</strong>
          <small>프롬프트에 버전 고정</small>
        </div>
      </section>

      <section className="style-learning-metrics" aria-label="학습 범위 요약">
        <article><Store size={20} /><span><strong>{styleLearningSummary.categories}</strong><small>대분류</small></span></article>
        <article><ImageIcon size={20} /><span><strong>{styleLearningSummary.settingShotGroups}</strong><small>설정샷 상품군</small></span></article>
        <article><PackageSearch size={20} /><span><strong>{styleLearningSummary.examples}</strong><small>상품 검증 항목</small></span></article>
        <article><Globe2 size={20} /><span><strong>{styleLearningSummary.channels}</strong><small>판매 채널</small></span></article>
        <article><ImageIcon size={20} /><span><strong>{styleLearningSummary.markets}</strong><small>국가·언어 프로필</small></span></article>
        <article><Sparkles size={20} /><span><strong>{styleLearningSummary.promptProfiles}</strong><small>프롬프트 조합</small></span></article>
      </section>

      <section className="style-learning-method panel">
        <div className="style-learning-section-heading">
          <div><span>검증 기준</span><h3>복사가 아니라 규칙을 학습합니다</h3></div>
          <Sparkles size={24} />
        </div>
        <div className="style-learning-method-grid">
          <article>
            <b>01 · 공식 규칙</b>
            <p>채널 API와 판매자 가이드에서 제목 길이, 이미지 수, 필수 속성, 상세설명 형식을 확인합니다.</p>
            <small>{styleLearningSummary.officialSources}개 공식 출처</small>
          </article>
          <article>
            <b>02 · 판매화면 관찰</b>
            <p>대표 검색·상품 화면에서 문장 길이, 키워드 순서, 썸네일 구도와 정보 밀도를 관찰합니다.</p>
            <small>{styleLearningSummary.observationSources}개 대표 화면</small>
          </article>
          <article>
            <b>03 · 1,200개 커버리지</b>
            <p>20개 상품군 × 10개 제작 변형을 카테고리마다 만들고, 현지어 검색 링크로 누락 없이 검증합니다.</p>
            <small>기존 600개와 중복 없는 신규 600개 추가</small>
          </article>
        </div>
        <p className="style-learning-disclosure">
          <b>증거 수준 안내:</b> 아래 1,200개는 각 상품을 모두 수작업으로 복제·저장한 목록이 아니라,
          스타일 프롬프트가 다뤄야 할 상품 유형과 현지어 검색 범위를 빠짐없이 고정한 검증 레지스트리입니다.
          실제 생성 시에는 공식 규칙과 상품 원본 사실이 항상 우선합니다.
        </p>
      </section>

      <section className="style-learning-impact panel">
        <div className="style-learning-section-heading">
          <div><span>ACTUAL OUTPUT EFFECT</span><h3>한 상품 제작 때 실제로 바뀌는 값</h3></div>
          <PackageSearch size={23} />
        </div>
        <div className="style-learning-impact-grid">
          <article><b>SEO 상품명 · 27개</b><p>채널·국가별 핵심 검색어 순서와 제목 길이 규칙을 적용하고 실제 등록 제목 필드로 전달합니다.</p></article>
          <article><b>상품 설명 · 27개</b><p>모바일 요약, 현지어 설명, 검색 키워드를 생성해 각 채널의 설명·검색 필드에 반영합니다.</p></article>
          <article><b>상세 텍스트 · 216개</b><p>서로 다른 구매 질문·근거를 담은 8개 섹션을 27개 채널·국가 프로필별로 생성해 텍스트와 상세 이미지를 교차 배치합니다.</p></article>
          <article><b>이미지 SEO · 243개</b><p>대표 27개·상세 216개의 현지어 시각 의미를 사진 생성 프롬프트에 반영합니다. HTML alt 지원 채널에는 대체텍스트로, 미지원 채널에는 이미지 선택·순서 규칙으로 적용합니다.</p></article>
        </div>
      </section>

      <section className="style-learning-section">
        <div className="style-learning-section-heading">
          <div><span>CHANNEL RULES</span><h3>{styleLearningSummary.channels}개 채널 제작 스타일</h3></div>
          <Store size={23} />
        </div>
        <div className="style-channel-grid">
          {channelStyleProfiles.map((profile) => (
            <article className="style-channel-card panel" key={profile.channel}>
              <header>
                <span className="style-channel-mark">{channelMarks[profile.channel]}</span>
                <div>
                  <h4>{profile.label}</h4>
                  <small>{styleTargetMarkets.filter((item) => item.channel === profile.channel).map((item) => item.market).join(" · ")}</small>
                </div>
              </header>
              <dl>
                <div><dt>제목</dt><dd>{profile.titleFormula}</dd></div>
                <div><dt>설명</dt><dd>{profile.descriptionStyle}</dd></div>
                <div><dt>상세 배치</dt><dd>{profile.detailLayout.join(" → ")}</dd></div>
                <div><dt>썸네일</dt><dd>{profile.thumbnailStyle}</dd></div>
                <div><dt>이미지 샷</dt><dd>{profile.shotList.join(" · ")}</dd></div>
              </dl>
              <div className="style-evidence-links">
                {profile.evidence.map((evidence) => (
                  <a href={evidence.url} target="_blank" rel="noreferrer" key={evidence.url}>
                    <span>{evidence.type === "official" ? "공식" : "관찰"}</span>
                    {evidence.label}
                    <ExternalLink size={12} />
                  </a>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="style-learning-section">
        <div className="style-learning-section-heading">
          <div><span>CATEGORY COVERAGE</span><h3>카테고리별 200개 학습 목록</h3></div>
          <span className="style-learning-count">{categoryExamples.length} / 200</span>
        </div>

        <div className="style-category-tabs" role="tablist" aria-label="카테고리 선택">
          {categoryStyleProfiles.map((item) => (
            <button
              type="button"
              role="tab"
              aria-selected={item.id === category.id}
              className={item.id === category.id ? "active" : ""}
              onClick={() => setCategoryId(item.id)}
              key={item.id}
            >
              <b>{item.label}</b><small>200개</small>
            </button>
          ))}
        </div>

        <article className="style-category-brief panel">
          <div><span>문안 스타일</span><p>{category.textStyle}</p></div>
          <div><span>상세페이지 순서</span><p>{category.detailLayout.join(" → ")}</p></div>
          <div><span>썸네일 방향</span><p>{category.thumbnailStyle}</p></div>
          <div><span>필수 사실</span><p>{category.requiredFacts.join(" · ")}</p></div>
          <div className="wide"><span>20개 학습 상품군</span><p>{category.families.map((family, index) => `${String(index + 1).padStart(2, "0")} ${family}`).join(" · ")}</p></div>
        </article>

        <div className="style-learning-filters">
          <label>
            <span className="visually-hidden">목록 검색</span>
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품명·현지어·국가 검색" />
          </label>
          <select aria-label="채널 필터" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}>
            <option value="all">전체 채널</option>
            {channelStyleProfiles.map((profile) => <option value={profile.channel} key={profile.channel}>{profile.label}</option>)}
          </select>
          <select aria-label="언어 필터" value={localeFilter} onChange={(event) => setLocaleFilter(event.target.value)}>
            <option value="all">전체 언어</option>
            {locales.map((locale) => <option value={locale} key={locale}>{locale}</option>)}
          </select>
          <span><b>{filteredExamples.length}</b>개 표시</span>
        </div>

        <div className="style-learning-table-wrap panel">
          <table className="style-learning-table">
            <thead>
              <tr><th>번호</th><th>학습 상품</th><th>채널 · 국가</th><th>언어</th><th>현지어 검색 문구</th><th>검증</th></tr>
            </thead>
            <tbody>
              {filteredExamples.map((item) => (
                <tr key={item.id}>
                  <td><code>{item.id.split("-").at(-1)}</code></td>
                  <td><b>{item.product}</b><small>{item.variant}</small></td>
                  <td><span className="style-table-channel"><i>{channelMarks[item.channel]}</i>{item.channel} · {item.country} ({item.market})</span></td>
                  <td><b>{item.locale}</b><small>{item.language}</small></td>
                  <td>{item.localSearchQuery}</td>
                  <td><a href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label={`${item.product} 현지 판매화면 검색`}><ExternalLink size={13} />검색</a></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredExamples.length === 0 ? <div className="style-learning-empty">조건에 맞는 항목이 없습니다.</div> : null}
        </div>
      </section>
    </div>
  );
}
