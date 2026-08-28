# SellerPilot 멀티채널 커머스 운영센터

Qoo10 Japan, Shopee, Lazada, 쿠팡, 11번가, 네이버 스마트스토어, eBay, Temu의 상품 등록, 판매, 주문, 재고와 CS를 한곳에서 관리하는 AI 커머스 운영 서비스입니다. 11번가는 운영 OPEN API Key·등록 IP의 상품 읽기와 2026-08-24 실제 `listing.create` 성공까지 확인했으며, Seller Office 화면 재대조와 실주문 기반 배송 쓰기·문의 API 검증은 별도 제한으로 표시합니다. Alibaba와 1688은 비활성 준비 채널입니다.

- 운영 URL: `https://sellerpilot-global.vercel.app`
- 인증·DB·비밀 저장소: Supabase Auth · Postgres · Vault
- 배포: Vercel Production
- 운영 데이터: 관리자별 Supabase 운영 원장 · 첫 접속 시 화면 검증용 데이터 1회 생성

## 현재 구현된 화면

- 관리자 ID·PW 로그인 화면
- 7일·30일·90일 통합 대시보드
- 이번 달 판매 1위부터 10위까지의 상품 랭킹과 채널별 성과
- 상품 원장, 재고, 판매량, 채널 등록 상태
- 대표사진 필수, 정면·후면·좌우·상하·라벨·바코드 및 다중 추가 사진을 지원하는 AI 상품 등록 센터
- 상품 간략 설명과 공개 참고 링크를 이미지 분석에 함께 반영하는 입력 흐름
- 원가·물류비·수수료·환율·광고비를 반영해 8개 활성 채널의 순이익, 손익분기점과 목표 마진 판매가를 비교하고 운영 DB에 저장하는 마진 계산
- 통합 주문·출고·배송 화면
- 다국어 CS 통합함과 AI 답변 초안
- Qoo10, Shopee, Lazada, 쿠팡, 11번가, 네이버 스마트스토어, eBay, Temu 채널별 운영 페이지
- Supabase Vault 기반 8개 활성 판매채널의 키 버전, 만료일, 교체주기, 사전경고, 롤백 유예, 연결검사, 감사기록 관리
- Qoo10 QAPI, Shopee Open Platform, Lazada OAuth, 쿠팡 HMAC, 네이버 Commerce OAuth, eBay User OAuth, Temu Partner API 프로토콜과 채널별 기능 지원표
- 8개 활성 채널의 공식 카테고리·상품·가격·재고·주문·배송 실행 계층, 관리자 검수 UI와 멱등키 기반 중복 방지 원장. 운영키나 승인 범위가 없는 기능은 실행 전에 차단하고 실제 연결로 표시하지 않음
- ChatGPT OAuth 기반 로컬 Codex CLI 작업자와 `codex-image`를 이용한 상품 분석·상세페이지 기획·대표 연출컷과 3종 썸네일 생성

## ChatGPT CLI AI 작업자

SellerPilot은 OpenAI API Key를 사용하지 않습니다. ChatGPT OAuth와 로컬 이미지 도구가 필요한 AI 이미지 제작만 ChatGPT에 로그인된 Mac 작업자에서 실행합니다. 관리자가 `API 관리` 화면에서 범위가 분리된 일회성 토큰 세트를 발급하고 설치를 확인해야 기존 토큰이 원자적으로 폐기되며, 토큰 원문과 ChatGPT 자격정보는 macOS 키체인 밖으로 저장하거나 전송하지 않습니다. 운영에서는 AI 전용 런타임을 사용하고, 판매채널 작업은 아래의 Vercel 서버 경로가 지원하는 범위에서 로컬 작업자로 자동 우회하지 않습니다.

```bash
codex login status
npm run ai:worker:install:ai-only -- --rotate-token --token-set <API 관리 화면의 세트 ID>
npm run ai:worker:status
```

설치기는 세 범위 토큰을 원자적으로 교체하되 처음부터 자동실행 프로세스를 `--ai-only` 모드로 기동합니다. 판매채널·스케줄러 토큰은 세트 활성화 증명에만 사용되고 로컬 프로세스가 해당 큐를 가져오지 않습니다. `ai:worker:status`에서 `AI 전용 모드`를 확인하기 전에는 운영 전환이 완료된 것으로 보지 않습니다.

