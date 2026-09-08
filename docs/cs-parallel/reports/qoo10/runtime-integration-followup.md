# Qoo10 history/reply 런타임 후속 결과

- 시각: 2026-09-08 KST
- S0: `S0-20260908-decaba426812a3ba`
- 작업폴더/브랜치: `/Users/kimchangheemac/dev/sellerpilot-cs-qoo10` / `codex/cs-qoo10-v1`
- 공통 통합본: 읽기 전용. 공통 TS/TSX/SQL 파일 수정 없음.
- 운영 변경: commit/push/deploy/운영 DB write/credential 변경/실고객 답변 모두 없음.

## 이번 후속에서 구현한 범위

1. 공통 실행기가 호출할 수 있는 Qoo10 history runtime.
   - 일별 `S1/S2/S3/claim` job과 안정적인 `inquiries:history:qoo10:*` 재개 키.
   - day/hour/minute/second 세분화와 정확한 부모 window key.
   - array, `InquiryInfo`, `InquiryMessage`, `ClaimInfo` envelope 검증.
   - provider total/관찰 상한 기반 `complete/unverified/incomplete` 판정.
   - 1초 창 포화의 `irreducibleGap`/`irreducibleSaturation` 보존.
   - type+question+sequence dedupe, S1/S2/S3 상태 이동, 같은 sequence의 다른 question 충돌 분리.
   - 고객 본문/ID 원문 대신 identity/content digest와 count만 coverage에 반환.
2. 공통 UI/DB가 받은 job arguments를 신뢰하기 전 검증하는 역직렬화 계약.
   - contract version, source, calendar date, refinement, parent key, params, window key 전부 대조.
   - 변조된 key/status/기간/부모는 `QOO10_HISTORY_ARGUMENTS_INVALID`로 차단.
3. 답변 lineage 호환.
   - 현행 `qoo10:TYPE:question:sequence` legacy ticket 유지.
   - `qoo10:v2:TYPE:question`은 DB가 legacy alias와 `qoo10-thread-v2`를 증명할 때만 허용.
4. S3 readback verifier.
   - 같은 type/question/sequence의 terminal S3 상태만 관측 성공.
   - 빈 결과, 오순번, 비terminal, provider/transport 실패 모두 자동 재송신 금지.
   - S3 응답에서 답변 본문을 관측했다고 주장하지 않음.
   - readback delivery metadata와 멱등 key를 기존 `inquiries.list` adapter까지 보존.
5. 격리 PGlite fixture.
   - 같은 네 일별 창을 재삽입해도 4개 유지.
   - 포화 S1 day를 24개 hour child로 분할.
   - 완료 leaf 제외/실패 leaf 재개.
   - 같은 root의 상태 이동은 갱신하고 같은 sequence의 다른 root는 별도 보존.
6. 통합 리뷰 후 reply envelope/status-only 수정.
   - `prepareQoo10Reply(...).params`를 공통 route에 직접 넘기지 않고 `prepareQoo10GatewayReply(...).arguments`의 `{params:{...}}`를 사용.
   - route helper → reply enqueue RPC payload → Qoo10 adapter → `SetInquiryMessage` mock까지 실제 계약 재생.
   - S3 exact identity는 별도 `qoo10_s3_status_observed`만 기록하고 generic `verification_status='remote_observed'`로 승격하지 않음.
   - 실제 SQL 초안 `proposals/qoo10/007-reply-s3-status-rpc.sql`을 격리 PGlite에서 exact/pending/오순번/replay로 재생.
