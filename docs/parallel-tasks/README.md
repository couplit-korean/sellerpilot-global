# 네 채팅 동시 작업 기준

2026-09-13. 같은 `/Users/kimchangheemac/dev/sellerpilot-app`에서 작업한다. 이 문서는 네 작업의 준비이며 새 채팅·clone·worktree를 생성하지 않는다. 기존 채널별 worktree 지침보다 이 작업 분담을 우선한다.

## 판정

상품·CS·배송의 금지된 모듈 참조는 0개지만, 공용 화면·실행기·DB·Git·빌드가 남아 있어서 무제한 동시 수정은 안전하지 않다. 이번 준비에서 1차 이미지의 브라우저 상태/요청과 표시를 `app/page.tsx`에서 별도 hook·컴포넌트로 분리했다. 기존 API/생성 동작은 유지했다. 이전 검토의 완료 오표시·다음 상품 요청 누락·품질 차이는 각 작업에서 해결할 미완료 사항이다.

서버 이미지 품질 코드와 브라우저 진행 상태를 별도 파일에서 수정할 수 있다. CS·상품·배송의 실행/완료 모듈 분리는 유지한다. 공용 연결부는 한 소유자에게 배정하고 Git·Next 출력·배포·DB·설치된 작업자 제어에는 잠금을 제공한다. 잠금은 지침을 따르는 명령 사이의 중복 실행 방지이며, 앱이나 OS가 임의 명령을 금지하는 보안 장치는 아니다.

## 채팅별 소유 범위

| 번호 / lane | 직접 고칠 곳 | 다른 담당에게 요청할 곳 |
| --- | --- | --- |
| 1 `publishing-ui` | `app/page.tsx`, `app/_publishing/*`: 상품 입력, 생성 요청, polling, 완료 표시, 다음 상품 상태 초기화, 1차 이미지 표시 | 생성·품질 검사와 API는 2번. 상품 채널 실행은 4번. 전역 CSS·공용 schema는 4번 |
| 2 `image-detail` | 이미지/상세 생성과 해당 API, `scripts/product-ai-worker.mjs`, `scripts/first-draft-image-lane.mjs`, `lib/ai-image*`, `lib/first-draft*`, `lib/server-product*`, `prompts/*`, 상세 제작 UI | 브라우저 1차 상태/타일은 1번. 설치된 AI 작업자 교체·재시작은 3번. 공용 schema·DB 적용은 4번 |
| 3 `cs-runtime` | `lib/cs/*`, `lib/channels/cs/*`, 문의·답변 정규화, CS 화면/API/초안 작업자, gateway/launchd 설치·상태·중복 supervisor | 상품 provider/공용 프로토콜·serverless 조립부는 4번. AI 생성 엔진은 2번. DB 변경·운영 배포는 4번 |
| 4 `channels-integration` | 상품 등록 provider/승인/공식 조회, 공용 gateway·protocols·contracts, DB migration, 전역 CSS, package/lockfile, Vercel 배포, 최종 검사·커밋 | 상품 화면은 1번, 이미지 품질은 2번, CS/설치 작업자 제어는 3번 |

정확한 파일 판정은 `ownership.json`을 사용한다. 명시되지 않은 파일은 4번 소유이며, 임의로 자신의 파일로 간주하지 않는다. 예: `lib/ai-cli-contract.ts`, `lib/channels/protocols.ts`, `lib/channels/serverless-gateway.ts`, `app/api/channel-gateway/worker/*`, `supabase/migrations/*`, `app/globals.css`, `package.json`, lockfile은 4번이다. 파일 소유는 기능 지원/운영 쓰기 승인과 별개다.

```sh
node scripts/parallel-workspace.mjs check publishing-ui app/_publishing/use-first-draft-images.ts
node scripts/parallel-workspace.mjs check image-detail scripts/first-draft-image-lane.mjs
node scripts/parallel-workspace.mjs check cs-runtime lib/cs/operations/provider.ts
```

각 작업은 자신의 `status.md`에 `진행 상태 / 수정 파일 / 검사 결과 / 공용 변경 요청 / 미확인 외부 결과`를 기록한다. 타 담당에게 요청할 때 파일·필요한 입출력·호환 조건을 적으며, 상대가 변경하는 파일을 직접 수정하지 않는다. 이 문서 작성 시 네 작업은 모두 시작 전이다.

## 공유 계약과 데이터

- 기존 asset ID 6개, jobId/claimToken, 원본 hash, 연구 결과 lineage, channel/operation 구분, API 경로·RPC·DB 완료 계약을 임의 변경하지 않는다. 추가 품질 증거가 필요하면 2번이 계약안을 쓰고 1번 소비 코드와 4번 schema/DB를 함께 검토한다. 새 상태가 없을 때 검수 완료로 간주하지 않는다.
- 1번은 브라우저의 생성 요청/표시 상태를 담당한다. 2번은 실제 자산의 생성·검수·저장을 담당한다. 반환된 결과의 품질 검증을 브라우저의 boolean으로 대신하지 않는다.
- 3번은 CS 큐·답변 원장을 담당한다. 4번은 상품 등록 원장을 담당한다. 공유 계정·인증·속도 제한·gateway 큐의 조건은 4번과 합의해 수정한다. 서로 다른 operation의 완료 함수를 대신 호출하지 않는다.
- SQL은 1~3번이 자기 문서에 변경 요청을 작성하고 4번이 기존 migration 번호/원문을 확인해 생성·검사·적용한다. 같은 운영 DB를 여러 채팅에서 동시에 수정하지 않는다.
- 테스트용 상품/문의/job을 지정하지 않은 상태에서 실제 등록·답변 전송을 하지 않는다. 승인된 외부 작업도 같은 상품·주문·문의에 두 채팅이 동시에 쓰지 않도록 4번의 대상 원장으로 조정한다.

