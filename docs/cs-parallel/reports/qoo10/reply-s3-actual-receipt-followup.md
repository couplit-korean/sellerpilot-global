# Qoo10 reply S3 actual completion/receipt 후속 결과

- 시각: 2026-09-09 00:26 KST
- S0: `S0-20260908-decaba426812a3ba`
- 작업폴더/브랜치/HEAD: `/Users/kimchangheemac/dev/sellerpilot-cs-qoo10` / `codex/cs-qoo10-v1` / `3cb72144e991626fae98a30cf51022d9a1aa6b0b`
- 통합 기준본: `/Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908`, 읽기 전용
- source delegated task: `01a077b1-61db-7c20-a4a3-ae00dbbbef19`
- 동결: 기존 qoo10-007/008/009, 기존 보고서와 delta, 중앙 공통 파일을 수정하지 않음
- 운영 변경: production DB, 실제 provider, 실고객 답변, commit, push, deploy 모두 없음

## 결론

중앙 009의 helper 및 모의 table 시험을 넘어 실제 두 실행 진입점을 격리 DB와 연결했다.

1. 중앙 최신 `runOneServerlessCsGatewayJob`의 실제 completion RPC 호출을 canonical receipt trigger, qoo10-009 S3 child enqueue, qoo10-008 response seal, qoo10-007 status RPC, delivery GET까지 연결했다.
2. 중앙 최신 external worker completion `POST`도 같은 DB chain을 통과시켰다.
3. 같은 provider ACK 두 번은 receipt replay로 처리되어 S3 child가 한 개만 남았다.
4. completion commit 뒤 첫 transport response 유실은 같은 fingerprint replay로 복구되며 child/receipt/seal이 각각 한 개였다.
5. provider transport 실패는 NULL response seal과 status-only incomplete evidence만 남기고 provider row를 발명하지 않았다.
6. marker, claim, receipt worker-token 중 하나라도 다르면 qoo10 status observation은 0건이었다.
7. 같은 canonical completion receipt를 쓰는 Coupang 001/003 lineage는 자기 child 한 개를 유지했고 Qoo10 enqueue/seal/status 변화는 0건이었다.

이 시험에서 중앙 최신 DB 계약의 실제 막힘 두 개를 확인했다. 기존 중앙 4/4 entrypoint 시험은 completion/status RPC를 mock하므로 이 두 조건을 검출하지 못한다.

## 실제 계약 불일치

| 위치 | 현재 계약 | actual Qoo10 S3 입력 | 결과 |
|---|---|---|---|
| generic canonical completion `20260826090400` | 성공한 모든 `inquiries.list`에 `p_normalized_inquiries` array 강제 후 generic ingestion/sync 수행 | 009 경로는 일반 문의 import가 아니므로 두 JS 진입점 모두 `null` 전달 | 현재 canonical 그대로면 `normalized inquiry payload required`로 완료 불가 |
| frozen qoo10-007 unsealed status RPC | receipt token scope를 `gateway`, `legacy_combined`만 허용 | actual serverless runner receipt owner scope는 `serverless_cs` | completion을 통과해도 007 status 기록 거부 |

`p_normalized_inquiries=[]`로 우회하면 일반 문의 sync 성공으로 잘못 기록되므로 사용하지 않았다. 이 경로는 delivery 하나에 묶인 S3 status-only 조회이며 일반 과거수집/문의 ingestion이 아니다.

## 신규 010 제안

`docs/cs-parallel/proposals/qoo10/010-reply-s3-actual-completion-compat.sql`을 qoo10-007/008/009와 중앙 `20260908145336_cs_qoo10_reply_s3_common_paths.sql` 뒤에만 적용하는 후속 제안으로 만들었다.

- exact 조건은 `channel=qoo10`, `operation=inquiries.list`, 유효한 `sellerpilotQoo10ReplyReadback` marker다.
- exact 경로만 generic ingestion/sync side effect를 건너뛰고 기존 terminal job update + canonical completion receipt를 한 transaction에서 만든다.
- response는 009 PII-free marker/envelope만 허용하고 `ResultObject`는 identity/status 최소 필드가 이미 봉인된 형태여야 한다.
- replay는 기존 canonical fingerprint와 동일한 계산을 사용하며 다른 fingerprint를 거부한다.
- 007의 내부 status lineage에는 exact receipt owner인 `serverless_cs`만 추가한다. 외부 qoo10-008 seal wrapper의 job/receipt/request/response digest 검증은 그대로 남는다.
- 모든 ordinary Qoo10 및 다른 채널 completion은 이름을 바꾼 중앙 predecessor로 위임한다.
- 새 canonical/serverless entrypoint는 `service_role`만 실행 가능하고 predecessor는 `service_role`에서도 직접 실행할 수 없다.

중앙 SQL 원본을 수정하지 않았고, 신규 migration 번호 확정/적용은 중앙 담당 소유다.

## 실제 실행 시험

`tests/cs-qoo10-reply-s3-actual-receipt-flow.test.mjs`는 중앙 최신 TypeScript를 직접 import하고, DB만 synthetic PGlite fixture로 격리한다. 고객 원문, 주소, 연락처, 구매자 ID, 실 credential은 사용하거나 저장하지 않는다.

