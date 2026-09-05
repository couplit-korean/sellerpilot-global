export type UserNoticeTone = "success" | "info" | "warning" | "error";

const defaultErrorMessage = "요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";

function messageText(input: unknown) {
  if (input instanceof Error) return input.message;
  return typeof input === "string" ? input : "";
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Rewords operational terminology that is meaningful to engineers but not to
 * sellers. This helper is intentionally pure so both server and client code can
 * apply the same customer-facing vocabulary.
 */
export function customerFacingCopy(value: string) {
  return normalize(value)
    .replace(/DB\s*마이그레이션/gi, "서비스 준비")
    .replace(/상품\s*원장/g, "상품 목록")
    .replace(/실주문\s*원장/g, "주문 목록")
    .replace(/공식\s*API/gi, "판매 채널")
    .replace(/Open\s*API/gi, "판매자 연동")
    .replace(/Partner\s*API/gi, "판매자 연동")
    .replace(/Commerce\s*API/gi, "판매자 연동")
    .replace(/Sell\s*APIs?/gi, "판매자 연동")
    .replace(/API\s*E2E/gi, "전체 연결")
    .replace(/QAPI/gi, "판매자 연동")
    .replace(/APIs?/gi, "판매 채널")
    .replace(/OAuth\s*연결/gi, "판매자 계정 연결")
    .replace(/OAuth/gi, "판매자 계정")
    .replace(/Vault/gi, "보안 저장소")
    .replace(/credentials?/gi, "연결 정보")
    .replace(/HMAC/gi, "보안 인증")
    .replace(/Partner\s*앱/gi, "판매자 앱")
    .replace(/Partner/gi, "판매자")
    .replace(/Developer/gi, "판매자")
    .replace(/Online/gi, "사용 가능")
    .replace(/Production/gi, "실제 판매용")
    .replace(/Sandbox/gi, "테스트용")
    .replace(/원격\s*상품/g, "판매 채널 상품")
    .replace(/원격\s*응답/g, "판매 채널 안내")
    .replace(/원격\s*오류/g, "판매 채널 오류")
    .replace(/원격/g, "판매 채널")
    .replace(/말단\s*카테고리/g, "최종 카테고리")
    .replace(/메타\s*정보|메타정보/g, "필수 정보")
    .replace(/CLI\s*작업자|CLI/gi, "자동 처리 기능")
    .replace(/런타임/gi, "실행 환경")
    .replace(/\bCS\b/gi, "고객 문의")
    .replace(/동기화/g, "업데이트");
}

function isSuccessMessage(message: string) {
  return /완료|성공|정상|저장했|등록했|변경했|삭제했|초기화했|준비했|확정했|적용했|발급했|연결했|전환했|가져왔|확인했습니다/.test(message)
    && !/실패|오류|못했|필요|만료|거절|누락|중단|불가/.test(message);
}

function operationLabel(operation: string) {
  if (operation.startsWith("categories.")) return "카테고리 확인";
  if (operation === "listing.create") return "상품 등록";
  if (operation === "listing.update") return "상품 정보 변경";
  if (operation === "listing.stop") return "상품 판매 중지";
  if (operation === "price.update") return "판매가 변경";
  if (operation === "inventory.update") return "재고 변경";
  if (operation.startsWith("orders.")) return "주문 확인";
  if (operation.startsWith("shipment.")) return "배송 처리";
  return "요청";
}

/** Convert any thrown/provider message into actionable, non-technical copy. */
export function userFacingErrorMessage(input: unknown, fallback = defaultErrorMessage) {
  const raw = normalize(messageText(input));
  if (!raw) return fallback;

  if (/EBAY_SHIPMENT_(?:EXISTING_CONFLICT|WRITE_UNCERTAIN|READBACK_UNAVAILABLE|READBACK_MISMATCH)\b/.test(raw)) {
    return "eBay의 송장 반영 결과를 먼저 확인해 주세요. 판매자센터에서 운송사·송장번호·주문 품목과 수량을 대조하기 전에는 다시 전송하지 마세요.";
  }
  if (/COUPANG_SHIPPING_FEE_CONFIRMATION_REQUIRED\b/.test(raw)) {
    return "쿠팡 배송비 유형과 금액을 확인해 주세요. 무료배송·유료배송·조건부 무료배송 설정과 반품 배송비를 모두 맞춰야 등록할 수 있습니다.";
  }
  if (/SMARTSTORE_SHIPPING_POLICY_CONFIRMATION_REQUIRED\b/.test(raw)) {
    return "스마트스토어 배송방법·택배사·배송비와 출고지·반품지를 확인해 주세요. 판매자 계정의 실제 배송정보를 입력한 뒤 등록해 주세요.";
  }
  if (/LISTING_SHIPPING_CONFIRMATION_REQUIRED\b/.test(raw)) {
    return "배송비·배송규칙·포장규칙과 채널별 배송정책을 확인해 주세요. ‘직접 입력 필요’ 항목을 채우고 적용할 배송정책을 확인해야 등록할 수 있습니다.";
  }

  const operationSuccess = raw.match(/^(.+?)\s+((?:categories|listing|price|inventory|orders|shipment)\.[a-z]+)\s+작업이\s+정상\s+응답했습니다\.?$/i);
  if (operationSuccess) return `${operationSuccess[1]} ${operationLabel(operationSuccess[2])}이 완료됐습니다.`;

  if (isSuccessMessage(raw)) {
    const polished = customerFacingCopy(raw);
    if (!/[A-Z][A-Z0-9_]{3,}|\b(?:HTTP|JSON|RPC|SQL)\b|\w+\.\w+\s+작업/i.test(polished)) return polished.slice(0, 240);
  }

  if (/사진|이미지|image|photo|picture|thumbnail|MEDIA_SPACE|MIGRATE_IMAGE|BIZ_CHECK_EXIST_OUTER_DESCRIPTION_IMAGE/i.test(raw)) {
    return "상품 사진을 등록 기준에 맞게 준비하지 못했습니다. JPG 또는 PNG 사진을 다시 선택하면 크기와 용량을 자동으로 맞춘 뒤 재등록합니다.";
  }
  if (/카테고리|category|NO_AUTHORITY|RESTRICTED_CATEGORY|NotAuthority\.product\.category\.id/i.test(raw)) {
    if (/권한|authori[sz]ed|permission|NO_AUTHORITY|RESTRICTED|등록할 수 없/i.test(raw)) {
      return "현재 선택한 카테고리는 이 판매자 계정에서 사용할 수 없습니다. 판매 권한을 확인하거나 상품에 맞는 다른 최종 카테고리를 선택해 주세요.";
    }
    return "상품에 맞는 판매 카테고리를 확인하지 못했습니다. 상품명을 더 구체적으로 입력하거나 카테고리를 직접 선택해 주세요.";
  }
  if (/SINGLE_SKU_REQUIRED|재고|inventory|stock|quantity|수량/i.test(raw)) {
    return "재고 정보를 판매 채널 기준에 맞추지 못했습니다. 옵션과 수량을 확인한 뒤 다시 시도해 주세요.";
  }
  if (/required|missing|mandatory|invalid.*(?:field|attribute)|attribute.*invalid|필수|누락|입력값|형식|NumberUnit|Invalid Attribute Value/i.test(raw)) {
    return "등록에 필요한 정보가 빠졌거나 형식이 맞지 않습니다. ‘직접 입력 필요’로 표시된 항목을 확인해 주세요.";
  }
  if (/token|oauth|credential|signature|error_sign|unauthori[sz]ed|forbidden|GW\.AUTHN|로그인|인증|세션|(?:^|\D)(?:401|403)(?:\D|$)/i.test(raw)) {
    return "판매 채널 연결을 다시 확인해 주세요. ‘채널 연결’에서 해당 계정을 다시 연결한 뒤 시도해 주세요.";
  }
  if (/rate.?limit|too many requests|quota|api call limit|(?:^|\D)429(?:\D|$)/i.test(raw)) {
    return "요청이 잠시 몰려 처리가 늦어지고 있습니다. 잠시 후 자동으로 다시 시도해 주세요.";
  }
  if (/network|fetch|timeout|timed out|gateway|ECONN|ENOTFOUND|AbortError|응답을 읽지 못|네트워크|시간이 예상보다 오래/i.test(raw)) {
    return "판매 채널 응답이 늦어지고 있습니다. 인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.";
  }
  if (/duplicate|idempot|conflict|이미 처리|(?:^|\D)409(?:\D|$)/i.test(raw)) {
    return "같은 요청이 이미 처리 중이거나 완료됐습니다. 잠시 후 등록 결과를 다시 확인해 주세요.";
  }
  if (/not found|찾지 못|없습니다|(?:^|\D)404(?:\D|$)/i.test(raw)) {
    return "요청한 정보를 찾지 못했습니다. 화면을 새로고침한 뒤 다시 선택해 주세요.";
  }
  if (/payload too large|file too large|(?:^|\D)413(?:\D|$)/i.test(raw)) {
    return "파일 용량이 너무 큽니다. 더 작은 파일을 선택하면 등록 기준에 맞게 자동으로 준비합니다.";
  }

  const polished = customerFacingCopy(raw);
  const containsInternalDetail = /https?:\/\/|[A-Z][A-Z0-9_]{3,}|\b(?:HTTP|JSON|RPC|SQL|payload|stack|trace|postgres|supabase)\b|(?:^|\s)at\s+\S+[:(]|\w+\.(?:create|update|list|get|stop|confirm|acknowledge)\b/i.test(polished);
  if (containsInternalDetail || !/[가-힣]/.test(polished)) return fallback;
  return polished.slice(0, 240);
}

function noticeToneFromMessage(message: string): UserNoticeTone {
  if (isSuccessMessage(message)) return "success";
  if (/못했습니다|실패|오류|거절|맞지 않습니다|사용할 수 없습니다/.test(message)) return "error";
  if (/필요|확인해 주세요|늦어|지연|이미 처리|잠시 후|없습니다/.test(message)) return "warning";
  return "info";
}

export function userNoticeTone(input: unknown): UserNoticeTone {
  return noticeToneFromMessage(userFacingErrorMessage(input));
}

export function userNotice(input: unknown, fallback?: string) {
  const message = userFacingErrorMessage(input, fallback);
  return { message, tone: noticeToneFromMessage(message) };
}
