# DB·채널 복구 최신 체크포인트 — 2026-09-13 16:43 KST

정규 폴더는 `/Users/kimchangheemac/dev/sellerpilot-app` 하나다. 운영 코드 `191e5cc02789d4b1dfdbedb0ae0ad08db07fa510`, Vercel `dpl_8FNnfFXHBU9n1eegYiRU3ztVMPix`, Supabase `sqaoqucxakebqkiygdxb`와 Mac gateway/AI 설치 버전을 맞췄다. 두 GitHub 원격의 `integration-aside`에 푸시했다. 이 문서만 추가한 후속 commit은 운영 코드 SHA와 구분한다.

**DB 함수 이름 누락과 이번에 확인한 작업 수령·결과 저장 결함은 복구했다. 모든 채널의 신규 상품 등록·고객 답변·출고 완료까지 검증한 상태는 아니다.** [현재 운영 증거 JSON](20260913-db-channel-recovery-checkpoint.json)과 [상세 저장 오류 수정](20260913-local-claim-result-storage.md)을 함께 본다. 이전 문서의 누락 96/71개, eBay 승인 대기, gateway degraded 문구는 과거 체크포인트다.

## 복구 결과

| 항목 | 확인한 결과 | 검증의 한계/남은 일 |
|---|---|---|
| DB 계약 | 선행 테이블·현재 함수 본문/권한·실제 상태 CHECK를 검토한 forward migration 적용. 765개 실행 파일의 RPC 664곳에서 확정한 381개 이름은 운영 DB 누락 0 | 동적 호출 38곳은 별도. 이름 존재가 모든 인자·권한·실제 채널 실행 성공을 뜻하지 않음 |
| Gateway | claim 안의 UPDATE를 STABLE 함수가 보지 못하던 가시성 오류 수정. 실제 claim rollback 검증 후 운영 claim HTTP 200/ready | 역사적인 실패·조정 필요 작업은 기록 보존. 모두 성공으로 변경하지 않음 |
| 결과 저장 | Temu seller identity 결속/HTTP schema, Lazada continuation HTTP schema, eBay 긴 시스템 본문·수신자 생략·이중 정규화, 경쟁상품 관찰시각 충돌 수정 | 실제 provider 값이 없는 것을 가격/고객 메시지로 꾸미지 않음 |
| eBay | 동일 판매자의 새 OAuth/Commerce Message 승인 완료. 일반 대화 조회 성공과 DB receipt 확인. 21개 시스템 알림 GET→파서→CS 정규화 통과, DB에는 현재 11건 저장 | 잔여 알림과 과거 이력 수집 계속. 시스템 알림은 고객 문의가 아님. 실제 고객 답변 미발송 |
| Lazada | 최신 IM 토큰 복구·Vault 저장·동일 MY seller 300872000183 확인. 후속 credential v7에 읽기 route 재결속. bootstrap/continuation 두 작업 모두 succeeded+receipt, 시스템 메시지 13건 저장 | 실제 IM grant는 MY만. SG/PH/TH/VN의 상품/계정 권한을 채팅 권한으로 간주하지 않음. reply grant·실제 답변은 별도 |
| Temu | provider mall identity와 DB 인증 seller key를 실제 비교. after-sales 조회 0건을 정상 수집하고 succeeded+receipt 저장. 후속 주기 조회도 성공 | 빈 결과는 문의 부재의 해당 조회 결과. 실제 답변/배송을 검증한 것은 아님 |
| SmartStore·11st·Qoo10·Coupang | CS 하위 유형별 실제 조회와 DB 완료 영수증 확인. 등록 후처리/복구 함수도 선행 계약에 맞춰 복구 | 실제 신규 등록과 buyer-visible 결과는 현재 SHA의 채널별 게시 검증/승인을 별도로 통과해야 함 |
| Shopee | 대표 숍 1개 API 조회 성공. 다른 7개는 invalid_acceess_token 403. 숍별 갱신 lifecycle과 빠진 OAuth 시작/콜백 UI 연결 복구·배포 | 메모의 기존 메인 계정으로 로그인 후 휴대폰 OTP에서 대기. 첫 exact 세션은 교환 전 만료(job 없음). OTP 후 새 세션으로 8개 숍 재인증/각 숍 readback 필요 |

