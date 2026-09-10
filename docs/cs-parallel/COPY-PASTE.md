# 채팅창별 복사 지시문

0번은 통합 담당에게, 1~8번은 각 채널 전용 채팅에 각각 붙여 넣는다. 각 블록은 단독 실행에 필요한 공통 규칙을 포함한다. 문서 작성 시점의 S0·전용 폴더 미준비 상태를 완료로 가정하지 않는다.

## 0. 통합 담당

[텍스트 원본](prompts/00-coordinator.txt)

```text
SellerPilot CS 통합 담당 지시문

너는 8개 채널 CS 작업의 시작본·공통 코드·DB·통합 검증 담당이다. 각 채널 구현은 별도 채팅이 맡는다. 사용자는 커밋·푸시 없이 로컬 검증을 먼저 하라고 했다. 이미 구현한 부분을 보존하며 채널 하나씩 실제 검증 가능한 결과를 완주하도록 통합해라.

1. 기준과 먼저 읽을 문서
- 기준 폴더: /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908
- 기준 HEAD: 3cb72144e991626fae98a30cf51022d9a1aa6b0b. 미커밋 변경도 시작본이다.
- 원래 Documents 폴더와 /tmp의 동명 폴더는 이번 통합 기준이 아니다.
- /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/AGENTS.md
- /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/README.md
- /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/ownership.json
- /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/TEMPLATES.md
- /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/channels/ 아래 8개 계획
- 사용자의 커밋·푸시 금지가 AGENTS의 기존 closeout보다 우선한다.

2. 첫 작업: 공통 시작본 S0와 8개 전용 폴더
- 지시문 작성 시점에는 S0와 8개 전용 폴더가 아직 없다. 현재 상태를 읽고 준비돼 있으면 검증·재사용해라. 무조건 재생성하지 마라.
- 최초 점검의 변경 227개는 당시 값이다. 현재 diff·신규·삭제를 다시 확인하고 작성 중인 파일을 함부로 덮어쓰지 마라.
- commit/stash/reset 없이 HEAD와 tracked 변경, 필요한 untracked 소스·시험·migration·문서를 보존해 S0를 만들어라.
- 파일별 hash·삭제·실행 비트·HEAD·스냅샷 ID를 기록한다. 원본 변경 전후 hash를 대조해 복사 중 다른 수정이 들어온 경우 다시 확인한다.
- .git 자체, .env, 브라우저/인증 자료, 실고객 원문, 비밀값, 빌드 결과, node_modules, 임시 로그를 복제 묶음에서 제외한다. 필요한 설정 템플릿과 익명 fixture의 누락 여부는 확인한다.
- 원래 저장소의 다른 작업을 지우거나 원래 브랜치를 전환하지 마라.
- ownership.json에 지정된 8개 workdir/branch를 동일 S0로 준비한다. 다른 작업이 사용 중인 폴더·브랜치는 덮어쓰지 않는다.
- Node 22·동일 lockfile을 쓰고 각 폴더의 빌드 결과·DB·포트를 분리한다. 대용량 build/전체 DB suite는 동시에 하나만 돌린다.
- 로컬 앱에 운영 DB를 넣거나 scheduler/worker를 자동 실행하지 마라. 집중 DB 시험은 격리 PGlite, 실제 인증 UI/다중 세션은 별도 격리 환경을 사용한다.
- 8개 폴더 내용과 S0 manifest를 대조한 뒤에만 snapshotId/workspacesPrepared를 갱신한다.
- 첫 결과로 S0 ID·8개 경로·복제 검증 결과를 보고해라. 초기 전체 검사만 반복하느라 시작본 준비를 뒤로 미루지 마라.

3. 소유권과 공통 변경
- inquiry-sync/reply/coverage, reply-verification, protocols, sync-arguments, gateway/serverless, 공통 OAuth/credential, 공통 archive/history/UI, SQL migration과 설정은 네 소유다.
- 채널별 허용 파일은 ownership.json을 따른다. 채널 폴더의 소유 파일을 동시에 수정하지 말고 수정 요청으로 조정해라.
- 채널 보고서와 proposals는 각 전용 폴더의 docs/cs-parallel/reports/<channel>/, proposals/<channel>/에서 읽는다.
- 요청을 받을 때 before hash·인터페이스·fixture·최소 변경안을 확인하고 공유 파일 변경은 한 번에 하나씩 통합한다.
- 채널 함수는 필요한 부분만 분리한다. 새로운 대형 프레임워크나 전체 재작성으로 범위를 늘리지 마라.
- 공통 요청 우선순위: 실제 읽기/웹 차단 → 오연결·손실 → 중복 답변 → 과거 누락 → 추가 기능.
- 진행 중 채널 폴더에 새 통합본을 통째로 복사하지 마라. 공통 인터페이스 갱신은 별도 버전/patch와 변경 영향으로 전달한다.

4. 지금 확인된 통합 잔여
- 현재 날짜 지정 과거수집 UI는 쿠팡·스마트스토어·11번가뿐이다. 나머지 채널의 고정 기간/shop별 planner와 history route/DB/UI를 연결해라.
- 최근30일/1년 복구와 제공 가능한 전체 이력의 분모를 구분하고 scan·page·cursor·gap·재개를 같은 범위에 결속해라.
- provider ACK와 원격 답변 관측을 구분한다. 불확실 답변은 자동 재송신하지 않는다.
- 계정/shop/kind별 권한·키 만료·수집 실패가 다른 scope 성공으로 가려지지 않게 해라.
- 상품/재고/주문/배송 mutation이 CS에서 발생하지 않는 경계를 유지해라.
- 11번가 seller는 couplit/커플릿이다. Chrome 계정 이메일과 혼동하지 마라.

5. SQL
- 여러 채널 SQL이 같은 sellerpilot_service_ingest_inquiries를 rename/wrap한다. 파일명 충돌뿐 아니라 함수 preimage·순서·ACL 충돌을 확인해라.
- 기존 22개 프리플라이트는 11번가 20260908049000을 포함하지 않는다. 현재 migration 의존 집합과 해시를 새로 확정해라.
- 실제 파일 번호는 너만 배정하고 scripts/check-migration-version.mjs로 검증한다.
- 공통 RPC·RLS·GRANT·SECURITY DEFINER·search_path, 공유 관리자/소유자·credential 변경과 이전 8채널 행을 함께 시험한다.
- 현재는 운영 적용하지 않는다. 운영 상태는 version·name·source hash와 실제 객체를 읽기 대조하는 데 사용한다.

6. 통합과 검증
- S0 대비 채널 delta만 받아라. HEAD diff에는 기존 미커밋 변경이 섞이므로 통합본 전체 덮어쓰기는 금지한다.
- 채널 반영 → 관련 공통 검사 → 다른7개 최소 fixture smoke 순으로 진행한다.
- 쿠팡 핵심 흐름을 첫 통합 대상으로 우선한다. 실제 차단이 있으면 이미 읽기를 통과한 채널을 먼저 끝낸다.
- 각 채널 집중 시험은 담당에게 맡기고 전체 TS/MJS/build:vercel은 통합 후보에서 실행한다. 로그를 파일로 남겨 결과가 잘려서 재실행하는 낭비를 막아라.
- 알려진 실패도 이름·환경·동일 소스/기준 비교로 구분한다. 이전 실패 숫자만으로 회귀가 없다고 하지 마라.
- 실제 DB multi-session·RLS·인증 UI 결과를 PGlite만으로 통과했다고 하지 마라.

7. 외부 작업과 보고
- 판매자 Chrome은 CHANGHEE, Vercel/Supabase는 JEONGHUN. 프로필 목록을 읽기 확인하고 seller/team/project를 확인한다. 준비된 세션과 기존 승인을 재사용한다.
- 고객 답변·외부 알림 전송은 승인된 대상/내용이 있을 때만 한다. 현재 코딩용 자동 시험에서 실고객 답변을 보내지 마라.
- 커밋·푸시·배포·운영 DB 변경은 하지 마라. 운영 적용을 위한 정확한 소스·migration·scope·rollback은 준비한다.
- 44.2%는 운영 완성도가 아니다. G1 범위/권한, G2 로컬, G3 실제읽기, G4 과거/웹, G5 신규, G6 답변관측, G7 복구, G8 운영을 채널별 증거로 보고해라.
- 문서 정리만 반복하지 말고 S0 준비와 첫 채널의 실제 검증 가능한 통합 결과를 우선 완성해라.
```

## 1. 쿠팡 CS

[텍스트 원본](prompts/01-coupang.txt)

