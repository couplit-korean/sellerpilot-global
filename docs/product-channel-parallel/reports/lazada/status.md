# 6번 상품등록 · Lazada 상태 (r7 gateway 연결)

- 갱신 시각: `2026-09-10 17:37 KST`
- 워크트리: `/Users/kimchangheemac/dev/sellerpilot-product-lazada-local-20260910`
- 기준 HEAD: `0fb40d4c`
- 라운드: r7 (r6 HOLD 재제출 없음)
- 원장: 2/6 유지. 실등록 0/8 유지
- provider writes / production writes / OAuth: `0 / 0 / 0`

## 단계별 판정

| 단계 | 값 | 현재 증거와 남은 조건 |
|---|---|---|
| accountVerified | unknown | 이 라운드는 로컬 HOLD 수리만. Seller Center/OAuth 재확인 없음 |
| requiredFieldsVerified | unknown | 실등록 입력 재수집 없음 |
| localFlowPassed | true | 소유 69/69 유지. 공용 경로 7/7 추가 통과. 실등록 성공 의미 아님 |
| integrated | false | 커밋/푸시/운영 SQL 없음 |
| providerCreated | false | CreateProduct 실제 호출 0건 |
| remoteReadbackVerified | false | 공식 GetProductItem 실측 0건 |

## r7에서 닫은 검토69 반례

- CreateProduct 결과에 `officialEvidence`가 없으면 completion parser와 공용 complete가 거부한다.
- 생성 SKU 비교는 순서 무시 exact set이다.
- shape-only item readback + 호출자 remote-state boolean + 위조 provider status는 complete하지 못한다.
- `updated_at`이 같아도 product status/demo/on_hand와 listing status/remote_id drift는 TS·PGlite CAS가 거부한다.
- GET-only 복구는 POST CreateProduct 영수증과 분리된다. `/products/get`으로 CreateProduct 응답을 합성하면 거부한다.

## 공용 경로가 r7을 호출하는가

호출한다. 이 워크트리에서:

- `completeCommerceClaim`은 lazada `listing.create` 성공 complete 전에 `job.request.arguments`를 풀어 `sellerpilot_lzd_store_post_rcpt_r7` 또는 `sellerpilot_lzd_store_get_rcpt_r7`를 구분 호출한다. officialEvidence 없으면 complete RPC를 부르지 않는다.
- `serverless-gateway` completion은 `completeCommerceClaim`을 타고, execution은 `executeServerlessGatewayProviderJob` → `applyLazadaGatewayCreateProviderResult`를 타는다. GET-recovery는 mutation/prepare를 건너뛰고 read-only transport로 실행한다.
- `commerce-gateway-job` execution도 같은 `applyLazadaGatewayCreateProviderResult`와 GET-recovery read-only skip을 타고, completion은 `/api/channel-gateway/worker/complete` → `completeCommerceWorker`가 같은 r7 store RPC를 호출한다.
- `executeLazada` POST 경로는 raw bytes로 officialEvidence를 붙이고, GET-recovery는 `/product/item/get`만 쓰며 `/product/create`를 합성하지 않는다.

## 변경 파일

- `lib/product-registration/lazada/my-create-gateway-receipt.ts` (신규)
- `lib/product-registration/lazada/my-create-raw-readback.ts`
- `lib/product-registration/lazada/my-create-readiness.ts`
- `lib/product-registration/lazada/my-create-prewrite.ts`
- `lib/product-registration/lazada/my-create-postwrite.ts`
- `lib/product-registration/channels/lazada.ts`
- `lib/channels/commerce-completion.ts`
- `lib/channels/commerce-provider.ts`
- `lib/channels/commerce-worker-completion.ts`
- `scripts/commerce-gateway-job.mjs`
- `supabase/migrations/20260910045000_lazada_create_raw_readback_and_current_state_hardening_r7.sql`
- `tests/lazada-create-gateway-r7.test.ts` (신규)
- `tests/lazada-create-raw-readback-r7.test.ts`
- `tests/lazada-create-raw-readback-r7-migration.test.mjs`
- `tests/lazada-my-create-readiness.test.ts`
- `tests/lazada-my-create-prewrite.test.ts`
- `tests/lazada-my-create-postwrite.test.ts`
- `tests/lazada-my-create-readiness-builder.test.ts`

SQL 식별자: `sellerpilot_lzd_store_post_rcpt_r7` 34B, `sellerpilot_lzd_store_get_rcpt_r7` 33B, `sellerpilot_lzd_cas_current_src_r7` 34B.

## 검증

```
node --import tsx --test tests/lazada-create-raw-readback-r7.test.ts tests/lazada-my-create-readiness.test.ts tests/lazada-my-create-postwrite.test.ts tests/lazada-my-create-prewrite.test.ts tests/lazada-my-create-contract.test.ts tests/lazada-create-seller-sku-absence.test.ts tests/lazada-my-create-evidence-producer.test.ts tests/lazada-my-create-readiness-builder.test.ts tests/lazada-my-listing-create-context.test.ts
# 66/66 pass (소유 유지)

node --test tests/lazada-create-raw-readback-r7-migration.test.mjs
# 3/3 pass (소유 유지)

node --import tsx --test tests/lazada-create-gateway-r7.test.ts
# 7/7 pass (공용 경로, job.request.arguments unwrap + gateway/job source path)
```

합계 76/76. 소유 69/69 유지. 전체 빌드/전체 회귀/운영 SQL/커밋/푸시 없음.

## 차단

- 독립 검토 전. 로컬 테스트 통과를 실등록 완료로 쓰지 않는다.
- 실제 MY OAuth·CreateProduct·공식 readback 0건.
- 커밋/푸시/운영 SQL 없음.

## 다음 한 단계

독립 검토자가 이 워크트리에서 검토69 반례 테스트, `45000` PGlite CAS, 공용 경로 r7 호출 테스트를 재실행한다. r6 패치를 재제출하지 않는다.
