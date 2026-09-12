# 네 작업 완료 보고 통합 검토

2026-09-13 KST. 검토 위치: `/Users/kimchangheemac/dev/sellerpilot-app`.

## 판정

네 작업 모두 idle/completed 보고를 확인했다. 1번과 4번의 이전 지적사항 수정은 로컬 검토 범위에서 통과한다. 2번과 3번에는 추가 재현 문제가 있어 전체 완료 및 운영 적용 승인은 보류한다. 이번 중앙 작업은 검토와 격리 테스트이며 제품 소스 수정, 배포, DB 변경, provider 전송, 실행 중 worker 교체/재시작은 하지 않았다.

| 작업 | 판정 | 남은 경계 |
|---|---|---|
| 1 상품 등록 화면 | 로컬 검토 통과 | 실제 배포된 화면의 상품 생성 종단간 검증 미수행 |
| 2 이미지/상세/압축 | 추가 수정 필요 | 아래 F1/F2, Studio 확대 회귀 14건, 실제 상품 생성/Storage/RPC/상세 렌더 검증 |
| 3 CS/로컬 실행 | 추가 수정 및 운영 복구 필요 | 아래 F3, 현재 gateway degraded, DB/RPC 503 원인과 처리 중 작업 결과 미확인 |
| 4 채널 등록 | R3/R4 로컬 검토 통과 | 8채널 실제 등록/readback 미수행, 공유 회귀 실패 분류/정리 |

## 중앙 실행 결과

- 네 lane 집중 묶음: 85/85 pass, 0 skip. React hook, image quality/transport/compression, CS lock/completion/installer, credential identity PGlite 검사를 함께 실행했다. 로그 `/tmp/sellerpilot-four-task-focused.log`.
- `node scripts/parallel-workspace.mjs run channels-integration next -- pnpm build`: exit 0. Next webpack compile 및 TypeScript 검사와 정적 페이지 생성 완료. 로그 `/tmp/sellerpilot-four-task-build.log`.
- 확대 묶음: 184개 중 164 pass / 20 fail. 로그 `/tmp/sellerpilot-four-task-regression.log`.
- `git diff --check`: pass.
- gateway `/readyz` read-only 확인: ready false, degraded, activeGatewayJobs 1, scheduler false, Production release fd426cc588f03c1e187b689141018b6de4a38eca. 프로세스를 건드리지 않았다.

확대 묶음 파일:

```text
tests/server-product-studio.test.ts
tests/server-product-studio-concurrency.test.ts
tests/server-product-research.test.ts
tests/first-draft-images-db.test.mjs
tests/serverless-cs-gateway.test.ts
tests/product-remote-edit.test.ts
tests/publish-workbench-retry-safety.test.mjs
tests/cs-draft-api-flow.test.mjs
tests/cs-draft-queue-db.test.mjs
```

실패 분류: server-product-studio 14, serverless-cs-gateway 5, publish-workbench-retry-safety 1. 마지막 1건은 65_000/65000 소스 표기 검사다. Studio fixture는 이전 6장 재사용 계약에 의존하는 부분이 있어 실패 전부를 새 제품 결함 14개로 집계하지 않는다. 그러나 새 manifest/reuse 계약의 성공·실패 fixture를 정리하고 실제 완료 행동을 재검증하지 않은 상태이므로 단순히 비소유 테스트라고 제외하여 전체 완료로 승인할 수 없다. serverless 5건은 publication review RPC 기대 1건과 shipping mutation-boundary 상태 기대 4건이다.

## F1 — P1: 검수 manifest만으로 DB 완료를 추정한다

위치: `app/api/ai/worker/first-draft-images/route.ts:265-292`, manifest upload `:554`, record RPC `:570`.

worker state RPC가 null을 반환하면 manifest와 제출 digest/receipt만 비교하여 HTTP 200 `status: done, replayed: true`를 반환한다. 실제 SQL `sellerpilot_service_get_first_draft_image_request`는 generating + 현재 worker token 소유 행만 반환한다. null은 done 외에도 release/다른 worker 소유/행 부재를 의미한다. manifest는 DB record/adoption보다 먼저 업로드되므로 파일 존재가 DB commit 완료의 증거가 아니다.

