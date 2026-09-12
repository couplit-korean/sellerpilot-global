# 2026-09-13 런타임 복구 후속 검증

현재 전체 기능 완료 상태가 아니다. 검증된 내부 오류를 복구하고, 원격 권한과 미적용 확장 기능을 별도로 추적한다. 아래 내용은 이전 전체 채널 보고서의 93개 부재 RPC 시점 이후 기록이다.

## 이번 수정

- 과거 문의 이력의 1440분 주기 요청을 운영 DB가 최대 60분으로 거절했다. 운영 원문 해시를 검증하는 migration으로 `inquiries:history:` 읽기만 하루 간격까지 허용했다. eBay 판매자 결속 키에서도 이력 접두사를 보존한다. 현재 조회/주문 제한, 중복 접수, 미확정 결과 제외는 유지된다.
- Lazada 계정별 주기 접수, CS 범위 상태/가져오기/격리함/복구 준비도, eBay 클레임/분쟁 이력의 실제 원본 DB 계약을 복구했다. 운영 migration 번호·이름·원문 해시를 모두 대조했다.
- 승인된 Mac 문의 읽기 경로가 있어도 Temu의 접수 단계가 cloud static-egress만 요구하던 불일치를 수정했다. 기존 승인 계정·작업자·SHA·IP를 확인하고 접수하며 실제 claim에서 다시 검증한다. cloud 실행 권한은 추가하지 않았다.
- Shopee 반품 목록이 성공적으로 0건일 때 `inquiries` 단계로 전달되지만 저장 시 상세 반품 번호를 요구해 `INQUIRY_RECORD_INVALID:shopee` 500이 반복됐다. 명확한 빈 최종 목록만 0건으로 정규화한다. 누락 목록/잘못된 shop/상세 데이터/다음 페이지가 있는 빈 목록은 거부한다.
- CS 작업자는 토큰 갱신을 durable stage로 저장한 뒤에도 단순 조회 예외를 미확정 외부 쓰기로 분류했다. 저장된 갱신과 실제 미확정 갱신/사업상 쓰기를 구분했다. 기존 미확정 작업 이력을 성공으로 재작성하지 않는다.

## 검증

- 관련 실행 검사 77개 통과: DB 복구/일별 간격 28, eBay 이력 DB 5, eBay 수집/조회 21, CS 작업자 12, Shopee 반품 9, 로컬 접수 2. 로컬 접수 검사에는 15가지 승인/계정/버전/만료 불일치를 포함한다.
- 전체 Next production build와 canonical workspace 검사 통과. 다음 배포는 별도 증거로 기록한다.
- 운영 DB에서 실제 앱의 현재·과거 수집 계획 **194개를 각 호출마다 롤백**하여 검사했다. SQL 오류 0. 이는 provider 호출 완료 또는 실제 큐 적재 증거가 아니다. 이 검사에서 Temu `fixed_egress_required` 2건을 발견하여 후속 수정했다. Lazada의 country binding 확인은 별도로 남는다.
- authenticated 관리자로 scope health 392개, Lazada 계정 1개, 격리함 0건을 읽었다. 복구 훈련은 실제 근거가 없어 ready=false가 맞으며 passed 행을 만들지 않았다.
- 새 private 테이블 9개 RLS와 anon/authenticated 직접 읽기 금지, 신규 service RPC의 제한된 EXECUTE 권한을 운영에서 확인했다.

## 잔여 작업

- 정적으로 추출한 RPC 333개 기준 부재 함수는 **93→79개**. 동적 호출 42곳은 추가 조사 대상이다. 이 수치는 전체 기능 성공률이 아니다. [잔여 계약 목록](20260913-remaining-runtime-contracts.json).
- Lazada Buyer IM 앱 권한과 country binding, eBay Commerce 일반 대화 권한, 11번가 상품 Q&A 오류의 실제 provider 응답 대조가 남아 있다.
- 채널별 게시 소스·추가 CS 이력/채팅/답변 재조회 DB 계약과 실제 상품/답변/송장 readback은 미완료다. 새 상품 등록이나 CS 답변을 검사용으로 보내지 않았다.
- 배포/운영 일정/로컬 버전 전환 및 실제 수집 결과는 아래 후속 증거를 추가한다.

## 적용 migration

| 버전 | 이름 | 원문 SHA-256 |
|---|---|---|
| 20260907060844 | read_lazada_quarantine | `a532507f7c88dee972d62bd1c87360a85ebdcc8c3bf42f3f62408e6f72acce91` |
| 20260907235000 | add_cs_scope_health | `459c0eb56f6aa8d25de50037a6d63595c0286019797eea9e79b80d7c72f19987` |
| 20260908002000 | add_cs_import_staging | `5b5eb0e294e5eb3dd507be477581572a3c82c7c3f7e279f5ca8a8ec5e7ef00f2` |
| 20260908003100 | add_cs_recovery_drills | `83717660ea835a7d9f11c0b2d3b032734f00da91ddb9410b5a3f4e072e7e3dc4` |
| 20260909124048 | cs_lazada_multi_account_scope | `c5aa66e081d2f84a4a5f8a572285357e8dcc7928ef46e9d2cd4abe62d1bdb535` |
| 20260912221516 | allow_bounded_daily_inquiry_repair | `75597f1c0dfdb92dae2912dd7cad5665fc14c63eeeb370501abe155d2504ef47` |
| 20260908135249 | ebay_case_dispute_history_ledger | `c271569f05a2aa83f907da4499bb845ac505eadcd0cdc538b290cccf8e9aed1f` |
| 20260908135323 | ebay_case_dispute_history_read_v2 | `7499cce63d6ee50e0c92948aea4f67c0a1290d169e7edbf9833238aa8bb7d341` |
| 20260909124944 | cs_ebay_case_dispute_durable_collection_v2 | `2b5d66a49b4b02f78fe47ca06b74421ccd334c592f3e4c69c71e926030aab2ec` |
| 20260912223510 | admit_approved_local_inquiry_schedule | `149474730818f3253e3d4d5988f70979e4a447665f52396122239bbf909b3ef0` |
