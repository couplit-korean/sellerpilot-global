# SmartStore CS supplement 007 시험 증거

- 시각: 2026-09-09 KST
- S0: `S0-20260908-decaba426812a3ba`
- frozen supplement 006: `7738d8fee9bfec27a9e802c3b8e8852dd39fd3ebb351f4ce930edd7b5e61e60e`
- 운영/provider/credential/고객답변/commerce mutation: 0
- 외부 API·인증 웹 재호출: 0

## v7/v4 및 현재 통합 route

```sh
/Users/kimchangheemac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  --test tests/cs-smartstore-continuation-cutoff-v7.test.mjs
```

- 결과: 7/7, 종료코드 0

| 반례·흐름 | frozen 006 | supplement 007 |
|---|---|---|
| product page2→page3 정상 성공 | v6 재호출 `SCOPE_MISMATCH` 재현 | v7 reused, 4 jobs, product scan 3 pages, v4 완료 |
| product page2 실패 | v6 재개 불가 | v7은 page2 한 개만 queued, succeeded roots 보존; recorder 후 v4 완료 |
| succeeded지만 recorder 미기록 page2 | run summary만 succeeded 가능 | v4 완료 거절; scan page 기록 뒤 완료 |
| duplicate root | 실제 partial unique index가 차단 | index가 없다고 가정해 삽입해도 v7 lineage 검사 차단 |
| forged tagged child | root lineage 밖 parent로 삽입 | v7 `SMARTSTORE_EXACT_HISTORY_EXISTING_SCOPE_MISMATCH` |
| 다른 seller/run의 failed job | target retry와 함께 존재 | 상태 failed 그대로, retriedJobs 0 |
| 오늘 정오 cutoff | v3는 같은 최신 30일 창 반복 | v4는 cutoff를 보류하고 이전 30일 창 반환 |
| 이전 30일 완료 후 같은 날 | cutoff는 완료 아님 | completed 1, remaining 1, cutoff를 다시 표시 |
| 다음 날 같은 선택 종료일 | full-day 필요 | cutoff와 다른 run 생성, 두 창 완료 후 complete true |
| 현재 통합 route | v3 key 검사를 포함한 v3/v6 route | 009 patch 적용, diagnostics 0, 실제 POST가 v4→v7 exact args, HTTP 202 |

page2/page3는 root 인자를 복사하고 query page/depth를 올린 actual continuation shape로 insert했다. `inherit_inquiry_history_backfill_tags` trigger가 run/item을 상속했고, 공용 `sellerpilot_service_record_cs_history_page_v1`이 root scan과 각 page를 기록했다. checkpoint fixture에서 scan 값을 직접 만들어 완료시키지 않았다.

## 인접 회귀

```sh
# frozen 006 + supplement 007
node --test \
  tests/cs-smartstore-explicit-coverage-cutoff-v1.test.mjs \
  tests/cs-smartstore-continuation-cutoff-v7.test.mjs
```

- 결과: 11/11, 종료코드 0

```sh
# 기존 common proposal 및 v5 exact-window
node --test tests/cs-smartstore-common-proposals.test.mjs
node --test tests/cs-smartstore-exact-history-window-v5.test.mjs
```

- 결과: 7/7, 종료코드 0
- clone 없는 순차 관련 검증 합계: 18/18
- supplement 006의 기존 결합 기준선: 19/19

기존 `cs-smartstore-checkpoint-run-scope-v2.test.mjs`와 `cs-smartstore-full-day-route-v6.test.mjs`의 임시 `git clone --shared`가 이 실행 시점에 worktree upload-pack에서 정지했다. 정확한 test/clone 하위 프로세스만 종료했으며 파일은 삭제하지 않았다. v2 DB 항목은 정지 전 6개가 통과했고, 해당 frozen baseline은 006의 19/19 증거를 유지한다. 새 route 시험은 clone하지 않고 현재 통합 route를 임시 Git 디렉터리에 복사해 patch 적용과 실제 POST 실행을 완료했다.

## 정적 검사

```sh
/Users/kimchangheemac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  ./node_modules/eslint/bin/eslint.js \
  tests/cs-smartstore-continuation-cutoff-v7.test.mjs

/Users/kimchangheemac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node \
  ./node_modules/typescript/bin/tsc --noEmit

git diff --check -- \
  docs/cs-parallel/proposals/smartstore/smartstore-009-* \
  tests/cs-smartstore-continuation-cutoff-v7.test.mjs
```

- 신규 test ESLint: 종료코드 0
- workspace TypeScript: 종료코드 0
- 신규 proposal/test diff check: 종료코드 0

## 검증 경계

- PGlite 격리 DB 및 현재 통합 route의 local fixture 증거다.
- 운영 migration·배포·provider readback·실고객 답변 증거가 아니다.
- TalkTalk·리뷰 공식 계약/권한과 전용 연동은 이번 범위 밖이며 여전히 미완료다.
