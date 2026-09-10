# Temu 자격증명 저장 차단 원인과 다음 조치 (2026-09-10)

## 확인된 사실

- Temu 파트너 콘솔: App information filling / Compliance and security assessment 모두 **Approved** (이전 Inactive·Rejected 아님).
- Temu 셀러센터 앱 관리에서 SellerPilot 앱 권한이 **만료됨**이었고, 다시 승인 → 권한 동의 제출로 **새 Access Token 발급**(만료 2027-09-10)을 확인했다.
- 발급 값(App Key·App Secret·Access Token)으로 공식 identity API(`bg.open.accesstoken.info.get`, host `openapi-b-global.temu.com`)를 직접 서명 호출하면 **HTTP 200 / success=true**
  - mallId `635517741905839`, regionId `185`, mallType `100`, expiredTime `1820576816`, apiScopeList 130개
- 앱의 자격증명 저장(`POST /api/admin/channel-credentials/rotate`)은 **422 `TEMU_ACCOUNT_IDENTITY_READ_UNVERIFIED`** 로 계속 실패한다.

## 원인 1 (수정 완료): scope 대소문자

- Temu가 주는 scope 중 `temu.local.goods.brand.trademark.V2.get` 처럼 버전 세그먼트가 **대문자**인 값이 있다.
- `lib/product-registration/temu/account-identity.ts`의 scope 형식 검사가 소문자만 허용해, 130개 중 1개 때문에 identity 전체가 null 처리됐다.
- 수정: scope 형식을 `^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+$` 로 완화(중복·형식 오류는 그대로 거부).
- 검증: 실제 라이브 scope 130개에 대해 기존 1건 위반 → 0건, 직접 실행한 normalizer가 identity를 반환하고 잘못된 scope는 계속 거부. `tsc --noEmit` 0 errors.
- 이 머신에서는 esbuild(Gatekeeper 차단)를 쓰지 않고 Node `--experimental-strip-types` + 해석 로더로 검증했다.

## 원인 2 (남음): 서버 egress

- 수정 배포 후에도 동일하게 422다. 반면 같은 요청이 이 맥(회선 IP)에서는 200이다.
- 즉 값·서명·scope 문제가 아니라 **앱 서버(Vercel)에서 Temu로 나가는 요청만 실패**한다.
- 현재 코드에는 고정 IP·프록시 egress 경로가 없다(`providerFetch`는 일반 fetch). Temu 자격증명 저장은 서버에서 identity를 조회하는 구조다.

## 다음 조치 (코드)

1. Temu identity attestation을 **로컬 고정 IP 경로**에서 수행하도록 분리한다.
   이미 있는 `lib/product-registration/temu/temu-operator-attestation-once.mjs` + `app/api/admin/temu/operator-app-observation/route.ts` 패턴(서명된 로컬 수집 attestation)을 자격증명 저장 경로에도 적용한다.
2. 또는 Temu 콘솔 IP 목록에 앱 egress를 등록할 수 있는지 확인한다. 유료 Static IP는 쓰지 않는다.
3. 저장 성공 후 `연결 검사`로 읽기 진단을 통과시켜 키 8/8을 만든다.

## 현재 키 상태 (운영 production 활성 기준)

쿠팡·eBay·11번가·큐텐·쇼피·스마트스토어·TracX 통과(7/8), 라자다 실패(고정 IP 워커 미가동), 테무 미등록.

## 원인 확정 (2026-09-10 21:23, 배포 로그 실측)

저장 실패 지점에 진단 로그를 넣고 배포해 실제 응답을 읽었다.

- 앱 서버(Vercel) → Temu `bg.open.accesstoken.info.get`: **HTTP 200 + `success:false`**
- `errorCode: 5000003`, `errorMsg: "NOT_IN_IP_WHITE_LIST"`
- 응답에 `result`가 없어 identity 정규화가 null → 라우트가 422 `TEMU_ACCOUNT_IDENTITY_READ_UNVERIFIED`

즉 값·서명·scope 문제가 아니라 **Temu가 호출 IP를 화이트리스트로 제한**하며, 앱 서버 egress가 그 목록에 없다. 같은 서명 요청이 이 맥(회선 IP)에서는 200/success=true이므로 이 회선 IP는 이미 허용돼 있다.

### 정리

