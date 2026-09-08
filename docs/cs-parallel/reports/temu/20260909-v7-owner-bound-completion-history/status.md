# Temu CS owner-bound completion/history chain v7

- 기록일: `2026-09-09`
- 기준 S0: `S0-20260908-decaba426812a3ba`
- 전용 폴더/브랜치/포트: `/Users/kimchangheemac/dev/sellerpilot-cs-temu` / `codex/cs-temu-v1` / `3218`
- 동결 기준: V1~V6 제출물 수정 없음
- 공통 원본: `/Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908` 읽기와 시험만 수행, 직접 수정 0건

## 결론

최신 통합본의 실제 completion POST와 현재 canonical retry v1→v2 SQL을 한 PGlite 데이터베이스에 연결했다. 수동 completion receipt, 수동 terminal flag, 전체 chain을 대체하는 임시 retry/claim/completion/history 함수는 사용하지 않았다.

검증된 정상 계보는 다음과 같다.

`Temu 상세 부분 실패 → 실제 completion POST → owner-bound v3 wrapper → canonical v2 retry ledger/같은 job 재예약 → old claim 동일 POST replay → rate_not_before 조기 claim 차단 → canonical claim 새 claim_token 발급 → 실제 succeeded completion POST → canonical atomic completion/receipt → canonical history page record → owner-scoped history GET`

3회 소진 계보도 같은 DB와 실제 POST에서 검증했다. retry 1·2는 `retry_failed`, retry 3은 최종 failed completion에서 `retry_exhausted`가 되고 owner history GET의 미해결 gap으로 남는다.

## 발견하고 고친 공통 경계

현재 retry v2는 worker token, job, claim, lease, Temu read-only operation, active credential을 검증하지만 job `created_by`와 credential `created_by` 일치를 자체 확인하지 않는다. 현재 coverage v1도 관리자 인증 후 owner 필터 없이 전체 scan/gap 최근 100건을 반환한다.

V7 proposal은 다음을 요청한다.

1. Temu gateway job insert/update 시 owner와 credential owner가 다르면 거절하는 trigger.
2. v2 receipt/replay 계약을 유지하면서 owner/credential 일치를 먼저 확인하는 retry v3 wrapper.
3. 인증 관리자 자신의 owner ID만 허용하고 해당 owner scan/gap만 반환하는 coverage v2.
4. completion POST의 v3 호출 및 history GET의 `admin.user.id` 전달.
5. authenticated가 owner filter 없는 coverage v1을 직접 호출하지 못하도록 execute grant 회수.

제안 SQL은 격리 DB에서 실제 적용·실행됐고 route patch는 최신 통합본에 `git apply --check`를 통과했다. 공통 통합본에는 아직 적용하지 않았으므로 운영 연결 완료가 아니다.

## 외부 상태 경계

- 실제 Temu provider 목록/상세 read: 0회
- provider mutation, 환불 승인, 실고객 답변: 0회
- 운영 DB, credential, 배포, commit, push 변경: 0회
- 이번 V7은 Partner 앱·compliance·seller 승인을 다시 조회한 작업이 아니다. 앞선 상태를 현재 확정 상태로 갱신하지 않는다.
- after-sales read-only와 Buyer Chat은 계속 별개다. Buyer Chat 공식 권한/목록·메시지·webhook·history·reply 계약과 실제 왕복은 여전히 외부 조건이며 미완료다.

## 완료와 대기 구분

- 코드/제안 완료: 한 DB actual POST/claim/completion/history GET, old-claim replay, 3회 소진, owner/credential/job 반례, owner별 scan/gap 분리.
- 통합 대기: proposal SQL을 새 공통 migration으로 채택하고 두 route patch를 적용한 뒤 같은 V7 시험 재실행.
- 외부 승인 대기: Temu Partner app 활성, compliance/security 승인, 대상 region/seller와 after-sales read permission, 승인 credential·고정 egress.
- Buyer Chat 대기: 별도 공식 app permission과 API/webhook/reply/history 계약.

## G 상태

- G1 범위·권한: 진행 — after-sales read-only 경계는 유지, 현재 Partner 상태 재조회는 이번 delta 범위 밖.
- G2 로컬: 통과 — 격리 PGlite actual chain 3/3, lint 통과.
- G3 실제 읽기: 외부조건 — provider 호출 없음.
- G4 과거·웹: 진행 — owner history GET chain 검증, 공통 적용 전.
- G5 신규: 진행 — 동일 completion path의 신규 정상 완료는 검증, 실제 신규 provider read 없음.
- G6 답변관측: 외부조건 — after-sales 답변/환불 mutation 차단, Buyer Chat 미계약.
- G7 복구: 통과(로컬) — 부분 실패, old-claim replay, 새 claim, 정상 완료, 3회 소진/gap.
- G8 운영: 외부조건 — migration/route 미적용, 운영 호출·배포 없음.

## 다음 한 행동

통합 담당이 `temu-009-owner-bound-retry-history.sql`을 공통 migration으로 검토 적용하고 `temu-009-owner-bound-completion-history.patch`를 적용한 최신 통합본에서 V7 시험을 다시 실행한다.