```text
SellerPilot 쿠팡 CS 전담 지시문

너는 쿠팡 CS만 맡는다. 과거 자료 수집, 신규 수신, 웹 조회, 지원되는 답변과 원격 반영 확인, 중복 방지·장애 복구를 이 채널 안에서 끝까지 책임져라. 기존 구현을 재사용하고 계획 설명에서 멈추지 말고 실제 조사·수정·검증을 진행해라.

1. 기준과 시작 절차
- 공통 시작본 원본: /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908
- 전용 개발 폴더: /Users/kimchangheemac/dev/sellerpilot-cs-coupang
- 예약 브랜치: codex/cs-coupang-v1; 포트: 3211.
- 원본 HEAD: 3cb72144e991626fae98a30cf51022d9a1aa6b0b 및 미커밋 변경. HEAD/main만 복제하면 현재 CS 코드가 빠진다.
- 먼저 다음 문서를 읽어라:
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/AGENTS.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/README.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/ownership.json
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/channels/coupang.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/TEMPLATES.md
- 통합 담당이 만든 S0 ID와 자기 폴더 파일 해시를 검증해라. 준비돼 있으면 재사용한다.
- 아직 준비되지 않았으면 통합 원본은 읽기만 하고 공식 계약/계정/권한 조사와 첫 실제 읽기 준비를 진행해라. 8개 채팅이 각자 다른 시작본을 만들지 마라.
- S0 전에 조사 산출물이 필요하면 /Users/kimchangheemac/dev/sellerpilot-cs-handoff/coupang/에 자기 자료만 기록하고, S0 후 자기 reports 경로로 옮겨라. 비밀·실고객 원문은 넣지 마라.

2. 현재 구현과 범위
상품 문의와 콜센터 문의의 조회·답변, 반품/취소/교환 읽기 adapter 및 DB 후보가 있다. 최근 30일 복구는 6일 이하 5개 창 × 8종 초기 작업 40개로 구현돼 있다. 운영 계정·권한·실제 수집 전량·답변 관측은 완료 증거가 없다.

필수 조사 범위: 상품 문의 / 콜센터 문의의 전체 상태·재문의·이관 / 반품·취소·교환 상담 맥락. WING CS 메뉴를 대조해 후기 등 추가 필수 기능 존재를 확정한다. 클레임 조회를 환불·교환 승인으로 확대하지 않는다.
이 상태는 계획 작성 당시 기록이다. 실제 계정·권한·건수는 현재 다시 읽어 확인해라.

3. 실행 순서
1. COUPANG-01 — 판매자/vendor ID, 활성 credential 계보, 허용 고정 IP와 실행 출구를 대조한다. 이전 상품 등록 제한이 CS 읽기도 막는다고 추정하지 말고 상품 문의 읽기 1회로 범위를 확인한다.
2. COUPANG-02 — 같은 기간·상태의 상품 문의, 콜센터 문의, 반품, 취소, 교환을 각각 읽는다. 0건도 scope별로 기록하고 다른 종류의 성공으로 가리지 않는다.
3. COUPANG-03 — provider 응답의 문의 ID·주문 ID·콜센터 부모 답변 ID를 익명 fixture와 비교한다. latest inbound와 단 하나의 actionable parent가 일치할 때만 답변 대상으로 만든다.
4. COUPANG-04 — 최근 30일 다섯 창을 먼저 완주하고, provider가 제공하는 가장 오래된 기간까지 종료일을 뒤로 이동해 반복한다. 시간대·창 경계·콜센터 네 상태·교환 nextToken 누락을 검증한다.
5. COUPANG-05 — 격리 DB의 원장·공통 웹 화면에서 기간/종류/주문 연결/이력 역할을 대조한다. 운영 데이터는 읽기 검증과 구분한다. 공통 UI/DB 문제는 통합 요청한다.
6. COUPANG-06 — 상품문의와 콜센터 문의 각각 외부 선답변·새 재문의·이관을 시험한다. 실제 답변이 승인되면 채널 반영을 다시 읽고 정확한 inbound를 해결한다.
7. COUPANG-07 — 첫 핵심 완료 증거를 제출하고 추가 메뉴·보존기간 밖 export를 마무리한다. 송장·주문 상태 변경·환불 승인은 다른 업무로 유지한다.

첫 제출물: 첫 제출물은 상품/콜센터 두 종류의 실제 읽기 결과표와 한 종류의 fixture→DB→웹 경로다. 기존 코드 전면 재작성은 하지 않는다.

4. 파일 소유권
자기 worktree에서 다음 기존 파일만 직접 수정할 수 있다.
- lib/channels/coupang-inquiries.ts
- lib/channels/coupang-inquiry-history.ts
- tests/coupang-after-sales.test.ts

새 코드는 ownership.json의 coupang 전용 위치만 허용된다.
- lib/channels/cs/coupang/, lib/cs/channels/coupang/
- app/cs/channels/coupang/, app/api/admin/cs/channels/coupang/
- tests/cs-coupang-*.test.ts 또는 .test.mjs, tests/fixtures/cs/coupang/
- scripts/cs-coupang-*.ts 또는 .mjs
- docs/cs-parallel/reports/coupang/, proposals/coupang/

공통 요청 대상: inquiry-sync/reply 분기, 30일 history RPC, 고정 egress 허용표, capability/scope-health, 공통 웹 필터. SQL 08047000·08047100은 읽기 참조만 한다.
- inquiry-sync/reply, protocols, gateway/serverless, 공통 UI/history, OAuth·credential, supabase/migrations, package/lockfile/설정, 다른 채널 코드는 직접 수정하지 마라.
- 필요하면 자기 proposals/coupang/에 현재 경로/함수/hash·재현 입력·기대 출력·최소 patch·회귀 시험·DB 초안을 작성하고 전용 개발을 계속해라.
- 요청서를 작성했다는 이유만으로 공통 연결 완료로 보고하지 마라. 통합본에 실제 반영된 결과를 검증해라.
- 상품 등록·재고·주문 상태·송장 전송 코드는 수정하지 않는다. CS의 주문/배송 맥락은 정확한 소유자/외부 주문번호 읽기 연결로만 사용한다.

5. 과거 전체와 유지 연동
- seller/app/country/shop/kind/상태/폴더별 최초 제공일과 고정 from/to·timezone을 기록해라.
- 최근30일/1년 복구를 과거 전체로 부르지 마라. 공급자 허용 창/페이지로 최초 제공 범위까지 이어가고 저장과 cursor 전진을 원자적으로 처리해라.
- 원격 고유 행을 정상/중복·기존/격리/근거 있는 제외/미처리로 대조해라. 티켓 수와 메시지 수는 별도다.
- 0건은 동일 계정·기간·상태로 검증하고, missing total은 unknown으로 유지해라.
- 빈 페이지+next, 반복 cursor, 반환상한, 중단 재개, 같은 창 재수집, 계정/shop 혼선, 늦은 답변, 새 문의 도착을 검증해라.
- API 밖 자료는 실제 공식 export/백업을 확인한다. 없으면 복구 불가 기간으로 남기고 가상 자료나 임의 parser로 완료를 만들지 마라.
- 미지원/권한대기 기능도 잔여 범위에 남긴다. 수동 수입/판매자센터 이동을 자동연동 100%에 합산하지 마라.

6. 검증
채널이 작성한 시험과 다음 관련 시험을 실행한다. 공통 시험 파일은 실행 가능하지만 수정은 통합 담당 소유다. Node 22/tsx와 저장소 lockfile을 따른다.

node --import tsx --test tests/coupang-after-sales.test.ts tests/inquiry-sync-contract.test.ts tests/inquiry-reply.test.ts tests/cs-history-channel-db.test.mjs


필수 반례: 콜센터 배열 역순·여러 actionable parent·새 재문의 도착·다른 vendor 주문번호·6일 경계·nextToken 반복·클레임 전화/주소 제외·같은 창 재수집·불확실 답변 재전송 0.

격리 DB에서 provider fixture→정규화→저장→인증 UI를 검증한다. 실제 provider GET 결과를 격리 DB에서 확인하는 경우 권한이 확인된 최소 자료만 사용하고 원문을 Git/공유 보고서에 넣지 않는다. 관리자 권한 해제·세션 만료·다른 seller/shop 데이터 혼선도 확인한다. 타입검사/수정 파일 린트는 이 worktree에서 수행하며 .next와 테스트 출력은 공유하지 않는다.

완료 판정: 모든 조사된 필수 종류·전체 상태·조회 가능한 전체 기간의 원격 ID와 원장/웹 대조, 두 답변 유형의 원격 관측, 중복 0, 신규/복구 증거가 있어야 채널 완료다.

추가 실행 규칙:
- Node 22와 기존 lockfile 사용. Next 코드를 쓸 때 설치된 node_modules/next/dist/docs의 관련 가이드를 먼저 읽어라.
- 로컬 앱은 격리 DB만 연결한다. 실제 provider 읽기는 범위가 고정된 수동 읽기 경로로 수행한다.
- 자기 채널 집중 시험/수정 파일 린트/타입 검사를 우선하고 전체 저장소 build/전체 DB suite 반복은 통합 담당에 맡겨라.
- 로그는 자기 경로에 저장하고 종료코드/소스 hash를 기록한다. 새 실패를 이전 baseline으로 단정하지 마라.
- 자기 포트/프로세스만 제어하고 다른 채널 서버나 공유 worker를 종료하지 마라.

7. 로그인과 실행 제한
- 준비된 판매자 로그인은 재사용한다. Chrome 사용 시 CHANGHEE 프로필을 read-only 목록으로 확인한 뒤 대상 seller/app/shop을 확인한다. Chrome 이메일과 판매자 ID는 별개다.
- 다른 채팅 탭의 이동·로그아웃·계정 전환 금지. Vercel/Supabase·저장 credential/refresh·공용 webhook 주소 변경은 통합 담당과 조정한다.
- 비밀번호·API 키·고객 원문을 문서/fixture/로그/소스에 기록하지 않는다.
- 커밋·푸시·배포·운영 DB 변경 금지. 로컬 우선이라는 사용자 지시가 기존 AGENTS closeout보다 우선한다.
- 실제 고객 답변은 승인된 티켓/내용이 있을 때만 전송한다. 승인 전에도 답변 코드·모의 응답·중복 방지·실행 준비는 완료해라.
- 이미 허용된 로컬 작업·읽기는 반복 허가를 묻지 말고 진행해라. 외부 인증이 필요하면 정확한 항목만 알리고 독립 가능한 작업은 계속해라.

8. 제출과 종료
- 자기 reports/coupang/status.md와 delta.json에 시작본 ID, 변경 파일 before/after hash, 명령/종료코드/로그를 기록해라.
- 공통 시작본 S0 이후 자기 delta만 제출한다. 통합본 전체 복사나 HEAD 기준 전체 diff 제출 금지.
- G1 범위·권한 / G2 로컬 / G3 실제읽기 / G4 과거·웹 / G5 신규 / G6 답변관측 / G7 복구 / G8 운영을 각각 통과·진행·미시험·외부조건으로 보고해라.
- 첫 읽기, 원장 저장, 웹 표시, provider 접수, 원격 답변 관측은 서로 다른 결과다.
- 남은 작업은 code/권한/공식계약/운영적용/자료부재로 구분하고 다음 한 행동을 적어라.
- 한 기능이 막혀도 다른 허용 작업은 계속해라. 기능을 숨기거나 근거 없는 백분율로 완료를 선언하지 마라.
```

## 2. 스마트스토어 CS

[텍스트 원본](prompts/02-smartstore.txt)

```text
SellerPilot 스마트스토어 CS 전담 지시문

너는 스마트스토어 CS만 맡는다. 과거 자료 수집, 신규 수신, 웹 조회, 지원되는 답변과 원격 반영 확인, 중복 방지·장애 복구를 이 채널 안에서 끝까지 책임져라. 기존 구현을 재사용하고 계획 설명에서 멈추지 말고 실제 조사·수정·검증을 진행해라.

1. 기준과 시작 절차
- 공통 시작본 원본: /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908
- 전용 개발 폴더: /Users/kimchangheemac/dev/sellerpilot-cs-smartstore
- 예약 브랜치: codex/cs-smartstore-v1; 포트: 3212.
- 원본 HEAD: 3cb72144e991626fae98a30cf51022d9a1aa6b0b 및 미커밋 변경. HEAD/main만 복제하면 현재 CS 코드가 빠진다.
- 먼저 다음 문서를 읽어라:
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/AGENTS.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/README.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/ownership.json
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/channels/smartstore.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/TEMPLATES.md
- 통합 담당이 만든 S0 ID와 자기 폴더 파일 해시를 검증해라. 준비돼 있으면 재사용한다.
- 아직 준비되지 않았으면 통합 원본은 읽기만 하고 공식 계약/계정/권한 조사와 첫 실제 읽기 준비를 진행해라. 8개 채팅이 각자 다른 시작본을 만들지 마라.
- S0 전에 조사 산출물이 필요하면 /Users/kimchangheemac/dev/sellerpilot-cs-handoff/smartstore/에 자기 자료만 기록하고, S0 후 자기 reports 경로로 옮겨라. 비밀·실고객 원문은 넣지 마라.

2. 현재 구현과 범위
상품 문의와 네이버페이 고객 문의 수신·답변 및 과거 정규화가 있다. 고객 문의는 상품·배송·반품·교환·환불·기타 분류를 포함한다. 날짜 지정 30일 복구 UI가 있다. 톡톡과 리뷰는 현재 별도 미연결이다.

필수 조사 범위: 상품 문의 / 네이버페이 고객 문의 / 톡톡 / 상품 리뷰·답글. 클레임 관련 고객 문의는 기존 customer API 분류로 처리하고, 실제 주문 클레임 승인 업무와 구분한다.
이 상태는 계획 작성 당시 기록이다. 실제 계정·권한·건수는 현재 다시 읽어 확인해라.

3. 실행 순서
1. SMARTSTORE-01 — 실제 스마트스토어 계정과 credential의 판매자/애플리케이션/허용 IP를 대조한다. 브라우저 로그인 성공을 API 허용으로 보지 않는다.
2. SMARTSTORE-02 — 상품 문의와 고객 문의를 같은 종료일로 각각 조회해 questionId와 inquiryNo를 구분한다. 주문 연결은 원격 주문 참조와 소유자가 모두 맞을 때만 한다.
3. SMARTSTORE-03 — 두 종류의 전체 상태·조회 가능 최초일을 기록하고 30일 고정 창을 뒤로 이동한다. 과거 판매자 답변은 최신 고객 문의 본문을 덮어쓰지 않게 보존한다.
4. SMARTSTORE-04 — 웹 검색·종류/기간 필터·대화 새로고침·주문 맥락과 원격 ID를 대조한다. 공통 history UI가 실제 scan 완료와 일치하는지 확인한다.
5. SMARTSTORE-05 — 답변 신규/수정/이미 외부 답변/새 고객 문의를 재현한다. 승인된 실제 답변 후 대상 문의의 provider 상태·본문을 다시 읽어 확인한다.
6. SMARTSTORE-06 — 톡톡·리뷰는 공식 해당 제품 문서와 실제 판매자 계정의 제공 권한을 별도로 조사한다. Commerce 문의 API 목록 부재만으로 네이버 모든 공식 제품에서 불가능하다고 결론내리지 않는다.
7. SMARTSTORE-07 — 공식 계약과 자격이 있으면 전용 adapter·이력·답변 verifier를 구현한다. 없으면 실제 공식 export 원본/이동 경로를 제공하되 실시간 자동연동 미완료로 남긴다.

첫 제출물: 첫 제출물은 상품/고객문의 각각 실제 API 읽기와 과거 기간 분모다. 톡톡/리뷰 조사 때문에 기존 두 기능 완주를 미루지 않는다.

4. 파일 소유권
자기 worktree에서 다음 기존 파일만 직접 수정할 수 있다.
- lib/channels/smartstore-inquiries.ts
- lib/channels/smartstore-inquiry-history.ts

새 코드는 ownership.json의 smartstore 전용 위치만 허용된다.
- lib/channels/cs/smartstore/, lib/cs/channels/smartstore/
- app/cs/channels/smartstore/, app/api/admin/cs/channels/smartstore/
- tests/cs-smartstore-*.test.ts 또는 .test.mjs, tests/fixtures/cs/smartstore/
- scripts/cs-smartstore-*.ts 또는 .mjs
- docs/cs-parallel/reports/smartstore/, proposals/smartstore/

공통 요청 대상: 상품/customer reply builder·normalizer, 기존 history RPC, capability 표, 공통 기간/종류 UI. OAuth·허용 IP·credential 저장 및 상품등록 스마트스토어 파일은 통합 담당 소유다.
- inquiry-sync/reply, protocols, gateway/serverless, 공통 UI/history, OAuth·credential, supabase/migrations, package/lockfile/설정, 다른 채널 코드는 직접 수정하지 마라.
- 필요하면 자기 proposals/smartstore/에 현재 경로/함수/hash·재현 입력·기대 출력·최소 patch·회귀 시험·DB 초안을 작성하고 전용 개발을 계속해라.
- 요청서를 작성했다는 이유만으로 공통 연결 완료로 보고하지 마라. 통합본에 실제 반영된 결과를 검증해라.
- 상품 등록·재고·주문 상태·송장 전송 코드는 수정하지 않는다. CS의 주문/배송 맥락은 정확한 소유자/외부 주문번호 읽기 연결로만 사용한다.

5. 과거 전체와 유지 연동
- seller/app/country/shop/kind/상태/폴더별 최초 제공일과 고정 from/to·timezone을 기록해라.
- 최근30일/1년 복구를 과거 전체로 부르지 마라. 공급자 허용 창/페이지로 최초 제공 범위까지 이어가고 저장과 cursor 전진을 원자적으로 처리해라.
- 원격 고유 행을 정상/중복·기존/격리/근거 있는 제외/미처리로 대조해라. 티켓 수와 메시지 수는 별도다.
- 0건은 동일 계정·기간·상태로 검증하고, missing total은 unknown으로 유지해라.
- 빈 페이지+next, 반복 cursor, 반환상한, 중단 재개, 같은 창 재수집, 계정/shop 혼선, 늦은 답변, 새 문의 도착을 검증해라.
- API 밖 자료는 실제 공식 export/백업을 확인한다. 없으면 복구 불가 기간으로 남기고 가상 자료나 임의 parser로 완료를 만들지 마라.
- 미지원/권한대기 기능도 잔여 범위에 남긴다. 수동 수입/판매자센터 이동을 자동연동 100%에 합산하지 마라.

6. 검증
채널이 작성한 시험과 다음 관련 시험을 실행한다. 공통 시험 파일은 실행 가능하지만 수정은 통합 담당 소유다. Node 22/tsx와 저장소 lockfile을 따른다.

node --import tsx --test tests/inquiry-sync-contract.test.ts tests/inquiry-reply.test.ts tests/cs-history-channel-db.test.mjs


필수 반례: questionId/inquiryNo 충돌·기존 판매자 이력 보존·날짜 창 경계·외부 답변 수정·새 문의와 답변 경쟁·다른 판매자 동일 주문번호·같은 창 중복·톡톡을 고객문의로 위장 금지.

격리 DB에서 provider fixture→정규화→저장→인증 UI를 검증한다. 실제 provider GET 결과를 격리 DB에서 확인하는 경우 권한이 확인된 최소 자료만 사용하고 원문을 Git/공유 보고서에 넣지 않는다. 관리자 권한 해제·세션 만료·다른 seller/shop 데이터 혼선도 확인한다. 타입검사/수정 파일 린트는 이 worktree에서 수행하며 .next와 테스트 출력은 공유하지 않는다.

완료 판정: 상품·고객 문의의 이력과 답변을 각각 닫고 톡톡·리뷰까지 요청 범위대로 연결되어야 채널 전체 완료다. 두 API만 통과하면 핵심 2종 완료로 보고한다.

추가 실행 규칙:
- Node 22와 기존 lockfile 사용. Next 코드를 쓸 때 설치된 node_modules/next/dist/docs의 관련 가이드를 먼저 읽어라.
- 로컬 앱은 격리 DB만 연결한다. 실제 provider 읽기는 범위가 고정된 수동 읽기 경로로 수행한다.
- 자기 채널 집중 시험/수정 파일 린트/타입 검사를 우선하고 전체 저장소 build/전체 DB suite 반복은 통합 담당에 맡겨라.
- 로그는 자기 경로에 저장하고 종료코드/소스 hash를 기록한다. 새 실패를 이전 baseline으로 단정하지 마라.
- 자기 포트/프로세스만 제어하고 다른 채널 서버나 공유 worker를 종료하지 마라.

7. 로그인과 실행 제한
- 준비된 판매자 로그인은 재사용한다. Chrome 사용 시 CHANGHEE 프로필을 read-only 목록으로 확인한 뒤 대상 seller/app/shop을 확인한다. Chrome 이메일과 판매자 ID는 별개다.
- 다른 채팅 탭의 이동·로그아웃·계정 전환 금지. Vercel/Supabase·저장 credential/refresh·공용 webhook 주소 변경은 통합 담당과 조정한다.
- 비밀번호·API 키·고객 원문을 문서/fixture/로그/소스에 기록하지 않는다.
- 커밋·푸시·배포·운영 DB 변경 금지. 로컬 우선이라는 사용자 지시가 기존 AGENTS closeout보다 우선한다.
- 실제 고객 답변은 승인된 티켓/내용이 있을 때만 전송한다. 승인 전에도 답변 코드·모의 응답·중복 방지·실행 준비는 완료해라.
- 이미 허용된 로컬 작업·읽기는 반복 허가를 묻지 말고 진행해라. 외부 인증이 필요하면 정확한 항목만 알리고 독립 가능한 작업은 계속해라.

8. 제출과 종료
- 자기 reports/smartstore/status.md와 delta.json에 시작본 ID, 변경 파일 before/after hash, 명령/종료코드/로그를 기록해라.
- 공통 시작본 S0 이후 자기 delta만 제출한다. 통합본 전체 복사나 HEAD 기준 전체 diff 제출 금지.
- G1 범위·권한 / G2 로컬 / G3 실제읽기 / G4 과거·웹 / G5 신규 / G6 답변관측 / G7 복구 / G8 운영을 각각 통과·진행·미시험·외부조건으로 보고해라.
- 첫 읽기, 원장 저장, 웹 표시, provider 접수, 원격 답변 관측은 서로 다른 결과다.
- 남은 작업은 code/권한/공식계약/운영적용/자료부재로 구분하고 다음 한 행동을 적어라.
- 한 기능이 막혀도 다른 허용 작업은 계속해라. 기능을 숨기거나 근거 없는 백분율로 완료를 선언하지 마라.
```

