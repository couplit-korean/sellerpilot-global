# Temu CS v5 외부 worker retry 검증 증거

## 격리 방식

최신 통합본을 `/tmp/temu-v5-final.jg9VJm`에 환경파일, `.git`, `node_modules`, build/output 폴더 없이 복제했다. 통합본의 기존 `node_modules`만 symlink해 로컬 dependency를 사용했고, V5 proposal test를 복사한 후 proposal patch를 clone에만 적용했다.

실제 provider, 운영 Supabase, credential, 고객 데이터는 사용하지 않았다. fixture ID와 메시지는 전부 합성값이다.

## 실제 POST entrypoint

```sh
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --import tsx --test docs/cs-parallel/proposals/temu/tests/temu-007-external-worker-detail-retry.test.ts
```

- exit code: 0
- tests/pass/fail: 6/6/0
- worker failed payload의 Temu-only DTO 보존과 schema exact shape: 통과
- actual route `POST`의 pre-snapshot v2 RPC 호출: 통과
- 완료 응답 유실 후 같은 old claim/동일 인자 POST replay: 통과
- claim/lineage 충돌 시 generic completion 차단: 통과
- retry exhaustion의 failed completion/DB trigger 계약: 통과
- 최종 parent succeeded, detail revision unique, canonical continuation child duplicate 0: 통과

## TypeScript와 lint

```sh
PATH=/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:$PATH ./node_modules/.bin/tsc --noEmit --pretty false
PATH=/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:$PATH ./node_modules/.bin/eslint app/api/channel-gateway/worker/complete/route.ts lib/channels/gateway-contract.ts scripts/ai-cli-worker.mjs docs/cs-parallel/proposals/temu/tests/temu-007-external-worker-detail-retry.test.ts
```

- typecheck exit code: 0, output 없음
- lint exit code: 0, output 없음

## Temu/공통 회귀

```sh
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --import tsx --test tests/temu-after-sales-detail.test.ts tests/cs-temu-retry-rpc.test.ts tests/cs-temu-retry-replay-e2e.test.ts
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --test tests/cs-temu-detail-retry-db.test.mjs tests/cs-temu-detail-retry-replay-db.test.mjs tests/gateway-inquiry-continuation-db.test.mjs
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --test tests/channel-gateway-worker-route-contract.test.mjs
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --import tsx --test tests/channel-gateway-contract.test.ts
```

- Temu adapter/helper/E2E: 17/17
- Temu retry DB + generic continuation DB: 10/10
- gateway worker route contract: 13/13
- gateway contract: 24/24
- 합계: 64/64, 실패 0

V5 전용 6건을 포함한 이번 최종 검증 합계는 70/70이다.

