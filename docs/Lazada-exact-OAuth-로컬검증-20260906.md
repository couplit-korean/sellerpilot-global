# Lazada exact OAuth 로컬 검증

운영 DB/REST 접근, SQL 반영, worker 시작, OAuth 인가, 배포, 환경변수 변경 없음. 실행 승인 전 사용 금지.

## 경계
- 500은 실제 seller 300872000183/MY/MY4NNISR2D, Commerce137451/IM137571 및 원래 owner/v5/세 historical blocker를 보존한다. 600 없는 500 단독 상태는 false로 닫힌다.
- 600은 각 OAuth/GET job의 원래 claim, worker, credential/version, request hash를 insert-only 증거에 저장한다. 실제 completion 후 NULL로 정리된 job claim/worker를 되살리지 않는다.
- 실제 receipt의 원래 claim/worker와 completion hash, result hash, 확인 당시 lease, 원본 source/staged Vault hash, actor/owner/version을 결속한다. 완료 증거도 insert-only이다.
- 코드 fingerprint는 기존 channel+trim(code) 정규화를 유지한다. Vault에서 복원한 코드도 fingerprint를 다시 검증한다. 세션 nonce를 바꿔 같은 코드를 재교환하지 않는다.
- OAuth와 GET은 queued 노출 없이 running으로 원자 예약한다. 보수적인 refresh-in-flight 예약 fence로 lease 만료를 reconciliation으로 보내고 구 1.13 reaper 재큐잉을 막는다. GET 성공 검증 후에만 예약 flag/시각을 같은 완료 트랜잭션에서 해제한다. 외부 mutation marker는 만들지 않는다.
- 세 historical recon은 기존 guarded proof/trigger가 정확한 새 OAuth+GET 증명을 확인할 때만 supersede한다. historical credential/owner/seller_account_key는 바꾸지 않는다.

## 로컬 검증 명령
`node --test tests/lazada-oauth-exact-preimage.test.mjs tests/lazada-authoritative-oauth-proof-db.test.mjs tests/lazada-oauth-exact-runner.test.mjs tests/lazada-oauth-exact-ui.test.mjs`

- 실제 exported business functions, table constraints/triggers, completion cleanup, immutable receipts, general reaper로 세 blocker 최종 supersession을 실행한다.
- request/result/receipt/lease/owner/version 변조, code Vault 변조, actor/state/app/readiness/worker 거절, claim 재전달 금지, OAuth 전달 전후/GET 만료 부활 방지를 검증한다.
- mock runner는 교환/전송 실패를 재시도하지 않고 다른 readback job을 거절한다.
- 실제 UI 소스의 Lazada start/callback 핸들러를 transpile해 합성 window/fetch에서 실행한다. 실패 시 generic authorize로 fallback하지 않고, bind 성공도 연결 완료로 표시하지 않는다.

## 정확한 한계
- PGlite/WASM이다. Vault 암호화 확장만 synthetic storage adapter로 대체한다.
- historical fixture는 당시 존재했던 null lineage를 로드하기 위해 seed 시점에만 current insert hooks를 끈 뒤 재활성화한다. business function body는 실제 baseline 그대로이다.
- 변조 방어 테스트에서만 transaction rollback 전제의 fixture trigger disable을 사용한다. 운영에는 적용하지 않는다.
- native PostgreSQL role ownership/ACL/extension, 실제 복수 연결 동시성은 검증하지 않았다. ACL 차단과 serialized reaper 동작 검증을 native race proof로 표현하지 않는다.
- provider OAuth/HTTP 응답은 mock이며 공식 인가·실토큰 교환·실 GET·브라우저/React 통합 E2E·배포 검증이 아니다.
- parent가 SQL 순서 500→600, 전체 빌드/통합, native 확인 및 별도 운영 실행 승인을 소유한다. 이 문서는 실행 승인이 아니다.

## 현재 300 → 500 → 600 공존 검증

300이 generic claimant/reaper를 변경해야 한다는 이전 가정은 철회했다. 해당 assertion을 제거했으며 인위적인 wrapper 변경을 요구하지 않는다. 실제로 설치된 generic claim, scheduled reaper 및 모든 Shopee exact 함수가 500/600에 의해 변하지 않았음을 검사한다.

BC 300의 actor 분리 버전(`7e270636…050db18`)에서는 Shopee exact lease 만료 뒤 generic 1.13이 동일 job/code를 attempt 2로 다시 받는 문제를 owner 동일/상이 양쪽에서 재현했다. BC의 후속 300으로 다시 검증했으며, 이번 작업에서 300은 수정하지 않았다.

최신 통합 회귀 **39/39 통과**:
- 실제 300 → 500 → 600 설치 및 각 함수 경계 보존.
- 양채널 동시 exact 예약, 일반 claimant 미수령, 교차 claim/heartbeat 거절.
- Shopee actor와 credential owner 동일/상이 두 조건에서 generic 및 scheduled reaper의 재수령 방지.
- Lazada OAuth 전달 전후/GET 만료 부활 방지와 post-300 scheduled reaper 실행 후 세 historical blocker 보존.
- 실제 현재 Lazada actor=owner=768 경로 및 합성 shared-admin actor≠owner 경로 각각 완료.
- Lazada 실제 completion의 claim/worker NULL 정리, immutable 원래 claim/receipt, request/result/lease 증명 및 기존 proof에 따른 세 blocker 최종 처리.

