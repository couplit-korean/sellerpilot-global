# 11번가 CS 보완 03 상태

- 보완 델타 ID: `elevenst-supplement-03-20260908`
- S0: `S0-20260908-decaba426812a3ba`
- 통합 시 `supplement-02`를 선행하고 이 델타를 추가로 적용한다.
- 운영 변경: 없음. SQL은 `proposals/elevenst/`의 migration 초안으로만 작성했다.

## 완료한 보완

1. `elevenst-004` read-state RPC를 실제 실행 가능한 SQL 초안으로 확장했다.
2. GET-only Alimi 정규화 row를 기존 `support_tickets` / `support_inbound_messages`에 연결하고, 상태 변경은 별도 append-only event 원장에 보존하는 wrapper SQL을 제안했다.
3. 재문의 `04`는 과거 답변이 있어도 `waiting`, 현재 GET-only 단계의 `replySupported=false`, 시스템 알림은 `senderRole=system/kind=urgent_notice`로 고정했다.
4. 중복 수집 멱등성, active credential 1개 경계, 다른 seller-account 거절, `memId` 추가 거절, 5,001행 incomplete 미-ingest를 PGlite에서 검증했다.
5. provider 응답 본문 대신 safe parsed evidence SHA-256만 보내는 builder와, gateway atomic ingest 후 observation을 연결하는 `elevenst-005` 공통 patch를 제출했다.
6. PATH에 `node`가 없어도 격리 auth-web smoke가 실제 실행 바이너로 Next CLI를 시작하도록 수정했다.

## 검증 결과

- 11번가 전용 전체: 40/40 통과
- 004 SQL PGlite 권한·수집·읽기: 3/3 통과
- safe observation builder: 4/4 통과
- 전용 `tsc --noEmit`: 통과
- 전용 ESLint: 통과
- 포트 3214 Next auth-web: 무인증 401, 잘못된 토큰 401, 인증 200, DB read 1, provider/prod DB write 0, 종료 후 포트 clean
- 005 패치 현재 통합본 `git apply --check`: 통과
- 005 임시 통합 복제본 전체 TypeScript: 통과
- gateway 회귀: 75/76. 11번가 추가 경로는 통과; 나머지 SmartStore 1건은 패치 미적용 통합본에서도 동일 실패하는 baseline

## 증거 단계와 남은 차단

- 개발 증거: SQL 초안·builder·gateway patch·PGlite·Next auth route 완료
- 통합 증거: 003은 통합 담당이 반영 완료. 004 SQL과 005 runtime patch는 아직 미적용
- 운영 DB 증거: 11번가 Q&A migration·004 SQL 미적용, 운영 RPC readback 없음
- provider 증거: Product Q&A 현재/30일 요청은 HTTP 200 후 업무 `500`; 원격 0건 아님. Alimi 실제 30일 GET만 `result_code=0`, 0건으로 확인됨
- 응답 증거: 승인 티켓/답변이 없어 provider 쓰기·readback 0건
- 잔여 채널: SellerTalk은 세션 전용, 리뷰는 Seller Office/export 후보. 공식 읽기/답변 API 확인 없으므로 11번가 CS 전체 완료가 아님

## 통합 파일

- SQL: `docs/cs-parallel/proposals/elevenst/elevenst-004-read-state-and-alimi-ledger.sql`
- SQL/계약 설명: `docs/cs-parallel/proposals/elevenst/elevenst-004-read-state-rpc.md`
- runtime patch: `docs/cs-parallel/proposals/elevenst/elevenst-005-read-observation-common.patch`
- runtime patch 설명/해시: `docs/cs-parallel/proposals/elevenst/elevenst-005-read-observation-common.md`
- 격리 인증 증거: `docs/cs-parallel/reports/elevenst/evidence-isolated-auth-web-20260908-v2.json`
