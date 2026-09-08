# Lazada 인증 raw/quarantine 웹 관측 검증 lazada-007

- 기준: `S0-20260908-decaba426812a3ba`
- 선행 후속 delta: `0e0ec4f3a9d20e4bf86c94baeb29bc59376e6c51b308761d5b0b9c47d4db5ba1`
- 환경: PGlite 격리 DB, 실제 `authenticateAdminRequest`, 실제 exported GET 두 개, synthetic provider 원문만 사용
- 운영/통합 원본 변경: 없음

## 실제 호출 경로

1. `/api/admin/cs/lazada-raw-inbox`와 `/api/admin/cs/lazada-quarantine`의 exported `GET`이 실제 `authenticateAdminRequest(request,{timeoutMs:8000})`를 호출한다.
2. helper는 bearer token을 검증하고 `sellerpilot_is_admin`을 확인한다.
3. GET은 helper가 만든 `userClient.rpc`만 사용한다. `serviceClient`를 읽기 우회에 사용하지 않는다.
4. raw GET은 `sellerpilot_read_lazada_im_raw_inbox_v1`, quarantine GET은 `sellerpilot_read_lazada_quarantine`을 호출한다.
5. 두 RPC는 authenticated role에만 execute를 허용하고 함수 내부에서 `auth.uid()`와 승인 관리자 상태를 다시 확인한다. 원본 테이블은 authenticated/service role에도 직접 공개되지 않는다.

검증한 source SHA-256:

- `lib/admin-api.ts`: `112414081980d7063cba8b73848a81a2638ed11468e62cc0200b9d94a264a7a3`
- raw GET: `74ad1a32c7c2341e55fa569b25568c7193c4e649f9e84270c3f1bb08b524d2cd`
- quarantine GET: `99940ac508333e2052e4a104ee3b0e874fed1dd2a399baefe9fec498a4dc3a6d`
- raw read SQL: `5fe53d61b06c094f101afd2cc814303b57ec29816d6e2e8ec6335b29d26fcc73`
- quarantine read SQL: `a532507f7c88dee972d62bd1c87360a85ebdcc8c3bf42f3f62408e6f72acce91`
- V3 SQL proposal: `b67d6901906ea6022471ba124520ae3a83a17e0708866ede8ab706dd9ddbeed7`

## V3 projection과 웹 표시 결과

- system raw receipt는 V3 system timeline 저장 뒤 `processingStatus=normalized`로 raw GET에 나타났다.
- recall raw receipt는 matching customer projection이 recalled로 바뀐 뒤 `processingStatus=normalized`로 raw GET에 나타났다.
- 같은 ID의 변경 본문 conflict는 V3 `partial`이므로 raw receipt가 `pending`으로 남았고, quarantine GET에는 `reason=conflict`, 정확한 synthetic 원문과 message ID로 나타났다.
- 같은 격리 transaction의 support message를 대조해 system은 `sender_role=system`, recall 대상은 `provider_context.eventKind=recalled`임을 확인했다.
- raw UI는 GET의 `rawBody`를 변형하지 않고 `<pre>`로 표시하며 normalized를 `CS 원장 반영`으로 표시한다.
- quarantine UI는 `reason=conflict`를 `메시지 ID 충돌 · 확인 필요`로 표시한다.

## 거부 결과

- bearer 없음: HTTP 401, RPC 0회.
- 만료 token: HTTP 401, read RPC 0회.
- 다른 owner의 비관리자 로그인: HTTP 403, read RPC 0회.
- 다른 owner credential로 기존 raw receipt를 mark: `LAZADA_IM_RAW_RECEIPT_REQUIRED`.
- 같은 owner지만 다른 seller credential로 기존 ticket에 V3 ingest: `LAZADA_IM_TICKET_LINEAGE_MISMATCH`.
- anon의 두 read RPC 실행과 anon/authenticated/service role의 private table 직접 SELECT: permission denied.

승인 관리자가 원래 데이터 creator와 다른 것은 거부 대상이 아니다. 이 앱은 승인 관리자들이 하나의 CS 운영 workspace를 공유하도록 설계됐다. creator ID는 provenance이며, 비관리자와 credential/seller 계보가 실제 데이터 경계다.

## patch 판정

현재 raw/quarantine 웹 계약에는 production patch가 필요하지 않다. raw inbox의 목적은 exact original과 처리 lifecycle을 보여주는 것이고, quarantine의 목적은 conflict/unverified 원문을 보여주는 것이다. V3 system/recall을 raw receipt별 semantic badge로 추측해 덧붙이면 history page 한 receipt에 여러 메시지가 있는 경우 잘못된 연결이 된다.

향후 raw receipt별 normalized semantic summary가 제품 요구가 되면 다음 공통 변경이 먼저 필요하다.

1. raw receipt와 각 V3 revision을 연결하는 explicit receipt/revision lineage.
2. webhook 한 event와 history page 여러 event를 구분하는 per-event ordinal/native ID binding.
3. 저장과 V3 projection을 같은 owner/credential transaction으로 검증하는 service-only RPC.
4. authenticated reader가 body-free summary만 반환하는 V2 read contract.
5. 이 lineage 없이 raw JSON을 다시 추론해 badge를 만드는 patch는 제출하지 않는다.

이번 범위에서는 누락된 production connection이 재현되지 않아 source patch를 만들지 않았고, 부족했던 실제 helper+GET 통합 회귀시험을 채널 전용 test로 추가했다.
