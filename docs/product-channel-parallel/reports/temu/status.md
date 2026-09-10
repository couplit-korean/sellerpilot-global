# Temu 상품등록 상태 — r24 local collector HTTP/observation 연결

- worktree: `/Users/kimchangheemac/dev/sellerpilot-product-temu-local-20260910`
- branch: `codex/product-temu-r24-local-20260910`
- 기준 HEAD: `0fb40d4`
- 갱신 시각: `2026-09-10T17:35:26+09:00`
- 원장: 2/6 유지. 실등록 0/8 유지. r23 재제출 없음. 칸 5·6 미변경.

## 확인 완료

- 공용 `app/api/admin/channel-operations/route.ts`를 현재 파일에 재기반해 연결.
  낡은 patch context(기존 `bindTemuCreateAuthoritativeSourceBeforeClaim` 가정)는 맞지 않아 손으로 맞춤.
  클라이언트 `sellerpilotTemuAuthoritativeSource`/`FinalPayload`/`ReviewAndCreatePrewrite` 제거,
  identity 직후 `normalizeTemuCreateBodyFromServerContext`,
  fingerprint 이후·claim 이전 `produceTemuCreateAuthoritativeSourceBeforeClaim`,
  이미지 준비 이후·enqueue 이전 `bindTemuFinalCreatePayloadBeforeEnqueue`.
- `app/api/admin/temu/operator-app-observation/route.ts`를 앱 트리에 설치.
  GET challenge 발급, POST는 `verifyTemuCollectorAttestation` → verifier receipt → consume v2 순서.
  consume v2는 verified receipt exact match가 필요하고 route HMAC만으로 임의 64바이트 서명을 persist하지 않음.
- 로컬 collector HTTP 진입점 가동: 핸들러 import 후 무세션 GET/POST 모두 401 `ADMIN_SESSION_INVALID`.
  Next 실서버·CHANGHEE 실기기 서명·Keychain init 미실행.
- package.json / `scripts/` 패치는 적용하지 않음. collector·SecKey helper는
  `lib/product-registration/temu/` 로컬 경로 유지.
- NULL-safe 필수 필드, current credential/Vault 재검증, blocked observation deterministic,
  non-extractable SecKey(`kSecAttrIsExtractable=false`, `SecKeyCreateSignature`만) 유지.
  Node collector에 `security -w` / `find-generic-password` / `createPrivateKey` 없음.
- r24 집중 테스트 31/31 pass (CAS/DB 21 + collector 7 + observation 3). 이전 세션 기록. 이번 세션에서 재실행하지 않음.
- 보조 소유 테스트 37/37 pass (source-db 9 + producer 8 + collector-source 13 + ledger 5 + final-payload 2). 이전 세션 기록.
- 이번 세션: preparation read-adapter 20/20, provider-read-adapter 10/10, source-collector 13/13, create-producer 8/8. fail 0.
- 커밋/푸시/운영 SQL/provider CREATE/실서명 없음.

## 미확인

- 운영 verifier JWT, signing/receipt Vault policy, Active+Compliance Approved+production credential 미설치.
- 실제 Temu DOM이 고정 UI contract와 일치하는지는 미확인.
- 공식 goods/SKU GET, CREATE, readback, 내부 완료는 미실행.
- 공유 `temuRequest` read-only allowlist는 r16 preparation RPC를 포함하지 않음. adapter는 r16만 발행하고 호출 시점에 공유 read-only ALS 안에서 mutation `temuRequest`를 차단한다. `protocols.ts`는 공용 파일이라 이 워크트리에서 수정하지 않음.

## 단계별 상태

- accountVerified: identity only (이전 기록). 이번 세션에서 재확인하지 않음.
- requiredFieldsVerified: false
- localFlowPassed: true (r24 소유 집중 31/31 + 보조 37/37 + 이번 adapter 관련 51/51 fail 0). 로컬 통과를 실등록 완료로 쓰지 않음.
- integrated: false
- providerCreated: false
- reviewSubmitted: false
- saleAvailable: false
- remoteReadbackVerified: false
- internalComplete: false

## 공용 파일 실제 연결 (이 워크트리)

- `app/api/admin/channel-operations/route.ts`
- `app/api/admin/temu/operator-app-observation/route.ts`

미적용 패치(scripts/package.json은 로컬 lib 경로만 유지):
- `docs/product-channel-parallel/reports/temu/temu-002-r24-package.json.patch`
- `docs/product-channel-parallel/reports/temu/temu-002-r24-operator-attestation-once.script.patch`
- `docs/product-channel-parallel/reports/temu/temu-002-r24-operator-seckey-helper.swift.patch`

## 차단

- App Inactive / Compliance Reviewing / 운영 키 부재. 실등록 금지.
- 운영 verifier JWT·signing/receipt Vault policy 미설치. collector 실기기 서명 금지.
- r23 `40500`/`40600`은 로컬 스키마 선행조건으로만 존재. r23 후보 재제출 아님.
- 원장 2/6을 올리지 않음.

## 다음 한 단계

Active+운영 credential과 verifier JWT가 준비되기 전에는 collector 실기기 서명과 provider CREATE를 시작하지 않는다.
