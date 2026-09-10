# 11번가 r6 로컬 HOLD 수리

- 갱신: `2026-09-10 17:40 KST`
- worktree: `/Users/kimchangheemac/dev/sellerpilot-product-elevenst-local-20260910`
- 기준 HEAD: `0fb40d4`
- 원장: 2/6 유지. 실등록 0/8 유지.
- 상태: 로컬 r6 공용 연결 수리. 로컬 worker도 recovery claim/finish 소유. 커밋/푸시/운영 SQL/실등록 없음.

## 검토69 반례

| 반례 | 결과 |
|---|---|
| SQL 식별자 63바이트 초과 2개 | 닫힘. r5 catalog 잘린 이름 `sellerpilot_100317_elevenst_source_readback_before_execution_ca`, `product_category_assignments_one_elevenst_production_confirmed_`를 `sellerpilot_100445_11st_source_readback_pre_cas`(47), `product_cat_one_11st_prod_confirmed_uidx`(40)로 rename. 누적 11번가 SQL identifier 검사 통과. |
| 합성 observation으로 복구 completion | 닫힘. r5 `..._recovery_v1`은 유지되고 r6 finish는 `..._recovery_v2`만 받는다. serverless와 로컬 worker drain은 소유 claim/finish RPC와 공식 GET raw evidence만 넘긴다. 합성 observation은 completed가 아니다. |
| 기존 SellerPrdCd를 보고 신규 CREATE가 POST 없이 정상 completion | 닫힘. 사전 GET unique는 `product-create-duplicate-detected` 409이고 POST 0회, `sellerpilotFreshCreateCompleted=false`. 공용 `gatewayJobCompletionStatus`/`completeCommerceClaim`도 failed. POST 이후 유실만 `product-create-reconcile`. |

## 실행한 로컬 테스트

```text
node scripts/check-migration-version.mjs 20260910044500_elevenst_recovery_observation_and_identifier_hardening_r6.sql
no local collision

node --test tests/elevenst-r6-postgres-identifiers.test.mjs tests/elevenst-r6-recovery-boundaries.test.ts
6/6

node --import tsx --test tests/elevenst-create-recovery.test.ts tests/elevenst-create-recovery-drain.test.ts
13/13

node --import tsx --test --test-name-pattern='existing seller code|timed-out create|accepted create response without productNo|unresolved accepted create|seller XML request keeps the key' tests/elevenst-general-create-flow.test.ts tests/elevenst-listing.test.ts
5/5
```

합계 24/24. 전체 빌드/전체 회귀는 실행하지 않음.

## 확인 완료

- 예약 migration `20260910044500_elevenst_recovery_observation_and_identifier_hardening_r6.sql` 존재, 번호 충돌 없음.
- 공용 `elevenstSellerXmlRequest`가 `transportEvidence` 반환. GET identity는 `GET` + path + 빈 body 줄.
- serverless drain이 `drainElevenstCreateRecovery`로 소유 claim/finish와 공식 GET observation만 호출.
- 로컬 `commerce-gateway-job.mjs`의 `processElevenstCreateRecoveryDrain`이 같은 소유 `recovery_v2` claim/finish를 호출. GET은 워커 쪽에서 수행.
- `channel-gateway-worker.mjs`가 일반 `/worker/claim` 전에 recovery drain을 호출. 복구 틱에서는 신규 CREATE claim을 같이 하지 않음.
- 신규 CREATE 사전 기존 SKU는 공용 completion 밖(409/failed).
- GET-only recovery runtime은 POST/PUT 없음.
- 원장 칸 5·6 올리지 않음.

## 미확인

- 운영 DB에 31700/43000/44500 적용 여부. 이 세션은 적용하지 않음.
- 워커 HTTP `/api/channel-gateway/worker/elevenst-create-recovery`는 로컬 코드만. 운영 배포 없음.

## 차단

- 실등록 금지, 구매회원 셀러 전환 금지, 커밋/푸시 금지.
- 기존 `9598600918`은 CREATE 대상이 아님.

## 다음 한 단계

중앙이 44500과 위 24개 집중 테스트를 독립 재현한다. 운영 SQL 적용과 실등록은 하지 않는다.
