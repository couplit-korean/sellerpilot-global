# Temu CS v7 검증 증거

## 격리 방식

- DB: 각 시험이 생성한 메모리 PGlite. 운영 Supabase 접속 없음.
- 코드: `SELLERPILOT_TEMU_INTEGRATED_ROOT`로 최신 통합본의 route, helper, migration preimage를 직접 읽음.
- 적용 순서: canonical gateway claim/atomic completion → coverage migration → Temu retry v1 → Temu retry v2 → V7 proposal SQL.
- 상태 변경자: canonical claim, retry v2, atomic completion, coverage record 함수. completion receipt와 terminal status를 fixture가 직접 삽입하지 않음.
- 최소 fixture: credential 복호화 view, Temu 외 부수효과 no-op, 정규화 inquiry 격리 capture. 고객 원문·비밀·연락처·주소 없음.
- 시간: 5/10/20초 원장 간격을 먼저 검증한 뒤 test-only로 `rate_not_before`만 과거 이동하고 canonical claim을 다시 호출함.

## V7 actual chain

```sh
SELLERPILOT_TEMU_INTEGRATED_ROOT=/Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908 \
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --import tsx --test \
docs/cs-parallel/proposals/temu/tests/temu-009-owner-bound-completion-history-chain.test.ts
```

- exit code: 0
- tests/pass/fail: 3/3/0
- 최신 completion route SHA-256 고정: `b9a1a5056557e8bf6ef204727af13492e078d8d4b2fd18ff5f1705224f466383`
- retry v1 적용 후 v2가 v1 RPC를 제거하고 v2 receipt 계약을 제공하는 순서 검증.
- partial failure POST: HTTP 202, retry-after 5, `jobCompleted=false`.
- old claim response-loss replay: HTTP 202, `retryReceiptReplayed=true`, ledger 추가 소비 0.
- immediate new claim: null. 예약 시각 test advance 후 canonical claim: 같은 job, 새 claim token, attempt 2.
- normal completion POST: job succeeded, claim/worker 해제, atomic receipt 1, coverage page 1, normalized inquiry 3.
- 다른 job/claim 결합: HTTP 503, running job 불변.
- 다른 owner credential로 job credential 교체: `TEMU_GATEWAY_OWNER_CREDENTIAL_MISMATCH`.
- 두 owner가 각각 actual completion으로 만든 scan: 각 owner GET에 자기 scope 1개만 표시.
- 3회 소진: attempt 4에서 retry DTO 없는 failed POST, ledger outcome `retry_failed`, `retry_failed`, `retry_exhausted`, owner gap 1.
- non-admin SQL/GET: 거절.

## 최신 통합본 V5/coverage/retry 회귀

```sh
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --import tsx --test \
docs/cs-parallel/proposals/temu/tests/temu-007-external-worker-detail-retry.test.ts \
tests/cs-temu-detail-retry-replay-db.test.mjs \
tests/cs-history-coverage-db.test.mjs
```

- 실행 위치: 최신 통합본 원본, read-only 시험
- exit code: 0
- tests/pass/fail: 17/17/0
- 11st supplement05 이후 실제 helper import를 사용하는 V5 test 포함 통과.

## frozen V6 HTTP 202 회귀

```sh
TEMU_ACCEPTANCE_ROOT=/Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908 \
/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --test \
docs/cs-parallel/proposals/temu/tests/temu-008-external-worker-202-ack.test.mjs
```

- exit code: 0
- tests/pass/fail: 1/1/0
- HTTP 202를 terminal accepted로 1회만 처리하고 provider read success로 확대하지 않음.

## patch/lint

```sh
git apply --check /Users/kimchangheemac/dev/sellerpilot-cs-temu/docs/cs-parallel/proposals/temu/patches/temu-009-owner-bound-completion-history.patch
```

- 실행 위치: 최신 통합본
- exit code: 0

```sh
PATH=/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:$PATH \
pnpm exec eslint \
docs/cs-parallel/proposals/temu/tests/temu-009-owner-bound-completion-history-chain.test.ts
```

- exit code: 0
- 출력 없음

## 금지 작업 확인

- provider API/Buyer Chat/실고객 답변/환불 mutation: 0
- 운영 DB/credential/배포: 0
- commit/push: 0
- frozen V5/V6 파일 수정: 0