## 3. Qoo10 CS

[텍스트 원본](prompts/03-qoo10.txt)

```text
SellerPilot Qoo10 CS 전담 지시문

너는 Qoo10 CS만 맡는다. 과거 자료 수집, 신규 수신, 웹 조회, 지원되는 답변과 원격 반영 확인, 중복 방지·장애 복구를 이 채널 안에서 끝까지 책임져라. 기존 구현을 재사용하고 계획 설명에서 멈추지 말고 실제 조사·수정·검증을 진행해라.

1. 기준과 시작 절차
- 공통 시작본 원본: /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908
- 전용 개발 폴더: /Users/kimchangheemac/dev/sellerpilot-cs-qoo10
- 예약 브랜치: codex/cs-qoo10-v1; 포트: 3213.
- 원본 HEAD: 3cb72144e991626fae98a30cf51022d9a1aa6b0b 및 미커밋 변경. HEAD/main만 복제하면 현재 CS 코드가 빠진다.
- 먼저 다음 문서를 읽어라:
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/AGENTS.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/README.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/ownership.json
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/channels/qoo10.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/TEMPLATES.md
- 통합 담당이 만든 S0 ID와 자기 폴더 파일 해시를 검증해라. 준비돼 있으면 재사용한다.
- 아직 준비되지 않았으면 통합 원본은 읽기만 하고 공식 계약/계정/권한 조사와 첫 실제 읽기 준비를 진행해라. 8개 채팅이 각자 다른 시작본을 만들지 마라.
- S0 전에 조사 산출물이 필요하면 /Users/kimchangheemac/dev/sellerpilot-cs-handoff/qoo10/에 자기 자료만 기록하고, S0 후 자기 reports 경로로 옮겨라. 비밀·실고객 원문은 넣지 마라.

2. 현재 구현과 범위
MSG·HELP·ITEM 문의 수신/답변과 S1/S2/S3 조회, GetClaimInfo_V3 클레임 읽기 및 최근 이력 복구가 있다. 긴 대화·별도 리뷰는 미확정/미지원으로 남아 있다. 일반적인 날짜 지정 과거수집 버튼은 현재 없다.

필수 조사 범위: MSG·HELP·ITEM 각각의 문의 / 취소·반품·교환·미수취·부분환불 클레임 맥락 / 판매자 채팅·긴 대화 / 리뷰·댓글.
이 상태는 계획 작성 당시 기록이다. 실제 계정·권한·건수는 현재 다시 읽어 확인해라.

3. 실행 순서
1. QOO10-01 — 국가/판매자 계정과 QAPI credential을 대조하고 실제 MSG·HELP·ITEM 화면의 문의번호·순번·상태 의미를 확인한다.
2. QOO10-02 — S1/S2/S3를 각각 고정 기간으로 수집한다. 반환 상한·페이지 제공 여부·전체 건수 부재를 확인하고 날짜를 더 잘게 나누어 포화된 하루 구간도 미완료로 추적한다.
3. QOO10-03 — 문의번호와 순번의 관계를 실제 긴 대화로 대조한다. 동일 질문의 여러 메시지인지 독립 문의인지 근거 없이 ticket ID를 변경하지 않는다. 변경이 필요하면 이전 원장 호환안을 통합 담당에 제출한다.
4. QOO10-04 — 클레임은 GetClaimInfo_V3 요청일/상태와 주문번호 계보를 유지한다. 목록 배열과 ClaimInfo envelope, 상태 변동·반복 조회를 전량 대조한다.
5. QOO10-05 — 현재 6일/일일 30일 복구 이외에 사용자가 고정한 과거 전체 기간을 공급자 허용 범위로 나누는 계획 함수를 제출한다. 공통 UI/DB에서 재개·gap을 보여주도록 요청한다.
6. QOO10-06 — 일반 문의에만 답변을 허용하고 질문/순번/최신 inbound가 맞는 원격 답변을 재조회한다. 클레임을 상담 답변 endpoint로 보내지 않는다.
7. QOO10-07 — 리뷰와 별도 채팅의 공식 QAPI/파트너 계약·판매자 화면을 대조한다. 공식 API가 없으면 실제 export 자료를 확인해 수입 adapter를 만들고 자동연동 제한을 명시한다.

첫 제출물: 첫 제출물은 실제 문의 3종과 클레임의 범위별 수량/종료 계약표다. 상품번호나 기존 상품 게시 상태를 CS 연결 증거로 사용하지 않는다.

4. 파일 소유권
자기 worktree에서 다음 기존 파일만 직접 수정할 수 있다.
- lib/channels/qoo10-inquiries.ts
- tests/qoo10-claims.test.ts

새 코드는 ownership.json의 qoo10 전용 위치만 허용된다.
- lib/channels/cs/qoo10/, lib/cs/channels/qoo10/
- app/cs/channels/qoo10/, app/api/admin/cs/channels/qoo10/
- tests/cs-qoo10-*.test.ts 또는 .test.mjs, tests/fixtures/cs/qoo10/
- scripts/cs-qoo10-*.ts 또는 .mjs
- docs/cs-parallel/reports/qoo10/, proposals/qoo10/

공통 요청 대상: Qoo10 정규화는 현재 inquiry-sync.ts에 있으므로 전용 추출/수정안을 제출. history UI/scan 실행·reply verifier·SQL 08048000·공용 protocols/qoo10.ts는 통합 소유다.
- inquiry-sync/reply, protocols, gateway/serverless, 공통 UI/history, OAuth·credential, supabase/migrations, package/lockfile/설정, 다른 채널 코드는 직접 수정하지 마라.
- 필요하면 자기 proposals/qoo10/에 현재 경로/함수/hash·재현 입력·기대 출력·최소 patch·회귀 시험·DB 초안을 작성하고 전용 개발을 계속해라.
- 요청서를 작성했다는 이유만으로 공통 연결 완료로 보고하지 마라. 통합본에 실제 반영된 결과를 검증해라.
- 상품 등록·재고·주문 상태·송장 전송 코드는 수정하지 않는다. CS의 주문/배송 맥락은 정확한 소유자/외부 주문번호 읽기 연결로만 사용한다.

5. 과거 전체와 유지 연동
- seller/app/country/shop/kind/상태/폴더별 최초 제공일과 고정 from/to·timezone을 기록해라.
- 최근30일/1년 복구를 과거 전체로 부르지 마라. 공급자 허용 창/페이지로 최초 제공 범위까지 이어가고 저장과 cursor 전진을 원자적으로 처리해라.
- 원격 고유 행을 정상/중복·기존/격리/근거 있는 제외/미처리로 대조해라. 티켓 수와 메시지 수는 별도다.
- 0건은 동일 계정·기간·상태로 검증하고, missing total은 unknown으로 유지해라.
- 빈 페이지+next, 반복 cursor, 반환상한, 중단 재개, 같은 창 재수집, 계정/shop 혼선, 늦은 답변, 새 문의 도착을 검증해라.
- API 밖 자료는 실제 공식 export/백업을 확인한다. 없으면 복구 불가 기간으로 남기고 가상 자료나 임의 parser로 완료를 만들지 마라.
- 미지원/권한대기 기능도 잔여 범위에 남긴다. 수동 수입/판매자센터 이동을 자동연동 100%에 합산하지 마라.

6. 검증
채널이 작성한 시험과 다음 관련 시험을 실행한다. 공통 시험 파일은 실행 가능하지만 수정은 통합 담당 소유다. Node 22/tsx와 저장소 lockfile을 따른다.

node --import tsx --test tests/qoo10-claims.test.ts tests/channel-pagination.test.ts tests/inquiry-sync-contract.test.ts tests/inquiry-reply.test.ts tests/cs-history-channel-db.test.mjs


필수 반례: S1/S2/S3 합집합·중복 순번·하루 반환상한 포화·배열/envelope 차이·클레임 동일 주문의 여러 요청·상태 수정·요청일 경계·수취인/주소/구매자 ID 제외·잘못된 순번 답변 차단.

격리 DB에서 provider fixture→정규화→저장→인증 UI를 검증한다. 실제 provider GET 결과를 격리 DB에서 확인하는 경우 권한이 확인된 최소 자료만 사용하고 원문을 Git/공유 보고서에 넣지 않는다. 관리자 권한 해제·세션 만료·다른 seller/shop 데이터 혼선도 확인한다. 타입검사/수정 파일 린트는 이 worktree에서 수행하며 .next와 테스트 출력은 공유하지 않는다.

완료 판정: 질문 3종·클레임·긴 대화의 중복/누락을 해소하고 리뷰 요구까지 해결해야 채널 전체 완료다. 비공개 API를 추정해 호출하거나 임의 HTML parser로 완료 표시하지 않는다.

추가 실행 규칙:
- Node 22와 기존 lockfile 사용. Next 코드를 쓸 때 설치된 node_modules/next/dist/docs의 관련 가이드를 먼저 읽어라.
- 로컬 앱은 격리 DB만 연결한다. 실제 provider 읽기는 범위가 고정된 수동 읽기 경로로 수행한다.
- 자기 채널 집중 시험/수정 파일 린트/타입 검사를 우선하고 전체 저장소 build/전체 DB suite 반복은 통합 담당에 맡겨라.
- 로그는 자기 경로에 저장하고 종료코드/소스 hash를 기록한다. 새 실패를 이전 baseline으로 단정하지 마라.
- 자기 포트/프로세스만 제어하고 다른 채널 서버나 공유 worker를 종료하지 마라.

7. 로그인과 실행 제한
- 준비된 판매자 로그인은 재사용한다. Chrome 사용 시 CHANGHEE 프로필을 read-only 목록으로 확인한 뒤 대상 seller/app/shop을 확인한다. Chrome 이메일과 판매자 ID는 별개다.
- 다른 채팅 탭의 이동·로그아웃·계정 전환 금지. Vercel/Supabase·저장 credential/refresh·공용 webhook 주소 변경은 통합 담당과 조정한다.
- 비밀번호·API 키·고객 원문을 문서/fixture/로그/소스에 기록하지 않는다.
- 커밋·푸시·배포·운영 DB 변경 금지. 로컬 우선이라는 사용자 지시가 기존 AGENTS closeout보다 우선한다.
- 실제 고객 답변은 승인된 티켓/내용이 있을 때만 전송한다. 승인 전에도 답변 코드·모의 응답·중복 방지·실행 준비는 완료해라.
- 이미 허용된 로컬 작업·읽기는 반복 허가를 묻지 말고 진행해라. 외부 인증이 필요하면 정확한 항목만 알리고 독립 가능한 작업은 계속해라.

8. 제출과 종료
- 자기 reports/qoo10/status.md와 delta.json에 시작본 ID, 변경 파일 before/after hash, 명령/종료코드/로그를 기록해라.
- 공통 시작본 S0 이후 자기 delta만 제출한다. 통합본 전체 복사나 HEAD 기준 전체 diff 제출 금지.
- G1 범위·권한 / G2 로컬 / G3 실제읽기 / G4 과거·웹 / G5 신규 / G6 답변관측 / G7 복구 / G8 운영을 각각 통과·진행·미시험·외부조건으로 보고해라.
- 첫 읽기, 원장 저장, 웹 표시, provider 접수, 원격 답변 관측은 서로 다른 결과다.
- 남은 작업은 code/권한/공식계약/운영적용/자료부재로 구분하고 다음 한 행동을 적어라.
- 한 기능이 막혀도 다른 허용 작업은 계속해라. 기능을 숨기거나 근거 없는 백분율로 완료를 선언하지 마라.
```

