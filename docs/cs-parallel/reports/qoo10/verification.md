# Qoo10 CS 검증 로그 요약

원문 고객 데이터와 credential 평문을 남기지 않은 실행 요약이다.

## S0

- 2026-09-08: snapshot `S0-20260908-decaba426812a3ba`, HEAD `3cb72144e991626fae98a30cf51022d9a1aa6b0b`
- manifest 대상 1,628개, 실제 확인 1,628개, SHA-256 mismatch 0
- branch `codex/cs-qoo10-v1`, workspace `/Users/kimchangheemac/dev/sellerpilot-cs-qoo10`, reserved port 3213

## 실제 읽기

| 명령 요약 | 시각 | exit | 결과 |
|---|---|---:|---|
| `cs-qoo10-provider-read-only --from 20260809000000 --to 20260907235959` | 2026-09-08T09:57:42.885Z | 0 | seller ID 대조는 후속 실행에서 true 확인; S1/S2/S3/claim 각각 SUCCESS 0행 |
| `cs-qoo10-provider-read-only --from 20100101000000 --to 20260808235959 --skip-claims` | 2026-09-08T09:58:33.461Z | 0 | seller ID match true; S1/S2/S3 각각 SUCCESS 0행 |
| `cs-qoo10-provider-read-only --from 20260907000000 --to 20260907235959` | 2026-09-08T10:03:32.388Z | 0 | seller ID match true; 하루 S1/S2/S3/claim 각각 SUCCESS 0행 |

각 공급자 응답은 배열이었고 root에 total/count/page/cursor/next가 없었다. 실행기는 secret field 이름만 출력하며 값, 고객명, 제목, 본문, 주문번호 원문을 출력하지 않는다.

## 회귀 시험

| 명령 | 시점 | exit | 결과 |
|---|---|---:|---|
| 지시문 지정 5파일 baseline | 변경 전 | 1 | 67개 중 66 통과; 공용 11st 예외명 기대 불일치 1개 |
| `tests/cs-qoo10-contracts + qoo10-claims + inquiry-reply` | 변경 중 | 0 | 22/22 통과 |
| `tests/cs-qoo10-ledger-db.test.mjs` | 변경 중 | 0 | 1/1 통과; 격리 PGlite 저장/중복/관리자 projection/PII 제외 |
| 지시문 지정 5파일 회귀 | 변경 후 | 1 | 69개 중 68 통과; baseline과 같은 공용 11st 예외명 1개만 실패, Qoo10 추가 2개 통과 |
| Qoo10 전용+공용 reply 4파일 최종 | 변경 후 | 0 | 25/25 통과 |
| 수정 파일 ESLint | 변경 후 | 0 | 출력 없음 |
| 새 전용 모듈 strict TypeScript | 변경 후 | 0 | 출력 없음 |
| 공용 의존성까지 강제 단일 TypeScript 검사 | 변경 후 | 2 | S0 기존 JSX flag/공용 test type 오류; 새 전용 모듈 단독 검사는 0 |

공용 실패 재현: `tests/inquiry-sync-contract.test.ts`가 elevenst `{}` 입력에 `/INQUIRY_CHANNEL_UNSUPPORTED/`를 기대하지만 현재 정규화기는 `INQUIRY_PAGE_INVALID:elevenst`를 반환한다. Qoo10 소유 범위 밖이라 수정하지 않았다.
