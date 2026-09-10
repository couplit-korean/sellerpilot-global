# 중앙 검토58 — 신규 CREATE source/orchestration 6채널 통합

검토 시각: 2026-09-10 04:40 KST

이번 배치는 Shopee012, Temu014, Elevenst009, Coupang004, Qoo10012, Lazada014를 중앙 로컬 정본에 순차 적용했다. 모두 신규상품 CREATE 경계만 대상으로 하며 과거상품 복구 분기는 추가하지 않았다. 운영 provider mutation, 운영 DB 적용, 배포, commit, push는 수행하지 않았다.

## 통합 내용

- Shopee012 patch `d00a47471cae7dac345b4d98807d3c3c0e73d4bbeca150ebf29a4cd6e1abb5bf`: current official requirements와 exact duplicate absence를 한 번만 읽고 native image 준비, Global CREATE/GET, local publish/GET을 순서대로 수행하는 orchestration을 추가했다. 실제 shared execute 결합과 Global 성공 뒤 local 실패 재개 계약은 Shopee013으로 계속한다.
- Temu014 patch `ec457a35ab513a25fd4ec5afa153de06f81d1a2a79bdb4bb9b35b321b86e396a`: app/token/category-compliance/shipping/egress/exact goods/exact SKU의 일곱 read-only source를 한 revision으로 수집하는 server-owned collector를 추가했다. concrete signed adapter는 Temu015로 계속한다.
- Elevenst009 patch `953fe2f5bb9c7968dccab04f04a27d7442173753ae2194570d001a9a6b99e9aa`: browser receipt와 ProductNotification을 제거하고 여섯 DB/RPC source에서 category 1346631의 11개 고시, 배송·반품·상세·이미지·seller ownership·availability를 재구성한다. 실제 service-only RPC 및 claim 경계 결합은 Elevenst010으로 계속한다.
- Coupang004 patch `43858e7838137a4338bae56bf849ce68a5ab1e3de0007399ead4cf508870f56e`: 신규 CREATE 입력 19개를 `resolved`, `manual_required`, `provider_read_required`, `blocked`로 분류하고 전부 resolved일 때만 003 source revision 후보를 만든다. 공용 two-pass UI/server 결합은 Coupang005로 계속한다.
- Qoo10012 patch `27b6e16da967e473ff0952b01c1e98058280329fa7e66b0abd1ccd7f6cf122e6`: 같은 seller의 account-first 공식 GET, dispatch place, return policy를 sealed fulfillment evidence와 approval에 결속한다. 중앙 통합에서 dispatch/return digest drift 두 항목이 approval 비교에서 빠진 것을 보완하고 오래된 partial fixture를 server evidence fixture로 교체했다. 공식 QSM/QAPI endpoint adapter는 Qoo10013으로 계속한다.
- Lazada014 patch `90d62ce81d182918b6cc3046eda162357031142bbdc41db4295952c50d3bbc63`: product, active Vault credential, claimed OAuth callback, current MY target, Couplit Commerce Online app/scopes, operator approval의 여섯 service source를 한 listing claim revision에 결속한다. 실제 `014 → 012 → 011 → 013-r2` 실행 결합은 Lazada015로 계속한다.

공용 admin create route는 client가 제출한 eBay approval, Qoo10 approval, Shopee prewrite evidence, Temu review/create binding을 fingerprint 전에 제거한다. 각 증거가 server builder로 재발급되기 전에는 fail-closed 상태이며 client 문자열로 provider mutation을 열 수 없다.

## 검증

- Shopee focused `39/39`, Elevenst selected `46/46`, Coupang004 `9/9`, Qoo10 integrated `66/66`, Lazada owned chain `31/31`, Temu014 focused `23/23` 통과.
- 각 배치 후 nonincremental TypeScript와 변경 파일 ESLint 통과.
- Qoo10 초기 중앙 회귀 `63/66`에서 확인한 세 통합 차이를 중앙 보완한 뒤 `66/66` 통과.
- 쿠팡 이름 전체 glob은 상품과 무관한 기존 CS `server-only` 실행환경 및 오래된 proposal reverse-check까지 포함해 `309/315`였고, 신규 004 focused `9/9`와 TypeScript/ESLint는 통과했다. 이 확대 결과를 전체 저장소 통과로 표시하지 않는다.

## 진척 판정

이번 배치는 code/source 계약을 보강했지만 실제 신규 provider CREATE, 공식 remote GET, 판매자/구매자 화면, durable internal completion 증거를 만들지 않았다. 따라서 6단계 실증은 `19/48 = 39.6%`, 실제 신규 CREATE와 공식 원격/사이트 완료는 `0/8`로 유지한다.

