import type { ActiveChannelKey } from "./channels/catalog";

export const STYLE_LEARNING_VERSION = "2026.08.29-r6";
export const STYLE_LEARNING_RESEARCH_DATE = "2026-08-29";

export type StyleLocale =
  | "ko-KR"
  | "ja-JP"
  | "en-US"
  | "en-SG"
  | "ms-MY"
  | "en-PH"
  | "vi-VN"
  | "th-TH"
  | "zh-TW"
  | "pt-BR"
  | "es-MX"
  | "id-ID"
  | "en-GB"
  | "de-DE"
  | "en-AU"
  | "en-CA"
  | "fr-FR"
  | "it-IT"
  | "es-ES"
  | "de-AT"
  | "nl-BE"
  | "de-CH"
  | "zh-HK"
  | "en-IE"
  | "nl-NL"
  | "pl-PL";

type LearnedSearchLocale = Exclude<StyleLocale,
  | "en-GB"
  | "de-DE"
  | "en-AU"
  | "en-CA"
  | "fr-FR"
  | "it-IT"
  | "es-ES"
  | "de-AT"
  | "nl-BE"
  | "de-CH"
  | "zh-HK"
  | "en-IE"
  | "nl-NL"
  | "pl-PL"
>;

export type StyleTargetMarket = {
  channel: ActiveChannelKey;
  market: string;
  country: string;
  locale: StyleLocale;
  language: string;
};

export type StyleEvidence = {
  type: "official" | "market-observation";
  label: string;
  url: string;
  note: string;
};

export type ChannelStyleProfile = {
  channel: ActiveChannelKey;
  label: string;
  titleFormula: string;
  descriptionStyle: string;
  detailLayout: string[];
  thumbnailStyle: string;
  shotList: string[];
  guardrails: string[];
  evidence: StyleEvidence[];
};

export type CategoryStyleProfile = {
  id: "beauty-skincare" | "beauty-tools" | "food-staples" | "men-tops" | "toys-games" | "food-supplement";
  label: string;
  aliases: string[];
  families: string[];
  searchTerms: Record<LearnedSearchLocale, string>;
  textStyle: string;
  detailLayout: string[];
  thumbnailStyle: string;
  shotList: string[];
  requiredFacts: string[];
  guardrails: string[];
};

export type LearnedProductExample = {
  id: string;
  categoryId: CategoryStyleProfile["id"];
  category: string;
  product: string;
  variant: string;
  channel: ActiveChannelKey;
  market: string;
  country: string;
  locale: StyleLocale;
  language: string;
  localSearchQuery: string;
  sourceUrl: string;
  evidenceLevel: "coverage-search";
};

export const styleTargetMarkets: StyleTargetMarket[] = [
  { channel: "qoo10", market: "JP", country: "일본", locale: "ja-JP", language: "日本語" },
  { channel: "shopee", market: "SG", country: "싱가포르", locale: "en-SG", language: "English" },
  { channel: "shopee", market: "MY", country: "말레이시아", locale: "ms-MY", language: "Bahasa Melayu" },
  { channel: "shopee", market: "PH", country: "필리핀", locale: "en-PH", language: "English" },
  { channel: "shopee", market: "VN", country: "베트남", locale: "vi-VN", language: "Tiếng Việt" },
  { channel: "shopee", market: "TH", country: "태국", locale: "th-TH", language: "ไทย" },
  { channel: "shopee", market: "TW", country: "대만", locale: "zh-TW", language: "繁體中文" },
  { channel: "shopee", market: "BR", country: "브라질", locale: "pt-BR", language: "Português" },
  { channel: "shopee", market: "MX", country: "멕시코", locale: "es-MX", language: "Español" },
  { channel: "lazada", market: "MY", country: "말레이시아", locale: "ms-MY", language: "Bahasa Melayu" },
  { channel: "lazada", market: "SG", country: "싱가포르", locale: "en-SG", language: "English" },
  { channel: "lazada", market: "PH", country: "필리핀", locale: "en-PH", language: "English" },
  { channel: "lazada", market: "TH", country: "태국", locale: "th-TH", language: "ไทย" },
  { channel: "lazada", market: "VN", country: "베트남", locale: "vi-VN", language: "Tiếng Việt" },
  { channel: "lazada", market: "ID", country: "인도네시아", locale: "id-ID", language: "Bahasa Indonesia" },
  { channel: "coupang", market: "KR", country: "대한민국", locale: "ko-KR", language: "한국어" },
  { channel: "elevenst", market: "KR", country: "대한민국", locale: "ko-KR", language: "한국어" },
  { channel: "smartstore", market: "KR", country: "대한민국", locale: "ko-KR", language: "한국어" },
  { channel: "ebay", market: "US", country: "미국", locale: "en-US", language: "English" },
  { channel: "ebay", market: "GB", country: "영국", locale: "en-GB", language: "English" },
  { channel: "ebay", market: "DE", country: "독일", locale: "de-DE", language: "Deutsch" },
  { channel: "ebay", market: "AU", country: "호주", locale: "en-AU", language: "English" },
  { channel: "ebay", market: "CA", country: "캐나다", locale: "en-CA", language: "English" },
  { channel: "ebay", market: "FR", country: "프랑스", locale: "fr-FR", language: "Français" },
  { channel: "ebay", market: "IT", country: "이탈리아", locale: "it-IT", language: "Italiano" },
  { channel: "ebay", market: "ES", country: "스페인", locale: "es-ES", language: "Español" },
  { channel: "ebay", market: "AT", country: "오스트리아", locale: "de-AT", language: "Deutsch" },
  { channel: "ebay", market: "BE", country: "벨기에", locale: "nl-BE", language: "Nederlands" },
  { channel: "ebay", market: "CH", country: "스위스", locale: "de-CH", language: "Deutsch" },
  { channel: "ebay", market: "HK", country: "홍콩", locale: "zh-HK", language: "繁體中文" },
  { channel: "ebay", market: "IE", country: "아일랜드", locale: "en-IE", language: "English" },
  { channel: "ebay", market: "NL", country: "네덜란드", locale: "nl-NL", language: "Nederlands" },
  { channel: "ebay", market: "PL", country: "폴란드", locale: "pl-PL", language: "Polski" },
  { channel: "temu", market: "KR", country: "대한민국", locale: "ko-KR", language: "한국어" },
];

