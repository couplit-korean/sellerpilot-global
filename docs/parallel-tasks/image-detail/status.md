# 2번 · 이미지·상세페이지 품질 통합

상태: `completed-local` (2026-09-13 KST)

중앙 후속 검토 I1~I4와 추가 무손실 압축 요구까지 로컬 소유 범위에서 구현했다.

- I1: 6장 Base64 JSON 제출을 제거했다. 6장 전체 생성·검수 barrier 뒤 각 PNG는 claim-scoped Supabase signed upload로 직접 전송하고, Vercel 함수에는 256 KiB 미만의 1장 metadata만 보낸다. HTTP 413은 확실한 미접수로 release하며, network/5xx 응답 유실은 동일 metadata를 한 번 재시도한 뒤 원격 상태를 보존한다. active-claim RPC의 null은 완료가 아니라 release/다른 소유자/행 부재도 뜻하므로 sidecar만 보고 `done`으로 승격하지 않고 `FIRST_DRAFT_COMPLETION_UNCERTAIN`으로 보존한다.
- I2: 동일 claim/역할/경로/digest/bytes/규격/receipt인 replay만 멱등 인정한다. 같은 역할의 다른 bytes는 409, 다른 역할의 exact/dHash 중복은 거절한다. 실제 Storage bytes를 다시 내려받아 SHA-256/dHash를 재계산한 뒤 RPC에 기록한다.
- I3: manifest 없는 legacy 결과는 같은 완료 job의 재큐잉을 안내하지 않는다. 공개 API는 새 `/api/ai/product-research` job 진입점을 명시하고, 이미 큐에 남은 legacy Studio job은 1차 6장을 재사용하지 않고 전량 재생성한다.
- I4: claim route가 검증 facts/manifest/source SHA와 6개 signed URL을 Mac final worker에 전달한다. 공개 API, claim producer, Mac consumer, server Studio 모두 현재 판매자 facts와 최종 master의 역할별 장면 계획을 확인하며 불일치 시 1차 이미지를 재사용하지 않는다.
- 압축: 서버는 metadata를 새로 만드는 `.keepMetadata()`를 제거하고, Sharp PNG9가 만든 IDAT만 원본 PNG의 나머지 chunk 위치에 이식한다. 따라서 ICC/EXIF/gamma/text/provenance를 원본 바이트 그대로 유지하면서 실제 감소 후보를 선택한다. APNG와 16-bit는 원본 보존, pixel ceiling 초과는 fail-closed다. Mac은 그 기준 위에 OxiPNG 10.2.1 max+Zopfli를 1-thread/1-concurrency/30초/80MB raw 상한으로 실행한다. `caBX`/`iDOT` provenance는 native 압축을 생략하고 재사용 자산은 재압축하지 않는다.

중앙 재현 `/tmp/sellerpilot-four-task-replay-review.mjs`는 수정 전 HTTP 200 `done/replayed`를 재현했고, 수정 후 HTTP 409 `completion-uncertain`, manifest download 0회로 바뀌었다. canonical workspace gate, TypeScript, 변경 파일 ESLint, ownership, diff check와 공유 잠금 안의 Next production build가 통과했다. 이미지/전송/재사용/압축/PGlite 집중 테스트 36/36, PGlite RPC 단독 4/4, `server-product-studio.test.ts` + concurrency 57/57가 통과했다. 중앙 확대 묶음의 다른 CS/publish 실패는 이 작업 범위 밖이며 전체 성공 근거로 사용하지 않았다.

외부 상태: Vercel 배포, DB schema/migration, 설치된 Mac worker 교체·재시작, 실제 모델 이미지 생성, 원격 Storage/RPC readback, 최종 buyer-visible 렌더링은 수행하지 않았다. OxiPNG 바이너리만 버전 고정 도구 경로에 설치했으며 실행 중 worker는 건드리지 않았다. 상세 증거는 `result.md`를 따른다.
