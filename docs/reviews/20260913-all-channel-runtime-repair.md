# 전체 채널 연결 및 기능 점검 — 2026-09-13 07:02 KST

**현재 판정: 판매채널 실제 API 읽기 연결 8/8 통과. 상품 신규 등록·CS 전 범위·배송의 전체 기능 완료는 아니다.**

## 현재 운영 배치

- 개발 원본: `/Users/kimchangheemac/dev/sellerpilot-app`. iCloud Documents와 별개이며 새 채팅·클론·작업 폴더를 만들지 않았다.
- Vercel 실제 운영: `737171efe3fe0dc14cf89ff0ef47a192af231272`, `dpl_7ww7TFyydCeJE32ccS4g4Wh8x58q`. 운영 도메인 promote/inspect, 무작업 점검 6개와 Supabase 활성 SHA·스케줄 6개 대조 완료.
- Mac gateway: 동일 `737171e` / ready=true / 최근 gateway HTTP 200 및 idle 204 확인. 기존 LaunchAgent의 RunAtLoad·KeepAlive·supervisor 재시작을 유지한다. Mac 전원·인터넷·깨어 있는 상태가 필요한 실행 경로다. 유료 Vercel Static IP는 추가하지 않았다.
- SQL 12개를 이번 전체 채널 복구 과정에서 운영에 적용했다: 최초 7개 + 비동기 진단 1개 + eBay 원본 2개 + 로컬 진단 경로 1개 + Temu 조회 계정 결속 1개. 앞선 이미지/DB 최적화 작업의 migration 수와 합산하지 않는다.

## 채널별 결과

|채널|기본 조회 실행 위치|최신 실제 연결 진단 KST|확인된 조회 증거|남은 주요 기능 문제|
|---|---|---|---|---|
|쿠팡|Mac|06:19 통과|상품 목록과 판매자 ID 일치, 주문 조회 성공|현재 CS 수집 범위·답변 로컬 실행·게시/배송 실행 증거 미완료|
|스마트스토어|Mac|06:19 통과|판매자 계정 읽기, 주문·문의 조회 성공|신규 등록 source/transport/completion DB 계약 및 답변 readback 일부 누락|
|11번가|Mac|06:50 통과|API 읽기, 주문 및 일부 문의 조회 성공|일부 문의 조회 원격 오류. 현재 코드에서 주문 상세·송장 전송 미지원. 등록 recovery DB 계약 잔여|
|Shopee|Mac|06:56 통과|판매점 정보, 주문 및 일부 문의 조회 성공|일부 문의 작업 reconciliation_required. Buyer Chat/이력/readback DB 계약 잔여|
|Lazada MY|Mac|06:19 통과|판매자 읽기 및 06:11 주문 조회 성공|Vercel IP whitelist 오류는 Mac 조회로 해소. 채팅/리뷰 권한·CS 최신 수집·등록 receipt DB 계약 잔여|
|Temu|Mac|06:56 통과|상품 목록 읽기, 주문 조회 성공|CS 범위·공식 권한 및 등록 source DB 계약 잔여. 현재 코드에서 CS 답변 미지원|
|Qoo10 Japan|Vercel 중심|06:19 통과|상품 읽기, 주문·문의 조회 성공|등록 fulfillment/recovery와 CS 특수 이력/readback 계약 잔여|
|eBay|Vercel 중심, 기존 복구 worker 별도|06:20 통과|판매자 권한·판매한도, 주문 및 ASQ 일부 조회 성공|게시 recovery/stage DB 복구 완료. 일부 CS 실행503 및 분쟁·이력 계약 잔여|

위 실행 위치는 현재 확인된 **진단·주문·문의 조회 경로**다. 모든 상품 등록·CS 답변·배송 작업이 같은 위치에서 실행 가능하다는 뜻이 아니다. 코드의 adapter 존재, 실행 경로 허용, 현재 배포 승인, 실제 provider 변경과 원격 readback은 각각 별도 기준이다.

## 추가로 수정한 결함

