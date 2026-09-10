# 공통 변경 요청 elevenst-005

- S0: `S0-20260908-decaba426812a3ba`
- 선행 전용 파일: `lib/cs/channels/elevenst/read-observation.ts`
- 선행 DB 초안: `elevenst-004-read-state-and-alimi-ledger.sql`
- 정확한 patch: `elevenst-005-read-observation-common.patch`

## 문제와 최소 변경

기존 gateway 완료 경로는 정규화 row만 `sellerpilot_service_ingest_inquiries`로 보낸다. 이 상태로는 Q&A HTTP 200/업무 코드 500과 Alimi 정상 0건을 구분하는 원격 증거가 원장에 남지 않으며, read-state route는 fixture 이외에서 데이터를 받을 수 없다.

패치는 두 gateway 완료 경로에서만 11번가 `inquiries.list` 증거를 만든다.

- 정상 수신: 기존 atomic ingest 완료 후 본문 없는 증거 RPC를 호출해 Alimi event·ticket·credential 계보가 실제로 연결됐는지 검사한다.
- 업무 오류: 정규화 row가 없어도 Q&A `resultCode=500`과 범위·상태·digest를 저장한 후 기존 실패 처리를 유지한다.
- 응답 본문·고객명·Q&A/Alimi 식별자는 observation RPC 인자에 싣지 않고 canonical safe parsed response의 SHA-256만 보낸다.

## 현재 통합본 preimage / 제안 after

| 파일 | before SHA-256 | proposed after SHA-256 |
|---|---|---|
| `lib/channels/serverless-gateway.ts` | `07b99bea1c41a7d2cad259a06302f49f4654d599b1f4fb7197bc9f4ffb49896a` | `4f5b2e784ddba4d793aab837987e9da6ac1063e1b451c6dc680918d2536ff6e7` |
| `app/api/channel-gateway/worker/complete/route.ts` | `41435b65a23dc4d12a9c47a37f8ac20d572a81afe8af1fb9171d004edb0f7e64` | `baaa20bf5eaf501a08d9110955ebc019a2b614983b5836388d15815d695d8c8d` |
| `tests/serverless-cs-gateway.test.ts` | `c605db504d54b0bbdffa82a012e39782a138d7202c2a56ad461df910269fe073` | `b8259f8ea6bf9ffbb837757e2fcef8e7d181128a3f90d99784ac17ecea6679c5` |

preimage가 다르면 적용하지 말고 재베이스해야 한다.

## 검증

- 현재 통합본 `git apply --check`: 통과
- 임시 통합 복제본 `tsc --noEmit`: 통과
- `tests/serverless-cs-gateway.test.ts` + `tests/channel-gateway-worker-route-contract.test.mjs`: 76건 중 75건 통과. 11번가 추가 회귀는 통과했다.
- 나머지 1건은 SmartStore `orderReferenceState=unavailable` 기대값 불일치로, patch 미적용 현재 통합본에서도 동일 실패한다.

이 패치와 004 SQL은 같은 통합 단위다. helper만 적용하거나 SQL만 적용하면 운영 read-state 연결이 완성되지 않는다.
