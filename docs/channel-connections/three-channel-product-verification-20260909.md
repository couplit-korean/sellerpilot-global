# Shopee·Lazada·Temu 상품 등록 연결 검증 — 2026-09-09

## 판정과 범위

세 채널은 상품 전용 registry → 채널 실행기 → provider 결과/공식 재조회 → 상품 완료 처리로 연결돼 있다. 이번 검토에서 공식 문서와 다른 전송값, SKU 필수값 검사의 누락, 상품 입력 수정의 오류 보고 문제를 보완했다. **코드·로컬 검증과 실제 판매 등록은 별개다. 이번 작업의 신규 실등록 완료는 0/3이며 100% 운영 연동 완료로 표시하지 않는다.**

작업 루트: `/Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908`. 기준 HEAD `5b606b8314e7f1aef2dc4bcf16e593cba95ca71d`. 단독 작업. CS/배송 기능·SQL migration·운영 데이터·채널 상품·고객 답변 변경 없음. Vercel 배포 없음. Git 전달은 private origin의 integration-aside만 사용한다.

## 공식 문서 대조와 변경

### Shopee

- [글로벌 상품 등록](https://open.shopee.com/documents/v2/v2.global_product.add_global_item?module=90&type=1), [일반 상품 등록](https://open.shopee.com/documents/v2/v2.product.add_item?module=89&type=1)을 로그인된 공식 문서에서 확인했다.
- 글로벌 상품 API의 2026-09-01 변경으로 `condition`이 필수다. 등록 양식 검사와 실제 글로벌 CREATE 전송 직전에 NEW/USED 여부를 검사한다. 다른 채널의 REFURBISHED 값을 이 API에 허용하지 않는다.
- 글로벌 상품 API의 `normal_stock`은 문서 변경 이력에 2024-10-23 sunset으로 명시돼 있다. 기존 초안을 읽을 수 있게 유지하되 실제 `add_global_item` 전송에서는 제거하고 `seller_stock`을 사용한다. 두 표현이 함께 있으면 창고별 재고 합계와 기존 총량이 같은지 확인하며, 불일치는 임의 선택하지 않고 차단한다. 원본 초안은 변경하지 않는다.
- 기존 글로벌 생성 → 글로벌 재조회 → 발행 작업 → Shop별 상품 재조회 경로와, Shop 토큰/merchant 토큰 구분, 중복 SKU 검사, 이미지/카테고리/물류 조회를 회귀 검증했다. 물류 조건·필수속성·현재 판매 가능 상태는 실제 계정으로 재검증해야 한다.
- 소유 파일: `lib/product-registration/channels/shopee.ts`, `lib/channels/shopee-create-preflight.ts`. 상품 전용 준비/후처리: `provider-listing-runtime.ts`, `provider-shopee-post-publish-runtime.ts`.

### Lazada

- [상품 API 개요](https://open.lazada.com/apps/doc/doc?docId=120945&nodeId=29614), [CreateProduct](https://open.lazada.com/apps/doc/api?path=%2Fproduct%2Fcreate), [카테고리·필수속성 가이드](https://open.lazada.com/apps/doc/doc?docId=108146&nodeId=10557)를 기준으로 확인했다. 일반 판매자의 계약에 Marketplace Ease 전용 공급가 계약을 혼합하지 않는다.
- 기존 `/product/create` POST, `Request.Product` payload, 국가별 endpoint, 공식 `/product/item/get` 재조회 연결을 유지한다.
- 첫 번째 SKU만 보던 검사에서 **모든 SKU의 고유 SellerSku·가격·정수 재고·포장값** 검사로 변경했다. 두 번째 이후 SKU의 누락이나 중복 ID도 차단한다. 포장 내용 필수 확인은 기존 SellerPilot 등록 정책을 유지한 것으로, 모든 항목이 플랫폼 전체에서 무조건 필수라는 뜻은 아니다.
- 등록 폼 → 이미지/카테고리 준비 전 검사 → 채널 실행기 검사에서 같은 순수 검증 함수를 사용한다. 잘못된 SKU는 provider 요청/이미지 업로드 전에 차단한다. 현재 카테고리의 조건부 필수속성은 기존 공식 metadata 조회가 담당한다.
- 소유 파일: `lib/product-registration/channels/lazada.ts`, `lib/channels/lazada-create-preflight.ts`.

### Temu

- [상품 등록 V3 공식 명세](https://partner.temu.com/documentation?sub_menu_code=419748d505a3483f8d210d978cb813f8), 문서 표시 최신 변경 2026-08-06을 펼쳐 확인했다. 현재 구현의 `temu.local.goods.v3.add`와 GLOBAL router/JSON 요청 구조가 일치한다. 구형 `bg.local.goods.add`로 교체하지 않는다.
- `goodsBasic`, `skuList` 구조를 유지한다. 모든 SKU의 고유 externalSkuId·이미지·basePrice 금액 문자열/통화·정수 재고·포장 치수 문자열·사양명/값을 검사한다. 선택 사항인 listPrice가 제공되면 같은 통화이고 basePrice보다 큰지 검사한다. 실제 시장별 금액 상한·허용 소수 자릿수는 별도 현재 시장 계약 확인 대상이다.
- 한국 포장 무게 g/규격 cm 변환은 현재 KR 생성기와 맞는다. 미국의 lb/in 조건을 한국 입력에 적용하지 않는다.
- extCatName과 costTemplate은 API상 선택 사항이지만 SellerPilot의 현재 정확한 카테고리·배송 확인 정책에 따라 명시값을 요구한다. API가 카테고리를 자동 추천/대체할 수 있으므로 CREATE 수락만으로 카테고리 확정을 주장하지 않는다.
- 기존 외부 ID 중복 사전 조회·불명확한 CREATE 결과의 재조회·goodsId/상태/가격/재고/이미지 검사와 safe_test 격리 흐름을 유지한다.
- 소유 파일: `lib/product-registration/channels/temu.ts`, `lib/channels/temu-create-preflight.ts`.

### 상품 입력 수정과 분리 유지

`lib/channel-registration-form.ts`에서 부모 객체 패치에 SKU/카테고리 같은 보호 식별자가 들어온 경우, 일반 비편집 필드 무시보다 식별자 변경 거부를 먼저 수행한다. 기존에도 해당 패치는 적용되지 않았으나 오류가 조용히 무시됐고 기존 회귀 테스트가 실패했다. 이제 명시적으로 오류를 반환하며 직접 보호 필드 수정 무시 정책은 유지한다. 관련 14/14 통과. 이전 전체 검사의 7개 실패 중 이 항목 1개를 해소했으며, 다른 6개 일반 기능 실패를 해결했다고 주장하지 않는다.

새 공통 `lib/product-registration/sku-contract.ts`는 순수 값 검사만 포함한다. 인증·전역 상태·CS·배송 호출이 없다. 영역 간 6방향 의존과 채널 실행기 교차 의존을 다시 검사했다.

## 현재 운영 증거

JEONGHUN Chrome의 실제 `sqaoqucxakebqkiygdxb` 프로젝트를 SQL Editor로 읽기 조회했다. 연결된 Supabase 도구는 이 프로젝트 권한이 없어 사용 가능한 다른 프로젝트를 대신 조회하지 않았다. 비밀 원문은 조회/저장하지 않았다.

| 채널 | 이번에 확인한 현재 저장 상태 | 실등록 전 남은 조건 |
|---|---|---|
| Shopee | production 자격 v80 active, 마지막 진단 passed는 **9/6 기록**. Shop 타깃 8개. 현재 SG listing은 failed, remote_id 없음 | 관리자 로그인 복구 → 현재 승인 상품/Shop·category·물류 재검증 → 실제 API 진단 → 중복 확인 후 한 번 등록/재조회 |
| Lazada | production 자격 v5 active지만 마지막 진단 failed는 **9/4 기록**, 판매자 식별 검증 시각 NULL. 타깃/상품 listing 없음. 개발자 포털도 로그인 화면 | 개발자/판매자 인증과 실제 워커 진단 → 권위 있는 seller/country 결속 → 타깃/카테고리·필수속성 준비 → 승인 상품 등록/재조회 |
| Temu | 활성 자격/타깃/listing 없음. 공식 앱 SellerPilot Inactive. App information Approved, Security Questionnaire Approved, Compliance Questionnaire Rejected | 설문 4번의 클라우드 제공업체 누락 보완 및 실제 인프라·egress IP 대조 → 정확한 재심사 제출/승인 → production 자격·mall·템플릿 결속 → 등록/재조회 |

Shopee 개발자 콘솔의 Couplit 앱은 Online이며 Live Partner ID는 2031489다. Live API Partner Key 만료 표시가 **15/09/26 00:59**여서 운영 지속을 위해 갱신 계획이 필요하다(화면 표시 시각; 시간대 추정 없음). DB의 OAuth expires_at과 partner key 만료는 다른 항목이다. 공식 API Test Tool의 선택 목록에는 테스트 Partner ID 1228201만 노출돼 실제 운영 진단으로 사용하지 않았다.

Temu 화면에 표시된 거절 사유는 `Cloud service provider is incomplete.`이다. 심사 전반이 전부 거절된 것이 아니라 컴플라이언스 설문 중 이 필드가 문제다. 사실성 책임 동의·재심사 제출은 실행하지 않았다. 기존 설문 내용 전체의 사실성을 이번 상품 API 검증으로 확인했다고 간주하지 않는다.

현재 실상품은 `1ed4acfc-7603-48ec-a638-241131e59358`, `AUTO-780720401E2D4E4EA45F`, 롯데 롯샌 파스퇴르 순우유맛 315g (6봉입)이다. 상세페이지 version=2, approved_version=0이다. 따라서 승인 완료 상품으로 취급하거나 오래된 타 상품 QA remote ID를 이 상품에 연결하지 않는다.

서비스 `https://sellerpilot-global.vercel.app`는 JEONGHUN에서 관리자 로그인 화면을 표시했다. 사용자에게 로그인을 요청했고 준비된 탭을 유지했다. 이 상태에서 과거 브라우저 로그인 완료 기록을 현재 로그인 성공으로 간주하지 않는다.

## 검증 및 증거 파일

- 상품·채널 집중 회귀 231/231: `verification-20260909/product-regression.tap`.
- 상품 폼 식별/값 수정: `registration-form.tap`, 14/14 (최종 집중 회귀에 모두 포함).
- 업무 분리 40/40, 채널 분리 28/28: `domain-isolation.tap`, `channel-isolation.tap`.
- 업무/채널 정적 경계: `domain-boundaries.json`, `channel-boundaries.json`.
- 실제 저장 상태와 외부 앱 상태 요약: `operational-state.json`. 저장된 과거 진단과 이번 provider API 호출을 구분한다.
- 고유 회귀 합계 299/299. 최종 타입·변경 파일 lint·로컬 build가 통과했으며 결과는 `verification-summary.json`에 기록한다. build:vercel은 로컬 빌드이며 배포 명령이 아니다.

## 실제 완료 판정 순서

1. 현재 관리자 인증과 대상 상품의 상세/필수값 승인 완료 확인.
2. 해당 채널의 현재 production 자격으로 seller/Shop/mall 식별과 상품 API 권한을 재검증.
3. 국가·카테고리·조건부 속성·이미지·가격/재고·배송 템플릿을 현재 공식 응답에 결속.
4. 기존 상품/이전 uncertain 작업의 중복 여부를 검사하고 상품 1건/채널 1건의 시도로 등록. 응답이 불명확하면 CREATE를 반복하지 않고 동일 시도를 재조회.
5. 공식 재조회에서 원격 ID·SKU·내용·이미지·가격·재고·판매 상태 확인. pending_review와 live를 구분.
6. DB listing/완료 영수증/웹사이트 조회와 구매자 화면까지 같은 상품을 대조한 채널만 실제 완료 처리.

이 순서의 현장 증거가 아직 없는 채널을 로컬 테스트 통과율로 100%라고 표시하지 않는다.
