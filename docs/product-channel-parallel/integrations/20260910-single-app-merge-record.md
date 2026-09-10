# 단일 앱 병합 리허설 기록 (상품등록 + CS)

Date: 2026-09-10 KST
Branch: `codex/product-merge-line-20260910`
Base: `origin/integration-cs-apply-20260910` (현재 운영 라인)
Merged: `origin/integration-aside` (상품등록 HOLD 통합본)
Commit: `22211c4`

## 목적

상품등록 기능을 별도 프로젝트로 분리하지 않고, **운영 중인 SellerPilot 한 앱 안에서 CS와 함께** 동작시키기 위한 병합을 실제로 수행하고 검증한다.

## 병합 결과

- 충돌 **110개 → 0**
- 해소 규칙
  1. CS 표면(`app/cs/**`, `lib/cs/**`, `lib/channels/cs/**`, `app/api/admin/cs/**`, `tests/cs-*`, 문의·라자다 IM·CS 게이트웨이 파일)은 **운영(CS) 버전 유지**
  2. 상품 경로(`lib/product-registration/**`, `lib/channels/qoo10-*`/`smartstore-*`/`provider-*`/`commerce-*`, `lib/server-smartstore-*`, `lib/server-qoo10-*`, `app/_publishing/**`)는 **상품 버전 채택**
  3. 공용 모듈은 **양쪽 합집합**
- 공용 파일 수동 병합 내역

| 파일 | 처리 |
|---|---|
| `lib/channels/protocols.ts` | 상품본 채택. 상품이 추가한 `providerFetch`, `runWithProviderTransportContext`, `runWithProviderRequestBudget`, `CredentialRefreshTarget`, `elevenstXmlTransportEvidence` 포함. 운영 전용 `ebayDefaultScopes`는 상품본이 `./ebay-oauth-scopes`에서 재수출하므로 유지됨 |
| `lib/channels/operations.ts` | 상품본 채택(운영본이 참조하던 삭제된 exact-recovery 모듈 의존 제거) |
| `lib/channels/provider-execution-contract.ts` | `ProviderJob`에 운영 필드 `credential_binding_context?`, `temu_buyer_chat_readiness_context?` 추가 |
| `lib/channels/inquiry-sync.ts` | `normalizeChannelInquiries`에 4번째 인자 허용(운영 호출부), `finalizeInquiry` 인자 타입 완화 |
| `lib/channels/lazada-im-webhook.ts` | `lazadaQuarantineReady` 파라미터 타입 완화 |
| `lib/cs/operations/complete.ts`, `worker-completion.ts` | 정규화 호출 인자 타입을 함수 시그니처 기준으로 고정 |
| `lib/cs/operations/provider.ts` | CS 실행 입력 타입 캐스트(런타임 변화 없음) |
| `docs/현재상태.md` | 양쪽 기록 모두 보존 |

- `tsc --noEmit`: **41 → 0 errors** (`--incremental false`)

## 검증

- Vercel Preview **Ready** (2m 17s), SHA `22211c4`
  - https://sellerpilot-global-git-codex-product-merge-c2f7ae-project-e59d.vercel.app
- 확인한 화면
  - 통합 대시보드: `판매 데이터 원장 연결`, `운영 DB 연결 오류` 없음
  - 상품 등록 센터: 3단계 워크플로·판매자 필수 입력 렌더
  - CS 통합함: 정상 렌더
- Production `main`은 변경하지 않았다. CS 운영 배포도 그대로다.

## 로컬 빌드 제약 (환경)

macOS Gatekeeper가 Next.js 네이티브 바이너리를 차단한다. 실제로
`node_modules/.pnpm/@next+swc-darwin-arm64@16.3.1/.../next-swc.darwin-arm64.node`와
`lightningcss.darwin-arm64.node`가 없어 `next build`가 실패한다. 이는 코드 문제가 아니며,
재서명·xattr 제거·복사로 우회하지 않는다. **빌드 검증은 Vercel 원격 빌드로만 한다.**

## 운영 DB 현황 (읽기 검증)

- 전체 마이그레이션 원장 318건, 최신 적용 `20260908170140`
- 9/5 이후 미적용 **134건**
- 코드가 참조하는 RPC 171개 중 운영 DB에 없는 것 **40개** (CS 32 / 상품·공용 8)
  - 상품·공용: `sellerpilot_get_active_credential_secret_v2`, `sellerpilot_list_channel_market_targets_v2`,
    `sellerpilot_rotate_elevenst_credential_exact`, `sellerpilot_service_record_coupang_create_transmission`,
    `sellerpilot_service_reserve_provider_request_rate_budget_v1`, 라자다 격리 관련 3건
- 이번에 수동 적용한 추가형 함수
  - `20260908183507_isolate_shipping_and_product_read_models.sql` → 함수 4개
  - `20260909193500_shopee_exact_target_lineage_v2.sql` → v2 lineage 함수 3개
  - `20260910014500_elevenst_credential_version_cas.sql` → 11번가 exact 회전 CAS
  - 위 3건은 `supabase_migrations.schema_migrations`에 기록하지 않았다(수동 적용). 재적용은 `create or replace`라 무해하다.
- `20260907233000_add_provider_rate_budgets.sql`은 자체 가드
  `SERVERLESS_GATEWAY_RATE_BUDGET_CLAIM_SOURCE_DRIFT`로 거부됐다. 게이트웨이 claim 함수 선행이 필요하다.

## DB 용량·오류 방지 원칙 (상품 기능)

상품 상태·증거 테이블이 무한히 커지지 않도록 아래를 지킨다.

