# CS 채널별 독립 개발·통합 계획 — 2026-09-08

바로 사용할 채팅 지시문: [통합 담당 1개와 채널별 8개 전체 복사본](COPY-PASTE.md). 각 항목의 텍스트 원본도 함께 제공한다. 0번 통합 담당이 S0와 전용 폴더를 준비하고, 1~8번은 지정한 자기 폴더에서 개발한다.

## 1. 이번에 바꾸는 작업 방식

목표는 8개 채널을 각각 담당하는 8개 채팅과, 공통 코드·DB·통합을 담당하는 현재 채팅으로 나누는 것이다. 채널 담당은 계약 조사부터 수집·이력·답변·웹 검증까지 자기 채널을 책임진다. 통합 담당은 채널 결과를 연결하고 배포 후보를 만든다. 새 채팅 생성과 개발 재개는 아직 실행하지 않았다. 이 문서는 실행 가능한 분업 설계다.

2026-09-08 17:52 KST 읽기 점검에서 통합 폴더에 변경 227개(추적 변경 85개, 미추적 파일 142개)가 있었다. 미추적 migration 24개에는 CS 외 변경도 포함된다. HEAD만 복제하면 상당한 CS 구현이 빠진다. 현재 기준은 다음 경로의 HEAD와 미커밋 변경 전체이며, 원래 Documents 폴더나 /tmp의 동명 폴더가 아니다.

- 기준 작업 폴더: /Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908
- 기준 HEAD: 3cb72144e991626fae98a30cf51022d9a1aa6b0b
- 사용자 제한: 로컬 우선, 커밋·푸시 금지. 배포·운영 DB 변경은 현재 실행 범위에 포함하지 않는다.
- 현재 완전 운영 검증 채널: 0/8. 이 문서 작성으로 진척률이 올라간 것으로 계산하지 않는다.

이전 44.2%는 implemented=1, conditional=0.5라는 임의 가중치로 26개 기능 행을 계산한 관리 지수다. 운영 증거를 측정한 완성도가 아니다. 61.5%도 조건부 행을 포함한 코드 존재 비중이다. 앞으로 완료 보고는 아래 단계와 실제 분모로 한다.

## 2. 오래 걸린 구조적 이유와 수정

| 확인한 문제 | 이번 분업에서의 조치 |
|---|---|
| inquiry-sync.ts 1,050행, protocols.ts 2,181행 등 여러 채널이 동일 파일에 분기를 추가 | 공통 파일은 통합 담당만 수정. 채널 변환·검증은 전용 파일로 제출 |
| 6개 채널 신규 SQL이 같은 sellerpilot_service_ingest_inquiries를 rename/wrap | SQL 파일이 달라도 같은 DB 객체면 공통 변경. 통합 담당이 순서·preimage·ACL·통합 replay를 책임짐 |
| 미커밋 시작본이 많고 서로 다른 worktree HEAD가 혼재 | 동일 소스 스냅샷 S0와 해시 manifest를 만든 뒤 복제. 작업자별 소스 변경분만 제출 |
| 웹의 날짜 지정 이력 수집은 쿠팡·스마트스토어·11번가만 지원 | 나머지 채널도 고정 기간과 shop별 재개 가능한 과거수집 실행/조회 연결을 요구 |
| 최근 30일 복구와 과거 전체 완료가 혼용 | 최초 제공일·최종일·상태·폴더·shop을 고정한 이력 범위표로 대조 |
| 코드 테스트와 실제 연결 완료가 함께 보고됨 | 로컬 통과 / 실제 읽기 / 웹·원장 대조 / 답변 관측 / 운영 복구를 따로 판정 |
| 공통 변경마다 전체 저장소 검사를 반복 | 채널별 집중 검사, 공통 변경 영향 검사, 통합 시 전체 검사. 같은 소스의 통과 검사는 불필요하게 재실행하지 않음 |
| 권한이 없는 추가 기능이 기존 기능 검증까지 붙잡음 | 핵심 흐름을 먼저 닫고 추가 기능은 별도 작업. 미지원 범위를 숨겨 채널 100%라고 하지 않음 |

