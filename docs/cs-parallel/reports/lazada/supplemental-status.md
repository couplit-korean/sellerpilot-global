# Lazada CS 재검토 보완 상태

- 시각: 2026-09-08 21:15:03 KST
- 기준: `S0-20260908-decaba426812a3ba`, 최초 delta SHA-256 `0d145209f31b779e6ffc6e8cc08405f10f55679906e0fe6c1afe7cdadd660480`
- 작업폴더/브랜치/포트: `/Users/kimchangheemac/dev/sellerpilot-cs-lazada` / `codex/cs-lazada-v1` / `3216`
- 원본 통합 checkout 수정: 없음

## 결론

IM bootstrap, history raw 저장, Push raw-first ACK, admin/maintenance raw 재처리, 카드 projection으로 이어지는 로컬 호출은 연결돼 있다. 그러나 연결 완료를 막는 원인은 두 층으로 분리된다.

1. 외부 운영 조건: CS Bot Push callback/group 미설정, provider-certified seller/country binding 부재, 운영 raw/격리/observation migration 부재, 승인 답변 부재.
2. 공통 DB 계약: 현재 `lazada_ingest_v2`가 parser/2의 `senderRole=system`과 recall revision을 표현하지 못한다. actual official session의 13개 undocumented template event는 이 차이 때문에 로컬 경로가 있어도 정상 DB/web 투영까지 갈 수 없다.

따라서 UI Online 또는 CS Bot token의 read 200만으로 수집·Push·답변 연결 완료라고 판단하지 않는다. 실제 확인된 첫 결과는 CS Bot IM read grant와 선택 세션 remote 13 / DB 0 / SellerPilot web 0이다.

## 실제 호출 연결 재검토

| 경로 | 연결 상태 | ACK/완료 경계 | 남은 blocker |
|---|---|---|---|
| 수동 IM bootstrap | 연결됨 | one-time bootstrap state 소비 후 gateway enqueue, provider continuation을 completion에 전달 | account-wide `has_more=true` continuation을 durable DB에서 실제 완주하지 못함 |
| history raw | 연결됨 | raw page 저장 실패 시 completion 503, ingest 성공 후에만 receipt normalized | 운영 raw table/migration 부재, V2 system/recall 계약 차이 |
| Push webhook | 연결됨 | 서명/app binding 통과와 raw 저장 성공 전에는 200 ACK하지 않음 | 콘솔 callback 공란, 7개 group 미선택, signed delivery 미관측 |
| raw 재처리 | admin·maintenance 모두 연결됨 | lease claim 후 parse→quarantine-ready→ingest→complete | 운영 raw table 부재, V2 계약 차이 |
| 카드/대화 | normalizer 연결됨 | unknown/system/recall을 보수적으로 projection | 공통 DB와 인증 웹에서 실제 projection 미관측 |
| 승인 답변/echo | enqueue/readback 코드 존재 | remote observation이 있어야 완료 | 승인 ticket/text와 운영 ticket 없음, 실제 send 금지 유지 |

## 이번 보완 수정

`lib/channels/lazada-raw-reprocess.ts`가 completion RPC의 상태를 boolean으로 축약해, 5회차 retry가 DB에서 `failed`로 종결돼도 `retried`로 집계하던 문제를 고쳤다. 이제 `pending`만 retried이며 `failed`, transport loss, outcome 불일치는 failed다. 이는 admin UI의 “다음 자동 실행” 표시와 maintenance 결과가 실제 lease 상태와 어긋나는 것을 막는다.

회귀시험은 attempt 5 + ingest temporary failure + completion `status=failed`를 사용했고 `claimed=1, retried=0, failed=1`을 확인했다.

## 검증 결과

- Node 22 targeted test: `tests/lazada-raw-reprocess.test.ts`, 6/6 pass, skip 0, exit 0.
- Node 22 targeted ESLint: modified source/test 2 files, exit 0. pnpm wrapper의 install 시도는 비대화형 환경에서 중단됐고, 설치·lockfile 변경 없이 기존 ESLint entrypoint를 직접 실행했다.
- 이전 canonical 검증: 108/108, tsc/lint pass는 최초 delta hash에 대한 증거이며 이번 두 파일 변경 뒤 전체 재실행으로 잘못 표시하지 않는다.
- 이번 변경은 Lazada ownership 허용 파일과 전용 report/proposal만 사용했다.
- 커밋, push, 배포, 운영 DB, 운영 webhook, token/refresh, 실제 고객 답변 mutation 없음.

## 통합 담당 요청

- `lazada-005`를 `lazada-003`의 실제 call-path 보완안으로 검토한다.
- isolated DB에 V3 migration을 적용해 system/seller/recall/conflict/new-customer-generation 반례를 먼저 통과시킨다.
- readiness가 통과한 동일 release에서 worker/serverless/webhook/reprocessor를 V3로 전환한다.
- 그 뒤에만 provider-certified MY binding과 signed Push Verify/readelivery를 확인하고, 동일 MY session 13개 ID를 remote→raw→DB→인증 web으로 다시 대조한다.