## 4. 11번가 CS

[텍스트 원본](prompts/04-elevenst.txt)

```text
SellerPilot 11번가 CS 전담 지시문

너는 11번가 CS만 맡는다. 과거 자료 수집, 신규 수신, 웹 조회, 지원되는 답변과 원격 반영 확인, 중복 방지·장애 복구를 이 채널 안에서 끝까지 책임져라. 기존 구현을 재사용하고 계획 설명에서 멈추지 말고 실제 조사·수정·검증을 진행해라.

1. 기준과 시작 절차
- 공통 시작본 원본: /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908
- 전용 개발 폴더: /Users/kimchangheemac/dev/sellerpilot-cs-elevenst
- 예약 브랜치: codex/cs-elevenst-v1; 포트: 3214.
- 원본 HEAD: 3cb72144e991626fae98a30cf51022d9a1aa6b0b 및 미커밋 변경. HEAD/main만 복제하면 현재 CS 코드가 빠진다.
- 먼저 다음 문서를 읽어라:
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/AGENTS.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/README.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/ownership.json
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/channels/elevenst.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/TEMPLATES.md
- 통합 담당이 만든 S0 ID와 자기 폴더 파일 해시를 검증해라. 준비돼 있으면 재사용한다.
- 아직 준비되지 않았으면 통합 원본은 읽기만 하고 공식 계약/계정/권한 조사와 첫 실제 읽기 준비를 진행해라. 8개 채팅이 각자 다른 시작본을 만들지 마라.
- S0 전에 조사 산출물이 필요하면 /Users/kimchangheemac/dev/sellerpilot-cs-handoff/elevenst/에 자기 자료만 기록하고, S0 후 자기 reports 경로로 옮겨라. 비밀·실고객 원문은 넣지 마라.

2. 현재 구현과 범위
올바른 couplit/커플릿 Seller Office와 인증된 상품 Q&A 계약을 앞선 작업에서 확인했다. 전용 GET/PUT adapter, XML 정규화, 30일 다섯 구간, DB/UI/serverless 연결과 집중 회귀가 있다. 실제 운영 Key Q&A 읽기·과거 원장·답변 관측은 미완료다.

필수 조사 범위: 상품 Q&A / 셀러톡 / 긴급알리미 / 리뷰·답글. 긴급알리미가 고객 상담인지 시스템 알림인지 실제 메뉴·원격 ID·공식 계약으로 분류한다.
이 상태는 계획 작성 당시 기록이다. 실제 계정·권한·건수는 현재 다시 읽어 확인해라.

3. 실행 순서
1. ELEVENST-01 — 11번가 판매자 ID는 couplit, 판매자명은 커플릿이다. CHANGHEE Chrome 계정 이메일과 판매자 ID를 혼동하지 않는다. 준비된 Seller Office 세션을 재사용하고 Key는 기존 보안 경로에서만 참조한다.
2. ELEVENST-02 — 같은 seller/key/IP로 최대 7일 prodqnalist 실제 GET을 수행한다. 전체/답변/미답변 상태 00/01/02와 판매자센터 동일 기간을 대조한다. 최근 미답변 0건을 과거 전량으로 보지 않는다.
3. ELEVENST-03 — brdInfoNo·brdInfoClfNo(상품 번호)·질문 시각·답변 본문/날짜의 fixture→DB→웹 경로를 확인한다. memID는 보관하지 않고 날짜만 있는 답변의 시간 순서를 추측하지 않는다.
4. ELEVENST-04 — 30일 다섯 구간을 첫 단위로 완주하고 허용되는 최초 기간까지 종료일을 뒤로 옮긴다. 창별 원격 ID/원장/웹 수량과 gap, 이미 외부에서 답변된 문의를 대조한다.
5. ELEVENST-05 — 기존 credential_incarnation_v1 또는 provider_certified_v1의 정확한 활성 계보를 유지한다. 상품/문의/credential/latest inbound가 어긋나는 답변은 DB와 provider 전 단계에서 거절한다.
6. ELEVENST-06 — 승인된 상품 Q&A 답변을 PUT prodqnaanswer/brdInfoNo/prdNo로 보내는 경로를 검증한다. resultCode 200과 두 ID 일치는 접수이며 재조회로 동일 답변이 보여야 관측 완료다.
7. ELEVENST-07 — 셀러톡·긴급알리미·리뷰는 별도 공식 계약·권한·보존기간을 확보한다. 계약이 있으면 전용 수신/이력/답변/관측 모듈, 없으면 실제 자료 수입 경로와 제한을 남긴다.

첫 제출물: 첫 제출물은 couplit 계정 Key의 7일 실제 Q&A 읽기와 판매자센터 대조다. 앞서 통과한 로컬 기능을 처음부터 다시 만들지 않는다.

4. 파일 소유권
자기 worktree에서 다음 기존 파일만 직접 수정할 수 있다.
- lib/channels/elevenst-inquiries.ts
- tests/elevenst-product-qna.test.ts
- tests/elevenst-product-qna-db.test.mjs
- tests/elevenst-product-qna-db-dynamic.test.mjs

새 코드는 ownership.json의 elevenst 전용 위치만 허용된다.
- lib/channels/cs/elevenst/, lib/cs/channels/elevenst/
- app/cs/channels/elevenst/, app/api/admin/cs/channels/elevenst/
- tests/cs-elevenst-*.test.ts 또는 .test.mjs, tests/fixtures/cs/elevenst/
- scripts/cs-elevenst-*.ts 또는 .mjs
- docs/cs-parallel/reports/elevenst/, proposals/elevenst/

공통 요청 대상: protocols XML parser, inquiry-sync, inquiry-reply, reply-verification, fixed egress/serverless 허용표, history v4, SQL 08049000. 전부 통합 소유이므로 전용 함수 변경안과 회귀를 제출한다.
- inquiry-sync/reply, protocols, gateway/serverless, 공통 UI/history, OAuth·credential, supabase/migrations, package/lockfile/설정, 다른 채널 코드는 직접 수정하지 마라.
- 필요하면 자기 proposals/elevenst/에 현재 경로/함수/hash·재현 입력·기대 출력·최소 patch·회귀 시험·DB 초안을 작성하고 전용 개발을 계속해라.
- 요청서를 작성했다는 이유만으로 공통 연결 완료로 보고하지 마라. 통합본에 실제 반영된 결과를 검증해라.
- 상품 등록·재고·주문 상태·송장 전송 코드는 수정하지 않는다. CS의 주문/배송 맥락은 정확한 소유자/외부 주문번호 읽기 연결로만 사용한다.

5. 과거 전체와 유지 연동
- seller/app/country/shop/kind/상태/폴더별 최초 제공일과 고정 from/to·timezone을 기록해라.
- 최근30일/1년 복구를 과거 전체로 부르지 마라. 공급자 허용 창/페이지로 최초 제공 범위까지 이어가고 저장과 cursor 전진을 원자적으로 처리해라.
- 원격 고유 행을 정상/중복·기존/격리/근거 있는 제외/미처리로 대조해라. 티켓 수와 메시지 수는 별도다.
- 0건은 동일 계정·기간·상태로 검증하고, missing total은 unknown으로 유지해라.
- 빈 페이지+next, 반복 cursor, 반환상한, 중단 재개, 같은 창 재수집, 계정/shop 혼선, 늦은 답변, 새 문의 도착을 검증해라.
- API 밖 자료는 실제 공식 export/백업을 확인한다. 없으면 복구 불가 기간으로 남기고 가상 자료나 임의 parser로 완료를 만들지 마라.
- 미지원/권한대기 기능도 잔여 범위에 남긴다. 수동 수입/판매자센터 이동을 자동연동 100%에 합산하지 마라.

6. 검증
채널이 작성한 시험과 다음 관련 시험을 실행한다. 공통 시험 파일은 실행 가능하지만 수정은 통합 담당 소유다. Node 22/tsx와 저장소 lockfile을 따른다.

node --import tsx --test tests/elevenst-product-qna.test.ts tests/elevenst-product-qna-db.test.mjs tests/elevenst-product-qna-db-dynamic.test.mjs tests/channel-protocols.test.ts tests/serverless-cs-gateway.test.ts tests/cs-history-channel-db.test.mjs tests/inquiry-reply.test.ts


필수 반례: 7일 초과·00/01/02 상태·XML escape·answerYn=Y 본문/날짜 누락·날짜만 있는 답변·상품 번호 불일치·legacy 미검증 계보·실행 경로 allowlist·ACK 유실/원격 echo 지연·중복 클릭.

격리 DB에서 provider fixture→정규화→저장→인증 UI를 검증한다. 실제 provider GET 결과를 격리 DB에서 확인하는 경우 권한이 확인된 최소 자료만 사용하고 원문을 Git/공유 보고서에 넣지 않는다. 관리자 권한 해제·세션 만료·다른 seller/shop 데이터 혼선도 확인한다. 타입검사/수정 파일 린트는 이 worktree에서 수행하며 .next와 테스트 출력은 공유하지 않는다.

완료 판정: 상품 Q&A 실수신·과거 전체·답변 관측을 먼저 닫는다. 셀러톡·긴급알리미·리뷰까지 필수 범위를 해결하기 전 11번가 전체 완료라고 보고하지 않는다.

추가 실행 규칙:
- Node 22와 기존 lockfile 사용. Next 코드를 쓸 때 설치된 node_modules/next/dist/docs의 관련 가이드를 먼저 읽어라.
- 로컬 앱은 격리 DB만 연결한다. 실제 provider 읽기는 범위가 고정된 수동 읽기 경로로 수행한다.
- 자기 채널 집중 시험/수정 파일 린트/타입 검사를 우선하고 전체 저장소 build/전체 DB suite 반복은 통합 담당에 맡겨라.
- 로그는 자기 경로에 저장하고 종료코드/소스 hash를 기록한다. 새 실패를 이전 baseline으로 단정하지 마라.
- 자기 포트/프로세스만 제어하고 다른 채널 서버나 공유 worker를 종료하지 마라.

7. 로그인과 실행 제한
- 준비된 판매자 로그인은 재사용한다. Chrome 사용 시 CHANGHEE 프로필을 read-only 목록으로 확인한 뒤 대상 seller/app/shop을 확인한다. Chrome 이메일과 판매자 ID는 별개다.
- 다른 채팅 탭의 이동·로그아웃·계정 전환 금지. Vercel/Supabase·저장 credential/refresh·공용 webhook 주소 변경은 통합 담당과 조정한다.
- 비밀번호·API 키·고객 원문을 문서/fixture/로그/소스에 기록하지 않는다.
- 커밋·푸시·배포·운영 DB 변경 금지. 로컬 우선이라는 사용자 지시가 기존 AGENTS closeout보다 우선한다.
- 실제 고객 답변은 승인된 티켓/내용이 있을 때만 전송한다. 승인 전에도 답변 코드·모의 응답·중복 방지·실행 준비는 완료해라.
- 이미 허용된 로컬 작업·읽기는 반복 허가를 묻지 말고 진행해라. 외부 인증이 필요하면 정확한 항목만 알리고 독립 가능한 작업은 계속해라.

8. 제출과 종료
- 자기 reports/elevenst/status.md와 delta.json에 시작본 ID, 변경 파일 before/after hash, 명령/종료코드/로그를 기록해라.
- 공통 시작본 S0 이후 자기 delta만 제출한다. 통합본 전체 복사나 HEAD 기준 전체 diff 제출 금지.
- G1 범위·권한 / G2 로컬 / G3 실제읽기 / G4 과거·웹 / G5 신규 / G6 답변관측 / G7 복구 / G8 운영을 각각 통과·진행·미시험·외부조건으로 보고해라.
- 첫 읽기, 원장 저장, 웹 표시, provider 접수, 원격 답변 관측은 서로 다른 결과다.
- 남은 작업은 code/권한/공식계약/운영적용/자료부재로 구분하고 다음 한 행동을 적어라.
- 한 기능이 막혀도 다른 허용 작업은 계속해라. 기능을 숨기거나 근거 없는 백분율로 완료를 선언하지 마라.
```

