# 4개 작업 통합 및 DB 안정화 진행 — 2026-09-13

## 검증 완료

- 네 작업 후속 변경을 함께 실행한 관련 검사 286/286 통과, 실패/skip 0. 로그: `/tmp/sellerpilot-integration-green.log`.
- Next.js production build 종료 코드 0. 로그: `/tmp/sellerpilot-integration-build.log`.
- 상품/CS/배송 분리 검사 42/42 통과, 금지 참조 6방향 모두 0개. `pnpm check:workspace` 통과. 비밀값 패턴 검사에서 이번 대상 61개 파일에 후보 검출 0개.
- 공유 검사 6개 수정은 시험 데이터/기대값 정정이다. 런타임 보호 조건은 완화하지 않았다.
  - UI: `65_000`과 `65000`은 같은 숫자이므로 소스 검사에서 두 표기를 허용.
  - drain: 실제 실행된 enqueue/transaction-completion RPC를 검증하고, 누락된 publication-review RPC 오류 기록 검증은 유지.
  - gateway: 생성에 필요한 배송 문맥이 없는 Qoo10 create를 provider write 이후 사례로 사용하지 않는다. 유효한 기존 상품 update fixture로 변경하여 write 전 실패와 write 후 reconciliation_required를 각각 검증.
- 이 수치는 관련 선택 검사다. 이전 전체 저장소 검사에 남아 있던 83개 실패 전체를 해소했다고 주장하지 않는다.

## 계정 및 대상 대조 — Aside 세션으로 확인

사용자가 준비한 Aside 세션을 사용했다. Chrome 프로필 전환이나 새 로그인을 요구하지 않았다.

| 대상 | 이번 직접 확인 | 판정 |
| --- | --- | --- |
| Vercel | `couplit.official@gmail.com`, `couplitofficial-4206`; team `team_Y4vAMBqZlfQ4gXvkGieFh5aG` / `project-e59d`; project `prj_9fRYsoTT4fD6XVEMe4NX9mpPlljA` | CLI 및 Aside 화면 대조 |
| Supabase | `couplit.official@gmail.com`, `couplit-korean`; org `rmmxjjnikfybyozubzqw`; project `sqaoqucxakebqkiygdxb`, main Production | Aside 계정 메뉴와 SQL Editor 확인 |
| 판매채널 | Coupang Wing `김정훈, 커플릿(Couplit)` | 해당 화면 확인. 다른 7채널 전체 계정/API 정상으로 확대하지 않음 |

Supabase connector는 여전히 SellerPilot 권한이 없지만 Aside SQL Editor로 운영 DB를 검증하고 복구했다. connector 재연결은 이 작업의 전제 조건이 아니다. 다른 프로젝트에는 SQL을 실행하지 않았다. Vercel env pull의 `[SENSITIVE]` 값은 실제 자격 증명으로 사용하지 않았다.

## 실제 운영 DB 복구

운영 조회에서 CS 이력 함수와 이력 테이블, CS 초안 큐 RPC가 실제로 없음을 확인했다. 단순 schema cache 문제로 처리하지 않았다. 프로젝트의 migration journal version/name/source SHA-256과 실제 객체를 대조한 뒤 아래 기존 migration 원문을 적용했다. 전체 `db push`는 하지 않았다.

- 첫 트랜잭션: coverage 1건. 별도 재조회에서 journal 원문 해시 및 함수 존재 확인.
- 두 번째 시도: Lazada 선행 `cs_credential_capability_bindings` 부재로 6건 전부 롤백. 별도 journal 조회 `[]` 확인.
- 최종 트랜잭션: 자격 증명 연결 선행 변경을 포함한 7건 성공. 기존 공유 함수 8개의 실제 정의 해시가 사전 검토값과 다르면 중단하도록 검사했다. 원본 migration의 자체 선행/권한 조건은 유지했다.
- SQL Editor 전송은 로컬 `/tmp` 원문 → TextEdit → Aside → 로컬 검사 파일 순으로 역복사하여 바이트까지 비교했다. 최종 7건 묶음은 246,441 bytes, SHA-256 `cf97f10607e9b4a9360f8e09ab4dcd9b7c186c9ab203c443402e15f0b0ed13f1` 일치.
- 각 적용은 statement timeout 30초, lock timeout 2초, advisory transaction lock과 `database` 작업공간 lock 아래에서 실행했다. DDL과 원본 SQL을 포함한 migration journal 기록을 같은 트랜잭션에 저장했다. 완료 후 PostgREST schema reload를 통지했다.

