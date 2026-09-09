# 1번 shopee 상품등록 실행 지시

사용자가 0번 중앙 + 채팅당 한 채널로 동시 재개를 지시했다. 이 문서가 이번 작업의 최신 범위이며 이전 고정 상품 복구/옛 중앙 역할/옛 소유권 지시는 폐기한다.

- 중앙 작업: 01a077b1-61db-7c20-a4a3-ae00dbbbef19
- 담당 작업: 01a0816c-228e-71b3-b868-ee612173c5f2
- 작업 폴더: /Users/kimchangheemac/dev/sellerpilot-product-shopee-20260909
- 브랜치: codex/product-shopee-20260909
- 기준 SHA: e8d821587a29933aebf31771672e56f515995245
- dev 포트: 3211; NEXT_DIST_DIR은 자기 작업 폴더 내 경로만 사용한다.
- Node PATH: /Users/kimchangheemac/.nvm/versions/node/v22.23.2/bin
- 모든 git 호출에 GIT_OBJECT_DIRECTORY=/Users/kimchangheemac/dev/sellerpilot-git-cache-20260909/objects 를 지정한다. 이 읽기 캐시는 삭제/정리하지 않는다.

## 바로 시작

위 새 폴더에서 pwd, git status, HEAD, 브랜치를 확인한다. node_modules는 이미 준비되어 있다. 이전 작업 폴더/브랜치/미커밋 변경은 그대로 두고 필요한 일반 채널 변경만 비교 후 선별한다. 이전 작업 내용을 통째로 복사하거나 과거 SKU/상품 예외를 되살리지 않는다. 시작 확인과 첫 검증 가능한 작업을 즉시 status.md에 남긴다. 계획만 쓰고 턴을 종료하지 말고 구현과 필요한 검증까지 계속한다.

먼저 새 폴더의 AGENTS.md, docs/channel-connections/shopee.md, docs/channel-connections/README.md, docs/channel-connections/product-recovery-retirement-20260909.md와 관련 Next.js 로컬 가이드를 읽는다. 계정/키/상품번호를 코드 상수로 박지 않는다.

## 채널 목표

실제 merchant/shop/region을 확인하고 SG를 첫 대상으로 삼는다. Global Item과 local item을 분리하여 카테고리·필수속성·브랜드·condition·seller_stock·물류·창고·대표/상세 이미지·현지 SGD와 global USD 필드를 일반화한다. 신규 생성→publish task 조회→shop item 재조회 흐름을 완결한다. 최신 코드에 이미 반영된 개선을 먼저 확인하고 과거 고정 SKU 또는 상품별 예외를 되살리지 않는다.

## 수정 소유권

직접 수정 가능: lib/product-registration/channels/shopee.ts, shopee 전용 lib/channels/shopee-*.ts 중 상품등록 파일, 새 lib/product-registration/shopee/ 모듈, 자기 상품등록 전용 테스트, docs/product-channel-parallel/reports/shopee/ 문서와 제안. CS/OAuth 공용/배송 파일은 이 패턴에 맞더라도 자동 소유가 아니다.

공통 파일은 0번만 통합한다: app/page.tsx, app/product-publish-workbench.tsx, app/channel-registration-fields.tsx, app/api/admin/channel-operations/route.ts, publish-context/remote-edit, lib/channels/protocols.ts, provider-listing-runtime.ts, commerce-provider.ts, listing-update.ts, listing-preflight.ts, marketplace-images.ts, catalog.ts, operation-availability.ts, gateway/worker, 공통 등록 draft/schema, DB migration 및 docs/현재상태.md. 필요한 공통 변경은 자기 reports 폴더에 대상 파일·현재 SHA256·최소 unified patch·필드 계약·회귀 증거를 적어 요청한다. 작은 제안이 준비되면 바로 중앙에 보내고 나머지 독립 작업을 계속한다.

다른 채널/CS/배송 담당을 재개하거나 새 작업·하위 에이전트·자동화를 만들지 않는다. 다른 작업 폴더와 중앙 폴더는 읽기만 한다. 로컬 커밋은 자기 소유 파일에 한해 가능하나 origin/integration-aside·Vercel remote push, 배포, 운영 SQL, gate 변경은 0번 소유다. 이 제출 규칙이 해당 폴더 AGENTS의 일괄 push closeout을 대신한다. 자기 docs/현재상태.md는 건드리지 말고 status.md로 제출한다.

## 브라우저와 외부 실행

사용자가 이미 제공한 로그인 세션·계정 정보를 사용한다. 비밀번호·토큰·키 원문은 문서/메시지/Git에 적지 않는다. 판매자/개발자 센터는 Chrome CHANGHEE 계정 식별을 먼저 읽기 검증하고, 현재 Aside에서 작업 중인 경우 사용자의 기존 세션 예외를 따른다. 다른 채널 탭·프로필/로그아웃을 건드리지 말고 자기 채널 탭만 사용한다. Vercel/Supabase의 공유 브라우저·공유 상품 승인값 변경은 중앙에 요청한다. 새 로그인 필요 시 정확한 단계만 알려 주고 독립 개발은 계속한다.

실제 신규 등록은 사용자 승인된 목표지만 중복 실행을 막기 위해 현재 판매자/market/shop/SKU/상품·승인 가격·재고·이미지·요청 식별자를 0번에 먼저 등록하고 실행 담당을 하나로 확정한다. 실제 provider 쓰기/중앙 draft 저장은 그 실행 배정 뒤 진행한다. 일반 개발·로컬 fixture·단위검사·공식 문서·허용된 read-only 조회에는 추가 승인을 요구하지 않는다. 차단된 동일 호출을 반복하지 않고 원인에 따른 수정 후 재검증한다. 판매자센터 수동 입력을 SellerPilot 프로그램 등록 성공으로 보고하지 않는다.

## 제출과 완료 기준

docs/product-channel-parallel/reports/shopee/status.md 와 status.json에 기준 SHA, 현재 상태, 변경 파일, 검사 명령/결과, 실제 연결 증거, 필요한 공통 패치와 다음 행동을 기록한다. 단계별 accountVerified, requiredFieldsVerified, localFlowPassed, integrated, providerCreated, remoteReadbackVerified 를 true/false/unknown 및 증거로 분리한다. 과거 상품 복구/기존상품 조회/HTTP202/fixture 통과를 새 상품 실제 등록으로 계산하지 않는다.

시작 시 중앙에 실제 worktree/HEAD/소유파일/상태 경로를 한 번 알리고, 이후에는 통합 요청·필수 사용자 입력·완료 같은 의미 있는 변화만 보내라. send_message_to_thread 대상은 반드시 01a077b1-61db-7c20-a4a3-ae00dbbbef19 이다. 중앙 메시지 답장을 기다리는 동안 가능한 다음 독립 작업을 진행한다. 외부 심사/인증만 남으면 로컬 완료와 외부 대기를 정확히 나눠 기록한다.

