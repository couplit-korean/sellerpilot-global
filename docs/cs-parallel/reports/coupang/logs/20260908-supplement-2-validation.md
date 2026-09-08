# 2026-09-08 쿠팡 2차 보완 검증 로그

실제 secret, 전체 vendor ID, 실고객 원문은 기록하지 않았다. 운영 provider mutation, 고객 답변, 운영 DB write는 수행하지 않았다.

| 시각(KST) | 명령/검증 | 결과 |
|---|---|---|
| 21:xx | `node --test tests/cs-coupang-reply-observation-db.test.mjs` | exit 0; 4/4 |
| 21:xx | 쿠팡 표적 9파일 묶음 | exit 0; 37/37 |
| 21:xx | Node 22 PATH의 `pnpm exec tsc --noEmit --pretty false` | exit 0 |
| 21:xx | 전용 수정 TS/MJS ESLint | exit 0 |
| 22:0x | 지시된 공통 묶음 + 반복 exchange cursor 반례 | exit 1; 49/50. 실패는 11번가 `INQUIRY_CHANNEL_UNSUPPORTED` 기대와 현재 `INQUIRY_PAGE_INVALID:elevenst` 차이 |
| 22:0x | 현재 통합 기준 폴더에서 `tests/inquiry-sync-contract.test.ts` | exit 0; 24/24. 전용 폴더의 공통 스냅샷 불일치로 판정 |
| 22:0x | `tests/cs-coupang-order-lineage.test.ts` | exit 0; 3/3 |
| 22:0x | order lineage 추가 후 TypeScript + 해당 ESLint | exit 0 |
| 22:1x | Chrome profiles/tabs read-only inventory | `CHANGHEE` WING 기존 탭과 `JEONGHUN` 별도 Vercel/Supabase 탭 확인; CHANGHEE만 사용 |
| 22:1x | WING 고객 문의 / 고객센터 문의 / 리뷰 목록 read-only | 각각 최근 30일 0; 고객 문의 미답변, 콜센터 미답변·미확인, 리뷰 전체 별점·판매중 |
| 22:1x | 공식 Coupang Developer Center 현재 문서 | 상품/콜센터 최대 7일, pageSize 50/30, 콜센터 네 상태, 단건 GET, exact parent answer, exchange nextToken 확인 |
| 22:2x | 최종 쿠팡 표적 10파일 묶음 | exit 0; 41/41 |
| 22:2x | 최종 Node 22 TypeScript와 쿠팡 변경 TS/MJS ESLint | 둘 다 exit 0 |

## 격리 DB 결과

- reply ACK/readback: 같은 credential child 1, duplicate ACK 후 child 1, failed child 후 reply 재생성 0, 잘못된 acceptance marker rollback, API role private table 접근 거부.
- history checkpoint: 39 success+1 failed/running은 동일 종료일 replay; initial 40+continuation 2의 42/42 성공만 이전 날짜 노출; malformed scope와 비관리자 거부.
- DB→route: `call-center:3101`, 합성 주문 `9001`, 합성 remote message/parent가 exact credential에서만 일치; 다른 credential 동일 ID/주문 배제; 합성 전화/주소 미노출.
- reply observation: wrong parent, 다른 credential 동일 주문번호, late old-generation echo, 복수 delivery 후보는 최신 ticket을 잘못 해결하지 않음.

## 보안 계약

- proposal RPC는 `SECURITY DEFINER SET search_path=''`와 fully-qualified object를 사용한다.
- 함수/table 권한은 public/anon/service_role에서 회수하고 필요한 authenticated 관리자 경로만 부여한다.
- 전용 route는 인증을 먼저 수행하고 user-scoped client만 호출하며 `private, no-store`로 응답한다.

## 알려진 외부/공통 경계

- 로컬 `COUPANG_ACCESS_KEY`, `COUPANG_SECRET_KEY`, `COUPANG_VENDOR_ID`는 모두 absent이며 secret을 출력하지 않았다.
- active credential/egress 결속은 앞선 운영 read-only 증거이며 이 보완에서 fresh OpenAPI GET은 수행하지 못했다.
- 공통 `commerce_orders`에 credential/vendor lineage가 없어 전역 same-order vendor 차단은 미반영이다.
- SQL 003/004/005는 proposal path의 실행 가능한 초안으로만 검증했고 운영 migration으로 적용하지 않았다.
