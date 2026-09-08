# 2026-09-08 쿠팡 3차 보완 검증 로그

| 검증 | 결과 |
|---|---|
| 통합 담당의 2차 delta ownership/before/after | 21파일 통합 완료 |
| 통합본 쿠팡 전용+공통 회귀 | exit 0; 74/74; skip 0 |
| 통합본 전체 `tsc --noEmit --incremental false` | exit 0 |
| route mismatch/count 추가 후 `tests/cs-coupang-db-web.test.ts` | exit 0; 4/4 |
| order-lineage DB 최초 실행 | exit 1; 0/4; PGlite `pgcrypto` extension unavailable |
| fixture digest를 저장소 표준 합성 함수로 교체 후 재실행 | exit 0; 4/4 |
| 후속 포함 쿠팡 표적 11파일 | exit 0; 46/46 |
| 후속 TypeScript | exit 0 |
| 후속 변경 파일 ESLint | exit 0 |

## 검증한 반례

- RPC 응답 credential/kind/from/to가 요청과 다름.
- displayed count와 ticket 배열 길이 불일치, total보다 displayed가 큼, ticket prefix가 kind와 다름.
- 동일 vendor의 credential rotation.
- 같은 owner에서 다른 vendor가 동일 external order ID를 사용.
- legacy order에 credential ledger가 없음.
- ticket seller key와 credential seller key 불일치.
- API role의 private ledger SELECT와 recorder EXECUTE.

실고객 원문, 전체 vendor ID, credential secret은 기록하지 않았다. 운영 DB/provider/order 상태는 수정하지 않았다.
