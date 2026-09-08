# 상품 등록·CS·배송 업무 코드 분리 완료 — 로컬 검증

2026-09-09. 작업 정본: `/Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908`. 중앙 단독 작업. 이번 완료 기준은 **세 업무를 독립적으로 개발·검증하고 공통 화면/작업 진입점에 연결할 수 있는 코드 경계**다. 8개 채널의 실제 등록·답변·발송 성공을 뜻하지 않는다.

## 확인해서 제거한 결합

배송은 기존 상품 실행기 `commerce-operations.ts`와 provider·완료 처리·로컬 워커에 들어 있었다. 주문 화면도 상품 스냅샷을 기다렸으며 발송 API는 상품용 `/api/admin/channel-operations`를 호출했다. 상품 조회 SQL은 주문 테이블과 매출 집계 함수에 의존했다.

이 경로를 배송 소유 모듈로 옮겼다. 상품 API/실행기/게이트웨이는 주문·배송 작업을 거부하며, 배송 API는 상품·CS 요청을 스키마 검사에서 거부한다. 범용 실행 진입점은 소유 모듈을 선택하는 조합 역할만 한다.

## 소유 경계와 연결 지점

| 구분 | 상품 등록 | CS | 주문·배송 |
|---|---|---|---|
| UI | 기존 상품 작업대·Studio·상품 편집 | `app/cs/` | `app/shipping/` |
| 전용 페이지 | 기존 `/?view=products`, 상품 등록 화면 | `/cs` | `/shipping` |
| 상태 소유 | `app/use-operations-snapshot.ts` | `app/cs/use-workspace.ts` | `app/shipping/use-workspace.ts` |
| 조회 API | `/api/admin/products/snapshot` | `/api/admin/cs/snapshot` | `/api/admin/shipping/snapshot` |
| 실행 API | `/api/admin/channel-operations` 및 상품별 API | `/api/admin/cs/*` | `/api/admin/shipping/operations`, `/api/admin/orders/fulfill` |
| 업무 실행기 | `lib/channels/commerce-operations.ts`, `commerce-provider.ts` | `lib/cs/operations/` | `lib/shipping/execute.ts`, `provider.ts` |
| 완료 처리 | `commerce-completion.ts`, `commerce-worker-completion.ts` | `lib/cs/operations/complete.ts`, `worker-completion.ts` | `lib/shipping/complete.ts`, `worker-completion.ts` |
| 로컬 provider 워커 | `scripts/commerce-gateway-job.mjs` | `scripts/cs-gateway-job.mjs` | `scripts/shipping-gateway-job.mjs` |
| AI 워커 | `scripts/product-ai-worker.mjs` | `scripts/cs-draft-worker.mjs` | 사용하지 않음 |
| 조회 RPC | `sellerpilot_get_product_registration_snapshot` | 기존 CS 전용 snapshot RPC | `sellerpilot_get_shipping_snapshot`, `sellerpilot_get_shipping_sales_analytics` |

`app/workspace-composition.ts`가 대시보드에서 상품과 배송 조회 결과를 합친다. 상품 소유 모듈과 배송 소유 모듈은 이 조합기를 가져오지 않는다. 주문의 상품명은 주문 원장에 저장된 문자열을 읽으며 상품 테이블 조회에 의존하지 않는다. 매출 집계의 상품 ID는 원장 식별값으로만 사용한다.

기존 `/api/operations/snapshot` 주소는 상품 전용 API의 호환 경로로 남겼다. 상품 화면의 실제 요청은 새 전용 주소를 사용한다. 인증, 순수 값/프로토콜 계약, 요청 전송, gateway claim·lease·작업 저장 기반은 공통 인프라다. DB 인스턴스·물리 gateway 큐·배포 프로젝트를 세 개로 복제한 것은 아니다.

## 보존한 배송 보장

- 기존 주문별 resource key의 SHA-256 입력과 주문/송장 결속을 유지한다. 상품 listing/inventory 식별자는 배송 접수에 전달하지 않는다.
- 발송 확인 플래그, 활성 채널 인증, 채널별 지원 범위, 주문 원장 ID를 검증한다.
- 중복 작업은 새 provider 작업을 만들지 않고 정확한 attempt/credential/channel/operation에 연결된 저장 결과를 읽는다. 저장 결과가 없는 성공 표시를 실제 발송 성공으로 취급하지 않는다.
- `202`는 진행 중이며 발송 성공이 아니다. 외부 변경 이후 통신/권한 문제가 발생하면 재확인 상태를 보존한다.
- Lazada Pack과 Ready-to-Ship 각각에서 새 durable mutation fence를 요청한다. 해당 정책은 배송 provider가 지정하고 공통 lease 기반이 수행한다.
- 기존 Qoo10 주문 식별, Shopee shop/order 식별 및 픽업·드롭오프 검증, Coupang shipmentBox, SmartStore productOrder, eBay 결제/품목/수량/발송 재조회 검증을 유지한다.
- 브라우저 배치당 최대 3건, 서버 동시 최대 3건과 요청 제한시간을 유지한다. 계정 변경·로그아웃·화면 종료 시 배송 조회와 남은 발송 배치를 취소하며, 접수 여부가 불명확한 작업을 자동 재전송하지 않는다.
- 주문 조회 성공 결과는 안정된 normalization timestamp로 정규화하고, gateway 응답에는 원문 대신 정규화 수/연속 조회 정보만 남긴다. 배송 완료에서 CS 정규화/상품 진단 payload는 전달하지 않는다.

