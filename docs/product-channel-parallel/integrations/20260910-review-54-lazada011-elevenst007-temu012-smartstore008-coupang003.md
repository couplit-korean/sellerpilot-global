# 중앙 검토54 — Lazada011, Elevenst007, Temu r12, SmartStore008, Coupang003

검토 시각: 2026-09-10 03:49 KST

이번 배치는 다섯 채널의 신규 상품 CREATE 안전장치를 중앙 로컬 정본에 순차 적용했다. 코드 통합과 실제 판매채널 신규등록은 별도 단계다. 운영 provider 호출, 운영 DB migration, 배포, commit, push는 수행하지 않았다. 신규등록 증거는 `19/48`, 이 통합본의 신규 CREATE와 공식 원격/사이트 readback은 `0/8`로 유지한다.

## Lazada 011

`lazada-011-r1.patch` SHA-256 `701934d670fb3d28fcd6e7eec39a65dcf02bd03212a19bc5276faec74637f82c`를 적용했다. 신규 `runLazadaMyCreatePrewrite`는 010 readiness 전체를 검사하고, 요청 digest와 evidence를 마지막 lease 확인 뒤 다시 검증한 다음에만 mutation hook과 정확한 `POST /product/create` callback을 호출한다. 잘못된 endpoint, 변조된 payload, readiness 누락에서는 mutation과 CreateProduct 호출이 0이다.

중앙 전용 조합은 `12/12`, nonincremental TypeScript와 변경 파일 ESLint가 통과했다. 다만 현재 `executeLazada`의 실제 CreateProduct 지점에는 이 adapter가 아직 연결되지 않았다. 기존 prepare/execute가 seller와 SKU 조회를 중복하고, CREATE GetProducts limit도 공식 계약 `50`이 아니라 `100`이다. 서버가 current app/OAuth/target/category/brand/shipment/approval evidence를 만들어 adapter에 전달하는 builder와 단일 실행 경계가 남아 있다. 담당에는 012 server builder를 배정했고 0번이 실제 runtime 연결을 맡는다.

## Elevenst 007

`elevenst-007-r1.patch` SHA-256 `471912424a68f4223ed5bdd3f6225d424d19b8e28a2eeadb8ae57594f311b926`를 적용했다. processed-food 고시 11개 중 006 fixture에서 확인된 제품명·포장단위 2개 외 9개는 값별 허용 source 종류, 상품·카테고리·field·source revision·승인 revision이 모두 맞을 때만 해소된다. 기존 상품 회복 값, placeholder, 미래 source, source보다 이른 승인, 중복/미등록 code, raw seller identity를 차단한다. 02:00–06:00 KST 점검 종료 후에도 fresh availability read 없이는 자동 허용하지 않는다.

중앙 Elevenst 조합은 `95/95`, TypeScript, ESLint, 양 경계 감사가 통과했다. 이 preflight를 첫 provider GET 이전의 실제 신규 CREATE 경로에 강제하는 008을 담당에 재배정했다.

## Temu r12

`temu-001-r12-create-readiness-prewrite.patch` SHA-256 `7b2f71eaee6ccd27090e3bd090e76b996b7f861b5b65fc48404c8ad417495d1a`를 적용했다. 실제 `executeTemu(... listing.create ...)`는 첫 token-info read보다 먼저 `temu_review_and_create_prewrite_v1`을 요구하고, missing/Inactive/stale fingerprint/identity mismatch이면 provider 호출 0과 no-write 결과로 종료한다.

중앙 readiness·CREATE·publication 조합은 `53/53`, TypeScript, ESLint, 양 경계 감사가 통과했다. CHANGHEE 프로필의 current Partner Platform 화면은 Applications `Total 0 items`였으므로 앱 상태, 승인 asset, category/compliance, shipping/egress, duplicate read는 여전히 미확인이다. browser marker를 제거하고 service-owned DTO로 binding을 만드는 013 builder를 담당에 배정했다.

## SmartStore 008

`smartstore-008-r1.patch` SHA-256 `d71e9c2f87401a49847327cbc93dcbac1e5e06e1920eef46a31bc10e80a481fb`를 적용했다. CREATE 성공 응답의 서로 다른 `originProductNo`와 `channelProductNo`를 두 공식 GET에 결속하고, 전송한 상품 입력·카테고리/속성·브랜드/고시·배송/반품·승인 이미지/상세·채널상품 여섯 그룹을 정확히 재검증한다. 공식 응답이 필드를 생략하거나 그룹이 달라지면 완료하지 않으며 두 번째 CREATE나 보정 PUT을 보내지 않는다.

중앙 집중 검사는 `12/12`, TypeScript와 ESLint가 통과했다. 담당의 최종 008 보고서는 아직 수신 전이므로 patch 자체 검증만 통합 상태로 기록한다.

## Coupang 003

`CP-COUPANG-CREATE-SOURCE-REVISION-20260910-003.patch` SHA-256 `c56b8809eeb6ab8afa43b1eb81b9ee2409af3ebb71c326f15e92dcf87cae5a62`를 정확한 중앙 before hash에서 적용했다. 신규 source revision은 상품 원장, category/title/options/notices/price/stock/shipping/return, 승인 상세 이미지 8장, active credential incarnation과 seller identity를 한 digest에 묶는다. migration `20260910021500`은 첫 provider mutation boundary에서 현재 product/detail/credential/owner/request fingerprint를 다시 비교한다.

중앙 신규 회귀는 `9/9`, SmartStore와 합친 TypeScript, ESLint, 업무/채널 경계 감사가 통과했다. migration은 로컬 코드에만 있으며 운영 DB에는 적용하지 않았다.

## 중앙 판정

- 다섯 patch의 현재 로컬 적용: 통과
- 업무 도메인 교차 의존: 6방향 모두 0
- 채널 간 직접 의존: 0
- 실제 신규 CREATE: 0/8
- 공식 원격/판매자 화면 readback: 0/8
- 진행률: 19/48 = 39.6%

다음 중앙 순서는 Lazada server builder 및 CreateProduct 단일 경계 연결, 각 idle 담당의 다음 작업 재개, 새 frozen 제출의 before-hash 검토, 전체 TypeScript/경계/Next build 재검증이다.