12시간의 세부 소요를 계측한 기록은 이번에 확인하지 않았다. 위 항목은 현재 코드와 작업 트리에서 확인한 지연·충돌 요인이다. 제공하지 않는 API나 외부 승인 시간을 코딩 시간으로 해결했다고 약속하지 않는다.

## 3. 채팅별 배정

| 채팅 | 1차 완주 대상 | 2차 미완료 범위 | 전용 계획 |
|---|---|---|---|
| 쿠팡 CS | 상품·콜센터 문의와 반품·취소·교환 읽기, 기간별 대조 | 재문의/이관 답변 관측, 전체 메뉴·후기 포함 여부 확정 | [coupang](channels/coupang.md) |
| 스마트스토어 CS | 상품·네이버페이 고객 문의 전량 이력·답변 관측 | 톡톡·리뷰의 별도 공식 연동/자료 수입 | [smartstore](channels/smartstore.md) |
| Qoo10 CS | MSG·HELP·ITEM 문의와 클레임 읽기 전량 대조 | 긴 대화의 동일성, 리뷰·댓글 계약/자료 수입 | [qoo10](channels/qoo10.md) |
| 11번가 CS | couplit/커플릿의 상품 Q&A 실제 읽기·이력·답변 관측 | 셀러톡·긴급알리미·리뷰 분류 및 별도 경로 | [elevenst](channels/elevenst.md) |
| Shopee CS | 실제 연결 shop 전수의 후기·Returns 읽기 | Buyer Chat 권한·webhook·이력·답변 | [shopee](channels/shopee.md) |
| Lazada CS | CS Bot grant와 IM bootstrap/Push/답변 연결 | 카드·회수·원문 재처리·첨부 보관, 리뷰/사후지원 범위 | [lazada](channels/lazada.md) |
| eBay CS | ASQ·Trading Inbox·Commerce Message 대조 | 케이스·분쟁, 중복 수신과 답변 권한 구분 | [ebay](channels/ebay.md) |
| Temu CS | 앱/판매자 권한 확정, after-sales 목록·상세 대조 | Buyer Chat 계약·수신·이력·답변 | [temu](channels/temu.md) |
| 현재 채팅: 통합 | 시작본·공통 계약·DB·공통 UI·충돌검사·통합 검증 | 운영 적용 범위가 열리면 단독 release 담당 | 본 문서 |

쿠팡을 첫 핵심 흐름 통합 대상으로 우선한다. 현재 구현한 세 종류가 있고 새 Chat 계약 의존도가 상대적으로 작기 때문이다. 실제 읽기에서 외부 차단이 나오면 이미 읽기를 통과한 채널을 먼저 통합한다. 다른 7개 담당은 자기 조사·전용 코드·시험을 계속한다. 전체 채널 100% 선언은 모든 필수 범위가 닫힌 뒤에만 한다.

## 4. 시작본 S0와 작업폴더: 통합 담당이 한 번만 준비

단순히 최신 main에서 새 worktree를 만들면 안 된다. 다음 절차를 완료하기 전에는 새 폴더가 준비됐다고 보고하지 않는다.