## 채널별 배송 코드 범위

아래는 구현/허용 경로이며 실판매자 계정에서 성공을 확인한 표가 아니다. 지원되지 않는 경로를 이번 분리 과정에서 열지 않았다.

| 채널 | 주문 목록 | 개별 주문 조회 | 별도 발주 확인 | 출고 확정 |
|---|---|---|---|---|
| Qoo10 | 구현 | 구현 | 구현 | 구현 |
| Shopee | 구현 | 구현 | 구현 | 구현 |
| Lazada | 구현 | 구현 | 구현 | 구현 |
| Coupang | 구현 | 구현 | 구현 | 구현 |
| 11번가 | 구현 | 차단 | 차단 | 차단 |
| SmartStore | 구현 | 구현 | 구현 | 구현 |
| eBay | 구현 | 구현 | 별도 동작 없음 | 구현 |
| Temu | 구현 | 구현 | 별도 동작 없음 | 구현 |

## 검증 결과

- **656/656 테스트 통과**, 실패·skip 0. CS 기존 회귀, 상품 등록 관련 회귀, 배송/송장/정규화/페이지 처리, 신규 업무 경계/API/worker/DB 검사를 함께 실행했다.
- 직접·간접·type import와 동적 import를 포함한 그래프 검사: **상품→CS, 상품→배송, CS→상품, CS→배송, 배송→상품, 배송→CS 모두 0건**. 중간 공통 파일에서 탐색을 중단하지 않는다.
- PGlite에서 신규 migration 실제 실행. 상품/CS 테이블 없이 배송 조회·매출 집계, 배송/CS 테이블 없이 상품 조회, 익명/비관리자 차단, 정확한 배송 receipt 재조회 검증 통과.
- 실제 배송 HTTP route와 실제 gateway 모듈을 로컬 RPC fixture에 연결하여 주문 resource 접수, 잘못된 업무 거절, 재전송 없는 replay, 진행 중 응답을 확인했다. 이는 운영 RPC 실행 증거와 구분한다.
- 실제 배송 완료 모듈의 정규화/원문 제거와 실제 로컬 배송 worker의 변경 후 실패 상태 보존을 확인했다.
- 전체 TypeScript 검사를 포함한 **Next webpack production build 통과**. 변경 TS/JS 52개 ESLint 오류·경고 0.
- 로컬 브라우저 `/shipping` → `/cs` → `/?view=products` 이동, 의미 있는 화면, 오류 overlay 없음, 브라우저 오류 없음 확인. 로컬 Supabase 설정이 없어 배송/CS는 연결 설정 안내, 상품은 로그인 화면을 확인했다. 인증된 실데이터 UI 검증으로 부풀리지 않는다.

회귀에서 오래된 테스트의 파일 소유 경로/포맷과 Lazada fresh fence 호출 계약을 갱신했다. Temu CS revision 테스트의 오래된 ISO 문자열 fixture는 현행 seconds 계약에 맞춰 숫자/문자 숫자로 수정했으며, production Temu 정규화 코드를 완화하지 않았다.

증거: `shipping-separation-20260909/verification.json`, `regression.tap`, `build.log`, `eslint.log`, `source-boundary-audit.json`, `changes.json`, 브라우저 PNG 3개.

## 새 migration과 적용 범위

`supabase/migrations/20260908183507_isolate_shipping_and_product_read_models.sql`:

1. 상품 전용 조회 RPC — 주문 테이블 미참조.
2. 배송 전용 조회 및 배송 매출 RPC — 상품/CS 테이블 미참조.
3. 배송 attempt 결과 조회 RPC — 관리자 검증 및 credential/channel/operation 결속.

Supabase CLI로 새 버전을 생성하고 파일명 중복 검사 통과. 기존 migration을 수정하지 않았다. 새 SQL은 로컬 PGlite에서만 적용했다. 기존 CS 분리 migration 3개의 운영 적용 상태까지 이번 작업에서 변경하거나 확인하지 않았다. 실제 배포 시에는 이전 CS 분리 SQL과 이번 SQL/호출 코드를 함께 검토하고 운영 migration 이력을 먼저 대조해야 한다.

이전 전체 역사 migration 재생에서 확인된 `20260904211500`의 기존 guard 실패를 이번 작업의 새 SQL 통과로 해결했다고 주장하지 않는다. 이번 완료는 새 SQL의 격리 실행과 업무 코드 분리 범위다.

## 이후 독립 작업 규칙

- 상품 담당 작업은 상품 경로만, CS 작업은 CS 경로만, 배송 작업은 배송 경로만 수정한다. 다른 영역의 상태 훅·업무 실행기·DB 조회 wrapper를 import하지 않는다.
- 공통 화면, gateway dispatcher, 인증/프로토콜 계약 변경은 조합 경계 변경으로 별도 검토한다. 한 영역의 기능을 다른 영역의 성공 상태로 표시하지 않는다.
- 독립 기능은 각 전용 페이지/API/worker에서 검증한 후 조합기에 연결한다. provider 작업 성공/불명/재확인 상태와 식별값은 그대로 전달한다.
- 재혼합 방지 검사: `npm run check:domain-boundaries`.
- 독립성 회귀 검사: `npm run test:domain-isolation`.

기존 상품·CS 소스 및 데이터 삭제, commit, push, deploy, 운영 DB 변경, provider 변경, 고객 답변은 수행하지 않았다. 요청한 세 영역의 로컬 코드 분리 작업은 완료했으므로 이 범위에서 멈춘다.
