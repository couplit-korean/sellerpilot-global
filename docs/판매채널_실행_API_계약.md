# SellerPilot 판매채널 실행 API 계약

> 운영 사실(연결·IP·배포 SHA)은 [docs/현재상태.md](./현재상태.md)가 원장이다. 이 파일은 당시 기획/검수 스냅샷이다.

기준일: 2026-08-16
서버 경로: `POST /api/admin/channel-operations`

## 목적

판매채널마다 인증, 상품 식별자, 주문 상태, 배송 절차가 다르므로 UI가 임의의 URL을 조합하지 않는다. 관리자 서버는 고정된 공식 경로만 호출하고, 자격증명은 Supabase Vault에서 복호화한 뒤 요청 시점에만 사용한다.

외부 상태를 변경하는 작업은 `confirmWrite: true`가 없으면 HTTP 428로 거부한다. 모든 요청은 16~160자의 `idempotencyKey`가 필요하며, 동일 채널·작업·키의 중복 요청은 다시 실행하지 않는다. 같은 키에 다른 본문을 넣는 것도 거부한다.

```json
{
  "credentialId": "Vault 자격증명 UUID",
  "channel": "coupang",
  "operation": "inventory.update",
  "idempotencyKey": "stock-SP-001-20260816-0001",
  "confirmWrite": true,
  "arguments": {
    "vendorItemId": "3572784698",
    "quantity": 25
  }
}
```

## 공통 작업

| 작업 | 용도 | 외부 변경 |
|---|---|---|
| `categories.list` | 카테고리·속성 기준정보 조회 | 아니오 |
| `listing.create` | 신규 상품 생성 | 예 |
| `listing.update` | 기존 상품 수정 | 예 |
| `listing.stop` | 판매 중지·오퍼 철회 | 예 |
| `price.update` | 가격 변경 | 예 |
| `inventory.update` | 재고 변경 | 예 |
| `orders.list` | 변경 주문·발주서 목록 조회 | 아니오 |
| `orders.get` | 주문 상세 재조회 | 아니오 |
| `shipment.acknowledge` | 발주확인·포장 | 예 |
| `shipment.confirm` | 송장·발송 완료 전송 | 예 |

## 채널별 인수값과 공식 경로

### Qoo10 Japan

`arguments.params`에 QAPI 메서드별 문자열 파라미터를 넣는다. 서버가 서비스명과 메서드명을 고정한다.

| 작업 | QAPI 메서드 |
|---|---|
| 카테고리 | `CommonInfoLookup.GetCatagoryListAll` |
| 등록 | `ItemsBasic.SetNewGoods` |
| 수정 | `ItemsBasic.UpdateGoods` |
| 중지 | `ItemsBasic.EditGoodsStatus` |
| 가격·재고 | `ItemsOrder.SetGoodsPriceQty` |
| 주문 | `ShippingBasic.GetShippingInfo_v3` |
| 발주확인 | `ShippingBasic.SetSellerCheckYN_V2` |
| 송장 | `ShippingBasic.SetSendingInfo` |

### Lazada

상품·가격·재고는 `arguments.request`의 Lazada `Request` 객체를 공식 XML `payload`로 직렬화하고, 조회 조건은 `arguments.query`에 넣는다. 배송은 상품 XML과 섞지 않는다. 주문 동기화가 `/order/items/get`의 `order_item_id`와 배송 유형을 원장에 보존하고, 발송 시 `/order/shipment/providers/get`의 `getShipmentProvidersReq`로 배송사 코드를 검증한 뒤 `packReq`로 포장하고 응답 `package_id`를 `readyToShipReq`에 넘긴다. Lazada가 발급한 운송장번호를 원장에 기록한다.

| 작업 | LazOP 경로 |
|---|---|
| 카테고리 | `/category/tree/get` |
| 등록·수정·중지 | `/product/create`, `/product/update`, `/product/deactivate` |
| 가격·재고 | `/product/price_quantity/update` |
| 주문 | `/orders/get`, `/order/get` |
| 포장·배송준비 | `/order/fulfill/pack`, `/order/package/rts` |

Lazada Push는 빠른 알림으로만 사용하고 `/orders/get` 누락 보정 조회를 유지한다. 운영 Vercel의 유동 송신 IP 때문에 현재 OAuth 토큰 교환은 고정 출구 IP가 준비될 때까지 차단 상태다.

2026-08-24 공식 Fulfillment API 문서와 계약 테스트로 `GetShipmentProvider → Pack → ReadyToShip` 요청명·순서·오류 판정을 검증했다. 현재 운영 원장에는 `paid` 또는 `ready_to_ship` Lazada 실주문이 없어 외부 상태를 바꾸는 실제 발송 쓰기는 실행하지 않았다.

### 쿠팡

상품 생성·수정은 `arguments.body`에 공식 JSON 전문을 넣는다. 서버가 Vault의 `vendorId`를 덮어써 다른 업체코드가 섞이지 않게 한다.

