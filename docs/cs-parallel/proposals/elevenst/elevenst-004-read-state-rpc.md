# 공통 변경 요청 elevenst-004

- 목적: 전용 인증 GET route가 운영에서도 11번가 원격 읽기 증거와 저장 이력 수를 한 번의 읽기 전용 RPC로 조회하고, GET-only Alimi 정규화 결과를 기존 private CS 수신 원장에 계정 계보 그대로 연결한다.
- 호출 route: `app/api/admin/cs/channels/elevenst/read-state/route.ts`
- 요청 signature: `public.sellerpilot_read_elevenst_cs_read_state_v1(p_seller_id text) returns jsonb`
- 권한: `authenticated`만 실행, `anon`·`public` 실행 금지. 함수 내부에서도 현재 사용자가 관리자임을 재확인한다.
- 보안: private 원본 table을 직접 노출하지 않고 고정 필드만 반환한다. 고객 본문·이름·`memId`·`memNm`·credential secret은 반환하지 않는다.
- 쓰기: 없음. 이 RPC는 SQL `SELECT`만 수행하며 서비스 역할 우회나 상태 갱신을 포함하지 않는다.
- 실제 SQL 초안: `elevenst-004-read-state-and-alimi-ledger.sql`
- 런타임 연결 patch: `elevenst-005-read-observation-common.patch`

## 고정 반환 계약

```json
{
  "sellerId": "couplit",
  "sellerName": "커플릿",
  "productQna": {
    "checkedAt": "ISO-8601 UTC",
    "httpStatus": 200,
    "accepted": false,
    "resultCode": "500",
    "providerRows": 0,
    "storedRowCount": 0,
    "latestStoredReceivedAt": null
  },
  "urgentAlimi": {
    "checkedAt": "ISO-8601 UTC",
    "httpStatus": 200,
    "accepted": true,
    "resultCode": "0",
    "providerRows": 0,
    "storedRowCount": 0,
    "latestStoredReceivedAt": null
  }
}
```

`providerRows`는 gateway가 완전한 provider response를 검증했을 때의 행 수여야 한다. 저장 ticket 수에서 역산하면 안 된다. Product Q&A 업무 코드 `500`, Alimi row-limit incomplete, parser 미준비 상태는 `accepted=false`로 유지한다.

## migration 요구

- migration 번호와 공통 증거 ledger 선택은 통합 담당이 결정한다.
- 기존 Q&A migration `20260908049000` 적용 여부와 전용 Alimi ingest migration의 선행 여부를 검사한다.
- 함수는 `security definer`, `set search_path=''`, 고정 qualified name, 관리자 재검사와 실행 권한 회귀 시험을 포함한다.
- 프로덕션 적용 전 격리 PGlite에서 무인증 401, 잘못된 토큰 401, 관리자 200, DB read 1회, mutation 0회를 재현한다.

## SQL 원장 계약

- `sellerpilot_private.elevenst_cs_read_observations`는 원본 본문 대신 안전한 parser 결과 digest, 실제 HTTP/업무 코드, 범위, 상태 필터, provider row 수, incomplete 표시만 저장한다.
- `sellerpilot_private.elevenst_alimi_state_events`는 동일 `emerNtceSeq` 티켓이 `03` 후 `04` 재문의로 돌아오는 상태 변경을 append-only digest 이벤트로 남긴다.
- 기존 `sellerpilot_service_ingest_inquiries` wrapper는 `urgent_inquiry`와 `urgent_notice`를 같은 대화로 혼동하지 않고 `providerContext.kind`·`senderRole=customer|system`으로 분리한다.
- 현재 GET-only 단계에서는 모든 Alimi row의 `replySupported=false`를 강제한다. 기존 답변이 있어도 현재 상태 `04`는 `waiting`으로 재개된다.
- 동일 안전 응답 digest 재수신은 read observation·inbound message·state event를 중복 삽입하지 않는다.
- 티켓의 `seller_account_key`가 현재 active credential과 다르면 즉시 거절하고, 같은 판매자 계정의 정상 credential rotation만 현재 credential로 재결속한다.
- 활성 11번가 credential이 0개이거나 2개 이상이면 read RPC는 결과를 임의로 고르지 않고 거절한다.
- Alimi 5,001행 경계는 `accepted=false`, `providerRows=5001`, `parseIncomplete=true`로 기록하며 row를 ingest하지 않는다.

## 현재 검증

전용 smoke는 실제 `authenticateAdminRequest`, loopback Auth/PostgREST, PGlite와 HTTP 포트 3214를 사용해 위 계약을 검증했다. 이는 운영 RPC 적용 증거가 아니라 격리 DB에서 route까지의 연결 증거다.

추가로 SQL 초안 자체를 PGlite에 적용한 시험 3건과 안전 증거 builder 시험 4건이 모두 통과했다. 시험은 다음을 직접 확인한다.

- service-role 전용 수집 RPC, authenticated-admin 전용 읽기 RPC, private table 직접 조회 거절
- Q&A `resultCode=500`은 `remoteCount=null/emptyConfirmed=false`로 투영
- Alimi `03 → 04` 재문의 재개, 시스템 알림 분리, 중복 수집 멱등성, 다른 판매자 계정 거절
- `memId` 추가 필드 거절, 5,001행 incomplete 미 ingest

공통 패치는 현재 통합본에 `git apply --check` 통과했고, 임시 통합 복제본의 전체 TypeScript 검사를 통과했다. gateway 회귀는 11번가 추가 경로를 통과했고, 스마트스토어 기존 기대값 1건이 현재 통합본에서도 동일하게 실패하는 비-11번가 baseline임을 별도 재현했다.

아직 운영 migration·RPC·runtime patch를 적용하지 않았으므로, 이 검증을 운영 Supabase 연결 완료로 표시하지 않는다.
