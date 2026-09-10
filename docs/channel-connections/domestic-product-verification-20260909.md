# 국내 3개 채널 상품 등록 검증·보완 — 2026-09-09

## 범위와 판정

이 작업은 앞선 Shopee·Lazada·Temu 보완본 `96c4328b3e929ebf6db42197a986413485bc34c2`에서 출발하여 스마트스토어·쿠팡·11번가 상품 등록 경로를 검토하고 구체적인 중복/오판 가능성을 수정했다. 단독 작업이며 실제 판매채널 신규 등록·운영 DB 변경·Vercel 배포는 수행하지 않았다. **로컬 코드 검증과 실제 판매 등록 완료를 구분한다. 이번 실제 신규 등록 완료는 0/3이다.**

정본 작업 폴더는 `/Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908`이다. Git 전달은 private `Kimchanghee/sellerpilot-global`의 `integration-aside`만 사용한다. Vercel 연결 저장소는 변경하지 않는다.

## 스마트스토어

- 상품 전용 registry → `lib/product-registration/channels/smartstore.ts` → `/v2/products` → 원상품·채널상품·판매자코드 재조회 → 상품 완료 처리로 연결되어 있다.
- 신규 등록 직전 기존 코드에서는 SKU 검색 실패를 빈 결과처럼 처리할 수 있었고, 같은 SKU를 찾으면 CREATE 요청 안에서 기존 상품을 PUT 수정했다. 이 자동 전환을 제거했다. 기존 상품은 `listing.update`의 원상품/채널상품/SKU 식별 대조를 거쳐야 한다.
- `smartstore-create-preflight.ts`를 이미지 준비와 실제 CREATE 직전에 함께 적용한다. HTTP 200, 정상 응답, 완전한 첫/마지막 페이지, 총건수·총페이지와 실제 목록의 일치를 확인하고 **0건인 경우만** 생성한다. 검색 실패·비정상 본문·부분 페이지·불일치·기존 행 존재 시 상품 CREATE/PUT을 실행하지 않는다. 판매자 상품코드 없는 CREATE도 거부한다.
- 공식 [상품 등록](https://apicenter.commerce.naver.com/docs/commerce-api/current/create-product-product), [상품 목록 조회](https://apicenter.commerce.naver.com/docs/commerce-api/current/search-product), [채널 상품 조회](https://apicenter.commerce.naver.com/docs/commerce-api/current/read-channel-product-1-product)를 확인했다. 문서 current 표시는 2.88.0 (2026-09-07)이다. 검색·생성·재조회 API의 역할을 분리한다.
- 기존 판매 상품의 수정은 승인된 내용과 현재 원격값을 대조해 수행한다. 과거 상품번호나 검색 1건 발견만으로 현재 중앙 상품과 동일하다고 확정하지 않는다.

## 쿠팡

- 상품 전용 실행기 → seller-products POST → sellerProductId GET → 필요 시 임시저장 상태 확인 후 승인 요청 → 상품/옵션 가격·재고·판매 상태 재조회 흐름을 유지했다.
- 생성 응답에 ID가 없을 때 요청 body의 sellerProductId를 대신 쓰던 경로를 제거했다. 생성 응답의 ID 또는 명시적인 기존 `resumeRemoteId`만 사용한다. 성공 응답에서 ID가 누락되면 다른 상품을 GET/승인하거나 다시 POST하지 않는다.
- 출고지/반품지·최종 카테고리/고시·옵션·중량/단위·배송비/출고일 확인과 판매자 SKU 중복 사전 조회에 대한 기존 테스트를 실행했다. 상품 입력에 쓰는 배송정책과 주문 배송 실행 모듈을 합치지 않았다.
- 공식 구 도메인은 새 [상품 생성 문서](https://developers.coupang.com/ko/api/products/product-creation)로 이동한다. [승인 요청](https://developers.coupang.com/ko/api/products/request-for-product-approval)도 확인했다. requested=true의 승인 요청과 실제 승인/판매 상태는 별개의 단계로 처리한다.

## 11번가

- 상품 전용 실행기에서 필수 상품 XML/배송조건 → 공식 최종 카테고리 → sellerprodcode 중복 확인 → 필요 시 product POST → prodmarket 재조회 → 내용/판매 상태 검증으로 이어진다.
- 기존 코드의 모든 HTTP 404 허용을 제거했다. HTML 프록시 오류, 빈 404, 다른 사업 오류가 있는 404, HTTP 500의 본문 404는 상품 부재 증거로 인정하지 않는다.
- `elevenst-create-preflight.ts`에서 크기가 제한된 공식 XML의 ClientMessage/resultCode=404 또는 정상 빈 products 컬렉션만 부재로 인정한다. 실제 생성기와 읽기 전용 SKU 진단기가 같은 함수를 사용한다.
- XML parser의 sellerprodcode GET 메타데이터(루트 이름·본문 바이트수)를 오류 코드가 있는 응답에도 제공한다. 비밀 원문이나 XML 전체를 추가 출력하지 않는다. 새 POST가 불명확할 때 동일 SKU를 재조회하고 POST를 반복하지 않는 기존 흐름도 회귀 확인 대상에 포함했다.
- 공개 [OpenApiGuide](https://openapi.11st.co.kr/openapi/OpenApiGuide.tmall?categoryNo=41)는 HTTP 200/EUC-KR로 읽었으나 ProductSearch용이다. **이를 판매자용 상품등록 명세 검증 완료 근거로 쓰지 않는다.** 로그인된 판매자센터의 현재 상품등록 가이드 대조는 브라우저 복구 후 남아 있다.

## 앞선 3개 채널과 공통 등록 화면 추가 보완

- Shopee 글로벌 CREATE에서 condition·재고 누락/총량 충돌을 이미지 업로드 전에 검사한다. 허용한 소문자 condition은 실제 전송 시 NEW/USED로 정규화한다. 기존 정상 stock=0도 허용하며 원본 초안을 변경하지 않는다.
- Lazada·Temu의 앞선 모든 SKU 검사와 기존 상품 재조회 계약은 유지했다. 계정 인증·Temu 앱 승인 같은 외부 조건을 코드 테스트로 완료 처리하지 않는다.
- Shopee/Lazada 전용 재연결과 일반 채널 인가 요청에서 `AbortSignal.timeout` 직접 사용을 제거했다. `requestChannelConnection`은 AbortController로 헤더 수신부터 JSON 본문 읽기까지 25초 제한을 적용하고 타이머를 해제한다. 응답 지연이나 오류 시 인가 POST를 자동 반복하지 않는다. 구형 브라우저에 해당 정적 API가 없어도 요청을 시작할 수 있다.
- 상품 코드 오류를 판매자가 이해할 수 있는 ‘기존 상품 확인/정보 변경’, ‘중복 방지를 위해 등록 중단’, ‘상태·재고 확인’ 안내로 변환한다.

## 기존 전체 검사 실패 정리

이전 보고서의 일반 실패 6개는 해당 검사 4개 파일을 다시 실행해 먼저 재현했다. 이미지 worker의 개행·숫자 구분자·단일 import 표현 때문에 생긴 검사 불일치를 수정했다. 실제 제한 횟수/정확한 타임아웃 오류/원본 보존 조건 검사는 유지했다. 상품 모드 검사는 11번가의 명시적 조건 분기를 포함하도록 갱신했다.

대시보드 검사는 분리된 배송 화면의 완료 조건을 실제 소유 파일에서 검사하고 상위 화면 연결도 확인한다. 판매 구성 필드의 현재 필수 텍스트 입력/변경 처리와 원본 선택 해시 인자도 반영했다. 채널 인가 타임아웃의 실제 브라우저 호환 문제는 위 코드로 수정했다. 관련 71개가 모두 통과했으며, 최종 전체 결과는 아래 증거 JSON을 따른다. 이 수정은 이미지 생성 모델의 실출력 품질이나 운영 전체 성공 증거가 아니다.

## 검증 증거

최종 결과와 고유 검사 개수는 [검증 요약](domestic-verification-20260909/verification-summary.json)에 기록한다. 전체 TypeScript 검사, 업무 분리 40개, 채널 분리 28개는 겹치는 검사가 있으므로 단순 합산하지 않는다. 로컬 Next 빌드에는 업무/채널 경계 검사와 TypeScript 검사가 포함된다. 변경 소스/테스트 lint와 Git diff 공백 검사도 수행한다.

신규 회귀는 스마트스토어 실패/불완전 검색 시 쓰기 0·기존 SKU 이미지 업로드 0·정상 CREATE 후 GET, 쿠팡 응답 ID 누락 시 임의 ID 조회 0, 11번가 오류 404 생성 차단, Shopee 잘못된 초안의 사전 차단, OAuth 헤더/본문 타임아웃 및 재전송 0을 확인한다. 읽기/프로토콜 정상 사례에서 legacy ok가 나와도 strict 완료 상태와 구매자 공개를 별도로 검증하는 계약은 유지한다.

## 현재 외부 접근 결과와 실등록 재개 순서

이번 Chrome CUA 연결은 30초/30초/15초 시간 초과로 프로필·탭을 읽지 못했다. 사용자에게 Chrome 연결 복구를 요청했다. 기존 CLI 키체인 인증을 메모리 안에서 사용해 실제 프로젝트 `sqaoqucxakebqkiygdxb` 접근만 확인했지만 HTTP 403이었다. 다른 Supabase 프로젝트로 대체하지 않았으며 자격 원문을 출력하거나 조회 범위를 확대하지 않았다. 작업 폴더에는 실환경 .env가 없고 관련 프로세스 환경변수도 없다.

따라서 **이번 국내 채널의 현재 credential/listing/승인 상태는 재조회하지 못했다.** 지난 작업에서 읽은 상품 상세 version=2/approved_version=0 및 국내 과거 상품번호는 현재 검증값이 아니다. 과거 스마트스토어 13749310594, 11번가 9598600918 또는 쿠팡의 기존 등록 이력을 새 등록 성공으로 재사용하지 않는다.

1. JEONGHUN의 현재 SellerPilot 관리자 세션과 실제 Supabase 프로젝트 접근을 확인한다. CHANGHEE 판매자 화면에서 해당 상점/계정을 대조한다.
2. 중앙 상품 `1ed4acfc-7603-48ec-a638-241131e59358`, SKU `AUTO-780720401E2D4E4EA45F`의 현재 승인 상세·가격·재고·판매 구성과 채널별 필수값을 확인한다. 승인되지 않은 상세를 임의로 승인 처리하지 않는다.
3. 3개 채널의 기존 listing/attempt/job/원격 SKU를 읽는다. 원격 상품이 있거나 이전 생성 결과가 불명확하면 공식 재조회와 기존 상품 결속/수정 경로를 사용한다.
4. 없는 것이 확인된 대상만 현재 승인 입력으로 SellerPilot의 프로그램 등록 경로를 한 번 실행한다. 이미 등록된 대상은 중복 생성하지 않는다.
5. 원격 상품/옵션 ID·제목·내용·이미지·가격·재고·판매 상태를 공식 GET으로 대조하고 중앙 완료 기록/웹사이트 표시 및 구매자 화면을 확인한다. 승인 대기는 판매 완료로 표시하지 않는다.

사전 검색과 생성 사이에 다른 도구/판매자가 동시에 등록할 가능성까지 API에서 원자적으로 제거했다고 주장하지 않는다. 중앙 작업 중복 제어와 실제 직전 조회를 유지하고 불명확한 시도는 재조회로 해결한다. 외부 접근이 복구되기 전까지 실제 등록 전체 완료/100%로 보고하지 않는다.
