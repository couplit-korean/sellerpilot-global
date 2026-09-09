# 상품·CS·배송 및 8채널 연결 지도

2026-09-09. 상품/CS/배송 3영역의 실행 경로를 분리하고, 각 영역에 8채널 진입점과 타입 검사되는 registry를 두었다. 앞으로 채널 작업은 아래 파일에서 시작한다. 중앙 registry는 채널을 고르는 역할만 맡으며, 업무 실행기에서 다른 영역/채널 실행기를 호출하지 않는다.

| 채널 | 지침 | 상품 등록 | CS | 배송 |
|---|---|---|---|---|
| Qoo10 (`qoo10`) | [연결 지침](qoo10.md) | `lib/product-registration/channels/qoo10.ts` | `lib/cs/channels/qoo10/adapter.ts` | `lib/shipping/channels/qoo10.ts` |
| Shopee (`shopee`) | [연결 지침](shopee.md) | `lib/product-registration/channels/shopee.ts` | `lib/cs/channels/shopee/adapter.ts` | `lib/shipping/channels/shopee.ts` |
| Lazada (`lazada`) | [연결 지침](lazada.md) | `lib/product-registration/channels/lazada.ts` | `lib/cs/channels/lazada/adapter.ts` | `lib/shipping/channels/lazada.ts` |
| 쿠팡 (`coupang`) | [연결 지침](coupang.md) | `lib/product-registration/channels/coupang.ts` | `lib/cs/channels/coupang/adapter.ts` | `lib/shipping/channels/coupang.ts` |
| 11번가 (`elevenst`) | [연결 지침](elevenst.md) | `lib/product-registration/channels/elevenst.ts` | `lib/cs/channels/elevenst/adapter.ts` | `lib/shipping/channels/elevenst.ts` |
| 스마트스토어 (`smartstore`) | [연결 지침](smartstore.md) | `lib/product-registration/channels/smartstore.ts` | `lib/cs/channels/smartstore/adapter.ts` | `lib/shipping/channels/smartstore.ts` |
| eBay (`ebay`) | [연결 지침](ebay.md) | `lib/product-registration/channels/ebay.ts` | `lib/cs/channels/ebay/adapter.ts` | `lib/shipping/channels/ebay.ts` |
| Temu (`temu`) | [연결 지침](temu.md) | `lib/product-registration/channels/temu.ts` | `lib/cs/channels/temu/adapter.ts` | `lib/shipping/channels/temu.ts` |

최신 상품 등록 보완·실운영 잔여 조건은 [8채널 검증 기록](remaining-product-verification-20260909.md)을 따른다. 3,000개 로컬 회귀 통과와 실제 계정/상품 연결 완료는 구분한다.

과거 상품 전용 복구 분기는 [제거 기록](product-recovery-retirement-20260909.md)에 따라 삭제했다. 이전 문서의 exact permit·고정 상품 복구 경로를 다시 연결하지 않는다. 일반 등록/수정과 중복·계정 검증은 유지한다.

## 공통 연결 위치

| 영역 | registry | API·화면 | 완료/worker |
|---|---|---|---|
| 상품 | `lib/product-registration/channel-adapters.ts` | `/api/admin/channel-operations`, `/api/admin/products/snapshot`, 상품 작업대 | `lib/channels/commerce-provider.ts`, `lib/channels/commerce-completion.ts`, `lib/channels/commerce-worker-completion.ts`, `scripts/commerce-gateway-job.mjs` |
| CS | `lib/cs/operations/channel-adapters.ts` | `/cs`, `/api/admin/cs/*` | `lib/cs/operations/provider.ts`, `complete.ts`, `worker-completion.ts`, `scripts/cs-gateway-job.mjs` |
| 배송 | `lib/shipping/channel-adapters.ts` | `/shipping`, `/api/admin/shipping/*`, 기존 `/api/admin/orders/fulfill` | `lib/shipping/provider.ts`, `complete.ts`, `worker-completion.ts`, `scripts/shipping-gateway-job.mjs` |

