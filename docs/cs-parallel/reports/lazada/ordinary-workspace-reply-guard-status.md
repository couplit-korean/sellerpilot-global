# Lazada 009 일반 CS·초안·답변 경계 상태

- 시각: 2026-09-09 00:28:41 KST
- 기준: `S0-20260908-decaba426812a3ba`
- 브랜치: `codex/cs-lazada-v1`
- 결과: 009 공통 SQL/patch 제안 완료, actual normalizer→V3 ingest→중앙 008 정본 GET 및
  workspace/AI/enqueue 동일 PGlite 회귀 18/18 통과
- 공통/운영 변경: 없음

## 확인한 결함

중앙 008 반영 뒤 대화/보관함은 회수 본문을 마스킹하지만, 일반 CS 카드와 통합 검색은
별도 operations snapshot을 쓴다. workspace snapshot이 본문·번역·저장 초안을 overlay하지
않아 base snapshot의 회수 전 값이 유지된다. AI 초안 생성은 최신 inbound key만 확인한 뒤
그 저장 본문을 worker payload에 넣는다. reply enqueue 역시 V3 recall/conflict 상태를
원자적으로 검사하지 않는다.

## 제안 상태

- 일반 workspace의 Lazada 최신 메시지에 `latestMessageState`와 `replyAllowed`를 추가한다.
- confirmed recall은 안내문만 반환하고 번역/저장 초안을 null로 만든다.
- conflict는 최초 승인 본문을 유지하지만 번역/저장 초안을 null로 만들고 검토 상태를
  노출한다.
- AI 초안과 실제 reply enqueue는 exact owner/credential/seller/session/message/fingerprint
  projection이 normal일 때만 통과한다.
- enqueue 티켓 lock에서 다시 검사해 UI preflight 뒤 회수 경쟁을 차단한다.
- 공통 UI patch는 로컬 초안 generation key에 message state를 포함하고 최종 검토 모달도
  현재 key/state를 다시 확인한다.

## 검증

- 신규 집중 시험: 3/3 통과
- V3 + raw projection + 008 + 009 묶음: 18/18 통과
- 신규 시험 ESLint: exit 0
- 현재 통합본 대상 `git apply --check`: exit 0
- 중앙 008 정본 migration을 `SELLERPILOT_INTEGRATED_ROOT`로 직접 읽어 실행했다.
- 합성 메시지만 사용했으며 실제 고객 원문·비밀은 기록하지 않았다.

## 판정 경계

- G2 로컬: 통과
- G3 실제읽기: 이전 준비 상태와 동일. 이번 로그인 완료만으로 CS Bot grant를 확정하지 않음
- G4 과거·웹: 코드/격리 DB 검증 통과, 운영 웹 readback 미시험
- G5 신규: 로컬 Push/bootstrap ingest 회귀 유지, 운영 webhook 미시험
- G6 답변관측: recall/conflict 차단 검증 통과, 승인 실답변/원격 echo 미시험
- G7 복구: 기존 V3 replay 회귀 유지
- G8 운영: 외부조건. 중앙 통합·migration 적용·배포 후 운영 계정에서 별도 확인 필요

다음 한 행동은 통합 담당이 009 SQL을 새 migration으로 배정하고 공통 patch를 적용한 뒤,
같은 신규 시험을 fallback 없이 canonical migration 경로에서 재실행하는 것이다.
