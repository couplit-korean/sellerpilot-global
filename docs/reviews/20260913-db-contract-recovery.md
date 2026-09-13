# 2026-09-13 DB 계약 복구 — 작업 진행 중

정규 작업 폴더 `/Users/kimchangheemac/dev/sellerpilot-app`, Supabase `sqaoqucxakebqkiygdxb`를 기준으로 검토했다. **DB 복구는 적용했고 API/worker 코드는 아직 배포 전이다. 전체 채널 운영 완료 판정이 아니다.**

## 적용 및 검증

- 새 forward migration 20개를 의존성·현재 함수 본문 MD5·기존 보호 로직·실제 테이블/CHECK에 맞춰 검토하고 적용했다. 원문 SHA256과 운영 migration journal이 모두 일치한다. 일괄 `db push`는 사용하지 않았다.
- 실행 코드의 RPC 직접 호출뿐 아니라 `callRpc`/`runRpc` 등 함수 인자를 전달하는 헬퍼 호출도 AST로 추적했다. 762개 파일, 661개 호출 지점에서 확정한 RPC 378개는 운영 public schema에 모두 존재한다. 동적/전달 인자 38곳은 별도 목록으로 남겼다. **함수 이름 존재는 함수 실행·권한·판매채널 성공 증거가 아니다.**
- 마지막 로컬 gateway 확인: `/readyz` ready, active job 0, job claim HTTP 200. 실행 SHA는 여전히 `5adbed3`이다.
- 11번가 create recovery worker claim: 기존 503에서 200/idle로 회복했다. 실제 새 상품을 등록한 것은 아니다.

## 중요한 수정

| 영역 | 수정 및 검증 |
|---|---|
| CS | Shopee 이력/답변/대화/첨부자료, Temu 계정/재시도/이력, SmartStore 이력/정확한 답변, Qoo10 출처/답변, Coupang 주문 근거/답변 재조회, Lazada 상품 리뷰 함수 복구. `cs_order_bindings` 선행 테이블 복구. |
| SmartStore 등록 | 최종 상태 저장과 원본 버전 보호를 복구. 실제 DB에 없는 product `ready` → `active`, gateway `completed` → `succeeded` 상태 오류 수정. 실제 CHECK로 검증. |
| 11번가 등록·계정 | 이미지 Storage 원본 bytes를 읽어 SHA256·크기·소유 경로 검증 후 승인 자료에 저장. 실제 approval 테이블 참조 수정. pending 진단과 정확한 계정 전환 복구; Lazada/SmartStore 다중 계정과 최신 Temu 계정 식별 로직 보존. 구상품 attestation 자동 seed 제외. |
| Lazada 등록 | POST/GET 영수증 실제 UTF-8 바이트 hash/길이, exact replay, 충돌 차단 및 CAS 복구. |
| Qoo10 등록 | 원본/GET 복구, immutable receipt 복구. attempt에 존재하지 않는 `reconciliation_required` → `manual_required`. 원격 확인 전 게시 완료로 처리하지 않는다. |
| Coupang 등록 | 누락 공식 snapshot 기록 복구. 기존 최신 R12 전송 검증 함수 그대로 보존. |
| Temu 등록 | authoritative source, 서명 challenge, verified collector, final body CAS 복구. 실제 credential fingerprint 12자리 대문자 hex를 64자리 SHA256으로 오인하던 SQL·TS 규칙 수정. 근거자료 SHA256 64자리 검증은 유지. 브라우저가 넘긴 등록 근거 표식 삭제 누락 수정. |
| Shopee 등록 | 빠진 execution lineage 원본을 기존 local checkout에서 복원하고 선행 target cache credential version, 단계 영수증·재개·successor 검증 복구. 단계 영수증 저장 시 gateway를 성급하게 성공으로 만들지 않으며 최종 응답/완료 영수증은 공통 completion RPC로 저장한다. 이미 완료된 이미지 업로드는 저장된 provider image ID를 재사용한다. |
| Worker | OAuth 짧은 유효시간 요청 우선순위, bounded drain refill, Temu provider 실행 전 DB 계정/권한 자료 결속, Coupang 답변 재조회 retry continuation 처리 수정. |
| RPC 진단 | 헬퍼 경유 호출 탐지 추가. PostgreSQL 제한을 넘던 게시 재조회 예약 함수명은 짧은 public alias로 연결. |

## 테스트와 한계

- 최종 통합 집중 검사: 170/170 통과 (`node --import tsx --test`로 이번 변경 관련 22개 파일 실행). 최종 typecheck 통과.

- Temu 최종 CAS/서명/collector/producer 40개 및 11번가 lifecycle/pending 8개 테스트 경로를 검증했다(수정 중 발생한 fixture 오류는 별도 재실행으로 해소).
- Shopee refresh/R6 15개, 실행/재개/최종 저장 11개 통과. 이미지 업로드 응답 분실과 완료 응답 분실을 구분하고 중복 전송 방지를 검증했다.
- 앞선 CS retry/drain 관련 89개 및 채널별 복구 테스트 통과. 전체 저장소 테스트 통과를 주장하지 않는다. 과거 경로/누락 helper를 참조하는 historical fixture는 별도 한계다.
- Next route type 파일을 재생성한 후 typecheck 통과. Next production build 통과. 이후 수정은 배포 직전 필요한 검사를 다시 수행한다.
- 자세한 migration 버전, 해시, 동적 호출 위치는 같은 이름의 JSON 파일에 기록했다.

## 아직 남은 운영 작업

1. eBay의 기존 OAuth 작업 `2fb58f46-252c-4533-97aa-a96878d6e217`은 토큰 교환 결과를 보존하지 못한 `reconciliation_required` 상태다. provider 응답/복구 Vault 없음, credential refresh uncertainty 있음. 이는 사용자 승인 응답 대기가 아니다. 만료된 코드를 재사용하거나 불확실성을 근거 없이 지우지 말고 새 승인→동일 판매자 검증→새 credential 저장→Commerce Message GET→근거를 남긴 이전 작업 supersession으로 복구해야 한다.
2. Lazada MY/PH/SG/TH/VN 연결 정보는 저장돼 있지만 국가별 API 접근·IM/review 등 권한 완료는 별도 검증한다. Vercel 허용 IP 제한 경로는 Mac gateway에서 실행한다.
3. Temu after-sales pagination 오류와 Shopee 일부 실제 CS 결과의 reconciliation을 추가 진단한다.
4. 현재 미배포 TS 수정의 Vercel/로컬 worker 배포 및 SHA 동기화, 실제 결과 저장 재조회가 필요하다.
5. 실제 상품 등록/고객 답변/배송 완료는 별도 증거다. 임의의 고객 메시지·가짜 주문·중복 상품을 만들지 않는다.
