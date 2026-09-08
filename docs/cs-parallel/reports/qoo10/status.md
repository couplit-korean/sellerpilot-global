# Qoo10 CS 상태

- 시각: 2026-09-08 19:10 KST
- S0 ID: `S0-20260908-decaba426812a3ba`
- 전용 작업폴더: `/Users/kimchangheemac/dev/sellerpilot-cs-qoo10`
- 브랜치/포트: `codex/cs-qoo10-v1` / `3213`
- 소스 변경분 manifest: `docs/cs-parallel/reports/qoo10/delta.json`
- 실제 seller/app/country/shop 범위: Qoo10 Japan / QSM+QAPI / seller `zrlawjdgns` / shop `Couplet Seoul`
- 비밀/실고객 원문 없는 증거 경로: `first-read-contract.md`, `verification.md`
- 이번에 닫은 정확한 기능: QAPI fixed-range GET 진단, S1/S2/S3와 claim 입력 검증, 일별 history planner와 포화 fail-closed 판정, 승인·최신 inbound·문의 ID 일치 reply 준비 guard, review/chat 미지원 분모 명시

| 게이트 | 상태 | 증거 | 남은 행동 |
|---|---|---|---|
| G1 범위·권한 | 통과 | CHANGHEE QSM에서 Japan/seller/shop 확인; JEONGHUN Supabase production v6 active metadata 확인; Vault `seller_id`와 QSM seller의 값 미출력 비교 true | credential rotation 시 같은 비교 재실행 |
| G2 로컬 경로 | 통과 | S0 1,628/1,628 hash 일치; Qoo10 전용+reply 25/25, ESLint 0, strict TS 0 | 통합 후 같은 전용 시험 재실행 |
| G3 실제 읽기 | 통과(지원 범위) | 고정 30일 및 하루 S1/S2/S3/claim 모두 `0 SUCCESS`, 0행; 비밀/원문 미저장 | 비어 있지 않은 실제 표본 발생 시 ID·상한 대조 |
| G4 과거·웹 대조 | 진행 | 2010-01-01~2026-08-08 inquiry 성공 0행; QSM buyer 최근30일 0, review 최근30일 0 | 공식 최초 제공일/보존기간 확보, review 실제 export 표본 확보, 공통 history UI/DB 반영 |
| G5 신규 수신 | 미시험 | 현재 신규 문의가 없어 실제 도착→수신 latency/ledger 반영을 관측할 수 없음 | 다음 실제 문의 1건을 current sync→원장→웹 순서로 readback |
| G6 답변 관측 | 외부조건 대기 | local guard/SetInquiryMessage fixture 통과; 실제 승인 대상·문구 없음 | 승인된 일반 문의가 생기면 1회 전송 후 S3 원격 readback; acceptance만으로 완료 금지 |
| G7 복구 | 진행 | 일별 S1/S2/S3+claim, 포화 시 시간 분할, 0/unknown/incomplete 판정 구현 | 공통 atomic job/cursor/gap DB와 UI에 qoo10-001 반영 |
| G8 운영 적용 | 외부조건 대기 | 운영 DB write/배포/worker 시작 없음 | 통합 담당 review·migration·release 후 운영 read-only와 신규/답변 관측 |

## scope별 분모

| account/shop/kind/상태/폴더 | from/to·timezone | 원격 고유 ID 수 | 정상 | 중복/기존 | 격리 | 근거 있는 제외 | 미처리/gap |
|---|---|---:|---:|---:|---:|---:|---|
| Qoo10 Japan / Couplet Seoul / MSG·HELP·ITEM / S1 | 2026-08-09 00:00:00~2026-09-07 23:59:59 JST | 0 | 0 | 0 | 0 | 0 | 0 (이 창만) |
| 동일 / MSG·HELP·ITEM / S2 | 동일 | 0 | 0 | 0 | 0 | 0 | 0 (이 창만) |
| 동일 / MSG·HELP·ITEM / S3 | 동일 | 0 | 0 | 0 | 0 | 0 | 0 (이 창만) |
| 동일 / claim / requestDate / all states | 동일 | 0 | 0 | 0 | 0 | 0 | 0 (이 창만) |
| 동일 / MSG·HELP·ITEM / S1·S2·S3 | 2010-01-01~2026-08-08 JST | 0 | 0 | 0 | 0 | 0 | 최초 제공일·보존기간 unknown |
| 동일 / Buyer inquiry web | QSM 표시 최근30일 | 0 | 0 | 0 | 0 | 0 | 긴 대화 actual ID 표본 없음 |
| 동일 / Review web/export | 2026-08-09~2026-09-08 JST | 0 | 0 | 0 | 0 | 0 | QAPI 없음, 실제 Excel 형식 미확인, 과거 기간 unknown |
| 동일 / Buyer Chat | 미확정 | unknown | 0 | 0 | 0 | 0 | 공식 QAPI/partner 계약 미확보 |

