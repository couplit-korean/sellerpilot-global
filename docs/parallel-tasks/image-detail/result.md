# 2번 결과 · 이미지·상세페이지 품질 통합

## 판정

`completed-local`

1차 6장과 최종 Studio의 생성·검수·재사용 계약, 중앙 후속 검토 I1~I4, 무손실 PNG 압축을 로컬 소스에서 연결했다. 배포·worker 재시작·실제 이미지 모델·원격 readback은 수행하지 않았으므로 운영 완료나 buyer-visible 완료가 아니다.

## I1 · 4.5MB 함수 payload 경계

- 공식 Vercel Functions 문서가 명시하는 request/response 최대 4.5MB 및 초과 시 `413 FUNCTION_PAYLOAD_TOO_LARGE`를 기준으로 삼았다: https://vercel.com/docs/functions/limitations#request-body-size
- 6장 전체를 Base64 JSON 한 번에 보내던 경로를 제거했다.
- Mac은 6장 생성·검수와 sibling 정리 barrier를 먼저 끝낸다. 이후 각 자산에 대해 서버에서 canonical path 전용 signed upload token을 받고 Supabase Storage로 PNG bytes를 직접 보낸다.
- Vercel worker route에는 자산 한 장의 `id/path/digest/bytes/width/height/verification` metadata만 보낸다. worker 자체 상한은 256 KiB다.
- metadata의 HTTP 4xx/413은 확실한 거절로 처리하여 한 번 release한다. network/5xx는 byte-identical metadata를 최대 한 번 재시도하고, 그래도 응답이 없으면 `completion-uncertain`으로 원격 상태를 보존한다.
- 최종 응답 유실 뒤 active-claim state가 null이면 route는 sidecar manifest를 DB commit 증거로 사용하지 않는다. 현재 RPC의 null은 완료, release, 다른 worker 소유, 행 부재를 구분하지 못하므로 HTTP 409 `FIRST_DRAFT_COMPLETION_UNCERTAIN`을 반환한다. Mac lane은 이 코드를 확실한 거절로 release하지 않고 원격 상태를 보존한다.
- 이미지 압축은 파일 크기를 줄일 뿐 4.5MB 해결책으로 간주하지 않는다. 함수 payload 문제는 signed-storage 구조로 해결했다.

## I2 · 부분 저장과 동일 역할 replay

- `isExactFirstDraftImageReplay`는 role, canonical path, SHA-256, byte length, width, height, 전체 quality receipt가 모두 동일할 때만 replay를 인정한다.
- 이미 기록된 같은 역할에 다른 bytes/digest/receipt를 덮어쓰려 하면 409다.
- 중복 검사 시 현재 제출 역할 자신의 이전 fingerprint는 비교 대상에서 제외하지만, 다른 역할의 SHA-256 exact duplicate와 dHash 유사 중복은 계속 거절한다.
- signed upload 후 metadata 확정 단계에서 Storage 객체를 다시 다운로드하고 실제 크기·PNG 규격·SHA-256·256-bit dHash를 재계산한다. worker가 보낸 digest만 신뢰하지 않는다.
- 완료된 일부 역할은 signed readback evidence로 다시 내려받아 검증하고, 생성기는 미완료 역할만 생성한다.

## I3 · manifest 없는 legacy 복구

- 공개 product-studio API의 `FIRST_DRAFT_QUALITY_REQUIRED` 응답은 같은 완료 research job의 재큐잉을 더 이상 안내하지 않는다.
- 복구 계약은 `mode: new-product-research-job`, `endpoint: /api/ai/product-research`, `reuseSourceResearchJob: false`로 현재 원본·판매자 사실을 사용한 새 1차 job을 명시한다.
- 이미 큐에 남은 legacy server Studio 요청에서 facts와 quality manifest가 모두 없으면 restore는 빈 Map을 반환하여 검증되지 않은 6장을 재사용하지 않고 16장 생성 경로로 간다.
- 가짜 manifest 생성, auditMode 강등, 기존 완료 RPC 우회, DB migration은 사용하지 않았다.

## I4 · Mac producer와 사실·장면 결속

- product-studio API가 저장된 first-draft product facts와 sidecar manifest를 읽고 검증한 뒤 `reuse_first_draft_assets`를 job request에 기록한다.
- claim route는 저장 manifest를 다시 download/readback하고 request와 byte-identical JSON인지 확인한다. 이후 6개 canonical Storage path에 60분 signed URL을 발급하여 다음 camelCase 필드를 Mac worker에 보낸다.
  - `firstDraftSourceResearchJobId`
  - `firstDraftProductFacts`
  - `firstDraftQualityManifest`
  - `firstDraftSourcePhotoSha256`
  - `reusableFirstDraftAssets`
