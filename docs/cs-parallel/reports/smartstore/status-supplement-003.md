# SmartStore CS 상태 보완 003

리뷰 보완 002는 SHA-256 `478ebba8d24e960b2ee5e63efcbfac419c6126ea71e69c70cc12018706b15b42`로 동결했고 15개 파일 mismatch 0이다. 이번 보완은 새 파일만 추가한다.

## 이번에 닫은 항목

- exact 1~30일 SmartStore 전용 enqueue SQL draft를 추가했다. 1·6·7·30일과 임의 윤일 교차 범위를 로컬 PGlite에서 실행했다.
- 한 범위당 상품문의와 고객문의 읽기 job만 정확히 2개 생성한다.
- shared admin actor와 credential seller owner를 분리하고, exact credential·seller account·environment·static egress를 고정했다.
- 중복 요청은 같은 run을 재사용하고, 부분 실패는 attempt 4 미만의 실패 읽기 job만 복구하며 exhausted job은 재생하지 않는다.
- 다른 seller active scope, revoked credential, non-admin을 fail-closed했다.
- 1일 창에서도 target seller의 product/customer 두 scan이 모두 완료되기 전 checkpoint가 이동하지 않음을 확인했다.

## 아직 완료가 아닌 항목

- SQL과 route는 proposal이며 운영 DB/application에 반영되지 않았다.
- 공용 patch는 apply-check만 통과했다. 실제 route 200/401과 UI 렌더는 없다.
- `HTTP 202`는 접수이며 provider GET·DB 원장·웹 표시 완료가 아니다.
- 실제 신규 상품문의/고객문의와 승인 답변 표본이 없어 신규 수신·답변 신규/수정·외부 선답변·경쟁 readback은 미완료다.
- TalkTalk와 리뷰는 계속 별도 미연결이다.

## 판정

- 상품문의·고객문의 핵심 2종: 실제 46/46 read-only 분모와 로컬 계약/복구 구현은 유지. 운영 exact-window v5 반영과 실표본 왕복은 대기.
- SmartStore CS 전체: TalkTalk·리뷰와 실답변 왕복이 없으므로 미완료.
- mutation: 운영/provider/credential/고객답변/commerce 모두 0.
