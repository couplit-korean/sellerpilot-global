# Qoo10 S3 completion response seal 후속 결과

- 시각: 2026-09-08 KST
- S0: `S0-20260908-decaba426812a3ba`
- 작업폴더/브랜치: `/Users/kimchangheemac/dev/sellerpilot-cs-qoo10` / `codex/cs-qoo10-v1`
- 기존 NULL/evidence/ACL delta: SHA-256 `7eeb35259e3b130a87474ba2e881dcfb7318ff61c19c9b6e9d3e561bbd32b207`, 수정하지 않음
- 운영 변경: common write, production DB, provider call, customer reply, commit, push, deploy 모두 없음

## 읽기 전용 추적 결과

1. current completion route는 validated worker result를 `sellerpilot_service_complete_gateway_transaction`의 `p_response_payload`로 넘긴다.
2. atomic completion migration은 전체 completion fingerprint를 먼저 계산한다.
3. replay는 기존 receipt의 fingerprint가 같으면 추가 write 없이 반환하고, 다르면 replay mismatch로 실패한다.
4. 첫 completion은 gateway job의 terminal response를 먼저 저장한 뒤 같은 transaction에서 completion receipt를 insert한다.
5. receipt 직접 insert migration은 atomic common 1개와 SmartStore special completion 4개다.
6. Lazada partial ingestion과 listing/SmartStore recovery에는 의도적인 response 후처리 write가 있어 global terminal response lock은 기존 동작을 깨뜨릴 수 있다.
7. 현재 소스에는 delivery-bound Qoo10 S3 response를 receipt 시점에 별도 봉인하는 공통 계약이 없다.

최종 대조 중 통합본 completion route가 SHA `9e1ba34b77788d1ea68ac2489e09dda322fea4d9f8400cbd8c85e757e7831781`로 갱신된 것을 확인했다. Qoo10 작업폴더의 `41435b...`와 비교한 diff는 Lazada ingest V2→V3 readiness/호출 변경뿐이며, Qoo10 처리나 atomic completion 호출 순서는 동일하다. 008 문서는 최신 통합본 SHA를 기준으로 갱신했다.

따라서 실행 가능한 보완은 global trigger가 아니라 Qoo10 S3 marker가 있는 `qoo10 + inquiries.list` job만 receipt `AFTER INSERT`에서 seal하는 범위 제한 trigger다.

## 작성한 보완

- `qoo10-008` SQL은 request/response SHA-256, claim, worker, completion fingerprint, credential, environment, owner, seller account, terminal state/time을 별도 private seal ledger에 저장한다.
- seal 이후 해당 job의 evidence/lineage 필드와 job delete를 거부한다.
- receipt와 seal update/delete를 거부한다.
- status RPC 외부 이름은 seal wrapper가 차지하며, 기존 qoo10-007 함수는 service role도 직접 실행할 수 없는 predecessor로 rename/revoke한다.
- wrapper는 job/receipt/seal을 `FOR SHARE`로 잠그고 현재 request/response SHA를 다시 계산한 뒤 qoo10-007 판정을 호출한다.
- trigger를 우회한 response 변조도 SHA mismatch로 차단한다.
- marker 없는 다른 채널과 일반 Qoo10 list는 seal하지 않는다.
- 다른 채널에 Qoo10 marker를 붙인 위조 조합은 receipt insert에서 차단한다.
- 기존 receipt는 backfill하지 않는다.

## 검증

| 범위 | exit | 결과 |
|---|---:|---|
| qoo10-007 + qoo10-008 격리 PGlite | 0 | 8/8 통과 |
| 기존 34개 + seal 8개 전체 Qoo10 회귀 | 0 | 42/42 통과 |
| Qoo10 전담 ESLint | 0 | 출력 없음 |
| Qoo10 전담 strict TypeScript | 0 | 출력 없음 |

검증에는 first completion seal, evidence field별 mutation, job delete, receipt/seal mutation, trigger bypass SHA detection, replay, 다른 채널/일반 Qoo10 미영향, cross-channel marker 위조, failed completion NULL response가 포함된다.

## 실패와 수정

1. 최초 seal fixture: `0/7`, PGlite 배포본에 `pgcrypto.control`이 없어 SQL 적용 전 실패.
   - 운영 SQL은 기존 Supabase `extensions.digest`를 유지.
   - fixture에만 PostgreSQL 내장 `sha256`으로 같은 `extensions.digest(text,'sha256')` 서명을 제공.
2. 두 번째 fixture: `6/7`, Shopee 미영향 fixture에 Qoo10 전용 marker를 잘못 넣음.
   - 정상 Shopee는 marker 없이 구성해 미영향을 확인.
   - cross-channel Qoo10 marker는 위조 조합으로 별도 거부 시험을 추가.
3. 최종: seal 단독 8/8, 전체 Qoo10 42/42 통과.

## 남은 운영 전제

- qoo10-007과 qoo10-008을 실제 migration으로 생성·검토·적용해야 한다.
- completion route의 Qoo10 status RPC 호출은 두 schema 적용과 readback enqueue 계약 확인 뒤 활성화해야 한다.
- 운영 적용 직전 실제 Supabase catalog의 current function definition, trigger order, grants를 read-only로 확인해야 한다.
- 기존 receipt를 seal로 소급 backfill하지 않는다.

## 산출물 SHA-256

- `docs/cs-parallel/proposals/qoo10/008-reply-s3-completion-response-seal.sql`: `f31954baa26c91d8e20c07432fabdb77c021557b4d374d781d074fb7dec4672c`
- `docs/cs-parallel/proposals/qoo10/008-reply-s3-completion-response-seal.md`: `45c90635fd9079dcfd8bc6002cfc0dad8f9b2be1be417f4bb0b4ebcd27abe972`
- `tests/cs-qoo10-reply-s3-response-seal-db.test.mjs`: `88def740462db73e50cccb4428fa29fef9988f960cd7119f67327a1de769474b`
