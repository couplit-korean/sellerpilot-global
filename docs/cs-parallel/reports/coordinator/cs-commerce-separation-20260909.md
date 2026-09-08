> 2026-09-09 후속: 배송까지 포함한 최신 3영역 분리 결과는 [상품·CS·배송 분리 완료 기록](product-cs-shipping-separation-20260909.md)을 따른다. 아래는 CS·상품 2영역 분리 당시 기록이다.

# CS·상품 등록 코드 분리 완료 — 2026-09-09

판정: **로컬 업무 코드 분리 완료**. 상품 등록과 CS가 서로의 화면·조회 모델·업무 실행기·완료 처리·AI 작업에 의존하지 않도록 실제 호출 경로를 변경하고 검증했다. 별도 작업이나 하위 에이전트에 위임하지 않았다.

작업본: `/Users/kimchangheemac/dev/sellerpilot-cs-integrated-20260908`
복구 체크포인트: `/Users/kimchangheemac/dev/sellerpilot-cs-snapshots/separation-20260908T162925Z`

## 분리 결과

| 범위 | CS 소유 | 상품 등록·커머스 소유 | 검증한 경계 |
|---|---|---|---|
| 화면 | `app/cs/page.tsx`, `standalone-workspace.tsx`, `workspace.tsx`, `display-tickets.ts` | 기존 상품 작업대와 상품 상세·이미지 화면 | `/cs`의 전체 import 경로에서 상품 UI·상품 데이터·상품 워커 접근 0 |
| 상태·조회 | `app/cs/use-workspace.ts`, `/api/admin/cs/snapshot`, `lib/cs/snapshot.ts` | `app/use-operations-snapshot.ts`, `/api/operations/snapshot` | loading/error/reload/poll/AbortController/선택/초안/이력 상태 독립; CS 로그아웃·계정 교체 시 캐시·초안 취소 |
| DB 읽기 모델 | `sellerpilot_get_cs_snapshot()` | `sellerpilot_get_commerce_snapshot()` | 상품·주문 테이블 없는 DB에서 CS 조회 성공; CS 테이블 없는 DB에서 커머스 조회 성공 |
| 실행 | `lib/cs/operations/execute.ts`, `provider.ts` | `lib/channels/commerce-operations.ts`, `commerce-provider.ts` | 상대 업무 operation은 provider 호출 전에 거절 |
| 완료·원장 | `lib/cs/operations/complete.ts`, `worker-completion.ts` | `lib/channels/commerce-completion.ts`, `commerce-worker-completion.ts` | CS 정규화·과거 원장·답변 readback은 CS에서, 상품 계보·게시·주문 정규화는 커머스에서 처리 |
| CS API | `/api/admin/cs/sync`, `/ticket-status`, `/reply`, `/drafts` | 기존 상품 전용 API | CS 동기화는 문의만 enqueue; 상품 API는 CS operation 거절; 옛 혼합 sync는 410으로 명시적 종료 |
| AI 초안 | `cs_reply_draft_jobs`, 전용 create/get/cancel/claim/touch/complete RPC, `/api/cs/worker/drafts`, `scripts/cs-draft-worker.mjs` | `/api/ai/worker/*`, product claim, `scripts/product-ai-worker.mjs` | 큐·lease·취소·완료·CLI 실행 분리; 상품 완료 schema가 CS 초안 거절 |
| 로컬 채널 처리 | `scripts/cs-gateway-job.mjs` | `scripts/commerce-gateway-job.mjs` | 업무별 provider/결과 처리 분리; 입력 혼입은 heartbeat 전에 차단 |
| 예약 | `lib/cs/operations/schedule.ts` | 상품 게시 재조회 예약 | 현재 문의·과거 보수 조회 계획은 CS 모듈 소유 |
| 통신 문맥 | 호출마다 새 immutable transport context | 호출마다 새 immutable transport context | 한쪽 취소·호출량 예약이 다른 쪽에 전파되지 않음 |

메인 대시보드는 두 화면을 조립하는 진입점으로 유지한다. 인증, 채널 식별자, HTTP 서명/전송, gateway의 claim·heartbeat·외부 호출량 제한은 공통 기반이다. **채널 gateway의 물리 테이블과 배포 프로젝트를 두 벌로 복제한 작업은 아니다.** CS와 상품의 업무 모듈이 이 공통 기반을 통해 상대 업무 모듈을 호출하지 않는지 끝까지 검사했다. 기존 gateway job ID, reply delivery 연결, credential 갱신·provider mutation fence를 유지한다.

이전 audit의 `completeSeparation`은 단순히 공통 조립 진입점이 존재하면 실패하던 조건이었다. 이를 import 경계 검사와 실행 증거로 나눴다. 우회할 shared-boundary 목록은 두지 않았으며, alias/type import/re-export/dynamic import/require 및 scripts까지 전체 경로를 계속 검사한다. 공통 조립 진입점 목록은 audit 출력에 공개한다. DB/워커/화면 검증을 import 검사 하나로 대체하지 않는다.

## 기존 기록과 처리 중 작업 보존

