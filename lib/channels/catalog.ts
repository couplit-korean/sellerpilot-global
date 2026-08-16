export const activeChannelKeys = ["qoo10", "lazada", "coupang", "elevenst", "smartstore", "ebay"] as const;

export type ActiveChannelKey = (typeof activeChannelKeys)[number];
export type ChannelCapabilityKey =
  | "connection"
  | "categories"
  | "imageUpload"
  | "listingCreate"
  | "listingUpdate"
  | "listingStop"
  | "price"
  | "inventory"
  | "orders"
  | "shipment"
  | "claims"
  | "inquiries"
  | "settlements"
  | "webhooks";

export type CapabilityMode = "api" | "polling" | "webhook" | "manual" | "unsupported" | "vendor_docs_required";

export type ChannelCapability = {
  mode: CapabilityMode;
  note: string;
};

export type CredentialField = {
  key: string;
  label: string;
  secret?: boolean;
  optional?: boolean;
  placeholder?: string;
};

export type ChannelDefinition = {
  key: ActiveChannelKey;
  code: string;
  name: string;
  market: string;
  authType: "seller-key" | "hmac" | "oauth-client" | "oauth-user";
  credentialPolicy: string;
  oauth: boolean;
  fields: CredentialField[];
  officialDocs: { label: string; url: string }[];
  capabilities: Record<ChannelCapabilityKey, ChannelCapability>;
};

const api = (note: string): ChannelCapability => ({ mode: "api", note });
const polling = (note: string): ChannelCapability => ({ mode: "polling", note });
const webhook = (note: string): ChannelCapability => ({ mode: "webhook", note });
const unsupported = (note: string): ChannelCapability => ({ mode: "unsupported", note });
const vendorDocs = (note: string): ChannelCapability => ({ mode: "vendor_docs_required", note });

