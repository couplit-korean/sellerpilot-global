# Temu owner-bound completion/history chain

- 목적: 최신 통합본의 실제 worker completion POST가 Temu detail retry v1→v2 원장, 같은 job 재예약, 새 claim, atomic completion receipt, 공통 history coverage 기록, 인증 GET까지 한 계보로 이어지게 하고 owner/credential 경계를 닫는다.
- 현재 통합본 preimage: `app/api/channel-gateway/worker/complete/route.ts` `b9a1a5056557e8bf6ef204727af13492e078d8d4b2fd18ff5f1705224f466383`; `app/api/admin/cs/history-coverage/route.ts` `a8faac8ced853a877ec4dcb15fcf5a6f4940d2c5879697e508b709473be2a6fd`; retry v1 migration `13fcd1f2856a7599db6963597e54e71e76b6939fba5cd710bffa2f96be771a2b`; retry v2 migration `d5a06aa35d4ad7a0f9e6ecc300a9ca5aef5acf453eadd09395e22408c8b1255a`; coverage migration `cf1f0941c7cc21b0604ca20d3b817914cb62c07659858d648e7e3e37fbc02c19`.
- 재현된 공통 누락 1: retry v2는 token/job/claim/lease/channel/operation/active credential을 확인하지만 Temu job `created_by`와 credential `created_by` 일치를 직접 검증하지 않는다. 정상 enqueue가 만든 행에는 문제가 없지만 DB drift나 잘못 결속된 기존 행을 자체 거절하는 방어선이 없다.
- 재현된 공통 누락 2: `sellerpilot_read_cs_history_coverage_v1()`은 관리자 인증 뒤 `cs_history_scans`와 `cs_history_scan_gaps`를 owner 조건 없이 최근 100건까지 읽는다. 현재 `/api/admin/cs/history-coverage`도 v1을 인자 없이 호출하므로 owner history GET으로 사용할 수 없다.
- 변경 요청: `sql/temu-009-owner-bound-retry-history.sql`을 새 공통 migration으로 검토한다. Temu gateway job owner/credential trigger, v2 receipt 계약을 그대로 반환하는 owner-bound retry v3 wrapper, 인증 관리자 자신의 scan/gap만 반환하는 coverage v2를 추가하고 direct v1 authenticated grant를 회수한다.
- route 변경 요청: `patches/temu-009-owner-bound-completion-history.patch`처럼 completion POST는 retry v3을 호출하고 history GET은 `admin.user.id`를 v2의 `p_owner_id`로 보낸다.
- 데이터/권한 영향: provider 호출, 답변, 환불, 주문/배송 mutation은 없다. after-sales read-only job만 대상이며 Buyer Chat과 무관하다. 고객 원문·연락처·주소는 migration이나 fixture에 저장하지 않는다.
- 실패/재개 계약: retry 1/2/3은 5/10/20초 `rate_not_before`를 유지한다. HTTP 응답 유실 시 old claim의 동일 fingerprint만 replay되고 retry 횟수는 증가하지 않는다. 3회 뒤 새 claim에서 retry DTO 없는 failed completion이 terminal `failed`와 `retry_exhausted`를 만들며 공통 history gap에 남는다.
- 원자성 경계: 테스트는 receipt나 terminal flag를 수동 삽입하지 않는다. 정본 claim 함수, atomic completion 함수, coverage page 함수가 실제 SQL로 상태와 receipt를 기록한다. 테스트 시간 단축을 위해 각 원장의 예약 간격을 먼저 검증한 뒤 `rate_not_before`만 과거로 이동하여 다음 실제 claim을 허용한다.
- fixture 제한: credential 복호화 view와 inquiry ingest의 격리 capture 등 Temu 외 부수효과만 최소 fixture로 제공한다. retry/claim/completion/receipt/history 함수 자체는 임시 함수로 대체하지 않는다.
- 회귀 명령: `SELLERPILOT_TEMU_INTEGRATED_ROOT=/Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908 /Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node --import tsx --test docs/cs-parallel/proposals/temu/tests/temu-009-owner-bound-completion-history-chain.test.ts`.
- 통합 판정: 제안 SQL과 route patch가 공통 원본에 적용되고 동일 시험이 그 통합본을 대상으로 다시 통과하기 전에는 운영 연결 완료가 아니다.
