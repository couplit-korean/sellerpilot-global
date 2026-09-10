# 2026-09-08 검증 로그 요약

실고객 원문, credential 원문, 전체 업체 식별자는 기록하지 않았다.

| 시각(KST) | 명령/관측 | 종료/결과 |
|---|---|---|
| 18:41 | S0 manifest와 쿠팡 소유 3개 파일 SHA-256 대조 | 3/3 일치 |
| 18:48~19:05 | CHANGHEE WING, JEONGHUN Supabase 읽기 전용 대조 | seller/vendor 계보 일치; WING 상품문의 0, 고객센터 미답변·미확인 0, 상품평 0; 운영 ticket 0 |
| 19:08 | `node --import tsx --test tests/cs-coupang-contact-center.test.ts tests/coupang-after-sales.test.ts` | exit 0; 9/9 통과 |
| 19:10 | 위 두 파일 + `tests/cs-history-channel-db.test.mjs` | exit 0; 19/19 통과 |
| 19:28 | unsequenced csAgent/vendor fail-closed 보완 후 채널+격리 DB, TypeScript, ESLint 재실행 | exit 0; 19/19 및 정적 검사 통과 |
| 19:28 | 정본 지시의 4개 시험 파일 재실행 | exit 1; 49개 중 48개 통과. 기존 공용 11번가 오류명 불일치만 재현 |
| 19:08 | `node node_modules/typescript/bin/tsc --noEmit --pretty false` | exit 0 |
| 19:08 | `pnpm exec eslint lib/channels/coupang-inquiries.ts lib/channels/coupang-inquiry-history.ts lib/channels/cs/coupang/contact-center.ts tests/cs-coupang-contact-center.test.ts` | exit 0 |
| 19:08 | 정본 지시의 4개 시험 파일 | exit 1; 49개 중 48개 통과. 유일 실패는 공용 11번가 오류명 기대 불일치이며 쿠팡 시험은 통과 |

운영 읽기 전용 SQL 집계:

- `support_tickets`: `channel_key='coupang' and not demo` 총 0.
- 과거 성공 gateway read: 상품 ALL 2,279 jobs, provider rows 0, nonempty jobs 0; 콜센터 NO_ANSWER 2,279 jobs, provider rows 0, nonempty jobs 0.
- 위 성공 작업의 생성/완료 시각 범위는 2026-08-22~26이며 요청 date 값은 2026-08-16~26 범위에 걸쳐 있었다.
- 운영 DB `supabase_migrations.schema_migrations`에는 20260908047000, 20260908047100이 0행이었다.
- 반품/취소/교환 `inquiries.list` 운영 작업은 집계 결과에 없었다.
