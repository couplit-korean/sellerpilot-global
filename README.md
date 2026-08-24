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

SellerPilot은 OpenAI API Key를 사용하지 않습니다. 관리자가 `API 관리` 화면에서 일회성 작업자 토큰을 발급한 뒤, ChatGPT에 로그인된 Mac에서 자동실행 작업자를 설치합니다. 설치기는 토큰을 macOS 키체인에만 저장합니다.

```bash
codex login status
npm run ai:worker:install
npm run ai:worker:status
npm run ai:worker:temu-egress
```

Vercel은 비공개 Supabase 작업 큐와 서명된 이미지 URL만 처리합니다. ChatGPT OAuth 자격은 Mac 밖으로 전송하거나 저장하지 않습니다. 이미지 생성은 설치된 [`wjb127/codex-image`](https://github.com/wjb127/codex-image) 스킬과 Codex 내장 `image_gen`만 사용합니다. 실패한 작업을 예시 결과로 바꾸지 않으며 운영 화면에서 재시도·취소할 수 있습니다.

Temu는 모바일·웹 클라이언트가 직접 호출하지 않습니다. 모든 사용자는 SellerPilot API로 요청하고, Temu API 호출은 허용된 채널 작업자에서만 실행됩니다. `ai:worker:temu-egress`는 현재 작업자의 공인 IP를 macOS 키체인에 저장하며, 실행 시 등록값과 실제 송신 IP가 다르면 Temu 작업만 `TEMU_EGRESS_IP_CHANGED`로 중지합니다. 작업자를 늘릴 때는 각 작업자의 고정 송신 IP를 Temu에 추가하거나 하나의 고정 egress 게이트웨이를 사용해야 합니다.

기본 모델은 Codex CLI의 `gpt-5.6-sol`이며 필요할 때만 `SELLERPILOT_CODEX_MODEL` 환경변수로 바꿀 수 있습니다. 작업자는 시작할 때 `codex login status`가 `Logged in using ChatGPT`인지 확인하고, 셸에 남아 있는 `OPENAI_API_KEY`는 자식 프로세스에 전달하지 않습니다.
- 서비스 전체 흐름을 설명하는 화면형 스토리보드
- PPT 31장 기반 175개 항목의 개발 상태와 실계정 검수 상태를 분리한 인수 대시보드
- Frankfurter v2의 중앙은행·기관 기준 데이터를 서버에서 조회하는 일일 기준 환율 위젯

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

## 디자인 기반

- 스마트스토어 판매자센터의 정산·클레임 상태 중심 구성
- Shopify Home의 오늘 할 일·최근 판매 중심 구성
- Amazon Seller Central의 검색·필터·데이터 표 중심 구성
- Lucide 오픈소스 아이콘
- Noto Sans KR 기반의 익숙한 국내 커머스 타이포그래피
- 운영 초록, 주문 주황, 정산 포인트와 상태 전용 색 체계
