# 쿠팡 r12 source-revision / completeness / workbench 결속

갱신 시각: 2026-09-10T17:41:04+09:00
워크트리: `/Users/kimchangheemac/dev/sellerpilot-product-coupang-local-20260910`
HEAD: `0fb40d4c608e3ea1778743c8e99377352c39054a`
원장: 3/6 유지. 실등록 0/8 유지. commit/push 없음. 운영 SQL 없음. 칸 5·6 없음.

## 확인 완료

- 공용 경로가 Coupang CREATE를 generic begin에서 제외한다.
- POST 직전 실제 provider body를 `sellerpilot_service_begin_coupang_create_provider_mutation`에 넘겨 seal한다.
- seal 실패면 mutation marker 0, provider POST 0.
- `bindCoupangCreateSourceRevision`가 source identity·승인 이미지 이후, fingerprint·claim 이전에 서버 소유로 결속된다.
- CREATE readiness는 GET-only 4회 조회 후 official snapshot, 그다음 revision bind.
- claim 직전 상품·manifest·credential을 다시 읽고 mismatch면 job 0.
- provider-listing-runtime은 `assertCoupangCreateSourceRevision` 후 `prepareCoupangListing`.
- workbench 19행 게이트가 직접 등록과 bulk 실행을 막는다.
- 이전 6 fail 그룹 0.

## 미확인

- 운영 DB 미적용. provider CREATE/GET 실등록 없음.
- 칸 5·6는 올리지 않았다.

## 변경한 파일

- `app/api/admin/channel-operations/route.ts`
- `app/product-publish-workbench.tsx`
- `lib/channels/provider-listing-runtime.ts`
- `app/api/channel-gateway/worker/begin-mutation/route.ts`
- `lib/channels/commerce-provider.ts`
- `lib/channels/marketplace-images.ts`
- `lib/channels/provider-execution-contract.ts`
- `lib/channels/serverless-gateway.ts`
- `lib/product-registration/channels/coupang.ts`
- `lib/product-registration/execution-shared.ts`
- `scripts/commerce-gateway-job.mjs`
- `tests/channel-gateway-worker-route-contract.test.mjs`
- `docs/product-channel-parallel/reports/coupang/status.md`
- `docs/product-channel-parallel/reports/coupang/status.json`

적용하지 않음: `commerce-completion` / `gateway-contract` itemBindings. 현재 HEAD에 해당 스키마가 없다.

## 로컬 테스트

- 소유 독립: `node --import tsx --test tests/coupang-create-source-revision.test.ts tests/coupang-durable-create-reconciliation.test.ts tests/coupang-create-readiness-source.test.ts tests/coupang-create-official-source-fence-db.test.mjs tests/coupang-durable-create-reconciliation-db.test.mjs tests/coupang-create-source-revision-db.test.mjs` **53/53**
- 공용 경로 의존: `node --import tsx --test tests/coupang-create-provider-body-boundary.test.mjs tests/coupang-create-provider-body-boundary.test.ts tests/coupang-local-create-provider-body-boundary.test.ts tests/coupang-durable-create-reconciliation-gateway.test.ts tests/channel-gateway-worker-route-contract.test.mjs` **24/24**
  - provider-body-boundary mjs 3/3
  - provider-body-boundary ts 4/4
  - local worker 2/2
  - durable gateway 1/1
  - worker route contract 포함 통과
- 이전 공용 의존 fail 잔존: **0** (provider-body / local / gateway)
- source-revision-route + completeness-route-ui: **7/7, fail 0**
- 소유 독립 + 공용 경로 + workbench 회귀: **114/114, fail 0**
- 다른 라운드 공용 결속 잔존 실패: **0**

## 검토69 반례

재현됨 후 닫힘.
- 배송비 `deliveryCharge=7777`: exact-body seal 거부, provider POST 0.
- 최종 body 검증 실패: begin-mutation 0, provider POST 0.
- PGlite 소유 테스트: 두 번째 current confirmed category는 seal 0, mutation marker 0.

## 차단

- 운영 SQL, provider 쓰기, commit/push 금지 유지.
- 운영 SQL, provider 쓰기, commit/push 금지 유지.

## 다음 한 단계

중앙 검토. 실등록·칸 5·6는 올리지 않는다.
