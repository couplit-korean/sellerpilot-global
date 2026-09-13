# 기존 Shopee 세션 확인과 갱신 저장·재시도 복구

2026-09-13 18:32 KST. 정규 소스 `/Users/kimchangheemac/dev/sellerpilot-app`, 운영 Supabase `sqaoqucxakebqkiygdxb`. [비밀값을 제외한 증거](20260913-shopee-existing-session-recovery.json).

## 이번에 적용한 수정

1. `shopee_target_refresh_merge_v1`은 대상 배열 전체를 8개로 제한했으나 실제 계정은 숍 8개와 머천트 1개다. 숍별 최대 8개·머천트별 최대 8개를 유지하면서 총 16개까지 허용했다. 다른 대상의 토큰/속성 변경, 대상 추가, credential widening, 잘못된 mirror, 오래된 credential version을 거부하는 기존 조건은 유지한다.
2. 이전 갱신 결과가 미확정이어도 lease 만료 후 다음 CS 작업이 refresh claim을 덮어쓰는 경로를 차단했다. 이전 job의 `credential_refresh_in_flight=true`이면 새 claim으로 변경하기 전에 `SHOPEE_PRIOR_REFRESH_RECONCILIATION_REQUIRED`로 거부한다. 이 검사는 외부 갱신 호출 전 실행된다. 과거 오류·미확정 플래그·원장 내역을 임의로 지우지 않았다.
3. 실제 migration `20260913092500_shopee_refresh_shop_merchant_bounds.sql`을 적용했다. preimage 검증, 제한된 DB lock/statement timeout과 migration journal 원문 SHA256 대조를 거쳤다. 운영 credential을 읽어 부작용 없는 merge 함수에 전달한 결과 실제 9개 대상 보존을 확인했고 trigger 활성/일반 역할의 직접 실행 불가도 확인했다. 이것은 토큰 발급 또는 실제 갱신 저장 성공 증거가 아니다.
4. PGlite DB 회귀 5개 통과. 수정 전 9개 대상 실패 재현, 수정 후 shop/merchant별 복구·prepare, 다른 8개 대상 보존, 9개 숍/대상 추가/타 대상 수정 거부, lease 만료 후 미확정 재시도 차단, 권한 및 재적용 차단을 포함한다. prepare RPC 주변의 일반 Vault staging은 테스트 fixture이므로 운영 Vault 쓰기 성공으로 해석하지 않는다.

이 변경은 DB/테스트/문서다. 웹·Mac 실행 코드는 `191e5cc02789d4b1dfdbedb0ae0ad08db07fa510` 그대로이며 Vercel 재배포나 worker 재시작은 필요하지 않다.

## 기존 탭에서 확인한 실제 상태

- 사용자가 준비한 기존 Aside Tabs에서 Shopee Open Platform과 Seller Centre 로그인을 모두 확인했다. 개발자 앱은 Couplit/partner 2031489 Online, 판매자는 `gjrxn:main`이다. 새 로그인·OTP·OAuth 시작을 시도하지 않았다. API 로그의 View API Details 링크는 공식 문서 탭을 열었으며 로그인 탭이 아니다.
- 기존 개발자 탭의 API Access Log에서 16:22~18:22 KST 조회 범위의 갱신 요청 8건이 모두 POST `/api/v2/auth/access_token/get`, HTTP 403, `error_param`임을 확인했다. 요청 대상은 shop 1758392135이고 오류 설명은 refresh token 또는 shop ID 불일치다. 토큰을 포함하는 원시 API 로그는 저장소에 복사하지 않았다.
- 운영 credential v88의 8개 숍 중 기본 숍 1719148844는 기록상 access 만료가 19:15 KST다. 나머지 7개 숍은 모두 동일한 오래된 access/refresh 값을 공유하고 있으며 access는 9월 3일 만료로 기록되어 있다. 머천트의 access는 9월 4일 만료다. 기록상 refresh 만료일이 미래라고 해서 Shopee에서 유효한 토큰이라는 뜻은 아니다.
- 별도 `main_account_refresh_token`이 존재하고 9개 대상의 현재 refresh 값과 다르다. 공식 get_access_token 문서는 최초 refresh token이 각각의 승인된 shop/merchant에서 사용 가능하다고 설명한다. 현재 refresh_access_token 문서는 대상별 갱신과 일회 사용 조건을 명시한다. 저장된 메인 토큰의 현재 유효성·대상별 과거 소비 여부는 확인되지 않았다. 해당 토큰을 임의 교환하거나 복사하지 않았다.
- 현재 claim이 보존하는 마지막 작업은 18:19:57 KST의 `b9a83235-5e16-456a-b0d2-60da16ea51e3`, 미확정이며 recovery Vault가 없다. 시간 일치만으로 개별 provider 오류와 DB 작업의 원격 request ID 연결이 완성되었다고 간주하지 않는다.

DB의 9개 대상 저장 결함과 최근 provider 403은 각각 확인한 별도 문제다. DB 제한 수정만으로 provider가 거절한 토큰이 유효해지지는 않는다. 8개 숍 인증이나 CS 수집 완료로 표시하지 않는다.

## 운영 상태와 남은 작업

| 범위 | 18:31~18:32 확인 | 다음 완료 근거 |
|---|---|---|
| Mac gateway | 운영 SHA 일치, ready, active 0, 최근 contact HTTP 200 | 실제 채널별 job/provider/result 저장은 각각 확인 |
| DB | backends 17, blocking 0, 장기 transaction 0, deadlocks 0 | 안정성 관측이며 모든 쿼리 최적화 완료를 뜻하지 않음 |
| Shopee | 저장/미확정 재시도 결함 수정 적용, 센터 두 곳 로그인 정상 | 기존 메인 토큰의 발급·소비 이력 및 provider request ID 대조 → 원장에 결속된 일회 복구/안전한 실패 판정 → 8개 숍+머천트별 readback. 사용자 지시 전 새 로그인/OAuth 시도 금지 |
| Lazada | 중앙 IM 시스템 메시지 13건. 앞선 MY 수집/국가 증거 보존 DB 수정 완료 | IM 앱 137571 Cross-border 전용 OAuth 계약 구현과 MY 외 4개국 실제 grant/readback. 기존 MY commerce 137451 경로에 IM 코드를 섞지 않음 |
| eBay | 중앙 시스템 메시지 21건. 이전 일반 메시지 권한 승인 유지 | 실제 고객 대화/답변 대상과 provider readback 별도 |
| 상품·답변·배송 | 이전 현재 배포의 상품 등록 gate 검증은 유지. 이번에 실제 등록/메시지/송장 없음 | 실제 허용 대상에 대한 실행 결과와 채널 재조회, 구매자 화면 확인 |

이미 완료한 eBay 승인이나 DB RPC 이름 누락 복구를 다시 시작하지 않는다. 이 문서는 모든 채널 거래 완료 보고서가 아니다.

## 공식 문서

- [Shopee get_access_token](https://open.shopee.com/documents/v2/v2.public.get_access_token?module=104&type=1) — 로그인된 기존 개발자 탭에서 문서를 열어 확인.
- [Shopee refresh_access_token](https://open.shopee.com/documents/v2/v2.public.refresh_access_token?module=104&type=1) — 2026-07-13 변경 이력 포함 현재 페이지 확인.
- [Lazada authorization](https://open.lazada.com/apps/doc/doc?docId=108260&nodeId=10777) — 이전 후속에서 확인한 Cross-border grant 범위.