export const channelStyleProfiles: ChannelStyleProfile[] = [
  {
    channel: "qoo10",
    label: "Qoo10 Japan",
    titleFormula: "〖공식·정품·세트 등 확인된 표지〗 + 상품유형 + 핵심 규격/용량 + 선택옵션 + 검색 보조어. 일본어로 읽히되 검색어를 앞쪽에 둔다.",
    descriptionStyle: "짧은 일본어 구매 요약 뒤에 구성, 사용법, 주의, 배송 관련 사실을 소제목과 짧은 문장으로 배치한다. 쿠폰·판매량·순위는 실데이터가 없으면 쓰지 않는다.",
    detailLayout: ["상품·구성 즉시 인지", "확인된 핵심 특징", "용량·옵션", "사용/섭취 방법", "실물과 패키지", "주의·법정 표시"],
    thumbnailStyle: "1:1 고채도 또는 밝은 배경, 제품을 크게 배치하고 세트 구성은 한눈에 보이게 한다. 텍스트를 넣을 때는 확인된 짧은 일본어 1개만 사용한다.",
    shotList: ["정면 패키지", "세트 전체", "제형·재질 근접", "손/크기 비교", "사용 장면", "후면 표시"],
    guardrails: ["메가割·쿠폰·판매량·공식 표시는 증빙 없이는 생성 금지", "일본어에 한국어 조사나 직역 어순을 남기지 않음", "제품 라벨·로고·용량 변경 금지"],
    evidence: [
      { type: "official", label: "QAPI Guide", url: "https://api.qoo10.jp/GMKT.INC.Front.QAPIService/Document/QAPIGuideIndex.aspx", note: "상품명·대표이미지·HTML 상세 등록 경로" },
      { type: "market-observation", label: "Qoo10 美容液 검색", url: "https://www.qoo10.jp/gmkt.inc/Search/Default.aspx?gdlc_cd=120000012&keyword=%E7%BE%8E%E5%AE%B9%E6%B6%B2", note: "일본어 제목의 괄호형 표지, 용량, 세트, 성분 검색어 배치" },
    ],
  },
  {
    channel: "shopee",
    label: "Shopee Global",
    titleFormula: "현지어 상품유형 + 확인된 특징/재질 + 규격·수량 + 대상/용도 + 변형명. 핵심 검색어를 앞 60자 안에 두고 같은 단어 반복은 피한다.",
    descriptionStyle: "모바일에서 바로 읽는 1~2문장 요약, 3~5개 사실형 포인트, 규격·구성·사용법·주의 순서. 국가별 자연스러운 어휘와 단위를 사용한다.",
    detailLayout: ["핵심 베네핏 요약", "제품 실물", "특징 3개", "규격·구성", "사용법", "비교/옵션", "주의·표시"],
    thumbnailStyle: "1:1, 제품 70~85%, 밝은 파스텔 또는 흰 배경. 보조 이미지에는 성분·구성 아이콘과 짧은 현지어를 쓸 수 있으나 대표이미지는 제품 식별을 우선한다.",
    shotList: ["정면 히어로", "45도 입체컷", "구성품 플랫레이", "텍스처/디테일", "사용 맥락", "치수·옵션", "패키지 표시"],
    guardrails: ["할인·무료배송·COD·판매량은 채널 UI가 제공하므로 이미지에 고정하지 않음", "의학·기능성·최상급 표현은 근거 없으면 금지", "SG·MY·PH·VN·TH·TW·BR·MX 언어를 각각 검증"],
    evidence: [
      { type: "official", label: "Shopee Open Platform", url: "https://open.shopee.com/documents", note: "국가별 카테고리·필수속성·상품·미디어 API" },
      { type: "market-observation", label: "Shopee SG moisturizer", url: "https://shopee.sg/Centella-Asiatica-Moisturizing-Cream-20g-with-Niacinamide-Hyaluronic-Acid-Salmon-Roe-Extract-for-Intense-Hydration-Sensitive-Skin-Soothing-Upgraded-i.1006220784.52402789277", note: "제품+모델, 성분·용량·혜택을 결합한 썸네일과 키워드형 제목" },
    ],
  },
  {
    channel: "lazada",
    label: "Lazada SEA",
    titleFormula: "현지어 상품유형 + 브랜드/모델 + 핵심 속성 + 크기·수량 + 변형. 255자 한도보다 가독성을 우선하고 카테고리 속성과 중복되는 나열은 줄인다.",
    descriptionStyle: "짧은 설명은 텍스트/목록만, 긴 설명은 이미지와 제한된 HTML을 섞는다. 특징·사양·패키지·사용법을 분명한 블록으로 나눈다.",
    detailLayout: ["브랜드/제품 히어로", "핵심 특징 카드", "재질·성분", "사양·치수", "사용 시나리오", "구성·옵션", "주의·보증"],
    thumbnailStyle: "1:1 밝은 배경, 제품 중심의 상업 사진. 보조컷은 파스텔 그라데이션·사용 장면·특징 아이콘을 사용하되 작은 글자 밀도를 낮춘다.",
    shotList: ["정면 제품", "입체 제품", "기능 근접", "구성품", "사용 장면", "크기 비교", "라벨/스펙"],
    guardrails: ["외부 이미지는 Lazada 내부 링크로 변환", "국가별 카테고리·브랜드·옵션 차이를 재사용하지 않음", "긴 설명의 외부 링크와 과장 문구 금지"],
    evidence: [
      { type: "official", label: "Lazada Product API", url: "https://open.lazada.com/apps/doc/doc?docId=121541&nodeId=45661", note: "최대 8개 이미지, 255자 상품명, HTML 긴 설명, 제한 태그 짧은 설명" },
      { type: "market-observation", label: "Lazada MY beauty tools", url: "https://h5.lazada.com.my/shop-brushes-applicators/?q=barangan+kosmetik", note: "말레이어/영어 혼합 검색어, 세트 수량, 소재·용도 중심 제목" },
    ],
  },
  {
    channel: "coupang",
    label: "쿠팡",
    titleFormula: "브랜드 + 일반 상품명 + 모델/핵심 속성 + 용량·수량 + 옵션. 한국어 명사형으로 쓰고 배송·할인·주관적 수식어는 제외한다.",
    descriptionStyle: "구매 판단에 필요한 사실을 먼저 제시하고 상세이미지 뒤에 정확한 옵션·규격·사용법·상품정보 제공고시를 둔다.",
    detailLayout: ["제품 인지", "핵심 사실 3개", "규격·용량", "실물 디테일", "사용법", "옵션/구성", "상품정보 제공고시"],
    thumbnailStyle: "순백 또는 매우 옅은 중성 배경, 상품 전체 정면, 여백 균일, 그림자 최소. 배지·가격·배송·워터마크를 넣지 않는다.",
    shotList: ["정면 누끼형", "후면/측면", "구성품", "재질 근접", "크기 비교", "사용 장면", "표시사항"],
    guardrails: ["노출상품명 100자 이내", "필수 구매옵션·단위는 카테고리 메타 응답만 사용", "로켓배송·쿠팡추천·후기 수치를 제작물에 삽입 금지"],
    evidence: [
      { type: "official", label: "쿠팡 상품 생성 가이드", url: "https://developers.coupang.com/ko/getting-started/guide-to-creating-product-listings", note: "카테고리별 필수 구매옵션과 허용 단위" },
      { type: "market-observation", label: "쿠팡 스킨케어", url: "https://www.coupang.com/np/categories/522058", note: "상품유형·용량·개수 중심 제목과 단위 가격 표현" },
    ],
  },
  {
    channel: "elevenst",
    label: "11번가",
    titleFormula: "브랜드 + 상품유형 + 모델/핵심 속성 + 용량·수량 + 옵션. 검색 정확도를 위해 확인된 브랜드·모델과 규격을 구조화 필드와 일치시키고 프로모션 문구는 제외한다.",
    descriptionStyle: "모바일에서 먼저 읽히는 핵심 구성·규격·사용법을 짧은 블록으로 배치하고, 상품정보 제공고시와 원산지·배송 조건은 확인된 구조화 값으로 분리한다.",
    detailLayout: ["상품·구성 즉시 인지", "핵심 특징", "규격·옵션", "실물 디테일", "사용 방법", "구성·패키지", "상품정보 제공고시"],
    thumbnailStyle: "최소 600×600 이상의 선명한 정사각 이미지에서 실제 상품 전체와 구성 수량을 우선한다. 가격·할인·배송·랭킹 문구를 이미지에 고정하지 않는다.",
    shotList: ["정면 대표", "45도 전체", "구성품", "재질·내용물 근접", "크기 비교", "사용 장면", "후면 표시"],
    guardrails: ["브랜드·모델·옵션을 상품 사실과 다르게 생성하지 않음", "랭킹·최저가·쿠폰·판매량·공식 표시는 실데이터와 권한 없이는 삽입 금지", "동일 상품 중복 등록과 무관 검색어 나열 금지"],
    evidence: [
      { type: "official", label: "11번가 모바일 상품등록 정책", url: "https://www.11st.co.kr/tpost/FrontTPostAction.tmall?NtceNo=856123&method=getNoticeView&type=so", note: "대표·추가·목록 이미지 최소 600×600 및 모바일 상품정보 정책" },
      { type: "market-observation", label: "11번가 식품 검색", url: "https://www.11st.co.kr/category/DisplayCategory.tmall?dispCtgrNo=1148829&method=getDisplayCategory2Depth", note: "브랜드·상품유형·중량·수량 중심 제목과 정사각 제품 이미지" },
    ],
  },
  {
    channel: "smartstore",
    label: "네이버 스마트스토어",
    titleFormula: "브랜드 + 상품유형 + 핵심 속성 + 규격/수량 + 옵션. 검색어를 자연스러운 한국어 상품명 안에 한 번씩 배치한다.",
    descriptionStyle: "긴 세로형 860px 콘텐츠를 이미지와 실제 텍스트 블록으로 구성한다. 상단 요약, 근거, 사용법, 규격, FAQ, 정보고시 순으로 검색성과 접근성을 함께 확보한다.",
    detailLayout: ["한 줄 가치제안", "실물 히어로", "핵심 특징", "근거·재질/성분", "사용법", "규격·옵션", "FAQ", "상품정보 제공고시"],
    thumbnailStyle: "1000×1000 이상 정사각 권장, 밝고 단정한 배경, 상품을 크게 보이되 과도한 문구·테두리·검색어 나열은 피한다.",
    shotList: ["정면 대표", "45도", "핵심 디테일", "구성", "사용 장면", "치수/사이즈", "후면 정보"],
    guardrails: ["대표이미지 1개와 추가이미지 최대 9개", "원산지·상품정보 제공고시는 구조화 필드와 일치", "타사 상표·무관 키워드·가짜 후기 금지"],
    evidence: [
      { type: "official", label: "네이버 원상품 구조체", url: "https://apicenter.commerce.naver.com/docs/commerce-api/current/schemas/%EC%9B%90%EC%83%81%ED%92%88-%EC%A0%95%EB%B3%B4-%EA%B5%AC%EC%A1%B0%EC%B2%B4", note: "필수 상세정보, 1000×1000 권장 대표이미지와 추가이미지 9개" },
      { type: "official", label: "네이버 상품정보 제공고시", url: "https://apicenter.commerce.naver.com/docs/commerce-api/current/get-all-product-info-provided-notice-type-vo-product", note: "상품군별 법정 표시 구조" },
      { type: "market-observation", label: "네이버쇼핑 스킨케어 검색", url: "https://search.shopping.naver.com/search/all?query=%EC%8A%A4%ED%82%A8%EC%BC%80%EC%96%B4%20%EB%B3%B4%EC%8A%B5%20%EC%84%B8%EB%9F%BC", note: "한국어 상품유형·용량·구성 중심의 제목과 정사각 제품 중심 대표이미지" },
    ],
  },
  {
    channel: "ebay",
    label: "eBay US",
    titleFormula: "Brand + product type + model + key attribute + size/count + condition-relevant term. 가장 중요한 영문 검색어를 앞에 두고 80자 안에서 중복을 제거한다.",
    descriptionStyle: "검정 14pt 단일 글꼴에 가까운 단순 HTML/텍스트. condition, included items, measurements, features, shipping-independent notes 순으로 짧게 쓴다.",
    detailLayout: ["정확한 condition", "포함 구성", "핵심 특징", "item specifics", "치수·재질", "사용/호환 정보", "주의"],
    thumbnailStyle: "제품 전체가 보이는 정면 주사진, 중립 또는 흰 배경, 1:1 우선. 배지·로고 추가·워터마크·테두리·프로모션 문구를 넣지 않는다.",
    shotList: ["정면 전체", "후면", "측면", "라벨/모델", "결함 근접", "구성품", "크기 비교", "사용 맥락"],
    guardrails: ["제목 최대 80자", "최소 1장·최대 24장, HTTPS 이미지", "사진과 condition description이 충돌하지 않음", "item specifics를 본문 키워드 나열로 대체하지 않음"],
    evidence: [
      { type: "official", label: "eBay Inventory Product", url: "https://developer.ebay.com/api-docs/sell/inventory/types/slr%3AProduct", note: "title·description·aspects·imageUrls 구조와 이미지 수" },
      { type: "official", label: "eBay picture guide", url: "https://www.ebay.com/help/selling/listings/adding-pictures-listings?id=4148", note: "정면 전체, 중립 배경, 다각도, 그래픽·워터마크 금지" },
      { type: "market-observation", label: "eBay beauty tools", url: "https://www.ebay.com/shop/makeup-tools-accessories?_nkw=makeup+tools+accessories", note: "상품유형·세트 수량·재질·상태를 앞세운 제목" },
    ],
  },
  {
    channel: "temu",
    label: "Temu Korea",
    titleFormula: "상품유형 + 구체적 형태/재질 + 수량·규격 + 용도/대상 + 호환/관리 특성. 긴 제목이라도 확인된 명사와 형용사만 쓴다.",
    descriptionStyle: "짧은 상품 설명과 3~7개의 사실형 bullet point로 구조화한다. 옵션·재질·크기·구성·관리법을 분리하고 가격/할인은 채널 UI에 맡긴다.",
    detailLayout: ["제품·수량", "핵심 특징", "재질·크기", "구성/옵션", "사용 장면", "관리법", "주의·규제 정보"],
    thumbnailStyle: "흰색 또는 밝은 단색 배경에 상품을 매우 크게 배치. 주사진은 식별 중심, 보조사진은 사용 장면·치수·구성 비교를 명확히 한다.",
    shotList: ["정면 대형", "구성품 플랫레이", "디테일", "치수", "사용 장면", "옵션 비교", "패키지/표시"],
    guardrails: ["할인율·Add to get·판매량은 고정 이미지/설명에 넣지 않음", "상품형태·수량·호환성을 제목에서 추측하지 않음", "건강·안전·아동 관련 주장은 증빙 없으면 차단"],
    evidence: [
      { type: "official", label: "Temu Partner Platform", url: "https://partner.temu.com/documentation", note: "상품 게시·카테고리·이미지 API 진입점(세부 문서는 로그인/JS 필요)" },
      { type: "market-observation", label: "Temu product search", url: "https://www.temu.com/subject/n2/search-a-psurl.html?search_key=cosmetic+set", note: "상품유형·재질·수량·대상·용도를 길게 조합한 제목과 대형 제품컷" },
    ],
  },
];

const sharedSearchTerms: Record<CategoryStyleProfile["id"], Record<LearnedSearchLocale, string>> = {
  "beauty-skincare": {
    "ko-KR": "스킨케어 보습 세럼", "ja-JP": "スキンケア 保湿 美容液", "en-US": "skincare moisturizer serum", "en-SG": "skincare moisturiser serum", "ms-MY": "penjagaan kulit pelembap serum", "en-PH": "skincare moisturizer serum", "vi-VN": "chăm sóc da kem dưỡng serum", "th-TH": "สกินแคร์ มอยส์เจอไรเซอร์ เซรั่ม", "zh-TW": "保養 保濕 精華", "pt-BR": "cuidados com a pele hidratante sérum", "es-MX": "cuidado de la piel crema hidratante suero", "id-ID": "perawatan kulit pelembap serum",
  },
  "beauty-tools": {
    "ko-KR": "메이크업 브러시 뷰티도구", "ja-JP": "メイクブラシ 美容ツール", "en-US": "makeup brush beauty tools", "en-SG": "makeup brush beauty tools", "ms-MY": "berus solekan alat kecantikan", "en-PH": "makeup brush beauty tools", "vi-VN": "cọ trang điểm dụng cụ làm đẹp", "th-TH": "แปรงแต่งหน้า อุปกรณ์ความงาม", "zh-TW": "彩妝刷 美妝工具", "pt-BR": "pincel de maquiagem acessórios", "es-MX": "brochas de maquillaje herramientas", "id-ID": "kuas makeup alat kecantikan",
  },
  "food-staples": {
    "ko-KR": "쌀 파스타 식품", "ja-JP": "米 パスタ 食品", "en-US": "rice pasta pantry food", "en-SG": "rice pasta pantry food", "ms-MY": "beras pasta makanan ruji", "en-PH": "rice pasta pantry food", "vi-VN": "gạo mì pasta thực phẩm", "th-TH": "ข้าว พาสต้า อาหารแห้ง", "zh-TW": "米 義大利麵 常溫食品", "pt-BR": "arroz massa alimentos", "es-MX": "arroz pasta alimentos", "id-ID": "beras pasta bahan makanan",
  },
  "men-tops": {
    "ko-KR": "남성 티셔츠 상의", "ja-JP": "メンズ Tシャツ トップス", "en-US": "men t shirt tops", "en-SG": "men t shirt tops", "ms-MY": "baju t lelaki atasan", "en-PH": "men t shirt tops", "vi-VN": "áo thun nam áo kiểu", "th-TH": "เสื้อยืดผู้ชาย เสื้อท่อนบน", "zh-TW": "男裝 T恤 上衣", "pt-BR": "camiseta masculina blusa", "es-MX": "playera para hombre camiseta", "id-ID": "kaos pria atasan",
  },
  "toys-games": {
    "ko-KR": "완구 장난감 놀이", "ja-JP": "おもちゃ 玩具 ゲーム", "en-US": "toys games play set", "en-SG": "toys games play set", "ms-MY": "mainan permainan set", "en-PH": "toys games play set", "vi-VN": "đồ chơi bộ trò chơi", "th-TH": "ของเล่น ชุดของเล่น เกม", "zh-TW": "玩具 遊戲 組合", "pt-BR": "brinquedo jogo conjunto", "es-MX": "juguetes juegos set", "id-ID": "mainan permainan set",
  },
  "food-supplement": {
    "ko-KR": "건강식품 비타민 보충제", "ja-JP": "健康食品 ビタミン サプリメント", "en-US": "vitamin dietary supplement", "en-SG": "vitamin health supplement", "ms-MY": "vitamin suplemen kesihatan", "en-PH": "vitamin dietary supplement", "vi-VN": "vitamin thực phẩm bổ sung", "th-TH": "วิตามิน ผลิตภัณฑ์เสริมอาหาร", "zh-TW": "維生素 營養補充品", "pt-BR": "vitamina suplemento alimentar", "es-MX": "vitamina suplemento alimenticio", "id-ID": "vitamin suplemen kesehatan",
  },
};

