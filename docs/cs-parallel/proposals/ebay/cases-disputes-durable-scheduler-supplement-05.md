# eBay 케이스·분쟁 내구성 수집기 통합 요청 05

요청 ID: `EBAY-SHARED-007`. supplemental 04는 SHA-256 `0d5a6cf154b05e9194eb03009d8d21c713bcf783f77f3c51f9d738dfb2b5feed` 상태로 고정하며 수정하지 않는다.

## 중앙 재현 결함과 교정

1. 공통 `paginationResult`가 continuation arguments에 추가하는 `sellerpilotPaginationDepth`, `sellerpilotPaginationEpoch`, `sellerpilotPaginationTrail`을 전용 strict schema가 거부해 2페이지가 `CHANNEL_ARGUMENT_INVALID:caseDisputeHistory`로 끝났다.
   - 세 필드를 all-or-none으로 수용한다.
   - 다음 business cursor와 depth/epoch/trail을 전용 validator에서 정확히 재계산한다.
   - 반복 digest, 잘못된 rotation, 변형된 cursor는 SQL claim fence에서도 거부한다.
2. 정상 eBay case page의 step 이름 `ebay-case-dispute-history-page`가 generic `normalizeChannelInquiries`에 들어가 `INQUIRY_PAGE_REQUIRED:ebay`로 끝났다.
   - in-process serverless와 external worker completion POST 모두 job의 전용 kind를 먼저 식별한다.
   - 전용 envelope를 검증하고 claim-fenced v2 record RPC를 성공시킨 뒤에만 기존 generic completion RPC로 넘긴다.
   - generic inquiry normalization, reply observation, history coverage와 `inquiries-normalized/0` 저장을 이 전용 경로에서는 실행하지 않는다.
   - 완료 HTTP 재전송에서 `completed_replay`이면 envelope는 다시 검증하되 이미 선행한 전용 ledger write를 반복하지 않고 generic completion replay로 진행한다.

## 내구성 SQL v2

- root enqueue 직후 claim 전 exact `collectionRootJobId`와 `collectionPlanKey`를 job arguments에 주입하고 root arguments SHA-256을 run ledger에 고정한다.
- 모든 page ledger는 root/parent/job, credential ID·version, provider-certified seller key, resource, collection kind, anchor, request arguments hash, expected next arguments hash에 결속한다.
- 초기 완료는 root에서 시작해 page ledger가 있는 실제 continuation child만 재귀적으로 연결한다. 마지막 노드는 `succeeded`, 빈 window queue, provider next 없음, response continuation 없음이어야 하며 verified chain count와 전체 job lineage count가 같아야 한다.
- synthetic succeeded child, page ledger 없는 child, orphan, 잘못된 parent, partial failure, 마지막 창의 남은 provider page는 초기 완료를 만들지 못한다.
- 재귀 상한은 8,192이며 실제 130 provider page와 뒤이은 모든 resolution window를 포함한 128단계 초과 초기 lineage로 검증했다.
- 실패 후 재개는 이전 불완전 root를 완료로 승격하지 않고 새 anchor plan에서 새 initial root를 시작한다. 안전 이력 ledger의 provider native ID dedupe는 그대로 사용한다.

## 공유 패치 입력

패치: `docs/cs-parallel/proposals/ebay/ebay-case-dispute-completion-entrypoints-v2.patch`

2026-09-08T15:45:36Z 현재 통합 폴더 before SHA-256:

- `lib/channels/serverless-gateway.ts`: `faedb5761704ff3f01fa4f42c892d3077777688f1d468bb95ce7a252dff945bf`
- `app/api/channel-gateway/worker/complete/route.ts`: `b9a1a5056557e8bf6ef204727af13492e078d8d4b2fd18ff5f1705224f466383`
- `lib/channels/gateway-contract.ts`: `d371180e2a132da711cd8dcff3996673cbd198c681bfa1158365c4e92709b5d4`
- `scripts/ai-cli-worker.mjs`: `9174bd48ea554318dc9500021004fa2fd27b1669edef2ec8abc5f4cebaaac102`
- 전용 module 입력 `lib/channels/cs/ebay/case-dispute-gateway.ts`: `780e4a54a5f208d33c8ab92992057226b767b1f65bed43b56a7d47832f69dde7`

위 상태에서 `git apply --check --whitespace=error-all`을 통과했다. 통합본 hash가 다시 바뀌면 덮어쓰지 말고 patch를 새 기준에 재검증한다.

## 적용 순서

1. supplemental 05 manifest의 전용 module·시험·SQL v2를 선택 적용한다.
2. history ledger/read v2 뒤의 아직 사용되지 않은 migration 번호로 `ebay-case-dispute-durable-collection-v2.sql`을 옮긴다.
3. 위 공유 patch를 최신 통합본에 적용한다.
4. 격리 DB에서 v2 SQL과 actual in-process/external completion tests를 실행한다.
5. 전체 gateway/type/lint/migration 회귀 뒤에만 scheduler 활성화 여부를 별도 결정한다.

## 현재 실제 관측과 제한

이번 05에서는 provider/API/브라우저를 다시 호출하지 않았다. 마지막 동일 1년 범위 관측은 ASQ 0, Trading Inbox 9개 fingerprint, Commerce `FROM_MEMBERS`와 `FROM_EBAY` 각각 HTTP 403/total unknown이다. resolution case는 별도 18개월 19창 HTTP 200·고유 0, Payment Dispute summary는 HTTP 404/total unknown이었다. 이는 과거 관측의 보존이며 현재 재확인이나 운영 활성화 증거가 아니다.

운영 DB write, customer reply, case/dispute accept·contest·refund·close·appeal, credential refresh, commit, push, deploy는 수행하지 않았다.
