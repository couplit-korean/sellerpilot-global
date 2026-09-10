# 2026-09-09 쿠팡 CS reader-gate 검증 로그

## 고정한 함수 본문

| 함수 | `md5(prosrc)` |
|---|---|
| 007 candidate | `e9c382cbd7696dc878f755f38bcb25ac` |
| 007 exact validator | `6c053e7477c176dcf1eb38bf7b4c067c` |
| workspace snapshot | `a1395073773c39c98aae04b2cdc0652f` |
| ticket reply context v2 | `a95fc5f04ab1eec9a2c3287f47fdaef7` |
| support reply job | `843404d8ab9b1531017c2508b255f36a` |
| unsafe AI predecessor | `f283b016bf036df178a8ed34c97096c4` |
| order binding health | `545c98eb651cac531354bbe32ccb0196` |

## 실행 결과

| 검증 | 결과 |
|---|---|
| `node --test tests/cs-coupang-order-reader-gate-db.test.mjs` | 3/3, skip 0, exit 0 |
| `node --test tests/cs-coupang-order-lineage-db.test.mjs tests/cs-coupang-order-reader-gate-db.test.mjs tests/cs-commerce-boundaries-db.test.mjs` | 20/20, skip 0, exit 0 |
| `node --import tsx --test tests/cs-coupang-order-lineage.test.ts tests/lazada-durable-item-ownership.test.ts` | 4/4, skip 0, exit 0 |
| `node --test tests/cs-coupang-*.test.mjs` | 29/29, skip 0, exit 0 |
| `node --import tsx --test tests/coupang-after-sales.test.ts tests/cs-coupang-*.test.ts` | 28/28, skip 0, exit 0 |
| repository ESLint binary, two order DB tests | exit 0 |

검증은 번들 Node 실행 파일과 저장소의 기존 `node_modules`를 사용했다. 격리 PGlite만 생성했으며 운영 DB/provider/credential/order/reply/route/job에는 접근하거나 쓰지 않았다. 고객 원문·주소·전화번호·secret을 출력하거나 저장하지 않았다.

## 판정

- stale lineage: 최신 order upsert보다 오래된 provenance는 exact 아님.
- projection failure: 쿠팡 CS projection 실패는 order/provider intake rollback 사유 아님.
- reader gate: 목록·상세·AI order context·health가 모두 같은 exact 판정 사용.
- non-Coupang: Qoo10 reader/health/AI 결과와 canonical validator 경로 보존.
- 운영 상태: proposal-only, 미통합·미배포·미적용.
