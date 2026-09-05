SellerPilot 작업을 이 Aside 채팅에서 바로 이어서 실행해 줘. 계획만 제시하고 멈추지 말고, 아래 인계 문서를 먼저 읽고 이미 끝난 수정을 제외한 잔여 작업부터 진행해.

작업 폴더:
`/Users/kimchangheemac/dev/sellerpilot`

먼저 읽을 문서:
1. `/Users/kimchangheemac/dev/sellerpilot/docs/Aside-작업인계-20260905.md`
2. `/Users/kimchangheemac/dev/sellerpilot/AGENTS.md`
3. `/Users/kimchangheemac/dev/sellerpilot/docs/현재상태.md`의 상단 최신 기록
4. `/Users/kimchangheemac/dev/sellerpilot/docs/운영복구-20260905.md`
5. `/Users/kimchangheemac/dev/sellerpilot/docs/계정연결.md`

나는 Aside 안에 필요한 사이트 로그인을 해 두었어. **Aside에서는 CHANGHEE/JEONGHUN Chrome 프로필을 구분하거나 전환하지 말고, 이미 로그인된 사이트별 세션으로 작업해.** 이 지시가 과거 Chrome 프로필 분리 지침보다 우선해. 사이트의 대상 판매자·Vercel 팀·Supabase 프로젝트만 확인해. 실제 인증이 필요한 사이트만 알리고 나머지 작업은 계속해.

코드는 iCloud 밖 `/Users/kimchangheemac/dev/sellerpilot`에서 작업해. 인계 때 realpath·상위 경로·1,371개 파일을 검사했고 iCloud offload 징후 없이 Git과 핵심 파일 읽기가 정상인 것을 확인했어. 예전 Documents 폴더로 돌아가지 마. 시작할 때 현재 경로·브랜치·HEAD·변경 파일만 다시 확인해.

목표는 **상세페이지·이미지 제작, CS 연결, 8채널 상품 업로드, 상품·재고 관리, 주문·배송의 실제 운영 완료**야. 10시간 집중 작업을 목표로 실제 가능한 최대 멀티 에이전트를 써. 앞선 Aside 설치 코드에서는 총괄 1 + 하위 5가 확인됐어. 총괄은 DB·release·통합을 맡고, 나머지는 상세/이미지, CS, 업로드, 상품/재고, 주문/배송으로 나눠. 같은 파일·상품·주문에 쓰기가 충돌하지 않게 담당을 정해.

연결된 ChatGPT에서 기존 Codex와 같은 GPT-6 모델을 실제 선택할 수 있는지 확인하고 사용해. 모델과 하위 작업의 실제 선택값을 확인해서 다르면 알려 줘. 다른 모델을 같은 모델이라고 보고하지 마.

기준 브랜치는 `integration-aside`, 인계 직전 수정 코드는 `687bc0a`야. 이후 문서 커밋이 있을 수 있으니 실제 HEAD를 읽어. 이미 코드 회귀 1,999/1,999와 lint·Vercel 빌드는 통과했고, DB/MJS 15개 실패와 운영 전환·실제 생성·외부 검증이 남아 있어. 테스트 성공을 다시 운영 완료로 계산하지 말고, 인계 문서의 DB 누락 정의·이력 복구와 채널별 조건부터 해결해.

`supabase/migrations/20260903150000_unblock_shopee_second_oauth_deadlock.sql`은 기존 미추적 파일이니 수정·삭제·커밋·적용하지 마. 기존 상품·주문·작업 ID를 먼저 재조회하고 중복 등록·답변·송장을 막아. 유료 Static IP 구매, 기존 앱 연결 해제, 과거 migration 강제 재적용은 하지 마. 실제 고객 답변은 승인된 대상과 내용으로만 보내.

준비된 작업은 계속 실행하고, 외부 심사·권한·실문의·실주문 때문에 대기하는 항목은 정확한 이유와 다음 행동을 남겨. 완료 판정은 실제 결과와 원격 재조회로 해. 현재 코드와 운영 상태는 인계 문서에 적힌 시각 이후 달라졌을 수 있으니 구분해서 갱신해.

먼저 경로/HEAD·로그인 상태·실제 모델/에이전트 수와 담당 배정을 짧게 보고하고 바로 작업을 시작해. 마무리할 때 `docs/현재상태.md`를 갱신하고 필요한 파일만 `origin/integration-aside`에 커밋·푸시한 뒤 코드 저장, 운영 반영, 채널별 외부 완료를 따로 보고해.
