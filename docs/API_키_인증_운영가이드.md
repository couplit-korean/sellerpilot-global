# SellerPilot API 키·인증 운영 가이드

## 현재 운영 연결

- Vercel 프로젝트: `sellerpilot-global` (`couplitofficial-4206` 계정)
- Supabase 조직: `couplit-korean's Org`
- Supabase 프로젝트: `couplit-korean's Project`
- Supabase 프로젝트 참조: `sqaoqucxakebqkiygdxb`
- 운영 도메인: `https://sellerpilot-global.vercel.app`
- 인증 방식: Supabase Auth 이메일·비밀번호, 관리자 초대 전용
- 비밀 보관: Supabase Vault, 버전별 불변 저장

비밀키 원문은 Git, 브라우저 저장소, 화면, 감사 로그에 남기지 않는다. Vercel에는 Supabase 서버 접근용 Secret Key만 서버 전용 환경변수로 보관하고, 판매 채널 키는 웹 관리 화면에서 Vault로 저장한다.

## 키 교체 표준 절차

1. `API 키 · 인증` 메뉴에서 채널을 선택한다.
2. 새 키만 입력한다. 기존 키는 다시 표시하거나 자동 입력하지 않는다.
3. 만료일, 교체 주기, 사전 경고일, 이전 키 유예 기간을 지정한다.
4. 저장하면 새 버전이 `active`, 이전 버전은 `grace`가 된다.
5. `연결 검사`로 읽기 전용 API를 호출한다.
6. 검사 통과 후 채널 콘솔에서 이전 키를 폐기한다.
7. 감사기록에서 버전, 지문, 작업시각, 검사 결과를 확인한다.

키 지문은 비밀값의 SHA-256 앞 12자리만 표시한다. 원문을 복구하거나 화면에 노출하는 기능은 제공하지 않는다.

## 채널별 필수 입력과 수명

| 채널 | 필수 연결값 | 현재 수명 기준 | 안전 검사 |
|---|---|---|---|
| Qoo10 Japan | Seller ID, QAPI Key, 승인된 테스트 상품번호 | 콘솔 만료 표시 없음, 내부 90일 교체 권장 | 자격 형식 확인 후 승인 상품 읽기 검수 |
| Shopee | Partner ID, Partner Key, Shop ID, Access Token | 관찰된 Partner Key 만료일 2026-09-15 | `get_shop_info` 읽기 API |
| Lazada | App Key, App Secret, Access Token, Refresh Token, 국가 | Access 30일, Refresh 180일 | `/seller/get` 읽기 API |

## Supabase·Vercel 플랫폼 키 갱신

플랫폼 키는 채널 키와 분리한다.

1. Supabase `Project Settings → API Keys`에서 새 Publishable/Secret Key를 만든다.
2. Vercel `sellerpilot-global → Environment Variables`에서 다음 값을 새 버전으로 교체한다.
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
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
- [x] Shopee/Lazada 읽기 연결 검사 구현
- [x] 연결 검사 응답의 비밀·원문 로그 차단
- [x] Supabase Security Advisor 오류 0건 확인
- [x] Vercel 새 Publishable/Secret 환경변수 연결
- [ ] 관리자 초대 메일에서 최종 비밀번호 설정
- [ ] Qoo10 승인 테스트 상품번호로 읽기 API 실검수
- [ ] Shopee/Lazada 운영 토큰을 Vault에 등록하고 실호출 통과
- [ ] 웹훅 서명·중복 방지·재전송 E2E 검수

마지막 네 항목은 관리자 비밀번호와 판매 채널 자격증명이 실제로 입력된 뒤 실행한다. 키를 화면이나 문서로 전달하지 말고 반드시 운영 화면의 일회성 입력창을 사용한다.

