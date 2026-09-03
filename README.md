# SellerPilot 멀티채널 커머스 운영센터

Qoo10 Japan, Shopee, Lazada, 쿠팡, 11번가, 네이버 스마트스토어, eBay, Temu의 상품·주문·재고·CS를 한 대시보드에서 운영한다. Alibaba.com과 1688은 준비 채널이다.

- 운영: https://sellerpilot-global.vercel.app
- 스택: Next.js + Supabase(Auth·Postgres·Vault) + Vercel Production
- **지금 연결·IP·배포 사실:** [docs/현재상태.md](docs/현재상태.md)
- 문서 색인: [docs/README.md](docs/README.md)

관리자 초대 계정만 로그인한다. 샘플 자동생성 운영 데이터는 쓰지 않는다.

## 현재 구현

- 관리자 로그인, 통합 대시보드, 상품 원장, 마진 계산, 주문·출고, CS 통합함
- 채널 연결·상태: Vault 키 수명, 연결 검사, OAuth 재연결
- 8채널 `listing.create` 및 채널별 주문 동기화 경로
- 서버 AI 스튜디오: Vercel Node + AI Gateway OIDC, Mac 상품 작업자 불필요
- Lazada IM은 커머스 앱(137451)과 CS Bot(137571)을 같은 Vault 슬롯의 다른 필드로 분리

## 로컬

Node 22.x, 패키지 매니저는 저장소 lockfile을 따른다.

```bash
pnpm install
pnpm dev
pnpm test
```

운영 적용 순서는 [docs/운영_배포_인증_체크리스트.md](docs/운영_배포_인증_체크리스트.md)다.

## Git

- 작업 브랜치: `integration-aside`
- push: `git push origin integration-aside` (`Kimchanghee/sellerpilot-global`)
- Vercel Git 연결과 이 remote가 다를 수 있다. 배포 SHA는 현재상태를 확인한다.

작업이 끝나면 `docs/`를 현재 기준으로 고치고 커밋·푸시한다. 토큰·키 원문은 문서에 넣지 않는다.
