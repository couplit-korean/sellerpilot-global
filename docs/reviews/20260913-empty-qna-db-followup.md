# 2026-09-13 11번가 빈 결과 처리와 CS DB 추가 복구

11:09 KST 체크포인트: 코드 배포·DB 후속 10개 적용·운영 일정 및 Mac 버전 동기화를 확인했다. 전체 채널 기능 완료 판정은 아니다. 개발 원본은 `~/dev/sellerpilot-app`이며 새 작업공간을 생성하지 않았다.

## 11번가 실제 원인과 수정

활성 couplit 판매자 자격증명으로 2026-09-07~13의 답변 상태 00/01/02를 각각 공식 Product Q&A GET으로 읽었다. 세 응답 모두 HTTP 200, 정상 `productQnas` XML, 원격 `result_code=500`, `result_message=검색된 대상이 없습니다.`, 행 0건이다. 기존 파서는 snake-case 메시지를 누락하고 이 응답을 무조건 실패로 분류했다.

정상 XML·HTTP 200·정확한 메시지·실제 행 없음이 모두 확인된 경우에만 빈 결과로 수락한다. 다른 500, 잘못된 XML/루트, self-closing 상품행, 메시지 누락은 계속 실패한다. 원격 코드 500과 메시지는 보존한다. 수정된 실제 GET 3건은 모두 accepted=true, 정규화 이벤트 0건이다. 과거 실패 잡이나 중앙 보관 문의를 다시 쓰지 않으며, 이 7일 조회 결과를 전체 이력 0건으로 해석하지 않는다.

## 운영 DB 적용

Coupang 공유 관리자 검증/레거시 namespace 2개, Qoo10 history window ledger 1개, Lazada supplemental ledger/ingest/resync/UI scopes 4개를 순서대로 검토·원자 적용했다. 운영 journal의 version/name/원문 SHA-256을 재조회했다. JSON 증거에 7개를 기록했다.

실제 공유 관리자 역할에서 Coupang 최근 7일 상품 문의 검증 조회와 Lazada 추가 이력 조회가 정상 반환된다. Lazada scopes는 accounts=[]이며 국가/권한 결속은 미완료다. 추가 읽기·자동 수집·답변 권한을 임의 생성하지 않았다. 정적으로 확인한 부재 RPC는 79→71개, 동적 호출 미해석 42곳이다. 이는 기능 완성률이 아니며 71개가 모두 독립 결함이라는 뜻도 아니다.

## eBay와 DB 진단

Commerce Message 실제 GET은 권한 부족 HTTP 403이다. 기존 Trading 메시지함은 정상이며 최근 약 1년 13개 창/13페이지에서 메시지 9개(회원 1, 시스템 8)를 확인했다. 시스템 알림을 고객 문의로 합산하지 않는다. 공식 권한 승인 화면까지 준비했으며 최종 동의는 사용자 응답 대기 중이다.

01:26 UTC에 Supabase 공식 Management API advisors를 실제 호출했다(뒤의 추가 3개 migration 이전 검사). security ERROR 0, WARN 139(인증 사용자 definer 함수 137, anon 함수 1, leaked-password protection 1), performance WARN/ERROR 0이다. INFO의 미인덱스 FK 312개 및 unused index 116개는 부하/사용 맥락 검토 대상이다. anon 경고는 queue pulse 함수로, 실제 운영 본문에서 gateway worker token 검사와 빈 search_path를 확인했다. 역할 ACL만 보고 인증 없는 데이터 공개로 단정하거나 실행 권한을 제거하지 않았다. DB 전체 최적화 완료를 뜻하지 않는다.

## 검증과 남은 일

집중 18/18, 11번가 22/22, Lazada 16/16 및 전체 production build 통과. 검사 묶음에 중복이 있으므로 56개의 고유 검사라고 합산하지 않는다. Qoo10 provider total fixture와 11번가 잘못된 계정 식별자 fixture를 현재 계약에 맞췄고 핵심 원격/소유권 실패 검사는 유지했다.