7. 통합 재검토 후 NULL/evidence/ACL 보강.
   - `p_state`와 `p_reason`의 SQL `NULL`을 명시적으로 거부하고 delivery 불변을 검증.
   - nullable CHECK를 상태별 완전 boolean 식으로 바꿔 `observed=true + state=NULL`의 SQL unknown 통과를 차단.
   - RPC가 호출자의 `verified` 주장을 신뢰하지 않고 completion transaction이 저장한 `response_payload`에서 exact S3 상태를 다시 판정.
   - stored provider result와 state/reason/count가 다르면 `QOO10_REPLY_S3_READBACK_EVIDENCE_MISMATCH`로 저장 0건.
   - 다른 channel/credential/owner와 wrong scope/revoked/expired worker를 모두 lineage 오류로 차단.
   - 함수 실행권한은 `service_role`만 true이며 `public`/`anon`/`authenticated`는 false.

## 증거 단계별 현재 상태

| 구분 | 현재 상태 | 근거/제한 |
|---|---|---|
| 코드 | 로컬 완료 | 전용 runtime, reply guard/readback, 격리 fixture와 제안서 005/006 |
| 실제 과거 조회 | 이전 실제 읽기 결과 유지 | 2026-08-09~2026-09-07 JST S1/S2/S3/claim 각 0행; 이번 후속에서는 같은 원격 조회를 반복하지 않음 |
| 웹 대조 | 이전 QSM 대조 유지 | Buyer inquiry 최근 30일 0, Review 최근 30일 0; 이번 후속에서 브라우저 재조작 없음 |
| 신규 수신 | 미관측 | 신규 고객 문의 표본 없음. arrival→ledger→QSM 시간을 증명하지 못함 |
| 답변 | 로컬 검증만 완료 | 승인 대상·문구가 없어 SetInquiryMessage와 S3 원격 readback을 실행하지 않음 |
| 운영 | 미적용 | 공통 history/UI/DB/reply 변경은 proposal만 작성. 배포/운영 DB 반영 없음 |
| Review/Buyer Chat | 미지원 분모 유지 | Review 실제 export 표본/형식 미확인, Buyer Chat 공식 QAPI/partner 계약 미확보 |

## 검증

| 명령 | exit | 결과 |
|---|---:|---|
| `node --import tsx --test tests/cs-qoo10-history-runtime.test.ts tests/cs-qoo10-history-runtime-db.test.mjs` | 0 | 11/11 통과 |
| Qoo10 전체 6파일 최종 회귀 | 0 | 34/34 통과 |
| Qoo10 전용 소스/테스트 ESLint | 0 | 출력 없음 |
| Qoo10 전용 모듈 strict TypeScript + `allowImportingTsExtensions` | 0 | 출력 없음 |
| reply envelope → enqueue → adapter 집중 시험 | 0 | 실제 `{arguments:{params:{...}}}` 계약 통과 |
| `007-reply-s3-status-rpc.sql` 격리 PGlite replay | 0 | 8/8 통과; NULL/저장 결과/ACL/lineage 반례 포함, generic `provider_accepted` 유지 |

이번 재검토의 첫 테스트는 셸 `PATH`에 Node가 없어 시작 전에 exit 127이 났다. 소스/테스트 실패가 아니며 Codex bundled Node의 절대 경로로 다시 실행한 뒤 위 검증이 모두 통과했다.

## 통합 요청

- `qoo10-005`: history planner/runtime을 scheduler, 기간 UI, 창별 DB coverage, 포화 child enqueue와 연결.
- `qoo10-006`: legacy/v2 reply guard와 S3 status-only readback을 공통 reply ledger에 연결.
- `qoo10-007`: generic `remote_observed`를 건드리지 않는 실제 SQL RPC 초안.
- `qoo10-007`의 운영 활성화 전제: 기존 atomic completion transaction이 response+receipt를 함께 저장하고 terminal `response_payload`의 임의 사후 수정을 막아야 함. 공통 불변성이 없다면 response SHA seal/불변 trigger가 선행되어야 함.
- 두 제안 모두 현재 통합본 SHA-256 preimage, before/after, 적용 diff, SQL/ACL 계약, 필수 시험을 포함한다.
- 실제 다중 sequence 표본이 생기기 전 `inquiry-sync.ts` ticket ID는 바꾸지 않는다.