- CS 읽기 모델은 기존 support tickets·전송 원장·문의 동기화 상태를 조회하며 기존 CS·상품 데이터를 삭제하지 않는다.
- 새 CS 초안 migration은 기존 `support_reply` 행만 전용 큐로 인계한다. 기존 행은 출처 기록으로 보존한다. 실행 중이던 CS 초안의 옛 lease는 취소하고 새 큐에서 재접수한다. 상품 AI 행은 변경하지 않는다.
- CS 초안은 inbound key, job ID, claim token, worker identity, lease, 취소 상태를 함께 검사한다. 동일 완료는 replay되고 다른 결과로의 덮어쓰기는 거절된다.
- CS 공급자 응답이 불확실한 답변 전송은 reconciliation으로 남는다. 일반 실패로 바꿔 재전송하지 않는다.
- 기존 eBay case/dispute 완료 연결 누락도 수정했다. 별도 분쟁 원장을 먼저 저장하고 일반 문의 0건으로 정규화하지 않는다. 실패한 분쟁 조회 응답도 전용 원장에서 대조한다.
- 11번가 상품 XML과 CS XML 해석기를 분리해 상품 응답에 Q&A 결과가 섞이는 경로를 제거했다.

## 새 DB 변경

아래 새 migration만 이 분리 작업의 DB 변경이다. 모두 로컬 PGlite에서 실행했고 운영 DB에는 적용하지 않았다.

1. `20260908170140_isolate_cs_workspace_snapshot.sql`
2. `20260908171055_isolate_commerce_workspace_snapshot.sql`
3. `20260908172414_isolate_cs_reply_draft_queue.sql`

번호·소유권은 `separation-20260909/migration-ownership.md`에 기록했다. 향후 승인된 배포에서는 위 순서의 DB 변경을 먼저 적용하고 대응하는 웹/API 및 별도 CS draft worker를 함께 전환해야 한다. 옛 웹/워커와 새 큐를 임의로 섞지 않는다. 현재 사용자의 로컬 우선·commit/push 금지 지시를 유지한다.

## 로컬 검증

- 통합 회귀: **441/441 통과**, skipped 0. 채널 실행·페이지 이어받기·완료 API·원장·CS 계약·상품 등록 보호 조건·독립 DB·워커·import 경계를 포함한다.
- 추가 실제 CS 초안 API/DB 흐름: **1/1 통과**. 실제 admin POST → 실제 SQL 큐 → 실제 worker POST claim/heartbeat → 전용 runner → 실제 SQL complete → admin GET readback. 동일 결과 replay와 상품 결과 혼입 거절도 확인했다. 인증/작업자 신원 및 AI 생성 결과는 fixture이며 외부 호출은 없다.
- 전체 TypeScript: 통과. 변경 TS/JS ESLint: 통과. Next 16 webpack production build: 통과.
- CS→상품 업무 모듈 import 0, 상품→CS 업무 모듈 import 0. `/cs` 독립 진입 경로도 검사한다.
- 브라우저: 별도 로컬 테스트 세션에서 `/cs` 렌더링·재조회 버튼·상품 화면 이동, JS page error/프레임워크 오류 overlay 없음 확인.
- 브라우저에는 현재 로컬 Supabase 환경변수 미설정 안내가 표시된다. 로그인한 운영 CS 데이터 표시나 운영 API 성공 증거로 집계하지 않는다. DB 데이터 처리의 성공 근거는 위 실제 코드+격리 DB 테스트다.

소스 이동으로 깨진 파일 경로 기반 테스트는 현재 업무 소유 파일을 읽도록 수정했다. SmartStore 이력 테스트는 실제 v4 checkpoint/v7 enqueue 계약으로 갱신했다. eBay supplemental04의 옛 실패 재현 테스트는 수정된 두 번째 페이지 정상 완료 회귀로 전환했다. Qoo10 확인창 금지 검사는 Qoo10 handler 범위로, eBay Material 검사는 기존 categoryScalar 정규화를 포함하도록 수정했다. 상품 등록 작업대 구현 자체는 분리 전과 동일 해시다.

검증 로그와 파일별 해시: `separation-20260909/verification.json`, `changes.json`, `source-boundary-audit.json`, `regression.tap`, `draft-api-flow.tap`, `build.log`, `eslint.log`, `browser-verification.json`.

## 운영 증거와 구분

이번 완료는 요청한 **로컬 코드 분리의 완료**다. 8개 판매채널의 과거 전체 수신, 실제 고객 답변 전송, 상품 실제 게시 완료율을 새로 100%로 판정한 작업이 아니다. 커밋·푸시·배포·운영 migration 적용·판매채널 변경·고객답변 전송은 0회다.

과거 전체 migration 재생 테스트에는 분리 전 migration `20260904211500_allow_local_shopee_category_and_diagnostic_claims.sql`의 함수 문자열 marker 불일치가 존재한다. 기존 migration을 수정하거나 검사 예외를 추가하지 않았다. 새 3개 migration의 실제 실행·권한·독립성·기존 초안 인계는 별도 DB 테스트로 검증했다. 전체 과거 migration 체인이 통과했다고 보고하지 않는다.
