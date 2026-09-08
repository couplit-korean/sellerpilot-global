# 쿠팡 CS 2차 보완 결과

- 시각: 2026-09-08 22:20 KST
- S0 ID: `S0-20260908-decaba426812a3ba`
- 목적: 제안 문서만 남기지 않고 콜센터 reply ACK→readback, history complete-only checkpoint, 격리 DB→인증 route, 신규/늦은 응답과 credential 격리를 실행 가능한 코드·SQL·시험으로 닫았다.
- 비실행 범위: 운영 DB/migration, provider mutation, 실고객 답변, commit/push/deploy, 상품·주문·배송·환불 mutation은 모두 0이다.

## 구현 결과

1. `003-coupang-call-center-reply-readback.sql`
   - provider acceptance와 같은 delivery 트랜잭션에서 exact call-center marker를 확인한다.
   - 같은 credential/environment/owner/seller lineage로 `call-center-detail` child 한 건만 만든다.
   - `source_job_id`, delivery, child unique 제약으로 ACK 재처리를 멱등화한다.
   - child 실패는 reply job을 다시 만들지 않는다.
2. `004-coupang-history-checkpoint.sql`
   - 7~30일, 연속 7일 이하 창, 창당 정확한 8 scope, 초기 job 수, 전체 상태 합계를 검증한다.
   - queued/running/failed가 하나라도 있으면 같은 `toDate`만 replay하고 next를 숨긴다.
   - continuation을 포함한 전 job 성공 뒤에만 `fromDate - 1일`을 노출한다.
3. `005-coupang-authenticated-web-verification.sql` + 전용 route
   - exact credential/date/kind로 ticket과 대화를 읽는다.
   - 동일 external inquiry/order가 다른 credential에 있어도 섞지 않는다.
   - 주소·전화·customer name·provider context·secret은 응답하지 않는다.
   - 미인증/비관리자/anon/service role은 거부한다.
4. 답변 관측·신규/재수집 시험
   - exact inquiry/parent/body만 remote-observed다.
   - late old-generation echo는 그 delivery만 확인하고 새 재문의를 해결하지 않는다.
   - product/call-center 같은 창 재수집은 중복 이벤트가 없고 새 재문의·늦은 답변만 한 건 추가된다.
5. 다른 vendor의 동일 주문번호
   - reply observation과 web route는 credential로 격리된다.
   - 공통 order row에는 vendor lineage가 없어 전역 order binding은 아직 증명 불가다.
   - 전용 fail-closed 판단과 3개 반례를 구현하고 공통 수정 `coupang-006`을 제출했다.

## 실제 화면 재확인

- Chrome profile: `CHANGHEE`
- seller: `커플릿(Couplit)`; 전체 vendor ID는 기록하지 않음
- 상품 문의: 최근 30일 미답변 총 0
- 고객센터 문의: 최근 30일 미답변·미확인 총 0
- 리뷰 목록: 최근 30일 전체 별점·판매중 총 0
- 메뉴: 고객 문의 / 고객센터 문의 / 리뷰 목록 / 리뷰 이벤트 관리
- 이 화면 결과는 WING 관측이며 OpenAPI fresh GET이나 DB 저장 성공으로 대체하지 않는다.

## 시험 결과

- 쿠팡 표적 전체: 최종 41/41 통과.
- DB reply readback: 4/4 통과.
- DB history checkpoint: 3/3 통과.
- DB→인증 route: 3/3 통과.
- intake/replay: 2/2 통과.
- DB reply observation: 4/4 통과.
- multi-vendor order fail-closed: 3/3 통과.
- TypeScript와 전용 변경 파일 ESLint: exit 0.
- 지시된 공통 묶음은 전용 폴더에서 49/50. 실패 1은 stale 11번가 기대값이며 현재 통합 기준의 동일 파일은 24/24 통과했다.

## 판정

- 로컬 전용 구현: 완료.
- 첫 DB→인증 웹 대조: 완료, 단 합성 fixture와 route JSON 기준이며 공통 UI 렌더링은 미반영.
- 상품/콜센터 실제 OpenAPI 읽기: 미완료. 실행 credential env가 이 전용 폴더에 없고 공통 CS read route가 미반영이다.
- 실제 신규 수신·실답변 원격 관측: 미완료. 신규 provider event와 승인 티켓/문구가 없다.
- 과거 전체: 미완료. 30일/최초 제공일까지 실제 provider 실행이 없다.
- 쿠팡 전체 완료: 아님.
