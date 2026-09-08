# SmartStore CS 상태 보완 004

supplement 002와 003은 각각 SHA-256 `478ebba8d24e960b2ee5e63efcbfac419c6126ea71e69c70cc12018706b15b42`, `9727f4da736aee56fa69da4d84aa34bb8dd7f660368678717afb5d5a41911ea4`로 동결했다. 이번 보완은 새 파일만 추가한다.

## 이번에 닫은 항목

- 005 proposal route를 임시 격리 clone에 실제 적용하고 exported GET/POST를 실행했다.
- `authenticateAdminRequest` 선행 호출과 fixture 기반 anonymous `401`, expired `401`, non-admin `403`을 확인했다. 이 결과는 운영 인증 증거가 아니다.
- 잘못된 날짜, 복수 active production SmartStore credential을 fail-closed했다.
- completed checkpoint는 enqueue 0과 `200`을, exact 1일 창은 정확한 날짜·credential·production 환경의 v5 RPC와 `202 acceptedNotCompleted`를 확인했다.
- 현재 SmartStore UI가 `history-window.tsx` → `onBackfill` → `syncOrders` → `/api/operations/sync`의 구형 경로를 계속 쓰는 것을 추적했다.
- SmartStore 버튼만 v5 route로 연결하고 202를 완료로 표시하지 않는 실행 가능한 006 proposal patch를 추가했다. 쿠팡·11번가 Q&A legacy 30일 동작은 유지한다.

## 아직 완료가 아닌 항목

- 005 route와 006 UI는 proposal이며 공용 source, 운영 DB, 배포에 반영되지 않았다.
- 운영 관리자/비로그인/만료세션의 실제 route 인증 관측은 없다. 이번 401/403은 fixture다.
- `202`는 읽기 job 접수일 뿐 product/customer 두 작업 완료, provider 조회, 원장 반영, 웹 표시가 아니다.
- 실제 신규 상품문의/고객문의와 승인 답변 표본이 없어 답변 신규·수정·외부 선답변·새 문의 경쟁 readback은 미완료다.
- TalkTalk와 리뷰는 계속 별도 미연결이며 1년 이전은 unknown이다.

## 판정

- 상품문의·고객문의 핵심 2종: 46/46 실제 read-only 분모와 로컬 계약·exact 복구·route 실행 제안까지 검증. 운영 v5 적용과 nonzero 실표본 왕복은 대기.
- SmartStore CS 전체: TalkTalk·리뷰와 실답변 왕복이 없으므로 미완료.
- mutation: 운영/provider/credential/고객답변/commerce 모두 0.

다음 통합 단계는 003/004 SQL, 005 route, 006 UI를 충돌 검토 후 함께 반영하고, 운영 인증 GET 및 한 창 POST의 접수→두 job 완료→provider/원장/웹 readback을 분리 관측하는 것이다.
