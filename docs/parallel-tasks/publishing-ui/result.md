# publishing-ui 독립 구현 결과

상태: `completed-local`

작업일: 2026-09-13 KST\
작업 위치: `/Users/kimchangheemac/dev/sellerpilot-app`

## 해결한 재현

1. recover 응답에 URL 6개가 있어도 `preflightAssetLineage`가 전부 `source-photo-catalog`이면 임시 초안으로 표시하고 완료로 올리지 않는다. 계보 누락은 unknown, 일부 URL/일부 composite 계보는 partial, 여섯 역할의 서로 다른 유효 composite digest와 URL이 모두 있을 때만 complete다.
2. 컴포넌트 전역 boolean을 job별 generation fence로 교체했다. 같은 job의 요청 중 중복 enqueue는 막고, 요청·인증 실패나 확인 시간초과 뒤에는 같은 job을 재시도할 수 있으며, 다음 job은 독립적으로 enqueue할 수 있다.
3. 요청과 polling에 AbortController를 연결하고 jobId·generation token을 응답 적용 직전까지 확인한다. job 변경·입력 초기화·unmount에서 요청, polling, timeout을 모두 정리하므로 이전 job의 늦은 응답이 현재 타일과 상태를 덮지 않는다.
4. 1차 역할별 이미지가 실제 완료되기 전에는 사람 검토 checkbox와 상세 제작 진입을 열지 않는다. 사람 검토 전 상세 제작을 자동 실행하던 effect와 상세 제작 결과를 1차 이미지에 merge하던 경로를 제거했다. 원본·상품정보·상세용 사진 변경 시 기존 사람 승인은 해제된다.
5. 여섯 역할 타일을 항상 같은 순서로 렌더하고 누락 역할에는 접근 가능한 생성 대기 상태를 표시한다. live status와 확인 개수, 실패·시간초과 재시도 버튼을 제공하며 원본 가공본을 동일 품질 생성 완료라고 안내하지 않는다.

## 중앙 검토 R1/R2 보완

- R1: effect setup마다 fence를 새 세대로 mount하고 cleanup에서는 unmount한다. 개발 StrictMode의 setup → cleanup → setup에서도 현재 작업은 활성화·enqueue되며, 첫 setup에서 시작된 늦은 응답은 세대 불일치로 무효화된다. StrictMode를 끄지 않았다.
- R2: access token 부재와 recover 401을 `authentication-required`로 분리했다. 현재 작업의 요청 잠금과 polling을 끝내고 `로그인 세션이 만료되었습니다. 다시 로그인한 뒤 같은 작업을 다시 확인해 주세요.`를 표시하며 retry를 연다.
- 재로그인 뒤 같은 job은 이미 enqueue가 접수됐는지 기억해 generation 요청을 다시 보내지 않고 recover polling만 재개한다. 최초 enqueue 전 인증 실패는 로그인 복원 뒤 정상적으로 한 번 접수할 수 있다.
- 실제 React 19 + happy-dom mount 테스트에서 일반 mount, StrictMode mount, 실제 unmount의 늦은 응답, 다음 job 전환, 최초 인증 실패, polling 중 세션 상실, recover 401, 재로그인, polling 제한 뒤 timer 종료를 검증했다. 의존성이나 lockfile은 변경하지 않았다.

## 변경 파일

- `app/_publishing/use-first-draft-images.ts`
- `app/_publishing/first-draft-image-review.tsx`
- `app/page.tsx`
- `tests/publishing-task/first-draft-image-hook.test.ts`
- `tests/publishing-task/first-draft-image-lifecycle.test.ts`
- `tests/publishing-task/image-review.test.ts`
- `tests/product-registration-mvp-flow.test.mjs`
- `docs/parallel-tasks/publishing-ui/status.md`
- `docs/parallel-tasks/publishing-ui/result.md`

## 검증

- `pnpm check:workspace`: 통과.
- 소유권 검사: 위 소스·테스트·결과 문서 모두 `publishing-ui`, allowed true.
- 집중 Node 검사: 29/29 통과.
  - 실제 React 19/happy-dom 일반 mount와 StrictMode mount 모두 요청 accepted, enqueue 1회.
  - polling 중 세션 부재와 recover 401에서 retry가 열리고, 재로그인 뒤 같은 job은 중복 enqueue 없이 polling 재개.
  - 실제 unmount 뒤 늦은 enqueue 응답, 이전 job의 늦은 recover 응답, 다음 job 격리, polling 제한 뒤 timer 종료.
  - 동일 job 중복, 실패 후 재시도, 첫 job에서 둘째 job 전환.
  - job 변경 직후 늦은 응답, reset, unmount fence.
  - 원본 가공 6장, 계보 누락, 일부 6장, 혼합 계보, 중복 digest, 실제 완료 6장.
  - 6개 역할/부분 빈 타일/접근성 status 렌더.
  - product-research lifecycle, provenance, 사진 계약, 사람 검토와 상세 제작 gate.
- `node scripts/parallel-workspace.mjs run publishing-ui next -- pnpm exec tsc --noEmit --incremental false`: 통과.
- 변경한 hook·검토 컴포넌트·테스트 대상 ESLint: 통과.
- `app/page.tsx` 단독 ESLint: 이번 diff 밖이며 현재 HEAD에도 존재하는 `CsPage`, `syncOrders` 미사용 오류 2개와 `publishBusy` dependency 경고 1개로 비통과. 이번 변경에서 새로 생긴 lint 항목은 확인되지 않았다.

## 아직 수행하지 않은 외부 적용

- Git stage/commit/push와 Vercel 배포를 하지 않았다.
- 운영 Mac 이미지 worker 설치·재시작이나 운영 job 조회를 하지 않았다.
- 실제 판매자 상품 CREATE, 외부 채널 조회, 구매자 화면 확인을 하지 않았다.
- 다른 소유 lane에서 진행 중인 이미지 생성 엔진·API·worker 변경은 수정하거나 완료 근거로 사용하지 않았다.
- 병행 소스 변경 중이므로 전체 Next build를 이 lane 완료 근거로 실행하지 않았다. 로컬 타입·집중 행동 검증까지만 완료 상태다.