## 동시 개발과 직렬 실행

| 자원 | 실행 담당 / 제약 |
| --- | --- |
| 소유 파일 수정, 해당 순수 단위 테스트 | 네 작업이 동시에 가능 |
| `.next`, Next dev/build/타입 생성 | 모든 작업이 같은 `next` 잠금을 사용. 포트를 나눠도 출력 폴더는 공유됨 |
| Git index/commit/push/branch | 4번만 `git` 잠금 안에서 처리. 1~3번은 소유 파일 수정과 개별 보고만 수행 |
| Vercel 배포·환경변수 변경 | 4번만 `deployment` 잠금. 네 작업 검사 완료·수정 중지 후 통합 빌드/배포 |
| 운영 DB migration/설정 변경 | 4번만 `database` 잠금. 운영 적용 증거는 별도 확인 |
| Mac 설치본 교체·launchd·재시작 | 3번만 `runtime` 잠금. 2번의 소스 검증 및 4번의 운영 SHA와 조율 |

```sh
# Node 22가 PATH에 있는 환경. COMMAND를 실행하는 동안 잠금을 유지한다.
node scripts/parallel-workspace.mjs run publishing-ui next -- pnpm dev
node scripts/parallel-workspace.mjs run channels-integration next -- pnpm build:vercel
node scripts/parallel-workspace.mjs run channels-integration git -- git status --short
```

다른 명령이 이미 같은 자원을 점유하면 즉시 거부한다. 거부됐다고 다른 포트·복제 폴더·직접 명령으로 우회하지 않는다. 잠금 파일은 `.local/parallel-locks/`에 있으며 Git에서 제외된다. 비정상 종료 후 남은 잠금은 소유 PID뿐 아니라 자식 프로세스·실행 중 작업을 확인한 뒤 담당자가 제거한다. 같은 실행 명령을 중첩해 동일 잠금을 두 번 잡지 않는다.

`pnpm test`는 현재 내부에서 build를 수행하므로 병행 단위 테스트에 사용하지 않는다. `node --import tsx --test 정확한-테스트-파일`처럼 범위를 지정한다. 타입 검사는 `--incremental false`를 사용하고 최종 build와 동시에 실행하지 않는다. `git add .`, 전체 파일 포매팅, stash/reset/브랜치 전환, worktree/clone 생성은 네 작업의 해결 방법으로 쓰지 않는다.

## 최종 통합 순서

1. 1~3번이 자기 상태 문서에 변경 파일·검사·남은 계약 요청을 기록한다. 4번은 그동안 채널 코드/승인/연결을 검토하고 자신의 소유 파일을 수정할 수 있다.
2. 4번이 교차 API/DB 계약을 통합하고 네 작업을 수정 중지 상태로 맞춘다. 파일을 수정하는 중의 build는 최종 검증 근거가 아니다.
3. 4번이 소유 파일별 diff를 검토하고 공유 자원 잠금으로 타입·도메인·관련 회귀·Next build를 검증한다. 서로 다른 작업의 변경을 성공으로 임의 표시하지 않는다.
4. 현재 운영 작업과 DB 상태 확인 후 검증한 버전을 배포한다. 3번이 승인된 운영 버전에 맞춰 Mac 실행본을 전환한다.
5. 상품 등록은 공식 상품 조회까지, CS는 수집/답변/상대 채널 확인까지 각각 증거를 남긴다. 결과가 미확인이면 해당 채널을 완료로 표시하지 않는다.

이 구조에서 **개발은 네 채팅 동시 진행 가능하고, 공유 자원 변경과 최종 배포는 순차 진행**한다. 별도 채팅을 실제로 생성하거나 네 작업 자체의 결함을 모두 해결한 상태는 아니다.

## 준비 작업 검증

- 관련 81개 검사 모두 통과: 새 파일 소유권/자원 잠금 검사, 추출한 이미지 표시 렌더링, 기존 1차 이미지·계획·연구 상태·상품/CS/배송 분리 검사 포함.
- `tsc --noEmit --incremental false` 통과. `next` 잠금 안에서 `pnpm build:vercel` 통과.
- 상품↔CS↔배송 6방향 금지 참조 모두 0개 유지.
- 서로 다른 두 작업의 동시 Next 잠금 획득은 하나만 성공하며, 자식 명령 실패 코드가 전달되고 종료 후 잠금이 해제되는 것을 검사했다.
- 실제 네 Codex 채팅을 동시에 실행하는 실험, 운영 배포, DB 변경, 실제 상품 등록/답변은 수행하지 않았다. 모든 명령이 협업 규칙을 따르는 조건의 준비 결과다.
- 증거: `outputs/workspace-unification/parallel-prep-tests.log`, `parallel-prep-types.log`, `parallel-prep-build.log`.