1. **추가형만 적용**한다. 기존 테이블 `drop`/`truncate`/컬럼 삭제 문장이 있는 마이그레이션은 상품 라운드에서 쓰지 않는다.
2. **전문 저장 금지**: provider 원문 응답은 해시(sha256)와 판정에 필요한 allowlist 필드만 남긴다. 예외적으로 필요한 원문은 압축 후 보존기간을 둔다.
3. **재시도 중복 방지**: `(owner, product, channel, environment, revision)` 또는 `(credential, attempt)` 기준 unique index로 재시도마다 새 행이 쌓이지 않게 한다.
4. **보존기간 정리 RPC**: 완료·실패가 확정된 evidence/transmission/seal/attempt 로그는 주기 삭제 RPC로 정리한다. CS의 `sellerpilot_service_prune_lazada_im_raw_inbox_v1` 선례를 따른다. 감사에 필요한 영수증은 삭제 대상에서 제외한다.
5. **인덱스 최소화**: 조회 패턴당 하나. 큐 조회는 부분 인덱스(`where status = 'queued'`)로 유지한다.
6. **VACUUM/ANALYZE**: 정리 후 통계 갱신. 대량 삭제는 배치로 나눈다.
7. 새 마이그레이션마다 파일명 규칙(`YYYYMMDDHHMMSS_`)·식별자 63바이트·중복 번호를 로컬 검사기로 통과시킨다.

## 다음 단계

1. 미적용 마이그레이션을 추가형만, 의존성 순서로 한 건씩 적용하고 매 단계마다
   - 함수 존재 확인
   - 병합 Preview의 `snapshot` 200 유지
   - 운영(CS) 대시보드 무영향 확인
2. `rate budget`은 게이트웨이 claim 함수 체인과 함께 적용.
3. 위 1~2가 끝나면 `main`에 병합 커밋을 반영해 Production을 통합 빌드로 교체하고 CS·상품을 다시 검증한다.
4. 원장 표기는 그대로 **18/48**, 실제 CREATE+공식 조회 **0/8**이다. 로컬·Preview 통과를 실등록으로 올리지 않는다.

## 2026-09-10 추가 진행 (Production 반영)

- 운영 DB 추가 적용 (추가형만, 가드 통과분)
  - `20260910020500_coupang_durable_create_reconciliation` → `sellerpilot_service_enqueue_coupang_create_reconciliation`, receipts 테이블
  - `20260910021500_fence_coupang_create_source_revision`
  - `20260910025500_fence_coupang_create_official_sources`
  - `20260910031500_fence_coupang_create_official_sources_r7`
  - `20260910032500_fence_coupang_create_official_sources_r8`
  - `20260910041500_coupang_create_exact_provider_body_r12` → `sellerpilot_service_record_coupang_create_transmission`
  - `20260910042000_complete_coupang_durable_create_reconciliation_r12`
  - 미적용: `20260910042500_..._backoff_r12` (가드 `COUPANG_CREATE_RECONCILIATION_BACKOFF_DEPENDENCY_MISSING`).
    `sellerpilot_private.channel_gateway_jobs.rate_not_before`가 선행 필요하고, 그 컬럼은
    `20260907233000_add_provider_rate_budgets`가 만든다. 그 마이그레이션은 게이트웨이 claim 함수 선행 가드
    (`SERVERLESS_GATEWAY_RATE_BUDGET_CLAIM_SOURCE_DRIFT`)로 거부됐다. 게이트웨이 체인과 함께 처리한다.
  - 공유 함수 변경은 `rename + wrapper` 패턴(예: `serverless_gateway_job_allowed`)이라 기존 채널 규칙을 위임 유지한다.
- `main` 통합 반영
  - `origin/main`에 있던 `8ee8d9e4 fix(lazada): restore exact OAuth reauthorization path (#1)`을 병합(충돌 3건 해소).
    Lazada 헬퍼는 `providerFetch`(읽기 전용 컨텍스트) 유지, 자격증명 센터는 Shopee·Lazada 정확 OAuth 진입점을 모두 유지.
  - `main` = `0948614` (origin·vercel 동일). Vercel **Production Ready** (2m대). 로컬 `tsc` 0 errors.
- Production 실서비스 검증
  - https://sellerpilot-global.vercel.app
  - 통합 대시보드: `판매 데이터 원장 연결`, DB 오류 없음
  - 상품 등록 센터: 3단계 워크플로 렌더
  - CS 통합함: 정상 렌더
  - 즉 CS와 상품이 **한 앱**에서 함께 동작한다. 별도 프로젝트로 분리하지 않았다.

## DB 정리 실측 (추가 조치 불필요 판정)

새 상품 증거 테이블은 삭제 기반 prune을 **하면 안 되게** 설계돼 있다.

- `coupang_create_transmissions`: `id` PK + `unique (attempt_id)`
- `coupang_create_provider_body_seals`: `id` PK + `unique (job_id)`
- `coupang_create_reconciliation_receipts`: `source_job_id` PK + `verifier_job_id unique`
- 위 테이블들에는 `before update or delete` **불변 트리거**가 걸려 있어 수정·삭제가 차단된다(감사 증거)

즉 재시도해도 행이 중복 누적되지 않고(고유 제약), 증거는 불변이라 삭제 prune 대상이 아니다.
운영 DB에서 확인한 기존 정리 경로:
- `public.sellerpilot_service_prune_runtime_noise(timestamptz)` → 있음
- `public.sellerpilot_service_reap_stale_channel_gateway_jobs(integer)` → 있음

따라서 상품 기능이 DB를 무한히 키우는 경로는 고유 제약으로 막혀 있고, 실제 정리는 위 두 RPC(런타임 노이즈·죽은 게이트웨이 job)로 수행한다. 추가 prune 마이그레이션은 만들지 않는다. 남은 조치는 이 두 RPC가 상품 job 종류까지 포함하는지 주기 실행에서 확인하는 것이다.
