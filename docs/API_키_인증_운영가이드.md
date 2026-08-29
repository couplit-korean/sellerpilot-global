# SellerPilot API 키·인증 운영 가이드

## 현재 운영 연결

- Vercel 프로젝트: `sellerpilot-global` (`couplitofficial-4206` 계정)
- Supabase 조직·프로젝트: Couplit 소유 계정으로 전환 후 최종 확정 필요
- 운영 도메인: `https://sellerpilot-global.vercel.app`
- 인증 방식: Supabase Auth 이메일·비밀번호, 관리자 초대 전용
- 비밀 보관: Supabase Vault, 버전별 불변 저장

비밀키 원문은 Git, 브라우저 저장소, 화면, 감사 로그에 남기지 않는다. Vercel에는 Supabase 서버 접근용 Secret Key와 범위가 `ai`인 Worker Token만 sensitive 서버 환경변수로 보관하고, 판매 채널 키는 웹 관리 화면에서 Vault로 저장한다. 상품 스튜디오는 OpenAI API Key나 Mac 로그인에 의존하지 않고 Vercel이 자동 제공하는 단기 OIDC로 AI Gateway를 호출한다.

## 판매채널 키 교체 표준 절차

1. `API 키 · 인증` 메뉴에서 채널을 선택한다.
2. 새 키만 입력한다. 기존 키는 다시 표시하거나 자동 입력하지 않는다.
3. 만료일, 교체 주기, 사전 경고일, 이전 키 유예 기간을 지정한다.
4. 저장하면 새 버전이 `active`, 이전 버전은 `grace`가 된다.
5. `연결 검사`로 읽기 전용 API를 호출한다.
6. 검사 통과 후 채널 콘솔에서 이전 키를 폐기한다.
7. 감사기록에서 버전, 지문, 작업시각, 검사 결과를 확인한다.

키 지문은 비밀값의 SHA-256 앞 12자리만 표시한다. 원문을 복구하거나 화면에 노출하는 기능은 제공하지 않는다.

서버 AI의 `SELLERPILOT_AI_WORKER_TOKEN`은 이 웹 입력 절차의 대상이 아니다. 웹의 서버 AI 런타임 카드는 상태·처리 건수·불일치 또는 만료 복구 안내만 제공하며 토큰 원문을 발급·표시·복사하거나 교체하지 않는다. 서버 AI 토큰 복구는 `운영_배포_인증_체크리스트.md` §7의 server-only 절차를 따른다.

## 채널별 필수 입력과 수명

| 채널 | 필수 연결값 | 현재 수명 기준 | 안전 검사 |
|---|---|---|---|
| Qoo10 Japan | Seller ID, QAPI Key, 승인된 테스트 상품번호 | 콘솔 만료 표시 없음, 내부 90일 교체 권장 | 자격 형식 확인 후 승인 상품 읽기 검수 |
| Shopee | Live Partner ID·Partner Key, Main account OAuth | Access 4시간, Refresh 30일, 승인 최대 365일 | 8개 숍별 `/api/v2/shop/get_shop_info` |
| Lazada | App Key, App Secret, Access Token, Refresh Token, 국가 | Access 30일, Refresh 180일 | `/seller/get` 읽기 API |
| 쿠팡 | Vendor ID, Access Key, Secret Key | 180일, 만료 14일 전 재발급 | 등록상품 목록 `maxPerPage=1` |
| 네이버 스마트스토어 | Application ID, Application Secret, SELLER, 판매자 UID | Access Token 180분, 서버 자동 재발급 | `/v1/seller/account` |
| 서버 AI 스튜디오 | Vercel sensitive `SELLERPILOT_AI_WORKER_TOKEN`, 자동 제공 `VERCEL_OIDC_TOKEN` | Worker Token 30·90·180·365일, OIDC는 단기 자동 갱신 | AI scope 지문 일치, claim/heartbeat/receipt, 16개 이미지·34개 시장 terminal 검사 |

## 2026-08-16 실제 연동 상태

