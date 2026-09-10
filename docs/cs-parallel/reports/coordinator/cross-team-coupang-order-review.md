# CS-CROSS-20260908-02 수신 검토 처리

상품등록 중앙이 쿠팡 007 SQL SHA-256 `83b0c4cecc0a61709e6242dfd86a45787210d1b1e662bea006e422e4376e7592`와 hook 예시를 읽고 회신했다. CS 중앙 한 명이 CS 통합 폴더에서 제안 개발·격리 검증을 수행하는 배분에는 동의했으나, 주문 수집 hook의 최종 공동 통합에는 동의하지 않은 상태다.

검토 의견은 쿠팡 전담 작업에 구체적인 후속 구현으로 전달했다.

1. 검증되지 않거나 만료된 credential 때문에 기존 주문 수집 전체를 rollback하면 주문 동작 변경이다. 주문 수집의 기존 허용 조건을 유지하면서 검증된 provenance만 기록하고 CS exact만 거절하거나 미확정으로 두는 안을 우선 구현한다. provenance 기준을 낮추지 않는다.
2. 현재 hook은 생략부가 있어 적용 가능한 패치가 아니다. 실제 Lazada → Shopee → 최종 upsert 함수의 baseline hash와 완전한 최소 diff를 준비하고 필드·status·반환·기존 오류 동등성을 격리 DB에서 시험한다.
3. `cs_order_binding_is_exact`의 비쿠팡 분기는 현재 통합본의 모든 기존 조건을 보존해야 한다. 기존 함수 전체를 단순 일반 조건으로 바꾸지 않는다.
4. 기존 쿠팡 CS order link 초기화의 영향 범위·격리·재결속 계획과 합성 건수 검증이 필요하다.

`배송 값 전 채널 연동 확인` 작업은 현재 order ingest 담당으로 확인되지 않았다. 그 작업을 임의로 재개하거나 담당 합의가 완료됐다고 간주하지 않는다. 실제 담당과 공동 검토가 끝나기 전 007 order hook은 canonical migration으로 적용하지 않는다. 003 reply readback 및 004/005 history/read migration은 주문 수집 hook과 분리해 로컬 통합·검증했다.

운영 DB·provider·credential·고객 답변·상품등록 원본 폴더 변경은 하지 않았다. 새 패치·검증 증거·담당 정보가 생길 때만 상품등록 중앙에 다시 전달한다.

## Supplement7 후속 수신

새 SQL SHA-256 `d842b4d4278135a777728457be2f2e8a330c7fae1a42bd0038651b924805e776`를 수신했다. 생략 hook과 축약 fixture를 삭제하고, 기존 함수 체인 전체 호출·비쿠팡 정본 위임·provenance 장애의 주문 비간섭·설치 시 일괄 link 변경0을 중앙 PGlite 17/17로 재검증했다. 수정본과 시험을 상품등록 중앙에 공동 검토 요청했다. 현재 공통 hook 승인 또는 canonical 적용이 아니다. 기존 물리 link가 남을 때 실제 CS 읽기 API/목록/상세/AI/health의 exact gate를 확인하는 후속을 쿠팡 담당에게 배정했다.

### CS-CROSS02 두 번째 검토: 미해결 2건과 reader gate

검토본 SHA d842b4d. 상품등록 중앙의 읽기 전용 검토이며 실제 주문 수집 소유자의 최종 승인은 아니다. (1) A 판매자의 기존 exact ledger가 있는 주문을 B가 동일 번호로 갱신하고 B ledger 저장만 실패하면 기존 A ledger를 근거로 잘못 exact 유지 가능. (2) 주문 AFTER trigger의 새 CS reconciler는 predecessor 내부에서 실행되어 뒤쪽 wrapper catch가 보호하지 못한다. CS projection 예외가 정상 주문 수집을 rollback할 수 있다. 두 반례는 기존 17개 시험 범위 밖이며 쿠팡 supplement8 오류주입 수정 대상으로 전달했다. (3) snapshot/reply RPC의 직접 t.order_id 및 AI의 owner/demo만 적용한 주문 context 경로에도 false/unknown read gate가 필요하다. 수정 전 007 hook 정본 통합은 보류한다.