상품 compatibility facade는 `lib/channels/commerce-operations.ts`에 남긴다. 상품 공통 실행 계약/순수 helper는 `lib/product-registration/execution-shared.ts`, 배송 것은 `lib/shipping/execution-shared.ts`, CS 문의 데이터 타입은 `lib/cs/operations/inquiry-contracts.ts`다. `lib/channels/operations.ts`는 기존 호출자를 위한 3영역 조합 경계다.

인증·HTTP protocol·DB 연결·gateway 운송은 공용 기반이다. 실행별 상태는 기존 호출 문맥과 작업 식별자로 격리한다. 세 개의 배포 프로젝트/물리 DB로 나눈 구성은 아니다. 대시보드 조합은 `app/workspace-composition.ts`에서만 수행하고, 업무 화면의 상태와 조회는 각 영역이 소유한다. 기존 CS 기능 파일은 API 계약/이력 보존을 위해 유지하고 명시적인 채널 adapter로 접근한다.

## 수정 규칙과 재발 방지

- 상품 변경은 상품 파일, CS 변경은 CS 파일, 배송 변경은 배송 파일에서 한다. 한 채널의 고유 동작을 다른 채널 모듈에 추가하지 않는다.
- 공통 인터페이스 변경은 세 registry와 호출자 타입검사로 검증한다. 각 registry는 8개 key 누락을 컴파일 단계에서 잡는다.
- `check:domain-boundaries`는 6방향 업무 의존을, `check:channel-boundaries`는 24개 진입점과 다른 채널로 이어지는 전이 의존을 검사한다.
- `test:channel-isolation`은 잘못된 채널 입력 24건의 실행 전 거부와 registry/파일 구성을 검증한다. 이 검사가 모든 provider 지원 여부를 증명하지는 않는다.
- 외부 mutation은 승인된 대상·원격 ID·계정 결속을 확인한 뒤 실행하며, 202/accepted만으로 완료 처리하지 않는다. 같은 요청의 재전송과 재조회는 구별한다.
- 기존 이력과 migration을 삭제해 새 출발하지 않는다. 변경 SQL은 새 번호로 추가하고 기존 실패/성공 계보를 보존한다.

## 배송 지원 범위

8개 모두 주문 목록 경로를 보유한다. 11번가는 현재 목록 외 동작을 차단한다. eBay/Temu의 별도 접수 승인 동작은 제공하지 않는다. 나머지 실제 개방 조건은 `lib/shipping/availability.ts`, `contracts.ts`, 채널 catalog/운영 release gate를 함께 따른다. 파일이 있다는 이유로 미지원 동작을 개방하지 않는다.

## Git 및 배포

이번 요청은 비공개 `origin`의 `integration-aside`에 커밋·푸시까지만 수행한다. Vercel 연결 원격은 갱신하지 않는다. `vercel.json`의 `git.deploymentEnabled`에서 `integration-aside`와 이번 작업 브랜치를 false로 지정했다. 다른 브랜치의 설정은 보존한다. [Vercel 공식 Git 설정](https://vercel.com/docs/project-configuration/git-configuration) 기준이다. 배포 CLI/API/운영 migration 적용은 하지 않는다.

검증 수치와 커밋 통합 범위는 [정리 결과](../cs-parallel/reports/coordinator/channel-domain-layout-20260909.md)와 [현재 상태](../현재상태.md)를 따른다.

## 독립 개발 전 재검토 기준

[CS·상품 독립 개발 재검증](../cs-parallel/reports/coordinator/domain-separation-reaudit-20260909.md)에 각 영역 파일과 공통 파일의 변경 규칙을 정리했다. 공통 인증/DB/큐/transaction/전역 CSS는 공동 기반이며, 해당 변경을 CS 또는 상품 전용 변경으로 취급하지 않는다. `build:vercel`은 업무·채널 경계 검사를 통과해야 빌드한다.
