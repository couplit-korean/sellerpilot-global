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
- Vercel AI Gateway OIDC 기반 서버 상품 스튜디오를 이용한 상품 분석, 16~20개 상세 섹션, 16개 검증 이미지와 26개국 현지화 생성

## Vercel 서버 AI 스튜디오

상품 스튜디오의 운영 주경로는 Mac이나 로컬 Codex 바이너리가 아니라 Vercel Node 런타임입니다. Vercel이 자동 제공하는 단기 `VERCEL_OIDC_TOKEN`으로 AI Gateway를 호출하며 OpenAI API Key를 저장하지 않습니다. Supabase의 기존 비공개 작업 큐, 범위가 `ai`인 Worker Token 지문, claim token, heartbeat와 완료 receipt를 그대로 사용합니다. 서버 전용 Worker Token 원문은 `SELLERPILOT_AI_WORKER_TOKEN` sensitive 환경변수에만 두며 브라우저·응답·로그에 표시하지 않습니다.

상품 생성은 300초 함수 제한 안에서 한 claim으로 처리합니다. 1차 상품조사는 상품 3개를 함께 진행하되 각 상품의 이미지 모델 호출은 한 번에 하나로 제한해 의도된 전체 이미지 burst를 3개로 유지합니다. 최종 Studio는 문안·분할·배경·검수 호출 전체를 claim당 하나의 FIFO gate로 묶어 합계 동시 호출을 3개 이하로 유지합니다. 설정샷 8개는 원본 상품 이미지를 참조한 빈 배경 생성 후 검증된 원본 cutout을 합성하며 논리 작업은 `3+3+2` wave로 계획합니다. 이미지 429가 한 번 발생하면 같은 claim의 대기 중인 이미지 호출을 취소하고 AI 재시도 없이 승인된 1차 6장을 보존한 채 나머지 결과를 원본 사진 기반 카탈로그 이미지로 원자 재구성합니다. 나머지 근거·카탈로그 이미지는 서버 Sharp 파이프라인으로 생성합니다. 16개 이미지 전체가 동일상품·수량·브랜드 대소문자·용량/단위 OCR, 배경 잔상, 잘린 가장자리와 시각 중복 검사를 모두 통과해야만 성공합니다. 16~20개 마스터 섹션과 34개 채널·시장 행(고유 26개국)도 전부 검증되어야 terminal success가 됩니다.

응답 이후에는 Next.js `after()`가 큐 drain을 깨우고, 기존 Supabase 상품조사 스케줄 호출도 미완료 작업을 복구합니다. 별도 Vercel Cron이나 새 큐 서비스는 요구하지 않습니다. 시간 초과, 모델 실패, OCR 불일치, segmentation 신뢰도 부족, 이미지 중복 또는 16개/34개 결과 누락은 성공으로 바꾸지 않고 같은 claim을 `failed`로 원자 완료합니다. 로컬 CLI 도구는 개발·이전 호환용일 뿐 운영 상품 스튜디오의 필수 조건이 아닙니다.

Vercel은 비공개 Supabase 작업 큐, 지원되는 상품 등록·수정·중지, 재고·배송, Shopee·Lazada·eBay OAuth 교환, 문의 동기화·답변, 서명된 이미지 URL과 판매채널용 이미지 전송 준비를 처리합니다. 작업은 채널·operation 허용표, claim token, lease heartbeat, 외부 mutation fence와 원자적 완료 원장을 모두 통과해야 하며, 결과가 불명확하면 재전송하지 않고 `reconciliation_required`로 남깁니다. AI Gateway OIDC와 범위 분리 Worker Token은 판매채널 자격증명과 분리하며 실패한 작업을 예시 결과로 바꾸지 않습니다.

Temu는 모바일·웹 클라이언트나 로컬 AI 작업자가 직접 호출하지 않습니다. 모든 요청은 SellerPilot API와 Supabase 원장을 거치며, Vercel Static IP가 Temu 개발자센터에 등록되고 데이터베이스 정책과 요청별 egress attestation까지 일치할 때만 서버가 실행합니다. 설정이 없거나 IP를 검증하지 못하면 Temu 작업은 외부 호출 전에 `STATIC_EGRESS_REQUIRED`로 차단되고 다른 작업자로 자동 우회하지 않습니다. 같은 이중 차단은 쿠팡·스마트스토어·11번가에도 적용합니다.

서버 상품 스튜디오·상품조사·합성 런타임 점검은 텍스트 생성에 Vercel AI Gateway의 단일 모델 `openai/gpt-5.4-mini`를 사용합니다. 모든 호출은 OpenAI provider만 허용하고 SDK 재시도와 모델 폴백을 사용하지 않습니다. 1차 등록의 6개 이미지는 운영 기본값에서 검수된 원본 사진으로 서버가 직접 구성하므로 원격 이미지 공급자의 429·권한 제한을 기다리지 않습니다. 기존 `openai/gpt-image-2` 합성 경로는 `SELLERPILOT_PRODUCT_RESEARCH_IMAGE_MODE=gateway-composite`를 명시한 배포에서만 사용합니다. 운영 성공은 모델 응답이 아니라 저장된 16개 asset과 완전한 현지화 결과의 terminal contract 검증으로 판정합니다.
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
