# 2026-09-08 쿠팡 CS 운영 read-only 감사 로그

고객 원문, credential 원문, 전체 vendor ID, 외부 주문번호는 출력·저장하지 않았다.

| 검증 | 결과 |
|---|---|
| Supabase project ref | 저장소 원장 `sqaoqucxakebqkiygdxb` 확인 |
| Supabase connector SQL | 권한 거절; 쿼리 미실행 |
| 저장소 `db-baseline-read.mjs` 관리 세션 | `REPEATABLE READ READ ONLY` 성공 |
| active credential | production active 1, not-expired 1, vendor `A*****472`, 필수 필드 존재, seller key verified |
| serverless static egress | Coupang false |
| local CS access/route | access NULL, inquiries.list route total 0 / enabled fresh 0 |
| 현재 Mac egress | SHA-256 `92b235ca02d02c07770e11040965100327ca68fd12cebddb68d31dea6a2b0b01`; 기존 Coupang route hash와 일치 |
| 기존 Coupang routes | 5개 모두 expired, active release mismatch |
| serverless runtime | configured/active, scheduleCount 6, active release `5e4a26367af0518d09c37266d3bb509be53952c6` |
| 운영 CS 신규 migration/RPC | 지정 5개 migration 0, credential/history/verification RPC 모두 absent |
| 과거 provider 성공 | 2026-08-20~26 product NOANSWER 200/0행; call-center NO_ANSWER 200/0행; current credential/seller lineage true |
| 최신 실패 | product ALL 및 call-center 4상태의 2026-08-28 마지막 실패는 static egress |
| 운영 DB Coupang CS | non-demo ticket/message/reply attempt/reply delivery 모두 0 |
| WING 반품 재검증 | 2026-08-10~09-08 반품처리 전체·보상상태 전체, 총 0 |
| production 인증 웹 | JEONGHUN 세션 30분 무활동 로그아웃; 로그인 정보 접근 없이 종료 |
| 통합 담당 3·4차 | 79/79, skip 0, exit 0 |
| 쿠팡 전용+proposal | 52/52, skip 0, exit 0 |
| proposal 단독 | 2/2, skip 0, exit 0 |
| proposal ESLint | exit 0 |
| 003 공통 completion 합성 DB | acceptance 저장→delivery 갱신→child enqueue, 7/7 |
| 003 두 completion 소스 저장 계약 | reply 원응답 보존/list-only sanitizer, 2/2 |
| 007 단일 candidate/provider identity | fall-through 차단·provider-certified only, 6/6 |
| 003+007 보강 집중 회귀 | 15/15, skip 0, exit 0 |

전용 S0 폴더의 공통 묶음 63개 중 1개는 기존 11번가 오류 기대값 차이(`INQUIRY_CHANNEL_UNSUPPORTED` 대 현재 `INQUIRY_PAGE_INVALID:elevenst`)로 실패했다. 같은 공통 시험은 최신 통합 기준에서 통과했으므로 쿠팡 범위에서 수정하지 않았다.
