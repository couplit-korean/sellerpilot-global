# CS·상품 등록 독립 개발 구조 재검증

2026-09-09. 시작 커밋 `6f64476dbf402e25cd7b418692e492f8ee2bdddb`. 이전 결과를 그대로 재인용하지 않고 업무 import, 화면 진입, API, 완료 처리, 동시 실행, DB/큐를 다시 확인했다.

## 판정

**영역별 소유 파일 안에서 CS와 상품 등록을 독립 개발할 수 있는 업무 구조다.** 재검증 396/396, 타입 포함 빌드, 변경 lint 통과. 세 영역 6방향 import 의존은 0이며 기존 24채널 진입점 검사도 빌드에서 통과했다. 앞으로 어떤 코드를 바꾸어도 오류가 절대 없다는 보장은 아니다. 공통 기반의 물리적 분리나 별도 배포 프로젝트 구성까지 완료한 상태도 아니다.

## 이번에 발견하고 수정한 것

1. `app/api-credential-center.tsx`의 공통 검수 화면에 `inquiries.list`가 남아 상품 API로 전송된 후 거부되는 경로를 확인했다. 해당 선택지·CS 인자 생성 코드를 제거하고 `/cs` 전용 화면 링크로 연결했다. 물류업체 TracX 자체 문의 기능은 별도 계약이므로 유지했다.
2. 기존 import 검사에서 상품 AI API(`app/api/ai/*`)와 구형 CS 초안 주소/CS navigation 파일의 소유 분류가 빠져 있었다. 상품 AI API는 상품, 구형 support-reply 주소는 CS로 분류하고 교차 의존을 탐지하는 회귀를 추가했다.
3. 경계 검사가 수동 명령으로만 존재했다. `build:vercel`은 이제 업무·채널 경계 검사 둘 다 통과해야 Next 빌드에 진입한다. 이 명령은 로컬 빌드이며 배포가 아니다.

## 검증 근거

| 경계 | 실제 확인 |
|---|---|
| 업무 코드 | CS↔상품↔배송 6방향 import 0. 별칭·재export·타입 import·문자열 dynamic import의 전이 경로 포함 |
| 화면/상태 | CS `/cs`·`useCsWorkspace`, 상품 작업대·`useOperationsSnapshot`, 배송 `/shipping`이 각 상태·취소·poll을 소유. CS standalone import graph에 상품 UI/worker 없음 |
| API | CS는 `/api/admin/cs/*`, 상품은 `/api/admin/channel-operations`와 `/api/admin/products/snapshot`. 구형 CS 초안 주소는 410. 일반 검수 화면의 잘못된 CS→상품 진입 제거 |
| 완료 처리 | 3영역 × 다른 2영역의 작업 주입 6건은 DB 접근 전에 거부. 결과를 다른 영역 claim에 넣는 6건은 문맥 조회 뒤 저장 RPC 없이 거부 |
| 동시 실행 | CS 취소/실패와 상품 실행을 동시에 실행하여 예산·취소 신호가 섞이지 않음. AsyncLocalStorage의 호출별 문맥 사용 |
| 워커 | CS gateway handler와 상품 handler가 다른 영역 작업을 lease 시작 전에 거부. CS 초안과 상품 AI worker 분리 |
| DB 조회 | 상품/주문 테이블 없이 CS 조회·초안 실행. CS/배송 테이블 없이 상품 조회. 다른 관리자 접근과 인증 실패도 별도 확인 |
| 큐 이전 | 기존 CS 초안 이전 시 실행 중인 상품 job·lease 보존. 만료 claim, 취소, 토큰 폐기, 고객 메시지 변경 후 저장 차단 |
| 채널 | 상품·CS·배송 24개 진입점과 정확한 8개 key registry, 다른 채널 입력의 실행 전 차단 유지 |

[회귀 396건](domain-separation-reaudit-20260909/regression.tap), [검증 JSON](domain-separation-reaudit-20260909/verification.json), [업무 의존성 검사](domain-separation-reaudit-20260909/business-boundaries.json), [빌드](domain-separation-reaudit-20260909/build.log), [린트](domain-separation-reaudit-20260909/eslint.log).

## 독립 수정과 공통 수정의 구분

| 구분 | 파일/계약 | 작업 규칙 |
|---|---|---|
| CS 전용 | `app/cs/`, `app/api/admin/cs/`, `lib/cs/`, 기존 채널별 문의·이력 파일, CS draft/gateway worker | CS 영역에서 구현·검증. 상품 실행기/상품 상태 import 금지 |
| 상품 전용 | 상품 작업대/Studio, `app/api/admin/channel-operations/`, `app/api/admin/products/`, `app/api/ai/`의 상품 API, `lib/product-registration/`, `commerce-*` 실행·완료 코드, product AI worker | 상품 영역에서 구현·검증. CS 실행기/CS 상태 import 금지 |
| 배송 전용 | `app/shipping/`, `app/api/admin/shipping/`, `lib/shipping/`, shipping gateway worker | 주문·배송 변경은 이 영역이 소유 |
| 공통 조합 | `app/page.tsx`, `app/workspace-composition.ts`, 공통 worker/dispatcher | 각 영역 결과를 선택/조합하는 역할. 기능 구현을 다시 몰아넣지 않는다. 동시 수정자는 한 명으로 정한다 |
| 공통 기반 | 인증·판매자 자격·HTTP protocols·물리 DB·gateway queue·completion RPC·전역 CSS/`app/layout.tsx` | 두 영역 모두에 영향 가능한 공용 파일이다. 영역별 담당자가 각자 덮어쓰지 않는다. 공통 계약 변경으로 관리하고 양쪽 회귀 후 반영 |
| SQL | 하나의 migration 이력과 기존 RPC wrapper | 신규 번호 중복 검사. CS 기능 추가를 위해 상품 테이블/완료 RPC를 임의로 수정하지 않는다. 공통 transaction 변경 시 양쪽 실행/권한/재실행 검사 필수 |

공용 `sellerpilot_service_complete_serverless_cs_transaction` 이름은 과거 명칭이며 상품·배송도 사용하는 공통 운송 transaction이다. 이름만 보고 CS 전용으로 수정하면 안 된다. 호출별 작업 ID/claim token/채널/operation 결속이 격리 기준이다. 같은 판매자 OAuth와 provider rate budget도 공통 자원이므로 외부 인증 장애·API 제한·공통 worker 중단은 여러 영역에 영향을 줄 수 있다.

루트 layout과 전역 CSS는 공통으로 남아 있으므로 시각 스타일의 절대 비간섭까지 검증했다는 의미가 아니다. 독립 화면 디자인 변경은 해당 영역 CSS module을 사용하고 공통 선택자 변경은 별도 공통 변경으로 검증한다.

## 이후 작업 기본 검증

```sh
npm run test:domain-isolation
npm run test:channel-isolation
npm run build:vercel
```

추가로 수정한 채널/기능의 테스트를 실행한다. 빌드 명령은 경계 검사 두 개를 자동 실행한다. 이전 확대 suite의 일반 기능 7개 실패는 [이전 상세 기록](channel-domain-layout-20260909.md)에 유지하며 이번 분리 재검증 396건 통과를 전체 운영 기능 100%로 확대하지 않는다.

운영 DB 적용, provider 변경, 고객 답변, Vercel 배포는 하지 않았다. Git은 이전 사용자 지시와 저장소 closeout 규칙에 따라 비공개 origin integration-aside만 갱신한다.