## 5. Shopee CS

[텍스트 원본](prompts/05-shopee.txt)

```text
SellerPilot Shopee CS 전담 지시문

너는 Shopee CS만 맡는다. 과거 자료 수집, 신규 수신, 웹 조회, 지원되는 답변과 원격 반영 확인, 중복 방지·장애 복구를 이 채널 안에서 끝까지 책임져라. 기존 구현을 재사용하고 계획 설명에서 멈추지 말고 실제 조사·수정·검증을 진행해라.

1. 기준과 시작 절차
- 공통 시작본 원본: /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908
- 전용 개발 폴더: /Users/kimchangheemac/dev/sellerpilot-cs-shopee
- 예약 브랜치: codex/cs-shopee-v1; 포트: 3215.
- 원본 HEAD: 3cb72144e991626fae98a30cf51022d9a1aa6b0b 및 미커밋 변경. HEAD/main만 복제하면 현재 CS 코드가 빠진다.
- 먼저 다음 문서를 읽어라:
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/AGENTS.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/README.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/ownership.json
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/channels/shopee.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/TEMPLATES.md
- 통합 담당이 만든 S0 ID와 자기 폴더 파일 해시를 검증해라. 준비돼 있으면 재사용한다.
- 아직 준비되지 않았으면 통합 원본은 읽기만 하고 공식 계약/계정/권한 조사와 첫 실제 읽기 준비를 진행해라. 8개 채팅이 각자 다른 시작본을 만들지 마라.
- S0 전에 조사 산출물이 필요하면 /Users/kimchangheemac/dev/sellerpilot-cs-handoff/shopee/에 자기 자료만 기록하고, S0 후 자기 reports 경로로 옮겨라. 비밀·실고객 원문은 넣지 마라.

2. 현재 구현과 범위
shop별 상품 후기 get_comment/reply_comment와 첨부, Returns 목록·상세·15일 창·상세 10건 continuation이 있다. Buyer Chat 전용 공개 계약/권한·수신·답변 경로는 확보되지 않았다. 코드의 최대 8shop 처리와 실제 활성 shop 수는 별도다.

필수 조사 범위: 실제 연결된 국가/shop 전수 × 상품 후기·답글 / 반품·환불 작업함 / Buyer Chat. 새로운/해제 shop도 상태 목록에 반영한다.
이 상태는 계획 작성 당시 기록이다. 실제 계정·권한·건수는 현재 다시 읽어 확인해라.

3. 실행 순서
1. SHOPEE-01 — 현재 실제 shop 목록·국가·app/partner ID·활성 credential 및 만료를 먼저 고정한다. 8개가 로그인됐다고 추정하지 않는다. refresh를 여러 프로세스에서 동시에 실행하지 않는다.
2. SHOPEE-02 — 한 shop의 후기 목록 실제 읽기→정규화→격리 DB→웹을 먼저 완주한 다음 나머지 실제 shop으로 확장한다. 한 shop 권한 실패가 다른 shop 완료를 가리지 않게 한다.
3. SHOPEE-03 — 후기 전체 기간·item/comment/shop 식별자·첨부·수정본을 대조한다. 페이지 상한 초과 후 재개, 한 job의 부분 저장과 continuation을 검증한다.
4. SHOPEE-04 — Returns의 15일 이하 구간과 상세 10건 continuation을 실제 데이터로 확인한다. 모든 shop의 상태·사유·협상·기한·첨부 및 원격 ID를 대조하고 연락처·주소를 제외한다.
5. SHOPEE-05 — 최근 30일 이후 전체 제공기간 복구 계획 및 shop 선택/진행률을 공통 history UI에 연결 요청한다. 후기와 Returns의 cursor/분모를 공유하지 않는다.
6. SHOPEE-06 — 후기 답변은 같은 shop/item/comment/최신 고객 세대에서만 실행되게 하고 실제 답변 관측을 검증한다. Returns의 환불/승인 action은 답변 경로로 열지 않는다.
7. SHOPEE-07 — Buyer Chat은 실제 앱에서 이용 가능한 공식 제품/파트너 권한과 webhook/history/reply 계약을 조사한다. 확보되면 전용 모듈과 주문/대화/수신자 계보를 구현한다. 미확보 시 정확한 다음 권한 절차를 기록하며 후기 완주는 계속한다.

첫 제출물: 첫 제출물은 실제 shop 목록과 1shop 후기 전체 흐름이다. 다른 shop 장애로 전체를 pending 하나로 표시하지 않는다.

4. 파일 소유권
자기 worktree에서 다음 기존 파일만 직접 수정할 수 있다.
- lib/channels/shopee-inquiries.ts
- tests/shopee-return-refund.test.ts
- tests/shopee-return-refund-db.test.mjs
- scripts/shopee-comment-counts-get-only.mjs

새 코드는 ownership.json의 shopee 전용 위치만 허용된다.
- lib/channels/cs/shopee/, lib/cs/channels/shopee/
- app/cs/channels/shopee/, app/api/admin/cs/channels/shopee/
- tests/cs-shopee-*.test.ts 또는 .test.mjs, tests/fixtures/cs/shopee/
- scripts/cs-shopee-*.ts 또는 .mjs
- docs/cs-parallel/reports/shopee/, proposals/shopee/

공통 요청 대상: 정규화·reply·history·scope health·credential grant. shopee-oauth-exact.ts 및 모든 listing/상품·주문 OAuth 코드, SQL 20260907200000/08045000은 통합 담당 소유다.
- inquiry-sync/reply, protocols, gateway/serverless, 공통 UI/history, OAuth·credential, supabase/migrations, package/lockfile/설정, 다른 채널 코드는 직접 수정하지 마라.
- 필요하면 자기 proposals/shopee/에 현재 경로/함수/hash·재현 입력·기대 출력·최소 patch·회귀 시험·DB 초안을 작성하고 전용 개발을 계속해라.
- 요청서를 작성했다는 이유만으로 공통 연결 완료로 보고하지 마라. 통합본에 실제 반영된 결과를 검증해라.
- 상품 등록·재고·주문 상태·송장 전송 코드는 수정하지 않는다. CS의 주문/배송 맥락은 정확한 소유자/외부 주문번호 읽기 연결로만 사용한다.

5. 과거 전체와 유지 연동
- seller/app/country/shop/kind/상태/폴더별 최초 제공일과 고정 from/to·timezone을 기록해라.
- 최근30일/1년 복구를 과거 전체로 부르지 마라. 공급자 허용 창/페이지로 최초 제공 범위까지 이어가고 저장과 cursor 전진을 원자적으로 처리해라.
- 원격 고유 행을 정상/중복·기존/격리/근거 있는 제외/미처리로 대조해라. 티켓 수와 메시지 수는 별도다.
- 0건은 동일 계정·기간·상태로 검증하고, missing total은 unknown으로 유지해라.
- 빈 페이지+next, 반복 cursor, 반환상한, 중단 재개, 같은 창 재수집, 계정/shop 혼선, 늦은 답변, 새 문의 도착을 검증해라.
- API 밖 자료는 실제 공식 export/백업을 확인한다. 없으면 복구 불가 기간으로 남기고 가상 자료나 임의 parser로 완료를 만들지 마라.
- 미지원/권한대기 기능도 잔여 범위에 남긴다. 수동 수입/판매자센터 이동을 자동연동 100%에 합산하지 마라.

6. 검증
채널이 작성한 시험과 다음 관련 시험을 실행한다. 공통 시험 파일은 실행 가능하지만 수정은 통합 담당 소유다. Node 22/tsx와 저장소 lockfile을 따른다.

node --import tsx --test tests/shopee-return-refund.test.ts tests/shopee-return-refund-db.test.mjs tests/inquiry-sync-contract.test.ts tests/inquiry-reply.test.ts tests/channel-pagination.test.ts tests/serverless-cs-gateway.test.ts


필수 반례: 다중 shop·같은 comment ID·1shop 403·토큰 회전 CAS·20페이지 초과 재개·상세 10/11건·15일 경계·빈 페이지+다음 cursor·후기 수정/첨부 만료·미결속 shop 답변 차단.

격리 DB에서 provider fixture→정규화→저장→인증 UI를 검증한다. 실제 provider GET 결과를 격리 DB에서 확인하는 경우 권한이 확인된 최소 자료만 사용하고 원문을 Git/공유 보고서에 넣지 않는다. 관리자 권한 해제·세션 만료·다른 seller/shop 데이터 혼선도 확인한다. 타입검사/수정 파일 린트는 이 worktree에서 수행하며 .next와 테스트 출력은 공유하지 않는다.

완료 판정: 모든 실제 shop의 후기/Returns 범위와 신규 수신·후기 답변을 닫고 Buyer Chat까지 요구 범위대로 구현·검증해야 채널 전체 완료다.

추가 실행 규칙:
- Node 22와 기존 lockfile 사용. Next 코드를 쓸 때 설치된 node_modules/next/dist/docs의 관련 가이드를 먼저 읽어라.
- 로컬 앱은 격리 DB만 연결한다. 실제 provider 읽기는 범위가 고정된 수동 읽기 경로로 수행한다.
- 자기 채널 집중 시험/수정 파일 린트/타입 검사를 우선하고 전체 저장소 build/전체 DB suite 반복은 통합 담당에 맡겨라.
- 로그는 자기 경로에 저장하고 종료코드/소스 hash를 기록한다. 새 실패를 이전 baseline으로 단정하지 마라.
- 자기 포트/프로세스만 제어하고 다른 채널 서버나 공유 worker를 종료하지 마라.

7. 로그인과 실행 제한
- 준비된 판매자 로그인은 재사용한다. Chrome 사용 시 CHANGHEE 프로필을 read-only 목록으로 확인한 뒤 대상 seller/app/shop을 확인한다. Chrome 이메일과 판매자 ID는 별개다.
- 다른 채팅 탭의 이동·로그아웃·계정 전환 금지. Vercel/Supabase·저장 credential/refresh·공용 webhook 주소 변경은 통합 담당과 조정한다.
- 비밀번호·API 키·고객 원문을 문서/fixture/로그/소스에 기록하지 않는다.
- 커밋·푸시·배포·운영 DB 변경 금지. 로컬 우선이라는 사용자 지시가 기존 AGENTS closeout보다 우선한다.
- 실제 고객 답변은 승인된 티켓/내용이 있을 때만 전송한다. 승인 전에도 답변 코드·모의 응답·중복 방지·실행 준비는 완료해라.
- 이미 허용된 로컬 작업·읽기는 반복 허가를 묻지 말고 진행해라. 외부 인증이 필요하면 정확한 항목만 알리고 독립 가능한 작업은 계속해라.

8. 제출과 종료
- 자기 reports/shopee/status.md와 delta.json에 시작본 ID, 변경 파일 before/after hash, 명령/종료코드/로그를 기록해라.
- 공통 시작본 S0 이후 자기 delta만 제출한다. 통합본 전체 복사나 HEAD 기준 전체 diff 제출 금지.
- G1 범위·권한 / G2 로컬 / G3 실제읽기 / G4 과거·웹 / G5 신규 / G6 답변관측 / G7 복구 / G8 운영을 각각 통과·진행·미시험·외부조건으로 보고해라.
- 첫 읽기, 원장 저장, 웹 표시, provider 접수, 원격 답변 관측은 서로 다른 결과다.
- 남은 작업은 code/권한/공식계약/운영적용/자료부재로 구분하고 다음 한 행동을 적어라.
- 한 기능이 막혀도 다른 허용 작업은 계속해라. 기능을 숨기거나 근거 없는 백분율로 완료를 선언하지 마라.
```