| version | name | 원본 SHA-256 |
| --- | --- | --- |
| `20260907220000` | `complete_cs_archive_scope_and_media` | `0faf36c9e609da220dbd4f162356f6b814dac00fa4e91932470d94ac3f438689` |
| `20260907231000` | `add_cs_history_coverage_ledger` | `cf1f0941c7cc21b0604ca20d3b817914cb62c07659858d648e7e3e37fbc02c19` |
| `20260908000000` | `add_cs_credential_capability_bindings` | `6f924b3b6d83257cb2c2e1ff08deaa0ef730480fc03154674eb5050f7d5a8f26` |
| `20260908140409` | `cs_lazada_im_ingest_v3` | `b67d6901906ea6022471ba124520ae3a83a17e0708866ede8ab706dd9ddbeed7` |
| `20260908145831` | `cs_lazada_v3_conversation_projection` | `834e098b9509360d9b3286b34237cb8c086ab5627896488cfa61c523425942cb` |
| `20260908153837` | `cs_lazada_ordinary_workspace_reply_guard` | `f6a20872cac2295a37e9c9e6c94989e611765a5d35dca63322d76a0d9025cb20` |
| `20260908172414` | `isolate_cs_reply_draft_queue` | `1b681a655e24fb53f7f91deb89438eb40efdb10b12e38c6a663234b6dde27b9e` |
| `20260909111201` | `cs_lazada_concurrent_reply_fence` | `0919e646401948ed4bcca11993680dc1ee4098c4a7f4692bd9b232bed5084301` |

## 적용 후 실제 검증

- 필수 서비스 함수 7개: history page 기록, CS draft claim/touch/complete, Lazada V3 직접/gateway ingest, credential binding 기록 모두 존재. `service_role` EXECUTE=true, anon/authenticated=false.
- 비공개 테이블 7개: coverage 4개, CS draft, credential bindings, Lazada revisions 모두 RLS=true. anon/authenticated/service_role 직접 SELECT=false; 허용된 RPC를 통해 접근한다.
- 연결 12/60, blocking session 0, idle in transaction 0. 초기 deadlocks 누적값 0. 이는 조회 시점 상태이며 장기 안정성 보장은 아니다.
- 기존 AI 원장의 CS 초안 queued/running 0을 적용 전 확인했다. 새 CS draft 큐도 조회 시점 0건. 완료 결과나 과거 문의 내용을 조작하지 않았다.
- DB 관련 검사: coverage 9/9, CS 의존/배포 검사 31/31, credential binding 검사 4/4 통과. 실제 PostgreSQL 두 세션 경합 테스트는 실행하지 않았다.
- 복구 뒤 Production 로그(2026-09-12 18:44 UTC 이후 표본): `/api/cs/worker/drafts` HTTP 204 6건으로 이전 503 회복 확인. `/api/channel-gateway/worker/complete` 200 1건도 확인했지만 500 10건이 남았다.
- 남은 완료 오류는 `INQUIRY_RECORD_INVALID:shopee`. 최근 수집 작업 `65913cf8-2a93-42b8-bf66-ff1acf7f4866`은 `reconciliation_required`이며 저장된 response payload가 없어 원본 행을 추정해 정상화하지 않았다. 대기 수집 작업도 존재한다.
- `/api/internal/channel-gateway-drain`은 enqueue 실패 2/13의 503이 남아 있다. coverage page 저장은 아직 0건이므로 이력 수집 완료를 주장하지 않는다.
- gateway `/readyz`는 한때 ready/200으로 회복했으나 이후 activeGatewayJobs=1 상태에서 degraded가 재관측됐다. 단발 ready를 전체 복구 완료로 사용하지 않는다.

