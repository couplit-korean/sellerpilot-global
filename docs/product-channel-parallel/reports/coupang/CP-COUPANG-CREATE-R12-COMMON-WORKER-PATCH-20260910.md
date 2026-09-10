# CP-COUPANG-CREATE-R12-COMMON-WORKER-PATCH-20260910

상태: frozen proposal only. 이 워크트리에서는 공용 파일을 수정하지 않았다.

- 요청 ID: CP-COUPANG-CREATE-R12-COMMON-WORKER-PATCH
- revision: 20260910
- 기준 HEAD: `0fb40d4c608e3ea1778743c8e99377352c39054a`
- patch: `CP-COUPANG-CREATE-R12-COMMON-WORKER-PATCH-20260910.patch`
- patch SHA-256: `f33d67d76b15a42bfa9e0550af332de7e027fb136a6fe65c245492112fdc3559`
- ready: no
- frozen: yes
- 의존: 소유 migration `41500`/`42000`/`42500`가 먼저 있어야 한다.

## 현재 워크트리 before SHA-256

- `app/api/admin/channel-operations/route.ts` `5bacd7bb3d915602521cc4135c01eb84f53ac08f0f96d5b5f72fb384d70a3644`
- `app/api/channel-gateway/worker/begin-mutation/route.ts` `2a5253f73363bd98bcf7f34e201738bde27927593be4567d631a782d835ab028`
- `lib/channels/commerce-completion.ts` `5f1cfacb98848f4ad9a3cfbc6ef5bf6bc1b7feb9c5f3ee2080c9a65fdbe83772`
- `lib/channels/commerce-provider.ts` `612b6680f136f9631e950cfda8b28d4eb20e197f7b4a4f1f8ddfad8e4a281637`
- `lib/channels/commerce-worker-completion.ts` `6546d8b3a22b7bf3a3c8e2204942b8eea784d350d2020951ef69203aef8aea44`
- `lib/channels/gateway-contract.ts` `49686e867d61148a859c1fd561aed25ca133efd8938c257523e4c6f889061aee`
- `lib/channels/marketplace-images.ts` `2759152d01191cad8b6a9aa78c3e4f1aa99f2fc71812499b76a1e51f13d14054`
- `lib/channels/provider-execution-contract.ts` `efa0ab71e10c0624d8d8f4287888d437bfa630256165e013977da3ba52ed1771`
- `lib/channels/serverless-gateway.ts` `f0c4ad2205b6d0f2194ac4b419546d0597217ed5d8bb1eef23c54c307c7322ea`
- `lib/product-registration/channels/coupang.ts` `d2607193ed0518a591918ade79c159ac8e581eca69656aad38ca1e73ea545dd3`
- `lib/product-registration/execution-shared.ts` `b73fe362bc14a388269a63fdc4eedd3bf4661c1917db26e9a9923255109ecab4`
- `scripts/commerce-gateway-job.mjs` `f28b2bc033f8c906b53d7f4fb20c8d000b0640a6d78c8b8f20b5bc714c927d21`
- `tests/channel-gateway-worker-route-contract.test.mjs` `939438eb92e96737cb0b81072ddbb54689626fbe61a25cdc0203bd4c1d83d435`
- `tests/worker-lifecycle-retry.test.mjs` `945d48cb44317ae8161d39c1d7bf537ed878a18c36df77b4207770fe163e83fc`

## 적용 결과

`git apply --check` against `0fb40d4` failed. 이 patch는 이전 누적 R12 frozen baseline에서 추출한 공용 hunk이며 현재 중앙 HEAD와 context가 다르다. 강제 적용하지 않았다.

적용에 실패한 파일:

- `app/api/admin/channel-operations/route.ts`
- `lib/channels/commerce-completion.ts`
- `lib/channels/commerce-provider.ts`
- `lib/channels/commerce-worker-completion.ts`
- `lib/channels/gateway-contract.ts`
- `lib/channels/provider-execution-contract.ts`
- `lib/channels/serverless-gateway.ts`
- `lib/product-registration/execution-shared.ts`
- `scripts/commerce-gateway-job.mjs`
- `tests/worker-lifecycle-retry.test.mjs`

context가 맞아 check를 통과한 파일:

- `app/api/channel-gateway/worker/begin-mutation/route.ts`
- `lib/channels/marketplace-images.ts`
- `lib/product-registration/channels/coupang.ts`
- `tests/channel-gateway-worker-route-contract.test.mjs`

## 계약

공용 경로가 Coupang CREATE를 generic begin에서 제외하고, POST 직전 `sellerpilot_service_begin_coupang_create_provider_mutation`에 실제 provider body를 넘겨 seal한다. seal 실패면 mutation marker 0, provider POST 0.

중앙 담당이 `0fb40d4` 이후 공용 파일에 재기반한 뒤 적용해야 한다.
