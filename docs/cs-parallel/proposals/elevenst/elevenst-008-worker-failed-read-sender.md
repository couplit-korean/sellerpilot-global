# 공통 변경 요청 elevenst-008

- S0: `S0-20260908-decaba426812a3ba`
- 선행 통합: supplement-04, `elevenst-006`, `elevenst-007`
- 선행 전용 파일: `lib/channels/cs/elevenst/worker-completion.ts`
- 정확한 patch: `elevenst-008-worker-failed-read-sender.patch`
- patch SHA-256: `25c877917b8c6b8323675c08d66d4ca21f2223c94175017df0c5c50e4e8c7b55`

## 확인한 실행 단절

`elevenst-006` 적용 후 serverless `runOne`은 Product Q&A 업무 500 결과를 failed completion과 read-observation까지 운반한다. 외부 실행기 경로는 POST 계약과 수신 route만 해당 result를 받을 수 있었고, `scripts/ai-cli-worker.mjs`의 실제 failed `completionPayload`는 `result`를 항상 버렸다. 따라서 외부 worker가 같은 업무 500을 받아도 `worker/complete` route는 관측값을 만들 수 없었다.

또한 수신 route의 failed-result 분기는 관측만 만들고 `storedResponse`를 설정하지 않아, 같은 11번가 실패를 serverless 경로는 `normalized_inquiries_v1`로 저장하고 외부 POST 경로는 `null`로 저장하는 차이가 있었다.

## 최소 변경

1. 외부 worker의 provider-result failed 분기만 `buildGatewayWorkerFailedCompletionPayload`를 사용한다.
2. builder는 정확히 `elevenst` + `inquiries.list` + HTTP 200 + Product Q&A + `resultCode=500` + 빈 `productQnas`만 result로 붙인다.
3. 전달 result에는 `accepted`, `resultCode`, 빈 `productQnas`, `sellerpilotInquiryKind`만 남긴다. provider message, `memID`, raw body와 credential은 제거한다.
4. 다른 채널, 다른 operation, 다른 HTTP 상태에는 result를 붙이지 않는다. 선행 Temu `retryContinuation`은 builder 인자와 출력에 그대로 보존한다.
5. provider 응답을 받기 전 발생한 transport exception의 기존 catch payload는 그대로 `{status:failed,error}`이며 result가 없다.
6. 수신 POST route는 safe result를 다시 축소 검증하고, serverless와 동일한 `normalized_inquiries_v1`, 0행, provider step 수 형태를 `p_response_payload`로 저장한다.

## 최신 통합본 preimage / 제안 after

| 파일 | before SHA-256 | proposed after SHA-256 |
|---|---|---|
| `scripts/ai-cli-worker.mjs` | `8bbff07389d304b5c2a7149dfe911cc48edae6d59448f8dcb046f35f81324563` | `9174bd48ea554318dc9500021004fa2fd27b1669edef2ec8abc5f4cebaaac102` |
| `app/api/channel-gateway/worker/complete/route.ts` | `8d3c1b41f5db38c4eb6275ab82b7014206ba108d362c7200ffdc045a610bdd96` | `b9a1a5056557e8bf6ef204727af13492e078d8d4b2fd18ff5f1705224f466383` |

preimage가 다르면 적용하지 말고 최신 통합본에 재베이스한다.

## 실행 증거

- 순수 payload/actual worker wiring/Temu continuation/저장형 대조: 5/5 통과.
- 실제 Next dev 포트 3214의 `/api/channel-gateway/worker/complete` POST:
  - 업무 500: HTTP 200, safe result 전달, `normalized_inquiries_v1` 저장, observation 1건.
  - transport: HTTP 200, result 미전달, stored response `null`, observation 0건.
- 관련 TypeScript 회귀: 102/102 통과. Temu history runtime 회귀를 포함한다.
- worker/route/lifecycle MJS 회귀: 31/31 통과.
- 전체 `tsc --noEmit`, 선택 ESLint, `node --check scripts/ai-cli-worker.mjs`: 통과.

검증 과정에서 작업 디렉터리 지정 오류로 008 patch가 중앙 로컬에 잠시 적용됐으나, 즉시 exact reverse-check 후 역적용했고 두 preimage SHA-256이 모두 원래 값으로 복구된 것을 확인했다. 운영 DB, provider, 고객 답변 및 배포에는 영향이 없다.
