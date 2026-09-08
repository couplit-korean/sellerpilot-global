# eBay 케이스·분쟁 내구성 수집기 통합 요청 04

요청 ID: `EBAY-SHARED-006`. 통합 담당 처리 상태: 미반영.

## 고정 기준과 변경 경계

- S0: `S0-20260908-decaba426812a3ba`, source HEAD `3cb72144e991626fae98a30cf51022d9a1aa6b0b`.
- `delta.json`부터 `delta-supplemental-03.json`까지는 수정하지 않고 고정 보존한다.
- 현재 통합 폴더에는 01→02→03과 로컬 migration `20260908135249_ebay_case_dispute_history_ledger.sql`, `20260908135323_ebay_case_dispute_history_read_v2.sql`이 반영돼 있다. 운영 DB 적용 증거는 아니다.
- 이번 작업은 전용 `lib/channels/ebay-inquiries.ts`, 신규 eBay gateway module·시험·제안 문서만 수정했다. 공유 `serverless-gateway.ts`, 운영 DB, provider, credential, 고객·분쟁 상태는 수정하지 않았다.

## 제출물

1. `lib/channels/cs/ebay/case-dispute-gateway.ts`
   - 정각 UTC anchor에서 resolution case 초기 18개월을 30일 이하 창으로 나눈다.
   - 초기 복구는 19개 창을 동시에 enqueue하지 않는다. 하나의 root job과 `windowQueue`로 만들고, 각 창 안의 provider 페이지를 먼저 끝낸 뒤 다음 창을 같은 continuation lineage로 진행한다.
   - 초기 복구가 끝난 뒤에만 최근 48시간 overlap을 enqueue한다. Payment Dispute summary는 독립 root로 병렬 수집할 수 있다.
   - 기존 production GET adapter인 `readEbayResolutionCasesPage`와 `readEbayPaymentDisputesPage`만 호출한다. 답변·환불·분쟁 수락/이의제기/종결 action은 없다.
   - 결과는 `ebay-case-dispute-history-page` step으로 정규화하고, 일반 gateway 완료 전에 claim-fenced record RPC로 보낸다.
2. `docs/cs-parallel/proposals/ebay/ebay-case-dispute-durable-collection.sql`
   - credential version과 resource별 수집 scope를 저장한다.
   - initial root/completion, continuation lineage, native-ID hash dedupe, 마지막 HTTP·availability를 보존한다.
   - 401/403 또는 404는 해당 `resolution_case` 또는 `payment_dispute` scope만 차단하고, 같은 resource의 아직 시도하지 않은 queued sibling만 취소한다. 다른 resource는 계속 enqueue할 수 있다.
   - rate limit·provider unverified는 scope를 영구 차단하지 않고 deferred로 남긴다.
   - credential version 또는 provider-certified seller key가 바뀌면 해당 credential의 resource scope를 새 상태로 초기화한다.
3. `docs/cs-parallel/proposals/ebay/cases-disputes-durable-scheduler.patch`
   - 전용 inquiry dispatcher와 공통 scheduler/worker의 최소 적용 patch다.
   - 현재 통합 기준 before SHA-256:
     - `lib/channels/ebay-inquiries.ts`: `eeccbf6828667964b0c32b805a6893a1f2a3c590588588781c8162415d65af00`
     - `lib/channels/serverless-gateway.ts`: `bbfd8b122b6dcf3f0d16f760ccd75f7a2db34fd14252c4d2ce1fec3a259d5286`
   - 현재 통합 폴더에서 `git apply --check --whitespace=error-all`을 통과했다. Hash가 바뀌면 덮어쓰지 말고 이 최소 변경을 새 기준에 재계산한다.

## 입력·출력 계약

Scheduler 입력은 정확히 세 job인 `sellerpilot-ebay-case-dispute-collection-plan/1`이다.

- resolution initial: `collectionAnchor`, 정확한 18개월 `collectionRangeStart/End`, 현재 창, 남은 `windowQueue`, `pageNumber=1`, `pageSize=25`.
- resolution recent: anchor 직전 48시간 단일 창, 빈 queue.
- payment periodic: 날짜 범위 없이 page cursor만 사용.