티켓 수와 메시지 수는 별도다. 이번 실제 읽기는 둘 다 0이라 같을 뿐, 일반화하지 않는다. QAPI에는 total/page/cursor와 공식 row cap이 없어 양수 응답은 전량 증명이 끝나기 전까지 unknown이다.

## 변경 파일의 주요 before/after

| 파일 | before | after | 목적 |
|---|---|---|---|
| `lib/channels/qoo10-inquiries.ts` | `0c8b73be…` | `161eabc2…` | 공식 list/reply 입력 fail-closed, reply SEQ_NO 수용 |
| `tests/qoo10-claims.test.ts` | `0f35661c…` | `cdd435dd…` | 세 상태 union, 동일 주문 다중 요청/상태 revision 반례 |
| `lib/channels/cs/qoo10/contracts.ts` | 없음 | `8d67abea…` | 공식 parameter/완료 계약 |
| `lib/channels/cs/qoo10/history.ts` | 없음 | `d4ad720d…` | 일별 과거 planner/시간 refinement |
| `lib/channels/cs/qoo10/reply-guard.ts` | 없음 | `13c1c6c4…` | 승인·최신 inbound·ID guard |
| `lib/channels/cs/qoo10/review.ts` | 없음 | `fc5aaa5c…` | review API/export 제한 |
| `scripts/cs-qoo10-provider-read-only.mjs` | 없음 | `3db15c18…` | secret/customer 원문 없는 실제 GET 진단 |

전체 SHA-256은 `delta.json`에 기록한다.

## 구현 완료와 남은 범위

- 구현 완료: 전용 list/reply validation, claim 90일 제한 유지, 일별 fixed history planning, 하루 포화 시 시간 분할, completion fail-closed, reply preflight, 격리 PGlite dedupe/admin projection, 실제 read-only probe.
- 운영 증명 대기: 신규 수신 1건, 비어 있지 않은 MSG/HELP/ITEM의 실제 type/question/sequence 관계, 실제 승인 답변의 provider acceptance와 S3 readback, claim 실제 상태 revision.
- 공식 계약 부족: Review/Buyer Chat 전용 QAPI, 문의/claim row cap, inquiry 보존기간/최초 제공일.
- 자료 부재: QSM Review 실제 export 파일(현재 0행이라 생성 불가), 긴 대화 실제 ID 표본.
- code/통합 대기: qoo10-001 history UI/DB, qoo10-003 common reply verifier, qoo10-002는 실표본 전 변경 금지, qoo10-004 capability 표시.
- 복구 불가 기간: 아직 확정할 수 없음. 공식 보존기간이 없어 unknown으로 남긴다.

## 다음 행동

- 지금 가장 먼저 해야 하는 단일 행동: 통합 담당이 `qoo10-001`을 공통 history route/UI/coverage DB에 반영하고, 사용자 지정 from/to의 하루 S1/S2/S3+claim job과 gap을 격리 DB에서 실행한다.
- 공통 변경 요청 ID: `qoo10-001`, `qoo10-002`, `qoo10-003`, `qoo10-004`
- 외부 선행조건과 필요한 사실/자료: 비어 있지 않은 실제 inquiry/claim 1건, 승인된 답변 대상·문구, 실제 QSM Review Excel, Buyer Chat 공식 계약.
- 전체 자동연동 제한: 문의/claim GET은 검증됐지만 공통 UI/DB 미반영, total/cap unknown, 실제 신규/답변 readback 미관측, Review/Buyer Chat 자동 수신 미지원. 채널 전체 완료가 아니다.
