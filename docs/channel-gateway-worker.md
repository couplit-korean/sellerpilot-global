# SellerPilot Vercel channel gateway

운영 판매채널 작업은 로컬 Mac의 장기 실행 worker가 아니라 Vercel Function과
Supabase queue/lease로 처리한다. Supabase의 분 단위 wake가
`POST /api/internal/channel-gateway-drain`을 호출하고, 한 번의 호출이 제한된 수의
작업을 claim·heartbeat·완료한다. 함수가 재시작되거나 응답이 유실되어도 claim
token, lease, provider mutation fence와 원자적 완료 원장이 중복 외부 쓰기를
막는다.

Vercel Cron은 사용하지 않는다. Supabase Cron이 상품조사·주문 동기화·동일상품
가격·카카오 알림을 5분 간격의 서로 다른 분에 호출하고 maintenance도 일 1회
호출한다. 현재 문의 수집의 단일 소유자는 분 단위 gateway
drain이며, 주문 동기화 route는 문의를 중복 enqueue하지 않는다. DB Vault에는 raw
`CRON_SECRET`이 아니라 기존 gateway wake용 HMAC 파생 bearer만 저장한다.

로컬 Mac은 `--ai-only` 모드에서 상품 분석·이미지 제작만 담당한다. 운영에서
`pnpm gateway:worker`, `--gateway-only`, scheduler scope를 Mac에 상시 실행하지
않는다. 해당 스크립트와 Docker/systemd 예시는 로컬 개발·복구 진단용으로만
남아 있으며 production fallback이 아니다.

## 지원 범위

최종 허용표의 단일 소스는 `lib/channels/serverless-gateway-provider.ts`다.

- 상품 쓰기: 채널별로 허용된 `listing.create`, `listing.update`,
  `listing.stop`, `inventory.update`, `shipment.acknowledge`,
  `shipment.confirm`
- 주문: 8개 활성 채널의 `orders.list`; 11번가를 제외한 `orders.get`
- 문의: Qoo10·Lazada·쿠팡·스마트스토어·eBay·Temu 조회, Qoo10·Lazada·쿠팡·
  스마트스토어·eBay 답변
- 카테고리·진단: 8개 활성 채널의 카테고리 조회/추천/속성/검증과 연결 진단
- 별도 기능: Shopee·Lazada 숍 조회, Shopee·Lazada·eBay OAuth, 11번가
  동일상품 검색, Qoo10·Shopee·Lazada·eBay 게시 lineage 확인

`price.update`는 허용표에서 의도적으로 제외한다. 읽기 연결이 된 채널을 쓰기나
답변까지 완료된 것처럼 표시하지 않는다.

## 고정 egress 차단

쿠팡·스마트스토어·11번가·Temu·Shopee는 Vercel Static IP와 각 개발자센터의 허용 IP가
실제로 일치할 때만 서버리스 실행을 켠다. Static IP는 유료 기능이므로 사용자
승인 없이 구매하거나 활성화하지 않는다.

네이버 커머스API 공식 FAQ는 내 스토어 애플리케이션에 실제 호출 컴퓨터의
Outbound IPv4를 등록해야 하며, NAT 환경에서는 NAT 공인 IP를 사용하고
애플리케이션당 최대 3개까지 등록할 수 있다고 명시한다.
`GW.IP_NOT_ALLOWED`는 이 등록값과 네이버가 관측한 호출 IP가 다를 때의 정상적인
fail-closed 응답이다.

- 공식 FAQ: https://github.com/commerce-api-naver/commerce-api/discussions/2291

검증이 끝난 채널만 Production 환경변수
`SELLERPILOT_SERVERLESS_STATIC_EGRESS_CHANNELS`에 쉼표로 넣고, 같은 채널을
Supabase의 static-egress 정책에도 활성화한다. 환경변수, DB 정책, 요청 attestation
중 하나라도 다르면 외부 호출 전에 `STATIC_EGRESS_REQUIRED`로 차단하며 로컬
worker로 우회하지 않는다. Shopee는 OAuth 토큰 교환부터 같은 게이트를 적용한다.
특히 Temu는 로컬 Mac 공인 IP 조회, AWS check-IP,
키체인 allowlist 경로를 사용하지 않으며 Vercel 서버리스 gateway에서만 실행한다.

## 배포 순서

1. 정확한 운영 Supabase host와 Vercel 프로젝트를 각각 다시 확인한다.
2. 전체 테스트와 Vercel production build를 통과시켜 후보 배포를 만든다. 후보에는
   비밀값이 아닌 정확한 커밋 SHA를 `SELLERPILOT_RELEASE_SHA`로 넣는다.
3. 정확한 후보 URL과 같은 SHA를 지정한 no-work canary로 그 후보 자체를 검증한다.

```sh
SELLERPILOT_RUNTIME_ORIGIN=https://sellerpilot-global-<deployment>-project-e59d.vercel.app \
SELLERPILOT_EXPECTED_RELEASE=<40자리-커밋-SHA> \
pnpm gateway:serverless:configure --candidate-canary
```