| 작업 | 추가 인수값 | 공식 경로 |
|---|---|---|
| 등록·수정 | `body` | `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products` |
| 중지 | `vendorItemId` | `.../vendor-items/{id}/sales/stop` |
| 가격 | `vendorItemId`, `price`, `forceSalePriceUpdate` | `.../vendor-items/{id}/prices/{price}` |
| 재고 | `vendorItemId`, `quantity` | `.../vendor-items/{id}/quantities/{quantity}` |
| 주문 목록 | `query.createdAtFrom`, `createdAtTo`, `status` 등 | `/v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets` |
| 발주확인 | `shipmentBoxIds` 최대 50개 | `/v4/vendors/{vendorId}/ordersheets/acknowledgement` |
| 송장 | `body.orderSheetInvoiceApplyDtos` | `/v4/vendors/{vendorId}/orders/invoices` |

쿠팡은 발주확인 후 `orders.get`으로 수취정보가 바뀌었는지 반드시 다시 확인한 다음 송장을 보내야 한다. 가격은 10원 단위로 사전검사한다.

### 네이버 스마트스토어

서버가 요청마다 3시간 OAuth 토큰을 발급한다. `listing.create`, `listing.update`, `price.update`, `inventory.update`, 배송 작업은 `arguments.body`에 공식 JSON을 넣는다.

| 작업 | 추가 인수값 | 공식 경로 |
|---|---|---|
| 카테고리 | `categoryId` | `/v1/categories/{categoryId}` |
| 등록 | `body` | `/v2/products` |
| 수정·중지 | `originProductNo`, `body` | `/v2/products/origin-products/{id}`, `/v1/products/origin-products/{id}/change-status` |
| 가격 | `body` | `/v1/products/origin-products/bulk-update` |
| 옵션 재고 | `originProductNo`, `body` | `/v1/products/origin-products/{id}/option-stock` |
| 주문 변경분 | `query.lastChangedFrom`, `moreSequence` 등 | `/v1/pay-order/seller/product-orders/last-changed-statuses` |
| 주문 상세 | `productOrderId` | `/v1/pay-order/seller/product-orders/query` |
| 발주·발송 | `body` | `/v1/pay-order/seller/product-orders/confirm`, `/dispatch` |

### eBay

상품 등록은 `sku`, `inventoryItem`, `offer`, `publish`를 넣는다. 서버가 Inventory Item → Offer → Publish 순서를 강제하고 중간 실패 시 다음 단계를 호출하지 않는다.

| 작업 | 추가 인수값 | 공식 경로 |
|---|---|---|
| 카테고리 | `categoryTreeId` | `/commerce/taxonomy/v1/category_tree/{id}` |
| 등록 | `sku`, `inventoryItem`, `offer`, `publish` | `/sell/inventory/v1/inventory_item/{sku}` → `/offer` → `/offer/{id}/publish` |
| 수정·가격 | `offerId`, `body` | `/sell/inventory/v1/offer/{offerId}` |
| 중지 | `offerId` | `/sell/inventory/v1/offer/{offerId}/withdraw` |
| 재고 | `sku`, `body` | `/sell/inventory/v1/inventory_item/{sku}` |
| 주문 | `query` 또는 `orderId` | `/sell/fulfillment/v1/order` |
| 송장 | `orderId`, `body` | `/sell/fulfillment/v1/order/{orderId}/shipping_fulfillment` |

eBay는 별도 `shipment.acknowledge` 단계가 없어 이 작업을 미지원으로 거부하고 `shipment.confirm`만 제공한다. App ID/Cert ID/RuName만으로 끝나지 않고 판매자 User OAuth 동의가 1회 필요하다. 게시 전 Inventory Location과 Payment/Return/Fulfillment Business Policy가 있어야 한다.

### 11번가

운영 OPEN API Key와 등록 IP로 상품 읽기와 `listing.create`를 실행하며, 2026-08-24 케이블 정리 상품 등록이 HTTP 200과 원격 상품번호로 완료됐다. 상품 생성 뒤 판매자 상품 검색으로 원격 번호를 대조하고 검증용 등록은 판매중지 단계까지 같은 작업 원장에 기록한다. 현재 Seller Office 로그인 세션이 만료돼 화면 대조가 남아 있고, 실주문이 없어 발주·송장 쓰기는 실행하지 않았다. 문의 조회는 공식 제공 범위를 확인하기 전 통합 CS에서 미지원으로 표시한다.

## 아직 실계정으로 확인해야 하는 항목

1. 각 채널 읽기 진단
2. 카테고리·속성·택배사·출고지 기준정보 동기화
3. 승인된 테스트상품 1건 생성 → 조회 → 수정 → 중지
4. 테스트 주문 발주확인 → 주소 재조회 → 송장 → 취소/반품
5. 429·5xx·timeout·토큰 만료·부분 성공 재시도
6. 30~100 SKU 제한 운영

채널별 완료 범위는 운영 원장의 실제 성공 단계만 표시한다. 11번가는 상품 읽기·등록 성공까지 검증됐지만 실주문 기반 발주·송장과 문의 동기화는 통과로 표시하지 않는다.
