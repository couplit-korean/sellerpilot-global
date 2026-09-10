# Shopee r6 local HOLD repair

- updatedAt: `2026-09-10T08:41:13Z` (`2026-09-10 17:41:13 KST`)
- worktree: `/Users/kimchangheemac/dev/sellerpilot-product-shopee-local-20260910`
- HEAD: `0fb40d4`
- round: r6
- ledger: 2/6 unchanged. 실등록 0/8 유지.
- provider/prod DB/deployment/OAuth writes: `0 / 0 / 0 / 0`

## 확인 완료

- r5 HOLD 반례 6건을 소유 테스트로 재현한 뒤 r6 코드에서 실패함을 확인했다.
  1. canonical object SHA ≠ 전송 JSON byte SHA. r6는 `JSON.stringify` 전송 byte만 해시한다.
  2. matching full draft 1개 + stale/conflict current draft는 `SHOPEE_SG_FULL_DRAFT_CARDINALITY`로 거절한다.
  3. OAuth successor 재결속 후 completed stage/global receipt가 옛 credential에 남지 않는다.
  4. 재결속은 현재 Vault secret incarnation을 CAS한다.
  5. `get_merchant_warehouse_list` body는 `cursor`만 허용하고 `warehouse_type` 우회를 거절한다.
  6. local-publish 완료는 mapping row와 job `succeeded`를 같은 트랜잭션에 쓴다.
- 예약 migration `20260910044000_shopee_create_transport_and_successor_hardening_r6.sql`는 달력 timestamp와 로컬 파일명 충돌 검사를 통과했다. SQL 식별자는 63바이트 이하다.
- `tests/shopee-sg-create-migration-chain.test.mjs` 3/3 초록. 44000이 structural tail에 포함된다.
- 공용 경로 4건을 이 워크트리에서 연결했다.
  1. `commerce-provider.ts` SG `listing.create`는 generic `prepareMarketplaceListingArguments` / 사전 fence를 건너뛰고 `executeShopee` → `executeShopeeSgCreateRuntime`에 stage 훅을 넘긴다.
  2. `commerce-gateway-job.mjs`는 `/api/channel-gateway/worker/shopee-create-stage`에 state/begin/complete/resume/record-global을 쓰고, credential refresh 후 `rebind-successor`를 호출한다.
  3. `commerce-completion.ts` generic succeeded는 `shopeeSgCreateCompletionMap.sameTransactionAsLocalPublish`가 있을 때만 성공하고, 없으면 generic ledger RPC를 타지 않는다.
  4. `serverless-gateway.ts` SG `listing.create`는 stage 훅을 직접 RPC로 제공한다 (`state`/`begin`/`complete`/`resume`/`record-global`). credential refresh 후 `rebind-successor`를 호출한다. succeeded 완료는 same-transaction map을 스키마 strip 이후에도 유지하고 generic ledger RPC를 타지 않는다.

## 미확인

- 운영 DB 미적용. provider CREATE 0. 공식 live readback 없음.

## 실행한 로컬 테스트

| suite | result |
| --- | --- |
| `tests/product-shopee-r6-transport-successor.test.ts` | 4/4 |
| `tests/product-shopee-r6-hardening-db.test.mjs` | 4/4 |
| `tests/product-shopee-create-prewrite-adapter.test.ts` | 7/7 |
| `tests/product-shopee-create-orchestration.test.ts` | 7/7 |
| `tests/product-shopee-provider-requirements.test.ts` | 5/5 |
| `tests/product-shopee-provider-images.test.ts` | 3/3 |
| `tests/product-shopee-listing-prepare-lineage-wiring.test.ts` | 2/2 |
| `tests/shopee-sg-listing-create.test.ts` | 8/8 |
| `tests/shopee-sg-create-migration-chain.test.mjs` | 3/3 |
| `tests/product-shopee-execute-glue.test.ts` | 8/8 |
| `tests/product-shopee-local-worker-stage-wiring.test.ts` | 2/2 |
| `tests/product-shopee-serverless-stage-wiring.test.ts` | 3/3 |

소유 초록: 51. 공용 경로 `serverless-gateway-provider.test.ts` fail: 0. 남은 fail: 0. 커밋/푸시 없음.

## 검토69 반례

- 전송 byte 해시: 닫힘
- full-draft 정확히 1개: 닫힘
- successor receipt 잔류: 닫힘
- Vault incarnation: 닫힘
- warehouse body 우회: 닫힘
- mapping/completion 원자성: 소유 SQL/트리거에서 닫힘. generic succeeded는 same-transaction mapping 증거가 있을 때만 성공. serverless 경로도 동일
- migration-chain: 닫힘 (3/3)

## 공용 연결

`docs/product-channel-parallel/reports/shopee/shopee-r6-common-gateway-atomic-completion.md` 를 이 워크트리에서 적용했다. serverless stage 훅도 같은 문서에 반영했다.

## 차단

- 운영 SQL 적용 금지, 실등록 금지, 커밋/푸시 금지.
- 칸 5·6 올리지 않음.

## 다음 한 단계

독립 검토. 운영 44000 적용은 이 라운드 밖이다.
