# 5번 상품등록 · eBay 상태

- 갱신: `2026-09-10 17:36:00 KST`
- worktree: `/Users/kimchangheemac/dev/sellerpilot-product-ebay-local-20260910`
- branch: `codex/product-ebay-r5-local-20260910`
- 기준 SHA: `0fb40d4c608e3ea1778743c8e99377352c39054a`
- 라운드: r5
- 원장: 3/6 (올리지 않음). 실등록 0/8 유지
- 커밋/푸시: 없음

## 단계 상태

| 단계 | 상태 | 현재 증거 |
|---|---|---|
| accountVerified | false | 이번 세션은 로컬 HOLD 수리만. 공식 GET 재검증 없음 |
| requiredFieldsVerified | false | 운영 승인 revision 미결속 |
| localFlowPassed | true | HTTP claim incarnation 배선 포함. 관련 테스트 68/68 |
| integrated | false | 이 워크트리 공용 파일은 연결됨. 중앙/운영 미적용 |
| providerCreated | false | Inventory/Offer/Publish 쓰기 0 |
| remoteReadbackVerified | false | 신규 listing 공식 완료 계보 없음 |

## r4 HOLD 반례

| 반례 | 소유 코드 | 공용 배선 |
|---|---|---|
| 새 파일 patch metadata 무효 | 닫힘. 실제 파일로 기록, 깨진 patch 없음 | - |
| local OAuth refresh undefined 역참조 | 닫힘. `ebay-credential-refresh-receipt.ts` | `commerce-gateway-job.mjs` stage 응답을 파싱. undefined/non-OK 금지 |
| 다른 채널 nullable-attempt claim 거절 | 닫힘. 전역 claim 미래핑 + `ebay-create-claim.ts` 통과 | HTTP claim과 `processCommerceGatewayJob` 둘 다 eBay listing.create만 검사. 다른 채널 null attempt_id는 통과 |
| offer ID 없는 CREATE 응답 유실 복구 | 닫힘. GET-only SKU/marketplace 복구 | - |
| mutation CAS가 현재 stock/USD 생략 | 닫힘. 40000 `EBAY_CREATE_STAGE_COMMERCE_STALE` | route가 서버 ledger/category 후 `buildEbayCreateApproval` |
| canonical hash ≠ Inventory/Offer/빈 Publish bytes | 닫힘. 실제 UTF-8 전송 문자열 SHA-256 | route가 `sellerpilotEbayProviderRequestBodies` 봉인 |
| OAuth successor vs immutable stage receipt | 닫힘. rebind receipt + append-only trigger | credential-refresh가 incarnation만 반환. stage receipt 미변경 |
| admin approval 계약 불일치 | 닫힘. 중첩 객체 canonical 비교 + stock/USD | route가 client approval 제거 후 서버 조립. revision 없으면 닫힘 |
| publication fingerprint self-validate | 닫힘. 공식 GET projection 비교 모듈 | `listing-publication-readback.ts`가 공식 GET vs expectedArguments 비교 |

## 검증

- HTTP claim 경로가 `attachEbayCreateClaimIncarnation`을 타는지 확인. `public.sellerpilot_claim_channel_gateway_job` 미래핑
- 다른 채널 nullable-attempt: 거절하지 않음. eBay listing.create가 아니면 검사 없이 통과
- 관련 테스트 **68/68** (ts 53 + worker contract mjs 15). provider write/운영 SQL 없음
- `worker-no-scheduler.test.mjs`는 `ai-cli-worker.mjs` 소스 조회라 이번 배선 범위 밖
- 운영 SQL/OAuth refresh/provider write/배포/커밋/푸시: 0

## 공용 배선

이 워크트리에 적용됨. 제안 문서: `docs/product-channel-parallel/reports/ebay/ebay-r5-common-patches.md`

HTTP claim: `scripts/channel-gateway-worker.mjs`가 claim JSON을 `attachEbayCreateClaimIncarnation`으로 감쌈. claim RPC 자체는 래핑하지 않음.

아직 공용 미연결: 중앙/운영 반영, migration 40000 운영 적용.

## 다음 한 단계

40000을 검토한다. 그 전에는 provider create를 실행하지 않는다.
