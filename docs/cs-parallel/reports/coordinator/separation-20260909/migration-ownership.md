# 중앙 단독 migration 소유

사용자의 단독 작업 지시로 병행 개발자는 없다. 아래 번호는 Supabase CLI로 임시 staging에서 생성한 뒤 scripts/check-migration-version.mjs로 중복 검사를 통과했다. 중앙 단독 소유이며 다른 작업의 SQL은 수정하지 않는다.

- 20260908170140_isolate_cs_workspace_snapshot.sql: CS 전용 조회, 상품/주문 snapshot 참조 없음. 로컬 개발 대상. 운영 미적용.

- 20260908171055_isolate_commerce_workspace_snapshot.sql: 상품/주문 독립 조회. 기존 accuracy/v2/stock projection을 보존하며 CS 조회 제거. 중앙 단독, 운영 미적용.

- 20260908172414_isolate_cs_reply_draft_queue.sql: CS 답변 초안 전용 큐, lease 및 재실행 방지. 중앙 단독, 운영 미적용.