## Git / Vercel / 실행본 완료 경계

네 작업 소스 통합은 `5f7c45f5f8b9a1bacaa362020ebeab7362e85417`로 origin/couplit의 integration-aside에 반영했다. 사용자 산출물 `output/pdf/`는 미추적 상태로 보존하고 커밋하지 않았다.

운영 도메인을 건드리지 않는 `--prod --skip-domain` 후보 `dpl_5dXT29k6xvWos88U37wnvfwUJMJ1`은 BLOCKED다. Aside Vercel 화면에서 커밋 작성자 `9594198+Kimchanghee@users.noreply.github.com`의 GitHub 계정 매칭 실패를 확인했다. 기존 정상 운영 커밋 fd426cc의 GitHub API 작성자는 `couplit-korean`, `257698882+couplit-korean@users.noreply.github.com`이다. 기존 이력은 보존하고 다음 커밋의 이 저장소 로컬 작성자 설정을 공식 계정과 맞춰 재시도한다.

후보 검사 스크립트는 실제 GitHub 연결 CLI가 반환하는 `githubCommitSha`도 확인하도록 수정했다. Git SHA 증거 없음/상충은 계속 거부한다. 관련 검사 통과. CS fence 소스 검사는 현재의 Lazada 상품 후기 읽기 확인 전용 예외와 일치시켰으며 provider 쓰기 보호를 변경하지 않았다.

현재 Production은 `fd426cc588f03c1e187b689141018b6de4a38eca`, `dpl_Fkbk9Kyg9whytrri5pUcG5PQkjUm`이다. 신규 통합본 Production 승격, 설치 작업자 최신화, 실제 8채널 신규 등록/CS 발송은 완료하지 않았다. 실행 중 provider 작업을 확인하지 않은 채 gateway를 강제 재시작하지 않았다. 다음 작업은 후보 배포 계정 문제 해소 → canary → 잔여 RPC/수집 검증 → 안전한 실행본 교체 순서다.

## 후보 배포 재시도 — 작성자 차단 해소

공식 운영 GitHub 계정으로 저장소 로컬 작성자를 설정한 `8e521023383c470fca88705630cf63a3643c22d3`은 후보 배포 `dpl_79iHhc2CD91rM5wtXRi4JbiM3ZEU`에서 계정 차단을 통과했다. 원격 빌드에서 `.vercelignore`가 모든 scripts를 제외해 `scripts/check-local-workspace.mjs`를 찾지 못하는 실제 오류를 확인했다. 해당 검사와 그 의존 파일 `workspace-paths.mjs` 두 개만 배포에 포함하도록 수정했다. 클라우드 경로 검사를 삭제하지 않았으며 로컬 작업자 스크립트 전체를 업로드하지 않는다. 재시도 전 상태는 ERROR이며 운영 도메인/Production은 유지됐다.

Aside 판매자 화면 추가 확인: Shopee `Couplit.kr`, `gjrxn:main`, 현재 Philippines / `gjrxntd.ph`, shop `1758392137`; Lazada MY `Couplet Seoul`, Seller Full Access. 상점 로그인 상태를 API 권한/상품 등록 성공으로 확대하지 않는다.

## 운영 반영과 실행본 갱신 — e783fc0

