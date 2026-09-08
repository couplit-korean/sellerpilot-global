# 공통 변경 요청 coupang-005

- 목적: 같은 기간·종류·credential의 쿠팡 원격 ID, 주문 계보와 대화 이벤트를 격리 DB에서 인증된 웹 응답까지 대조한다.
- 요청 채널: coupang
- S0 ID: `S0-20260908-decaba426812a3ba`
- 전용 구현: `lib/cs/channels/coupang/verification.ts`, `app/api/admin/cs/channels/coupang/verification/route.ts`
- SQL 초안: `docs/cs-parallel/proposals/coupang/patches/005-coupang-authenticated-web-verification.sql`
- fixture: `tests/fixtures/cs/coupang/db-web-fixture.sql`
- 시험: `tests/cs-coupang-db-web.test.ts`

## 계약

- 입력은 exact `credentialId`, KST 달력 `from/to`, `product|call-center|return_request|cancel_request|exchange_request`, 최대 100행이다.
- 기간은 inclusive 최대 31일이며 인증·관리자 검사를 먼저 수행한다.
- DB 조회는 `owner_id + source_credential_id + channel_key=coupang + external_ticket_id kind prefix`를 모두 요구한다. 같은 주문번호·같은 external inquiry ID가 다른 credential에 존재해도 섞이지 않는다.
- 응답은 external ticket ID, external order reference, ticket/provider status, receivedAt, inbound/remote message ID, sender role, body, parent answer ID만 포함한다.
- customer name, phone, address, 전체 provider context, credential secret은 반환하지 않는다.
- Route Handler는 `private, no-store`이고 user-scoped Supabase client만 사용한다. service-role client를 사용하지 않는다.
- Route는 DB JSON 형식만 검사하지 않고 응답의 credential/kind/from/to가 요청과 정확히 같은지, displayedTickets가 실제 tickets 길이와 같은지, totalTickets가 displayedTickets 이상인지, 각 ticket ID prefix가 응답 kind와 같은지도 재검증한다. 불일치는 502로 fail closed한다.
- SQL 함수는 `SECURITY DEFINER SET search_path=''`와 명시적 admin 검사 후 private table을 읽는다. public/anon/service_role 실행권은 회수하고 authenticated에만 명시적으로 부여한다.

## 격리 검증 결과

- 합성 DB의 `call-center:3101`, 주문 `9001`, remote messages `4103/4104`, parent `4103`이 인증 route JSON에서 동일하게 대조됐다.
- 다른 credential에도 같은 주문 `9001`과 inquiry `3101`을 넣었지만 응답에는 섞이지 않았다.
- provider context에 넣은 합성 전화번호·주소는 웹 JSON에 나타나지 않았다.
- 미인증 요청은 401이며 DB RPC를 호출하지 않는다. 잘못된 날짜는 400이며 DB를 호출하지 않는다.
- RPC가 다른 credential/kind/from/to 또는 불일치 counts/ticket prefix를 반환하면 인증 route는 502이며 그 데이터를 표시하지 않는다.
- DB RPC는 authenticated 관리자만 실행되고 anon/service role 및 비관리자 authenticated 호출은 거부된다.

- 공통 영향: SQL 초안 반영과 전용 route 배치만 필요하다. 기존 공통 CS UI 기본 필터는 변경하지 않는다.
- 운영 적용 상태: 미반영. 운영 DB에는 적용하거나 실행하지 않았다.