export const categoryStyleProfiles: CategoryStyleProfile[] = [
  {
    id: "beauty-skincare",
    label: "뷰티 · 스킨케어",
    aliases: ["화장품", "스킨케어", "크림", "세럼", "토너", "클렌저", "로션", "앰플", "cosmetic", "skincare"],
    families: ["보습 크림", "진정 젤크림", "페이셜 토너", "에센스", "앰플", "세럼", "에멀전", "클렌징 폼", "클렌징 오일", "시트 마스크", "아이 크림", "선크림", "립밤", "각질 토너 패드", "클렌징 밤", "페이셜 미스트", "슬리핑 마스크", "핸드 크림", "바디 로션", "스팟 패치"],
    searchTerms: sharedSearchTerms["beauty-skincare"],
    textStyle: "제형·사용감·피부타입·확인된 성분을 구체적으로 쓰고 효능을 단정하지 않는다. 제목은 상품유형과 용량을 우선한다.",
    detailLayout: ["제형 히어로", "사용감/피부타입", "확인된 성분", "근거 있는 시험", "사용 순서", "전성분", "주의·화장품 고시"],
    thumbnailStyle: "용기와 제형을 크게, 깨끗한 욕실/스튜디오 무드, 수분감은 빛·물성으로 표현. 피부 개선 전후 비교는 증빙 없으면 금지.",
    shotList: ["용기 정면", "펌프/캡", "제형 스와치", "손등 사용", "루틴 구성", "후면 라벨"],
    requiredFacts: ["제품 유형", "용량", "전성분 또는 확인 범위", "사용법", "사용 시 주의사항", "책임판매/제조 정보"],
    guardrails: ["기능성·임상·저자극·비건은 증빙 있을 때만", "의약품 오인 표현 금지", "라벨 성분·용량을 이미지에서 바꾸지 않음"],
  },
  {
    id: "beauty-tools",
    label: "뷰티 · 화장도구",
    aliases: ["화장도구", "뷰티도구", "브러시", "스펀지", "퍼프", "뷰러", "괄사", "makeup tool", "beauty tool"],
    families: ["메이크업 브러시 세트", "파운데이션 브러시", "아이섀도 브러시", "메이크업 스펀지", "쿠션 퍼프", "속눈썹 뷰러", "눈썹 정리 도구", "페이스 롤러", "괄사 도구", "브러시 세척 도구", "립 브러시", "눈썹 가위", "화장품 스패출러", "메이크업 믹싱 팔레트", "브러시 건조대", "파우더 퍼프", "메이크업 거울", "미용 핀셋", "실리콘 마스크 브러시", "화장도구 케이스"],
    searchTerms: sharedSearchTerms["beauty-tools"],
    textStyle: "도구 종류, 개수, 모/패드/프레임 소재, 형태, 사용 부위를 앞세운다. 전문가급·무자극 같은 단정은 피한다.",
    detailLayout: ["세트 전체", "도구별 역할", "헤드/재질 근접", "크기·수량", "사용 순서", "세척·보관", "구성·주의"],
    thumbnailStyle: "도구 전체가 겹치지 않는 플랫레이 또는 부채꼴 배열. 세트 수량과 서로 다른 헤드가 한눈에 보이게 한다.",
    shotList: ["세트 플랫레이", "헤드 근접", "측면 두께", "손 크기 비교", "사용 동작", "케이스/구성", "세척 장면"],
    requiredFacts: ["구성 수량", "각 도구 용도", "확인된 소재", "크기", "세척법", "포함 케이스 여부"],
    guardrails: ["천연모·항균·저자극 추정 금지", "세트 개수를 실제보다 늘리지 않음", "사람 얼굴 사용컷은 제품 형태를 가리지 않음"],
  },
  {
    id: "food-staples",
    label: "식품 · 상온식품",
    aliases: ["식품", "쌀", "밥", "파스타", "밀가루", "커피", "차", "소스", "과자", "food", "grocery"],
    families: ["백미", "즉석밥", "펜네 파스타", "스파게티면", "밀가루", "오트밀", "원두커피", "티백 차", "쿠킹 소스", "스낵 과자", "현미", "혼합 잡곡", "쿠스쿠스", "쌀국수면", "아침 시리얼", "벌꿀", "식용유", "통조림 콩", "육수 스톡", "건조 과일"],
    searchTerms: sharedSearchTerms["food-staples"],
    textStyle: "식품유형, 중량, 개수, 맛/형태, 원재료와 원산지를 정확히 쓴다. 건강 효능 대신 조리·섭취 맥락을 설명한다.",
    detailLayout: ["완성/내용물 히어로", "구성·중량", "원재료·원산지", "조리·섭취", "영양정보", "보관·배송", "알레르기·식품 고시"],
    thumbnailStyle: "패키지와 내용물 또는 완성 접시를 함께 보여주되 구성과 중량이 오해되지 않게 한다. 과도한 증기·재료 추가 연출 금지.",
    shotList: ["패키지 정면", "내용물", "조리 완성", "입자/면 근접", "구성 수량", "영양·원재료 라벨", "보관 상태"],
    requiredFacts: ["식품유형", "내용량", "원재료", "원산지", "영양정보", "알레르기", "보관/소비기한"],
    guardrails: ["맛·향·건강효능을 추측하지 않음", "원재료나 토핑을 실제 구성처럼 추가하지 않음", "냉장·냉동·상온 조건을 혼동하지 않음"],
  },
  {
    id: "men-tops",
    label: "패션 · 남성 상의",
    aliases: ["남성상의", "남자옷", "티셔츠", "셔츠", "후드", "재킷", "니트", "men", "t-shirt", "shirt", "hoodie"],
    families: ["반팔 티셔츠", "긴팔 티셔츠", "폴로 셔츠", "옥스퍼드 셔츠", "린넨 셔츠", "맨투맨", "후드 티셔츠", "니트 풀오버", "집업 재킷", "경량 조끼", "헨리넥 셔츠", "쿠반 칼라 셔츠", "플란넬 셔츠", "니트 카디건", "럭비 셔츠", "모크넥 상의", "민소매 상의", "기능성 베이스레이어", "데님 셔츠", "윈드브레이커"],
    searchTerms: sharedSearchTerms["men-tops"],
    textStyle: "의류 종류, 핏, 소재 혼용률, 색상, 사이즈, 계절/활동을 명사 중심으로 쓴다. 모델 정보와 기능성은 확인된 값만 사용한다.",
    detailLayout: ["착용 히어로", "핏 요약", "원단·봉제", "컬러", "실측 사이즈", "측정법", "세탁·교환 주의"],
    thumbnailStyle: "대표 색상 한 벌의 정면 착용 또는 고스트 마네킹. 패턴·로고·봉제선·길이를 실제와 동일하게 유지한다.",
    shotList: ["정면 착용", "후면 착용", "측면 핏", "넥/소매", "원단 근접", "평면 실측", "케어라벨"],
    requiredFacts: ["소재 혼용률", "색상", "사이즈", "실측", "핏", "세탁법", "모델 착용 정보(제공 시)"],
    guardrails: ["AI가 로고·패턴·포켓·단추를 바꾸지 않음", "신체 보정으로 핏 왜곡 금지", "실측과 모델 사이즈 추정 금지"],
  },
  {
    id: "toys-games",
    label: "완구 · 놀이",
    aliases: ["완구", "장난감", "미니카", "봉제인형", "블록", "퍼즐", "보드게임", "toy", "game", "play set"],
    families: ["테디베어 봉제완구", "자동차 미니카", "소프트 자동차 완구", "조립 블록", "직소 퍼즐", "보드게임", "역할놀이 세트", "미술 놀이 세트", "감각 놀이 완구", "야외 놀이 완구", "쌓기 완구", "도형 맞추기 완구", "자석 타일 블록", "도미노 세트", "카드게임", "물놀이 완구", "목욕 완구", "음악 완구", "어린이 과학 실험 세트", "무선조종 자동차"],
    searchTerms: sharedSearchTerms["toys-games"],
    textStyle: "완구 유형, 구성 수량, 소재, 대상 연령, 완성 크기, 놀이 방식을 정확히 쓴다. 교육·발달 효과를 단정하지 않는다.",
    detailLayout: ["대상 연령·제품 히어로", "구성품", "놀이 방법", "크기·소재", "조립/보관", "안전 표시", "KC·주의"],
    thumbnailStyle: "전체 구성품과 완성 모습을 명확하게, 밝은 단색 배경. 아동 사용 장면은 연령·크기 비율을 왜곡하지 않는다.",
    shotList: ["전체 구성", "완성 상태", "부품 근접", "손 크기 비교", "놀이 장면", "수납", "안전 라벨"],
    requiredFacts: ["대상 연령", "구성품 수", "소재", "크기", "배터리/조립 여부", "안전인증", "주의사항"],
    guardrails: ["KC·무독성·교육효과는 증빙 있을 때만", "부품 수와 색상을 늘리지 않음", "질식·자석·배터리 주의를 누락하지 않음"],
  },
  {
    id: "food-supplement",
    label: "건강식품 · 보충제",
    aliases: ["건강식품", "건강기능식품", "영양제", "비타민", "오메가", "유산균", "콜라겐", "supplement", "vitamin"],
    families: ["멀티비타민", "비타민 C", "비타민 D", "오메가3", "프로바이오틱스", "마그네슘", "아연", "콜라겐", "루테인", "단백질 보충식", "비타민 B 복합체", "칼슘", "철분", "비오틴", "코엔자임 Q10", "밀크시슬", "글루코사민", "식이섬유 보충식", "전해질 보충제", "식사대용 분말"],
    searchTerms: sharedSearchTerms["food-supplement"],
    textStyle: "법적 식품 분류를 먼저 확정하고 1일 섭취량, 함량, 제형, 수량, 인정 표시만 사용한다. 질병·치료·즉시 효과 문구를 쓰지 않는다.",
    detailLayout: ["법적 분류", "제품·제형", "1일 섭취량/함량", "인정 기능정보 또는 일반식품 고지", "섭취법", "원재료·알레르기", "주의·보관·식품 고시"],
    thumbnailStyle: "실제 병/포장과 정제·캡슐 제형을 사실적으로 보여준다. 장기·혈류·전후 비교·의료 상징은 사용하지 않는다.",
    shotList: ["패키지 정면", "정제/캡슐", "1회 섭취 구성", "용량·수량", "후면 기능/원재료", "섭취 장면", "인증 표시"],
    requiredFacts: ["일반식품/건강기능식품 분류", "내용량", "1일 섭취량", "원재료·함량", "기능정보(해당 시)", "주의", "소비기한·보관"],
    guardrails: ["형태만 보고 건강기능식품으로 분류 금지", "인정되지 않은 기능성·임상·GMP 생성 금지", "원료 함량과 1일 섭취량을 혼동하지 않음"],
  },
];

const variantTerms: Record<LearnedSearchLocale, string[]> = {
  "ko-KR": ["기본형", "단품", "세트 구성", "휴대용", "대용량", "프리미엄", "입문용", "전문가용", "선물 포장", "미니멀 패키지"],
  "ja-JP": ["スタンダード", "単品", "セット", "携帯用", "大容量", "プレミアム", "初心者向け", "プロ用", "ギフト包装", "シンプル包装"],
  "en-US": ["standard", "single item", "bundle set", "travel size", "large size", "premium", "beginner", "professional", "gift pack", "minimal packaging"],
  "en-SG": ["standard", "single item", "bundle set", "travel size", "large size", "premium", "beginner", "professional", "gift pack", "minimal packaging"],
  "ms-MY": ["standard", "satu unit", "set kombo", "saiz perjalanan", "saiz besar", "premium", "untuk pemula", "profesional", "pek hadiah", "pembungkusan minimal"],
  "en-PH": ["standard", "single item", "bundle set", "travel size", "large size", "premium", "beginner", "professional", "gift pack", "minimal packaging"],
  "vi-VN": ["tiêu chuẩn", "một sản phẩm", "bộ sản phẩm", "cỡ du lịch", "cỡ lớn", "cao cấp", "cho người mới", "chuyên nghiệp", "gói quà", "bao bì tối giản"],
  "th-TH": ["แบบมาตรฐาน", "ชิ้นเดียว", "ชุดรวม", "ขนาดพกพา", "ขนาดใหญ่", "พรีเมียม", "สำหรับผู้เริ่มต้น", "มืออาชีพ", "แพ็กของขวัญ", "บรรจุภัณฑ์มินิมอล"],
  "zh-TW": ["標準款", "單件", "組合套裝", "旅行尺寸", "大容量", "高階款", "入門款", "專業款", "禮盒包裝", "極簡包裝"],
  "pt-BR": ["padrão", "item único", "kit", "tamanho viagem", "tamanho grande", "premium", "iniciante", "profissional", "embalagem presente", "embalagem minimalista"],
  "es-MX": ["estándar", "pieza individual", "juego", "tamaño viaje", "tamaño grande", "premium", "principiante", "profesional", "empaque de regalo", "empaque minimalista"],
  "id-ID": ["standar", "satuan", "set bundel", "ukuran travel", "ukuran besar", "premium", "untuk pemula", "profesional", "kemasan hadiah", "kemasan minimalis"],
};

