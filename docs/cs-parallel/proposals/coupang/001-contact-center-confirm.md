# 공통 변경 요청 coupang-001

- 목적: WING `고객센터 문의`의 미확인 이관을 답변과 구분해 확인 처리하고, 처리 후 단건 GET으로 원격 상태를 관측한다.
- 요청 채널: coupang
- S0 ID / 현재 인터페이스 버전: `S0-20260908-decaba426812a3ba`
- 수정할 공통 파일과 함수: `lib/channels/catalog.ts`, `lib/channels/operations.ts`, `lib/channels/inquiry-reply.ts`, `app/api/admin/cs/reply/route.ts`, 공통 CS UI의 작업 분기
- 현재 파일 SHA-256: catalog `80c1b59ffcaf655f975b334500ff318e8b56a446751dc70dc45ae7014767c31b`; operations `da653ed5fc9b66e03817603b850b8e6d091274453b86956f5ee59bd718ca1eab`; inquiry-reply `5149a66737b7b174279c336e1b77e72861bdefd22fa84a7c2becd4782f3e87c0`; reply route `fc458b2225c7c8a28994152bdf68056f41226424e14f2108521828c7489492f1`
- DB 객체: 새 mutation 종류와 delivery ledger 결속은 통합 담당 설계 필요. 기존 답변 delivery를 확인 처리에 재사용해 의미를 섞지 않는다.
- 기존 동작: 콜센터 `TRANSFER`는 조회하지만 공통 작업 종류가 답변만 지원한다. WING과 공식 계약상 `TRANSFER`는 답변 불필요, 확인 필요다.
- 문제를 재현하는 최소 입력: `{kind:"call-center", requestedStatus:"TRANSFER", inquiryId:"3101"}`를 답변 작업으로 보내면 확인 전용 API를 표현할 수 없다.
- 원하는 동작: 승인된 이관 건만 `POST /v2/providers/openapi/apis/api/v4/vendors/{vendorId}/callCenterInquiries/{inquiryId}/confirms`에 `{confirmBy:<WING user id>}`로 보내고, 성공 응답 뒤 채널 전용 `call-center-detail` GET을 수행해 더 이상 미확인인지 관측한다.
- 전용 모듈 경로와 export: `lib/channels/coupang-inquiries.ts`의 `call-center-detail`; `lib/channels/cs/coupang/contact-center.ts`의 `coupangContactCenterReplyTarget`
- 기존/새 입력·출력 계약: 기존 `inquiries.reply` 유지. 새 `inquiries.confirm`은 inquiryId와 승인자만 받으며 자유 입력 답변 본문을 받지 않는다. 결과는 접수와 원격 관측을 별도 상태로 둔다.
- 최소 변경안: 공통 operation allowlist와 queue/claim fence에 `inquiries.confirm` 추가, 쿠팡 adapter 확인 분기 추가, UI에 `답변`과 `확인` 버튼 분리, 단건 GET 관측 결과가 일치할 때만 완료.
- 다른 채널 영향: 새 operation을 쿠팡에만 allowlist한다.
- 상품/주문/배송 mutation 영향: 없음. 환불·교환 승인, 주문 상태, 송장 mutation을 포함하지 않는다.
- 재현·회귀 시험 명령: `node --import tsx --test tests/cs-coupang-contact-center.test.ts tests/inquiry-reply.test.ts`
- migration 선행/preimage/ACL 요구: mutation dedupe key는 credential incarnation + inquiryId + confirm action으로 고정하고 authenticated admin만 enqueue, worker만 claim/complete한다.
- 우선순위: 중복답변 / 추가기능
- 통합 담당 처리 상태: 미반영
- 반영된 통합 소스 hash와 검증: 없음
- 공식 계약: https://developers.coupang.com/en/api/cs/coupang-contact-center-inquiry-check