export const channelCatalog: Record<ActiveChannelKey, ChannelDefinition> = {
  qoo10: {
    key: "qoo10",
    code: "Q",
    name: "Qoo10 Japan",
    market: "Japan · QAPI",
    authType: "seller-key",
    credentialPolicy: "Seller Authorization Key 1년 · 내부 90일 교체 권장",
    oauth: false,
    fields: [
      { key: "seller_id", label: "Seller ID", placeholder: "QSM 판매자 ID" },
      { key: "api_key", label: "Seller Authorization Key", secret: true, placeholder: "QAPI 판매자 인증키" },
      { key: "test_item_code", label: "검사 상품번호", placeholder: "읽기 가능한 ItemCode" },
    ],
    officialDocs: [{ label: "QAPI Guide", url: "https://api.qoo10.jp/GMKT.INC.Front.QAPIService/Document/QAPIGuideIndex.aspx" }],
    capabilities: {
      connection: api("ItemsLookup.GetItemDetailInfo로 읽기 검사"),
      categories: polling("CommonInfoLookup.GetCatagoryListAll 정기 동기화"),
      imageUpload: api("외부 HTTPS 이미지 URL을 상품/다중 이미지 API에 매핑"),
      listingCreate: api("ItemsBasic.SetNewGoods"),
      listingUpdate: api("ItemsBasic.UpdateGoods"),
      listingStop: api("ItemsBasic.EditGoodsStatus"),
      price: api("ItemsOrder.SetGoodsPriceQty / Bulk"),
      inventory: api("ItemsOptions 수량·옵션 API"),
      orders: polling("ShippingBasic.GetShippingInfo_v3 체크포인트 조회"),
      shipment: api("ShippingBasic.SetSellerCheckYN_V2 → SetSendingInfo"),
      claims: api("Claim 취소·승인·재배송 API"),
      inquiries: polling("CSCenter.GetInquiryMessage / SetInquiryMessage"),
      settlements: polling("ShippingBasic 판매리포트 조회"),
      webhooks: unsupported("QAPI 공개 가이드에 범용 주문 웹훅이 없어 보정 주기조회 사용"),
    },
  },
  lazada: {
    key: "lazada",
    code: "L",
    name: "Lazada Open Platform",
    market: "MY · SG · PH · TH · VN · ID",
    authType: "oauth-user",
    credentialPolicy: "Access 30일 · Refresh 180일 · 자동 갱신",
    oauth: true,
    fields: [
      { key: "app_key", label: "App Key", placeholder: "Lazada App Key" },
      { key: "app_secret", label: "App Secret", secret: true, placeholder: "Lazada App Secret" },
      { key: "country", label: "국가 코드", placeholder: "my" },
    ],
    officialDocs: [
      { label: "LazOP 시작", url: "https://open.lazada.com/apps/doc/getting_started" },
      { label: "Product API", url: "https://open.lazada.com/apps/doc/doc?docId=108146&nodeId=10557" },
    ],
    capabilities: {
      connection: api("/seller/get 서명 읽기 검사"),
      categories: polling("GetCategoryTree / GetCategoryAttributes"),
      imageUpload: api("UploadImage / MigrateImage"),
      listingCreate: api("CreateProduct"),
      listingUpdate: api("UpdateProduct"),
      listingStop: api("RemoveProduct 또는 판매수량 0 정책"),
      price: api("UpdatePriceQuantity"),
      inventory: api("UpdatePriceQuantity / AdjustSellableQuantity"),
      orders: polling("GetOrders + GetOrderItems 누락 보정"),
      shipment: api("/order/fulfill/pack → /order/package/rts"),
      claims: api("Reverse/Return 주문 API 권한에 따라 처리"),
      inquiries: polling("Reviews API와 판매자 문의 권한 범위 사용"),
      settlements: polling("Finance API 거래·정산 조회"),
      webhooks: webhook("Push Mechanism 서명 검증 + 이벤트 중복 제거"),
    },
  },
  coupang: {
    key: "coupang",
    code: "C",
    name: "쿠팡 WING",
    market: "Korea · Open API",
    authType: "hmac",
    credentialPolicy: "Access/Secret Key · 만료일 콘솔 기준 · 90일 교체 권장",
    oauth: false,
    fields: [
      { key: "vendor_id", label: "Vendor ID", placeholder: "A00012345" },
      { key: "access_key", label: "Access Key", secret: true, placeholder: "Coupang Access Key" },
      { key: "secret_key", label: "Secret Key", secret: true, placeholder: "Coupang Secret Key" },
      { key: "requested_by", label: "요청자 ID", optional: true, placeholder: "미입력 시 Vendor ID" },
      { key: "market", label: "시장", optional: true, placeholder: "KR" },
    ],
    officialDocs: [
      { label: "개발자센터", url: "https://developers.coupang.com/ko" },
      { label: "HMAC 테스트 가이드", url: "https://developers.coupangcorp.com/hc/ko/articles/360033988873-OPEN-API-Test-%EA%B0%80%EC%9D%B4%EB%93%9C" },
    ],
    capabilities: {
      connection: api("서명된 상품 목록 1건 읽기"),
      categories: polling("카테고리 목록·메타정보·추천 API"),
      imageUpload: api("상품 생성 본문의 이미지 URL 규칙으로 전송"),
      listingCreate: api("seller-products 생성 후 승인 요청"),
      listingUpdate: api("승인필요/불필요 수정 API 분기"),
      listingStop: api("vendor-item 판매중지"),
      price: api("vendor-items/{id}/prices/{price}"),
      inventory: api("vendor-items/{id}/quantities/{quantity}"),
      orders: polling("ordersheets nextToken 조회 · 최대 50건"),
      shipment: api("발주확인 후 최신 수취정보 재조회 → 송장 업로드"),
      claims: api("취소·반품·교환 API"),
      inquiries: polling("상품문의/콜센터문의 조회·답변"),
      settlements: polling("매출·정산 API"),
      webhooks: unsupported("공개 판매자 API는 주문/CS 주기조회 중심으로 설계"),
    },
  },
  elevenst: {
    key: "elevenst",
    code: "11",
    name: "11번가",
    market: "Korea · Seller Open API",
    authType: "seller-key",
    credentialPolicy: "Open API Key 180일 · 만료 30일 전 경고",
    oauth: false,
    fields: [
      { key: "api_key", label: "Open API Key", secret: true, placeholder: "11번가 Open API Key" },
      { key: "seller_id", label: "판매자 ID", placeholder: "11번가 판매자 ID" },
      { key: "seller_api_base_url", label: "판매자 API Base URL", optional: true, placeholder: "로그인 문서의 운영 URL" },
    ],
    officialDocs: [
      { label: "Open API 센터", url: "https://openapi.11st.co.kr/openapi/OpenApiFrontMain.tmall" },
      { label: "판매자 상품 기능", url: "https://openapi.11st.co.kr/openapi/OpenApiServiceIntroduce.tmall?introduceType=PRODUCT" },
    ],
    capabilities: {
      connection: vendorDocs("판매자 상세 명세 로그인 후 운영 URL·서비스 코드를 확정해야 함"),
      categories: vendorDocs("카테고리 조회 지원 · 상세 XML 규격은 판매자 문서 필요"),
      imageUpload: vendorDocs("상품 이미지 규격은 로그인 문서 버전에 고정"),
      listingCreate: vendorDocs("상품 등록/수정 지원 · 서비스 코드 확인 필요"),
      listingUpdate: vendorDocs("상품 관리 지원 · 서비스 코드 확인 필요"),
      listingStop: vendorDocs("판매중지/재개 지원 · 서비스 코드 확인 필요"),
      price: vendorDocs("상품 수정 명세의 가격 필드 사용"),
      inventory: vendorDocs("재고 조회/수정 지원 · XML 명세 확인 필요"),
      orders: vendorDocs("주문 목록/상세 지원 · 상태 코드표 확인 필요"),
      shipment: vendorDocs("발주확인/배송처리 지원 · 택배사 코드표 확인 필요"),
      claims: vendorDocs("취소·교환·반품 승인/거부 지원"),
      inquiries: vendorDocs("상품문의/리뷰 지원 · 답변 서비스 코드 확인 필요"),
      settlements: unsupported("공개 소개 페이지에 정산 API 범위가 명시되지 않음"),
      webhooks: unsupported("공개 소개 페이지 기준 폴링 방식"),
    },
  },
  smartstore: {
    key: "smartstore",
    code: "N",
    name: "네이버 스마트스토어",
    market: "Korea · Commerce API",
    authType: "oauth-client",
    credentialPolicy: "Access Token 3시간 · 서버 자동 재발급 · Client Secret 별도 교체",
    oauth: false,
    fields: [
      { key: "client_id", label: "Application ID", placeholder: "Commerce API Application ID" },
      { key: "client_secret", label: "Application Secret", secret: true, placeholder: "Commerce API Secret" },
      { key: "token_type", label: "인증 유형", optional: true, placeholder: "SELF 또는 SELLER" },
      { key: "account_id", label: "판매자 계정 ID", optional: true, placeholder: "SELLER 유형일 때 필수" },
    ],
    officialDocs: [
      { label: "Commerce API", url: "https://apicenter.commerce.naver.com/docs/commerce-api/current" },
      { label: "판매자 인증", url: "https://apicenter.commerce.naver.com/docs/commerce-api/current/exchange-sellers-auth" },
    ],
    capabilities: {
      connection: api("OAuth client_credentials → /v1/seller/account"),
      categories: polling("카테고리·속성·브랜드 최신 버전 동기화"),
      imageUpload: api("/v1/product-images/upload"),
      listingCreate: api("POST /v2/products"),
      listingUpdate: api("PUT /v2/products/origin-products/{id}"),
      listingStop: api("상품 다건 변경/상태 변경 API"),
      price: api("상품 원본 수정 또는 다건 변경"),
      inventory: api("/v1/products/origin-products/{id}/option-stock"),
      orders: polling("last-changed-statuses 1~3분 + moreFrom/moreSequence"),
      shipment: api("발주확인·발송처리 API"),
      claims: api("취소·반품·교환 API"),
      inquiries: polling("상품문의/고객문의 조회·답변"),
      settlements: polling("정산 내역 API"),
      webhooks: unsupported("주문 변경분 API의 체크포인트 폴링 사용"),
    },
  },
  ebay: {
    key: "ebay",
    code: "E",
    name: "eBay Global",
    market: "Global · Sell APIs",
    authType: "oauth-user",
    credentialPolicy: "User Access 2시간 · Refresh 장기 토큰 · 자동 갱신",
    oauth: true,
    fields: [
      { key: "client_id", label: "Client ID (App ID)", placeholder: "eBay App ID" },
      { key: "client_secret", label: "Client Secret (Cert ID)", secret: true, placeholder: "eBay Cert ID" },
      { key: "ru_name", label: "OAuth RuName", placeholder: "eBay Redirect URI name" },
      { key: "marketplace_id", label: "Marketplace ID", optional: true, placeholder: "EBAY_US" },
    ],
    officialDocs: [
      { label: "Selling Integration", url: "https://developer.ebay.com/api-docs/sell/static/selling-ig-landing.html" },
      { label: "OAuth", url: "https://developer.ebay.com/develop/guides-v2/authorization" },
    ],
    capabilities: {
      connection: api("User OAuth → GET /sell/account/v1/privilege/"),
      categories: polling("Taxonomy category tree/aspects"),
      imageUpload: api("Inventory API HTTPS imageUrls 또는 EPS 연계"),
      listingCreate: api("inventory location → inventory item → offer → publish"),
      listingUpdate: api("inventory item/offer 수정 후 publish"),
      listingStop: api("offer withdraw 또는 수량 0 정책"),
      price: api("offer pricingSummary 수정"),
      inventory: api("PUT inventory_item/{sku} availability"),
      orders: polling("Fulfillment getOrders · 완료된 checkout 주문만"),
      shipment: api("createShippingFulfillment"),
      claims: api("Fulfillment refunds·payment disputes + Post-Order 범위"),
      inquiries: unsupported("Sell REST API 공통 문의함으로 통합되지 않아 Seller Hub 보조"),
      settlements: polling("Finances API 권한 추가 시 지급·거래 조회"),
      webhooks: webhook("Notification API 구독을 보조 신호로 사용하고 주문 폴링으로 보정"),
    },
  },
};