1. 현재 CS 통합 폴더의 수정자가 없는 시점에 HEAD, tracked 수정/삭제, 필요한 untracked 소스·시험·migration·문서를 확인한다. 상품/배송의 기존 변경도 시작본에는 보존하지만 CS 작업자에게 수정권을 주지 않는다.
2. Git commit/stash 없이 로컬 스냅샷을 만든다. tracked binary diff와 미추적 파일 원본을 보존하고, 삭제 목록·실행 비트·각 파일 SHA-256·기준 HEAD를 manifest에 기록한다. 비밀/개인정보 스캔 후 제한된 로컬 경로에 보관한다.
3. .git, .env*, OAuth/Chrome 자료, 로그, 실고객 원문, node_modules, .next, .vinext, dist, 임시 QA 결과를 복제 묶음에서 제외한다. 필요한 익명 fixture와 설정 템플릿은 별도로 목록화한다. 제외된 파일 때문에 의존성이 빠졌는지도 검사한다.
4. 각 폴더를 동일 HEAD에서 생성하고 S0의 수정·신규·삭제를 그대로 반영한다. 생성만으로 소스가 같다고 하지 말고 manifest를 대조한다. worktree 생성은 커밋을 만들지 않는다. 생성할 브랜치는 codex/cs-<channel>-v1, 기존 동명 브랜치는 덮어쓰지 않는다.
5. Node 22와 동일 lockfile을 사용한다. 의존성은 공유 캐시에서 각 폴더에 설치하며 lockfile 업데이트를 하지 않는다. .next/.vinext/tsbuildinfo/테스트 출력은 폴더별로 분리한다.
6. 8개 채널 폴더에는 운영 scheduler/worker 자동 실행 설정을 넣지 않는다. 로컬 앱은 격리 DB만 사용한다. 실제 API 읽기는 채널이 고정된 수동 probe와 읽기 credential 경로로 수행하고 운영 원장을 로컬 서버에서 변경하지 않는다.
7. S0의 알려진 실패 목록을 실패 이름·경로·원인·환경·로그 위치로 고정한다. 이전 숫자만 근거로 새 실패를 baseline이라 하지 않는다. 최신 전체 MJS는 1,658 중 1,629 통과·29 실패였고, 현재 TS 마지막 실행은 실패 종료했으나 최종 집계가 회수되지 않았다. 이를 전부 통과한 시작본으로 부르지 않는다.
8. 통합 담당이 S0 ID와 경로 준비 완료를 기록한 후 각 채팅에서 코딩을 시작한다. 그전에는 현재 기준본을 읽어 계약 조사와 체크리스트 작성만 가능하다.

예약할 경로와 포트(아직 생성·기동하지 않음):

| 채널 | 별도 폴더 | 로컬 포트 |
|---|---|---:|
| coupang | /Users/kimchangheemac/dev/sellerpilot-cs-coupang | 3211 |
| smartstore | /Users/kimchangheemac/dev/sellerpilot-cs-smartstore | 3212 |
| qoo10 | /Users/kimchangheemac/dev/sellerpilot-cs-qoo10 | 3213 |
| elevenst | /Users/kimchangheemac/dev/sellerpilot-cs-elevenst | 3214 |
| shopee | /Users/kimchangheemac/dev/sellerpilot-cs-shopee | 3215 |
| lazada | /Users/kimchangheemac/dev/sellerpilot-cs-lazada | 3216 |
| ebay | /Users/kimchangheemac/dev/sellerpilot-cs-ebay | 3217 |
| temu | /Users/kimchangheemac/dev/sellerpilot-cs-temu | 3218 |

공용 Supabase를 8개 개발 서버가 함께 쓰지 않는다. 기본 계약 시험은 PGlite의 개별 DB, 인증 UI 시험은 채널별 격리 DB/schema·테스트 계정 또는 통합 담당의 단일 인증 시험 환경에서 순서대로 실행한다. PGlite 결과가 실제 Postgres 다중 세션 lock·RLS·백업 복원을 입증한다고 하지 않는다.

## 5. 파일 소유권

정확한 허용 파일과 새 디렉터리는 [ownership.json](ownership.json)에 있다. 기본 정책은 deny다. 파일명이 shopee/temu 등으로 시작해도 상품·OAuth 공유 코드면 채널 담당 소유가 아니다. 담당 외 파일은 읽을 수 있지만 직접 고치지 않는다.

통합 담당만 수정하는 범위:

- lib/channels/inquiry-sync.ts, inquiry-reply.ts, inquiry-coverage.ts, reply-verification.ts, protocols.ts, sync-arguments.ts
- lib/channels/catalog.ts, operations.ts, operation-availability.ts, gateway*.ts, serverless-*.ts, provider-rate-budget.ts, cs-credential-binding.ts
- 공유 OAuth/credential/refresh/exact 계보 코드. CS 권한 추가 때문에 상품·주문 인증을 교체하지 않는다.
- lib/cs의 공통 archive/conversation/history/import/scope-health/credential/recovery 계약
- app/page.tsx, app/use-operations-snapshot.ts, app/channel-readiness-data.ts, app/cs-release-state.ts
- app/cs의 공통 타임라인·이력·상태·import 화면, app/api/operations/sync, 공통 cs/reply·archive·worker·maintenance route
- scripts/ai-cli-worker.mjs와 공용 실행 설정, package.json/lockfile/tsconfig/Next 설정
- supabase/migrations 전체와 모든 공통 DB 함수·권한·schedule
- 공통 테스트, docs/현재상태.md, 현재 통합 문서와 전체 지표