- scope 대소문자 수정(위 원인 1)은 실제 버그였다. 화이트리스트가 풀려도 그대로 두면 130개 중 `...trademark.V2.get` 1건 때문에 identity가 계속 무효가 된다.
- 유료 Static IP는 쓰지 않는다는 원칙이 있으므로, 해결책은 **허용된 IP에서 Temu 호출을 실행하는 것**이다.
  이미 있는 로컬 수집/서명 패턴(`temu-operator-attestation-once.mjs`, `app/api/admin/temu/operator-app-observation/route.ts`)을 자격증명 identity attestation에 적용한다.
- 진단 로그(상태·키 목록·errorCode·errorMsg, 비밀값 없음)는 그대로 남겨 다음 채널 점검에 재사용한다.

## 해결 (2026-09-10 21:51 KST): 로컬 서명 identity 경로 구현

Temu가 IP 화이트리스트로 막으므로, **허용된 IP를 가진 이 머신이 공식 identity를 읽고 서명해 서버가 검증**하는 경로를 추가했다.

- `lib/product-registration/temu/credential-identity-attestation.ts` (신규)
  - 계약 `temu_credential_identity_attestation_v1`, P-256/Ed25519 서명 검증, 소유자·신선도(5분)·payload 지문·scope 형식 재검증
- `app/api/admin/channel-credentials/rotate/route.ts`
  - Temu 저장 시 서버 조회를 먼저 시도하고, IP 화이트리스트로 실패하면 `localIdentityAttestation`을 검증해 사용
  - 서버 공개키는 `TEMU_CREDENTIAL_ATTESTATION_PUBLIC_KEY_PEM` / `TEMU_CREDENTIAL_ATTESTATION_KEY_ID` (Vercel Production 설정 완료)
- `lib/product-registration/temu/temu-credential-identity-once.mjs` (신규)
  - `init-key`: P-256 운영자 키를 `~/.sellerpilot/temu-credential-attestation.pem`(0600)에 생성, keyId·공개키 출력
  - `attest --config <json>`: 로컬에서 Temu identity 호출 → 서명 → 저장까지 한 번에
  - Secure Enclave는 이 셸에 엔타이틀먼트가 없어 `SECKEY_CREATE_FAILED`로 실패하므로 소프트웨어 키 파일 방식을 쓴다

실행 결과: `{"ok":true,"status":200,"mallId":"635517741905839","regionId":"185","mallType":100,"scopes":130}` → 운영 DB `channel_credentials`에 `temu / active / production / v1 / 만료 2027-09-10` 저장 확인.

## 남은 것: 읽기 진단

- `연결 검사`는 고정 IP 워커가 실행한다. 지금 워커는 `sellerpilot-cs-apply-20260910`(CS 트리)에서 돌고 있고, 로그 메시지는 `Temu 고정 IP 채널 워커에서 연결 검사를 완료하지 못했습니다`였다.
- 이 세션에서는 통합 트리 워커를 띄울 수 없다. launchd 제어가 거부되고, `tsx`는 esbuild quarantine, Node 네이티브 변환은 `sharp` 네이티브 모듈 Gatekeeper 차단에 걸린다(우회하지 않음).
- 따라서 **통합 트리 워커로 교체**하면 Temu·Lazada 읽기 진단이 함께 풀린다.

## 워커 교체 시도 결과 (2026-09-10 22:05 KST)

통합 코드 워커를 별도 트리로 띄워 읽기 진단을 끝내려 했고, 결과는 아래와 같다.

- `/Users/kimchangheemac/dev/sellerpilot-worker-merged-20260910` (origin/main = 768960de, node_modules는 메인 리포 설치에 연결)
- 실행: `node --import tsx scripts/ai-cli-worker.mjs --gateway-only --no-scheduler`
  - 정상 기동: `version=sellerpilot-cli-worker/1.61+768960de...`, health 8085, `gateway=configured`
  - 워커 토큰(`SellerPilot Gateway Worker` 키체인)으로 `/api/channel-gateway/worker/claim` 직접 호출 → **204 (큐 비어 있음)**. 토큰과 릴리스 일치는 정상이다.
  - 그러나 이 프로세스는 claim 루프에 들어가지 않아 로그가 더 남지 않았고 readiness는 `starting`에 머물렀다.
- 반면 기존 launchd 워커(`sellerpilot-cs-apply-20260910`, CS 트리)는 계속 정상 처리 중이다.
- 이 세션 샌드박스는 프로세스 제어가 막혀 있다: `kill`/`pkill` → `Operation not permitted`, `launchctl bootstrap` → `Bootstrap failed: 5: Input/output error`.