재현: 실제 POST 소스를 TypeScript로 transpile하고 외부 Supabase client만 mock한 격리 harness `/tmp/sellerpilot-four-task-replay-review.mjs`. 유효한 manifest와 metadata를 제공하되 state RPC는 null, record/adoption RPC 호출은 0회로 구성했다. 결과는 HTTP 200, `{ok:true,status:"done",replayed:true}`였다. 원격 네트워크/DB는 호출하지 않았다.

수정 필요: authoritative DB readback에서 완료 상태와 동일 job/owner/claim/최종 채택 lineage를 확인해야 한다. 이를 현재 RPC로 확인할 수 없다면 200 done을 반환하지 않고 uncertainty/conflict로 보존해야 한다. 정상 완료 응답 유실 replay, manifest만 저장되고 DB 실패, release 후 다른 claim, job 부재를 실제 route+DB 행동으로 분리 검증할 것.

## F2 — P2: Vercel용 Sharp 압축이 일반 PNG에서 무효화된다

위치: `lib/image-lossless-png-optimizer.ts:130`, 보호 chunk 비교 `:98-104`.

`.keepMetadata()`로 후보를 인코딩하면 입력에 없던 metadata가 추가될 수 있다. 모든 비-IDAT chunk의 동일성을 요구하는 검증과 충돌하여 두 후보 모두 `protected PNG metadata differs`로 버려진다. OxiPNG 없는 Vercel의 실제 baseline은 이 경우 원본을 반환한다.

실제 encoder 재현: 1200×1500 RGB 단색 PNG compressionLevel0 입력 5,410,252 bytes. 현재 optimizePngWithSharp는 5,410,252 bytes / encoder original / 절감 0. 같은 입력을 metadata 추가 없이 PNG9로 인코딩하면 7,440 bytes이며 현재 verifyLosslessPngCandidate 자체도 픽셀·alpha·보호 chunk 동일로 통과했다. 이는 압축률 대표값이 아닌, 충분히 압축 가능한 입력도 현재 경로가 거절한다는 회귀 재현이다.

수정 필요: metadata 없는 PNG와 ICC/EXIF/gamma/provenance 있는 PNG에 맞춰 기존 chunk를 보존하는 인코딩 경로를 마련할 것. 메타데이터 검사를 끄거나 원본 품질을 낮추지 말 것. 압축 가능한 fixture에는 <= 대신 실제 감소 및 encoder 채택을 검증해야 한다. 현재 단위 테스트는 원본 반환도 통과한다.

## F3 — P2: CS completion 유실 후 raw 네트워크 오류가 replay를 중단한다

위치: `scripts/cs-draft-worker.mjs:46-52`, 실제 fetch wrapper `:106`.

completion 시작 이후 heartbeat 409/status0/5xx는 재시도를 허용하지만 실제 fetch rejection의 TypeError('fetch failed') 및 timeout은 status가 없다. main RPC wrapper가 이를 status0으로 정규화하지 않으므로 lease.abort가 발생한다. HTTP 오류 mock만 사용하는 현재 검사는 이 경계를 놓친다.

실제 exported runCsDraftJob 재현: 생성 1회 → completion이 저장된 것으로 모사 후 HTTP503 → 다음 heartbeat에서 status 없는 TypeError → 두 번째 completion replay 전에 fetch failed로 종료. 관측 generation1, completion1, heartbeat2. 원격 CS 전송은 하지 않았다.

수정 필요: caller 취소/전체 작업 종료와 일시 network/개별 요청 timeout을 구분하고, 이미 전송한 완료 payload는 동일 endpoint에서 재확인할 것. completion 전 실제 lease conflict와 다른 claim은 계속 차단해야 한다. status 없는 네트워크 오류/timeout을 포함하는 행동 검사가 필요하다.

## 운영 적용 전 남은 사항

2번 F1/F2와 3번 F3를 수정하고 확대 회귀를 정리한 뒤 재검토한다. 3번은 마지막 기록의 광범위한 503을 DB/RPC 원인까지 확인하고 처리 중 gateway 작업의 결과를 읽어야 한다. 운영 상태가 미확인인 채 worker를 교체해서는 안 된다. 이후 통합 배포 및 실제 상품 원본 6장 → 상세 제작 → 채널 등록, CS 수집/저장 흐름은 별도 운영 검증이 필요하다.
