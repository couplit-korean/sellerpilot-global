# 1번·4번 독립 검토 — 2026-09-13

검토 대상: 1번 · 상품 등록 화면 오류 해결 / 4번 · 8채널 상품 등록 경로 정비.
기준: 통합 경로 /Users/kimchangheemac/dev/sellerpilot-app, HEAD 153106c 이후 두 작업의 미커밋 변경.
판정: 두 작업 모두 보완 필요. 구현 방향과 소유권 분리는 적절하지만 완료 승인·운영 반영 전 아래 네 항목을 해결해야 한다.

## 1번: 실제 브라우저 수명주기 결함 2개

### R1 — P1: StrictMode 초기 마운트에서 모든 이미지 요청이 차단됨
위치: app/_publishing/use-first-draft-images.ts:321 및 :131.
effect cleanup이 fence.unmount()로 mounted=false를 영구 설정한다. 같은 effect의 setup에는 복구가 없다. 설치된 Next App Router의 기본 StrictMode는 개발 시 setup→cleanup→setup을 수행하므로, 화면을 연 직후부터 activate/beginRequest가 null을 반환한다.
설치된 React 19.2.8 + react-dom + happy-dom으로 실제 hook을 마운트하고 Supabase 세션과 fetch만 mock한 결과:
- 일반 마운트: 요청 accepted=true, enqueue=1, phase=queued.
- StrictMode 마운트: accepted=false, enqueue=0, phase=idle.
영향: 로컬 next dev에서 1차 이미지 생성과 이후 사람 검토/상세 제작 진입이 막힌다. 이 재현은 개발 StrictMode 범위이며 운영에서 같은 현상이 발생했다고 주장하지 않는다.
필요한 보완: setup/cleanup이 반복돼도 유효한 실행 fence를 다시 구성하되 이전 세대 응답은 무효화해야 한다. 실제 StrictMode mount 테스트를 추가한다. StrictMode를 끄는 방식으로 회피하지 않는다.

### R2 — P2: polling 중 세션 부재 뒤 영구 대기
위치: app/_publishing/use-first-draft-images.ts:220 및 :285.
accessToken 부재를 이전 job/취소와 같은 stale로 반환한다. poll은 stale에서 즉시 종료하면서 requestPending을 풀거나 retryAvailable을 켜지 않는다. 이후 로그인 세션이 복원돼도 같은 job 요청이 계속 거부된다.
실제 hook 재현:
1. 로그인 세션 존재 상태에서 enqueue 성공.
2. 첫 polling 때 세션을 null로 제공.
3. 세션 복원 후 같은 job 재시도.
결과: retry=false, phase=queued, retryAvailable=false, 다음 polling 없음.
필요한 보완: 인증 부재·재로그인 필요와 이전 작업 응답을 구분하고, 현재 작업에 대해 요청 잠금 해제/사용자 안내/재시도 경로를 제공한다. 세션 소실→복원 행동 테스트를 추가한다.

잘된 부분: 원본 가공 URL만으로 완료 표시하지 않음, 여섯 역할 고정, 명시적 사람 검토 gate, 이전 job fence, 담당 파일 안에서만 수정.
검증 한계: 새 테스트는 분류기/fence를 직접 호출하고 hook의 abort/cleanup은 주로 소스 문자열로 검사한다. 실제 hook의 effect 재실행과 세션 중단 흐름을 검증하지 않아 위 두 문제를 놓쳤다.

## 4번: 요청 식별값의 호환성 결함 2개

