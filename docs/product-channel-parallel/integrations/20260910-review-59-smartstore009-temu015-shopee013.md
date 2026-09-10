# 중앙 검토59 — SmartStore009, Temu015, Shopee013

검토 시각: 2026-09-10 04:49 KST

신규상품 CREATE 작업 세 건을 중앙 로컬 정본에 순차 적용했다. 과거상품 전용 successor는 사용자의 제거 지시에 따라 SmartStore 다음 작업에서 제외했고 예약했던 022000 항목도 중앙 예약 원장에서 삭제했다.

## SmartStore009

patch SHA-256 `69e356235384038aa20d21eb29efcd896c2812cbbf7e1d6462077723bbd500f5`를 적용했다. confirmed assignment의 category/revision/digest와 공식 category/attribute/value/unit readback을 결속해 SELECT, MULTI_SELECT, RANGE를 provider-native `productAttributes`로 만든다. stale/cross-category/duplicate/PRIMARY 누락/unknown unit/out-of-range는 CREATE·PUT 0의 structured blocker다.

중앙 선택 회귀 `20/20`, nonincremental TypeScript와 변경 파일 ESLint가 통과했다. 실제 current assignment/RPC source, request fingerprint 전 재검사, 008 official readback 결합은 SmartStore010으로 계속한다.

## Temu015

patch SHA-256 `1913f1844f35613f50b1a91140d3d72cc830cdfbad30f3ee6c92e4f7b7b3cb1e`를 적용했다. r14의 token-info, exact goods, exact SKU dependency를 기존 signed `temuRequest`와 read-only transport에 결속하고 raw provider row/error/cursor를 밖으로 노출하지 않는다. 현재 Applications가 0 rows이면 app read 이후 signed provider call도 0이다.

중앙 선택 회귀 `55/55`, nonincremental TypeScript와 변경 파일 ESLint가 통과했다. current app-row, category compliance, store shipping, egress, approved representative image source는 Temu016으로 계속한다.

## Shopee013

patch SHA-256 `8d47f7d2d8199c0785e5e09ae4547a5790221dac3e7c22948fe1005642b6658e`를 적용했다. 011 prewrite의 authoritative read를 반복하지 않는 native image-only adapter와, exact server-owned Global ID로 local publish만 재개하는 orchestration을 추가했다. 신규 정상 경로의 Global/local POST는 1/1, Global readback 실패는 1/0, local resume은 0/1, 이미 연결된 exact item은 0/0이다.

중앙 선택 회귀 `45/45`, nonincremental TypeScript와 변경 파일 ESLint가 통과했다. 실제 `executeShopee` 분기와 DB execution-lineage fence 결합은 Shopee014로 계속한다.

## 상태

운영 OAuth/provider/DB/deploy/commit/push는 0이다. 세 패치는 등록 전 source와 실행 계약을 보강했으며 실제 신규 CREATE, 공식 remote GET, 판매자/구매자 화면, durable internal completion 증거는 만들지 않았다. 따라서 `19/48 = 39.6%`, 실제 신규 CREATE와 공식 원격/사이트 완료 `0/8`을 유지한다.

