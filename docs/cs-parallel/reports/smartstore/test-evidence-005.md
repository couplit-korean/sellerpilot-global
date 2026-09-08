# SmartStore CS supplement 005 시험 증거

- 시각: 2026-09-08 KST
- S0: `S0-20260908-decaba426812a3ba`
- 보존된 002 manifest: `478ebba8d24e960b2ee5e63efcbfac419c6126ea71e69c70cc12018706b15b42`
- 보존된 003 manifest: `9727f4da736aee56fa69da4d84aa34bb8dd7f660368678717afb5d5a41911ea4`
- 보존된 004 manifest: `fb72c1b60abcdee0a680c1fb735b14db35ff3d1e59bf025dcdfe9681fe2f84c6`
- 운영/provider/credential/고객답변/commerce mutation: 0

## checkpoint run-scope PGlite

```sh
PATH=/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin:$PATH \
  node --test tests/cs-smartstore-checkpoint-run-scope-v2.test.mjs
```

- 결과: 7/7, 종료코드 0

| 반례 | frozen v1 | proposed v2 |
|---|---:|---:|
| 실제 run 없음 + orphan product/customer scan | `complete=true` 재현 | `false` |
| queued run + completed처럼 보이는 두 scan | `true` 재현 | `false` |
| run credential mapping 누락 | `true` 재현 | `false` |
| 서로 다른 run에서 product/customer 한 행씩 | `true` 재현 | `false` |
| 한 kind만 reconciled, 다른 kind NULL/unprocessed | `false` | `false` |
| 동일 succeeded run + exact scope + 두 kind reconciled | `true` | `true` |
| checkpoint throughDate 1일 이동 | 이전 boundary를 재사용하지 않음 | 새 exact boundary가 nextWindow |
| credential seller verified scope 누락 | v1은 해당 검증 없음 | credential invalid |

v2는 continuation이 있는 성공 run도 허용하도록 `total_jobs >= expected_initial_jobs`와 `succeeded_jobs=total_jobs`를 함께 요구한다. 정확히 job 2개만 요구하지 않으므로 정상 pagination을 완료 불가로 만들지 않는다.

## frozen route 구문 한계와 후속 검증

frozen 005 route patch만 적용하면 POST 함수 마지막 `}`가 빠지고 TypeScript `TS1005: '}' expected`가 발생한다. 기존 supplement 004의 route test는 `transpileModule`에 route `reportDiagnostics:true`가 없어 복구된 JS를 실행했고, 따라서 9/9 결과는 route 제어 흐름 fixture 증거이지 완전한 TypeScript source 증거가 아니었다.

새 시험은 임시 clone에 다음을 실제 적용한다.

1. frozen 005 route patch
2. 007 frozen-005 syntax repair
3. 007 checkpoint v2 route 전환

그 후 생성된 route 전체 파일을 직접 읽어 `reportDiagnostics:true` 오류 0, 마지막 `}`, checkpoint v2 contract/RPC/advance rule을 확인하고 실제 exported GET을 호출해 `200`과 정확한 두 RPC 호출을 확인했다. 인증과 RPC 반환은 fixture이며 운영 인증 증거가 아니다.

## 결합 회귀·정적 검사

```sh
PATH=/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin:$PATH \
  node --import tsx --test \
  tests/cs-smartstore-contract.test.ts \
  tests/cs-smartstore-recovery.test.ts \
  tests/cs-smartstore-common-proposals.test.mjs \
  tests/cs-smartstore-exact-history-window-v5.test.mjs \
  tests/cs-smartstore-history-resume-v5-route.test.ts \
  tests/cs-smartstore-checkpoint-run-scope-v2.test.mjs

PATH=/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin:$PATH \
  ./node_modules/.bin/eslint tests/cs-smartstore-checkpoint-run-scope-v2.test.mjs

PATH=/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin:$PATH \
  ./node_modules/.bin/tsc --noEmit --pretty false
```

- 결합 회귀: 34/34, 종료코드 0
- 신규 test ESLint: 종료코드 0
- 현재 workspace TypeScript: 종료코드 0
- proposal SQL/patch는 공용 source나 운영 DB에 적용하지 않았다.
