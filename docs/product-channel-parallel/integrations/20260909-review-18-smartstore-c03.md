# SmartStore C03 중앙 로컬 통합 검토 18

2026-09-09. 기존 상품의 추가 PUT 없는 재검증 범위다. 신규 CREATE 증거에 합산하지 않는다.

## 적용

`smartstore-001-r3.patch` SHA-256 `38fb767bd09572fb87af7d5a583c9e38bae653b2e869d5f8cebb6d682f0c6405`의 7개 파일을 별도 scratch에서 apply-check한 뒤 중앙 before hash를 다시 대조해 적용했다. 제출 DB 테스트의 미사용 `workerVersion` import만 중앙에서 제거했다. 정확한 파일별 전후 해시는 `.local/product-channel-inbox/review18-c03-preapply.json`에 보존했다.

기존 실패 job과 completion을 보존하고, 정확한 승인 revision·판매계정·상품·요청에 결속된 GET-only successor를 별도 생성하는 SQL이다. 원래 실패 기록을 성공으로 덮어쓰지 않는다. 현재 binding drift, stale evidence, 중복 claim, 변형 replay, 권한 불일치를 거부한다. 서버 상태 스키마와 UI parser가 추가 provider mutation 없이 확인된 결과를 읽도록 연결했다.

## 중앙 독립 검증

- `node --test tests/smartstore-adoption-recheck-successor-exact-guard.test.mjs`: PGlite 20/20. 가져오는 선행 테스트 포함 수치다.
- `node --import tsx --test tests/smartstore-content-repair-api.test.ts tests/smartstore-existing-adoption-ui.test.ts tests/smartstore-successor-runtime-integration.test.ts`: 21/21.
- TypeScript noEmit 통과, 변경 6개 JS/TS 파일 ESLint 통과.
- 업무 경계/채널 경계 감사 모두 통과. 상품↔CS↔배송 직접 의존 0, 다른 채널 의존 0.

API 검사에서 실제 route와 commerce completion 함수를 실행하지만 Auth/RPC 응답은 fixture다. PGlite는 선행 migration을 적용한 로컬 DB다. 실제 운영 DB/Auth/worker/provider/브라우저 증거가 아니다. 담당이 별도 scratch에서 보고한 57/57·26/26을 중앙 실행 수치로 복사하지 않았다. 기존 gateway source-order 5/6 이력은 이 검증 범위 밖이며 전체 저장소 테스트가 통과했다고 주장하지 않는다. 이번 작은 서버 스키마/UI parser 변경에 대해 동일 전체 빌드는 반복하지 않았다.

## 운영 전 남은 조건

SQL 파일은 로컬 저장소에만 반영했다. 운영 적용 금지 상태를 유지한다. 실제 적용 시 최신 함수 preimage와 migration history, 정확한 선행 recheck·approval·credential·worker release binding을 다시 검사해야 한다. 승인된 실행자가 GET-only enqueue/claim/completion, 불변 원본 snapshot과 내부 resolver 결과를 확인하기 전에는 운영 정상 완료가 아니다. CREATE/PUT/운영 SQL/배포/release gate 변경은 모두 0이다.

전체 단계 증거는 19/48, 현재 통합본 신규등록·원격/사이트 완료는 0/8을 유지한다. Qoo10 C02 005는 별도 미통합 제출이며 collector 전용 개발은 담당 작업에서 재개했다.
