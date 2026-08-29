# 판매채널 실계정 UI·API 준비도 매핑

- 기준일: 2026-08-16
- 대상: Qoo10 QSM, Shopee Open Platform, Lazada Open Platform
- 검수 방식: 사용자가 열어 준 실계정 화면을 읽기 전용으로 확인하고, 실제 API 성공은 별도 증거로 판정

## 보안·검수 원칙

- 앱 키, 시크릿, 토큰, 판매자 ID, OAuth code, IP 원문은 문서·Git·브라우저 로그에 기록하지 않는다.
- 콘솔 로그인 성공은 API 연결 성공으로 계산하지 않는다.
- 실계정 쓰기는 승인된 테스트 상품 범위가 확정되기 전에 실행하지 않는다.
- API 완료는 `생성 → 조회 → 수정 → 판매중지`와 주문·웹훅 중복방지 증거까지 있을 때만 인정한다.

## 현재 판정

| 채널 | 확인된 상태 | 코드 구현 | 외부 차단 요인 |
|---|---|---|---|
| Qoo10 | QSM 실계정·상품목록·개별 상품등록 필드 확인 | Vault 버전 저장, 만료·교체 UI, 승인 상품 상세 읽기 진단 | Certification Key·승인 테스트 상품번호 미등록 |
| Shopee | Couplit 운영 앱 Online, 민감정보 권한, Test·Live Redirect Domain 반영, Main account와 8개 숍 Authorized | 최신 `/auth` 흐름, OAuth state 검증, 메인계정→숍별 토큰 교환·선택·갱신, 상품·주문·배송 v2 실행 경로 | Partner Key Vault 저장, SellerPilot 보안 콜백 토큰 교환 미완료 |
| Lazada | Seller In-house 앱 Online, OAuth2.0, 주요 API 권한 Active | state 검증, code URL 제거, 토큰 교환, Vault 저장, 72시간 전 자동 갱신, `/seller/get` 진단 | 운영 송신 IP를 Lazada White IP에 등록해야 함 |

세 채널 모두 실계정 API E2E를 통과한 상태는 아니다. 화면의 샘플 매출·주문·재고와 실제 연동 상태를 분리해 표시한다.

## 1. Qoo10 QSM 실제 상품등록 필드

### 식별·판매

- 대·중·소 카테고리와 브랜드 코드
- 상품명 최대 100자, 홍보문구 최대 20자, 판매자 상품코드 최대 100자
- JPY 판매가, 참고가, 재고, 구매제한, 할인, Q포인트

### 이미지·상세

- 대표 이미지 1장 필수, 권장 800×800, 최소 600×600
- 추가 이미지 최대 50장, 순서변경, 옵션별 이미지
- MP4 동영상 최대 1개·50MB
- 상세 원본과 Qoo10 820px 출력물 분리, 이미지 합계 40MB 제한

### 옵션·배송·부가정보

- 선택옵션, 추가구성, 텍스트옵션과 내부 Variant/SKU 매핑
- 배송비 코드, 출지·반품지, 운송사, 출고 SLA
- 검색 키워드 최대 10개, 원산지·중량·재질·표준코드·유통기한·A/S

## 2. Shopee Open Platform 준비도

### 확인된 상태

- 앱 유형: Seller In House System, 상태 Online
- 권한: Access to Sensitive Data 허용
- Redirect URL Domain: Test·Live 모두 `https://sellerpilot-global.vercel.app`
- 인증: Main account OTP 본인확인 통과, SG·MY·PH·VN·TH·TW·BR·MX 8개 숍 Authorized
- 수명: Access Token 4시간, Refresh Token 30일, 판매자 승인은 최대 365일

### 구현된 연결 흐름

