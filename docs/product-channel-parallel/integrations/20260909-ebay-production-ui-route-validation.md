# eBay 중앙 production UI 및 POST 경로 로컬 검증

2026-09-09, policyReview 수정이 적용된 중앙 source로 검증했다.

- `tests/ebay-product-publish-workbench.browser.mjs` SHA-256: `bad94b92a96a994c91d2963454c5c6dee8aa75c17d0fc8da4c5a9f2b88632046`
- `tests/ebay-channel-operations-route-flow.test.ts` SHA-256: `48e675b0a9b6731f27c716d8dca0fb9ad47f9fa6ab31eac9ac6ef5bc4f531813`

실행 명령:

```sh
EBAY_POLICY_REVIEW_PATCH_APPLIED=1 node --test tests/ebay-product-publish-workbench.browser.mjs
node --import tsx --test tests/ebay-channel-operations-route-flow.test.ts
```

브라우저: 정상 경로 1 PASS, 수정 전 결함 재현 1 SKIP. 중앙 production ProductPublishWorkbench를 재수정 없이 빌드해 policyReview 입력, draft PUT, unmount/remount 후 GET 복원, 확인 버튼, 실행 POST, 실패/성공 DOM 및 USD/정책/창고 입력을 검증했다. 임시 headless 프로필과 localhost fixture만 사용했다.

서버: actual channel-operations POST 1/1 PASS. 동일 필드와 fingerprint 전달 및 실패 422/검증 결과 200 분기를 확인했다. 대상 ESLint와 전체 non-incremental TypeScript도 통과했다.

한계: 브라우저의 API 응답은 fixture이며 서버 테스트와 하나의 네트워크로 연결된 E2E가 아니다. 서버 테스트는 Auth/RPC/storage/gateway 외에도 approved detail manifest helper 및 image preparation을 mock한다. 따라서 상세 원본 결속 자체와 실제 provider 응답은 이 테스트의 증명 범위가 아니다. 담당 초기 보고의 모든 content lineage 검증이라는 해석은 적용하지 않는다.

로그: `.local/product-channel-inbox/review14-ebay-browser.log`, `review14-ebay-route.log`, `review14-ebay-lint.log`, `review14-ebay-tsc.log`.

실제 판매자 API, 운영 DB, OAuth, 배포 및 기존 offer 변경은 없었다. 신규 CREATE 집계는 유지한다. 중앙 변경은 미커밋 상태다.
