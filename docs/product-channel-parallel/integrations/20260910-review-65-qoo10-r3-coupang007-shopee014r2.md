# 검토65 — Qoo10 local response-loss, Coupang007, Shopee014-r2

검토 시각: 2026-09-10 KST

## 완료 기준

이 문서는 로컬 중앙 통합과 반례 검증 기록이다. 코드 적용·테스트 통과·판매자센터 로그인은 실제 신규 상품 등록이나 운영 적용으로 계산하지 않는다. 외부 증거 분모는 8채널 × 6단계 = 48이며 이번 검토 뒤에도 19/48(39.6%), 신규 CREATE와 공식 원격·판매자/구매자 화면 확인은 0/8이다.

## Git 정체 원인 제거

중앙 worktree Git metadata에 2026-09-10 04:59 KST부터 0바이트 `index.lock`이 남아 여러 채널 작업의 `git status`, `git diff`, patch 적용이 10분~1시간 이상 대기했다. `lsof`에서 소유 프로세스가 없고 크기가 0임을 확인한 뒤 stale lock만 제거했다. 대기 중인 읽기 전용 Git 자식 프로세스만 종료했으며 채널 작업이나 변경 파일은 종료·삭제하지 않았다. 이후 중앙 `git status`와 patch 적용이 정상화됐다.

## Qoo10 015-r3 중앙 통합

- 채널 최종 patch: `qoo10-015-r3-local-response-loss.patch`
- 최종 SHA-256: `74da47ae8bbf598b3dba1635113ae7a51f176f462e3e8f3b35344946a556e60e`
- 중앙 route SHA-256: `2e110817a1812487952db81598f0a57f6e6ccb5c4b8d9d0ab67115a2dcbadd83`
- 중앙 helper SHA-256: `084411aaf0b11b238498480626fea7bff60c86c0bc1421d318db3e5f91ede050`
- migration SHA-256: `1dbaae9e69ad71dbf8217311a9ca66dd79e97ff03984bd6691c2cfb6b66c4b30`

local admin 경로도 `SetNewGoods` 직전 한 service RPC transaction에서 fresh QSM source, exact attempt/fingerprint, no-gateway-job 조건을 확인하고 QSM one-shot fence와 attempt `manual_required`, `pre_gateway_retryable=false` 전환을 함께 수행한다. provider 응답이 유실되면 같은 CREATE를 다시 호출하지 않고 exact SellerCode `GetItemDetailInfo` 읽기만 수행한다. 성공 응답은 exact source/attempt 전용 완료 RPC로만 `succeeded`가 된다.

중앙 검토에서 공식 재조회 자체가 예외를 내면 helper 밖으로 예외가 빠져 일반 `failed` 처리로 덮일 수 있는 추가 경계를 찾았다. provider boundary 이후 readback 실패를 `observation=null`인 `reconciliation_required`로 유지하도록 보완하고 동적 반례를 추가했다. 채널 정본도 같은 최종 bytes로 동기화됐다.

검증:

- Qoo10 관련 선택 suite: 75 assertions 통과
- local response-loss 추가 suite: 4/4 통과
- nonincremental TypeScript: 통과
- 변경 ESLint: 통과

QSM 로그인과 seller/shop 및 메뉴 확인은 완료됐지만 exact 새 등록용 item/SellerCode/dispatch/return source capture와 운영 DB 적용은 아직 없다. 따라서 Qoo10 외부 완료 단계는 올리지 않는다. independent Qoo10 r3 감사는 계속한다.

## Coupang006 독립 감사와 007 중앙 통합

006은 공식 GET snapshot과 local/serverless final CAS를 중앙에 연결했지만 독립 반례에서 다음 P1이 확인됐다.

1. top-level `sellerProductName`, `displayProductName`, `brand` 등 전체 provider request 의미 필드를 CAS하지 않는다.
2. 동일 category의 confirmed assignment가 여러 개면 임의 row를 선택할 수 있다.
3. outbound/return 조회가 첫 50건에 머문다.
4. TypeScript `localeCompare`와 PostgreSQL `COLLATE C`의 Unicode key ordering이 다르다.

Coupang007 patch `34cdd0e7562c2beed30add64263786a95b847f2726ce10bf95b01487485ebce5`를 중앙 006 위에 적용했다. 007은 UTF-8 byte canonical order, exact-one assignment, selected `placeCodes`/`returnCenterCodes` 공식 GET을 구현했다. 중앙 PGlite/route 17/17, TS 71/71, nonincremental TypeScript와 변경 ESLint가 통과했다.

전체 provider request digest와 official normalized payload의 SQL deep validation은 008로 계속한다. 008에서는 request body 변경, selected center 변조, same Vault secret ID 내용 변경 반례가 provider 호출 0을 증명해야 한다. 신규 migration 번호는 `20260910032500`으로 예약했다.

## Shopee014-r2 중앙 통합 후 HOLD

Shopee014-r2 cumulative patch `94c0d5f5c1c6fe6ce6fc955f6351a6187da07d37236e66ff9e20508dcec275f6`를 중앙에 적용했다. image 0..8, Global 9, local 10의 stage ledger와 response-loss 재실행 차단을 추가했다. 중앙 선택 검증과 독립 감사는 병행한다.

독립 감사에서 P1 3건이 확인됐다.

1. stage context가 queued approval revision/digest를 비교할 뿐 current product/approval/manifest/object-path rows를 다시 잠그지 않는다.
2. image `sourceSha256`가 URL path에서 파생되며 실제 다운로드 bytes SHA-256과 비교되지 않는다.
3. prepared projection 밖의 `video_upload_id`, `publish.item.pre_order` 같은 provider payload field를 추가해도 stage fence가 통과한다.

014-r3에서는 모든 stage current-source CAS, downloaded image bytes digest, strict final provider JSON digest를 연결한다. locale-independent canonical order, production-only early block, Shopee image `error_sign` fallback의 stage lifecycle도 함께 보완한다. 신규 migration 번호는 `20260910034000`으로 예약했다. 수정 전에는 Shopee CREATE를 허용하지 않는다.

## Temu와 다른 채널

Temu r17-r2 helper/RPC는 중앙 집중 검사에 통과했으나 실제 운영 producer 호출이 없어 HOLD다. Partner App Management 상태용 공개 Open API는 공식 문서에서 확인되지 않았으므로 UI 관측을 공식 API라고 표시하지 않는다. trusted operator UI observation을 service-only로 저장하는 1단계와, actual listing.create에서 token/category/compliance/shipping/exact goods/SKU 공식 GET 뒤 request-bound final source를 생성하는 2단계를 r19에서 누적 구현한다. 현재 확인 상태가 Inactive/Reviewing이면 provider GET·claim·enqueue·CREATE는 0이어야 한다.

SmartStore012-r2, Elevenst013/r3, Lazada015-r4, eBay012-r3도 각 고유 migration 및 frozen patch로 계속 진행한다. 공통 migration 예약은 Coupang 31500·32500, Elevenst 31700, SmartStore 32000, Temu 33000, Shopee 34000 순서로 충돌을 막는다.

## 변경 금지 경계

이번 검토에서 commit, push, Vercel 배포, 운영 Supabase migration, provider mutation, 신규 CREATE/UPDATE, 고객 응답은 수행하지 않았다.