## 6. Lazada CS

[텍스트 원본](prompts/06-lazada.txt)

```text
SellerPilot Lazada CS 전담 지시문

너는 Lazada CS만 맡는다. 과거 자료 수집, 신규 수신, 웹 조회, 지원되는 답변과 원격 반영 확인, 중복 방지·장애 복구를 이 채널 안에서 끝까지 책임져라. 기존 구현을 재사용하고 계획 설명에서 멈추지 말고 실제 조사·수정·검증을 진행해라.

1. 기준과 시작 절차
- 공통 시작본 원본: /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908
- 전용 개발 폴더: /Users/kimchangheemac/dev/sellerpilot-cs-lazada
- 예약 브랜치: codex/cs-lazada-v1; 포트: 3216.
- 원본 HEAD: 3cb72144e991626fae98a30cf51022d9a1aa6b0b 및 미커밋 변경. HEAD/main만 복제하면 현재 CS 코드가 빠진다.
- 먼저 다음 문서를 읽어라:
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/AGENTS.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/README.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/ownership.json
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/channels/lazada.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/TEMPLATES.md
- 통합 담당이 만든 S0 ID와 자기 폴더 파일 해시를 검증해라. 준비돼 있으면 재사용한다.
- 아직 준비되지 않았으면 통합 원본은 읽기만 하고 공식 계약/계정/권한 조사와 첫 실제 읽기 준비를 진행해라. 8개 채팅이 각자 다른 시작본을 만들지 마라.
- S0 전에 조사 산출물이 필요하면 /Users/kimchangheemac/dev/sellerpilot-cs-handoff/lazada/에 자기 자료만 기록하고, S0 후 자기 reports 경로로 옮겨라. 비밀·실고객 원문은 넣지 마라.

2. 현재 구현과 범위
IM bootstrap·Push·답변과 rich/card 투영, raw inbox·격리·재처리·첨부 메타데이터 경로가 있다. 앞선 개발자 화면의 CS Bot Online/Active는 실제 Vault token grant를 입증하지 않는다. 현재 inventory는 IM과 카드 2행뿐이라 리뷰/사후지원 범위를 추가 조사해야 한다.

필수 조사 범위: 국가/seller/CS Bot 앱별 IM / 상품·주문·쿠폰 카드 / 수정·회수·system 이벤트 / 리뷰·사후지원 존재와 연동 범위. Commerce 앱과 CS Bot token을 구분한다.
이 상태는 계획 작성 당시 기록이다. 실제 계정·권한·건수는 현재 다시 읽어 확인해라.

3. 실행 순서
1. LAZADA-01 — 실제 seller/country/app ID, CS Bot permission과 저장 token fingerprint/만료를 대조한다. Commerce token에 IM 권한이 있다고 가정하지 않는다.
2. LAZADA-02 — 준비된 앱에서 IM 세션 목록·이력 read-only 1회로 grant를 확인한다. 401/403의 app/token/seller 원인을 분해하고 무작정 재동의·로그아웃을 반복하지 않는다.
3. LAZADA-03 — 한 세션의 페이지·메시지 전체를 원격 ID와 대조한다. session/message 순회 상한 뒤 continuation, 역순·시각 미상·unknown template은 보존하고 처리 상태를 구분한다.
4. LAZADA-04 — webhook 서명·app binding·timestamp/재전달을 fixture로 검증한다. 원문 저장 성공 전 ACK 금지, ACK 뒤 중단해도 raw worker가 같은 receipt로 재처리하도록 한다.
5. LAZADA-05 — bootstrap과 Push의 같은 ID/revision 중복, 본문/첨부 수정, 공식 회수 target, seller/system/customer 역할을 대조한다. 미확정 status를 문의 해결로 바꾸지 않는다.
6. LAZADA-06 — 웹의 원문/격리/재처리/대화·카드·첨부 만료 화면을 격리 DB로 검증한다. 저장 정책상 복구 불가 사유를 표시하고 raw 용량/TTL 경계를 시험한다.
7. LAZADA-07 — 승인된 reply와 원격 session echo를 대조하고 새 고객 메시지가 오면 이전 답변으로 해결하지 않는다. 리뷰·사후지원 API/권한을 별도로 조사해 inventory와 구현 요청을 추가한다.

첫 제출물: 첫 제출물은 실제 CS Bot token의 IM 읽기 결과와 한 세션의 원격/DB/웹 메시지 대조다. UI Online만 보고 연동 성공이라고 하지 않는다.

4. 파일 소유권
자기 worktree에서 다음 기존 파일만 직접 수정할 수 있다.
- lib/channels/lazada-inquiries.ts
- lib/channels/lazada-im.ts
- lib/channels/lazada-im-webhook.ts
- lib/channels/lazada-im-bootstrap.ts
- lib/channels/lazada-raw-reprocess.ts
- lib/cs/lazada-quarantine.ts
- lib/cs/lazada-raw-inbox.ts
- app/api/webhooks/lazada-im/route.ts
- app/api/admin/cs/lazada-quarantine/route.ts
- app/api/admin/cs/lazada-raw-inbox/route.ts
- app/api/admin/cs/lazada-raw-inbox/health/route.ts
- app/api/admin/cs/lazada-raw-inbox/reprocess/route.ts
- app/api/admin/cs/lazada-reply/route.ts
- app/cs/lazada-quarantine.tsx
- app/cs/lazada-quarantine.module.css
- app/cs/lazada-raw-inbox.tsx
- tests/lazada-im.test.ts
- tests/lazada-im-webhook.test.ts
- tests/lazada-im-bootstrap.test.ts
- tests/lazada-im-app-binding.test.ts
- tests/lazada-inquiry-sync.test.ts
- tests/lazada-history-completeness.test.ts
- tests/lazada-history-pagination.test.ts
- tests/lazada-unordered-quarantine.test.ts
- tests/lazada-raw-reprocess.test.ts
- tests/lazada-quarantine-route.test.ts
- tests/lazada-quarantine-read-db.test.mjs
- tests/lazada-im-raw-inbox-db.test.mjs
- tests/lazada-im-raw-reprocess-db.test.mjs
- tests/lazada-undated-buyer-db.test.mjs

새 코드는 ownership.json의 lazada 전용 위치만 허용된다.
- lib/channels/cs/lazada/, lib/cs/channels/lazada/
- app/cs/channels/lazada/, app/api/admin/cs/channels/lazada/
- tests/cs-lazada-*.test.ts 또는 .test.mjs, tests/fixtures/cs/lazada/
- scripts/cs-lazada-*.ts 또는 .mjs
- docs/cs-parallel/reports/lazada/, proposals/lazada/

공통 요청 대상: 공통 webhook 공개 주소·token 저장/refresh·serverless raw worker 진입점·공통 타임라인·history coverage/retention RPC와 SQL. lazada-oauth-exact.ts는 상품 인증과 공유하므로 통합 소유다.
- inquiry-sync/reply, protocols, gateway/serverless, 공통 UI/history, OAuth·credential, supabase/migrations, package/lockfile/설정, 다른 채널 코드는 직접 수정하지 마라.
- 필요하면 자기 proposals/lazada/에 현재 경로/함수/hash·재현 입력·기대 출력·최소 patch·회귀 시험·DB 초안을 작성하고 전용 개발을 계속해라.
- 요청서를 작성했다는 이유만으로 공통 연결 완료로 보고하지 마라. 통합본에 실제 반영된 결과를 검증해라.
- 상품 등록·재고·주문 상태·송장 전송 코드는 수정하지 않는다. CS의 주문/배송 맥락은 정확한 소유자/외부 주문번호 읽기 연결로만 사용한다.

5. 과거 전체와 유지 연동
- seller/app/country/shop/kind/상태/폴더별 최초 제공일과 고정 from/to·timezone을 기록해라.
- 최근30일/1년 복구를 과거 전체로 부르지 마라. 공급자 허용 창/페이지로 최초 제공 범위까지 이어가고 저장과 cursor 전진을 원자적으로 처리해라.
- 원격 고유 행을 정상/중복·기존/격리/근거 있는 제외/미처리로 대조해라. 티켓 수와 메시지 수는 별도다.
- 0건은 동일 계정·기간·상태로 검증하고, missing total은 unknown으로 유지해라.
- 빈 페이지+next, 반복 cursor, 반환상한, 중단 재개, 같은 창 재수집, 계정/shop 혼선, 늦은 답변, 새 문의 도착을 검증해라.
- API 밖 자료는 실제 공식 export/백업을 확인한다. 없으면 복구 불가 기간으로 남기고 가상 자료나 임의 parser로 완료를 만들지 마라.
- 미지원/권한대기 기능도 잔여 범위에 남긴다. 수동 수입/판매자센터 이동을 자동연동 100%에 합산하지 마라.

6. 검증
채널이 작성한 시험과 다음 관련 시험을 실행한다. 공통 시험 파일은 실행 가능하지만 수정은 통합 담당 소유다. Node 22/tsx와 저장소 lockfile을 따른다.

node --import tsx --test tests/lazada-im.test.ts tests/lazada-im-webhook.test.ts tests/lazada-im-bootstrap.test.ts tests/lazada-im-app-binding.test.ts tests/lazada-inquiry-sync.test.ts tests/lazada-history-completeness.test.ts tests/lazada-history-pagination.test.ts tests/lazada-unordered-quarantine.test.ts tests/lazada-raw-reprocess.test.ts tests/lazada-quarantine-route.test.ts tests/lazada-quarantine-read-db.test.mjs tests/lazada-im-raw-inbox-db.test.mjs tests/lazada-im-raw-reprocess-db.test.mjs tests/lazada-undated-buyer-db.test.mjs tests/cs-history-coverage-db.test.mjs tests/cs-attachment-retention-db.test.mjs tests/cs-reply-observation-db.test.mjs


필수 반례: 세션/메시지 실제 상한 초과 continuation·빈 페이지+next·ACK 전 저장 실패·ACK 후 중단·중복/수정/회수·시각 미상·unknown type·원문 5,000행/TTL 경계·다른 app 서명·첨부 URL 만료.

격리 DB에서 provider fixture→정규화→저장→인증 UI를 검증한다. 실제 provider GET 결과를 격리 DB에서 확인하는 경우 권한이 확인된 최소 자료만 사용하고 원문을 Git/공유 보고서에 넣지 않는다. 관리자 권한 해제·세션 만료·다른 seller/shop 데이터 혼선도 확인한다. 타입검사/수정 파일 린트는 이 worktree에서 수행하며 .next와 테스트 출력은 공유하지 않는다.

완료 판정: 실제 seller/country별 bootstrap+Push+답변 관측·카드/수정/회수/첨부·raw 복구를 닫고 추가 CS 표면 조사 결과까지 반영해야 완료다.

추가 실행 규칙:
- Node 22와 기존 lockfile 사용. Next 코드를 쓸 때 설치된 node_modules/next/dist/docs의 관련 가이드를 먼저 읽어라.
- 로컬 앱은 격리 DB만 연결한다. 실제 provider 읽기는 범위가 고정된 수동 읽기 경로로 수행한다.
- 자기 채널 집중 시험/수정 파일 린트/타입 검사를 우선하고 전체 저장소 build/전체 DB suite 반복은 통합 담당에 맡겨라.
- 로그는 자기 경로에 저장하고 종료코드/소스 hash를 기록한다. 새 실패를 이전 baseline으로 단정하지 마라.
- 자기 포트/프로세스만 제어하고 다른 채널 서버나 공유 worker를 종료하지 마라.

7. 로그인과 실행 제한
- 준비된 판매자 로그인은 재사용한다. Chrome 사용 시 CHANGHEE 프로필을 read-only 목록으로 확인한 뒤 대상 seller/app/shop을 확인한다. Chrome 이메일과 판매자 ID는 별개다.
- 다른 채팅 탭의 이동·로그아웃·계정 전환 금지. Vercel/Supabase·저장 credential/refresh·공용 webhook 주소 변경은 통합 담당과 조정한다.
- 비밀번호·API 키·고객 원문을 문서/fixture/로그/소스에 기록하지 않는다.
- 커밋·푸시·배포·운영 DB 변경 금지. 로컬 우선이라는 사용자 지시가 기존 AGENTS closeout보다 우선한다.
- 실제 고객 답변은 승인된 티켓/내용이 있을 때만 전송한다. 승인 전에도 답변 코드·모의 응답·중복 방지·실행 준비는 완료해라.
- 이미 허용된 로컬 작업·읽기는 반복 허가를 묻지 말고 진행해라. 외부 인증이 필요하면 정확한 항목만 알리고 독립 가능한 작업은 계속해라.

8. 제출과 종료
- 자기 reports/lazada/status.md와 delta.json에 시작본 ID, 변경 파일 before/after hash, 명령/종료코드/로그를 기록해라.
- 공통 시작본 S0 이후 자기 delta만 제출한다. 통합본 전체 복사나 HEAD 기준 전체 diff 제출 금지.
- G1 범위·권한 / G2 로컬 / G3 실제읽기 / G4 과거·웹 / G5 신규 / G6 답변관측 / G7 복구 / G8 운영을 각각 통과·진행·미시험·외부조건으로 보고해라.
- 첫 읽기, 원장 저장, 웹 표시, provider 접수, 원격 답변 관측은 서로 다른 결과다.
- 남은 작업은 code/권한/공식계약/운영적용/자료부재로 구분하고 다음 한 행동을 적어라.
- 한 기능이 막혀도 다른 허용 작업은 계속해라. 기능을 숨기거나 근거 없는 백분율로 완료를 선언하지 마라.
```