상품 등록·가격·재고·주문 상태·송장 전송 코드는 이번 작업의 수정 대상이 아니다. CS는 주문/상품/배송 맥락을 권한이 확인된 읽기 모델로만 연결한다. 환불 승인·교환 승인·주문 취소는 CS 답변과 구분한 별도 업무 mutation이며 이번 분업에서 임의 구현·실행하지 않는다.

## 6. 공통 수정 때문에 작업을 멈추지 않는 방법

새 플랫폼 프레임워크를 전면 구축하지 않는다. 현재 execute<Channel>Inquiry 및 정규화 타입을 재사용하고 필요한 채널 함수만 전용 파일로 분리한다.

- 각 채널은 lib/channels/cs/<channel>/에 순수 normalizer, 날짜/페이지 계획, reply argument 검증, readback verifier, capability 설명, 공식 export parser를 추가할 수 있다.
- 새 파일은 기존 공통 타입을 type-only import한다. 이미 같은 기능이 있는 전용 파일을 중복 신설하지 않는다. runtime CS→상품등록 import는 금지한다.
- 공통 dispatch/UI/DB 연결이 필요하면 proposals/<channel>/에 변경 요청을 제출한다. 경로, 현재 함수·분기, 기존/새 입력출력, source hash, 정확한 변경안, 영향 시험, 선행 조건을 적는다.
- 통합 담당은 한 번에 한 요청을 반영하고 현재 통합본으로 검증한다. 작업자는 순수 함수·어댑터·익명 fixture 시험을 계속한다. 임시 stub으로 실제 연결이 된 것처럼 상태를 바꾸지 않는다.
- 인터페이스 변경은 version과 호환 adapter를 동반한다. 필드명, ticket ID, inbound key, credential binding, cursor, ACK/observed 의미를 채널이 독자 변경하지 않는다.
- 필요한 시점에만 채널 함수 추출을 한다. 추출과 동작 변경을 분리해 기존 결과의 동등성을 먼저 검사한다.

공통 요청 우선순위는 실제 첫 읽기/웹 표시를 막는 것 → 데이터 오연결·손실 → 중복 전송 → 과거 누락 → 추가 기능이다. 통합 담당이 채널 코드를 대신 재작성하는 병목을 만들지 않는다.

## 7. DB 충돌 방지와 통합 순서

현재 다음 파일은 이름이 서로 달라도 같은 ingest 함수를 감싼다: 08044000(eBay), 08045000(Shopee), 08046000(Temu), 08047000(쿠팡), 08048000(Qoo10), 08049000(11번가). 11번가는 reply enqueue와 history에도 영향을 준다.

1. 채널 담당은 SQL을 proposals/<channel>/에 초안으로 작성하고 PGlite 계약 시험을 함께 제출한다. supabase/migrations에 직접 번호를 만들거나 기존 파일을 고치지 않는다.
2. 통합 담당만 실제 migration 번호를 배정한다. scripts/check-migration-version.mjs로 로컬 중복/날짜 형식을 검사하고, 실행 전에 운영 version·name·source hash까지 읽어 대조한다.
3. 공통 ingest/reply/history 함수 변경은 전체 최종 함수와 wrapper 순서로 검토한다. 두 파일이 같은 이름을 rename하거나 다른 preimage를 기대하면 통합 전 해결한다.
4. channel별 격리 fixture 통과 뒤 전체 migration 순서 replay와 기존 8채널 행의 불변 검사를 한다. RLS·GRANT·SECURITY DEFINER·search_path를 유지한다.
5. 원문·이력·답변 원장/인증 공통 기반 → 기존 채널별 지원 migration의 의존 순서 → 새 채널 연결 변경 → health/이력 UI 순으로 통합한다. 채널 실행 우선순위와 migration 적용 순서는 별개다.
6. 현재 프리플라이트의 22개 표는 11번가 08049000을 포함하지 않는 옛 적용안이다. 운영 전에 최종 집합과 해시를 다시 생성한다. 24개 미추적 SQL을 전부 CS라고 묶어 실행하지 않는다.
7. 앱 rollback과 additive DB 호환을 별도로 검증한다. 불확실 답변/과거 job/기존 원장을 삭제해 테스트를 통과시키지 않는다.

