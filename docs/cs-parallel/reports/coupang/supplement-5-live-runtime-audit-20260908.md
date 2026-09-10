# 쿠팡 CS 5차 보완: 운영 read-only 실행 경계 감사

- 시각: 2026-09-08 23:08 KST
- S0: `S0-20260908-decaba426812a3ba`
- 운영 DB: Supabase `sqaoqucxakebqkiygdxb`
- 실행: management API의 `REPEATABLE READ READ ONLY` SQL만 사용
- 변경: 운영 DB/provider/credential/route/job/reply/order/claim mutation 0

## 권한·credential·출구

- production Coupang active credential은 정확히 1개이고 미만료다.
- Vault 원문을 출력하지 않은 집계에서 access key, secret key, vendor ID, requested-by가 모두 존재한다.
- seller account key는 존재하고 검증 시각이 있다.
- vendor mask는 실제 WING 표시와 같은 `A*****472`다.
- 현재 Mac egress SHA-256 `92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01`은 기존 Coupang local route의 egress hash와 일치한다.
- 기존 Coupang local route 5개는 모두 만료됐고 active release와 불일치한다. `inquiries.list` route는 0개다.
- DB access 결과 `local_channel_executor_access('coupang','inquiries.list') = NULL`.
- serverless static egress policy는 Coupang `false`다.
- serverless runtime은 configured/active이고 active release는 `5e4a26367af0518d09c37266d3bb509be53952c6`이지만, 이는 Coupang 허용 출구 성공을 뜻하지 않는다.

## 운영 OpenAPI·DB 현재 상태

- 마지막 성공 상품 문의: `2026-08-20~2026-08-26`, `NOANSWER`, HTTP 200, provider 0행.
- 마지막 성공 고객센터 문의: 같은 기간, `NO_ANSWER`, HTTP 200, provider 0행.
- 두 성공은 현재 active credential ID와 current seller account key에 모두 일치한다.
- 상품 `ALL`과 콜센터 `NONE/ANSWER/NO_ANSWER/TRANSFER`의 2026-08-28 마지막 시도는 static egress 분류 실패다.
- 반품·취소·교환 운영 gateway job은 없다.
- 운영 Coupang non-demo ticket, inbound message, reply attempt, reply delivery는 모두 0이다.
- 상품/콜센터별 오래된 queued job이 각 3개 남아 있으나 2026-08-30 이후 완료되지 않았다. 이를 최신 조회나 신규 수신으로 세지 않았다.

## migration·웹

- 운영 migration 목록에 `20260908000000`, `20260908001000`, `20260908002000`, `20260908047000`, `20260908047100`이 없다.
- credential binding, history-start/history-page, channel verification read RPC도 운영에 없다.
- `JEONGHUN` 프로필에서 운영 SellerPilot을 열었으나 30분 무활동 자동 로그아웃 상태였다. 비밀번호를 읽거나 자동 로그인하지 않았고 검증용 탭은 닫았다.
- 따라서 운영 DB의 0건을 인증된 production 웹 표시와 이번 실행에서 대조하지 못했다. 격리 PGlite→인증 route의 합성 검증과 운영 DB 집계는 서로 다른 증거다.

## 로컬 보완

- 기존 worker/adapter를 복제하지 않고 `coupang:inquiries.list`만 exact local read route로 허용하는 proposal `coupang-008`을 추가했다.
- SQL은 운영 function/constraint MD5를 고정하고 route constraint/access만 넓힌다. route insert/update, job enqueue, credential read, provider call은 없다.
- JS patch는 read-only tuple 한 줄과 deny 회귀만 제안한다. 답변·주문·배송·상품등록 tuple은 열지 않는다.

## 검증

- 통합 담당 3·4차: 79/79, skip 0, exit 0.
- 쿠팡 전용 전체와 proposal 계약: 52/52, skip 0, exit 0.
- proposal 단독: 2/2, skip 0, exit 0.
- proposal 시험 ESLint: exit 0.
- 공통 묶음을 전용 S0 폴더에서 실행한 63개 중 1개는 기존 11번가 기대값 스냅샷 차이로 실패했다. 현재 통합 기준 폴더의 같은 공통 시험은 통합 담당 검증에서 정상 통과했으며 쿠팡 변경으로 수정하지 않았다.

## 통합 결함 보강

- proposal 003의 trigger 앞에 실제 공통 delivery ledger와 acceptance tracking trigger를 합성 DB로 재현하고 source job을 `running → succeeded` completion update로 바꿨다. `steps[0].data.sellerpilotReplyAcceptance`가 원형으로 저장되고 delivery `succeeded/provider_accepted`와 같은 transaction의 `call-center-detail` child 한 건까지 연결됐다.
- 일반 worker completion은 reply result를 그대로 `p_response_payload`에 넘기고, serverless completion sanitizer는 list 두 종류에만 적용함을 소스 계약과 기존 functional assertion으로 확인했다.
- NULL request kind가 SQL 3값 비교를 빠져나가던 조건을 명시적으로 차단했다. ticket source credential, source/ticket/credential seller key, production environment, provider-certified credential, owner 불일치도 completion rollback과 child 0건으로 고정했다.
- proposal 007 candidate의 비정상 분기 세 곳에 `RETURN`을 추가했다. `legacy_unknown`, `cross_vendor_collision`, `vendor_mismatch`는 각각 정확히 한 행만 반환한다.
- `credential_incarnation_v1`은 credential마다 임의로 생성되는 lineage이므로 실제 Coupang vendor 동일성 근거에서 제외했다. recorder/candidate/exact validator는 provider-certified, verified, production, active/grace, unexpired credential만 허용한다.
- 보강 집중 회귀 15/15, 쿠팡 전용 전체 52/52, ESLint exit 0.

## 결론

- 로컬 전용 구현과 제출 가능한 공통 변경안: 완료.
- WING의 현재 전체 상태 읽기: 완료.
- fresh OpenAPI→DB→인증 웹: 미완료. 현재 안전 경로가 없고, 운영 migration/route/job 변경은 사용자 금지 범위다.
- 실제 신규 문의: 관측 대상 없음.
- 실제 답변: 승인 티켓·문구가 없어 실행하지 않음.
- 핵심 문의 완료와 쿠팡 전체 완료: 둘 다 아직 아님.
