# SmartStore CS supplement 006 시험 증거

- 시각: 2026-09-09 KST
- S0: `S0-20260908-decaba426812a3ba`
- frozen supplement 005: `08b9b668545978c09d447f3bc1b01de37f87ceb1ac6d89efa5849bf526b02b76`
- 운영/provider/credential/고객답변/commerce mutation: 0
- 외부 API·인증 웹 재호출: 0

## 실제 연쇄 PGlite

실행 대상:

```sh
/Users/kimchangheemac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test \
  tests/cs-smartstore-explicit-coverage-cutoff-v1.test.mjs \
  tests/cs-smartstore-full-day-route-v6.test.mjs
```

- 결과: 5/5, 종료코드 0

| 시나리오 | 증거 | 결과 |
|---|---|---|
| KST 양끝 | v6로 2024-08-01 full-day enqueue 후 product recorder는 `Asia/Seoul`, customer recorder는 `UTC` session에서 실행 | 양쪽 모두 UTC `2024-07-31 15:00:00.000` ~ `2024-08-01 14:59:59.999`, checkpoint 완료 |
| 같은 scope, 다른 실제 시간 | customer scan 시작을 1시간 늦춤 | v3 `complete=false`; 정확 경계 복구 시 `true` |
| root query 사후 변경 | scan 생성 후 customer `endSearchDate`만 변경 | `scope_digest` 불일치로 v3 `false` |
| 당일 정오 cutoff | 2024-08-01 12:00 KST 고정 시각으로 같은 날짜 요청 | `coverageMode=cutoff`, 종료 UTC 03:00, 같은 날 재호출은 같은 run, checkpoint `false` |
| 다음 날 재개 | 2024-08-02 00:05 KST에 같은 날짜 요청 | `coverageMode=full_day`, cutoff와 다른 run ID, 완료 뒤 checkpoint `true` |
| malformed explicit timestamp | timezone offset 없는 fromAt로 변조 후 공용 recorder 호출 | trigger `SMARTSTORE_HISTORY_COVERAGE_BOUNDARY_INVALID` |
| 권한 | v5 enqueue 및 checkpoint v1/v2, private parser execute | 회수됨; authenticated는 v6/v3만 실행 가능 |
| route | frozen 005 + 007 repair/v2 + 008 patch를 임시 clone에 실제 적용 | patch 적용 성공, TypeScript diagnostics 0, v3/v6만 호출 |

시험은 공용 `20260907231000_add_cs_history_coverage_ledger.sql`의 실제 recorder를 설치했다. 별도 모사 recorder로 timestamp를 직접 채우지 않았다. 두 종류의 root job, completion receipt, service recorder, scan insert trigger, run refresh, checkpoint를 순서대로 실행했다.

## 결합 회귀

```sh
/Users/kimchangheemac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test \
  tests/cs-smartstore-common-proposals.test.mjs \
  tests/cs-smartstore-exact-history-window-v5.test.mjs \
  tests/cs-smartstore-checkpoint-run-scope-v2.test.mjs \
  tests/cs-smartstore-explicit-coverage-cutoff-v1.test.mjs \
  tests/cs-smartstore-full-day-route-v6.test.mjs
```

- 결과: 19/19, 종료코드 0
- 기존 orphan/queued/missing-credential/cross-run 반례 및 v5 exact-window 회귀 포함

## 정적 검사

```sh
/Users/kimchangheemac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  ./node_modules/eslint/bin/eslint.js \
  tests/cs-smartstore-explicit-coverage-cutoff-v1.test.mjs \
  tests/cs-smartstore-full-day-route-v6.test.mjs

/Users/kimchangheemac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  ./node_modules/typescript/bin/tsc --noEmit
```

- 신규 test ESLint: 종료코드 0
- workspace TypeScript: 종료코드 0
- `pnpm exec`은 번들 pnpm/node 버전 불일치로 modules purge 확인을 요구해 사용하지 않았고, 기존 설치된 실행 파일을 직접 사용했다.

## 판정 한계

- 이는 격리 DB 계약 증거이며 운영 migration 적용·배포 또는 provider readback 증거가 아니다.
- 기존 실제 46/46 read-only 분모와 0행 결과는 frozen 이전 증거를 유지하며 이번에 재호출하지 않았다.
- TalkTalk·리뷰 연결 상태와 실고객 답변 왕복은 이번 timestamp 보완으로 완료되지 않는다.