## 8. 채널별 필수 산출물과 완료 게이트

각 채널 보고는 상태를 다음 8개 열로 기록한다. 불가능/미제공도 해당 범위의 미완료 제한으로 남긴다. 개발률을 높이기 위해 분모를 줄이지 않는다.

| 게이트 | 합격 증거 |
|---|---|
| G1 범위·권한 | 실제 seller/account/app/country/shop × 문의종류 목록, 공식 계약/보존기간, 읽기 권한 확인. 로그인만으로 합격하지 않음 |
| G2 로컬 경로 | provider fixture→전용 adapter→정규화→DB→인증 UI, 채널별 집중 시험·타입/린트, 실패 재현 수정 |
| G3 실제 읽기 | 고정 계정·기간·상태·shop의 실제 read-only API 응답. HTTP 200이라도 권한·형식·종료 계약을 검사 |
| G4 이력·웹 대조 | 같은 범위의 원격 고유 ID와 원장·메시지·웹을 비교. 시작일/종료일·gap·격리·제외를 명시 |
| G5 신규 수신 | 신규 또는 승인 시험 이벤트의 정확한 생성/노출/수신/저장/화면 시각과 중복 0. 무이벤트는 미시험 |
| G6 답변 관측 | 답변 지원 기능에 한해 승인된 티켓·문구의 실제 전송 뒤 원격 동일 대상/본문 관측. ACK≠관측 |
| G7 복구 | 중단·429·만료·재시작·동시 클릭·외부 선답변·신규 문의·계정 혼선·첨부 만료 회귀 |
| G8 운영 적용 | 동일 소스/DB hash, 실제 scheduler와 권한, 일일 복구 2회 및 지정 관측 기간. 로컬 통과와 구분 |

현재는 로컬 개발과 읽기 검증까지 진행 가능한 범위다. 운영 적용과 실제 고객 답변은 기존 제한을 유지하고 실행 가능한 결과를 먼저 준비한다. 실제 답변은 승인된 티켓·문구가 없으면 송신을 제외하고 준비 상태를 명시한다. 사용자에게 이미 확인된 계정/허용 작업은 반복 질문하지 않는다.

채널 담당은 보고서에 G1~G8, 남은 항목, 원인(code/credential/provider/운영적용/자료부재), 다음 단일 행동을 기록한다. 상품 문의 핵심 흐름이 먼저 통과하면 그 정확한 기능을 완료로 보고하고, 전체 채널 완료와 구별한다.

## 9. 과거 전체 수집의 구체적 종료 조건

- 계정·shop·종류·상태·폴더마다 API 최초 제공일, 자료 보존 시작, 실제 판매 시작, 요청 범위를 따로 기록한다.
- 최근 30일/1년 복구와 전체 보관 이력은 별도다. 선택 기간을 고정하고 작은 공급자 허용 창으로 분할, 페이지 저장과 cursor 전진을 원자적으로 처리한다.
- 외부 행의 각 결과를 정상/기존·중복/격리/근거 있는 제외/미처리로 대조한다. 티켓 수와 메시지 수를 같은 수로 맞추지 않는다.
- 원격 총수나 ID 전체를 제공하지 않으면 공식 페이지 종료 계약과 판매자센터 동일 필터 대조를 사용하고 증거 수준을 명시한다.
- 같은 창 재실행으로 중복 0, 중간 중단 후 누락 0, 구간 경계의 ID 누락 0을 확인한다.
- API 보존기간 밖 자료는 공식 export·기존 백업 원본의 존재를 조사한다. 없으면 복구 불가 기간을 표시한다.
- 공식 CSV가 실제로 없으면 임의 CSV 형식을 만들어 완성했다고 하지 않는다. 수동 업로드/판매자센터 이동은 자동연동 완료율에 합산하지 않는다.
- 0건 scope는 같은 판매자·기간·상태로 0건 근거를 남긴다. 최근 미답변 0건으로 과거 전체 0건을 추정하지 않는다.

