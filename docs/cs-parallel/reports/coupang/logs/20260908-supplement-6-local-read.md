# 2026-09-08 쿠팡 CS local read 실행 검증 로그

| 검증 | 결과 |
|---|---|
| 최신 통합본 JS patch | `git apply --check`, exit 0 |
| production MD5 preflight | access/allowed/claim/constraint 네 digest 원문 유지 |
| PGlite canonical chain | 07110000→07161000→07180000→08011500→08013000 wrapper 설치 |
| 008 SQL 전체 실행 | preflight→constraint/access→postflight→commit 성공 |
| route row 자동생성 | 적용 전 0, 적용 후 0 |
| access 허용 | `coupang:inquiries.list = read` |
| 금지 access | reply/order/shipment/listing.update/다른 채널 모두 NULL |
| valid exact claim | `inquiries.list` 1건 |
| identity/attestation drift | seller/credential/release/egress/token/route 각각 claim 0 |
| read binding drift | listing ID/external-detail 각각 claim 0 |
| 금지 tuple 실제 claim | reply/order/shipment/listing.update 각각 0 |
| DB 동작 시험 | 3/3, skip 0, exit 0 |
| patch/preimage 계약 | 2/2, skip 0, exit 0 |
| ESLint | exit 0 |

운영 DB, route, job, credential, provider, reply는 변경하지 않았다.
