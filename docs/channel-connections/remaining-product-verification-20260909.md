# Qoo10·eBay 상품 등록 보완 및 8채널 잔여 작업

2026-09-09. 앞선 국제 3개·국내 3개의 미완료 조건을 유지하고 남은 Qoo10·eBay의 프로그램 등록 실행기를 보완했다. **최종 전체 TypeScript 회귀 3,000/3,000, 업무 격리 40/40, 채널 격리 28/28, 타입·변경 lint·로컬 Next 빌드 통과. 실제 판매 채널 변경과 이번 신규 등록 완료는 0건이다.** 테스트 통과를 계정 연동/구매자 노출의 100% 증거로 쓰지 않는다.

## Qoo10 변경

- strict CREATE의 판매자 계정 결속·최종 카테고리·배송그룹 사전 검사에 `ItemsLookup.GetItemDetailInfo` 1.2의 `ItemCode=""`, `SellerCode=현재 중앙 SKU` 조회를 추가했다. 이 네 조회가 모두 통과해야 `SetNewGoods`를 실행한다.
- 같은 SellerCode의 상품이 있으면 신규 등록하지 않는다. 기존 상품번호와 현재 계정/중앙 상품을 대조한 뒤 수정·재조회 경로로 진행한다. 조회 실패를 ‘상품 없음’으로 바꾸지 않는다.
- 공식 최신 문서 데이터에서 method 10007/version 1.2, ItemCode 또는 SellerCode 중 하나 필수, SellerCode 최대 100자, 결과 코드 `-10001`(상품 정보 없음)을 확인했다. 기존 공개 OpenApiService 페이지를 현재 QAPI 규격 대신 사용하지 않았다.
- 정상 `ResultCode=0`의 빈 배열 또는 HTTP 성공의 공식 `ResultCode=-10001`과 비어 있는 결과만 부재로 인정한다. 코드 누락, 인증/권한 오류, 만료, 일반 HTTP 오류, ‘상품 없음’과 실제 상품 행이 함께 오는 응답, 상충하는 ErrorCode는 차단한다.
- 판매자/카테고리/배송 사전 검사에서도 결과 코드가 누락된 응답을 성공으로 간주하지 않는다. 생성 후 기존 대표 이미지 결속·상세 이미지·가격/수량·분류·배송·공개 상태 재조회 계약은 유지한다.
- 적용 범위는 SellerPilot strict publication 계약의 신규 등록이다. 기존 상품 수정/읽기 복구에 부재 검사를 강제로 적용하지 않는다. 기존 하위 호환 호출 전체가 새 strict 계약이라고 주장하지 않는다.

## eBay 변경

- SKU 원문은 JSON과 결과 식별자에 사용하고 URL 경로에만 인코딩한다. 한글·공백·슬래시·더하기 기호 SKU가 오퍼의 다른 상품코드로 저장되는 문제를 수정했다.
- Inventory API의 inventory-item PUT은 전체 교체 동작이므로 신규 생성 전에 같은 SKU를 GET한다. 이미 존재하면 PUT·오퍼 POST·발행을 모두 중단하고 기존 상품 변경으로 안내한다.
- HTTP 400/404만으로 부재를 인정하지 않는다. `API_INVENTORY` 도메인의 공식 25702/25710 오류만 있는 경우를 확인한다. 권한 오류, HTML/빈 404, 다른 오류가 섞인 경우에는 쓰기 0이다.
- 오퍼 생성 응답 ID가 누락되거나 네트워크 응답을 잃으면 동일 SKU로 한 번 재조회한다. 생성 POST는 반복하지 않는다. SKU·marketplaceId·format이 모두 일치하는 오퍼가 정확히 하나이고, 전체 결과 수/페이지가 확인되어야 복구한다. 임의 첫 오퍼·다른 마켓 오퍼 fallback과 복구 직후 무조건 PUT을 제거했다.
- 발행 전에 실제 inventory-item과 offer를 읽어 요청한 내용의 부분집합 일치 및 offerId/SKU/marketplace/format을 대조한다. 가격·수량·제목·상태·정책·상세 등이 다르면 발행하지 않는다. 기존 PUBLISHED 오퍼의 ID가 확인되면 발행 POST를 반복하지 않는다. strict live 계약은 이후 ACTIVE 재조회도 필요하다.
- Inventory API의 ‘없음’은 해당 API가 관리하는 SKU 범위의 증거다. 판매자센터/Trading API로 만든 기존 상품은 이 API에서 보이지 않을 수 있으므로 별도 기존 상품 대조·채택이 필요하다. 이미 inventory-item만 만들어진 중단 작업은 CREATE 재전송 대신 기존 자원 조회/수정으로 복구한다.