- 45초 HTTP 대기 종료를 실패로 기록하던 진단 API를 202 pending으로 수정했다. 실행 미확인은 503 manual로 구분하며 성공/실패를 추측해 DB에 덮어쓰지 않는다.
- DB atomic completion은 토큰 갱신이 없어도 진단 결과를 기록한다. 정확한 response/diagnostic 일치·claim 소유권·receipt를 유지하고 더 오래된 작업은 최신 진단 요청을 덮어쓰지 않는다.
- 기존 승인된 같은 채널·계정·작업자·egress의 조회 경로에서 진단 경로를 만들고 기존 5분 갱신에 결합했다. 유효한 명시적 disable은 유지한다. 상품/답변/배송 write 경로를 자동 승인하지 않는다.
- Temu 현재 인증키는 9월 12일 공식 계정 인증을 갱신했지만 read route는 이전 seller key를 사용했다. 인증키 ID·version 2·인증시각·old/new key를 모두 고정 검증하여 주문/문의 두 경로만 다시 결속했다. 진단도 새 식별자로 성공했다. listing.create 승인은 변경하지 않았다.
- eBay 원본 `20260910021000` 및 `20260910040000`을 실제 누락 확인, 현재 base column fixture 설치, 관련 검증 후 적용했다. 서비스 전용 RPC 5개 ACL 확인. 기존 게시를 읽기로 복구하는 기능이며 신규 상품을 게시한 것은 아니다.

## 검증 및 미완료 항목

- API·비동기 진단 DB 57/57, 로컬 진단/Temu 정확 결속 DB 11/11, eBay 복구 관련 10/10 통과. 앞선 공통 runtime 80/80·Lazada 12/12 및 4/4 등은 아래 작업 이력에 기록되어 있다. 중복 테스트 수를 합쳐 전체 저장소 통과로 표현하지 않는다.
- 추가 local Next production build 및 Vercel build, canary, production promotion, 실제 domain/Supabase readback 완료.
- [실제 운영 증거](20260913-all-channel-live-evidence.json): 진단 8/8, 최근 주문/문의 성공시각, 잔여 CS 오류를 함께 보존했다. 페이지에서 모두 연결되어 보이는 것만으로 CS·등록·배송 완료라고 판정하지 않는다.
- [잔여 DB 계약 목록](20260913-remaining-runtime-contracts.json): 정적으로 확인한 333개 RPC 이름 중 **93개**가 운영 DB에 없으며, 별도로 동적 호출 42개를 추적해야 한다. 호출 위치·원본 migration·번호 충돌을 기록했다. 원본 목록은 곧바로 일괄 적용해도 된다는 뜻이 아니다.
- Vercel 신규 배포에서도 일부 CS enqueue와 eBay 실행503, 경쟁상품 가격 snapshot 저장503이 남아 있다. 최근 enqueue 오류는 한 번에 failed 168 / total 182까지 관측되어 추가 DB 의존성/재시도 범위 검토가 필요하다. 이 상태를 원활한 전체 운영 완료로 보고하지 않는다.
- 일반 문의 조회가 성공해도 리뷰/채팅/분쟁/과거 이력 범위는 다르다. 상품 신규 등록·자동 답변·실제 송장 전송은 테스트 목적으로 실행하지 않았다. 현재 배포의 write 승인·필수 상품 정책·채널 권한·DB 계약을 충족한 뒤 대상별 provider 응답 및 원격 readback으로 확인해야 한다.

## 이전 작업 이력

아래는 해당 시점의 기록이며 현재 상태는 위 표와 최신 증거가 우선한다.


상태: 운영 DB 공통 병목 복구, 실제 채널 조회 재개. 전체 상품 등록·답변 발송·배송 실행 완료 판정은 아님.

## 대상과 원칙

개발 원본 `/Users/kimchangheemac/dev/sellerpilot-app`, Supabase `sqaoqucxakebqkiygdxb` main Production, Vercel `prj_9fRYsoTT4fD6XVEMe4NX9mpPlljA` / `team_Y4vAMBqZlfQ4gXvkGieFh5aG`. 준비된 Aside 계정을 사용했다. 새 채팅·작업 폴더·worktree를 만들지 않았다. 사용자 PDF 산출물은 변경하지 않았다.

## 원인과 실제 수정