const localizedFamilyTerms: Record<CategoryStyleProfile["id"], Record<LearnedSearchLocale, string[]>> = {
  "beauty-skincare": {
    "ko-KR": ["보습 크림", "진정 젤크림", "페이셜 토너", "페이셜 에센스", "페이셜 앰플", "페이셜 세럼", "페이셜 에멀전", "클렌징 폼", "클렌징 오일", "시트 마스크"],
    "ja-JP": ["保湿クリーム", "鎮静ジェルクリーム", "化粧水", "フェイスエッセンス", "フェイスアンプル", "美容液", "乳液", "洗顔フォーム", "クレンジングオイル", "シートマスク"],
    "en-US": ["moisturizing cream", "soothing gel cream", "facial toner", "facial essence", "facial ampoule", "facial serum", "facial emulsion", "cleansing foam", "cleansing oil", "sheet mask"],
    "en-SG": ["moisturising cream", "soothing gel cream", "facial toner", "facial essence", "facial ampoule", "facial serum", "facial emulsion", "cleansing foam", "cleansing oil", "sheet mask"],
    "ms-MY": ["krim pelembap", "krim gel menenangkan", "penyegar muka", "esen muka", "ampul muka", "serum muka", "emulsi muka", "buih pencuci muka", "minyak pencuci muka", "topeng muka helaian"],
    "en-PH": ["moisturizing cream", "soothing gel cream", "facial toner", "facial essence", "facial ampoule", "facial serum", "facial emulsion", "cleansing foam", "cleansing oil", "sheet mask"],
    "vi-VN": ["kem dưỡng ẩm", "kem gel làm dịu", "nước cân bằng da", "tinh chất essence", "tinh chất ampoule", "serum da mặt", "sữa dưỡng da", "sữa rửa mặt tạo bọt", "dầu tẩy trang", "mặt nạ giấy"],
    "th-TH": ["ครีมบำรุงผิว", "เจลครีมปลอบประโลม", "โทนเนอร์", "เอสเซนส์บำรุงผิว", "แอมพูลบำรุงผิว", "เซรั่มบำรุงผิว", "อิมัลชันบำรุงผิว", "โฟมล้างหน้า", "คลีนซิ่งออยล์", "มาสก์แผ่น"],
    "zh-TW": ["保濕霜", "舒緩凝膠霜", "化妝水", "臉部精華液", "臉部安瓶", "臉部精華", "臉部乳液", "洗面乳", "卸妝油", "片狀面膜"],
    "pt-BR": ["creme hidratante", "creme gel calmante", "tônico facial", "essência facial", "ampola facial", "sérum facial", "emulsão facial", "espuma de limpeza", "óleo de limpeza", "máscara facial em folha"],
    "es-MX": ["crema hidratante", "crema gel calmante", "tónico facial", "esencia facial", "ampolleta facial", "suero facial", "emulsión facial", "espuma limpiadora", "aceite limpiador", "mascarilla facial de tela"],
    "id-ID": ["krim pelembap", "krim gel menenangkan", "toner wajah", "essence wajah", "ampul wajah", "serum wajah", "emulsi wajah", "busa pembersih wajah", "minyak pembersih", "masker lembar"],
  },
  "beauty-tools": {
    "ko-KR": ["메이크업 브러시 세트", "파운데이션 브러시", "아이섀도 브러시", "메이크업 스펀지", "쿠션 퍼프", "속눈썹 뷰러", "눈썹 정리 도구", "페이스 롤러", "괄사 도구", "브러시 세척 도구"],
    "ja-JP": ["メイクブラシセット", "ファンデーションブラシ", "アイシャドウブラシ", "メイクスポンジ", "クッションパフ", "ビューラー", "眉毛お手入れツール", "フェイスローラー", "かっさプレート", "ブラシ洗浄ツール"],
    "en-US": ["makeup brush set", "foundation brush", "eyeshadow brush", "makeup sponge", "cushion puff", "eyelash curler", "eyebrow grooming tool", "face roller", "gua sha tool", "makeup brush cleaner"],
    "en-SG": ["makeup brush set", "foundation brush", "eyeshadow brush", "makeup sponge", "cushion puff", "eyelash curler", "eyebrow grooming tool", "face roller", "gua sha tool", "makeup brush cleaner"],
    "ms-MY": ["set berus solekan", "berus asas", "berus pembayang mata", "span solekan", "paf kusyen", "pelentik bulu mata", "alat kemas kening", "penggelek muka", "alat gua sha", "alat pencuci berus"],
    "en-PH": ["makeup brush set", "foundation brush", "eyeshadow brush", "makeup sponge", "cushion puff", "eyelash curler", "eyebrow grooming tool", "face roller", "gua sha tool", "makeup brush cleaner"],
    "vi-VN": ["bộ cọ trang điểm", "cọ nền", "cọ mắt", "mút trang điểm", "bông phấn cushion", "kẹp mi", "dụng cụ tỉa chân mày", "thanh lăn mặt", "dụng cụ gua sha", "dụng cụ vệ sinh cọ"],
    "th-TH": ["ชุดแปรงแต่งหน้า", "แปรงรองพื้น", "แปรงอายแชโดว์", "ฟองน้ำแต่งหน้า", "พัฟคุชชั่น", "ที่ดัดขนตา", "อุปกรณ์จัดแต่งคิ้ว", "ลูกกลิ้งนวดหน้า", "กัวซา", "อุปกรณ์ล้างแปรง"],
    "zh-TW": ["彩妝刷具組", "粉底刷", "眼影刷", "美妝蛋", "氣墊粉撲", "睫毛夾", "眉毛修整工具", "臉部滾輪", "刮痧板", "刷具清潔工具"],
    "pt-BR": ["kit de pincéis de maquiagem", "pincel de base", "pincel de sombra", "esponja de maquiagem", "esponja para cushion", "curvador de cílios", "ferramenta para sobrancelha", "rolo facial", "ferramenta gua sha", "limpador de pincéis"],
    "es-MX": ["juego de brochas de maquillaje", "brocha para base", "brocha para sombras", "esponja de maquillaje", "esponja para cushion", "rizador de pestañas", "herramienta para cejas", "rodillo facial", "herramienta gua sha", "limpiador de brochas"],
    "id-ID": ["set kuas makeup", "kuas foundation", "kuas eyeshadow", "spons makeup", "puff cushion", "penjepit bulu mata", "alat perapi alis", "roller wajah", "alat gua sha", "alat pembersih kuas"],
  },
  "food-staples": {
    "ko-KR": ["백미", "즉석밥", "펜네 파스타", "스파게티면", "밀가루", "오트밀", "원두커피", "티백 차", "쿠킹 소스", "스낵 과자"],
    "ja-JP": ["白米", "パックご飯", "ペンネパスタ", "スパゲッティ", "小麦粉", "オートミール", "コーヒー豆", "ティーバッグ", "調理ソース", "スナック菓子"],
    "en-US": ["white rice", "ready rice", "penne pasta", "spaghetti", "wheat flour", "oatmeal", "coffee beans", "tea bags", "cooking sauce", "snack food"],
    "en-SG": ["white rice", "ready rice", "penne pasta", "spaghetti", "wheat flour", "oatmeal", "coffee beans", "tea bags", "cooking sauce", "snack food"],
    "ms-MY": ["beras putih", "nasi segera", "pasta penne", "spageti", "tepung gandum", "oat", "biji kopi", "uncang teh", "sos masakan", "snek"],
    "en-PH": ["white rice", "ready rice", "penne pasta", "spaghetti", "wheat flour", "oatmeal", "coffee beans", "tea bags", "cooking sauce", "snack food"],
    "vi-VN": ["gạo trắng", "cơm ăn liền", "mì penne", "mì spaghetti", "bột mì", "yến mạch", "hạt cà phê", "trà túi lọc", "sốt nấu ăn", "đồ ăn nhẹ"],
    "th-TH": ["ข้าวขาว", "ข้าวพร้อมทาน", "พาสต้าเพนเน", "เส้นสปาเกตตี", "แป้งสาลี", "ข้าวโอ๊ต", "เมล็ดกาแฟ", "ชาถุง", "ซอสปรุงอาหาร", "ขนมขบเคี้ยว"],
    "zh-TW": ["白米", "即食米飯", "筆管麵", "義大利直麵", "小麥麵粉", "燕麥片", "咖啡豆", "茶包", "料理醬", "零食"],
    "pt-BR": ["arroz branco", "arroz pronto", "massa penne", "espaguete", "farinha de trigo", "aveia", "grãos de café", "chá em sachê", "molho culinário", "salgadinho"],
    "es-MX": ["arroz blanco", "arroz listo", "pasta penne", "espagueti", "harina de trigo", "avena", "granos de café", "bolsas de té", "salsa para cocinar", "botana"],
    "id-ID": ["beras putih", "nasi siap saji", "pasta penne", "spageti", "tepung terigu", "oatmeal", "biji kopi", "teh celup", "saus masak", "makanan ringan"],
  },
  "men-tops": {
    "ko-KR": ["남성 반팔 티셔츠", "남성 긴팔 티셔츠", "남성 폴로 셔츠", "남성 옥스퍼드 셔츠", "남성 린넨 셔츠", "남성 맨투맨", "남성 후드 티셔츠", "남성 니트 풀오버", "남성 집업 재킷", "남성 경량 조끼"],
    "ja-JP": ["メンズ半袖Tシャツ", "メンズ長袖Tシャツ", "メンズポロシャツ", "メンズオックスフォードシャツ", "メンズリネンシャツ", "メンズスウェットシャツ", "メンズパーカー", "メンズニットプルオーバー", "メンズジップジャケット", "メンズ軽量ベスト"],
    "en-US": ["men short sleeve t shirt", "men long sleeve t shirt", "men polo shirt", "men oxford shirt", "men linen shirt", "men crewneck sweatshirt", "men hoodie", "men knit pullover", "men zip jacket", "men lightweight vest"],
    "en-SG": ["men short sleeve t shirt", "men long sleeve t shirt", "men polo shirt", "men oxford shirt", "men linen shirt", "men crewneck sweatshirt", "men hoodie", "men knit pullover", "men zip jacket", "men lightweight vest"],
    "ms-MY": ["kemeja t lengan pendek lelaki", "kemeja t lengan panjang lelaki", "kemeja polo lelaki", "kemeja oxford lelaki", "kemeja linen lelaki", "baju peluh lelaki", "hoodie lelaki", "pullover rajut lelaki", "jaket zip lelaki", "ves ringan lelaki"],
    "en-PH": ["men short sleeve t shirt", "men long sleeve t shirt", "men polo shirt", "men oxford shirt", "men linen shirt", "men crewneck sweatshirt", "men hoodie", "men knit pullover", "men zip jacket", "men lightweight vest"],
    "vi-VN": ["áo thun nam ngắn tay", "áo thun nam dài tay", "áo polo nam", "áo sơ mi oxford nam", "áo sơ mi linen nam", "áo nỉ cổ tròn nam", "áo hoodie nam", "áo len chui đầu nam", "áo khoác khóa kéo nam", "áo gile nhẹ nam"],
    "th-TH": ["เสื้อยืดแขนสั้นผู้ชาย", "เสื้อยืดแขนยาวผู้ชาย", "เสื้อโปโลผู้ชาย", "เสื้อเชิ้ตอ็อกซ์ฟอร์ดผู้ชาย", "เสื้อเชิ้ตลินินผู้ชาย", "เสื้อสเวตเตอร์ผู้ชาย", "เสื้อฮู้ดผู้ชาย", "เสื้อไหมพรมสวมหัวผู้ชาย", "แจ็กเก็ตซิปผู้ชาย", "เสื้อกั๊กน้ำหนักเบาผู้ชาย"],
    "zh-TW": ["男士短袖T恤", "男士長袖T恤", "男士Polo衫", "男士牛津襯衫", "男士亞麻襯衫", "男士圓領衛衣", "男士連帽上衣", "男士針織套頭衫", "男士拉鍊外套", "男士輕量背心"],
    "pt-BR": ["camiseta masculina manga curta", "camiseta masculina manga longa", "camisa polo masculina", "camisa oxford masculina", "camisa de linho masculina", "moletom masculino", "moletom com capuz masculino", "suéter masculino", "jaqueta masculina com zíper", "colete masculino leve"],
    "es-MX": ["playera hombre manga corta", "playera hombre manga larga", "playera polo hombre", "camisa oxford hombre", "camisa de lino hombre", "sudadera hombre", "sudadera con capucha hombre", "suéter tejido hombre", "chaqueta con cierre hombre", "chaleco ligero hombre"],
    "id-ID": ["kaos lengan pendek pria", "kaos lengan panjang pria", "kaos polo pria", "kemeja oxford pria", "kemeja linen pria", "sweatshirt pria", "hoodie pria", "pullover rajut pria", "jaket ritsleting pria", "rompi ringan pria"],
  },
  "toys-games": {
    "ko-KR": ["테디베어 봉제완구", "자동차 미니카", "소프트 자동차 완구", "조립 블록", "직소 퍼즐", "보드게임", "역할놀이 세트", "미술 놀이 세트", "감각 놀이 완구", "야외 놀이 완구"],
    "ja-JP": ["テディベアぬいぐるみ", "ミニカー", "ソフトカーおもちゃ", "組み立てブロック", "ジグソーパズル", "ボードゲーム", "ごっこ遊びセット", "アート遊びセット", "感覚遊びおもちゃ", "屋外遊びおもちゃ"],
    "en-US": ["teddy bear plush toy", "diecast toy car", "soft toy car", "building blocks", "jigsaw puzzle", "board game", "pretend play set", "art activity set", "sensory toy", "outdoor play toy"],
    "en-SG": ["teddy bear plush toy", "diecast toy car", "soft toy car", "building blocks", "jigsaw puzzle", "board game", "pretend play set", "art activity set", "sensory toy", "outdoor play toy"],
    "ms-MY": ["patung beruang teddy", "kereta mainan mini", "kereta mainan lembut", "blok binaan", "teka-teki jigsaw", "permainan papan", "set main peranan", "set aktiviti seni", "mainan deria", "mainan luar"],
    "en-PH": ["teddy bear plush toy", "diecast toy car", "soft toy car", "building blocks", "jigsaw puzzle", "board game", "pretend play set", "art activity set", "sensory toy", "outdoor play toy"],
    "vi-VN": ["gấu bông teddy", "xe đồ chơi mô hình", "xe đồ chơi mềm", "khối xếp hình", "tranh ghép hình", "trò chơi bàn", "bộ đồ chơi nhập vai", "bộ hoạt động mỹ thuật", "đồ chơi giác quan", "đồ chơi ngoài trời"],
    "th-TH": ["ตุ๊กตาหมีเท็ดดี้", "รถของเล่นจำลอง", "รถของเล่นนุ่ม", "บล็อกตัวต่อ", "จิ๊กซอว์", "บอร์ดเกม", "ชุดเล่นบทบาทสมมติ", "ชุดกิจกรรมศิลปะ", "ของเล่นเสริมประสาทสัมผัส", "ของเล่นกลางแจ้ง"],
    "zh-TW": ["泰迪熊絨毛玩具", "合金小汽車", "軟式汽車玩具", "積木", "拼圖", "桌遊", "扮家家酒組", "美術遊戲組", "感官玩具", "戶外玩具"],
    "pt-BR": ["urso de pelúcia", "carrinho em miniatura", "carrinho de brinquedo macio", "blocos de montar", "quebra-cabeça", "jogo de tabuleiro", "kit de faz de conta", "kit de atividades artísticas", "brinquedo sensorial", "brinquedo ao ar livre"],
    "es-MX": ["oso de peluche", "carrito de juguete", "carrito suave de juguete", "bloques de construcción", "rompecabezas", "juego de mesa", "juego de imitación", "juego de arte", "juguete sensorial", "juguete para exterior"],
    "id-ID": ["boneka beruang teddy", "mobil mainan mini", "mobil mainan lembut", "balok bangunan", "puzzle jigsaw", "permainan papan", "set bermain peran", "set aktivitas seni", "mainan sensorik", "mainan luar ruangan"],
  },
  "food-supplement": {
    "ko-KR": ["멀티비타민", "비타민 C", "비타민 D", "오메가3", "프로바이오틱스", "마그네슘", "아연", "콜라겐", "루테인", "단백질 보충식"],
    "ja-JP": ["マルチビタミン", "ビタミンC", "ビタミンD", "オメガ3", "プロバイオティクス", "マグネシウム", "亜鉛", "コラーゲン", "ルテイン", "プロテイン補助食品"],
    "en-US": ["multivitamin", "vitamin C supplement", "vitamin D supplement", "omega 3 supplement", "probiotic supplement", "magnesium supplement", "zinc supplement", "collagen supplement", "lutein supplement", "protein supplement"],
    "en-SG": ["multivitamin", "vitamin C supplement", "vitamin D supplement", "omega 3 supplement", "probiotic supplement", "magnesium supplement", "zinc supplement", "collagen supplement", "lutein supplement", "protein supplement"],
    "ms-MY": ["multivitamin", "suplemen vitamin C", "suplemen vitamin D", "suplemen omega 3", "suplemen probiotik", "suplemen magnesium", "suplemen zink", "suplemen kolagen", "suplemen lutein", "suplemen protein"],
    "en-PH": ["multivitamin", "vitamin C supplement", "vitamin D supplement", "omega 3 supplement", "probiotic supplement", "magnesium supplement", "zinc supplement", "collagen supplement", "lutein supplement", "protein supplement"],
    "vi-VN": ["vitamin tổng hợp", "thực phẩm bổ sung vitamin C", "thực phẩm bổ sung vitamin D", "thực phẩm bổ sung omega 3", "men vi sinh", "thực phẩm bổ sung magie", "thực phẩm bổ sung kẽm", "thực phẩm bổ sung collagen", "thực phẩm bổ sung lutein", "thực phẩm bổ sung protein"],
    "th-TH": ["วิตามินรวม", "อาหารเสริมวิตามินซี", "อาหารเสริมวิตามินดี", "อาหารเสริมโอเมกา 3", "อาหารเสริมโพรไบโอติก", "อาหารเสริมแมกนีเซียม", "อาหารเสริมสังกะสี", "อาหารเสริมคอลลาเจน", "อาหารเสริมลูทีน", "อาหารเสริมโปรตีน"],
    "zh-TW": ["綜合維生素", "維生素C補充品", "維生素D補充品", "Omega 3補充品", "益生菌補充品", "鎂補充品", "鋅補充品", "膠原蛋白補充品", "葉黃素補充品", "蛋白質補充品"],
    "pt-BR": ["multivitamínico", "suplemento de vitamina C", "suplemento de vitamina D", "suplemento de ômega 3", "suplemento probiótico", "suplemento de magnésio", "suplemento de zinco", "suplemento de colágeno", "suplemento de luteína", "suplemento de proteína"],
    "es-MX": ["multivitamínico", "suplemento de vitamina C", "suplemento de vitamina D", "suplemento de omega 3", "suplemento probiótico", "suplemento de magnesio", "suplemento de zinc", "suplemento de colágeno", "suplemento de luteína", "suplemento de proteína"],
    "id-ID": ["multivitamin", "suplemen vitamin C", "suplemen vitamin D", "suplemen omega 3", "suplemen probiotik", "suplemen magnesium", "suplemen seng", "suplemen kolagen", "suplemen lutein", "suplemen protein"],
  },
};