- Qoo10: 실판매자 콘솔과 등록 필드 확인 완료. QAPI 키는 Qoo10 측 발급이 필요해 아직 Vault 미등록.
- Shopee: Couplit 앱 Online, Test·Live Redirect Domain 반영, Main account OTP와 8개 글로벌 숍 Authorized를 확인했다. 최신 `/auth` 콜백과 숍별 토큰 교환·선택·갱신 코드를 구현했고 운영 Partner Key의 Vault 입력과 보안 콜백 토큰 교환이 남았다.
- Lazada: 일회성 state 검증, code URL 제거, 토큰 교환, Vault 버전 저장, 72시간 전 Access Token 자동 갱신까지 코드로 구현했다. 실계정 토큰 교환은 고정 송신 IP 허용 후 검증한다.
- 쿠팡: Couplit WING 실판매자 로그인과 업체코드 표시를 확인했다. 추가판매정보의 OpenAPI 키 화면은 비밀번호 재확인이 필요하며, 공식 정책은 발급 후 180일·만료 14일 전 재발급이다.
- 네이버: Couplet Seoul 통합매니저 로그인과 Commerce API센터 접근을 확인했다. SellerPilot 개발업체 계정 양식은 준비됐고 이메일 인증·자동화 입력 방지·필수 약관 동의 후 애플리케이션을 등록해야 한다. 판매자 데이터 호출은 `SELF`가 아니라 `SELLER`와 판매자 UID를 사용한다.
- Vercel AI Gateway: OpenAI API Key를 저장하지 않는다. 운영 함수에는 Vercel이 발급하는 `VERCEL_OIDC_TOKEN`이 자동 주입되고, SellerPilot은 AI scope Worker Token의 SHA-256 지문으로 Supabase claim 소유권을 별도 확인한다.
- Supabase: 비공개 `sellerpilot-ai` Storage와 AI 작업 큐·토큰 지문·claim receipt·감사 기록을 운영 DB에 적용한다. 익명·일반 사용자는 원문 또는 작업자 함수를 실행할 수 없다.

## Supabase·Vercel 플랫폼 키 갱신

플랫폼 키는 채널 키와 분리한다.

1. Supabase `Project Settings → API Keys`에서 새 Publishable/Secret Key를 만든다.
2. Vercel `sellerpilot-global → Environment Variables`에서 다음 값을 새 버전으로 교체한다.
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
   - `SELLERPILOT_AI_WORKER_TOKEN` (AI scope, sensitive; 기존 활성 원문 복구 또는 server-only 교체 때만 CLI 표준입력으로 설정, 웹 조회·로그 금지)
   - `VERCEL_OIDC_TOKEN`은 Vercel이 함수에 자동 제공하므로 수동 값을 만들거나 Git에 저장하지 않는다.
3. Production과 Preview에 저장하고 재배포한다.
4. 로그인, 키 목록 조회, 연결 검사를 확인한다.
5. 정상 확인 후 Supabase의 이전 Secret Key를 폐기한다.

Secret Key는 절대 `NEXT_PUBLIC_` 접두사를 사용하지 않는다. 새 키 체계는 Supabase의 [API keys 문서](https://supabase.com/docs/guides/api/api-keys)와 [새 API 키 마이그레이션 가이드](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)를 기준으로 한다.

## 검수 체크리스트

- [x] 데모 로그인 제거, 실제 Supabase Auth 연결
- [x] 신규 공개 가입 차단, 관리자 초대 전용
- [x] 비밀번호 최소 10자·복합 문자, 최근 로그인 기반 변경
- [x] 운영 Site URL과 운영·로컬 Redirect URL 등록
- [x] 비공개 스키마와 Vault 저장
- [x] 관리자 UUID 권한 확인
- [x] 키 버전·만료·경고·유예·감사기록
- [x] Qoo10/Shopee/Lazada 읽기 연결 검사 구현
- [x] Shopee/Lazada OAuth state 검증·콜백 처리·만료 전 자동 갱신 구현
- [x] 서버 AI 런타임의 읽기 전용 상태·처리 건수·토큰 불일치 또는 만료 복구 안내 UI 구현(웹 발급·교체·원문 표시 없음)
- [x] Vercel OIDC 서버 상품 스튜디오 claim·heartbeat·멱등 완료와 16개 이미지·26개국 계약 구현
- [x] 연결 검사 응답의 비밀·원문 로그 차단
- [ ] Couplit Supabase 계정 전환 후 Security/Performance Advisor 재검증
- [ ] Couplit Supabase 프로젝트 생성 후 Vercel Publishable/Secret 환경변수 연결
- [ ] 쿠팡 WING 비밀번호 재확인 후 180일 OpenAPI Key를 Vault에 저장하고 상품 목록 읽기 실검수
- [ ] 네이버 Commerce API 계정·애플리케이션 생성 후 SELLER 토큰과 `/v1/seller/account` 실검수
- [ ] Qoo10 승인 테스트 상품번호로 읽기 API 실검수
- [ ] Shopee Partner Key를 Vault에 입력하고 Main account 콜백에서 8개 숍 토큰 교환·읽기 API 실검수
- [ ] Lazada 고정 송신 IP 구성 후 운영 토큰을 Vault에 등록하고 실호출 통과
- [ ] JEONGHUN 프로필에서 Vercel Production의 AI scope sensitive token 배치와 OIDC 서버 실호출을 확인하고, 16개 asset·34개 시장 결과를 운영 원장에서 검수
- [ ] 웹훅 서명·중복 방지·재전송 E2E 검수

남은 항목은 외부 발급·고정 IP·유료 사용 한도가 확정된 뒤 실행한다. 판매채널 키는 문서로 전달하지 않고 승인된 운영 화면의 일회성 입력창을 사용한다. 서버 AI 토큰은 웹 입력창의 대상이 아니며 server-only 복구 절차만 사용한다.