- Mac consumer는 source research job UUID, manifest, source SHA, 현재 manual fields, 최종 master facts, 여섯 역할의 장면 계획을 검증한다. 각 PNG를 내려받아 규격/digest/dHash/상호 중복도 다시 확인한다.
- server Studio도 restore 후 최종 master facts 또는 장면 계획이 달라지면 restored Map을 비우고 전체 이미지를 재생성한다.
- 재사용이 확정된 6장은 fingerprint/background history에 seed하고 나머지 10장만 생성한다. 재사용 bytes는 다시 압축하거나 덮어쓰지 않는다.

## 공통 이미지 품질

- 1차 6장은 최종 Studio의 `generateDistinctAsset`, source-composite identity cutout, source-pixel/label gate, 장면 semantic audit, SHA-256 + 256-bit dHash 중복 차단, 3장 deterministic batch barrier, 역할당 최대 4회 시도를 사용한다.
- receipt는 source SHA, canonical product facts SHA, 역할별 scene plan SHA, source foreground SHA, 최종 압축 bytes SHA/dHash, source-composite/source-pixel/scene/duplicate 검증 boolean에 결속된다.
- 건강기능식품 여부는 1차 근거만으로 확정하지 않고 `isHealthFunctionalFood: null`, `verificationStatus: needs-review`를 유지한다.

## 오픈소스 최대 무손실 압축

### 구현

- portable baseline: 기존 `sharp 0.35.4`/`libvips 8.18.6`로 `compressionLevel: 9`, `palette: false`, adaptive filtering on/off 두 후보를 순차 생성한다. 후보의 IDAT chunk만 원본 PNG에 이식하여 입력에 없던 metadata를 생성하지 않고 모든 원본 비-IDAT chunk를 그대로 보존한다.
- Mac stronger pass: MIT 라이선스 OxiPNG v10.2.1을 `-o max --fast --zopfli --zi 8 --ziwi 2 --nx --threads 1 --timeout 30 --max-raw-size 80MB`로 실행한다. `--alpha`와 `--strip`은 쓰지 않는다.
- 검증: 원본과 후보를 raw decode하여 width/height/channels/depth/모든 픽셀/알파를 byte-for-byte 비교한다. IDAT 외 IHDR, ICC, gamma, EXIF, text, `caBX` C2PA provenance를 포함한 모든 PNG chunk payload도 순서대로 동일해야 한다. APNG는 flatten하지 않고 원본을 유지하며 16-bit도 downsample하지 않고 원본을 유지한다. pixel ceiling 초과 입력은 원본 fallback이 아니라 오류로 막는다.
- 더 크거나, timeout/error/missing binary, 픽셀 불일치, metadata/provenance 불일치이면 Sharp 또는 원본으로 fail-safe fallback한다.
- Mac 압축 전체는 concurrency 1이며 고유 `mkdtemp` 디렉터리와 shell 없는 argv spawn을 사용하고 항상 정리한다. 서버는 native binary에 의존하지 않는다.
- 위치: 최종 source composite 및 audit 이후, output SHA/dHash/receipt/manifest/upload 이전이다. verified reuse 자산은 이 함수를 거치지 않는다.

### 설치 증거

- 바이너리: `/Users/kimchangheemac/Library/Application Support/SellerPilot/tools/oxipng/v10.2.1/oxipng`
- 아키텍처/버전: Mach-O arm64, `oxipng 10.2.1`
- 공식 release archive SHA-256: `7039fcfc78e8aa1ed2b57d848057a0296f082e92b3e1807ac65402d10d926764`
- 설치 binary SHA-256: `275a2049091caf576be74b838df4675fbb179c9f2d118cec44ea1521e54fc45e`
- 공식 release: https://github.com/oxipng/oxipng/releases/tag/v10.2.1
- MIT license: https://github.com/oxipng/oxipng/blob/master/LICENSE
- 실행 중인 Mac worker는 교체하거나 재시작하지 않았다.

### 실제 자산 benchmark

동일 host에서 입력 bytes 기준으로 측정했다. `caBX`가 있는 AI demo는 출처 증명 보존이 용량 절감보다 우선이므로 원본을 유지했다. 이전의 단순 Sharp 재인코딩 4.54~5.92% 절감치는 `caBX`를 `eXIf/pHYs`로 바꾸므로 무손실 provenance 조건을 통과하지 못해 채택하지 않는다.