const additionalLocalizedFamilyTerms: Record<CategoryStyleProfile["id"], Record<LearnedSearchLocale, string[]>> = {
  "beauty-skincare": {
    "ko-KR": ["아이 크림", "선크림", "립밤", "각질 토너 패드", "클렌징 밤", "페이셜 미스트", "슬리핑 마스크", "핸드 크림", "바디 로션", "스팟 패치"],
    "ja-JP": ["アイクリーム", "日焼け止め", "リップバーム", "角質ケアトナーパッド", "クレンジングバーム", "フェイスミスト", "スリーピングマスク", "ハンドクリーム", "ボディローション", "スポットパッチ"],
    "en-US": ["eye cream", "sunscreen", "lip balm", "exfoliating toner pads", "cleansing balm", "facial mist", "sleeping mask", "hand cream", "body lotion", "spot patches"],
    "en-SG": ["eye cream", "sunscreen", "lip balm", "exfoliating toner pads", "cleansing balm", "facial mist", "sleeping mask", "hand cream", "body lotion", "spot patches"],
    "ms-MY": ["krim mata", "pelindung matahari", "pelembap bibir", "pad toner pengelupasan", "balm pencuci", "semburan muka", "topeng tidur", "krim tangan", "losyen badan", "tampalan jerawat"],
    "en-PH": ["eye cream", "sunscreen", "lip balm", "exfoliating toner pads", "cleansing balm", "facial mist", "sleeping mask", "hand cream", "body lotion", "spot patches"],
    "vi-VN": ["kem mắt", "kem chống nắng", "son dưỡng môi", "miếng toner tẩy tế bào chết", "sáp tẩy trang", "xịt khoáng mặt", "mặt nạ ngủ", "kem dưỡng tay", "sữa dưỡng thể", "miếng dán mụn"],
    "th-TH": ["อายครีม", "ครีมกันแดด", "ลิปบาล์ม", "โทนเนอร์แพดผลัดเซลล์ผิว", "คลีนซิ่งบาล์ม", "สเปรย์น้ำแร่บำรุงผิว", "สลีปปิ้งมาสก์", "ครีมทามือ", "โลชั่นบำรุงผิวกาย", "แผ่นแปะสิว"],
    "zh-TW": ["眼霜", "防曬乳", "護唇膏", "去角質化妝棉", "卸妝膏", "臉部噴霧", "晚安面膜", "護手霜", "身體乳液", "痘痘貼"],
    "pt-BR": ["creme para os olhos", "protetor solar", "protetor labial", "discos tônicos esfoliantes", "bálsamo de limpeza", "bruma facial", "máscara noturna", "creme para as mãos", "loção corporal", "adesivos para espinhas"],
    "es-MX": ["crema para ojos", "protector solar", "bálsamo labial", "almohadillas tónicas exfoliantes", "bálsamo limpiador", "bruma facial", "mascarilla nocturna", "crema para manos", "loción corporal", "parches para granos"],
    "id-ID": ["krim mata", "tabir surya", "pelembap bibir", "toner pad eksfoliasi", "cleansing balm", "face mist", "sleeping mask", "krim tangan", "losion tubuh", "patch jerawat"],
  },
  "beauty-tools": {
    "ko-KR": ["립 브러시", "눈썹 가위", "화장품 스패출러", "메이크업 믹싱 팔레트", "브러시 건조대", "파우더 퍼프", "메이크업 거울", "미용 핀셋", "실리콘 마스크 브러시", "화장도구 케이스"],
    "ja-JP": ["リップブラシ", "眉毛用ハサミ", "化粧品スパチュラ", "メイクミキシングパレット", "ブラシ乾燥スタンド", "パウダーパフ", "メイクミラー", "美容用ピンセット", "シリコンマスクブラシ", "メイクツールケース"],
    "en-US": ["lip brush", "eyebrow scissors", "cosmetic spatula", "makeup mixing palette", "brush drying rack", "powder puff", "makeup mirror", "beauty tweezers", "silicone mask brush", "makeup tool case"],
    "en-SG": ["lip brush", "eyebrow scissors", "cosmetic spatula", "makeup mixing palette", "brush drying rack", "powder puff", "makeup mirror", "beauty tweezers", "silicone mask brush", "makeup tool case"],
    "ms-MY": ["berus bibir", "gunting kening", "spatula kosmetik", "palet campuran solekan", "rak pengering berus", "paf bedak", "cermin solekan", "penyepit kecantikan", "berus topeng silikon", "bekas alat solekan"],
    "en-PH": ["lip brush", "eyebrow scissors", "cosmetic spatula", "makeup mixing palette", "brush drying rack", "powder puff", "makeup mirror", "beauty tweezers", "silicone mask brush", "makeup tool case"],
    "vi-VN": ["cọ môi", "kéo tỉa chân mày", "thìa mỹ phẩm", "bảng pha mỹ phẩm", "giá phơi cọ", "bông phấn phủ", "gương trang điểm", "nhíp làm đẹp", "cọ mặt nạ silicone", "hộp đựng dụng cụ trang điểm"],
    "th-TH": ["แปรงทาปาก", "กรรไกรตัดคิ้ว", "ไม้พายเครื่องสำอาง", "พาเลตผสมเครื่องสำอาง", "ที่ตากแปรง", "พัฟแป้ง", "กระจกแต่งหน้า", "แหนบความงาม", "แปรงมาสก์ซิลิโคน", "กล่องใส่อุปกรณ์แต่งหน้า"],
    "zh-TW": ["唇刷", "修眉剪", "化妝品挖棒", "彩妝調色盤", "刷具晾乾架", "蜜粉撲", "化妝鏡", "美容鑷子", "矽膠面膜刷", "化妝工具收納盒"],
    "pt-BR": ["pincel para lábios", "tesoura para sobrancelhas", "espátula cosmética", "paleta para misturar maquiagem", "suporte para secar pincéis", "esponja de pó", "espelho de maquiagem", "pinça de beleza", "pincel de máscara de silicone", "estojo para ferramentas de maquiagem"],
    "es-MX": ["pincel para labios", "tijeras para cejas", "espátula cosmética", "paleta para mezclar maquillaje", "soporte para secar brochas", "borla para polvo", "espejo de maquillaje", "pinzas de belleza", "brocha de silicona para mascarilla", "estuche para herramientas de maquillaje"],
    "id-ID": ["kuas bibir", "gunting alis", "spatula kosmetik", "palet pencampur makeup", "rak pengering kuas", "puff bedak", "cermin makeup", "pinset kecantikan", "kuas masker silikon", "kotak alat makeup"],
  },
  "food-staples": {
    "ko-KR": ["현미", "혼합 잡곡", "쿠스쿠스", "쌀국수면", "아침 시리얼", "벌꿀", "식용유", "통조림 콩", "육수 스톡", "건조 과일"],
    "ja-JP": ["玄米", "雑穀ミックス", "クスクス", "米麺", "朝食シリアル", "はちみつ", "食用油", "豆の缶詰", "だしストック", "ドライフルーツ"],
    "en-US": ["brown rice", "mixed grains", "couscous", "rice noodles", "breakfast cereal", "honey", "cooking oil", "canned beans", "soup stock", "dried fruit"],
    "en-SG": ["brown rice", "mixed grains", "couscous", "rice noodles", "breakfast cereal", "honey", "cooking oil", "canned beans", "soup stock", "dried fruit"],
    "ms-MY": ["beras perang", "campuran bijirin", "kuskus", "mi beras", "bijirin sarapan", "madu", "minyak masak", "kacang dalam tin", "stok sup", "buah kering"],
    "en-PH": ["brown rice", "mixed grains", "couscous", "rice noodles", "breakfast cereal", "honey", "cooking oil", "canned beans", "soup stock", "dried fruit"],
    "vi-VN": ["gạo lứt", "ngũ cốc trộn", "hạt couscous", "bún gạo khô", "ngũ cốc ăn sáng", "mật ong", "dầu ăn", "đậu đóng hộp", "viên nước dùng", "trái cây sấy khô"],
    "th-TH": ["ข้าวกล้อง", "ธัญพืชรวม", "คูสคูส", "เส้นก๋วยเตี๋ยวข้าว", "ซีเรียลอาหารเช้า", "น้ำผึ้ง", "น้ำมันปรุงอาหาร", "ถั่วกระป๋อง", "ซุปสต็อก", "ผลไม้อบแห้ง"],
    "zh-TW": ["糙米", "混合穀物", "北非小米", "乾米粉", "早餐穀片", "蜂蜜", "食用油", "豆類罐頭", "高湯塊", "乾燥水果"],
    "pt-BR": ["arroz integral", "grãos mistos", "cuscuz", "macarrão de arroz", "cereal matinal", "mel", "óleo de cozinha", "feijão enlatado", "caldo culinário", "frutas secas"],
    "es-MX": ["arroz integral", "mezcla de granos", "cuscús", "fideos de arroz", "cereal de desayuno", "miel", "aceite de cocina", "frijoles enlatados", "caldo concentrado", "fruta seca"],
    "id-ID": ["beras merah", "campuran biji-bijian", "kuskus", "mi beras", "sereal sarapan", "madu", "minyak goreng", "kacang kaleng", "kaldu masak", "buah kering"],
  },
  "men-tops": {
    "ko-KR": ["남성 헨리넥 셔츠", "남성 쿠반 칼라 셔츠", "남성 플란넬 셔츠", "남성 니트 카디건", "남성 럭비 셔츠", "남성 모크넥 상의", "남성 민소매 상의", "남성 기능성 베이스레이어", "남성 데님 셔츠", "남성 윈드브레이커"],
    "ja-JP": ["メンズヘンリーネックシャツ", "メンズキューバンカラーシャツ", "メンズフランネルシャツ", "メンズニットカーディガン", "メンズラグビーシャツ", "メンズモックネックトップス", "メンズノースリーブトップス", "メンズ機能性ベースレイヤー", "メンズデニムシャツ", "メンズウインドブレーカー"],
    "en-US": ["men henley shirt", "men Cuban collar shirt", "men flannel shirt", "men knit cardigan", "men rugby shirt", "men mock neck top", "men sleeveless top", "men performance base layer", "men denim shirt", "men windbreaker"],
    "en-SG": ["men henley shirt", "men Cuban collar shirt", "men flannel shirt", "men knit cardigan", "men rugby shirt", "men mock neck top", "men sleeveless top", "men performance base layer", "men denim shirt", "men windbreaker"],
    "ms-MY": ["baju henley lelaki", "kemeja kolar Cuba lelaki", "kemeja flanel lelaki", "kardigan rajut lelaki", "baju ragbi lelaki", "baju leher tinggi pendek lelaki", "baju tanpa lengan lelaki", "lapisan asas sukan lelaki", "kemeja denim lelaki", "jaket penahan angin lelaki"],
    "en-PH": ["men henley shirt", "men Cuban collar shirt", "men flannel shirt", "men knit cardigan", "men rugby shirt", "men mock neck top", "men sleeveless top", "men performance base layer", "men denim shirt", "men windbreaker"],
    "vi-VN": ["áo henley nam", "áo sơ mi cổ Cuba nam", "áo sơ mi flannel nam", "áo cardigan len nam", "áo rugby nam", "áo cổ lọ thấp nam", "áo sát nách nam", "áo lớp nền thể thao nam", "áo sơ mi denim nam", "áo khoác gió nam"],
    "th-TH": ["เสื้อเฮนลีย์ผู้ชาย", "เสื้อเชิ้ตคอคิวบาผู้ชาย", "เสื้อเชิ้ตแฟลนเนลผู้ชาย", "คาร์ดิแกนไหมพรมผู้ชาย", "เสื้อรักบี้ผู้ชาย", "เสื้อคอสูงสั้นผู้ชาย", "เสื้อแขนกุดผู้ชาย", "เสื้อเบสเลเยอร์กีฬา", "เสื้อเชิ้ตเดนิมผู้ชาย", "เสื้อกันลมผู้ชาย"],
    "zh-TW": ["男士亨利領上衣", "男士古巴領襯衫", "男士法蘭絨襯衫", "男士針織開襟衫", "男士橄欖球衫", "男士半高領上衣", "男士無袖上衣", "男士機能底層衣", "男士丹寧襯衫", "男士防風外套"],
    "pt-BR": ["camisa henley masculina", "camisa masculina de gola cubana", "camisa de flanela masculina", "cardigã masculino de tricô", "camisa de rúgbi masculina", "blusa masculina de gola alta curta", "regata masculina", "camada base esportiva masculina", "camisa jeans masculina", "corta-vento masculino"],
    "es-MX": ["camisa henley hombre", "camisa cuello cubano hombre", "camisa de franela hombre", "cárdigan tejido hombre", "playera de rugby hombre", "playera cuello alto corto hombre", "playera sin mangas hombre", "capa base deportiva hombre", "camisa de mezclilla hombre", "rompevientos hombre"],
    "id-ID": ["kaos henley pria", "kemeja kerah Kuba pria", "kemeja flanel pria", "kardigan rajut pria", "kaos rugby pria", "atasan mock neck pria", "atasan tanpa lengan pria", "base layer olahraga pria", "kemeja denim pria", "jaket windbreaker pria"],
  },
  "toys-games": {
    "ko-KR": ["쌓기 완구", "도형 맞추기 완구", "자석 타일 블록", "도미노 세트", "카드게임", "물놀이 완구", "목욕 완구", "음악 완구", "어린이 과학 실험 세트", "무선조종 자동차"],
    "ja-JP": ["積み重ねおもちゃ", "型はめおもちゃ", "マグネットタイルブロック", "ドミノセット", "カードゲーム", "水遊びおもちゃ", "お風呂おもちゃ", "音楽おもちゃ", "子ども科学実験セット", "ラジコンカー"],
    "en-US": ["stacking toy", "shape sorter toy", "magnetic tile blocks", "domino set", "card game", "water play toy", "bath toy", "musical toy", "kids science experiment kit", "remote control car"],
    "en-SG": ["stacking toy", "shape sorter toy", "magnetic tile blocks", "domino set", "card game", "water play toy", "bath toy", "musical toy", "kids science experiment kit", "remote control car"],
    "ms-MY": ["mainan susun", "mainan padanan bentuk", "blok jubin magnet", "set domino", "permainan kad", "mainan air", "mainan mandi", "mainan muzik", "set eksperimen sains kanak-kanak", "kereta kawalan jauh"],
    "en-PH": ["stacking toy", "shape sorter toy", "magnetic tile blocks", "domino set", "card game", "water play toy", "bath toy", "musical toy", "kids science experiment kit", "remote control car"],
    "vi-VN": ["đồ chơi xếp chồng", "đồ chơi thả hình", "khối nam châm", "bộ domino", "trò chơi thẻ bài", "đồ chơi nước", "đồ chơi nhà tắm", "đồ chơi âm nhạc", "bộ thí nghiệm khoa học trẻ em", "xe điều khiển từ xa"],
    "th-TH": ["ของเล่นเรียงซ้อน", "ของเล่นจับคู่รูปทรง", "บล็อกแม่เหล็ก", "ชุดโดมิโน", "เกมการ์ด", "ของเล่นน้ำ", "ของเล่นอาบน้ำ", "ของเล่นดนตรี", "ชุดทดลองวิทยาศาสตร์เด็ก", "รถบังคับวิทยุ"],
    "zh-TW": ["堆疊玩具", "形狀配對玩具", "磁力片積木", "骨牌組", "卡牌遊戲", "玩水玩具", "洗澡玩具", "音樂玩具", "兒童科學實驗組", "遙控汽車"],
    "pt-BR": ["brinquedo de empilhar", "brinquedo de encaixar formas", "blocos magnéticos", "jogo de dominó", "jogo de cartas", "brinquedo de água", "brinquedo de banho", "brinquedo musical", "kit de experiências científicas infantil", "carro de controle remoto"],
    "es-MX": ["juguete para apilar", "juguete de encajar figuras", "bloques magnéticos", "juego de dominó", "juego de cartas", "juguete de agua", "juguete para baño", "juguete musical", "kit de experimentos científicos infantil", "carro a control remoto"],
    "id-ID": ["mainan susun", "mainan sortir bentuk", "balok magnet", "set domino", "permainan kartu", "mainan air", "mainan mandi", "mainan musik", "kit eksperimen sains anak", "mobil remote control"],
  },
  "food-supplement": {
    "ko-KR": ["비타민 B 복합체", "칼슘", "철분", "비오틴", "코엔자임 Q10", "밀크시슬", "글루코사민", "식이섬유 보충식", "전해질 보충제", "식사대용 분말"],
    "ja-JP": ["ビタミンB群", "カルシウム", "鉄分", "ビオチン", "コエンザイムQ10", "ミルクシスル", "グルコサミン", "食物繊維サプリメント", "電解質サプリメント", "食事代替パウダー"],
    "en-US": ["vitamin B complex", "calcium supplement", "iron supplement", "biotin supplement", "coenzyme Q10 supplement", "milk thistle supplement", "glucosamine supplement", "fiber supplement", "electrolyte supplement", "meal replacement powder"],
    "en-SG": ["vitamin B complex", "calcium supplement", "iron supplement", "biotin supplement", "coenzyme Q10 supplement", "milk thistle supplement", "glucosamine supplement", "fibre supplement", "electrolyte supplement", "meal replacement powder"],
    "ms-MY": ["vitamin B kompleks", "suplemen kalsium", "suplemen zat besi", "suplemen biotin", "suplemen koenzim Q10", "suplemen milk thistle", "suplemen glukosamin", "suplemen serat", "suplemen elektrolit", "serbuk pengganti makanan"],
    "en-PH": ["vitamin B complex", "calcium supplement", "iron supplement", "biotin supplement", "coenzyme Q10 supplement", "milk thistle supplement", "glucosamine supplement", "fiber supplement", "electrolyte supplement", "meal replacement powder"],
    "vi-VN": ["vitamin B tổng hợp", "thực phẩm bổ sung canxi", "thực phẩm bổ sung sắt", "thực phẩm bổ sung biotin", "thực phẩm bổ sung coenzyme Q10", "thực phẩm bổ sung kế sữa", "thực phẩm bổ sung glucosamine", "thực phẩm bổ sung chất xơ", "thực phẩm bổ sung điện giải", "bột thay thế bữa ăn"],
    "th-TH": ["วิตามินบีรวม", "อาหารเสริมแคลเซียม", "อาหารเสริมธาตุเหล็ก", "อาหารเสริมไบโอติน", "อาหารเสริมโคเอนไซม์คิวเท็น", "อาหารเสริมมิลค์ทิสเซิล", "อาหารเสริมกลูโคซามีน", "อาหารเสริมใยอาหาร", "อาหารเสริมเกลือแร่", "ผงทดแทนมื้ออาหาร"],
    "zh-TW": ["維生素B群", "鈣補充品", "鐵補充品", "生物素補充品", "輔酶Q10補充品", "奶薊補充品", "葡萄糖胺補充品", "膳食纖維補充品", "電解質補充品", "代餐粉"],
    "pt-BR": ["complexo de vitamina B", "suplemento de cálcio", "suplemento de ferro", "suplemento de biotina", "suplemento de coenzima Q10", "suplemento de cardo-mariano", "suplemento de glucosamina", "suplemento de fibras", "suplemento eletrolítico", "pó substituto de refeição"],
    "es-MX": ["complejo de vitamina B", "suplemento de calcio", "suplemento de hierro", "suplemento de biotina", "suplemento de coenzima Q10", "suplemento de cardo mariano", "suplemento de glucosamina", "suplemento de fibra", "suplemento de electrolitos", "polvo sustituto de comida"],
    "id-ID": ["vitamin B kompleks", "suplemen kalsium", "suplemen zat besi", "suplemen biotin", "suplemen koenzim Q10", "suplemen milk thistle", "suplemen glukosamin", "suplemen serat", "suplemen elektrolit", "bubuk pengganti makanan"],
  },
};

