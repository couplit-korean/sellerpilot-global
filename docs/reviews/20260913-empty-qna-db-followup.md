# 2026-09-13 11번가 빈 결과 처리와 CS DB 추가 복구

현재 체크포인트는 수정·DB 검증 완료, 새 코드 운영 배포 전이다. 개발 원본은 `~/dev/sellerpilot-app`이며 새 작업공간을 생성하지 않았다.

## 11번가 실제 원인과 수정

활성 couplit 판매자 자격증명으로 2026-09-07~13의 답변 상태 00/01/02를 각각 공식 Product Q&A GET으로 읽었다. 세 응답 모두 HTTP 200, 정상 `productQnas` XML, 원격 `result_code=500`, `result_message=검색된 대상이 없습니다.`, 행 0건이다. 기존 파서는 snake-case 메시지를 누락하고 이 응답을 무조건 실패로 분류했다.

정상 XML·HTTP 200·정확한 메시지·실제 행 없음이 모두 확인된 경우에만 빈 결과로 수락한다. 다른 500, 잘못된 XML/루트, self-closing 상품행, 메시지 누락은 계속 실패한다. 원격 코드 500과 메시지는 보존한다. 수정된 실제 GET 3건은 모두 accepted=true, 정규화 이벤트 0건이다. 과거 실패 잡이나 중앙 보관 문의를 다시 쓰지 않으며, 이 7일 조회 결과를 전체 이력 0건으로 해석하지 않는다.

## 운영 DB 적용

Coupang 공유 관리자 검증/레거시 namespace 2개, Qoo10 history window ledger 1개, Lazada supplemental ledger/ingest/resync/UI scopes 4개를 순서대로 검토·원자 적용했다. 운영 journal의 version/name/원문 SHA-256을 재조회했다. JSON 증거에 7개를 기록했다.

실제 공유 관리자 역할에서 Coupang 최근 7일 상품 문의 검증 조회와 Lazada 추가 이력 조회가 정상 반환된다. Lazada scopes는 accounts=[]이며 국가/권한 결속은 미완료다. 추가 읽기·자동 수집·답변 권한을 임의 생성하지 않았다. 정적으로 확인한 부재 RPC는 79→71개, 동적 호출 미해석 42곳이다. 이는 기능 완성률이 아니며 71개가 모두 독립 결함이라는 뜻도 아니다.

## eBay와 DB 진단

Commerce Message 실제 GET은 권한 부족 HTTP 403이다. 기존 Trading 메시지함은 정상이며 최근 약 1년 13개 창/13페이지에서 메시지 9개(회원 1, 시스템 8)를 확인했다. 시스템 알림을 고객 문의로 합산하지 않는다. 공식 권한 승인 화면까지 준비했으며 최종 동의는 대기 중이다.

Supabase 공식 Management API advisors를 실제 호출했다. security ERROR 0, WARN 139(인증 사용자 definer 함수 137, anon 함수 1, leaked-password protection 1), performance WARN/ERROR 0이다. INFO의 미인덱스 FK 312개 및 unused index 116개는 부하/사용 맥락 검토 대상이다. anon 경고는 queue pulse 함수로, 실제 운영 본문에서 gateway worker token 검사와 빈 search_path를 확인했다. 역할 ACL만 보고 인증 없는 데이터 공개로 단정하거나 실행 권한을 제거하지 않았다. DB 전체 최적화 완료를 뜻하지 않는다.

## 검증과 남은 일

집중 18/18, 11번가 22/22, Lazada 16/16 및 전체 production build 통과. 검사 묶음에 중복이 있으므로 56개의 고유 검사라고 합산하지 않는다. Qoo10 provider total fixture와 11번가 잘못된 계정 식별자 fixture를 현재 계약에 맞췄고 핵심 원격/소유권 실패 검사는 유지했다.

새 코드 커밋·양쪽 integration-aside 푸시, Vercel 후보 canary/승격, Supabase 일정 활성 SHA, Mac gateway 버전, 실제 배포 뒤 11번가 완료 저장을 이어서 확인한다. 상품 신규 등록·CS 답변·배송의 모든 채널 운영 완료 판정은 하지 않는다.