## 10. 테스트·통합·운영 자원 규칙

- 채널 담당: 자기 기존 집중 시험 + 새 기능/버그 회귀 + 타입/수정 파일 린트. 기본 자동 검사에서는 실제 provider 송신을 하지 않는다.
- 통합 담당: 새 공통 변경에 연결된 route/serverless/DB/경계 시험. 채널을 하나 반영할 때 나머지 7개 최소 fixture smoke도 실행한다.
- 전체 TS/MJS·build:vercel은 통합 후보 소스에서 한 번 실시한다. 추가 변경/실패가 영향을 주는 경우 해당 범위만 재실행한다. 결과는 파일로 저장해 잘린 콘솔 때문에 다시 돌리지 않는다.
- 같은 Mac에서 큰 build/전체 DB suite는 하나씩 실행한다. 다른 채팅은 계약 조사·전용 코딩·경량 집중 검사를 진행한다.
- 8개 로컬 프로세스가 provider scheduler를 동시에 실행하지 않는다. 실제 rate quota/고정 egress/credential 교체는 채널 scope로 소유하고 공통 runtime은 통합 담당 하나만 제어한다.
- CHANGHEE Chrome은 판매자 작업, JEONGHUN은 Vercel/Supabase 작업. 사용 전 read-only profile inventory와 대상 seller/team/project 확인. 11번가 seller ID는 couplit이며 Chrome 이메일과 별개다. 문서에 비밀번호·API 키를 넣지 않는다.
- 브라우저는 채널별 탭을 따로 사용한다. 다른 채팅의 탭 이동·로그아웃·계정 전환 금지. Vercel/Supabase/공용 OAuth 연결과 webhook public URL 변경은 통합 담당 경유.
- 준비된 로그인은 재사용한다. API 권한은 따로 확인한다. 외부 승인 제출이나 실제 인증 변경이 필요하면 현재 권한 범위에 따라 구체적 변경안을 준비한 뒤 처리한다.

## 11. 제출과 충돌 검사

1. 변경 파일, before/after SHA-256, S0 ID, 수정 이유, 삭제 여부, 새 fixture 목록을 reports/<channel>/에 기록한다.
2. Git HEAD와 diff하면 S0의 227개 기존 변경이 섞인다. 반드시 S0 manifest와 비교한 이번 채널 delta만 제출한다. 통합본 전체 덮어쓰기와 git add .은 금지한다.
3. ownership.json 허용 범위 밖이면 자동 반영하지 않는다. 공유 변경은 proposals/<channel>/의 별도 요청으로 검토한다.
4. 통합본 before hash가 S0/합의된 공통 버전과 다르면 현재 내용을 다시 읽고 조정한다. 강제 patch/rebase로 남의 변경을 밀어내지 않는다.
5. 채널 delta→공통 연결→채널 검증→다른 채널 smoke→완료표 순으로 한 채널을 닫는다. 통합 소스가 확정되면 최종 전체 검증과 운영 적용안을 만든다.
6. 각 결과 문서에는 명령·exit code·통과/실패·소스 hash·환경·시각·민감정보 제외한 evidenceRef가 있어야 한다.

실제 연결 문제를 한 번의 401/403이나 0건 결과로 일반화하지 않는다. 같은 오류를 반복 호출하지 말고 원인을 seller/app/token/IP/scope/contract 단위로 좁힌 뒤 실행한다.

## 12. 새 채팅 시작 방법

각 채널 문서 끝의 시작 지시문을 해당 채팅에 붙여 넣는다. 시작본 준비 전에는 문서 조사만, S0가 준비되면 지정된 자기 폴더에서만 개발한다. 현 채팅은 통합 담당으로 남긴다. 채널 간 수정 파일이 겹치면 기능 단위 약속으로 넘기지 말고 파일 소유권을 먼저 정정한다.