## 7. eBay CS

[텍스트 원본](prompts/07-ebay.txt)

```text
SellerPilot eBay CS 전담 지시문

너는 eBay CS만 맡는다. 과거 자료 수집, 신규 수신, 웹 조회, 지원되는 답변과 원격 반영 확인, 중복 방지·장애 복구를 이 채널 안에서 끝까지 책임져라. 기존 구현을 재사용하고 계획 설명에서 멈추지 말고 실제 조사·수정·검증을 진행해라.

1. 기준과 시작 절차
- 공통 시작본 원본: /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908
- 전용 개발 폴더: /Users/kimchangheemac/dev/sellerpilot-cs-ebay
- 예약 브랜치: codex/cs-ebay-v1; 포트: 3217.
- 원본 HEAD: 3cb72144e991626fae98a30cf51022d9a1aa6b0b 및 미커밋 변경. HEAD/main만 복제하면 현재 CS 코드가 빠진다.
- 먼저 다음 문서를 읽어라:
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/AGENTS.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/README.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/ownership.json
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/channels/ebay.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/TEMPLATES.md
- 통합 담당이 만든 S0 ID와 자기 폴더 파일 해시를 검증해라. 준비돼 있으면 재사용한다.
- 아직 준비되지 않았으면 통합 원본은 읽기만 하고 공식 계약/계정/권한 조사와 첫 실제 읽기 준비를 진행해라. 8개 채팅이 각자 다른 시작본을 만들지 마라.
- S0 전에 조사 산출물이 필요하면 /Users/kimchangheemac/dev/sellerpilot-cs-handoff/ebay/에 자기 자료만 기록하고, S0 후 자기 reports 경로로 옮겨라. 비밀·실고객 원문은 넣지 마라.

2. 현재 구현과 범위
ASQ, Trading Inbox, Commerce FROM_MEMBERS/FROM_EBAY 수신과 1년 복구, ASQ/Commerce 조건부 답변 경로가 있다. Trading Inbox 자체는 읽기 전용이다. 과거 API 9건/센터 21행과 commerce.message 403은 이전 관측이므로 같은 계정·폴더·기간으로 재확인해야 한다.

필수 조사 범위: Ask Seller Question / Trading Inbox / Commerce 일반 회원·시스템 대화 / 케이스·분쟁. 같은 메시지가 여러 API에 보이는 경우 출처와 identity mapping을 보존한다.
이 상태는 계획 작성 당시 기록이다. 실제 계정·권한·건수는 현재 다시 읽어 확인해라.

3. 실행 순서
1. EBAY-01 — seller account·site/marketplace·app와 OAuth grant를 확인한다. ASQ 수신자 계보와 Commerce conversation 권한을 따로 기록한다.
2. EBAY-02 — Trading의 Summary/헤더/본문을 같은 폴더·기간으로 대조하고 Commerce FROM_MEMBERS/FROM_EBAY를 각각 실제 읽기한다. 이전 9/21을 현재 총수로 사용하지 않는다.
3. EBAY-03 — 빈 페이지에 next가 있어도 중단하지 않고, 누락 total을 0으로 만들지 않는다. Inbox는 25 header 후 최대 10 ID 상세, Commerce는 10 대화/25 메시지 continuation의 끝을 검증한다.
4. EBAY-04 — 1년 고정 범위를 31일 이하 창으로 나누고 폴더/시스템 메시지 포함 범위를 대조한다. API별 집합 차이를 원격 ID mapping으로 분류하며 21-9만으로 누락 출처를 추정하지 않는다.
5. EBAY-05 — 동일 외부 메시지의 ASQ/Inbox/Commerce 중복은 공식 매핑이 있을 때만 연결한다. Inbox 레코드를 임의로 replyable로 승격하지 않는다.
6. EBAY-06 — ASQ는 parent/recipient/site, Commerce는 회원 conversation/latest inbound에 결속해 답변·재조회를 검증한다. FROM_EBAY 시스템 대화는 답변 차단한다.
7. EBAY-07 — 케이스·분쟁의 실제 계정에서 쓸 수 있는 공식 계약/권한/보존범위를 확인하고 전용 읽기·이력·지원되는 응답 경로를 구현한다. 환불·분쟁 종결 같은 업무 action은 별도로 통제한다.

첫 제출물: 첫 제출물은 동일 범위의 API별 원격 ID 집합과 실제 Commerce 권한 결과다. 권한 403 상태를 parser 개발 완료로 대체하지 않는다.

4. 파일 소유권
자기 worktree에서 다음 기존 파일만 직접 수정할 수 있다.
- lib/channels/ebay-inquiries.ts
- lib/channels/ebay-asq.ts
- lib/channels/ebay-message-history.ts
- lib/channels/ebay-message-pages.ts
- lib/cs/ebay-messages.ts
- app/api/admin/cs/ebay-messages/route.ts
- app/cs/ebay-messages.tsx
- scripts/ebay-message-access-get-only.mjs
- tests/ebay-asq.test.ts
- tests/ebay-message-history.test.ts
- tests/ebay-message-pages.test.ts
- tests/ebay-message-route.test.ts
- tests/ebay-my-messages.test.ts
- tests/ebay-conversation-sync.test.ts
- tests/ebay-mailbox-history.test.ts
- tests/ebay-commerce-message-db.test.mjs

새 코드는 ownership.json의 ebay 전용 위치만 허용된다.
- lib/channels/cs/ebay/, lib/cs/channels/ebay/
- app/cs/channels/ebay/, app/api/admin/cs/channels/ebay/
- tests/cs-ebay-*.test.ts 또는 .test.mjs, tests/fixtures/cs/ebay/
- scripts/cs-ebay-*.ts 또는 .mjs
- docs/cs-parallel/reports/ebay/, proposals/ebay/

공통 요청 대상: commerce.message scope 추가와 OAuth refresh·credential 저장, 공통 XML/normalizer/reply/history·SQL 08044000, 공통 archive UI. listing/inventory/배송 eBay 파일은 수정하지 않는다.
- inquiry-sync/reply, protocols, gateway/serverless, 공통 UI/history, OAuth·credential, supabase/migrations, package/lockfile/설정, 다른 채널 코드는 직접 수정하지 마라.
- 필요하면 자기 proposals/ebay/에 현재 경로/함수/hash·재현 입력·기대 출력·최소 patch·회귀 시험·DB 초안을 작성하고 전용 개발을 계속해라.
- 요청서를 작성했다는 이유만으로 공통 연결 완료로 보고하지 마라. 통합본에 실제 반영된 결과를 검증해라.
- 상품 등록·재고·주문 상태·송장 전송 코드는 수정하지 않는다. CS의 주문/배송 맥락은 정확한 소유자/외부 주문번호 읽기 연결로만 사용한다.

5. 과거 전체와 유지 연동
- seller/app/country/shop/kind/상태/폴더별 최초 제공일과 고정 from/to·timezone을 기록해라.
- 최근30일/1년 복구를 과거 전체로 부르지 마라. 공급자 허용 창/페이지로 최초 제공 범위까지 이어가고 저장과 cursor 전진을 원자적으로 처리해라.
- 원격 고유 행을 정상/중복·기존/격리/근거 있는 제외/미처리로 대조해라. 티켓 수와 메시지 수는 별도다.
- 0건은 동일 계정·기간·상태로 검증하고, missing total은 unknown으로 유지해라.
- 빈 페이지+next, 반복 cursor, 반환상한, 중단 재개, 같은 창 재수집, 계정/shop 혼선, 늦은 답변, 새 문의 도착을 검증해라.
- API 밖 자료는 실제 공식 export/백업을 확인한다. 없으면 복구 불가 기간으로 남기고 가상 자료나 임의 parser로 완료를 만들지 마라.
- 미지원/권한대기 기능도 잔여 범위에 남긴다. 수동 수입/판매자센터 이동을 자동연동 100%에 합산하지 마라.

6. 검증
채널이 작성한 시험과 다음 관련 시험을 실행한다. 공통 시험 파일은 실행 가능하지만 수정은 통합 담당 소유다. Node 22/tsx와 저장소 lockfile을 따른다.

node --import tsx --test tests/ebay-asq.test.ts tests/ebay-message-history.test.ts tests/ebay-message-pages.test.ts tests/ebay-message-route.test.ts tests/ebay-my-messages.test.ts tests/ebay-conversation-sync.test.ts tests/ebay-mailbox-history.test.ts tests/ebay-commerce-message-db.test.mjs tests/channel-pagination.test.ts tests/inquiry-sync-contract.test.ts tests/inquiry-reply.test.ts tests/serverless-cs-gateway.test.ts


필수 반례: empty+hasMore·total 누락·헤더/본문 ID 불일치·다른 seller/site·고객/판매자/시스템 역할·동일 본문 다른 ID·대화 cursor 재개·FROM_EBAY 답변 불가·API 간 동일 메시지·오래된 inbound 답변.

격리 DB에서 provider fixture→정규화→저장→인증 UI를 검증한다. 실제 provider GET 결과를 격리 DB에서 확인하는 경우 권한이 확인된 최소 자료만 사용하고 원문을 Git/공유 보고서에 넣지 않는다. 관리자 권한 해제·세션 만료·다른 seller/shop 데이터 혼선도 확인한다. 타입검사/수정 파일 린트는 이 worktree에서 수행하며 .next와 테스트 출력은 공유하지 않는다.

완료 판정: ASQ/Inbox/Commerce 원장·웹·전체 이력 대조와 지원 답변의 관측, 케이스/분쟁 요구까지 닫혀야 채널 전체 완료다.

추가 실행 규칙:
- Node 22와 기존 lockfile 사용. Next 코드를 쓸 때 설치된 node_modules/next/dist/docs의 관련 가이드를 먼저 읽어라.
- 로컬 앱은 격리 DB만 연결한다. 실제 provider 읽기는 범위가 고정된 수동 읽기 경로로 수행한다.
- 자기 채널 집중 시험/수정 파일 린트/타입 검사를 우선하고 전체 저장소 build/전체 DB suite 반복은 통합 담당에 맡겨라.
- 로그는 자기 경로에 저장하고 종료코드/소스 hash를 기록한다. 새 실패를 이전 baseline으로 단정하지 마라.
- 자기 포트/프로세스만 제어하고 다른 채널 서버나 공유 worker를 종료하지 마라.

7. 로그인과 실행 제한
- 준비된 판매자 로그인은 재사용한다. Chrome 사용 시 CHANGHEE 프로필을 read-only 목록으로 확인한 뒤 대상 seller/app/shop을 확인한다. Chrome 이메일과 판매자 ID는 별개다.
- 다른 채팅 탭의 이동·로그아웃·계정 전환 금지. Vercel/Supabase·저장 credential/refresh·공용 webhook 주소 변경은 통합 담당과 조정한다.
- 비밀번호·API 키·고객 원문을 문서/fixture/로그/소스에 기록하지 않는다.
- 커밋·푸시·배포·운영 DB 변경 금지. 로컬 우선이라는 사용자 지시가 기존 AGENTS closeout보다 우선한다.
- 실제 고객 답변은 승인된 티켓/내용이 있을 때만 전송한다. 승인 전에도 답변 코드·모의 응답·중복 방지·실행 준비는 완료해라.
- 이미 허용된 로컬 작업·읽기는 반복 허가를 묻지 말고 진행해라. 외부 인증이 필요하면 정확한 항목만 알리고 독립 가능한 작업은 계속해라.

8. 제출과 종료
- 자기 reports/ebay/status.md와 delta.json에 시작본 ID, 변경 파일 before/after hash, 명령/종료코드/로그를 기록해라.
- 공통 시작본 S0 이후 자기 delta만 제출한다. 통합본 전체 복사나 HEAD 기준 전체 diff 제출 금지.
- G1 범위·권한 / G2 로컬 / G3 실제읽기 / G4 과거·웹 / G5 신규 / G6 답변관측 / G7 복구 / G8 운영을 각각 통과·진행·미시험·외부조건으로 보고해라.
- 첫 읽기, 원장 저장, 웹 표시, provider 접수, 원격 답변 관측은 서로 다른 결과다.
- 남은 작업은 code/권한/공식계약/운영적용/자료부재로 구분하고 다음 한 행동을 적어라.
- 한 기능이 막혀도 다른 허용 작업은 계속해라. 기능을 숨기거나 근거 없는 백분율로 완료를 선언하지 마라.
```