4. **migration 전에** 현재 운영 gateway cron과 다섯 internal schedule을 명시적으로
   중지하고 status가 `active: false`인지 확인한다. 이렇게 해야 migration
   transaction이 진행되는 동안 기존 분 단위 실행이 외부 작업을 claim하거나,
   marker RPC가 없는 DB에서 fresh Lazada OAuth code를 소비하는 창이 생기지 않는다.

```sh
pnpm gateway:serverless:configure --deactivate --status
```

중지 응답만으로는 이미 claim된 구버전 실행을 배제할 수 없다. 동일 트랜잭션 스냅샷에서
아래 조회가 0일 때까지 drain을 기다린 후에만 Production 승격과 migration을 시작한다.

```sql
select count(*) as running_gateway_leases
from sellerpilot_private.channel_gateway_jobs
where status = 'running'
   or (lease_expires_at is not null and lease_expires_at > clock_timestamp());
-- 예상: 0
```

5. 검증한 동일 후보를 Production으로 승격하고, Vercel cron inventory가 0건인지
   확인한다. 다른 artifact를 새로 배포해 바꾸지 않는다.
6. `supabase/migrations`에서 운영 DB에 아직 적용되지 않은 forward migration을
   파일명 순서대로 모두 적용해, 최소
   `20260830204000_allow_fresh_lazada_oauth_past_oauth_reconciliation.sql`까지 도달했는지
   확인한다. 특히 `20260830203000_record_lazada_oauth_provider_call_boundary.sql`을
   `20260830204000` 전에 적용해 provider-call marker RPC가 먼저 존재하게 한다.
   `20260828210000_non_cs_release_integrity.sql`만 골라 적용하면 안 된다. 적용 뒤에도
   gateway와 다섯 internal schedule은 inactive로 유지하고, static-egress status에
   Shopee가 `false`로 존재하며 generic/persistent claimant가 Shopee 작업을 가져오지
   못하는 것과 marker RPC·fresh-authorization recovery function이 역할 제한된
   권한으로 존재하는 것을 확인하기 전에는 활성화하지 않는다.

즉 순서는 `동일 후보 no-work canary → gateway/internal schedule inactive → running_gateway_leases = 0 → 동일 artifact Production 승격 → 203000 → 204000`으로 고정한다.
7. 위 최신 DB gate 확인 후 아래 명령으로 서버리스 token/wake 구성을 bootstrap하고, gateway와 다섯
   internal route의 no-work canary가 동일 release SHA로 모두 성공한 같은 실행에서만
   scheduler를 활성화한다.

```sh
pnpm gateway:serverless:configure --bootstrap
SELLERPILOT_EXPECTED_RELEASE=<40자리-커밋-SHA> \
pnpm gateway:serverless:configure --canary --activate --status
```

bootstrap 스크립트는 운영 Supabase host가 예상값과 다르면 중단한다. gateway
canary는 `claimed: 0`, `processed: 0`, route canary는 `executed: false`여야 하며
판매채널 API나 카카오 발송을 호출하지 않는다. DB의 10분짜리 canary receipt는
같은 release의 실행에서 한 번만 소비되므로 이전 성공을 재사용해 scheduler를 켤 수
없다. 기존 queued/running 상품·재고·출고·CS 답변·OAuth 작업이 있으면 활성화도
거부한다. `reconciliation_required`는 별도 수치로 보고하며 자동 재전송하지 않는다.

## 운영 계약과 확인 항목

- Vercel drain은 최대 8개 작업을 동시에 처리하고, 개별 provider 작업에는 180초
  timeout과 20초 heartbeat를 적용한다.
- 주기 주문 enqueue 최대치는 5분당 17건이다. 문의 enqueue는 gateway drain 한
  경로만 소유하며 backlog는 운영 status로 검증한다.
  쿠팡의 읽기 동기화만 안전하게 2개 병렬 claim을 허용하고, 쓰기·OAuth는 채널별
  직렬 fence를 유지한다.
- 만료된 읽기 lease는 재시도한다. 외부 mutation을 시작한 쓰기의 결과가 불명확하면
  재전송하지 않고 `reconciliation_required`로 전환한다.
- 주문·문의 원장은 정규화된 결과만 저장하며 provider 원문, 자격증명, OAuth secret,
  고객 개인정보를 Vercel 응답·로그에 남기지 않는다.
- 판매채널용 정규화 이미지는 content-addressed Storage 경로와 참조 원장으로
  관리한다. 활성 listing/실행 중 attempt 참조를 보호하고, 30일이 지난 미참조 파일만
  maintenance에서 재시도 가능한 cleanup queue로 삭제한다.
- Runtime Log에서 cron 인증 실패, claim/heartbeat/complete 실패,
  `reconciliation_required`, cleanup 재시도와 비밀값 노출 여부를 확인한다.

코드 배포, `READY`, canary 성공은 실제 상품 게시·배송 확정·고객 답변 성공과
동일하지 않다. 실제 외부 쓰기는 사용자가 정확히 승인한 대상과 범위가 있을 때만
검증하고, 채널별 결과를 각각 보고한다.
