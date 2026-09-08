# Lazada CS V3 후속 강화 상태

- 시각: 2026-09-08 22:18:37 KST
- 기준 V3 delta: `0a02b66ae1b7feef010044e956b589d757b434ab48ef9370a657066a34c6dabf`
- 결과: 통합 리뷰 2건 수정 완료, PGlite 8/8 및 전체 집중 시험 60/60 통과
- 운영 변경: 없음

## 닫은 결함

1. revision ledger를 payload key denylist에서 제한된 scalar metadata allowlist로 변경했다. unknown key, `extraText`, `attachmentUrl`, nested `{body,url}`은 ledger에 들어가지 않는다. 허용 key도 타입·길이가 틀리면 pending이며 ticket/message/revision을 만들지 않는다.
2. gateway pending fingerprint와 TTL을 job row lock 뒤, direct V3 ingest 전에 검사한다. mismatch·expired·malformed receipt는 `ingestSkipped=true`로 끝나며 ticket/message/revision과 기존 job payload를 바꾸지 않는다.
3. completed replay는 동일 job/claim/worker completion receipt가 있다는 사실만 증명한다. payload digest는 증명하지 않으므로 입력 payload를 무시하고 `replayPayloadIgnored=true`, `replayBasis=gateway_completion_receipt`를 반환한다. 다른 payload replay 전후 DB와 job payload가 불변인 반례가 통과했다.

## 통합 의존

- 통합 담당은 기존 V3 delta 대신 후속 delta의 SQL/test hash를 사용해야 한다.
- completion receipt에 normalized batch fingerprint를 추가하지 않는 한, completed replay를 “이번 payload와 동일한 데이터가 적용됨”으로 표시하면 안 된다.
- parser/2 → 정식 V3 migration → readiness → runtime patch → 집중/공통 회귀 순서는 그대로다.
- provider-certified MY binding, 공개 Push callback/group, remote 13→DB/web 대조, 승인 reply echo는 여전히 외부·운영 조건이다.

## 증거

- 계약과 근거: `docs/cs-parallel/proposals/lazada/lazada-006-v3-ledger-and-pending-hardening.md`
- 시험: `docs/cs-parallel/reports/lazada/v3-followup-verification.json`
- 후속 delta: `docs/cs-parallel/reports/lazada/v3-followup-delta.json`
