# 채널 결과 및 공통 변경 요청 양식

이 파일은 통합 담당이 소유하는 양식이다. 채널 담당은 자기 reports/<channel>/ 또는 proposals/<channel>/ 아래 복사해 작성한다. 이 양식 자체를 여러 채팅이 동시에 고치지 않는다.

## reports/<channel>/status.md

```markdown
# <채널> CS 상태

- 시각:
- S0 ID:
- 전용 작업폴더:
- 소스 변경분 manifest:
- 실제 seller/app/country/shop 범위:
- 비밀/실고객 원문 없는 증거 경로:
- 이번에 닫은 정확한 기능:

| 게이트 | 상태(미착수/진행/통과/외부조건 대기/해당 없음) | 증거 | 남은 행동 |
|---|---|---|---|
| G1 범위·권한 | | | |
| G2 로컬 경로 | | | |
| G3 실제 읽기 | | | |
| G4 과거·웹 대조 | | | |
| G5 신규 수신 | | | |
| G6 답변 관측 | | | |
| G7 복구 | | | |
| G8 운영 적용 | | | |

## scope별 분모
| account/shop/kind/상태/폴더 | from/to·timezone | 원격 고유 ID 수 | 정상 | 중복/기존 | 격리 | 근거 있는 제외 | 미처리/gap |
|---|---|---:|---:|---:|---:|---:|---|

## 검증
| 명령 | source hash | 환경 | exit code | 통과/실패 | 로그 |
|---|---|---|---:|---|---|

## 다음 행동
- 지금 가장 먼저 해야 하는 단일 행동:
- 공통 변경 요청 ID:
- 외부 선행조건과 필요한 사실/자료:
- 전체 자동연동 제한:
```

해당 없음은 공급자 계약상 존재하지 않는 동작 등에만 근거와 함께 쓴다. 지원하지 않거나 아직 조사하지 못한 기능을 해당 없음으로 처리해 분모에서 빼지 않는다. 비율은 의미가 같은 범위 내에서만 계산한다.

## proposals/<channel>/<번호>-<주제>.md

```markdown
# 공통 변경 요청 <channel>-<번호>

- 목적:
- 요청 채널:
- S0 ID / 현재 인터페이스 버전:
- 수정할 공통 파일과 함수:
- 현재 파일 SHA-256:
- DB 객체(해당 시 이름과 signature):
- 기존 동작:
- 문제를 재현하는 최소 입력:
- 원하는 동작:
- 전용 모듈 경로와 export:
- 기존/새 입력·출력 계약:
- 최소 변경안:
- 다른 채널 영향:
- 상품/주문/배송 mutation 영향: 없음 또는 차단 증거
- 재현·회귀 시험 명령:
- migration 선행/preimage/ACL 요구:
- 우선순위: 첫 실제 읽기/웹 차단 / 오연결·손실 / 중복답변 / 과거누락 / 추가기능
- 통합 담당 처리 상태:
- 반영된 통합 소스 hash와 검증:
```

## reports/<channel>/delta.json

```json
{
  "snapshotId": "<S0 ID>",
  "channel": "<channel>",
  "workspace": "<absolute path>",
  "files": [
    {
      "path": "lib/channels/cs/<channel>/example.ts",
      "change": "add",
      "beforeSha256": null,
      "afterSha256": "<hash>",
      "reason": "<one concrete change>"
    }
  ],
  "sharedProposals": ["<channel>-001"],
  "testEvidence": ["<relative log path>"]
}
```

이 manifest는 승인/완료 플래그를 대신하지 않는다. 통합 담당이 실제 파일 내용·소유권·before hash와 시험 결과를 검토한다. 통합된 파일만 반영 완료로 기록한다.

## 통합 담당 첫 실행 체크리스트

1. 수정된 CS 후보를 S0로 보존하고 민감/빌드 산출물을 제외한 복제 manifest를 검증한다.
2. S0를 반영한 8개 폴더와 전용 포트를 준비한다. ownership.json의 snapshotId와 workspacesPrepared는 검증 뒤에만 갱신한다.
3. 기존 전체 시험의 실패 이름/로그를 고정하고 현재 후보에서 실제 회수되지 않은 결과는 미확인으로 둔다.
4. 실제 첫 읽기와 웹 연결을 막는 공통 요청부터 하나씩 처리한다.
5. 채널별 고정 과거기간 planner와 지원 scope를 받아 공통 history route/UI에 등록한다. 임의 기간 전체를 한 job으로 실행하지 않는다.
6. 채널·kind별 검증된 권한/연결 범위만 실행하도록 runtime 설정을 검토한다. 한 채널이 준비됐다고 나머지 미확정 scope를 동시에 켜지 않는다.
7. 첫 통합 후보는 쿠팡 핵심 흐름을 우선하되 실제 read-only 차단 시 이미 읽기를 통과한 채널을 선택한다. 다른 채널의 완료를 기다려 묶음 출시 대상으로만 남겨두지 않는다.
8. 사용자 제한이 유지되는 동안 운영 적용 실행은 보류하고, 필요한 정확한 migration 집합·소스 hash·검증·롤백·scope 설정을 준비한다.

