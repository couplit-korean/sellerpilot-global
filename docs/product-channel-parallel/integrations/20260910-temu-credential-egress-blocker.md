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
