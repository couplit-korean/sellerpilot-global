# eBay supplemental 03 로컬 통합 결과

최초 제출본과 supplemental 01→02→03의 before/after 해시를 순서대로 대조해 누적 44개 파일과 manifest 4개를 통합했다. 채널 소유권을 확인했으며 다른 채널 파일을 덮어쓰지 않았다. 최초 보고서 경로는 S0 신규 파일임을 별도로 확인했다.

## 실제 반영

- CS 페이지에 eBay 케이스·결제분쟁 실시간 조회와 저장 이력 화면을 연결했다.
- 인증된 계정 선택, 공급자 조회, 안전한 이력 저장, 소유자별 조회 API와 복합 페이지 커서를 연결했다.
- 기능 현황은 조건부 구현으로 표시한다. 운영 적용이나 전체 연동 성공을 주장하지 않는다.
- Supabase CLI로 아래 migration 파일을 순서대로 생성했다. 운영 DB에 적용하지 않았다.
  - `supabase/migrations/20260908135249_ebay_case_dispute_history_ledger.sql`
  - `supabase/migrations/20260908135323_ebay_case_dispute_history_read_v2.sql`
- 격리 DB 및 흐름 시험이 제안 SQL 대신 위 migration 파일 자체를 읽어 실행하도록 변경했다.

## 통합 검토에서 추가한 보완

- 저장 시 만료된 credential과 판매자 검증 시각이 없는 credential을 차단하고 credential을 공유 잠금한다.
- 허용된 필드 이름에 중첩 객체·배열을 넣어 원문을 저장하는 경우와 과도한 길이를 차단한다.
- NULL 조회 제한이 무제한 조회로 바뀌지 않도록 두 읽기 RPC에서 거부한다.
- 화면 API의 조회 제한을 응답 스키마의 최대 50건과 맞췄다.
- 수집·조회 응답의 계정과 종류가 요청과 다르면 화면 데이터로 사용하지 않는다.
- 화면의 GET, ledger, 해시 등 개발용 표현을 사용자에게 필요한 조회·저장 문구로 정리했다.

## 직접 검증

- eBay 전용 TS/MJS와 공통 문의 수집·답변·페이지 회귀: **205/205 통과**, 실패 0, 건너뜀 0, exit 0.
- 전체 TypeScript: `tsc --noEmit --incremental false`, exit 0.
- 변경된 이베이 화면·클라이언트·시험 파일 ESLint: exit 0.
- 원격 호출을 대체한 fixture → 실제 normalizer → sync POST → PGlite migration/RPC → history GET → UI client/schema 흐름을 검증했다. 실제 eBay·운영 Auth·브라우저 검증은 아니다.
- 처음 204개 중 화면 문구를 고정한 시험 1개가 실패했다. 새 문구로 기대값을 갱신하고 계정 오결속 반례를 추가한 최종 묶음이 205/205다.
- 로그: `/tmp/cs-ebay-integrated.tap`.

## 남은 연결과 운영 증거

지속 수집은 담당 작업에서 별도 후속 구현 중이다. 18개월 초기 수집의 31일 창, 최근 창 중첩, Payment Dispute 페이지 커서, 중단 재개와 권한 실패 격리를 공통 scheduler에 연결해야 한다. 현재 수동 sync API를 자동 동기화 완료로 해석하지 않는다.

Commerce 403, Payment Dispute 404는 담당의 이전 실제 관측이며 이번 통합에서 재호출하지 않았다. 실제 운영 migration·API·웹 대조, 승인 고객답변·원격 readback은 미완료다. 커밋·푸시·배포·운영 DB·provider write·credential 변경은 하지 않았다.

최종 파일 해시는 `ebay-supplemental-03-integrated-hashes.json`에 기록했다. 담당의 고정 원본과 통합 담당의 추가 보완을 구분한다.