| 자산 | 입력 bytes | 최종 bytes | 절감 | 실행 결과 | 시간 |
|---|---:|---:|---:|---|---:|
| `premium-studio.png` | 1,564,069 | 1,564,069 | 0.00% | `protected-provenance` | 1.07s |
| `ingredient-flatlay.png` | 2,123,516 | 2,123,516 | 0.00% | `protected-provenance` | 0.50s |
| `daily-carry.png` | 1,770,521 | 1,770,521 | 0.00% | `protected-provenance` | 0.91s |
| `og-commerce.png` | 831,455 | 638,385 | 23.22% | `oxipng-max-zopfli` | 27.52s |
| `og-style-learning.png` | 911,732 | 691,299 | 24.18% | `oxipng-max-zopfli` | 25.31s |
| `icon-512.png` | 11,524 | 6,126 | 46.84% | `oxipng-max-zopfli` | 2.74s |

## 변경 파일

- `app/api/ai/product-studio/route.ts`
- `app/api/ai/worker/claim/route.ts`
- `app/api/ai/worker/first-draft-images/route.ts`
- `lib/first-draft-images.ts`
- `lib/image-asset-quality.ts`
- `lib/image-lossless-png-optimizer.ts` (신규)
- `lib/server-product-studio.ts`
- `scripts/first-draft-image-lane.mjs`
- `scripts/product-ai-worker.oxipng-lossless.mjs` (신규)
- `scripts/product-ai-worker.mjs`
- `tests/first-draft-images.test.ts`
- `tests/first-draft-images-db.test.mjs`
- `tests/image-task/first-draft-quality.test.ts`
- `tests/image-task/lossless-png-optimizer.test.ts` (신규)
- `tests/image-task/product-studio-first-draft-quality.test.ts`
- `tests/server-product-studio.test.ts`
- `docs/parallel-tasks/image-detail/status.md`
- `docs/parallel-tasks/image-detail/result.md`

## 검증

- canonical workspace: `node scripts/check-local-workspace.mjs` 통과
- syntax: `node --check` on `product-ai-worker.mjs`, `first-draft-image-lane.mjs`, `product-ai-worker.oxipng-lossless.mjs` 통과
- types: `tsc --noEmit --incremental false` 통과
- lint: 위 변경 소스·테스트 13개 대상 ESLint 통과
- build: `parallel-workspace.mjs run image-detail next -- pnpm build` 통과
- 집중 이미지/전송/재사용/압축/PGlite 테스트: 36/36 통과
- PGlite 실제 first-draft enqueue/claim/partial record/final adoption/retry 및 active-read null 상태 분리: 4/4 통과
- server Studio + concurrency: 57/57 통과. 새 manifest/receipt가 있는 6장 재사용 fixture와 legacy 무-manifest 16장 재생성 fixture를 분리했고, OCR/중복/34-market/localization/429 sibling/Storage/final-16 기대를 유지했다.
- 중앙 F1 route 재현: 수정 전 HTTP 200 `done/replayed`, 수정 후 HTTP 409 `completion-uncertain`; record/adoption RPC 0회와 manifest download 0회를 확인했다.
- 실제 encoder 테스트는 1200x1500 metadata-free 회귀 입력 5,410,252 → 7,426 bytes의 실제 Sharp encoder 선택, 투명 픽셀의 숨은 RGB+alpha, ICC/EXIF/provenance chunk 보존, APNG/16-bit 원본 보존, pixel ceiling, 이미 최적화된 입력, OxiPNG max+Zopfli, native binary missing fallback을 포함한다.
- 중앙 확대 묶음의 다른 CS/publish 실패는 비소유 범위이며 이 작업의 성공으로 세지 않았다.

## 남은 정확한 외부 경계

- Vercel 배포와 route의 실제 4.5MB 환경 확인을 수행하지 않았다.
- 설치된 Mac worker 소스를 교체하거나 재시작하지 않았다. 따라서 현재 실행 중 프로세스가 새 signed-storage/압축 코드를 사용한다고 주장하지 않는다.
- 실제 상품 원본으로 6장 모델 생성, signed Storage upload, route download 재검증, RPC done, final 10장 생성, 상세 레이아웃 및 buyer-visible 렌더링을 실행하지 않았다.
- Supabase DB schema/migration/RLS는 변경하지 않았다.

## 비변경 확인

- Git add/commit/push/branch/merge 없음
- Vercel deploy/env 변경 없음
- Mac worker 설치본 교체/재시작 없음
- Supabase DB schema/migration/RLS 변경 없음
- 실제 marketplace 등록·고객 답변·발송 mutation 없음