1. 11번가 CS 계정 identity RPC가 누락됐다. 기존 overflow / exact reply observation / multi-account identity migration 3개를 선행 객체·본문 해시와 대조한 뒤 원자적으로 적용했다. 실제 active identity 1개, 서비스/관리자별 ACL 확인.
2. 로컬 read claim에 행 잠금·실행 중인 채널 제외·호출 제한 대기시간 조건이 빠졌다. `SPC02`를 재현하고 FIFO + `FOR UPDATE ... SKIP LOCKED` + 동일 채널 advisory lock으로 수정했다. 승인된 `orders.list`도 수령한다. 현재 실행 중인 작업이나 write 승인은 변경하지 않는다.
3. 완료 context의 `request` 누락으로 11번가 저장 중 `Cannot read properties of undefined (reading arguments)` 500이 반복됐다. 기존 인증/정확한 replay wrapper 결과와 같은 job일 때만 원래 request/environment/started_at를 반환한다.
4. 호출 예산 3개 RPC가 gateway 토큰만 허용해 Vercel `serverless_cs`의 정상 실행 토큰을 거부했다. 두 실행 역할을 허용하되 job.worker_token_id와 토큰 ID를 추가 결속했다. scheduler·타 작업자·만료/잘못된 claim은 계속 거부한다. 429 backoff·write reconciliation은 유지한다.
5. Lazada API가 Vercel 송신 IP를 화이트리스트 위반으로 거절했다. 운영 cloud claimant에서 Lazada를 제외하고 기존 승인된 Mac read 경로로 보냈다. 정책 수정 후 `orders.list`가 21:11:38 UTC에 실제 성공했다. 유료 Static IP를 만들지 않았다.
6. Shopee 다중 숍 provider가 다음 숍의 첫 페이지에 빈 커서를 반환하지만 완료 schema가 거절했다. 실제 provider adapter 결과로 실패를 재현하고, 숍 plan digest와 대상 ID가 결속되고 페이지 상태가 초기화된 전환만 허용했다. 이 코드는 새 배포가 필요하다.
7. RPC inventory가 `.rpc(...)`만 세고 `rpc(...)` callback을 놓쳤다. executable callback도 포함해 759개 source의 549 call / 333개 정적 함수 / unresolved 42곳을 얻었다. 종전 329/96 부재는 과거 시점이다. 정적 이름 존재가 모든 overload/실행 성공을 보증하지 않는다.

## 이번 운영 적용 migration

| version | name | journal 원문 SHA-256 |
|---|---|---|
|20260909105504|cs_elevenst_qna_overflow_observation|e53ee72aed4efdd29ebc6db80f32bc7af5bb5752788d4312fb7d3879dcd2a459|
|20260909112157|cs_elevenst_exact_reply_observation|f1b6711ffc3a148400d00f2fc6e4e089be2975a6d10be641c37d6a4150ce7542|
|20260909121547|cs_elevenst_multi_account_identity|be6677c661bedeece1c1f54a8682abd5337da851b493e8f19f4218b4e95d53c3|
|20260912204232|harden_local_channel_read_claim|359aee558384945f53d34fddd37cf5bc5712ef728d4c8e692e81ece4931db7b1|
|20260912205436|restore_gateway_completion_request_contract|3628ea0cfb12b4d5652d8475dd0f22d53ba7734f1e4c1f769de9fe16b6b87f34|
|20260912205909|bind_provider_budget_worker_scope|54bb5943d614bc0a9cfa0dbf073e8e4aa1cbd47e4dfcdf198ec2e3377153790a|
|20260912210928|route_lazada_to_local_egress|31a3497eb548c435d5a14624f1dc8f5809a3d47b00bffcc5dfbbbb784c64d801|

전체 db push 없이 개별 원문을 검증했다. 전송 byte/hash, guarded preimage, 짧은 lock timeout, 같은 트랜잭션의 journal version/name/hash를 확인했다. 조회 후 blocking 0. 역할 진단은 exception subtransaction과 outer ROLLBACK으로 실제 budget 변경을 남기지 않았다.

## 채널별 현재 증거

시각은 2026-09-12 UTC (한국은 다음날 +9시간). 상품 등록·CS 답변·송장 전송은 이 읽기 검증으로 실행하지 않았다.

|채널|현재 읽기 실행 경로|이번 실제 성공|남은 구분|
|---|---|---|---|
|쿠팡|Mac|주문 조회 21:01:36|등록/답변/출고는 별도 승인·원격 확인 필요|
|스마트스토어|Mac|문의 20:58:43, 주문 21:02:24|등록/답변/출고 완료로 확대 해석하지 않음|
|11번가|Mac|문의 21:06:18, 주문 21:02:07|다른 Q&A 원격 오류 21:06:03 별도 남음; 주문 상세/송장 API 지원 경계 존재|
|Shopee|Mac 중심|주문 20:57:56|문의 다중 숍 완료 schema 수정 배포와 readback 필요|
|Lazada|Mac (클라우드 수령 제외)|주문 21:11:38|문의 IM push/bootstrap 및 답변/등록의 별도 검증 필요|
|Qoo10|Vercel|문의 21:05:03|상품 등록/배송 후처리 누락 RPC 잔여|
|eBay|Vercel|문의 21:05:05|상품 게시 복구 RPC 잔여|
|Temu|Mac|주문 21:02:40|CS 공개 권한/수집 범위와 답변 미지원은 IP 경로와 별개|