type EbayLocalizedSearchLanguage = "de" | "fr" | "it" | "nl" | "pl";

const ebayLocalizedSearchLanguage: Partial<Record<StyleLocale, EbayLocalizedSearchLanguage>> = {
  "de-DE": "de", "de-AT": "de", "de-CH": "de",
  "fr-FR": "fr",
  "it-IT": "it",
  "nl-BE": "nl", "nl-NL": "nl",
  "pl-PL": "pl",
};

const ebayLocalizedVariantTerms: Record<EbayLocalizedSearchLanguage, readonly string[]> = {
  de: ["Standard", "Einzelstück", "Set", "Reisegröße", "Großpackung", "Premium", "für Einsteiger", "für Profis", "Geschenkpackung", "schlichte Verpackung"],
  fr: ["standard", "article seul", "lot", "format voyage", "grand format", "premium", "débutant", "professionnel", "coffret cadeau", "emballage minimaliste"],
  it: ["standard", "articolo singolo", "set", "formato viaggio", "formato grande", "premium", "principiante", "professionale", "confezione regalo", "confezione minimalista"],
  nl: ["standaard", "los artikel", "set", "reisformaat", "grootverpakking", "premium", "voor beginners", "professioneel", "geschenkverpakking", "minimalistische verpakking"],
  pl: ["standardowy", "pojedynczy", "zestaw", "rozmiar podróżny", "duże opakowanie", "premium", "dla początkujących", "profesjonalny", "opakowanie prezentowe", "minimalistyczne opakowanie"],
};

const ebayLocalizedFamilyTerms: Record<
  EbayLocalizedSearchLanguage,
  Record<CategoryStyleProfile["id"], readonly string[]>
