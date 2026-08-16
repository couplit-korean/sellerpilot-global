# SellerPilot 판매채널 API 적용·기능차이 보고

기준일: 2026-08-16
대상: Qoo10 Japan, Shopee, Lazada, 쿠팡, 11번가, 네이버 스마트스토어, eBay
비활성: Alibaba.com, 1688

## 결론

7개 채널을 하나의 공통 기능표와 자격증명 Vault로 관리하도록 확장했다. Qoo10 QAPI, Shopee Main account 8개 숍 OAuth, Lazada OAuth, 쿠팡 HMAC, 네이버 Commerce OAuth 서명, eBay User OAuth와 자동 갱신을 구현했다.

또한 관리자 전용 `POST /api/admin/channel-operations` 실행 계층을 추가했다. Qoo10·Lazada·쿠팡·네이버·eBay의 카테고리, 상품 생성/수정/중지, 가격, 재고, 주문, 발주확인, 송장 경로를 서버 허용목록으로 고정했다. 외부 쓰기는 명시 확인과 멱등키가 없으면 거부하며, 같은 요청의 중복 실행은 DB 작업 원장에서 차단한다. 호출 인수는 [판매채널 실행 API 계약](./판매채널_실행_API_계약.md)에 정리했다.

다만 **실계정 API E2E 통과는 현재 0/7**이다. 키가 없는 상태에서 성공으로 표시하지 않았으며, 다음 외부 조건은 코드만으로 완료할 수 없다.

- Qoo10: Seller Authorization Key와 읽기 검사 ItemCode
- Shopee: 운영 Partner Key의 Vault 저장, SellerPilot 보안 콜백에서 Main account OAuth code를 8개 숍 토큰으로 교환
- Lazada: App Key/Secret, 판매자 OAuth, 단일 고정 송신 IP 허용목록
- 쿠팡: Vendor ID, Access Key, Secret Key
- 11번가: Open API Key와 로그인 전용 판매자 상세 XML 명세
- 네이버: Commerce API Application ID/Secret, SELF 또는 SELLER 유형
- eBay: Production Client ID/Cert ID/RuName과 판매자 1회 동의

## 코드 적용 범위

| 영역 | 적용 내용 |
|---|---|
| 공통 카탈로그 | 채널별 인증 방식, 필수 키, 공식 문서, 14개 기능 지원 모드 |
| 보안 저장 | 7개 채널 Vault 저장, 버전·지문·만료·경고·교체·감사 기록 |
| Qoo10 | 최신 `ebayjapan.qapi`, `ItemsLookup.GetItemDetailInfo` v1.2 읽기 진단 |
| Shopee | 최신 `/auth`, Main account 콜백, 8개 숍별 Access/Refresh Token, 4시간 토큰 선택·자동 갱신 |
| Lazada | SHA-256 서명, 판매자 OAuth, Access/Refresh Token, `/seller/get` 진단 |
| 쿠팡 | CEA HmacSHA256 서명, Vendor ID 헤더, 상품 목록 1건 진단 |
| 11번가 | XML/OpenApiKey 전송기와 명시적 `판매자 문서 승인 필요` 상태 |
| 네이버 | bcrypt `client_secret_sign`, 3시간 토큰, `/v1/seller/account` 진단 |
| eBay | RuName 동의, Authorization Code 교환, 실행 전 2시간 토큰 자동 갱신, privileges 진단 |
| 운영 화면 | 7개 키 카드, 키 수명·교체일·경고일, 연결 검사, OAuth 재연결, 보호된 API 실행 검수 콘솔 |
| 준비도 화면 | 채널별 근거·차단요인·공식 문서 링크·기능 지원 방식 표 |
| 실행 안전장치 | 허용된 공식 경로만 호출, 쓰기 재확인, 요청 지문, 멱등키, 단계별 원격 응답 |

## 채널별 기능 처리 원칙

### 1. 상품·가격·재고

- Qoo10은 상품, 가격/수량, 옵션 API가 분리되어 있다. 등록 후 받은 ItemCode와 내부 SKU를 별도 매핑한다.
- Shopee는 실행 시 `shopId`로 8개 국가 숍 중 대상을 선택하고 해당 숍 토큰으로 상품·가격·재고 API를 호출한다.
- Lazada는 Product API의 이미지 이전, 상품 생성/수정, 가격·판매수량 API를 사용한다.
- 쿠팡은 sellerProductId와 vendorItemId가 다르므로 상품 원장에 두 식별자를 모두 보관한다. 가격·재고·판매상태는 승인 완료 후 vendorItemId 단위로 처리한다.
- 11번가는 상품·재고 기능은 지원하지만 서비스 코드와 XML 필드는 로그인 문서 버전에 고정해야 한다. 확인 전에는 쓰기 버튼을 실행하지 않는다.
- 네이버는 Origin Product와 옵션 재고 API를 분리한다. Commerce API 버전 변경 시 카테고리·속성을 재동기화한다.
- eBay는 Inventory Location → Inventory Item → Offer → Publish 순서를 상태 머신으로 저장한다. Business Policy가 없으면 등록 전 차단한다.

### 2. 주문·배송