새 코드 커밋·양쪽 integration-aside 푸시, Vercel 후보 canary/승격, Supabase 일정 활성 SHA, Mac gateway 버전, 실제 배포 뒤 11번가 완료 저장을 이어서 확인한다. 상품 신규 등록·CS 답변·배송의 모든 채널 운영 완료 판정은 하지 않는다.

## 11:09 KST 운영 반영과 추가로 발견한 결함

- 앱 `5adbed3b45b6fdfb924c3a0c7de38255aecf0837`: 두 integration-aside에 push 후 Vercel 후보 `dpl_D8Zt1gyMZ1KNF9U9WDbx1qd82k45`를 무작업 canary로 검증하고 운영 도메인에 승격했다. 실제 UI 서버 SHA와 Supabase 활성 SHA가 일치한다. 일정 6개 활성화, Mac `/readyz` ready=true/active=0/HTTP 200 및 같은 SHA를 확인했다. 이후 변경은 DB migration·검사·증거 문서이며 앱 실행 소스는 동일하다.
- **11번가 전체 읽기 경로:** 로컬 XML 수정만으로는 충분하지 않았다. 작업이 succeeded여도 DB 추가 관측 규칙이 accepted=true/code500을 거절해 UI에 옛 오류가 남았다. `20260913015651`은 서비스 전용 writer의 정상 파서·HTTP200·행0 조건에 한해 확인된 빈 결과를 저장한다. 실제 작업 `401e9e7a-7a6d-4f38-bb9a-4f68697724bd`의 원격 응답과 DB 추가 관측 accepted=true/resultCode500/rows0을 확인했다. 공유 관리자 RPC와 Aside 운영 CS 화면에서 Q&A 및 긴급알리미 “원격 0건 확인”이 표시된다. 실패했던 과거 관측은 그대로 남아 있다. 추가 원격파서→DB→GET→렌더 검사 6/6 통과.
- **eBay 인증 갱신과 분쟁 조회 예약:** 실제 run은 v202, 갱신된 실행 job은 v203으로 달라 `EBAY_CASE_DISPUTE_COLLECTION_RUN_BIND_FAILED`로 예약 전체가 rollback됐다. `20260913014625`는 같은 인증된 판매자의 폐기된 credential에 속한 미완료 GET만 취소 사유와 감사기록을 남기고 재수집한다. 외부 쓰기/갱신 중/이미 저장된 페이지/완료 이력/다른 판매자는 보존한다. 17/17 검사, 실제 미완료 읽기 4개 취소 감사기록, 새 v203 예약 2개 수락, 서비스 전용 ACL과 blocking0을 확인했다. 이전 실행은 SIGTERM 이후 강제 종료 없이 배출·재시작됐다. **새 분쟁 root는 아직 queued이며 페이지 저장 완료로 승격하지 않는다.** 일반 대화 권한 403은 이 문제와 별도다.
- **자동 일정의 실제 실패:** cron 활성 여부와 별개로 `internal_schedule_requests_pkey` request_id 중복이 반복됐다. pg_net 현재 번호 1488, 보존된 요청 최대15363이었다. `20260913020457`은 기존 CS wake의 보존 방식과 같이 해결된 옛 요청을 private archive로 옮기고 새 route/시각으로 추적한다. 아직 queued인 다른 요청은 덮어쓰지 않고 전체 새 enqueue를 rollback한다. 오래된 HTTP 응답도 새 요청과 혼동하지 않도록 제거한다. 순서를 임의 되돌리거나 기존 실행 이력을 삭제하지 않는다. 관련 4/4 및 실제 채널 동기화 request1493의 HTTP200/delivered를 확인했다. 이 전달 성공이 모든 채널 업무 완료를 뜻하지 않는다.

처음 검토한 7개에 위 3개를 더해 **이번 재개 작업의 운영 DB 적용은 10개**다. 각 파일의 journal name/version/source SHA와 실제 결과는 같은 이름의 JSON에 기록했다. 마지막 71개 부재 RPC/42개 동적 호출, Lazada 국가·권한 결속, eBay 일반 대화 승인, 현재 세대 분쟁 조회 완료 및 채널별 신규 등록·답변·배송 실제 검증은 남아 있다.