- 후보 `dpl_CW18E1nb6X3u3CXctBhFwkVTXZys` / `e783fc00656ad356ce13a6f011deb91c6cc6bbdb`의 원격 Next build 및 배포 Ready를 확인했다. 자동화 인증을 통한 후보 무작업 canary 6개 통과: claimed=0, processed=0, executed=false.
- `vercel promote` 성공 뒤 `sellerpilot-global.vercel.app`의 실제 연결 deployment ID를 재조회하여 위 ID와 일치 확인했다. 기존 운영 도메인이 유지됐다는 위 문단은 후보 검증 시점 이력이다.
- Aside 운영 화면이 서버 SHA e783fc0을 표시했다. 관리자 UI의 운영 일정 재검증을 실행하고, Supabase 상태 RPC 재조회로 active=true, activeRelease=e783fc0, scheduleCount=6, unsafePendingMutations=0을 확인했다.
- DB에서 실행 중인 채널 작업은 문의/주문 읽기뿐임을 확인했다. gateway active 0을 재확인한 뒤 pin을 새 Production SHA로 원자적 변경하고 기존 worker에 SIGTERM 정상 종료를 요청했다. supervisor가 새 SHA를 fetch/checkout해 재실행했고 ready/200 및 SHA 일치를 확인했다. SIGKILL/실행 중 상품 재전송은 하지 않았다.
- AI running=0, first-draft generating=0, CS-draft running=0을 DB에서 확인한 뒤 AI/CS를 정상 종료하고 설치 프로그램으로 Mac runtime을 갱신했다. 새 CS PID=71310, AI도 실행 확인. 설치된 lib/scripts/prompts 581개 모두 통합 소스 해시와 일치.
- 설치된 OxiPNG 실행 경로를 실제 호출한 합성 RGBA 검사: 65,859→421 bytes, 원본/결과 픽셀 및 알파 바이트 동일, encoder=oxipng-max-zopfli, accepted. 이 압축률은 합성 시험 자료이며 실제 상품 이미지의 보장 수치가 아니다.

## 후속 운영 진단과 추가 안정화

e783fc0 운영 로그 표본 100건에서 CS draft HTTP 204 21건, gateway complete 200 2건, 일반 claim 200/204를 확인했다. 한편 eBay recovery claim의 PGRST202와 Elevenst recovery 503은 남는다. 실제 DB 인자 대조 결과 일반 claim·local executor·local recovery 함수는 존재하고 계약이 일치한다. 누락은 다음 세 함수다.

1. `sellerpilot_claim_ebay_publication_reconciliation(text,text)`
2. `sellerpilot_service_claim_elevenst_create_recovery(text)`
3. `sellerpilot_service_finish_elevenst_create_recovery(text,uuid,uuid,jsonb)`

이 복구 기능은 상품 승인·CREATE 단계 증거·자격 증명 변경을 함께 검증하는 migration 체인이므로 누락 함수 이름만 맞춰 stub을 만들거나 구버전 구현만 적용하지 않았다. eBay 20260910021000/040000, Elevenst 20260910043000/044500 및 선행 실행 permit/source 계약의 실제 스키마 대조가 다음 DB 작업이다. 정규식 기반 SQL 검사를 실제 PostgreSQL 동시 실행 검증으로 간주하지 않는다.

Shopee/Lazada 연결 버튼을 한 번씩 재검사했으나 UI는 worker 경로 시간 초과로 실패를 표시했다. DB에서 해당 diagnostic.test는 아직 queued임을 확인했다. 따라서 이 결과는 API 키가 잘못됐다는 증거가 아니다. 중복 진단 작업을 추가하지 않는다. Qoo10은 이번 실제 상품 읽기 진단을 통과했다.

추가로 e783fc0 실행 중 CS 완료 HTTP 400이 detached Promise rejection으로 프로세스 전체를 종료시키는 문제를 확인했다. 새 회귀 검사는 실제 worker 자식 프로세스와 로컬 가짜 API를 사용하며 모든 외부 fetch를 차단한다. 수정 전 동일 HTTP 400으로 프로세스 exit=1을 재현했고, 오류 처리 후에는 프로세스 생존·active 슬롯 해제·readiness 실패 유지·provider 실행 반복 없음·SIGTERM 정상 종료를 확인했다. runtime은 실패를 성공으로 바꾸지 않고 60초 수령 backoff를 둔다. 이 후속 수정은 별도 배포 및 설치 반영 대상이다.

최신 gateway 준비 상태는 조회 시점에 따라 degraded/active=1도 재관측됐다. 일시적인 ready를 전체 운영 안정화 완료로 보고하지 않는다. 신규 게시 릴리스 확인은 새 SHA로 다시 검증해야 하며 실제 원격 증거 없이 8개 채널 확인 기록이나 게이트 개방을 수행하지 않았다.