- 웹훅이 없는 Qoo10·쿠팡·네이버는 체크포인트 주기조회와 겹치는 시간 범위를 사용해 누락을 보정한다.
- Shopee Push Mechanism은 서명·이벤트 ID를 검증하고 국가 숍별 주문 폴링으로 누락을 보정한다.
- Lazada Push와 eBay Notification은 빠른 신호로 사용하되, 주기조회로 최종 정합성을 맞춘다.
- 쿠팡은 발주확인 후 출고 직전에 주문을 다시 조회해 변경 가능한 수취정보를 갱신한다.
- eBay Fulfillment API는 checkout 완료 주문만 반환하므로 결제 대기 주문을 같은 숫자로 집계하지 않는다.
- eBay에는 국내 채널식 별도 발주확인 단계를 만들지 않고 바로 `createShippingFulfillment` 배송처리만 제공한다.
- 모든 채널의 송장 전송은 외부 주문번호, 라인번호, 택배사 코드, 운송장번호를 멱등키로 묶어 중복 호출을 방지한다.

### 3. CS·클레임·정산

- Qoo10·쿠팡·네이버는 문의 조회/답변을 통합 CS함에 직접 연결한다.
- Shopee는 Chat/Return/Payment 권한과 국가별 지원 여부를 기능표에서 판정해 지원 숍만 활성화한다.
- Lazada는 승인된 API 권한 그룹 범위만 활성화한다.
- 11번가는 로그인 문서의 문의/클레임 서비스 코드를 확정하기 전 수동 콘솔 링크를 제공한다.
- eBay의 일반 판매자 메시지는 Sell REST API 공통 문의함으로 완전히 통합되지 않으므로 Seller Hub 보조 흐름으로 남기고, 환불·분쟁은 Fulfillment/Dispute 범위로 분리한다.
- 정산 기능은 각 채널의 권한과 지급 주기가 달라 공통 `정산 완료` 상태로 단순 합치지 않고 `예정/보류/지급/조정` 원장으로 정규화한다.

## UI에서 기능 차이를 처리하는 방법

모든 기능은 실행 전에 다음 모드 중 하나를 판정한다.

| 모드 | 동작 |
|---|---|
| API | 관리자 권한·입력·멱등키를 검사한 뒤 보호된 서버 경로로 즉시 실행 |
| 주기조회 | 마지막 체크포인트와 중복 제거 키를 저장하고 재시작 가능하게 처리 |
| 웹훅 | 서명 검증·이벤트 ID 중복 제거 후 처리하고 폴링으로 보정 |
| 문서 승인 필요 | 11번가처럼 규격 확정 전 쓰기를 차단하고 필요한 문서 항목 표시 |
| 미지원 | 버튼을 숨겨 혼동시키지 않고 사유와 판매자 콘솔 대체 경로 표시 |

대시보드는 `채널 × 기능` 지원표를 먼저 읽고 동작한다. 따라서 한 채널이 지원하지 않는 기능 때문에 전체 일괄작업이 실패하지 않는다. 일괄작업 결과는 성공, 재시도, 수동처리, 미지원으로 분할 보고한다.

## 현재 구현 경계

`API 키 · 인증` 화면의 **API 실행 검수**는 Shopee를 포함한 6개 채널의 공식 핵심 경로를 실제로 호출할 수 있는 관리자 도구다. 그러나 상품 등록 센터의 공통 상품 초안을 각 채널의 완전한 등록 payload로 자동 변환해 일괄 게시하는 업무 UI는 아직 이 실행 API와 연결되지 않았다. 다음 기능도 기능표와 설계만 있고 실행 어댑터·운영 검수가 남아 있다.

- 채널별 이미지 업로드·이전, 옵션/세트상품 상세 변환과 출고지·반품지 기준정보 동기화
- 취소·반품·교환, 고객 문의·답변, 정산 조회
- Shopee/Lazada Push와 eBay Notification 수신·서명검증, 폴링 체크포인트 스케줄러
- 429/5xx 지수 백오프, 실패 대기열, 부분 성공 보상과 운영자 재처리
- 공통 상품·채널 ID 매핑, 중앙 재고 예약/차감/복구 트랜잭션

따라서 현재 판정은 **핵심 API 실행 계층 6/7 코드 준비, 실계정 E2E 0/7**이다. 11번가는 로그인 전용 판매자 명세를 확보한 뒤 별도 계약 테스트를 추가해야 한다.

## 연결 후 검수 순서

1. Vault에 새 키를 일회성 입력한다.
2. 판매자/계정 읽기 진단을 통과한다.
3. 카테고리·속성·택배사·반품지 등 기준정보를 동기화한다.
4. 승인된 테스트상품 1건을 생성, 조회, 수정, 판매중지한다.
5. 테스트 주문의 조회, 발주확인, 송장, 취소/반품을 검수한다.
6. 웹훅 서명, 중복 이벤트, 폴링 누락 보정, 토큰 만료 복구를 검수한다.
7. 30~100 SKU 제한 운영 후 전체 운영으로 확대한다.

## 공식 문서

- [Qoo10 QAPI Guide](https://api.qoo10.jp/GMKT.INC.Front.QAPIService/Document/QAPIGuideIndex.aspx)
- [Shopee Authorization and Authentication](https://open.shopee.com/developer-guide/20)
- [Lazada Getting Started](https://open.lazada.com/apps/doc/getting_started)
- [쿠팡 개발자센터](https://developers.coupang.com/ko)
- [11번가 Open API](https://openapi.11st.co.kr/openapi/OpenApiFrontMain.tmall)
- [네이버 Commerce API](https://apicenter.commerce.naver.com/docs/commerce-api/current)
- [eBay Selling Integration Guide](https://developer.ebay.com/api-docs/sell/static/selling-ig-landing.html)