## 검증과 한계

- 공통 수령·완료·예산·RPC inventory·Shopee 전환 관련 80/80 통과.
- Lazada routing DB + static egress 관련 12/12 통과, Lazada cloud execution 관련 4/4 통과.
- 11번가 계정/완료 관련 15/15 통과 (별도 실행, 중복 합산하지 않음).
- Lazada egress 변경을 포함한 최종 Next.js production build 성공. workspace 경로 검사 및 diff whitespace 검사 통과.
- 넓힌 기존 serverless/provider 90개에서 10개 실패를 확인했다. 이 중 Lazada ingestion fixture에 명시적 egress를 추가하여 관련 검증은 통과했다. 나머지는 옛 enqueue 수/숍 index/등록 선행 조건 fixture 등을 참조한다. 전체 저장소 검증 통과로 보고하지 않는다.
- 실제 Mac ready=true, 최근 접속200을 확인했다. 빈 대기열에서 기존 게시 복구 RPC 부재로 claim PGRST202가 추가 관측됐다. 누락 함수를 가짜 성공으로 대체하지 않는다.
- 기존 모든 신규 등록 write route가 현재 배포 SHA로 승인됐다고 보지 않는다. 기존 fd426cc 기준 route와 현재 SHA의 차이는 남아 있다. 정식 게시 승인·provider write·상품 원격 readback이 모두 있어야 신규 등록 완료다.

## 남은 내부 복구 범위

상세 inventory의 상품 등록 recovery/producer context 및 CS 이력/가져오기·readback 계약을 의존성 순서로 복구해야 한다. 20260910033000 / 043000 / 050000에는 서로 다른 파일의 번호 충돌이 있어 무조건 전체 적용하면 안 된다. 일반 문의 조회 복구와 특수 이력·분쟁·리뷰·답변 readback 복구는 별개다. 채널 연결 UI의 온라인 표시는 이 기능들의 성공 근거가 아니다.

## 추가 진단 복구 (2026-09-13 06시 이후 KST)

- 운영 Vercel `5ae1ce05f2eb56c5d323b9fe83917b1acb9e7361` / `dpl_5d4HxyRJ12k3ejZkRMyrkZ2EbQFS` 배포 및 활성 SHA·스케줄 6개 확인. Mac gateway도 같은 SHA로 재시작되어 ready=true 확인.
- Temu 진단 job `922a1fe2-0029-49be-a2f0-4c5d1e7aa0ba`는 21:21:19 UTC 실제 성공했지만, 요청 45초 대기 종료가 failed로 기록되고 DB 완료 함수는 토큰 갱신이 있을 때만 진단을 기록하는 결함이 있었다.
- `20260912214500_persist_async_channel_diagnostics.sql` 운영 적용 및 원문 SHA `25f85279e2ef1b566fdd75937902eac56dbe42c1271ae389417c4594e2ce9e73` journal 확인. 기존 원자적 완료 함수의 인증/receipt/타 채널 부수효과를 보존하고 모든 진단을 저장한다. 이전 job이 더 새로운 검사 요청을 덮어쓰지 않는다.
- API는 대기/상태 조회 지연을 HTTP 202 pending으로 반환하며 failed로 기록하지 않는다. 완료된 worker 결과를 다시 기록해 최신 상태를 덮어쓰지도 않는다. 실행 결과 미확인은 503 manual이며 인증 실패로 단정하지 않는다. 이 API 추가 수정은 다음 배포 대상이다.
- 실제 운영 함수 fixture를 실행하는 PostgreSQL 검증 및 9개 채널 진단/API 검증 57/57, 추가 Next.js production build 통과.
- 운영 정적 RPC 재대조: 333개 이름 중 95개 누락. 콜백 별칭·동적 이름은 별도 잔여이며 이 숫자가 전체 누락의 상한은 아니다. 이를 채널 연결 완료와 혼동하지 않는다.
