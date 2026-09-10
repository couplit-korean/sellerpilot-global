# Lazada V3 대화·보관함 투영 상태

- 시각: 2026-09-08 23:47:59 KST
- 기준: `S0-20260908-decaba426812a3ba`
- 보존한 이전 delta: V3 follow-up `0e0ec4f3a9d20e4bf86c94baeb29bc59376e6c51b308761d5b0b9c47d4db5ba1`, authenticated raw GET `44dd39ac3b25f11d684fcf880dc9128fa0fe3d75dca838ba62746d05d6424e48`
- 결과: 현재 actual GET의 회수 전 원문 노출 재현, 최소 공통 SQL/patch 제안, 격리 회귀 15/15 통과
- 공통/운영 변경: 없음
- 최종 통합 preimage 재확인: 2026-09-08 23:54:59 KST. 다른 채널 UI 추가 뒤에도
  제안 patch `git apply --check` exit 0, 대상 Lazada reader/schema는 미반영 상태.

## 실제 판정

1. 통합본 V3 migration은 승인된 V3 SQL과 동일 SHA-256이며 raw/quarantine GET은
   이미 연결돼 있다.
2. 그러나 공통 conversation/archive reader는 V3 revision 상태를 읽지 않는다.
   격리 DB의 현재 실제 exported GET에서 회수 후에도 대화 body와 archive preview가
   회수 전 합성 원문으로 반환됐다.
3. 제안 SQL 적용 후 actual GET 경로에서 recall-before와 recall-after 모두 안내문으로
   마스킹됐고 native media는 제거됐다. archive preview/검색 JSON에도 이전 본문이
   남지 않았다.
4. changed body/attachment는 최신으로 선택하지 않았다. 최초 승인 body를 유지하고
   `conflict_review_required`로 표시한다.
5. unknown-order revision은 대화에 끼워 넣지 않았고, 동일 revision replay는 ledger
   행을 늘리지 않았으며 다른 credential/seller의 recall revision은 정상 메시지를
   가리지 않았다.

## 통합 의존

- `lazada-008-v3-conversation-projection.sql`을 통합 담당 소유의 새 migration으로 배정
- `lazada-008-v3-conversation-projection.patch`를 공통 conversation/archive contract와
  UI에 함께 반영
- SQL만 적용하면 현재 Zod client가 상태 필드를 제거하므로 SQL/patch 동시 통합 필요
- 통합 후 동일 시험을 canonical migration 경로로 다시 실행

## 증거 경계

- 확인: local PGlite, 실제 exported admin GET route, 합성 body/media만 사용
- 미확인: 운영 DB 적용, 배포 UI, 실계정 conversation/archive readback
- 변경하지 않음: commit/push/deploy, 운영 DB/webhook, credential/token, 실제 답변

상세 계약은 `docs/cs-parallel/proposals/lazada/lazada-008-v3-conversation-projection.md`,
명령/결과는 `docs/cs-parallel/reports/lazada/v3-conversation-projection-verification.json`에
기록했다.