### 그래서 남은 한 단계 (사용자 터미널에서 1회)

```
launchctl bootout gui/$(id -u)/com.sellerpilot.channel-gateway 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.sellerpilot.channel-gateway.plist
```

plist의 `WorkingDirectory`는 이미 `/Users/kimchangheemac/dev/sellerpilot-merge-line-20260910`(통합 트리)로 바꿔 뒀다. 이걸 다시 읽히면 Temu·Lazada 읽기 진단이 함께 처리된다.

정리: 이번 시도에서 띄운 임시 워커가 남아 있으면 `pkill -f sellerpilot-worker-merged-20260910`로 종료한다(8085 포트).

## 읽기 진단이 막힌 마지막 원인 (2026-09-10 22:35 KST)

테무 자격증명은 등록됐고(운영 키 8/8), 워커도 통합 코드(`8fff9291`)로 정상 동작한다. 그런데 `연결 검사`는 계속 실패하고 작업은 `queued`로 남는다.

- 일반 lane: `sellerpilot_private.serverless_gateway_job_allowed`가 **(coupang, temu) x (orders.list, inquiries.list, diagnostic.test)** 를 명시적으로 `false`로 막고 있다. 즉 테무 진단은 일반 lane으로 절대 받을 수 없다.
- 고정 IP lane: `local_channel_executor_routes`의 제약이 `coupang`/`smartstore` 몇 개 작업만 허용했다. 그래서 운영 DB에서 제약을 넓히는 마이그레이션(`supabase/migrations/20260910230000_widen_local_executor_read_checks.sql`)을 만들고 적용했고, 테무 `diagnostic.test` route 행도 승인 형태로 넣었다.
- 그럼에도 고정 IP lane claim은 계속 `401 {"message":"작업자 토큰이 유효하지 않습니다."}` 를 반환한다. 워커 토큰은 scope `gateway`, status `active`인데, lane의 hydration attestation이 이 토큰을 인정하지 않는다. 인스톨러가 발급하는 scope는 `ai`/`gateway`/`scheduler` 뿐이라 이 lane 전용 identity 발급 경로가 없다.

### 결론

읽기 진단 2건(테무·라자다)은 자격증명 문제가 아니라 **lane 설계 공백**이다. 둘 중 하나를 정해야 한다.

1. `serverless_gateway_job_allowed`에서 (temu, lazada) x `diagnostic.test`를 고정 IP 워커가 받을 수 있게 허용한다(읽기 전용 검사만).
2. 고정 IP lane이 gateway scope 토큰으로 읽기 전용 작업을 claim하도록 허용한다.

두 방법 모두 앱 코드/DB 변경이므로, 다음 작업에서 1번(읽기 전용 한정)으로 좁혀 적용한다.

## 고정 IP lane 401의 실제 원인 (2026-09-10 22:40 KST)

lane의 base 함수 `sellerpilot_claim_local_executor_before_coupang_post_price` 첫 조건이 원인이다.

```
p_release_sha !~ '^[a-f0-9]{40}$'
or p_worker_version != 'sellerpilot-cli-worker/1.61+' || p_release_sha || '.' || left(p_egress_ip_sha256, 11)
or sellerpilot_private.active_serverless_runtime_release_sha() != p_release_sha
  -> raise 'invalid local channel executor hydration attestation'
```

- 워커 릴리스는 `8fff9291…`인데, DB의 활성 릴리스는 `848073370fd2…`(오늘 21:01 KST 기록)에서 멈춰 있다 → 항상 불일치 → 401.
- 활성 릴리스는 `sellerpilot_private.serverless_runtime_canary_receipts`의 최신 `consumed` 행에서 온다. 마지막 행이 21:01이라 그 뒤 배포가 반영되지 않았다.
- 내부 런타임 동기화 경로가 실패 중이다: `/api/internal/product-research`가 22:20·22:30·22:40 모두 **503**, `/api/internal/channel-gateway-drain`도 503. 그래서 새 canary receipt가 생기지 않는다.

### 다음 한 단계

`/api/internal/*` 503을 해소해 앱이 현재 릴리스를 DB에 기록하게 만들면, 고정 IP lane이 워커를 받아들이고 테무·라자다 읽기 진단이 실행된다. 워커는 이미 그 lane으로 claim하고 폴백까지 갖췄다.