검증 300 SHA256: `95531a3fc55ac0af87a7d835c686829d7459a913efd7b17a62505f8f1f5928f7`.
동결 500 SHA256: `32a9bd6c4d6f475c2a47d4d60a8cea45b94d78f508f1ad0826253d46e72b4b12`.
동결 600 SHA256: `3537192ecc56b5f598f7fe95f1dc9082e51e5f730786c2b90cd6458ddeda8164`.

전체 fixture는 실행 시작에 세 migration 원문을 고정하고 실행 후 원문 불변도 검사한다. 500/600은 동결 전후 동일하다. BC가 위 해시 이후 300을 다시 변경하면 같은 명령을 다시 실행해야 한다. PGlite/WASM/mock 한계는 위 절대로 유지하며 native PostgreSQL·실인가·배포 완료를 뜻하지 않는다.

## 실측 worker issuer 분리 수정

부모 제공 read-only `tmp/exact-worker-owner-preflight.json`의 측정 시각은 2026-09-06T00:11:22.200808Z이다. 활성 gateway token은 `02955cb4-fa9f-466b-824f-b61f06276190`, issuer `7f448e38-f86f-4749-bc5f-cecf6d0723e5`, expiry `2026-11-28T07:41:58.603499Z`이다. Lazada actor/credential owner `768ce4ac-0ef2-4e01-89dc-05aa4fa8543c`와 issuer가 다르다. 원래 600의 issuer=actor 조건은 이 실측과 충돌했으며, 이번 명시 승인으로 600만 수정했다.

### 기존 권한 계약 근거
- `worker_token_has_scope(hash,'gateway',true)`는 DB에 등록된 hash의 gateway scope·active·expiry를 확인하는 기존 workspace capability 계약이다. issuer와 credential owner 동일성을 요구하지 않는다.
- 기존 token 발급 RPC는 administrator 검증 후 scope별 발급/회전 및 감사 기록을 수행한다. fixture에서 issuer가 현재 admin이라고 꾸미지 않았다.
- 실제 `sellerpilot_service_gateway_completion_context`는 유효 token과 job/claim 또는 immutable receipt 결속을 확인한다. 실제 `sellerpilot_service_complete_gateway_transaction` 및 하위 완료 함수도 그대로 실행했다.
- 공동 token/context/complete 함수 원문 hash를 500/600 설치 전후 비교해 변경하지 않았음을 검사한다. 300 및 공통 source는 수정하지 않았다.

### 600의 추가 제약
기존 scope 함수와 활성 token row를 모두 검증하고 최초 pulse 때 `worker_issuer_id`와 token ID를 세션에 고정한다. 이후 issuer/token 교체는 거절한다. 각 insert-only claim에도 issuer를 보존하고 실제 receipt/완료 proof에서 확인한다. actor admin 권한, credential owner/v5, app/MY/seller, 요청/결과/Vault hash, lease 제약은 유지한다. issuer 구분은 새 권한 발급이나 아무 token 허용이 아니다.

### 결과와 한계
**48/48 통과**, ESLint/diff 검사 통과.
- actor=owner=768 + 실측 issuer7f 및 token02955로 실제 context→OAuth→준비→완료 cleanup→GET→receipt→세 blocker 처리 통과.
- actor111 / owner768 / issuer7f 세 주체가 모두 다른 합성 경우도 통과.
- unknown hash, ai/scheduler/serverless scope, expired/revoked, 최초 결속 후 issuer 변경은 fail closed.
- token row ID/issuer/scope/status/expiry/hash가 실행 전후 동일하며 추가 token row가 없음을 확인했다. 600은 token 테이블에 INSERT/UPDATE/DELETE하지 않는다.
- 실측 ID/issuer/expiry는 metadata fixture에 사용했지만 **token hash/비밀값 및 provider 응답은 합성 값**이다. 운영 token 원문 접근·검증 호출·재발급·owner 변경은 하지 않았다.
- 강화된 BC 300 preimage 검증을 위해 로컬 baseline에 실제 캡처된 해당 reaper 함수의 owner/revoke/grant DDL만 fixture에 복원했다. native PostgreSQL 전체 ownership/ACL 검증으로 확대 해석하지 않는다.

이번 검증 해시:
- 300: `fc43861c980c74aa3ec135ab657669609fadfcfe097393253dfcd523395683a5` (BC 소유, 읽기만)
- 500: `32a9bd6c4d6f475c2a47d4d60a8cea45b94d78f508f1ad0826253d46e72b4b12` (변경 없음)
- 600: `ff2099afdd470f642d3ad1c94803047f0ca18e1c86aee270679b4ca5e1e05205`

운영 DB/REST/OAuth/worker/deploy 실행 없음. 위 해시 이후 파일 변경 시 통합 회귀를 다시 실행해야 한다.
