# 상품 연동 운영 재조회 및 11번가 공식 계약 보완

2026-09-09 KST. 이번에는 Chrome 접근을 복구하여 실제 판매자센터와 Supabase 운영 프로젝트를 읽었다. 앞선 `remaining-product-verification-20260909.md`의 Chrome timeout / Supabase 접근 미확인은 당시 이력이다. **현재 Supabase 브라우저 SELECT는 성공했다. CLI 권한이 복구됐다는 뜻은 아니다.** 신규 상품 등록·상품 수정·운영 DB 쓰기·Vercel 배포는 이번에 수행하지 않았다.

## 이번 개발과 검증

- 로그인한 11번가 공식 [상품관리 개발가이드](https://openapi.11st.co.kr/openapi/OpenApiGuide.tmall?categoryNo=81)를 확인했다. `rtngdDlvCst`와 `exchDlvCst`는 10원 단위다. 두 필드의 로컬 검증에 이 조건이 빠져 있어 보완했다.
- 생성 전에 잘못된 금액을 거부하고 provider 호출이 0회인지 확인했다. 수정 snapshot의 잘못된 금액도 거부하며 원본은 바꾸지 않는다. 공개 실행 응답은 기존의 정제된 `ELEVENST_PREWRITE_VALIDATION_FAILED`를 유지한다.
- 전용 검사 52/52, 전체 TypeScript 3,004/3,004, `tsc --noEmit`, 변경 파일 ESLint, 업무/채널 경계 검사를 포함한 `build:vercel` 통과. 전용 검사는 전체 검사와 중복하므로 합산하지 않는다. 빌드는 로컬 수행이며 배포가 아니다.
- 상품 모듈 1개와 그 테스트만 변경했다. CS·배송 실행기와 migration 변경은 없다. [기계 판독 가능한 검증 요약](live-followup-20260909/verification-summary.json)을 함께 보관한다.

## 현재 운영에서 확인한 사실

프로젝트 `sqaoqucxakebqkiygdxb`, `sellerpilot_private`를 SELECT로 확인했다. 비밀 값과 고객 내용은 조회/기록하지 않았다. 표의 자격 상태는 저장된 마지막 검사 결과이며 이번 실시간 API 성공을 뜻하지 않는다.

| 채널 | 현재 DB에서 읽은 활성 production 자격 | 이번에 확인한 상품/접근 상태 | 다음 실행 조건 |
|---|---|---|---|
| Shopee | v80, 마지막 검사 passed 9/6, seller 확인 기록 있음 | 대상 SG listing failed, remote ID 없음, 오류 코드 `SHOPEE_SHOP_IDENTITY_MISSING` | 자격의 판매자 확인 기록과 실제 target/shop 식별이 왜 다르게 결속됐는지 조회한 뒤 Shop 연결 복구. SG SKU 부재/미완료 작업을 먼저 확인 |
| Lazada | v5, 마지막 검사 failed 9/4, seller 미확인 | 대상 listing 행 없음. 개발자 탭은 login URL이며 확장 프로그램 UI 때문에 본문 자동화가 차단됨 | 확장 UI 닫기, OAuth/판매자·국가 확인, target 결속, 승인 입력과 SKU 부재 검증 |
| Temu | 활성 자격 없음 | 실제 앱 Inactive, compliance Rejected, security Approved | 아래 설문 초안 검토/제출과 승인 후 토큰·seller/warehouse/카테고리·SKU 필수값 연결 |
| 스마트스토어 | v1, 마지막 검사 passed 9/6, seller 확인 기록 있음 | 대상 listing failed/remote ID 없음. 판매자센터 진입 시 로그인 필요 | 로그인 후 과거 상품 13749310594를 현재 SKU/계정과 대조. 기존 상품의 복구/수정 경로로 진행 |
| 쿠팡 | v1, 마지막 검사 passed 9/6, seller 확인 기록 있음 | DB listing 16375780938 published/live, `승인완료\|requested=false\|onSale=true`, 마지막 검증 9/8. Wing 상품관리 진입 시 세션 만료 | 로그인 후 기존 상품 재조회. 이전 성공 상품을 새로 생성하지 않음 |
| 11번가 | v2, 마지막 검사 passed 9/3, seller 확인 기록 있음 | 실제 couplit 판매자센터에서 9598600918와 정확한 중앙 SKU 일치. 품절/재고 0/무료배송, 가격 3,190원. 중앙 listing은 failed | 아래 재고·배송 불일치를 공식 수정 경로로 해결하고 원격/중앙/구매자 상태 재검증 |
| Qoo10 | v6, 마지막 검사 passed 8/20, seller 확인 기록 있음 | DB listing 1217536689 published/live, S2, 1,871 JPY, 마지막 검증 9/5 | 현재 일본 판매자/SellerCode/배송그룹/공개 상품을 재조회. 기존 상품 CREATE 금지 |
| eBay | v178, 마지막 검사 passed 9/3, seller 확인 기록 있음 | jeon_57 판매자센터의 진행 중 리스팅 4개 확인. 현재 롯샌 대상 listing 행/동일 SKU는 그 활성 목록에 없음 | 기존 Inventory 미발행 상품과 오퍼까지 조회한 후 3종 정책·위치·카테고리·내용 확인, 신규 생성 또는 기존 자원 복구 결정 |

자격은 7/8개 존재한다. 이는 연결 완성률 87.5%가 아니다. `tracx` 활성 자격도 있지만 배송 채널이므로 상품 8채널의 분모에 넣지 않는다.

### 공통 대상 및 승인 상태

- 상품 `1ed4acfc-7603-48ec-a638-241131e59358`, SKU `AUTO-780720401E2D4E4EA45F`, 롯데 롯샌 파스퇴르 순우유맛 315g(6봉입).
- 2026-09-08T23:45:56Z 운영 SELECT에서 재고 1, 상세 version 2 / approved_version 0. 상품 사실 확인 표시가 true여도 상세 승인과 동일하지 않다.
- 별도 SELECT에서 입력 배송비 3,000원, 배송 규칙은 결제 후 1~2영업일 내 출고. 유료배송 값을 임의로 0원으로 바꾸지 않는다.
- SellerPilot 관리자 탭은 로그인 화면으로 확인했다. 사용자에게 로그인 요청을 전달했다. 관리자로 입력·상세를 검토할 수 있기 전에는 SQL로 승인 값이나 성공 상태를 만들어 우회하지 않는다.

### 11번가: 존재 여부와 판매 가능 여부의 차이

실제 couplit 계정의 상품 9598600918은 정확한 SKU와 이름이 일치하며 2026-09-04 등록, 9/7 최종 수정이다. 원격 재고 0/품절/무료배송은 중앙 재고 1/배송비 3,000원과 일치하지 않는다. 원격에 상품이 있다는 이유로 `published`로 바꾸거나 다시 CREATE하지 않는다.

공식 가이드에서는 `dlvCstInstBasiCd=01` 무료, `02` 고정 배송비, `dlvCst1`은 02/03일 때 금액, `dlvCstPayTypCd=03` 선결제로 설명한다. `addrSeqOut`/`addrSeqIn`을 생략하면 기본 주소가 쓰일 수 있어 수정 시 계정 주소와 함께 확인해야 한다. 이 필드 의미 확인만으로 현재 유료배송 end-to-end 지원이 완료되는 것은 아니다.

현 실행 계약은 검증된 두 leaf category와 무료배송만 허용한다. `assertElevenstListingShippingSource`가 3,000원 입력을 `ELEVENST_PAID_SHIPPING_CONTRACT_UNVERIFIED`로 거부하는 것은 현재 구현 범위의 제한이며 이번에 제거하지 않았다. 후속 구현은 다음 경로를 한 번에 연결해야 한다.

1. 상품 등록 폼/서버의 승인 입력에서 배송비·선결제·묶음배송 여부·출고/반품 주소를 명시적으로 결속한다. 다른 상품의 주소/배송비를 기본값으로 재사용하지 않는다.
2. 무료/고정 유료배송의 XML 필드 조합과 원본 배송비 일치를 검증한다. 생성과 수정에서 같은 조건을 적용하고, 구형 snapshot을 조용히 변환하지 않는다.
3. 기존 상품 수정에서 바꿀 필드와 보존할 필드를 명확히 하며 상품번호/판매자 SKU/소유자를 대조한다. 현재 내용 수정 whitelist는 배송/재고 변경을 허용하지 않으므로 단순 whitelist 추가로 전체 snapshot PUT을 보내지 않는다.
4. 기존 9598600918에 대한 승인된 수정 한 건과 공식 GET 재조회로 실제 배송비/재고/판매 상태를 확인한다. 실패/미확정이면 재생성 대신 같은 작업 계보로 복구한다.
5. 중앙 listing 결과와 사이트 표시, 구매자 페이지를 대조한 뒤 완료로 판정한다.

### eBay: 확인한 기존 활성 상품

판매자 jeon_57, 활성 목록 전체 4개를 읽었다. 이는 현재 대상 상품 등록 성공을 뜻하지 않으며 비활성/미발행 Inventory가 없다는 증거도 아니다.

| 상품번호 | Seller SKU |
|---|---|
| 800551237986 | LIVE-MUG-20260823-01-US |
| 800551944930 | QA-20260823-NB-001-US |
| 800551945331 | QA-20260823-MC-001-US |
| 800551945442 | QA-20260823-CC-001-US |

### Temu: 수정한 것은 제출 전 초안

실제 SellerPilot 앱의 compliance 반려 사유는 Q4 cloud service provider incomplete였다. Q4에는 Vercel Inc와 amazon technologies inc.가 선택되어 있었다. 현재 외부 요청 IP와 설문 whitelist의 일치를 확인했고 APNIC RDAP의 네트워크 설명이 Korea Telecom임을 확인하여 **Korea Telecom을 Q4 초안에 추가**했다. IP 원문과 앱 비밀은 이 보고서에 싣지 않는다.

기존 Q5 설명에는 한국의 operator-managed fixed-IP worker, 미국 Vercel 처리, 싱가포르 AWS/Supabase 저장이 적혀 있다. 이 기록과 통신망 확인이 전체 데이터 흐름/보존 정책의 실제 구현 검증을 대신하지 않는다. **정확성·책임 수락 체크박스는 선택하지 않았고 제출하지 않았다.** 그 체크는 기존 답변 전체에 대한 준수/책임 확인이므로 사용자 검토 후 제출해야 한다. Q4 수정만으로 심사 통과를 보장하지 않는다.

## 전달 및 재개

코드/문서는 private `origin`의 `integration-aside`에만 전달한다. Vercel 연결 remote는 `vercel`이며 이번에는 push하지 않는다. 사용자 로그인 요청은 SellerPilot 관리자, 만료된 스마트스토어·쿠팡이다. Lazada의 다른 확장 프로그램 UI 닫기도 요청했다. 재인증 후에는 이 문서의 각 채널 기존 상품/실패 계보를 이어서 조회하고, 실제 입력 승인·공식 쓰기 응답·원격 readback·중앙 반영·구매자 확인을 각각 기록한다.
