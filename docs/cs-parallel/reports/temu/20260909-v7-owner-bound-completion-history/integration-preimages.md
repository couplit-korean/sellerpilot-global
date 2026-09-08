# Temu v7 통합 preimage

최신 통합본 `/Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908`에서 직접 계산했다.

| 경로 | SHA-256 | 용도 |
|---|---|---|
| `app/api/channel-gateway/worker/complete/route.ts` | `b9a1a5056557e8bf6ef204727af13492e078d8d4b2fd18ff5f1705224f466383` | retry v3 route patch |
| `app/api/admin/cs/history-coverage/route.ts` | `a8faac8ced853a877ec4dcb15fcf5a6f4940d2c5879697e508b709473be2a6fd` | owner coverage v2 route patch |
| `lib/channels/gateway-contract.ts` | `d371180e2a132da711cd8dcff3996673cbd198c681bfa1158365c4e92709b5d4` | completion DTO 계약, 변경 없음 |
| `scripts/ai-cli-worker.mjs` | `9174bd48ea554318dc9500021004fa2fd27b1669edef2ec8abc5f4cebaaac102` | 11st helper 보강 후 worker, 변경 없음 |
| `supabase/migrations/20260908140414_cs_temu_durable_detail_retry.sql` | `13fcd1f2856a7599db6963597e54e71e76b6939fba5cd710bffa2f96be771a2b` | canonical retry v1 |
| `supabase/migrations/20260908140416_cs_temu_detail_retry_replay.sql` | `d5a06aa35d4ad7a0f9e6ecc300a9ca5aef5acf453eadd09395e22408c8b1255a` | canonical retry v2/replay |
| `supabase/migrations/20260907231000_add_cs_history_coverage_ledger.sql` | `cf1f0941c7cc21b0604ca20d3b817914cb62c07659858d648e7e3e37fbc02c19` | canonical coverage record/read v1 |

V7 patch는 위 두 route preimage에 `git apply --check` exit 0이다. SQL은 기존 migration을 직접 수정하지 않고 새 migration 후보로 제출한다.

Frozen proof:

- V5 test `b97eca451669d92bf1a988f2339ed71b077226d8c0860d917ff53a47032e1b7f`
- V6 test `aab28a1647818137aed04124099d7b418acbcb76979cd2e888decdfff6ada234`