## 공식 문서 근거

- [Qoo10 QAPI 가이드](https://api.qoo10.jp/GMKT.INC.Front.QAPIService/Document/QAPIGuideIndex.aspx): 공개 페이지가 사용하는 `QAPI.GetQAPIMethodList`, `GetQAPIMethodParamList`, `GetQAPIMethodReturnCodeList`, `GetQAPIMethodNoticeInfo`의 문서 조회만 수행했다. 상품 API 호출, 인증 키 발급, 실제 문서 화면의 실행 기능은 사용하지 않았다. 핵심 필드·코드는 [공식 계약 확인 기록](remaining-verification-20260909/official-contracts.json)에 저장했다.
- [eBay getInventoryItem](https://developer.ebay.com/api-docs/sell/inventory/resources/inventory_item/methods/getInventoryItem): SKU와 25702/25710 오류를 대조했다.
- [eBay inventory workflow](https://developer.ebay.com/api-docs/sell/static/inventory/pbse-phase1-rest-workflows.html): 기존 inventory item PUT의 전체 교체 동작을 확인했다.
- [eBay 25710 설명](https://developer.ebay.com/support/knowledge-base/5210): 수동/Trading 등록 상품의 Inventory API 가시성 한계를 확인했다.
- [eBay 발행 필수 입력](https://developer.ebay.com/api-docs/sell/static/inventory/publishing-offers.html): inventory/offer/정책/위치·공개 상태의 역할을 대조했다. 실제 계정의 카테고리별 필수 속성 및 정책 유효성은 인증된 조회로 추가 확인해야 한다.

## 8채널 현재 상태와 실등록 재개 조건

아래 ‘이전 확인’은 과거 저장값/조회 결과이며 이번 현재 운영 검증으로 재사용하지 않는다. 이번에는 Chrome `cua.getState()`가 20초에 시간 초과되어 프로필/탭/세션을 읽지 못했다. 앞선 작업의 실제 Supabase 프로젝트 접근 HTTP 403도 해결되었다는 증거가 없다. 같은 원격 오류를 반복 호출하지 않았다.

| 채널 | 누적 로컬 구현·이번 검증 | 운영에서 추가로 확인/처리할 내용 |
|---|---|---|
| Shopee | 글로벌 상태·창고 재고·필수값 검사, 이미지 전 사전 검증, 생성/재조회 회귀 | 이전 v80 passed는 9/6 이력. SG listing 실패/remote ID 없음 상태였으므로 현재 토큰/Shop과 목록·승인 입력부터 조회 |
| Lazada | 모든 SKU 필수값·속성·이미지/재조회 계약, 재연결 요청 | 이전 v5 failed·seller 식별 미확인·타깃 없음. 현재 OAuth/실제 판매자/국가 확인 후 타깃 결속 |
| Temu | 모든 SKU·옵션 이미지/사양·가격 타입·선택 정가 계약 | 이전 앱 Inactive, 보안 Approved/컴플라이언스 Rejected(클라우드 제공업체 누락), 활성 자격 없음. 현재 설문/심사/토큰 상태 확인 및 정정 필요 |
| 스마트스토어 | 완전한 SKU 부재 검사, 기존 상품 자동 PUT 제거, 등록/재조회 | 과거 13749310594를 현재 계정/중앙 상품과 다시 대조. 기존 상품은 수정 경로. 현재 토큰·최종 분류·출고/반품지 확인 |
| 쿠팡 | SKU 사전 검사, 생성 응답 ID 필수, 승인 요청·옵션별 가격/재고/상태 재조회 | 현재 자격·IP 제한·vendor 결속·출고/반품지·카테고리/고시와 기존 상품 확인. 승인 대기와 판매 완료 구분 |
| 11번가 | 공식 XML 기반 SKU 부재 검사, 불명확 CREATE 재조회, 상품/배송조건/상태 확인 | 과거 9598600918 재조회. 로그인 판매자 가이드/API 권한·화이트리스트·계정 결속 확인. 웹 로그인과 API Key는 별개 |
| Qoo10 | 이번 SellerCode 부재 검사·공식 오류표 적용, 기존 상세/대표 이미지/가격/재고/공개 재조회 | 과거 1217536689의 현재 계정·상품·상세·판매 상태 대조 후 수정/복구. 동일 상품 CREATE 금지. Seller key·국가·배송그룹 확인 |
| eBay | 이번 SKU 인코딩·기존 재고 보호·정확한 오퍼 복구·발행 전 내용 검사 | 현재 OAuth scope·marketplace·3종 정책·merchant location·카테고리 속성 확인. Inventory 외 기존 상품 및 미완료 오퍼를 먼저 대조 |

공통 순서:

1. 준비된 Chrome의 CHANGHEE 판매자/개발자 계정과 JEONGHUN의 SellerPilot 관리자·Supabase `sqaoqucxakebqkiygdxb` 접근을 확인한다. 다른 프로젝트나 기본 프로필로 대체하지 않는다.
2. 중앙 상품 `1ed4acfc-7603-48ec-a638-241131e59358` / SKU `AUTO-780720401E2D4E4EA45F`의 현재 상세 승인·이미지·가격·재고·채널별 필수값을 조회한다. 과거 상세 version=2/approved_version=0 기록을 임의로 승인된 것으로 바꾸지 않는다.
3. 중앙 listing/attempt/job과 원격 상품/SKU/오퍼를 함께 조회한다. 이미 존재하거나 생성 결과가 불명확하면 기존 상품 결속·수정·재조회로 해결한다.
4. 현재 승인 입력과 부재 확인을 갖춘 대상만 SellerPilot의 프로그램 등록 경로로 한 번 전송한다. 판매자센터 수동 입력을 프로그램 연동 완료로 대신하지 않는다.
5. 공식 GET에서 상품/옵션 ID·제목·내용·이미지·가격·재고·판매 상태를 대조하고, 중앙 완료 기록·웹사이트 표시·구매자 화면까지 확인한다. 외부 심사 대기를 성공으로 처리하지 않는다.

사전 조회와 생성 사이에 외부 판매자가 동시에 등록하는 경쟁까지 원자적으로 없앤 것은 아니다. 기존 중앙 중복 제어와 실행 직전 조회를 유지하며 미확정 작업을 새 CREATE로 재전송하지 않는다. 이 문서는 무결점 또는 8채널 실제 100% 완료 보증이 아니다.

## 검증 및 전달 범위

[검증 요약](remaining-verification-20260909/verification-summary.json)에 명령·검사 개수·소스 해시·로그 해시를 기록한다. 전체 TS 3,000개와 업무 격리 40개/채널 격리 28개에는 중복 검사가 있으므로 합산하지 않는다. 기존 테스트 mock을 실제 생성 전 GET 및 요청 내용의 재조회 응답에 맞추고, 새 실패/복구 회귀 34개를 추가했다.

상품 전용 실행기/사전 검사/안내 문구와 관련 테스트만 변경했다. CS 실행기, 배송 실행기, DB migration은 변경하지 않았다. 기존 지시에 따라 private origin의 `integration-aside`에 코드·문서만 커밋·푸시한다. Vercel 연결 저장소 푸시·Vercel 배포·운영 DB 변경·판매 채널 상품 쓰기·고객 메시지는 수행하지 않는다.
