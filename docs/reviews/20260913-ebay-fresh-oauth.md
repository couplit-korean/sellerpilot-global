# eBay 새 승인과 완료 기록 복구 — 2026-09-13

DB 계약 복구 `3e9373f`는 양쪽 integration-aside에 푸시했고 Vercel dpl_46DxuYcGUJT9obT1Lz7C5vN4cGrw로 승격했다. 후보 무작업 canary 후 운영 도메인 SHA, Supabase 활성 일정 6개, Mac gateway SHA 일치와 ready/claim HTTP200을 확인했다. Mac AI runtime도 기존 키를 유지하며 갱신했다.

이 후속 변경은 **실제 eBay 권한 승인 완료가 아니다.** 새 승인 처리 코드는 배포와 사용자 세션의 실제 공급자 응답 검증 전이다.

- eBay 승인 코드를 일반 CS 조회 대기열에서 기다리게 하지 않고, 관리자·현재 운영 릴리스·서버리스 작업자에 결속된 정확한 1회 claim으로 처리한다.
- 코드 지문을 기존 모든 OAuth 작업과 비교해 같은 코드를 다시 실행하지 않는다. 원문 코드는 Vault와 해당 실행 메모리 안에서만 다룬다.
- 기존 미확정 인증은 새 인증 처리 중 유지한다. 다른 판매자, 다른 작업의 미확정 쓰기, 복구 토큰이나 준비된 후속 키가 있으면 이 경로로 정리하지 않는다.
- 새 provider EIAS 계정 식별자가 이전 판매자와 같아야 최종 Vault 키를 준비한다. 새 완료 결과·불변 receipt가 저장되는 트랜잭션 안에서만 이전 인증을 superseded/cancelled로 정리한다. 이전 토큰 교환이 실패/성공했다고 지어내지 않는다.
- 완료 작업은 worker/claim을 지우므로 후속 확인은 gateway job의 비어 있는 필드 대신 불변 completion receipt의 worker/claim을 사용한다. 운영 DB 롤백 검사에서 이 경계를 검증했다.
- eBay 오류는 invalid_grant 등의 허용된 코드만 저장하고 공급자 자유문·코드·토큰을 로그에 남기지 않는다. 통신/응답 불확실성은 자동으로 해제하지 않는다.

DB migration `20260913052000`을 원문 SHA 대조 후 적용했다. 적용 후 fresh session은 0건이며 이전 OAuth 작업은 reconciliation_required/refreshInFlight=true로 보존된다. 이전 복구 20개와 합쳐 이번 흐름에서 21개를 적용했다.

검증: 집중 테스트 86/86, TypeScript와 production Next.js build 통과. 실제 운영 스키마에서 새 claim, 중복 거부, 잘못된 판매자 거부, 완료 전 정리 거부, 동일 판매자 완료/receipt/이전 인증 정리까지 한 트랜잭션으로 검사하고 **전부 롤백**했다. 공급자 API 호출이나 실제 키 교체는 이 검사에 포함하지 않았다. 추가로 실행한 serverless-gateway-provider 기존 테스트에는 Shopee continuation 2개와 Qoo10 선행 조건 1개 기대값 불일치가 남아 있어 전체 테스트 통과로 표시하지 않는다.

남은 범위: 이 수정의 배포, eBay 새 동의·Commerce Message 최소 읽기, Lazada 국가별 판매자/IM 권한, Temu 실제 after-sales pagination, Shopee 실제 CS 결과, 채널별 상품 등록·답변·배송의 원격 결과와 원장 대조. 실주문·실문의 없는 경우 해당 E2E를 성공으로 만들지 않는다.
