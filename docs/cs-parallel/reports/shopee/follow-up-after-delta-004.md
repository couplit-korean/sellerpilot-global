# Shopee CS delta-005 날짜 의도·최종 원자 체인 보고

- 작성일: 2026-09-09 KST
- 기준: `S0-20260908-decaba426812a3ba`, branch `codex/cs-shopee-v1`, HEAD `3cb72144e991626fae98a30cf51022d9a1aa6b0b`
- 동결 선행 delta: `delta-after-integration-004.json` SHA-256 `6c98e6bf5f26a3618155c3fef0cd78489dc69f7d1233ee263d6f32955f42261a`
- 예약 정본: `supabase/migrations/20260908151735_cs_shopee_history_date_intent_cutoff.sql`; coordinator 예약 원장 `docs/cs-parallel/reports/coordinator/shopee005-migration-reservation.json`
- 작업 경계: 전용 신규 SQL·시험과 shared proposal patch만 만들었다. 중앙 통합본, 운영 DB, Vault credential, provider, 고객 답변, 커밋·푸시·배포는 수정하지 않았다.

## 결론

오늘을 종료일로 선택한 요청은 더 이상 route의 매 호출 시각을 불변키로 사용하지 않는다. route는 strict KST 검증 뒤 `fromDate`/`toDate`라는 날짜 의도만 v2 RPC로 전달하며, DB가 최초 요청 시각을 cutoff로 한 번 저장한다. 응답 유실 뒤 수초 후 또는 KST 자정을 지난 다음 날 같은 UUID·같은 날짜로 재시도해도 저장 cutoff와 기존 run을 재사용한다. 날짜, credential 또는 정렬된 shop/country 계획이 바뀌면 기존 delta-004의 차단을 그대로 유지한다.

최종 canonical 체인 004→007→009→010→예약 012를 격리 DB에 순서대로 올린 뒤 실제 `runOneServerlessCsGatewayJob` 경로로 정상 page, 자동 생성 continuation, 다음 page, provider 403 interruption을 원자 completion RPC까지 실행했다. 이 과정에서 Shopee 403 전용 코드가 공통 안전 오류 처리에서 일반 `failed`로 소실되는 문제를 추가 재현했고, 정확한 `SHOPEE_401_AUTHORIZATION_REQUIRED`와 `SHOPEE_403_AUTHORIZATION_REQUIRED`만 보존하도록 shared patch에 포함했다.

## 날짜 의도와 cutoff 불변조건

- private `cs_shopee_history_request_intents`는 `(owner_id, request_key)`별 `from_date`, `to_date`, KST 시작 epoch, 최초 cutoff epoch를 저장한다.
- 오늘 종료일의 cutoff는 PostgreSQL `clock_timestamp()` 한 번으로 정하고, 이전 날짜는 KST 23:59:59로 정한다.
- v2는 같은 UUID의 날짜 의도가 정확히 같을 때만 저장된 epoch로 v1을 호출한다. 따라서 route가 재시도 시 현재 시각을 다시 계산하지 않는다.
- v1의 service-role 직접 실행 권한을 회수해 날짜 의도 원장을 우회하지 못하게 하고, v2만 service role에 공개한다.
- 선행 010과 v2가 같은 트랜잭션에서 동작하므로 credential·기간 intent·target plan·scope set 중 하나라도 달라지면 새 scope나 job이 추가되지 않는다.
- 010과 012 사이에 로컬 생성된 요청이 있으면 기존 start-request epoch를 intent 원장에 backfill해 최초 cutoff를 보존한다.

## 실제 worker·원장 실행 검증

| 실행 | 결과 | 원자성 확인 |
|---|---|---|
| KST 오늘 자정→현재 cutoff 첫 접수 | queued | DB intent cutoff가 호출 전후 현재 epoch 안에 있고 start-request `to_epoch`와 같음 |
| 같은 UUID·같은 오늘 날짜 응답 유실 재시도 | reused, queued 0 | 1.1초 뒤에도 cutoff 불변 |
| 다음 날 동일 날짜 의도 재시도 상태 | stored cutoff 재사용 | 새 end-of-day 값으로 넓히지 않음 |
| 날짜 변경 재사용 | 거부 | scope/job 추가 없음 |
| 후기 page 1 | event 1 recorded | gateway receipt, event, continuation job 동시 commit |
| continuation page 2 | event 2 recorded | sequence 2와 이전 재개 지점 digest 정확히 일치 |
| provider-wrapper 403 | authorization interruption recorded | 해당 shop scope에만 `authorization_required` 기록 |
| 잘못된 최초 sequence 2 | HTTP 503 경계, 저장 0 | job은 running 유지, receipt/event/추가 continuation 모두 0 |
| 만료 lease | HTTP 409 경계, provider 호출 0 | receipt/event 모두 0 |

## route 시험과 적용 패치

`shopee-013-history-date-intent-worker.patch`는 현재 중앙 통합본의 세 preimage에 맞춘다.

1. history POST가 v1 epoch RPC 대신 v2 date RPC를 호출한다.
2. 실제 HTTP/PGlite route fixture도 예약 정본 `20260908151735`를 적용하고 같은 UUID의 KST 오늘 재시도가 HTTP 200 `reused`, queued 0인지 확인한다.
3. worker 안전 오류 정규화는 임의 provider 문자열이 아니라 정확히 두 개의 Shopee history authorization code만 보존한다.

## 검증 결과

- 예약 정본 overlay를 포함한 실제 canonical 파일 체인: `20260908142023`→`20260908142028`→`20260908142029`→`20260908145331`→`20260908151735`.
- final-chain PGlite + 실제 worker 함수: 3/3 통과.
- 패치된 실제 route HTTP/PGlite: 1/1 통과.
- 합계 4/4 통과.
- 패치 적용 통합 복제본 전체 `tsc --noEmit`: 통과.
- 변경 route, worker, route test, final-chain test ESLint: 통과.
- 최신 중앙 통합본에 `git apply --check`: 통과.
- fixture에는 합성 credential 문자열과 합성 후기만 사용했고 실제 비밀·고객 원문은 없다.

## 실제 외부 범위

실제 대상은 SG `1719148844`, TW `1758392145`, TH `1758392144`, MY `1758392135`, VN `1758392139`, PH `1758392137`, BR `1758392161`, MX `1758392178`의 8개 shop이며 앱은 `Couplit` app ID `228518`, live partner ID `2031489`, main account ID `4940266`이다. 이번 후속은 로컬·격리 검증이므로 provider GET 성공, 실제 격리 DB 적재, 인증 운영 웹 대조는 여전히 0 shop이다. Buyer Chat 권한·webhook/history/reply 계약도 미확보다.

다음 외부 단계는 별도 승인 후 SG `1719148844` target만 CAS refresh하고 다른 7shop 불변을 readback한 뒤, SG 후기 GET→격리 DB→인증 웹을 완주하는 것이다. 한 shop 성공을 전체 Shopee 완료로 보고하지 않는다.
