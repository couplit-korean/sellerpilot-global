# SmartStore CS supplement 003 시험 증거

- 시각: 2026-09-08 KST
- S0: `S0-20260908-decaba426812a3ba`
- 보존된 002 manifest SHA-256: `478ebba8d24e960b2ee5e63efcbfac419c6126ea71e69c70cc12018706b15b42`
- 002 manifest self-check: 15개 파일, mismatch 0
- 운영/provider/credential/고객답변/commerce mutation: 0

## exact-window v5 PGlite

```sh
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --test tests/cs-smartstore-exact-history-window-v5.test.mjs
```

- 종료코드: 0
- 결과: 5/5 통과
- 실제 SQL 설치: `smartstore-005-exact-history-window-v5.sql`
- 기간: 1일, 6일, 7일, 30일, 2024-02-27~2024-03-03 윤일 교차
- timezone: DB session UTC와 Asia/Seoul에서 같은 달력 범위가 같은 run/key로 dedupe됨. 과거 product query는 KST `00:00:00.000+09:00`~`23:59:59.999+09:00`, customer query는 같은 from/to 날짜.
- 작업 cardinality: 범위마다 product/customer 정확히 2개, owner는 credential seller, initiated_by는 shared admin.
- 중복: 같은 범위 2회 호출 후 run 1개/job 2개.
- 재시작: 부분 실패 attempt 1은 실패 job 1개만 queued로 복구하고 succeeded는 유지. attempt 4는 재접수 0.
- 권한: anon/service_role execute 없음, authenticated만 execute. underlying credential table 직접 read 차단.
- 계정: revoked credential 거부, 다른 seller의 active SmartStore credential이 공존하면 ambiguous scope로 거부, non-admin 거부.
- checkpoint: 1일 창에서 target seller product만 완료하거나 다른 seller customer가 완료해도 이동 0. target seller customer가 completed/reconciled/unprocessed 0이 된 뒤에만 완료 1.

## 공용 patch 형식

```sh
git apply --check \
  docs/cs-parallel/proposals/smartstore/smartstore-003-004-common-integration.patch \
  docs/cs-parallel/proposals/smartstore/smartstore-005-common-integration.patch
```

- 종료코드: 0
- 의미: 현재 공용 preimage에 두 patch가 함께 적용 가능한 형식이다. route 실제 200/401, 운영 migration, UI 렌더 또는 provider 완료 증거가 아니다.

## 결합 회귀·정적 검사

```sh
/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin/node --import tsx --test \
  tests/cs-smartstore-contract.test.ts \
  tests/cs-smartstore-recovery.test.ts \
  tests/cs-smartstore-common-proposals.test.mjs \
  tests/cs-smartstore-exact-history-window-v5.test.mjs
PATH=/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin:$PATH ./node_modules/.bin/eslint \
  tests/cs-smartstore-exact-history-window-v5.test.mjs
PATH=/Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin:$PATH ./node_modules/.bin/tsc --noEmit --pretty false
```

- 결합 회귀: 18/18, 종료코드 0
- 신규 시험 ESLint: 종료코드 0
- TypeScript: 종료코드 0

## 인증 증거 분리

- v5 PGlite ACL은 로컬 DB 권한 시험이다.
- 기존 archive/history 200/401은 자동화 route 계약 시험이다.
- 운영 관리자 UI read는 별도 브라우저 관측이다.
- 운영 비로그인·만료세션 UI 401은 아직 실제 관측하지 않았다.
