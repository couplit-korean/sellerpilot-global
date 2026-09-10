# 중앙 검토55 — eBay011, Shopee011, Qoo10011, Lazada012, Temu r13

검토 시각: 2026-09-10 04:10 KST

이번 배치는 다섯 채널의 신규 CREATE 직전 승인·readiness 결속을 중앙 로컬 정본에 적용하고 집중 회귀를 수행했다. 코드 통합과 실제 판매채널 신규등록은 별도 단계다. 운영 provider mutation, 운영 DB migration, 배포, commit, push는 수행하지 않았다. 신규등록 증거는 `19/48`, 이 통합본의 신규 CREATE와 공식 원격/판매자 화면 readback은 `0/8`로 유지한다.

## eBay 011

`ebay-011-r1.patch` SHA-256 `c03e49636814d330eb6a0965adaacb52f95817929ecfc0dab02a0d2793dfba62`를 010 이후 중앙 파일에 재적용했다. `buildEbayCreateApproval`은 승인 revision의 영문 제목·본문, 대표 이미지 1장과 상세 이미지 8장, USD 가격, 재고, category/aspects, merchant location, fulfillment/payment/return policy를 하나의 승인 객체로 결속한다.

중앙 route는 브라우저가 보낸 `sellerpilotEbayCreateApproval`을 삭제하고, 승인 상세가 서버에서 결속된 뒤 `buildEbayCreateApproval`로 새로 생성하여 gateway 인자에 넣는다. 중앙 eBay 집중 검사는 `35/35`, route 정적 경계 `2/2`를 포함해 통과했다. 현재 실제 API Taxonomy 호출은 401 상태이므로 OAuth·scope·seller account 원격 정상성은 완료로 기록하지 않는다.

## Shopee 011

`shopee-product-011-r1.patch` SHA-256 `232565923fe0bdc81c1058b39f696fe157db3e2ef3165bd3a614fa79cb0c9420`를 적용했다. `create-prewrite-adapter`는 active credential UUID/version/snapshot, merchant `5511564`, shop `1719148844`, SG official category·attributes·brand·logistics·warehouse·eligible shop, exact SKU/name absence, stored SGD/USD price·stock, 승인 영문 콘텐츠와 대표 1장+상세 8장을 요구한다. TWS03/200008909를 Open API warehouse로 쓰지 못하게 차단한다.

새 요구사항에 따라 실제 workbench의 Shopee 공통 body에 top-level `days_to_ship: 1`을 보존했다. 기존 fixture도 동일 production DTO와 맞췄다. 중앙 집중 검사는 `16/16`, TypeScript와 변경 파일 ESLint가 통과했다. adapter를 실제 global item create/local publish mutation 경계에 연결하는 012를 담당에 재배정했다.

## Qoo10 011

`qoo10-011-create-approval-binding.patch` SHA-256 `885f759985a651333a25f3c9c9db8142f33cec69652649fa739d87cca975f3d8`를 010 이후 중앙 파일에 적용했다. 승인 revision·ja/en 문서·8개 이미지 source hash·상품/SellerCode·JP category·brand·manufacturer·origin·JPY 가격·재고·무옵션·배송·출고지·반품정책 digest를 묶고, worker prewrite 및 원격 evidence에서 재검증한다.

제출 fixture가 UI 계약의 `확인` 대신 일본어 `確認`을 사용하여 첫 중앙 실행에서 27건이 실패했다. 중앙은 실제 공통 폼과 shipping contract에 맞게 fixture를 `확인`으로 교정하고, source-only 및 재결속 시나리오가 새 approval binding까지 정확히 다루도록 보완했다. 최종 집중 검사는 `45/45`다. 인증된 동일 판매계정의 출고지·반품정책 read-only source builder와 route binding이 남아 있어 012를 담당에 재배정했다.

## Lazada 012

`lazada-012-r1.patch` SHA-256 `3e2f086c86fda40a8f7676aef1ed32492b33d8a08c7e6a8dec0a8ccebdde937c`를 적용했다. server-owned revision, OAuth lineage, target, Commerce app/scope, operator approval과 injected official GET dependencies로 010 readiness input을 만든다. 공식 GET plan은 seller, exact SellerSku products `limit=50`, English category tree/attributes, bounded brand pagination, shipment providers이며 세 번의 revision fence를 통과해야 한다.

중앙 집중 검사는 `18/18`이다. 현재 shared route와 executor에는 이 builder가 요구하는 app/OAuth/operator evidence producer가 없고, 기존 `executeLazada`에는 별도 seller/SKU GET 및 `limit=100` 경로가 남아 있다. 이 값을 추측해 연결하지 않는다. producer를 추가한 뒤 012 단일 read batch → 011 단일 CreateProduct edge로 교체해야 한다.

## Temu r13

`temu-001-r13-server-readiness-builder.patch` SHA-256 `3a224acb6f91d8200f4cd28536226339ebc27f4b06baf84c6bbff929081e2258`를 적용했다. builder는 5분 이내 current app row/Active/Compliance Approved, policy registry, token-info mall/region/scopes, exact product revision·fingerprint·가격·재고·package, official category/compliance, 승인 대표1+상세8, store shipping, GLOBAL endpoint egress, exact goods/SKU empty read를 같은 계보로 묶는다.

중앙 집중 검사는 `14/14`다. current Partner Platform `Applications`가 `Total 0 items`였고 route에는 공식 app/category/compliance/shipping/egress/duplicate-read producer가 없으므로 binding은 정상적으로 fail-closed 상태다. 채널 전용 authoritative source collector 014를 담당에 재배정했다.

## 중앙 판정

- 적용된 다섯 제출의 집중 회귀: 모두 통과
- nonincremental TypeScript: 통과
- 변경 파일 ESLint: 통과
- 실제 신규 CREATE: `0/8`
- 공식 원격·판매자 화면 readback: `0/8`
- 6단계 진행률: `19/48 = 39.6%`
- 운영 DB/provider mutation/Vercel 배포/commit/push: 모두 0

Qoo10·Shopee·eBay·Temu는 다음 채널 전용 구현으로 즉시 재가동했다. SmartStore·Coupang·Elevenst·Lazada도 active 상태다. 중앙 다음 순서는 각 source builder를 검토·통합하고, 서버 source가 존재하는 채널부터 route/executor의 단일 mutation 경계에 연결하는 것이다.