export const capabilityLabels: Record<ChannelCapabilityKey, string> = {
  connection: "연결 검사",
  categories: "카테고리",
  imageUpload: "이미지",
  listingCreate: "상품 등록",
  listingUpdate: "상품 수정",
  listingStop: "판매 중지",
  price: "가격",
  inventory: "재고",
  orders: "주문",
  shipment: "배송",
  claims: "클레임",
  inquiries: "CS 문의",
  settlements: "정산",
  webhooks: "실시간 이벤트",
};

export const capabilityModeLabels: Record<CapabilityMode, string> = {
  api: "API",
  polling: "주기조회",
  webhook: "웹훅",
  manual: "수동",
  unsupported: "미지원",
  vendor_docs_required: "문서 승인 필요",
};

export const disabledChannelDefinitions = [
  { key: "alibaba", name: "Alibaba.com", reason: "차후 B2B 공급채널 연결 예정" },
  { key: "1688", name: "1688", reason: "차후 중국 내수 공급채널 연결 예정" },
] as const;

export function isActiveChannelKey(value: string): value is ActiveChannelKey {
  return (activeChannelKeys as readonly string[]).includes(value);
}

export function requiredCredentialKeys(channel: ActiveChannelKey) {
  return channelCatalog[channel].fields.filter((field) => !field.optional).map((field) => field.key);
}
