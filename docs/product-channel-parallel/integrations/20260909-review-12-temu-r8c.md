# Temu r8c 중앙 검증

2026-09-09 중앙 작업 폴더에 r7/r8a/r8b 후속 fixture 호환 패치를 적용했다.

- 패치 SHA-256: `b05a0a5ec90bc5f774068fed14bc6ce8763a5b8aaf9f46bd8005d30ae6327dce`
- 대상: `tests/temu-publication-readback.test.ts` 한 파일
- 적용 전: `63e7f21ccbef4f6ba02c7990cc634d8f9ac5dc1655dad8da9476ad167dd0d0f6`
- 적용 후: `c3611804b17b6ce08f47068e93df75b96ba302612928f2f957c290720eb61ed6`

Git apply check가 메타데이터 접근 중 20초 제한으로 종료되어, 원본 before hash와 담당 작업 폴더 파일의 frozen after hash를 검증한 뒤 해당 파일만 복사했다. 적용 전 실행된 검사는 기존 41/48 결과였으며, 적용 후 다시 실행한 중앙 검사는 48/48 통과했다.

기존 timeout reconciliation, pending review, safe test, LONG ID, missing readback, definite rejection, price/stock drift 단언을 유지하며 새 계정 identity 조회 fixture를 추가했다. 운영 검증 조건을 완화하지 않았다. 중앙의 BigInt(300) 호환 수정도 포함된 상태에서 전체 TypeScript 검사와 대상 ESLint가 통과했다.

로그: `.local/product-channel-inbox/review12-temu-r8c-tests.log`, `review12-temu-r8c-tsc.log`, `review12-temu-r8c-lint.log`.

이 결과는 로컬 mock transport 통합 증거다. 실제 Temu API 등록, 운영 credential/Vault/DB 변경, 배포는 수행하지 않았다. 현재 신규 등록 완료 집계는 19/48단계로 유지한다. 이 검토 결과와 코드 변경은 아직 중앙 미커밋 상태다.