| 시험 | 결과 | 핵심 readback |
|---|---:|---|
| actual `runOne` + first completion response lost + replay | 통과 | completion RPC 2회, receipt 1, child 1, seal 1, 007 verified, delivery GET observed |
| actual external completion `POST` | 통과 | HTTP 200, canonical receipt 1, child 1, seal 1, 007 verified, delivery GET observed |
| actual `runOne` provider transport failure | 통과 | failed terminal receipt 1, NULL response seal, child status incomplete, provider rows 0, resend false |
| marker mismatch | 통과 | completion/status escalation 차단, status observation 0 |
| claim mismatch | 통과 | completion receipt 0, status observation 0 |
| receipt worker-token mismatch | 통과 | status RPC 거부, status observation 0 |
| Qoo10 ACK replay | 통과 | 동일 fingerprint receipt replay, S3 child 1 |
| Coupang 001/003 regression | 통과 | Coupang child 1, Qoo10 enqueue/seal/status 0 |
| ACL | 통과 | public/anon/authenticated 거부, service canonical/serverless만 허용, predecessor 직접 실행 거부 |

## 검증 결과

| 범위 | exit | 결과 |
|---|---:|---|
| 신규 actual receipt flow 집중 시험 | 0 | 9/9 통과 |
| Qoo10 contract/history/runtime/ledger/reply/status/seal/common/claim + 신규 시험 | 0 | 60/60 통과 |
| 중앙 최신 actual entrypoint 시험 | 0 | 4/4 통과 |
| 신규 MJS ESLint | 0 | 출력 없음 |
| 중앙 담당 전달 최신 통합 회귀 | 0 | 294개 통과, TypeScript/ESLint 통과(중앙 담당 제공 증거; 이 작업에서 재실행하지 않음) |

집중 시험 로그의 `Qoo10 S3 status-only readback recording failed { code: '22023' }` 한 줄은 의도적으로 만든 mismatch 반례의 fail-closed 관찰이다. 해당 subtest는 status observation 0을 확인하고 통과했다.

## 실패 관찰과 재시도 보존

1. 첫 실행은 통합 root 환경 변수를 주지 않아 로컬에 아직 없는 중앙 009 migration을 찾지 못해 `ENOENT`로 종료했다. 이후 중앙 root를 명시했다.
2. 두 번째 실행은 PGlite workspace snapshot fixture의 alias가 중앙 009 정규 preimage(`d`, `blocking`)와 달라 `QOO10_REPLY_S3_WORKSPACE_CONTRACT_MISMATCH`로 8개 assertion 전에 setup이 fail-closed 했다. 중앙 기존 DB 시험과 같은 alias로 fixture만 정정했다.
3. 이후 실제 경로 8/8, ACL 추가 후 9/9가 통과했다.
4. 첫 ESLint 실행은 pnpm shim이 현재 non-login PATH에서 Node를 찾지 못해 exit 127이었다. 고정 Node 22.23.2로 ESLint JS entrypoint를 직접 실행해 exit 0을 확인했다.

위 실패는 source/production 오류로 숨기지 않으며 최종 성공 횟수에 합산하지 않는다.

## 적용 전 중앙 확인 사항

1. 010을 중앙 신규 migration 번호로 배치하기 전에 현재 catalog의 canonical completion, serverless wrapper, frozen-007 unsealed status 함수 정의와 ACL을 read-only로 대조한다.
2. 010의 dynamic preimage rewrite가 정확히 한 번만 일치하는지 staging migration에서 확인한다. 0회 또는 2회 이상이면 migration이 fail-closed한다.
3. 전체 migration stack과 294+ 신규 actual 시험을 중앙에서 다시 실행한다.
4. 실제 worker credential/고객 데이터 없이 staging synthetic job으로 remote/serverless 두 진입점을 확인한다.
5. provider ACK, DB completion, S3 status observation, buyer-visible 답변은 서로 다른 증거로 유지한다. 이번 결과는 운영/실고객 완료 증거가 아니다.

## 산출물 SHA-256

- `docs/cs-parallel/proposals/qoo10/010-reply-s3-actual-completion-compat.sql`: `1b6a391f392a12622b6d6f76bd5b95502f4e250b25e8d7890f552e70b6e3e827`
- `tests/cs-qoo10-reply-s3-actual-receipt-flow.test.mjs`: `c5a7054b91b9c46df33a23a6fb93c5704386e39d55ba5519cd1b738def5751f0`

테스트 시점 중앙 read-only input:

- `lib/channels/cs/qoo10/reply-readback-completion.ts`: `580e3f67b05dfba6bc030364817e5c08518edab93f44aeb8bbfcdce928a227d2`
- `app/api/channel-gateway/worker/complete/route.ts`: `b9a1a5056557e8bf6ef204727af13492e078d8d4b2fd18ff5f1705224f466383`
- `lib/channels/serverless-gateway.ts`: `c8bfa7422aa87efa16c7cca5317e718b4cddc13799e3bf3370affa7d48267e31`
- qoo10-007: `89a51d43800ea1621c646f7ed213f5ffdc32dcde4bcef2d5d08755925ed7e182`
- qoo10-008: `f31954baa26c91d8e20c07432fabdb77c021557b4d374d781d074fb7dec4672c`
- Coupang 003: `97a227621ccc055af2b1a4b88ad771ffd0a7019dcb15b12be088b4a3facc1518`
- 중앙 qoo10-009 migration: `a595454731d119f2608e19354a7972a44ea9a50e30fd7f87012821b9fb126889`
- 중앙 actual entrypoint test: `4bc5c1e0573e4b6cf0472d2906cc41afcfedaceb577a35e8040c5ec983dd3621`

기존 009 전용 산출물, 최초 delta/추가 정정 이력, 중앙 11번가 006 수동 충돌 해소본은 수정하지 않았다.