> = {
  de: {
    "beauty-skincare": ["Feuchtigkeitscreme", "beruhigende Gelcreme", "Gesichtswasser", "Gesichtsessenz", "Gesichtsampulle", "Gesichtsserum", "Gesichtsemulsion", "Reinigungsschaum", "Reinigungsöl", "Tuchmaske", "Augencreme", "Sonnencreme", "Lippenbalsam", "Peeling Tonerpads", "Reinigungsbalsam", "Gesichtsspray", "Schlafmaske", "Handcreme", "Körperlotion", "Pickelpflaster"],
    "beauty-tools": ["Make-up-Pinselset", "Foundationpinsel", "Lidschattenpinsel", "Make-up-Schwamm", "Cushion-Puff", "Wimpernzange", "Augenbrauenwerkzeug", "Gesichtsroller", "Gua-Sha-Werkzeug", "Pinselreiniger", "Lippenpinsel", "Augenbrauenschere", "Kosmetikspatel", "Make-up-Mischpalette", "Pinseltrockner", "Puderquaste", "Kosmetikspiegel", "Kosmetikpinzette", "Silikon-Maskenpinsel", "Kosmetiketui"],
    "food-staples": ["weißer Reis", "Fertigreis", "Penne-Nudeln", "Spaghetti", "Weizenmehl", "Haferflocken", "Kaffeebohnen", "Teebeutel", "Kochsoße", "Knabbergebäck", "Vollkornreis", "Getreidemischung", "Couscous", "Reisnudeln", "Frühstücksflocken", "Honig", "Speiseöl", "Bohnenkonserve", "Brühe", "Trockenfrüchte"],
    "men-tops": ["Herren Kurzarmshirt", "Herren Langarmshirt", "Herren Poloshirt", "Herren Oxfordhemd", "Herren Leinenhemd", "Herren Sweatshirt", "Herren Kapuzenpullover", "Herren Strickpullover", "Herren Reißverschlussjacke", "Herren Leichtweste", "Herren Henleyshirt", "Herren Hemd mit Kubakragen", "Herren Flanellhemd", "Herren Strickjacke", "Herren Rugbyshirt", "Herren Stehkragenoberteil", "Herren ärmelloses Oberteil", "Herren Funktionsunterhemd", "Herren Jeanshemd", "Herren Windjacke"],
    "toys-games": ["Teddybär Plüschtier", "Spielzeugauto", "weiches Spielzeugauto", "Bausteine", "Puzzle", "Brettspiel", "Rollenspielset", "Bastelset", "Sensorikspielzeug", "Outdoor-Spielzeug", "Stapelspielzeug", "Formensortierer", "Magnetbausteine", "Dominospiel", "Kartenspiel", "Wasserspielzeug", "Badespielzeug", "Musikspielzeug", "Kinder Experimentierkasten", "ferngesteuertes Auto"],
    "food-supplement": ["Multivitamin", "Vitamin-C-Präparat", "Vitamin-D-Präparat", "Omega-3-Präparat", "Probiotikum", "Magnesiumpräparat", "Zinkpräparat", "Kollagenpräparat", "Luteinpräparat", "Proteinpräparat", "Vitamin-B-Komplex", "Kalziumpräparat", "Eisenpräparat", "Biotinpräparat", "Coenzym-Q10-Präparat", "Mariendistelpräparat", "Glucosaminpräparat", "Ballaststoffpräparat", "Elektrolytpräparat", "Mahlzeitenersatzpulver"],
  },
  fr: {
    "beauty-skincare": ["crème hydratante", "gel-crème apaisant", "lotion tonique visage", "essence visage", "ampoule visage", "sérum visage", "émulsion visage", "mousse nettoyante", "huile démaquillante", "masque en tissu", "crème contour des yeux", "crème solaire", "baume à lèvres", "disques toniques exfoliants", "baume démaquillant", "brume visage", "masque de nuit", "crème pour les mains", "lait pour le corps", "patchs boutons"],
    "beauty-tools": ["set de pinceaux maquillage", "pinceau fond de teint", "pinceau fard à paupières", "éponge maquillage", "houppette cushion", "recourbe-cils", "outil sourcils", "rouleau visage", "outil gua sha", "nettoyeur de pinceaux", "pinceau à lèvres", "ciseaux à sourcils", "spatule cosmétique", "palette de mélange maquillage", "support séchage pinceaux", "houppette à poudre", "miroir maquillage", "pince à épiler", "pinceau masque silicone", "trousse outils maquillage"],
    "food-staples": ["riz blanc", "riz prêt à manger", "pâtes penne", "spaghetti", "farine de blé", "flocons d’avoine", "grains de café", "sachets de thé", "sauce de cuisson", "biscuits apéritifs", "riz complet", "mélange de céréales", "couscous", "nouilles de riz", "céréales petit-déjeuner", "miel", "huile de cuisson", "haricots en conserve", "bouillon", "fruits secs"],
    "men-tops": ["t-shirt homme manches courtes", "t-shirt homme manches longues", "polo homme", "chemise Oxford homme", "chemise en lin homme", "sweat homme", "sweat à capuche homme", "pull en maille homme", "veste zippée homme", "gilet léger homme", "t-shirt Henley homme", "chemise col cubain homme", "chemise en flanelle homme", "cardigan homme", "maillot rugby homme", "haut col montant homme", "débardeur homme", "sous-vêtement technique homme", "chemise en jean homme", "coupe-vent homme"],
    "toys-games": ["ours en peluche", "voiture miniature", "voiture jouet souple", "blocs de construction", "puzzle", "jeu de société", "set de jeu de rôle", "set d’activités artistiques", "jouet sensoriel", "jouet extérieur", "jouet à empiler", "trieur de formes", "blocs magnétiques", "jeu de dominos", "jeu de cartes", "jouet d’eau", "jouet de bain", "jouet musical", "kit scientifique enfant", "voiture télécommandée"],
    "food-supplement": ["multivitamines", "complément vitamine C", "complément vitamine D", "complément oméga 3", "complément probiotique", "complément magnésium", "complément zinc", "complément collagène", "complément lutéine", "complément protéiné", "complexe vitamine B", "complément calcium", "complément fer", "complément biotine", "complément coenzyme Q10", "complément chardon-Marie", "complément glucosamine", "complément fibres", "complément électrolytes", "poudre substitut de repas"],
  },
  it: {
    "beauty-skincare": ["crema idratante", "gel crema lenitivo", "tonico viso", "essenza viso", "fiala viso", "siero viso", "emulsione viso", "schiuma detergente", "olio detergente", "maschera in tessuto", "crema contorno occhi", "crema solare", "balsamo labbra", "dischetti tonici esfolianti", "balsamo detergente", "nebbia viso", "maschera notte", "crema mani", "lozione corpo", "cerotti brufoli"],
    "beauty-tools": ["set pennelli trucco", "pennello fondotinta", "pennello ombretto", "spugna trucco", "piumino cushion", "piegaciglia", "strumento sopracciglia", "rullo viso", "strumento gua sha", "pulitore pennelli", "pennello labbra", "forbici sopracciglia", "spatola cosmetica", "tavolozza miscelazione trucco", "supporto asciugatura pennelli", "piumino cipria", "specchio trucco", "pinzetta cosmetica", "pennello maschera silicone", "custodia strumenti trucco"],
    "food-staples": ["riso bianco", "riso pronto", "pasta penne", "spaghetti", "farina di grano", "fiocchi d’avena", "chicchi di caffè", "bustine di tè", "salsa da cucina", "snack salato", "riso integrale", "miscela di cereali", "couscous", "spaghetti di riso", "cereali da colazione", "miele", "olio da cucina", "fagioli in scatola", "brodo", "frutta secca"],
    "men-tops": ["maglietta uomo manica corta", "maglietta uomo manica lunga", "polo uomo", "camicia Oxford uomo", "camicia lino uomo", "felpa uomo", "felpa con cappuccio uomo", "pullover maglia uomo", "giacca zip uomo", "gilet leggero uomo", "maglia Henley uomo", "camicia collo cubano uomo", "camicia flanella uomo", "cardigan uomo", "maglia rugby uomo", "maglia collo alto uomo", "canotta uomo", "maglia tecnica base uomo", "camicia denim uomo", "giacca antivento uomo"],
    "toys-games": ["orsacchiotto peluche", "automobilina giocattolo", "macchinina morbida", "blocchi da costruzione", "puzzle", "gioco da tavolo", "set gioco di ruolo", "set attività artistiche", "giocattolo sensoriale", "giocattolo da esterno", "giocattolo impilabile", "selezionatore forme", "blocchi magnetici", "set domino", "gioco di carte", "giocattolo acqua", "giocattolo bagno", "giocattolo musicale", "kit scienza bambini", "auto radiocomandata"],
    "food-supplement": ["multivitaminico", "integratore vitamina C", "integratore vitamina D", "integratore omega 3", "integratore probiotico", "integratore magnesio", "integratore zinco", "integratore collagene", "integratore luteina", "integratore proteico", "complesso vitamina B", "integratore calcio", "integratore ferro", "integratore biotina", "integratore coenzima Q10", "integratore cardo mariano", "integratore glucosamina", "integratore fibre", "integratore elettroliti", "polvere sostitutiva pasto"],
  },
  nl: {
    "beauty-skincare": ["hydraterende crème", "kalmerende gelcrème", "gezichtstoner", "gezichtsessence", "gezichtsampul", "gezichtsserum", "gezichtsemulsie", "reinigingsschuim", "reinigingsolie", "sheetmasker", "oogcrème", "zonnebrandcrème", "lippenbalsem", "exfoliërende tonerpads", "reinigingsbalsem", "gezichtsmist", "slaapmasker", "handcrème", "bodylotion", "puistjespleisters"],
    "beauty-tools": ["make-upkwastenset", "foundationkwast", "oogschaduwkwast", "make-upspons", "cushion puff", "wimperkruller", "wenkbrauwgereedschap", "gezichtsroller", "gua sha gereedschap", "kwastenreiniger", "lippenkwast", "wenkbrauwschaar", "cosmeticaspatel", "make-up mengpalet", "kwastendroogrek", "poederdons", "make-upspiegel", "cosmetische pincet", "siliconen maskerkwast", "make-uptas"],
    "food-staples": ["witte rijst", "kant-en-klare rijst", "penne pasta", "spaghetti", "tarwebloem", "havermout", "koffiebonen", "theezakjes", "kooksaus", "hartige snack", "zilvervliesrijst", "granenmix", "couscous", "rijstnoedels", "ontbijtgranen", "honing", "bakolie", "bonen in blik", "bouillon", "gedroogd fruit"],
    "men-tops": ["heren T-shirt korte mouw", "heren T-shirt lange mouw", "heren poloshirt", "heren Oxford overhemd", "heren linnen overhemd", "heren sweater", "heren hoodie", "heren gebreide trui", "heren ritsjack", "heren licht vest", "heren Henleyshirt", "heren overhemd Cubaanse kraag", "heren flanellen overhemd", "heren cardigan", "heren rugbyshirt", "heren coltrui", "heren mouwloze top", "heren thermoshirt", "heren denim overhemd", "heren windjack"],
    "toys-games": ["teddybeer knuffel", "speelgoedauto", "zachte speelgoedauto", "bouwblokken", "legpuzzel", "bordspel", "rollenspelset", "knutselset", "sensorisch speelgoed", "buitenspeelgoed", "stapelspeelgoed", "vormenstoof", "magnetische bouwblokken", "dominoset", "kaartspel", "waterspeelgoed", "badspeelgoed", "muzikaal speelgoed", "wetenschapsset kinderen", "radiografische auto"],
    "food-supplement": ["multivitamine", "vitamine C supplement", "vitamine D supplement", "omega 3 supplement", "probiotica supplement", "magnesium supplement", "zink supplement", "collageen supplement", "luteïne supplement", "eiwit supplement", "vitamine B complex", "calcium supplement", "ijzer supplement", "biotine supplement", "co-enzym Q10 supplement", "mariadistel supplement", "glucosamine supplement", "vezelsupplement", "elektrolyten supplement", "maaltijdvervangend poeder"],
  },
  pl: {
    "beauty-skincare": ["krem nawilżający", "kojący krem żelowy", "tonik do twarzy", "esencja do twarzy", "ampułka do twarzy", "serum do twarzy", "emulsja do twarzy", "pianka oczyszczająca", "olejek oczyszczający", "maska w płachcie", "krem pod oczy", "krem przeciwsłoneczny", "balsam do ust", "płatki tonizujące złuszczające", "balsam oczyszczający", "mgiełka do twarzy", "maska na noc", "krem do rąk", "balsam do ciała", "plastry na wypryski"],
    "beauty-tools": ["zestaw pędzli do makijażu", "pędzel do podkładu", "pędzel do cieni", "gąbka do makijażu", "puszek cushion", "zalotka", "narzędzie do brwi", "roller do twarzy", "narzędzie gua sha", "czyścik do pędzli", "pędzelek do ust", "nożyczki do brwi", "szpatułka kosmetyczna", "paleta do mieszania makijażu", "stojak do suszenia pędzli", "puszek do pudru", "lusterko do makijażu", "pęseta kosmetyczna", "silikonowy pędzel do masek", "etui na akcesoria do makijażu"],
    "food-staples": ["biały ryż", "ryż gotowy", "makaron penne", "spaghetti", "mąka pszenna", "płatki owsiane", "ziarna kawy", "herbata w torebkach", "sos do gotowania", "słona przekąska", "brązowy ryż", "mieszanka zbóż", "kuskus", "makaron ryżowy", "płatki śniadaniowe", "miód", "olej spożywczy", "fasola w puszce", "bulion", "suszone owoce"],
    "men-tops": ["męski T-shirt krótki rękaw", "męski T-shirt długi rękaw", "męska koszulka polo", "męska koszula Oxford", "męska koszula lniana", "męska bluza", "męska bluza z kapturem", "męski sweter", "męska kurtka na zamek", "męska lekka kamizelka", "męska koszulka Henley", "męska koszula z kołnierzem kubańskim", "męska koszula flanelowa", "męski kardigan", "męska koszulka rugby", "męska bluza ze stójką", "męski top bez rękawów", "męska bielizna termoaktywna", "męska koszula jeansowa", "męska wiatrówka"],
    "toys-games": ["miś pluszowy", "samochodzik zabawka", "miękki samochodzik", "klocki konstrukcyjne", "puzzle", "gra planszowa", "zestaw do odgrywania ról", "zestaw plastyczny", "zabawka sensoryczna", "zabawka ogrodowa", "zabawka do układania", "sorter kształtów", "klocki magnetyczne", "zestaw domino", "gra karciana", "zabawka wodna", "zabawka do kąpieli", "zabawka muzyczna", "zestaw naukowy dla dzieci", "samochód zdalnie sterowany"],
    "food-supplement": ["multiwitamina", "suplement witaminy C", "suplement witaminy D", "suplement omega 3", "suplement probiotyczny", "suplement magnezu", "suplement cynku", "suplement kolagenu", "suplement luteiny", "suplement białkowy", "kompleks witamin B", "suplement wapnia", "suplement żelaza", "suplement biotyny", "suplement koenzymu Q10", "suplement ostropestu", "suplement glukozaminy", "suplement błonnika", "suplement elektrolitów", "proszek zastępujący posiłek"],
  },
};