## 실행 위치와 실제 거래 검증

- Vercel: 관리자 화면/API, Supabase 큐/일정, eBay·Qoo10의 허용된 일반 CS 읽기. 이미지/상품 AI는 현재 서버 AI 경로를 사용한다.
- Mac 고정 IP: 활성 credential과 현재 SHA로 승인된 Coupang·11st·Lazada·Shopee·SmartStore·Temu의 진단/문의/주문 읽기. Shopee exact OAuth는 세션 하나에 묶인 별도 일회 실행기다.
- 게시 write route와 새 credential/SHA 승인에는 별도 조건이 있다. 읽기 route 복구로 게시·답변·배송 권한을 자동 확대하지 않았다. 오래된 write route는 증거 JSON에 그대로 기록되어 있다.
- 중앙 DB의 실제 주문은 취소된 Coupang 주문 1건이고, system 외 inbound 메시지는 0건이다. 지금 사용할 출고 대상이나 고객 답변 대상이 확인되지 않았으므로 시험용 메시지·가짜 송장·중복 상품을 만들지 않았다. 외부 seller center의 전체 데이터 부재를 주장하는 숫자는 아니다.

## 효율과 검증

- 과거 보충 이력은 KST 당일 00:00에 조회 기준을 고정했다. 같은 날짜의 hourly catch-up은 같은 `periodicKey`/조회 구간을 사용한다. eBay 시간별 37개 key(하루 최대 888개) 생성 문제를 하루 37개 key로 줄이는 설계이며, 이미 쌓인 대기열을 삭제하지 않았다. 당일 신규 변경은 실제 시각을 사용하는 current sync가 담당한다.
- 이력 중복 재현 테스트는 수정 전 실패, 수정 후 통과. 날짜 경계·현재 조회 분리·Coupang/Qoo10/11st 범위 통합 검사 11개, scheduler 관련 3개, TypeScript 통과.
- Shopee/Lazada exact UI 및 Shopee 계약 39개, 앞선 Lazada/Temu 결과 저장 관련 35개 검사 통과. 전체 저장소 테스트가 모두 통과했다고 합산하지 않는다.
- Vercel 빌드·무작업 canary(claimed 0/processed 0/executed false)·production promotion 완료. 운영 화면에서 무작업 점검 6개 후 Supabase 일정 재시작, 활성 SHA readback 완료. 기본 일정 6개와 CS 자동복구 cron 1개로 총 7개가 활성이다.
- 최신 DB backends 22, 차단 0, 장기 트랜잭션 0, deadlock 0. temporary bytes는 누적 3,014,656 bytes이며 0으로 보고하지 않는다. 이전 운영 배포 05c0bc4의 최근 15분 Vercel error 로그 조회는 0건이었고, 이를 미래 무오류 보장으로 확대하지 않는다.

## 바로 이어갈 작업

1. Shopee 휴대폰 OTP 완료 뒤 기존 메인 계정 4940266의 새 exact 세션 준비 → 전용 실행기 → 동일 8개 숍 grant 비교 → Vault/DB receipt → 각 숍 GET 재검증. 만료 세션/소비된 코드는 재사용하지 않는다.
2. eBay 시스템 알림 21개 중 미저장 건 및 과거 이력 큐를 이어서 검증한다. 새 일별 key는 중복 증식을 막지만 이전 큐가 모두 소진됐다는 뜻은 아니다.
3. Lazada MY 외 국가의 IM 권한 및 답변 권한은 실제 해당 국가 grant를 확보하고 별도로 결속한다.
4. 상품 등록은 승인할 상품·채널 정책·현재 SHA gate와 기존 원격 상품 중복 여부를 확인한 다음 실제 provider 응답/원격 readback을 기록한다. 고객 답변·배송은 실제 대상과 승인된 내용을 확인한 다음 수행한다.
