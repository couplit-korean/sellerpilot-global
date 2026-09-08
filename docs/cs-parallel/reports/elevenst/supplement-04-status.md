# 11번가 CS 보완 04 상태

- 보완 델타 ID: `elevenst-supplement-04-20260908`
- S0: `S0-20260908-decaba426812a3ba`
- 동결 선행본: `supplement-03-delta.json` SHA-256 `c743f4fdb8f14401948c2ff830621ad15a7a194a15044502215c26c81890833f`
- `supplement-03`은 수정하지 않았고, 이 델타를 추가로 적용한다.
- 운영 변경: 없음.

## 이번 보완의 결론

1. 통합된 `elevenst-005`의 실제 `runOne` 경로를 재현해, Product Q&A 업무 `resultCode=500`이 job failed 완료 뒤 read-observation 없이 소실되는 결함을 확인했다.
2. exact 11번가 inquiry failed result만 안전하게 운반하고, durable completion 뒤 body-free 관측을 기록하며, 관측 RPC 응답 유실을 동일 인자로 한 번 재시도하는 `elevenst-006`을 제출했다.
3. transport exception은 provider 증거가 아니므로 관측값을 만들지 않는다. failed provider payload의 저장본은 기존 정규화 계약을 사용해 원문·Key를 제거한다.
4. 기존 인증 read-state API를 재사용해 Product Q&A/긴급알리미 원격 상태와 같은 `support_tickets` 원장의 저장 건수를 `/cs` 화면에 분리 표시하는 `elevenst-007`을 제출했다. 중복 API는 만들지 않았다.
5. 업무 500은 원격 0건으로 표시하지 않고 `미확정`으로 표시한다. 정상 Alimi 0건만 원격 0건으로 표시한다.

## 검증 결과

- 최신 통합본에서 006·007 각각 `git apply --check`: 통과
- 006+007 임시 통합본 관련 회귀: 97/97 통과
- 외부 worker route 계약: 13/13 통과
- 전체 TypeScript `tsc --noEmit`: 통과
- 변경 경로 선택 ESLint: 통과
- DB/RPC PGlite: 3/3 통과, projection `storedCount`와 동일 `support_tickets` 집계 일치
- 실제 Next dev 포트 3214: 무인증 401, 잘못된 token 401, 인증 200, UI 렌더 성공, DB read 1, provider/prod DB write 0, 종료 뒤 포트 clean

## 증거 단계와 현재 차단

- 전용 개발 증거: 완료. client 계약, UI, DB 동일 원장 대조, failed runtime 반례/회귀가 있다.
- 통합 증거: 004 migration과 005 patch는 통합 담당 로컬 루트에 반영되어 있다. 006·007은 이번 제안이며 아직 통합되지 않았다.
- 운영 DB/배포 증거: 없음. migration/코드는 production에 적용하거나 배포하지 않았다.
- provider 증거: 이번 보완에서는 provider나 Seller Office를 다시 조회하지 않았다. 동결된 실제 증거상 Product Q&A 현재/30일 요청은 HTTP 200 뒤 업무 `500`으로 원격 0건이 아니며, Alimi만 30일 GET `result_code=0`, 0건이다.
- 응답 증거: 승인 티켓/문구가 없어 provider write와 고객 답변·readback은 0건이다.
- 전체 CS 잔여: SellerTalk은 세션 전용 최대 3개월, 리뷰는 Seller Office/export 후보이며 공식 읽기/답변 API 미확인 상태다. 상품 Q&A도 실제 성공 read와 판매자센터 동일 행 대조가 남아 있어 완료가 아니다.

## 통합 순서

1. `supplement-04-delta.json`의 전용 파일을 반영한다.
2. 최신 preimage를 확인하고 `elevenst-006-failed-read-observation-runtime.patch`를 적용한다.
3. `app/cs/channels/elevenst/read-state.tsx`와 client 계약이 존재하는 상태에서 `elevenst-007-cs-read-state-panel-common.patch`를 적용한다.
4. supplement-04 시험 묶음과 실제 인증 스모크를 다시 실행한다.

동결된 supplement-03, 공통 통합 루트, 운영 DB 및 provider 상태는 수정하지 않았다.
