# SmartStore CS supplement 004 시험 증거

- 시각: 2026-09-08 KST
- S0: `S0-20260908-decaba426812a3ba`
- 보존된 002 manifest SHA-256: `478ebba8d24e960b2ee5e63efcbfac419c6126ea71e69c70cc12018706b15b42`
- 보존된 003 manifest SHA-256: `9727f4da736aee56fa69da4d84aa34bb8dd7f660368678717afb5d5a41911ea4`
- 운영/provider/credential/고객답변/commerce mutation: 0

## 격리 route·UI 실행 시험

```sh
PATH=/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin:$PATH \
  node --import tsx --test tests/cs-smartstore-history-resume-v5-route.test.ts
```

- 종료코드: 0
- 결과: 9/9 통과
- 격리 방식: 임시 `git clone --shared --no-checkout`; 005 route patch와 006 UI patch를 실제 `git apply`; 종료 후 임시 clone 삭제
- 실행 대상: 005 patch가 만든 route의 실제 exported `GET`·`POST`
- UI 대상: 006 patch가 만든 `history-window.tsx`의 v5 URL·하한·legacy 호출 제거·TSX 구문과 `page.tsx`의 `authenticatedFetch` 전달

| 시나리오 | 기대·관측 |
|---|---|
| GET exact checkpoint | `authenticateAdminRequest` 1회, active production credential 조회, exact checkpoint RPC, enqueue 0, `200`, no-store |
| anonymous fixture | `401`, DB RPC 0 |
| expired fixture | `401`, DB RPC 0 |
| non-admin fixture | `403`, DB RPC 0 |
| invalid dates/역전 범위/extra key | `400`, 인증 후 DB RPC 0 |
| active production SmartStore credential 2개 | `409`, checkpoint/enqueue 0 |
| completed checkpoint | `200`, `historyBackfill:null`, enqueue 0 |
| one-day next window | v5 RPC에 `2026-09-08`~`2026-09-08` 정확히 전달, credential/environment 고정, `202 acceptedNotCompleted=true` |
| enqueue RPC failure | `409`, `acceptedNotCompleted` 없음 |

### 인증 증거 한계

route가 실제로 `authenticateAdminRequest`를 먼저 호출하고 반환된 오류 Response를 그대로 통과시키는 제어 흐름을 시험했다. anonymous/expired/non-admin 결과는 자동화 fixture이며 운영 인증·세션 증거가 아니다. 운영 비로그인·만료세션의 실제 `401`과 관리자의 실제 `200/202`는 배포 후 별도 관측해야 한다.

## 공용 patch 결합 형식

```sh
git apply --check \
  docs/cs-parallel/proposals/smartstore/smartstore-003-004-common-integration.patch \
  docs/cs-parallel/proposals/smartstore/smartstore-005-common-integration.patch \
  docs/cs-parallel/proposals/smartstore/smartstore-006-ui-history-resume-v5.patch
```

- 종료코드: 0
- 의미: 현재 공용 preimage에 세 patch가 순서대로 적용 가능하다. 실제 공용 소스 적용, build, 배포, 운영 migration, provider 완료 증거는 아니다.

## 정적 검사

```sh
PATH=/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin:$PATH \
  ./node_modules/.bin/eslint tests/cs-smartstore-history-resume-v5-route.test.ts
```

- 종료코드: 0

## 결합 회귀·TypeScript

```sh
PATH=/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin:$PATH \
  node --import tsx --test \
  tests/cs-smartstore-contract.test.ts \
  tests/cs-smartstore-recovery.test.ts \
  tests/cs-smartstore-common-proposals.test.mjs \
  tests/cs-smartstore-exact-history-window-v5.test.mjs \
  tests/cs-smartstore-history-resume-v5-route.test.ts

PATH=/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin:$PATH \
  ./node_modules/.bin/tsc --noEmit --pretty false
```

- 결합 회귀: 27/27, 종료코드 0
- TypeScript: 종료코드 0
