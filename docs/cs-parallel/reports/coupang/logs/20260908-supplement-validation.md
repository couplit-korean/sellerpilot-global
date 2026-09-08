# 2026-09-08 쿠팡 보완 검증 로그

실제 credential, 전체 vendor ID, 실고객 원문은 기록하지 않았다. 운영 provider 호출, 고객 답변, 운영 DB write는 수행하지 않았다.

| 시각(KST) | 명령/검증 | 결과 |
|---|---|---|
| 21:10 | 통합 소스와 전용 작업폴더의 이전 4파일 SHA-256 재대조 | 4/4 일치; 통합된 첫 delta와 `reply_sequence_unresolved` 보완 확인 |
| 21:12 | 콜센터 단건 fixture → 정규화 → 공통 `inquiryReplyObservations` | exact inquiryId/parentAnswerId/본문 fingerprint 1건; 과거 parent 오염 0; parent 누락은 미결속 |
| 21:13 | 30일/7일 고정 복구 batch 및 성공·중단·실패 checkpoint fixture | 30일 5창×8 scope=40 jobs; 실패·중단은 same end date; 완전 성공만 이전 날짜로 이동 |
| 21:14 | `node --import tsx --test tests/cs-coupang-contact-center.test.ts tests/cs-coupang-history-recovery.test.ts tests/coupang-after-sales.test.ts tests/reply-verification.test.ts` | exit 0; 21/21 통과 |
| 21:15 | `pnpm exec tsc --noEmit --pretty false` 첫 실행 | exit 127; shell PATH에서 `node` 미발견. 코드 실패가 아님 |
| 21:16 | Node 22 PATH를 명시해 TypeScript와 변경 4파일 ESLint 재실행 | exit 0 |

공통 reply verifier와 DB 관측 계약은 이미 seller event를 일반 inbound에서 분리하고 exact binding을 요구한다. 남은 공통 공백은 provider acceptance 직후 단건 readback job을 자동 enqueue하는 부분이다. 과거 복구의 남은 공통 공백은 run ledger가 완전 성공했을 때만 종료일 cursor를 전진시키는 부분이다.