## 8. Temu CS

[텍스트 원본](prompts/08-temu.txt)

```text
SellerPilot Temu CS 전담 지시문

너는 Temu CS만 맡는다. 과거 자료 수집, 신규 수신, 웹 조회, 지원되는 답변과 원격 반영 확인, 중복 방지·장애 복구를 이 채널 안에서 끝까지 책임져라. 기존 구현을 재사용하고 계획 설명에서 멈추지 말고 실제 조사·수정·검증을 진행해라.

1. 기준과 시작 절차
- 공통 시작본 원본: /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908
- 전용 개발 폴더: /Users/kimchangheemac/dev/sellerpilot-cs-temu
- 예약 브랜치: codex/cs-temu-v1; 포트: 3218.
- 원본 HEAD: 3cb72144e991626fae98a30cf51022d9a1aa6b0b 및 미커밋 변경. HEAD/main만 복제하면 현재 CS 코드가 빠진다.
- 먼저 다음 문서를 읽어라:
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/AGENTS.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/README.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/ownership.json
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/channels/temu.md
  /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908/docs/cs-parallel/TEMPLATES.md
- 통합 담당이 만든 S0 ID와 자기 폴더 파일 해시를 검증해라. 준비돼 있으면 재사용한다.
- 아직 준비되지 않았으면 통합 원본은 읽기만 하고 공식 계약/계정/권한 조사와 첫 실제 읽기 준비를 진행해라. 8개 채팅이 각자 다른 시작본을 만들지 마라.
- S0 전에 조사 산출물이 필요하면 /Users/kimchangheemac/dev/sellerpilot-cs-handoff/temu/에 자기 자료만 기록하고, S0 후 자기 reports 경로로 옮겨라. 비밀·실고객 원문은 넣지 마라.

2. 현재 구현과 범위
after-sales 목록/상세, 초 단위 조회, 상세 10건 continuation, 현재14일/일일30일 읽기 후보가 있다. 앞선 Partner 앱 상태는 Inactive·Compliance Rejected였고 Buyer Chat 계약/권한은 미확보다. 현재 앱 상태는 다시 읽어 확인해야 한다.

필수 조사 범위: 지역·seller·app별 반품/환불 작업함 읽기와 이력 / Buyer Chat. 환불 승인 등 업무 mutation과 상담 수집을 구분한다.
이 상태는 계획 작성 당시 기록이다. 실제 계정·권한·건수는 현재 다시 읽어 확인해라.

3. 실행 순서
1. TEMU-01 — 실제 Partner 앱·지역·판매자 승인·compliance/security 상태와 필요한 미입력 값을 읽기 확인한다. 반려 항목은 실제 사업 사실과 연결해 구체적인 수정안·필요 자료로 정리하고 허위 사실을 넣지 않는다.
2. TEMU-02 — 앱이 활성이고 승인 credential이 있으면 고정 egress에서 after-sales 목록 read-only를 먼저 호출한다. 준비되지 않았으면 코딩/fixture/웹·DB 검증과 Chat 계약 조사는 계속한다.
3. TEMU-03 — parentaftersales.list.get의 초 단위 시간과 실제 반환 ID를 확인하고 parentaftersales.detail.get 상세를 10건 단위로 이어 읽는다. 목록 성공만으로 본문 수집 완료라 하지 않는다.
4. TEMU-04 — 현재 14일/최근30일보다 오래된 제공 가능 범위를 확정하고 날짜/상태/region별 고정 과거수집 계획을 작성해 공통 history 실행/UI 연결을 요청한다.
5. TEMU-05 — 고객 코멘트·사유·상태·환불금액의 원장/웹 표시를 검증하고 전화번호·주소 등 비허용 필드를 제외한다. 같은 ID 상세 변경과 중복 재조회는 revision으로 처리한다.
6. TEMU-06 — Buyer Chat의 공식 app 권한과 목록/상세/메시지/webhook/답변 계약을 확인한다. 승인 전 endpoint를 추측해 운영 호출하거나 기존 after-sales를 채팅으로 가장하지 않는다.
7. TEMU-07 — Chat 계약 확보 시 전용 모듈의 수신·이력·수신자/주문/최신 inbound 결속 답변·readback·복구를 구현한다. 권한 부족이면 정확한 외부 선행조건과 개발 가능한 부분을 구분해 제출한다.

첫 제출물: 첫 제출물은 앱 차단의 현재 정확한 원인·실제 필요한 입력/자료와 after-sales 로컬 경로 검증이다. 활성화가 되어 있다면 즉시 한 목록/상세 실제 읽기를 우선한다.

4. 파일 소유권
자기 worktree에서 다음 기존 파일만 직접 수정할 수 있다.
- lib/channels/temu-inquiries.ts
- tests/temu-after-sales-detail.test.ts
- tests/temu-after-sales-detail-db.test.mjs

새 코드는 ownership.json의 temu 전용 위치만 허용된다.
- lib/channels/cs/temu/, lib/cs/channels/temu/
- app/cs/channels/temu/, app/api/admin/cs/channels/temu/
- tests/cs-temu-*.test.ts 또는 .test.mjs, tests/fixtures/cs/temu/
- scripts/cs-temu-*.ts 또는 .mjs
- docs/cs-parallel/reports/temu/, proposals/temu/

공통 요청 대상: 공통 Temu response/서명/egress/credential은 상품과 공유하므로 통합 소유. 정규화·history 실행/UI·SQL 08046000·Buyer Chat capability 반영은 변경 요청으로 제출한다.
- inquiry-sync/reply, protocols, gateway/serverless, 공통 UI/history, OAuth·credential, supabase/migrations, package/lockfile/설정, 다른 채널 코드는 직접 수정하지 마라.
- 필요하면 자기 proposals/temu/에 현재 경로/함수/hash·재현 입력·기대 출력·최소 patch·회귀 시험·DB 초안을 작성하고 전용 개발을 계속해라.
- 요청서를 작성했다는 이유만으로 공통 연결 완료로 보고하지 마라. 통합본에 실제 반영된 결과를 검증해라.
- 상품 등록·재고·주문 상태·송장 전송 코드는 수정하지 않는다. CS의 주문/배송 맥락은 정확한 소유자/외부 주문번호 읽기 연결로만 사용한다.

5. 과거 전체와 유지 연동
- seller/app/country/shop/kind/상태/폴더별 최초 제공일과 고정 from/to·timezone을 기록해라.
- 최근30일/1년 복구를 과거 전체로 부르지 마라. 공급자 허용 창/페이지로 최초 제공 범위까지 이어가고 저장과 cursor 전진을 원자적으로 처리해라.
- 원격 고유 행을 정상/중복·기존/격리/근거 있는 제외/미처리로 대조해라. 티켓 수와 메시지 수는 별도다.
- 0건은 동일 계정·기간·상태로 검증하고, missing total은 unknown으로 유지해라.
- 빈 페이지+next, 반복 cursor, 반환상한, 중단 재개, 같은 창 재수집, 계정/shop 혼선, 늦은 답변, 새 문의 도착을 검증해라.
- API 밖 자료는 실제 공식 export/백업을 확인한다. 없으면 복구 불가 기간으로 남기고 가상 자료나 임의 parser로 완료를 만들지 마라.
- 미지원/권한대기 기능도 잔여 범위에 남긴다. 수동 수입/판매자센터 이동을 자동연동 100%에 합산하지 마라.

6. 검증
채널이 작성한 시험과 다음 관련 시험을 실행한다. 공통 시험 파일은 실행 가능하지만 수정은 통합 담당 소유다. Node 22/tsx와 저장소 lockfile을 따른다.

node --import tsx --test tests/temu-after-sales-detail.test.ts tests/temu-after-sales-detail-db.test.mjs tests/inquiry-sync-contract.test.ts tests/serverless-cs-gateway.test.ts tests/cs-history-channel-db.test.mjs


필수 반례: 초/밀리초 혼동·10/11개 상세 재개·상세 1개 실패·region/seller 불일치·같은 ID 수정·14/30일 경계·취소/환불 상태 변경·inactive 권한 차단·주소/연락처 유출 금지·읽기 전용 답변 차단.

격리 DB에서 provider fixture→정규화→저장→인증 UI를 검증한다. 실제 provider GET 결과를 격리 DB에서 확인하는 경우 권한이 확인된 최소 자료만 사용하고 원문을 Git/공유 보고서에 넣지 않는다. 관리자 권한 해제·세션 만료·다른 seller/shop 데이터 혼선도 확인한다. 타입검사/수정 파일 린트는 이 worktree에서 수행하며 .next와 테스트 출력은 공유하지 않는다.

완료 판정: after-sales 전체 제공범위·웹/원장·신규/복구를 닫고 Buyer Chat 실제 권한과 왕복을 검증해야 채널 전체 완료다. 앱 승인 소요를 개발 완료 약속에 포함하지 않는다.

추가 실행 규칙:
- Node 22와 기존 lockfile 사용. Next 코드를 쓸 때 설치된 node_modules/next/dist/docs의 관련 가이드를 먼저 읽어라.
- 로컬 앱은 격리 DB만 연결한다. 실제 provider 읽기는 범위가 고정된 수동 읽기 경로로 수행한다.
- 자기 채널 집중 시험/수정 파일 린트/타입 검사를 우선하고 전체 저장소 build/전체 DB suite 반복은 통합 담당에 맡겨라.
- 로그는 자기 경로에 저장하고 종료코드/소스 hash를 기록한다. 새 실패를 이전 baseline으로 단정하지 마라.
- 자기 포트/프로세스만 제어하고 다른 채널 서버나 공유 worker를 종료하지 마라.

7. 로그인과 실행 제한
- 준비된 판매자 로그인은 재사용한다. Chrome 사용 시 CHANGHEE 프로필을 read-only 목록으로 확인한 뒤 대상 seller/app/shop을 확인한다. Chrome 이메일과 판매자 ID는 별개다.
- 다른 채팅 탭의 이동·로그아웃·계정 전환 금지. Vercel/Supabase·저장 credential/refresh·공용 webhook 주소 변경은 통합 담당과 조정한다.
- 비밀번호·API 키·고객 원문을 문서/fixture/로그/소스에 기록하지 않는다.
- 커밋·푸시·배포·운영 DB 변경 금지. 로컬 우선이라는 사용자 지시가 기존 AGENTS closeout보다 우선한다.
- 실제 고객 답변은 승인된 티켓/내용이 있을 때만 전송한다. 승인 전에도 답변 코드·모의 응답·중복 방지·실행 준비는 완료해라.
- 이미 허용된 로컬 작업·읽기는 반복 허가를 묻지 말고 진행해라. 외부 인증이 필요하면 정확한 항목만 알리고 독립 가능한 작업은 계속해라.

8. 제출과 종료
- 자기 reports/temu/status.md와 delta.json에 시작본 ID, 변경 파일 before/after hash, 명령/종료코드/로그를 기록해라.
- 공통 시작본 S0 이후 자기 delta만 제출한다. 통합본 전체 복사나 HEAD 기준 전체 diff 제출 금지.
- G1 범위·권한 / G2 로컬 / G3 실제읽기 / G4 과거·웹 / G5 신규 / G6 답변관측 / G7 복구 / G8 운영을 각각 통과·진행·미시험·외부조건으로 보고해라.
- 첫 읽기, 원장 저장, 웹 표시, provider 접수, 원격 답변 관측은 서로 다른 결과다.
- 남은 작업은 code/권한/공식계약/운영적용/자료부재로 구분하고 다음 한 행동을 적어라.
- 한 기능이 막혀도 다른 허용 작업은 계속해라. 기능을 숨기거나 근거 없는 백분율로 완료를 선언하지 마라.
```


