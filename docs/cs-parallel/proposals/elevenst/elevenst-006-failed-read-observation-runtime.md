# 공통 변경 요청 elevenst-006

- S0: `S0-20260908-decaba426812a3ba`
- 선행 통합: `20260908140411_cs_elevenst_read_state_alimi_ledger.sql`, `elevenst-005`
- 정확한 patch: `elevenst-006-failed-read-observation-runtime.patch`
- patch SHA-256: `669257f71e7eb9878e09307ab0e0e50a08a9480fab0266963f239fe2bce0c498`

## 확인한 결함

현재 `runOneServerlessCsGatewayJob`은 provider가 HTTP 응답을 주었지만 11번가 업무 코드가 실패인 `result.ok=false`를 job `status=failed`로 완료한다. 그러나 failed completion 계약이 provider result를 보존하지 않았고, 기존 `elevenst-005` 관측 코드는 `status=succeeded` 내부의 `!syncResponse.ok`에서만 실행됐다. 따라서 실제 Product Q&A `resultCode=500`은 durable completion에는 도달하지만 read-observation RPC를 호출하지 않았다.

전송 예외는 provider 응답 자체가 없으므로 관측 증거를 만들면 안 된다. 반대로 durable completion 뒤 observation RPC 응답만 유실되면 같은 멱등 인자를 재호출해야 한다.

## 최소 변경

1. failed completion의 `result` 허용 범위를 정확히 `channel=elevenst`, `operation=inquiries.list`, `ok=false`로 제한한다.
2. `runOne`이 해당 failed result만 completion까지 운반하고, 기존 정규화 함수를 통해 저장 응답에서는 provider 본문과 credential을 제거한다.
3. durable completion 성공 뒤 body-free observation을 기록한다. 실패 응답에는 `p_inquiries=[]`만 사용한다.
4. observation RPC 오류 또는 계약 응답 유실 시 동일 인자로 한 번 재시도한다. SQL 원장의 멱등 키가 중복 삽입을 차단한다.
5. transport exception에는 failed result가 없으므로 observation RPC를 호출하지 않는다.
6. 외부 worker complete route도 같은 failed-read 계약과 재시도 경계를 사용하며 raw failed result를 DB 응답 payload로 저장하지 않는다.

## 최신 통합본 preimage / 제안 after

| 파일 | before SHA-256 | proposed after SHA-256 |
|---|---|---|
| `lib/channels/gateway-contract.ts` | `9b16f3e8cd1b8c4163f45ebe8f248257cc180e35a975447ce6058b5661daa516` | `3210bedf2fd93342f23ceec0474bac3ccdb3901d84d5eb8e059c950e361fc037` |
| `lib/channels/serverless-gateway.ts` | `bbfd8b122b6dcf3f0d16f760ccd75f7a2db34fd14252c4d2ce1fec3a259d5286` | `620adcd291f775cf2ab8d9efd52fcbacac8d82fe62129409d2985ba26447857c` |
| `app/api/channel-gateway/worker/complete/route.ts` | `5dd9777403d145791fba116152837a3b53c95059985d9d9eab542b73ab4e57ef` | `b7218a1075776407d67d1498aec5ee34dde39b98ad0edd6cfe073b335de656f7` |

preimage가 다르면 적용하지 말고 최신 통합본에 다시 재베이스한다.

## 회귀 증거

- 패치 전 실제 `runOne`: Product Q&A 업무 500 관측 0회, transport 관측 0회, observation response-loss 재시도 0회.
- 패치 후 전용 런타임 시험 4/4: 업무 500 body-free 관측, transport 무관측, 동일 인자 1회 재시도, 다른 채널/성공 result 계약 거절.
- completion 저장 응답은 `normalized_inquiries_v1`, 0행, provider step 수만 보존하며 원문·Key를 포함하지 않는다.
- 최신 통합 임시 복제본: 관련 게이트웨이/UI/DB 97/97 및 worker route 계약 13/13 통과, `tsc --noEmit`과 선택 ESLint 통과.

운영 DB, provider, 고객 답변, 배포에는 적용하지 않았다.
