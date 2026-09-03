export const activeChannelKeys = ["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu"] as const;

// The Trading API ASQ connector is implemented for Sandbox verification, but
// production reads and replies remain fail-closed until a two-user eBay
// Sandbox flow and a real seller-account readback have both been recorded.
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
  help?: string;
  options?: { value: string; label: string }[];
};

export type ChannelDefinition = {
  key: ActiveChannelKey;
  code: string;
  mark: string;
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
const vendorDocsRequired = (note: string): ChannelCapability => ({ mode: "vendor_docs_required", note });

export const channelCatalog: Record<ActiveChannelKey, ChannelDefinition> = {
  qoo10: {
    key: "qoo10",
    code: "Q",
    mark: "큐텐",
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
  shopee: {
    key: "shopee",
    code: "S",
    mark: "쇼피",
    name: "Shopee Open Platform",
    market: "Global · Open Platform v2",
    authType: "oauth-user",
    credentialPolicy: "Access 4시간 · Refresh 30일 · 판매자 승인 최대 365일 · 자동 갱신",
    oauth: true,
    fields: [
      { key: "partner_id", label: "Live Partner ID", placeholder: "Shopee 운영 Partner ID" },
      { key: "partner_key", label: "Live Partner Key", secret: true, placeholder: "Shopee 운영 Partner Key" },
      { key: "shop_id", label: "Shop ID", optional: true, placeholder: "OAuth 완료 시 자동 저장" },
      { key: "main_account_id", label: "Main Account ID", optional: true, placeholder: "계정 단위 승인 시 자동 저장" },
    ],
    officialDocs: [
      { label: "Authorization", url: "https://open.shopee.com/developer-guide/20" },
      { label: "API Reference", url: "https://open.shopee.com/documents" },
    ],
    capabilities: {
      connection: api("서명된 /api/v2/shop/get_shop_info 읽기 검사"),
      categories: polling("/api/v2/product/get_category 정기 동기화"),
      imageUpload: api("/api/v2/media_space/upload_image"),
      listingCreate: api("/api/v2/product/add_item"),
      listingUpdate: api("/api/v2/product/update_item"),
      listingStop: api("/api/v2/product/unlist_item"),
      price: api("/api/v2/product/update_price"),
      inventory: api("/api/v2/product/update_stock"),
      orders: polling("/api/v2/order/get_order_list + get_order_detail"),
      shipment: api("get_shipping_parameter 확인 후 /api/v2/logistics/ship_order"),
      claims: api("Return/Refund API 권한과 지역별 상태를 기준으로 처리"),
      inquiries: polling("Chat API 권한이 활성화된 마켓의 대화·메시지 조회"),
      settlements: polling("Payment/Escrow API 권한으로 수입·정산 상세 조회"),
      webhooks: webhook("Push Mechanism 서명 검증 + 주문 폴링 보정"),
    },
  },
  lazada: {
    key: "lazada",
    code: "L",
    mark: "라자다",
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
      inquiries: api("IM 이력 초기 동기화 + Push 수신 · 정기 폴링 금지"),
      settlements: polling("Finance API 거래·정산 조회"),
      webhooks: webhook("IM/주문 Push 서명 검증 + 이벤트 중복 제거"),
    },
  },
  coupang: {
    key: "coupang",
    code: "C",
    mark: "쿠팡",
    name: "쿠팡 WING",
    market: "Korea · Open API",
    authType: "hmac",
    credentialPolicy: "Access/Secret Key 180일 · 만료 14일 전 재발급 · WING에서 관리",
    oauth: false,
    fields: [
      { key: "vendor_id", label: "Vendor ID", placeholder: "A00012345", help: "WING 우측 상단 판매자명 메뉴의 업체코드" },
      { key: "access_key", label: "Access Key", secret: true, placeholder: "Coupang Access Key", help: "WING → 추가판매정보 → OpenAPI Key" },
      { key: "secret_key", label: "Secret Key", secret: true, placeholder: "Coupang Secret Key", help: "재발급하면 Secret Key가 변경됩니다." },
      { key: "requested_by", label: "WING 실사용자 ID", placeholder: "상품을 등록하는 WING 로그인 ID", help: "상품 생성의 vendorUserId 필수값입니다. Vendor ID가 아니라 실제 WING 로그인 ID를 입력합니다." },
      { key: "market", label: "시장", optional: true, placeholder: "KR" },
    ],
    officialDocs: [
      { label: "개발자센터", url: "https://developers.coupang.com/ko" },
      { label: "OpenAPI 키 발급", url: "https://developers.coupang.com/ko/getting-started/issue-open-api-keynew" },
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
    mark: "11번가",
    name: "11번가",
    market: "Korea · OPEN API",
    authType: "seller-key",
    credentialPolicy: "32자리 OPEN API Key · 등록 IP에서만 호출 · 변경 시 즉시 재검사",
    oauth: false,
    fields: [
      { key: "api_key", label: "OPEN API Key", secret: true, placeholder: "11번가에서 발급한 32자리 Key", help: "OPEN API → API 관리 → API KEY 관리에서 확인합니다." },
      { key: "seller_id", label: "판매자 ID", optional: true, placeholder: "셀러오피스 판매자 ID" },
    ],
    officialDocs: [
      { label: "OPEN API 관리", url: "https://openapi.11st.co.kr/openapi/OpenApiServiceRegister.tmall" },
      { label: "개발 가이드", url: "https://openapi.11st.co.kr/openapi/OpenApiGuide.tmall" },
    ],
    capabilities: {
      connection: api("고정 IP 작업자에서 ProductSearch 1건 읽기로 Key·IP 허용 상태 검사"),
      categories: polling("카테고리 조회 API의 말단 카테고리를 주기 동기화"),
      imageUpload: api("상품 등록 시 공개 HTTPS 이미지 URL을 11번가가 다운로드"),
      listingCreate: api("POST /rest/prodservices/product → 판매자 상품 재조회 검증"),
      listingUpdate: api("PUT /rest/prodservices/product/{prdNo} → 동일 prdNo 사전·사후 조회 검증"),
      listingStop: api("PUT /rest/prodstatservice/stat/stopdisplay/{prdNo}"),
      price: vendorDocsRequired("판매자 가격 API 문서·서비스 권한 확인 필요"),
      inventory: vendorDocsRequired("판매자 재고 API 문서·서비스 권한 확인 필요"),
      orders: polling("등록 고정 IP에서 결제완료 주문을 최대 7일 단위로 주기 조회"),
      shipment: vendorDocsRequired("발주·송장 API 서비스 권한과 공식 엔드포인트 확인 필요"),
      claims: vendorDocsRequired("취소·반품 API 서비스 권한과 공식 엔드포인트 확인 필요"),
      inquiries: vendorDocsRequired("공식 상품 API에 상품 Q&A 목록·답변 기능이 존재하며, 로그인 개발 가이드의 상세 계약과 현재 Key 서비스 권한 확인 필요"),
      settlements: vendorDocsRequired("정산 API 서비스 권한과 공식 엔드포인트 확인 필요"),
      webhooks: unsupported("공개 OPEN API 가이드에 판매자 주문·문의 웹훅이 확인되지 않음"),
    },
  },
  temu: {
    key: "temu",
    code: "T",
    mark: "테무",
    name: "Temu Korea",
    market: "Korea · Partner Open API",
    authType: "seller-key",
    credentialPolicy: "Partner App Key·Secret + 판매자 Access Token · 승인 범위에 따라 교체",
    oauth: false,
    fields: [
      { key: "app_key", label: "App Key", placeholder: "Temu Partner App Key" },
      { key: "app_secret", label: "App Secret", secret: true, placeholder: "Temu Partner App Secret" },
      { key: "access_token", label: "Seller Access Token", secret: true, placeholder: "판매자 승인 후 발급된 Access Token" },
    ],
    officialDocs: [
      { label: "Partner Platform", url: "https://partner.temu.com/documentation" },
      { label: "Product Publishing V3", url: "https://partner.temu.com/documentation?sub_menu_code=419748d505a3483f8d210d978cb813f8" },
    ],
    capabilities: {
      connection: api("temu.local.goods.list.retrieve로 판매자 상품 1건 읽기"),
      categories: api("bg.local.goods.category.recommend 자동 추천"),
      imageUpload: api("V3가 공개 HTTPS 이미지 URL을 자동 다운로드·저장"),
      listingCreate: api("temu.local.goods.v3.add"),
      listingUpdate: api("bg.local.goods.update"),
      listingStop: api("bg.local.goods.sale.status.set · off-shelf"),
      price: api("bg.local.goods.priceorder.change.sku.price"),
      inventory: api("bg.local.goods.stock.edit"),
      orders: polling("bg.order.list.v2.get 기반 주문 수명주기·품목 체크포인트 조회"),
      shipment: api("창고·택배사 조회 → bg.logistics.shipment.v2.confirm → 운송장 재조회 검증"),
      claims: polling("bg.aftersales.parentaftersales.list.get 기반 반품·환불 상태·처리기한 동기화"),
      inquiries: polling("공개 구매자 채팅 API가 아닌 반품·환불 CS 작업함을 동기화"),
      settlements: polling("정산 권한 활성화 시 지급·거래 조회"),
      webhooks: webhook("앱 활성화 후 주문·주소·반품/환불 이벤트를 구독하고 정기 폴링으로 보정"),
    },
  },
  smartstore: {
    key: "smartstore",
    code: "N",
    mark: "네이버",
    name: "네이버 스마트스토어",
    market: "Korea · Commerce API",
    authType: "oauth-client",
    credentialPolicy: "Access Token 3시간 · 서버 자동 재발급 · Client Secret 별도 교체",
    oauth: false,
    fields: [
      { key: "client_id", label: "Application ID", placeholder: "Commerce API Application ID" },
      { key: "client_secret", label: "Application Secret", secret: true, placeholder: "Commerce API Secret" },
      { key: "token_type", label: "인증 유형", placeholder: "SELF", help: "내 스토어 애플리케이션은 SELF, 솔루션 구독 판매자 연동은 SELLER를 사용합니다.", options: [{ value: "SELF", label: "SELF · 내 스토어 앱" }, { value: "SELLER", label: "SELLER · 솔루션 구독 판매자" }] },
      { key: "account_id", label: "판매자 ID/UID (account_id)", optional: true, placeholder: "SELLER 유형에서만 필수", help: "SELF 유형은 비우고, SELLER 유형은 연결된 판매자 ID 또는 UID를 입력합니다." },
      { key: "after_service_phone", label: "스토어 A/S 전화번호", secret: true, optional: true, placeholder: "비우면 판매자 주소록에서 자동 조회", help: "주소록 연락처를 자동 사용하며, 다른 실제 A/S 번호가 필요할 때만 입력합니다." },
    ],
    officialDocs: [
      { label: "API센터 앱 관리", url: "https://apicenter.commerce.naver.com/ko/basic/main" },
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
    mark: "이베이",
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
      listingUpdate: api("불변 offerId·SKU·listingId 결속 후 Inventory item/offer PUT 및 독립 readback (CREATE·publish 없음)"),
      listingStop: api("offer withdraw 또는 수량 0 정책"),
      price: api("offer pricingSummary 수정"),
      inventory: api("PUT inventory_item/{sku} availability"),
      orders: polling("Fulfillment getOrders · 완료된 checkout 주문만"),
      shipment: api("createShippingFulfillment"),
      claims: api("Fulfillment refunds·payment disputes + Post-Order 범위"),
      inquiries: polling("Trading API GetMemberMessages 조회 + AddMemberMessageRTQ 답변"),
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
