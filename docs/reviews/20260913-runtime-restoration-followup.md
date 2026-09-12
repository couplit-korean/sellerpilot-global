# 2026-09-13 런타임 복구 후속 검증

현재 전체 기능 완료 상태가 아니다. 검증된 내부 오류를 복구하고, 원격 권한과 미적용 확장 기능을 별도로 추적한다. 아래 내용은 이전 전체 채널 보고서의 93개 부재 RPC 시점 이후 기록이다.

## 이번 수정

- 과거 문의 이력의 1440분 주기 요청을 운영 DB가 최대 60분으로 거절했다. 운영 원문 해시를 검증하는 migration으로 `inquiries:history:` 읽기만 하루 간격까지 허용했다. eBay 판매자 결속 키에서도 이력 접두사를 보존한다. 현재 조회/주문 제한, 중복 접수, 미확정 결과 제외는 유지된다.
- Lazada 계정별 주기 접수, CS 범위 상태/가져오기/격리함/복구 준비도, eBay 클레임/분쟁 이력의 실제 원본 DB 계약을 복구했다. 운영 migration 번호·이름·원문 해시를 모두 대조했다.
- 승인된 Mac 문의 읽기 경로가 있어도 Temu의 접수 단계가 cloud static-egress만 요구하던 불일치를 수정했다. 기존 승인 계정·작업자·SHA·IP를 확인하고 접수하며 실제 claim에서 다시 검증한다. cloud 실행 권한은 추가하지 않았다.
- Shopee 반품 목록이 성공적으로 0건일 때 `inquiries` 단계로 전달되지만 저장 시 상세 반품 번호를 요구해 `INQUIRY_RECORD_INVALID:shopee` 500이 반복됐다. 명확한 빈 최종 목록만 0건으로 정규화한다. 누락 목록/잘못된 shop/상세 데이터/다음 페이지가 있는 빈 목록은 거부한다.
- CS 작업자는 토큰 갱신을 durable stage로 저장한 뒤에도 단순 조회 예외를 미확정 외부 쓰기로 분류했다. 저장된 갱신과 실제 미확정 갱신/사업상 쓰기를 구분했다. 기존 미확정 작업 이력을 성공으로 재작성하지 않는다.

## 검증

- 관련 실행 검사 78개 통과: DB 복구/일별 간격 28, eBay 이력 DB 5, eBay 수집/조회 21, CS 작업자 12, Shopee 반품 9, 로컬 접수 2, 등록 IP 경로 1. 로컬 접수 검사에는 15가지 승인/계정/버전/만료 불일치를 포함한다.
- 전체 Next production build와 canonical workspace 검사 통과. Vercel 원격 production build도 통과했다.
- 운영 DB에서 실제 앱의 현재·과거 수집 계획 **194개를 각 호출마다 롤백**하여 검사했다. SQL 오류 0. 이는 provider 호출 완료 또는 실제 큐 적재 증거가 아니다. 이 검사에서 Temu `fixed_egress_required` 2건을 발견하여 후속 수정했다. Lazada의 country binding 확인은 별도로 남는다.
- authenticated 관리자로 scope health 392개, Lazada 계정 1개, 격리함 0건을 읽었다. 복구 훈련은 실제 근거가 없어 ready=false가 맞으며 passed 행을 만들지 않았다.
- 새 private 테이블 9개 RLS와 anon/authenticated 직접 읽기 금지, 신규 service RPC의 제한된 EXECUTE 권한을 운영에서 확인했다.

## 잔여 작업

- 정적으로 추출한 RPC 333개 기준 부재 함수는 **93→79개**. 동적 호출 42곳은 추가 조사 대상이다. 이 수치는 전체 기능 성공률이 아니다. [잔여 계약 목록](20260913-remaining-runtime-contracts.json).
- Lazada Buyer IM 앱 권한과 country binding, eBay Commerce 일반 대화 권한, 11번가 상품 Q&A 오류의 실제 provider 응답 대조가 남아 있다.
- 채널별 게시 소스·추가 CS 이력/채팅/답변 재조회 DB 계약과 실제 상품/답변/송장 readback은 미완료다. 새 상품 등록이나 CS 답변을 검사용으로 보내지 않았다.
- 11번가 상품 Q&A는 여전히 원격 실패한다. 같은 계정 긴급 알리미는 HTTP 200/resultCode 0으로 성공하지만 이는 구매자 Q&A 성공 증거가 아니다. Temu 문의는 승인된 현재 로컬 경로까지 확인했으며 실제 수집 성공은 추가 확인 대상이다.

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