SQL enqueue 출력은 `sellerpilot-ebay-case-dispute-collection-enqueue/1`이며 `attempted`, `queued`, `pending`, `scopeBlocked`, `deferred`, `status`를 분리한다. 활성 production eBay credential과 provider-certified seller binding이 없으면 `not_connected`이고 total이나 복구 완료를 만들지 않는다.

Provider page 출력은 `sellerpilot-ebay-case-dispute-gateway-page/1`이다. `readable`만 HTTP 200·행·continuation을 가질 수 있다. 403/404 등 unavailable page는 `entries=[]`, `total=null`, `nextOffset=null`을 강제한다. Payment cursor는 `(pageNumber-1)*25`, resolution은 현재 창의 시작·종료까지 job에 결속한다.

Record RPC 출력은 `sellerpilot-ebay-case-dispute-gateway-record/1`이며 `recorded`, `authorization_blocked`, `not_available_blocked`, `deferred`를 구분하고 `observedCount`와 `insertedCount`를 따로 반환한다.

## 실행 순서

```text
maintenance scheduler
→ exact 3-job plan
→ service-only enqueue RPC
→ existing periodic enqueue + gateway job claim/lease
→ current credential decrypt and seller-bound inquiries.list
→ eBay GET page
→ claim token/lease/credential/seller/page/cursor 검증
→ safe history record v1 + resource scope/seen-ID update
→ existing rate budget + generic completion/continuation
```

통합 순서는 다음과 같다.

1. 현재 로컬 migration `20260908135249_ebay_case_dispute_history_ledger.sql`과 `20260908135323_ebay_case_dispute_history_read_v2.sql` 뒤의 새 migration 번호를 배정해 `ebay-case-dispute-durable-collection.sql`을 옮긴다.
2. 격리 DB에서 세 migration을 순서대로 다시 적용하고 ACL·claim fence·lineage·resource 격리를 회귀한다.
3. `cases-disputes-durable-scheduler.patch`를 현재 통합본에 적용한다.
4. 전체 gateway/type/lint 회귀 뒤 로컬 scheduler 응답에서 `ebayCaseDisputeCollection`과 `needsAttention`을 확인한다.
5. 운영 DB migration, commit, deploy, provider 재호출은 각각 별도 승인과 관측 단계로 남긴다.

## 내구성과 안전 불변식

- 같은 root의 같은 native ID가 같은 page job에서 재실행되면 idempotent다. 다른 continuation page에서 반복되면 cursor/source drift로 실패한다.
- page record는 활성 worker token, job ID, claim token, lease, credential version, seller key가 모두 현재일 때만 된다.
- initial 완료는 root 하나만 보지 않고 continuation chain의 마지막 빈 queue·무continuation 성공을 확인한다. 실패한 chain은 완료로 승격하지 않는다.
- 빈 readable page도 provider `nextOffset`이 있으면 계속한다. total은 필수 key지만 provider가 모르면 `null`이어야 한다.
- 403/404는 실제 resource 관측이다. 다른 resource의 0건·실패·권한 상태를 추정하지 않는다.
- 분쟁 business action과 상담 답변은 이 수집 경로에 들어갈 수 없다.

## 격리 검증과 한계

- 신규 gateway/DB/patch 계약 시험 12/12 통과.
- 현재 통합 담당이 강화한 실제 로컬 history-ledger migration을 입력으로 한 durable SQL 시험도 4/4 통과.
- 초기 구현 중 PL/pgSQL row 선택 구문 오류와 이후 validation 괄호 오류는 격리 시험에서 발견해 수정했다. 최종 SQL은 두 기준 모두 통과한다.
- 실제 eBay 재호출, 운영 DB write, credential refresh, 브라우저, 고객 답변, 분쟁 action, commit/push/deploy는 모두 0이다.
- 따라서 이는 실행 가능한 로컬 patch·SQL·시험 제출이지, 운영 schedule 활성화나 Payment Dispute 404 해소 증거가 아니다.
