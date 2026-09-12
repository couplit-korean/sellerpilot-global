# 네 작업 후속 수정 재검토

2026-09-13 KST. Canonical source `/Users/kimchangheemac/dev/sellerpilot-app`.

## 판정

1·4번의 앞선 로컬 검토 판정을 유지한다. 2번 F1/F2와 3번 F3 후속 수정은 중앙 재현 검사에서도 통과했다. 네 작업에 나누어 맡긴 후속 코드 수정은 로컬 검토 기준 완료로 볼 수 있지만, 공통 회귀 6건과 운영 저장 장애/미배포 상태 때문에 전체 운영 완료는 아니다.

## 중앙 실행 증거

- 네 lane 및 확대 회귀를 하나의 묶음으로 재실행: 286개, 280 pass, 6 fail, 0 skip. `/tmp/sellerpilot-four-task-recheck.log`.
- 공유 next 잠금으로 `pnpm build` 재실행: exit 0, webpack compile/TypeScript/static pages 통과. `/tmp/sellerpilot-four-task-recheck-build.log`.
- `git diff --check` 통과.
- 제품 코드/운영 DB/provider/배포/runtime는 이번 중앙 검토에서 변경하지 않았다.

### F1: 불명확한 DB 상태의 가짜 완료 제거

기존 실제 POST transpile harness `/tmp/sellerpilot-four-task-replay-review.mjs`를 수정 없이 다시 실행했다. state RPC null, 유효 sidecar 존재, record/adoption RPC 0회 조건에서 이전 HTTP200 done 대신 HTTP409 `FIRST_DRAFT_COMPLETION_UNCERTAIN`을 반환했다. manifest download도 0회다.

Mac metadata 전송기는 이 code/status를 completionUncertain으로 처리하여 failed/release 경로를 피한다. 현재 RPC는 완료/다른 worker/released/미존재를 구별할 수 없으므로 완료를 추정하지 않는 제한은 의도된 안전 경계다. authoritative 완료 readback이 추가 구현됐다는 뜻은 아니다.

### F2: portable Sharp 실제 압축

1200×1500 RGB `#abcdef`, PNG compressionLevel0 fixture를 중앙에서 다시 생성했다. optimizePngWithSharp 결과는 5,410,252 → 7,426 bytes, encoder `sharp-png9-adaptive`였다. verifyLosslessPngCandidate에서 픽셀/alpha/치수/보호 chunk 동일 검증을 통과했다. 이는 압축 가능한 입력의 동작 회귀 검증이며 실제 상품들의 일반 압축률이 아니다.

새 코드는 Sharp의 IDAT만 기존 PNG chunk 구조에 이식하며 나머지 chunk payload를 보존한다. APNG/16-bit 지원 밖 입력은 원본 유지한다. 테스트의 실제 감소 assertion과 Studio의 manifest/receipt fixture 변경을 확인했고 Studio 관련 앞선 14개 실패는 이번 통합 실행에서 사라졌다.

### F3: 실제 fetch 및 응답 본문 timeout

상태 없는 fetch 오류/개별 request timeout 정규화 및 caller abort/overall deadline 분리와 기존 completion replay 테스트가 통과했다.

추가로 `/tmp/sellerpilot-cs-body-timeout-review.mjs`에서 localhost HTTP 서버와 실제 Node fetch/createCsDraftRpc/runCsDraftJob을 사용했다. 첫 completion은 HTTP200 헤더와 불완전 JSON 본문만 보내고 200ms request timeout을 유도했다. 결과는 두 번째 동일 completion에서 replayed, generation1/completion2/heartbeat2였다. 실제 고객 데이터/외부 답변/provider 호출은 없었다.

## 남은 공통 회귀 6건

1. `tests/publish-workbench-retry-safety.test.mjs`: 65_000/65000 문자열 표기 검사 1건.
2. `tests/serverless-cs-gateway.test.ts`: publication review RPC 호출/진단 기대 1건.
3. 같은 파일: 배송 설정 오류 4종에서 mutation 시작 후 reconciliation_required 기대와 실제 failed의 불일치 4건.

실패명:

```text
workbench advances retry generations but keeps queued and external-action listings fenced
a missing publication review RPC is reported even while other reads continue
shipping setup LISTING_SHIPPING_CONFIRMATION_REQUIRED keeps remediation and mutation boundary true
shipping setup COUPANG_SHIPPING_FEE_CONFIRMATION_REQUIRED keeps remediation and mutation boundary true
shipping setup SMARTSTORE_SHIPPING_POLICY_CONFIRMATION_REQUIRED keeps remediation and mutation boundary true
shipping setup QOO10_UPDATE_SHIPPING_UNVERIFIED keeps remediation and mutation boundary true
```

6건은 이번 2·3번 후속에 편집을 허용하지 않은 공통 파일이다. 실패 6건을 곧바로 제품 오류 6개로 집계하지 않지만, 테스트가 오래된 것인지 실제 실행 정책과 어긋난 것인지 근거를 남겨 정리해야 전체 회귀 통과로 판정할 수 있다.

## 운영 상태

중앙의 현재 `/readyz` 읽기 결과는 ready:true, activeGatewayJobs:1, scheduler:false/periodicChannelSync:false이며 runtime release는 fd426cc588f03c1e187b689141018b6de4a38eca다. ready는 원장 저장/상품 등록/CS 완료의 증거가 아니다.

3번 최신 보고의 02:42 KST 로그 표본은 draft 2/2 HTTP503, gateway completion 50건 중49건 HTTP503이다. 이 로그 표본은 3번 보고에서 확인한 근거이며 중앙에서 같은 운영 로그를 새로 조회한 수치는 아니다. 정확한 DB/RPC 원인과 현재 처리 중 작업 결과는 미확인이다. 신규 진단 로그는 소스에만 있고 운영 배포 전이다.

다음 완료 경계는 공통 회귀 6건 정리, 운영503 원인/저장 readback, 검토된 소스의 통합 배포와 안전한 runtime 적용, 실제 상품/이미지/CS 종단간 검증이다. 현재는 네 작업의 로컬 후속 수정 완료와 전체 운영 완료를 구분해야 한다.