### R3 — P2: 변경 전 요청의 같은 식별자 재시도 단절
위치: app/api/admin/channel-operations/route.ts:2112-2117 및 :2366-2376.
기존 fingerprint 입력에 credential 객체를 무조건 추가해, 상품·인증키·요청 내용이 같아도 이전 코드와 새 코드의 hash가 달라진다. 기존 attempt의 idempotencyKey를 그대로 재전송하면 DB의 payload mismatch 검사에 걸려 기존 작업을 반환하지 못하고 API는 409를 반환한다.
재현: HEAD와 현재 route에서 fingerprint 계산식을 각각 추출해 동일 변수로 실행했다. 저장소의 sellerpilot_claim_channel_operation SQL 함수를 최소 스키마의 메모리 PGlite에서 실행하여 변경 전 hash로 attempt를 접수한 뒤, 같은 key와 변경 후 hash를 재전송했다.
결과: 첫 접수 성공, hashChanged=true, 재시도 오류 "idempotency key payload mismatch".
영향: 배포 경계를 넘어선 요청 재시도·결과 불확실 상태 확인 경로가 끊긴다. 운영 미결 attempt 존재 여부는 이번 검토에서 조회하지 않았다.
필요한 보완: 기존 attempt를 원장 기준으로 안전하게 조회·검증해 이어가는 호환 경로 또는 검증된 전환 절차가 필요하다. 새 요청 key를 임의 발급하거나 fingerprint mismatch 가드를 제거하는 방식은 금지한다.

### R4 — P2: 만료 정책 변경이 동일 상품 요청의 식별값을 바꿈
위치: lib/product-registration/credential-execution-binding.ts:105 및 channel-operations/route.ts:2117.
expiresAt이 credential binding 전체와 함께 fingerprint에 들어간다. 기존 sellerpilot_update_credential_schedule은 키의 id/version/fingerprint를 유지하면서 expires_at만 변경할 수 있다. 화면 mutationContract는 expiresAt을 포함하지 않으므로 같은 화면 요청 key와 달라진 서버 hash가 충돌한다.
재현: 새 코드끼리 credential id/version/fingerprint, 상품, 가격, arguments를 동일하게 두고 만료일만 2030년에서 2031년으로 연장했다. 같은 SQL claim 함수로 접수 후 재시도한 결과 "idempotency key payload mismatch".
필요한 보완: 현재 시점의 만료 검사는 유지하되, 변할 수 있는 만료 정책을 요청의 불변 식별값과 분리한다. 만료 연장 뒤 같은 요청 재시도 및 실제 키 교체 뒤 차단을 함께 검사한다.

잘된 부분: 화면→remote-edit→admin API의 credential version 전달, 활성/다른 채널/요청 버전 불일치/만료 차단, 비밀값 제외, 채널별 코드 지원과 실제 외부 검증을 구분한 보고.
검증 한계: 새 4개 테스트는 binding 함수와 코드 문자열 전달을 검사하며, 기존 DB attempt와 새 fingerprint를 실제로 조합한 재시도 검사가 없었다. 8채널 운영 연결/등록 완료를 증명한 작업은 아니다.

## 이번 검토에서 실행한 검사

- 1번 집중 검사 24개 + 4번 신규 검사 4개 + remote-edit 검사 10개: 총 38/38 통과.
- 4번이 보고한 186개 회귀 묶음 재실행: 178 통과 / 동일 이름의 8개 실패.
- 실패 8개가 모두 이번 변경에서 발생했다는 뜻은 아니다. 기존 fixture/소스 문자열 검사 실패가 포함돼 있으며, 별도 재현한 R1~R4는 이 기존 테스트 묶음으로 잡히지 않는다.
- React hook 직접 마운트 재현 2건, 실제 fingerprint 계산식과 SQL claim 함수를 사용한 메모리 DB 재현 2건 수행.
- 설치된 Next 문서 reactStrictMode.md와 현재 next.config.ts를 대조했다.
- 두 작업의 변경 경로를 완료 보고·작업 이력과 소유권 manifest에 대조했으며 파일 소유권 침범은 확인되지 않았다.

## 범위와 상태

이번 검토는 1번·4번만 대상으로 했다. 2번·3번에 수정 지시를 보내거나 결과를 검토하지 않았다. 어떤 작업에도 메시지를 보내지 않았고 구현 파일 수정, Git stage/commit/push, 배포, 운영 DB 변경, 실제 상품 등록/CS 전송을 하지 않았다. 이 문서만 검토 산출물로 추가했다.