| 20260912224310 | pin_registered_egress_reads_to_local | `9cabbf5624b8d11293ba40bc111cb6a61343b920262bdf310500959d2bb7e020` |

## 배포 후 확인 — 2026-09-13 07:54 KST

- 앱 커밋 `a6efa006fddc95f13a4dcc66fad9f16198a4c3f0`을 origin/couplit 양쪽 `integration-aside`에 푸시했다. Vercel `dpl_33eVSmDoAKpibTa5CvA3ZtqVXAbm`를 production으로 전환했고 실제 운영 도메인 inspect에서 Ready를 확인했다.
- 무작업 배포 점검 claimed=0/processed=0/executed=false, 운영 화면의 6개 일정 점검 통과 후 재시작을 실행했다. 운영 Supabase는 active=true, scheduleCount=6, activeRelease=a6efa00, unsafePendingMutations=0을 반환했다. 과거 reconciliationRequired=30(쓰기 관련 23)은 남아 있다.
- Mac gateway가 activeGatewayJobs=0일 때 버전 파일을 전환하고 정상 SIGTERM으로 재시작했다. 새 readyz는 a6efa00, ready=true, HTTP 200, activeGatewayJobs=1을 반환했다. 기존 런타임 설치를 갱신했으며 새 개발 폴더는 만들지 않았다.
- 실제 DB 완료 기록: Shopee 반품 `a293f3a6-d032-44bb-9ff3-d70b7c6d1234` 및 리뷰 `b953be80-ce0f-4179-95db-8f5b7feb04cd` succeeded. eBay 분쟁 이력과 Qoo10 문의도 succeeded를 확인했다. 이 결과는 전체 기간 수집 또는 고객 답변 전송 완료를 의미하지 않는다.
- 운영 정책 원문과 migration journal을 대조한 뒤 11번째 migration을 적용했다. 쿠팡·스마트스토어·11번가·Shopee·Lazada·Temu 진단/주문/문의 읽기는 Mac 실행으로 고정하고, Qoo10·eBay 읽기의 Vercel 허용은 유지했다. 여섯 채널 각각 세 가지 읽기에는 현재 SHA·만료 조건을 충족하는 로컬 경로가 존재한다. 기존 쓰기 게이트는 변경하지 않았다.
- 배포 전환 직후 구버전 작업자의 claim 401이 19건 있었고 마지막 관측은 07:50:25 KST였다. 재시작한 작업자는 HTTP 200으로 복귀했다. 일정 status의 lastWake=queued는 HTTP 완료 증거와 구분한다.
- 후속 Git 커밋은 DB migration/검사/증거 문서만 포함한다. 운영 앱과 Mac의 실행 SHA는 a6efa00이며 문서 커밋 HEAD와 혼동하지 않는다.

| 기능 실행 위치 | 채널 / 범위 | 남은 경계 |
|---|---|---|
| Vercel | 웹 UI, 작업 접수, 완료 저장, Qoo10·eBay 허용 읽기 | API별 권한과 이력/게시 DB 계약은 개별 확인 |
| Mac gateway | 쿠팡·스마트스토어·11번가·Shopee·Lazada·Temu 진단/주문/문의 읽기 | Mac 가동·현재 배포 SHA·등록 IP·승인 경로 필요 |
| 기존 쓰기 실행 정책 | 상품 게시, CS 답변, 배송 처리 | 별도 승인/원격 재조회 게이트; 이번 읽기 정책으로 개방하지 않음 |

상세 원장과 결과는 [증거 JSON](20260913-runtime-restoration-followup.json)을 따른다. 8/8 기본 진단 통과와 79개 정적 부재 RPC 목록은 서로 다른 검증 범위이며 전체 기능 완료로 합산하지 않는다.