1. 관리자가 웹에서 Partner ID·Partner Key를 일회 입력하고 원문은 서버에서 Vault로 이동한다.
2. 서버가 HMAC-SHA256 서명과 10분 유효 OAuth state를 만들고 HttpOnly·SameSite=Lax 쿠키로 검증한다.
3. Main account 승인 콜백의 `code`, `main_account_id`, `state`를 검증하고 `shop_id_list`·`merchant_id_list`를 받는다.
4. 메인계정 Refresh Token으로 숍·머천트별 Access/Refresh Token을 발급해 한 Vault 버전에 분리 저장한다.
5. 실행 JSON의 `shopId`로 대상 숍을 선택하고 Access Token 만료 전 해당 숍 토큰만 안전하게 갱신한다.
6. `get_shop_info` 읽기 검사를 통과한 뒤 상품·가격·재고·주문·출고 쓰기를 단계적으로 허용한다.

### 남은 외부 게이트

- 운영 Partner Key를 SellerPilot Vault에 입력
- SellerPilot 보안 승인 링크로 Main account OAuth code를 수신해 8개 숍 토큰으로 교환
- Push Callback 서명검증과 이벤트 구독 실검증

## 3. Lazada Open Platform

### 확인된 상태

- 앱 유형: Seller In-house APP, 상태 Online
- 인증: OAuth2.0 Server-side
- 수명: Access Token 30일, Refresh Token 180일
- 권한: 상품관리, 상품정보, 가격·재고, 물류, 주문이행, 주문정보, 카탈로그, 재무 등 Active

### 구현된 연결 흐름

1. 관리자가 웹에서 App Key·App Secret·국가를 일회 입력한다.
2. 서버가 원문을 Vault에 옮기고 10분 유효 OAuth state를 HttpOnly·SameSite=Lax 쿠키에 저장한다.
3. Lazada 승인 후 복귀하면 code를 URL에서 즉시 제거하고 timing-safe 방식으로 state를 검증한다.
4. 서버가 code를 Access/Refresh Token으로 교환하고 새 Vault 버전을 생성한다.
5. Supabase `pg_cron` 일정이 Vercel의 보호된 내부 경로를 호출해 Access Token 만료를 확인하고, 72시간 이내일 때 Refresh Token으로 교체한다. Vercel Cron은 사용하지 않는다.

### 남은 외부 게이트

- Vercel 운영 송신 IP를 Lazada White IP에 등록
- 판매자 읽기 API 1건 실호출
- 이미지 업로드 → 상품 생성 → 가격·재고 반영 PoC
- Order·Product·Fulfillment Push 콜백 서명검증·중복방지·누락 보정조회

## 4. 공통 운영 게이트

| Gate | 통과 조건 | 필요한 증거 |
|---|---|---|
| 01 자격증명 | 키·토큰을 Vault로만 연결 | 화면·로그 마스킹, 만료·교체 일정, 감사기록 |
| 02 읽기 PoC | 판매자·카테고리·상품 1건 조회 | 요청 ID, 정규화 결과, 재시도 기록 |
| 03 쓰기 PoC | 승인 상품 생성·조회·수정·중지 | 원격 상품·옵션 ID, 전후 상태, 부분실패 기록 |
| 04 주문·웹훅 | 주문 수집·중복제거·누락복구 | 서명검증, 이벤트 ID, 체크포인트 재시작 |
| 05 제한 운영 | 30~100 SKU와 장애 복구 | 호출제한, 토큰만료, 채널장애, 재고경합 결과 |

## 5. 다음 승인 필요 사항

- Qoo10 실제 QAPI 자격증명과 읽기 검사 상품번호
- Shopee 운영 Partner Key, SellerPilot 보안 콜백에서 8개 Shop Token 교환
- Lazada White IP에 넣을 고정 송신 IP
- 등록·수정·중지에 사용할 승인 테스트 상품 1개
- Lazada Push Callback 이벤트 그룹과 운영 도메인 등록

이 항목이 확정되기 전에는 실계정 쓰기 동작을 자동화하지 않는다.