function localizedEbaySearchQuery(
  target: StyleTargetMarket,
  categoryId: CategoryStyleProfile["id"],
  familyIndex: number,
  variantIndex: number,
  fallback: string,
) {
  if (target.channel !== "ebay") return fallback;
  const language = ebayLocalizedSearchLanguage[target.locale];
  if (!language) return fallback;
  const family = ebayLocalizedFamilyTerms[language][categoryId][familyIndex];
  const variant = ebayLocalizedVariantTerms[language][variantIndex];
  if (!family || !variant) throw new Error(`Missing localized eBay search term for ${target.locale}:${categoryId}`);
  return `${family} ${variant}`;
}

function learnedSearchLocale(locale: StyleLocale): LearnedSearchLocale {
  switch (locale) {
    case "es-ES": return "es-MX";
    case "zh-HK": return "zh-TW";
    case "en-GB":
    case "de-DE":
    case "en-AU":
    case "en-CA":
    case "fr-FR":
    case "it-IT":
    case "de-AT":
    case "nl-BE":
    case "de-CH":
    case "en-IE":
    case "nl-NL":
    case "pl-PL":
      return "en-US";
    default:
      return locale;
  }
}

function marketplaceSearchUrl(target: StyleTargetMarket, query: string) {
  const keyword = encodeURIComponent(query);
  if (target.channel === "qoo10") return `https://www.qoo10.jp/s/?keyword=${keyword}`;
  if (target.channel === "shopee") {
    const domains: Record<string, string> = { SG: "shopee.sg", MY: "shopee.com.my", PH: "shopee.ph", VN: "shopee.vn", TH: "shopee.co.th", TW: "shopee.tw", BR: "shopee.com.br", MX: "shopee.com.mx" };
    return `https://${domains[target.market]}/search?keyword=${keyword}`;
  }
  if (target.channel === "lazada") {
    const domains: Record<string, string> = { MY: "lazada.com.my", SG: "lazada.sg", PH: "lazada.com.ph", TH: "lazada.co.th", VN: "lazada.vn", ID: "lazada.co.id" };
    return `https://www.${domains[target.market]}/catalog/?q=${keyword}`;
  }
  if (target.channel === "coupang") return `https://www.coupang.com/np/search?q=${keyword}`;
  if (target.channel === "elevenst") return `https://search.11st.co.kr/Search.tmall?kwd=${keyword}`;
  if (target.channel === "smartstore") return `https://search.shopping.naver.com/search/all?query=${keyword}`;
  if (target.channel === "ebay") {
    const domains: Record<string, string> = {
      US: "ebay.com", GB: "ebay.co.uk", DE: "ebay.de", AU: "ebay.com.au", CA: "ebay.ca",
      FR: "ebay.fr", IT: "ebay.it", ES: "ebay.es", AT: "ebay.at", BE: "ebay.be",
      CH: "ebay.ch", HK: "ebay.com.hk", IE: "ebay.ie", NL: "ebay.nl", PL: "ebay.pl",
    };
    return `https://www.${domains[target.market]}/sch/i.html?_nkw=${keyword}`;
  }
  return `https://www.temu.com/kr/search_result.html?search_key=${keyword}`;
}

export const learnedProductExamples: LearnedProductExample[] = categoryStyleProfiles.flatMap((category) => (
  category.families.flatMap((family, familyIndex) => (
    variantTerms["ko-KR"].map((variant, variantIndex) => {
      const index = familyIndex * 10 + variantIndex;
      const target = styleTargetMarkets[index % styleTargetMarkets.length];
      const searchLocale = learnedSearchLocale(target.locale);
      const localizedVariant = variantTerms[searchLocale][variantIndex];
      const localizedFamilies = [
        ...localizedFamilyTerms[category.id][searchLocale],
        ...additionalLocalizedFamilyTerms[category.id][searchLocale],
      ];
      const localizedFamily = localizedFamilies[familyIndex];
      const localSearchQuery = localizedEbaySearchQuery(
        target,
        category.id,
        familyIndex,
        variantIndex,
        `${localizedFamily} ${localizedVariant}`,
      );
      return {
        id: `${category.id}-${String(index + 1).padStart(3, "0")}`,
        categoryId: category.id,
        category: category.label,
        product: `${variant} ${family}`,
        variant,
        channel: target.channel,
        market: target.market,
        country: target.country,
        locale: target.locale,
        language: target.language,
        localSearchQuery,
        sourceUrl: marketplaceSearchUrl(target, localSearchQuery),
        evidenceLevel: "coverage-search" as const,
      };
    })
  ))
));

export const styleLearningSummary = {
  categories: categoryStyleProfiles.length,
  settingShotGroups: 9,
  examples: learnedProductExamples.length,
  channels: channelStyleProfiles.length,
  markets: styleTargetMarkets.length,
  promptProfiles: categoryStyleProfiles.length * styleTargetMarkets.length,
  officialSources: channelStyleProfiles.flatMap((profile) => profile.evidence).filter((item) => item.type === "official").length,
  observationSources: channelStyleProfiles.flatMap((profile) => profile.evidence).filter((item) => item.type === "market-observation").length,
};

export const generalCommerceStyleProfile = {
  id: "general-commerce",
  label: "일반 상품 · 미분류 안전 모드",
  aliases: [],
  families: [],
  textStyle: "상품 유형, 형태, 재질, 실제 구성과 사용 맥락을 확인된 사실 중심으로 설명한다.",
  detailLayout: ["상품 전체", "형태·재질", "보이는 특징", "사용 맥락", "구성·패키지", "규격", "주의사항"],
  thumbnailStyle: "제품 유형이 즉시 구분되는 중립적인 상업 사진. 임의의 뷰티 소품이나 식품 연출을 적용하지 않는다.",
  shotList: ["정면 전체", "45도 전체", "형태·재질 근접", "구성품 플랫레이", "실제 사용 맥락", "크기·치수", "패키지·표시사항"],
  requiredFacts: ["상품 유형", "재질", "구성", "규격", "사용 맥락", "주의사항"],
  guardrails: ["카테고리가 일치하지 않는 소품·제형·섭취·착용 장면 생성 금지", "보이지 않는 구성품이나 수량 생성 금지", "분류가 불명확하면 중립적인 상품 촬영으로 제한"],
} as const;

export function matchStyleCategory(value: string) {
  const normalized = value.toLocaleLowerCase();
  return categoryStyleProfiles.find((category) => category.aliases.some((alias) => normalized.includes(alias.toLocaleLowerCase())))
    ?? generalCommerceStyleProfile;
}

export function buildMarketplaceStyleLearningBrief(categoryHint: string) {
  const category = matchStyleCategory(categoryHint);
  const examples = learnedProductExamples.filter((item) => item.categoryId === category.id);
  const marketLines = styleTargetMarkets.map((target) => `${target.channel}:${target.market}=${target.locale}(${target.language})`);
  const channelLines = channelStyleProfiles.map((profile) => [
    `[${profile.channel}] ${profile.titleFormula}`,
    `설명: ${profile.descriptionStyle}`,
    `상세 배치: ${profile.detailLayout.join(" → ")}`,
    `썸네일: ${profile.thumbnailStyle}`,
    `촬영: ${profile.shotList.join(", ")}`,
    `금지/검수: ${profile.guardrails.join(" / ")}`,
  ].join("\n"));
  return [
    `<sellerpilot_style_learning version="${STYLE_LEARNING_VERSION}" researched_at="${STYLE_LEARNING_RESEARCH_DATE}">`,
    `선택 카테고리: ${category.label} (${category.id})`,
    examples.length
      ? `학습 커버리지: 이 카테고리 상품 유형 20개 × 제작 변형 10개 = ${examples.length}개. ${channelStyleProfiles.length}개 채널, ${styleTargetMarkets.length}개 국가·언어 프로필에 순환 검증한다.`
      : "학습 커버리지: 등록된 6개 학습 카테고리와 일치하지 않아 일반 상품 안전 모드를 적용한다. 특정 카테고리 연출을 추측하지 않는다.",
    `학습 상품 유형: ${category.families.length ? category.families.join(", ") : "미분류 · 실제 상품 사진과 판매자 확정 정보 우선"}`,
    `학습 제작 변형: ${variantTerms["ko-KR"].join(", ")}`,
    `카테고리 문안: ${category.textStyle}`,
    `카테고리 상세 배치: ${category.detailLayout.join(" → ")}`,
    `카테고리 썸네일: ${category.thumbnailStyle}`,
    `카테고리 촬영: ${category.shotList.join(", ")}`,
    `필수 사실: ${category.requiredFacts.join(", ")}`,
    `카테고리 금지/검수: ${category.guardrails.join(" / ")}`,
    `국가·언어 매핑: ${marketLines.join("; ")}`,
    ...channelLines,
    "적용 규칙: 화면에서 관찰한 배열과 문체만 일반화하고 다른 판매자의 문장·이미지·브랜드 표현을 복사하지 않는다. 채널 UI가 표시하는 가격·할인·배송·후기·판매량을 판매자 제작 이미지나 본문에 고정하지 않는다.",
    "적용 규칙: 대표이미지는 모든 채널에서 안전한 제품 식별 중심으로 만들고, 채널별 색감·구도 차이는 제품 외형·라벨·구성품을 바꾸지 않는 범위에서만 반영한다.",
    "적용 규칙: 실제 상품 사실과 스타일 지침이 충돌하면 상품 사실과 공식 정책을 우선하고 warnings에 남긴다.",
    "</sellerpilot_style_learning>",
  ].join("\n");
}

/**
 * Keeps the master-generation context focused on reusable art direction and
 * channel safety. The full registry remains available to the UI and audits;
 * channel-specific description, thumbnail and shot repetition is intentionally
 * deferred because the master output is channel-neutral.
 */
export function buildMarketplaceMasterStyleBrief(categoryHint: string) {
  const category = matchStyleCategory(categoryHint);
  const examples = learnedProductExamples.filter((item) => item.categoryId === category.id);
  const channelLines = channelStyleProfiles.map((profile) => (
    `[${profile.channel}] 제목: ${profile.titleFormula} 금지/검수: ${profile.guardrails.join(" / ")}`
  ));
  return [
    `<sellerpilot_master_style version="${STYLE_LEARNING_VERSION}" researched_at="${STYLE_LEARNING_RESEARCH_DATE}">`,
    `선택 카테고리: ${category.label} (${category.id})`,
    examples.length
      ? `학습 커버리지: 이 카테고리 상품 유형 20개 × 제작 변형 10개 = ${examples.length}개.`
      : "학습 커버리지: 일반 상품 안전 모드 · 실제 상품 사진과 판매자 확정 정보 우선.",
    `카테고리 문안: ${category.textStyle}`,
    `카테고리 상세 배치: ${category.detailLayout.join(" → ")}`,
    `카테고리 썸네일: ${category.thumbnailStyle}`,
    `카테고리 촬영: ${category.shotList.join(", ")}`,
    `필수 사실: ${category.requiredFacts.join(", ")}`,
    `카테고리 금지/검수: ${category.guardrails.join(" / ")}`,
    ...channelLines,
    "공통 적용: 상품 사실과 공식 정책이 스타일보다 우선하며, 다른 판매자의 문장·이미지·브랜드 표현을 복사하지 않는다.",
    "공통 적용: 가격·할인·배송·후기·판매량을 제작물에 고정하지 않고, 제품 외형·라벨·구성품을 바꾸지 않는다.",
    "</sellerpilot_master_style>",
  ].join("\n");
}

export function channelStyleFor(channel: ActiveChannelKey) {
  return channelStyleProfiles.find((profile) => profile.channel === channel);
}