Vercel은 비공개 Supabase 작업 큐, 지원되는 상품 등록·수정·중지, 재고·배송, Shopee·Lazada·eBay OAuth 교환, 문의 동기화·답변, 서명된 이미지 URL과 판매채널용 이미지 전송 준비를 처리합니다. 작업은 채널·operation 허용표, claim token, lease heartbeat, 외부 mutation fence와 원자적 완료 원장을 모두 통과해야 하며, 결과가 불명확하면 재전송하지 않고 `reconciliation_required`로 남깁니다. ChatGPT OAuth 자격은 Mac 밖으로 전송하거나 저장하지 않습니다. AI 이미지 생성은 설치된 [`wjb127/codex-image`](https://github.com/wjb127/codex-image) 스킬과 Codex 내장 `image_gen`만 사용하며, 실패한 작업을 예시 결과로 바꾸지 않습니다.

Temu는 모바일·웹 클라이언트나 로컬 AI 작업자가 직접 호출하지 않습니다. 모든 요청은 SellerPilot API와 Supabase 원장을 거치며, Vercel Static IP가 Temu 개발자센터에 등록되고 데이터베이스 정책과 요청별 egress attestation까지 일치할 때만 서버가 실행합니다. 설정이 없거나 IP를 검증하지 못하면 Temu 작업은 외부 호출 전에 `STATIC_EGRESS_REQUIRED`로 차단되고 다른 작업자로 자동 우회하지 않습니다. 같은 이중 차단은 쿠팡·스마트스토어·11번가에도 적용합니다.

기본 모델은 Codex CLI의 `gpt-5.6-sol`이며 필요할 때만 `SELLERPILOT_CODEX_MODEL` 환경변수로 바꿀 수 있습니다. 작업자는 시작할 때 `codex login status`가 `Logged in using ChatGPT`인지 확인하고, 셸에 남아 있는 `OPENAI_API_KEY`는 자식 프로세스에 전달하지 않습니다.
- 서비스 전체 흐름을 설명하는 화면형 스토리보드
- PPT 31장 기반 175개 항목의 개발 상태와 실계정 검수 상태를 분리한 인수 대시보드
- Coinbase Data API의 현재 시장 참고 환율을 서버에서 60초 단위로 조회하고, 장애 시 Frankfurter v2 중앙은행·기관 일일 기준값으로 명시적으로 대체하는 환율 위젯

공개 회원가입과 데모 계정은 제공하지 않습니다. 관리자 초대 계정으로만 로그인할 수 있으며, 실제 API가 연결되지 않은 상태를 운영 완료로 오인하지 않도록 화면과 실계정 준비도에서 `임의 데이터`, `미연결`, 차단 사유를 분리해 표시합니다. 개발 완료와 실검수 기준은 [PPT 175개 개발·실검수 기준선](docs/PPT_175_개발_실검수_기준선.md)을 따릅니다.

## 기획 문서

- [멀티채널 커머스 운영센터 스토리보드](docs/멀티채널_커머스_운영센터_스토리보드.md)
- [무인 상품등록 자동화 구축 검토 및 실행계획](docs/무인_상품등록_자동화_구축_계획.md)
- [판매채널 API 기능차이 및 연결 보고](docs/판매채널_API_기능차이_및_연결보고.md)
- [판매채널 실행 API 계약](docs/판매채널_실행_API_계약.md)

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
pnpm install
pnpm dev
```

배포 빌드와 테스트:

```bash
pnpm build
pnpm test
```

Supabase·Vercel·채널 계정 적용 순서는 [운영 배포·인증 체크리스트](docs/운영_배포_인증_체크리스트.md)를 따릅니다.

## 선택형 해외 마켓 동일상품 검색

Shopee·Lazada·Temu 판매자 API는 판매자 본인 상품 관리에 사용하며 마켓 전체 검색으로 대체하지 않습니다. 해외 마켓 동일상품 후보가 필요하면 서버 전용 `BRAVE_SEARCH_API_KEY`를 설정하고 경쟁가 공급자 registry의 `enableMarketplaceWeb` 옵션을 명시적으로 켭니다. 이 공급자는 Brave Web Search의 공식 `site:` 검색만 사용하며, Shopee·Lazada·Temu 공식 상품 호스트와 상품 URL 패턴을 다시 검증합니다. Brave 응답의 구조화 `product`/Schema.org 데이터에 가격이 있고, 통화가 명시되었거나 단일 통화를 사용하는 공식 국가 도메인으로 확인된 후보만 채널별 최대 3개까지 반환합니다. 검색 공급자를 설정하지 않았거나 구조화 가격·통화를 확인하지 못하면 추정값을 만들지 않고 공란 상태를 유지합니다.

- API 문서: [Brave Web Search](https://api-dashboard.search.brave.com/api-reference/web/search/get)
- 검색 연산자: [Brave Search Operators](https://api-dashboard.search.brave.com/documentation/resources/search-operators)
- 키는 서버 환경에만 저장하며 URL, 응답, 애플리케이션 로그에 포함하지 않습니다.

## 디자인 기반

- 스마트스토어 판매자센터의 정산·클레임 상태 중심 구성
- Shopify Home의 오늘 할 일·최근 판매 중심 구성
- Amazon Seller Central의 검색·필터·데이터 표 중심 구성
- Lucide 오픈소스 아이콘
- Noto Sans KR 기반의 익숙한 국내 커머스 타이포그래피
- 운영 초록, 주문 주황, 정산 포인트와 상태 전용 색 체계
