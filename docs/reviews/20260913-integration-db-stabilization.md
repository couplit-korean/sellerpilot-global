# 4개 작업 통합 및 DB 안정화 진행 — 2026-09-13

## 검증 완료

- 네 작업 후속 변경을 함께 실행한 관련 검사 286/286 통과, 실패/skip 0. 로그: `/tmp/sellerpilot-integration-green.log`.
- Next.js production build 종료 코드 0. 로그: `/tmp/sellerpilot-integration-build.log`.
- 상품/CS/배송 분리 검사 42/42 통과, 금지 참조 6방향 모두 0개. `pnpm check:workspace` 통과. 비밀값 패턴 검사에서 이번 대상 61개 파일에 후보 검출 0개.
- 공유 검사 6개 수정은 시험 데이터/기대값 정정이다. 런타임 보호 조건은 완화하지 않았다.
  - UI: `65_000`과 `65000`은 같은 숫자이므로 소스 검사에서 두 표기를 허용.
  - drain: 실제 실행된 enqueue/transaction-completion RPC를 검증하고, 누락된 publication-review RPC 오류 기록 검증은 유지.
  - gateway: 생성에 필요한 배송 문맥이 없는 Qoo10 create를 provider write 이후 사례로 사용하지 않는다. 유효한 기존 상품 update fixture로 변경하여 write 전 실패와 write 후 reconciliation_required를 각각 검증.
- 이 수치는 관련 선택 검사다. 이전 전체 저장소 검사에 남아 있던 83개 실패 전체를 해소했다고 주장하지 않는다.

## 계정 및 대상 대조

| 대상 | 이번 읽기 확인 | 판정 |
| --- | --- | --- |
| Vercel 로그인 | `/v2/user`: `couplit.official@gmail.com`, username `couplitofficial-4206` | 공식 계정 확인 |
| Vercel 연결 프로젝트 | `sellerpilot-global`, `prj_9fRYsoTT4fD6XVEMe4NX9mpPlljA`, team `team_Y4vAMBqZlfQ4gXvkGieFh5aG` / `project-e59d` | 로컬 link와 일치 |
| Supabase 대상 | `sqaoqucxakebqkiygdxb` 조회/SQL 모두 connector 권한 거부 | 직접 DB 확인 불가 |
| 현재 Supabase connector 목록 | `creator-news`, `econo-jabis-news`만 반환 | SellerPilot 접근 연결 필요 |

Supabase connector의 실제 로그인 이메일은 확인되지 않았다. 다른 두 프로젝트에는 SQL/변경을 실행하지 않았다. Vercel env pull은 민감값을 `[SENSITIVE]`로 반환했으므로 실제 DB URL/키의 유효성 검증으로 사용하지 않았다. 공식 계정의 SellerPilot 프로젝트 접근을 연결하도록 사용자에게 요청했으며 자격 증명 원문을 요청하지 않았다.

Chrome 로컬 프로필 목록에서 JEONGHUN / `couplit.official@gmail.com`을 읽기 확인했지만 현재 도구에 Chrome 전용 제어기가 없어 해당 프로필의 Supabase 로그인 세션은 검사하지 않았다.

## 운영 503의 구체적 근거

현재 Production 배포 `dpl_Fkbk9Kyg9whytrri5pUcG5PQkjUm`의 최근 30분 error 로그 표본에서 다음 메시지가 31건 확인됐다.

```text
channel inquiry history coverage RPC failed { code: 'PGRST202', status: 503 }
```

해당 배포 SHA `fd426cc588f03c1e187b689141018b6de4a38eca`와 통합 소스 모두 `lib/cs/operations/worker-completion.ts`에서 `sellerpilot_service_record_cs_history_page_v1`를 호출하는 부분이다. 로컬 migration `20260907231000_add_cs_history_coverage_ledger.sql`의 함수 인자 10개와 호출 인자는 일치한다.

[PostgREST 공식 오류 정의](https://docs.postgrest.org/en/stable/references/errors.html#group-2-schema-cache)에 따르면 PGRST202는 오래된 함수 signature 또는 함수 부재에 해당한다. 앱은 이를 503으로 표시한다. 운영 함수 누락과 schema cache 불일치 중 어느 것인지는 DB 조회 전 확정할 수 없다. 이 증거를 CS 초안 API 등 모든 503의 동일 원인으로 확대하지 않는다.

최근 15분의 503 요청 표본 70개에는 `/api/cs/worker/drafts`, `/api/channel-gateway/worker/complete`, `/api/channel-gateway/worker/elevenst-create-recovery`, `/api/internal/channel-gateway-drain`, `/api/internal/competitor-prices`가 포함됐다. 원문 로그/고객 데이터는 저장소에 넣지 않는다.

## 접근 복구 후 실행 순서

1. 프로젝트 ID와 공식 계정/조직 접근을 재확인한다. DB 이름 `postgres`만으로 프로젝트를 식별하지 않는다.
2. [읽기 전용 진단 SQL](../../scripts/diagnostics/sellerpilot-db-stability-readonly.sql)로 필수 함수 인자/실행 권한/정의 해시, 연결·잠금·테이블 통계·인덱스를 확인한다. 기본 제한은 statement 5초, lock 1초다.
3. coverage migration의 version/name/저장 원문을 대조한다. 함수가 존재하고 계약이 맞으면 [공식 schema refresh 절차](https://supabase.com/docs/guides/troubleshooting/refresh-postgrest-schema)를 검토한다. 실제 함수 누락이면 의존 객체와 migration 충돌부터 확인한 뒤 필요한 변경만 적용한다. 전체 `db push`나 상태 강제 성공 처리는 하지 않는다.
4. 작업 큐에서 채널/작업/상태별 수와 만료 lease를 확인한다. 외부 변경 시작 가능성이 있는 작업은 원격 확인 후 복구한다. 완료 API가 실패했다고 상품/답변을 다시 전송하지 않는다.
5. 같은 완료 요청의 정상 저장/replay, 큐 감소, 503 재발 여부를 확인한 뒤 새 통합 배포와 로컬 실행본의 SHA를 맞춘다.

## 현재 완료 경계

로컬 통합 검사는 완료됐다. 운영 DB 수정, 503 회복, 새 통합본의 Production 승격, 설치된 작업자 교체, 실제 8채널 신규 등록/CS 발송은 아직 완료하지 않았다. 진행 중 외부 작업을 확인하지 않은 채 worker를 강제 재시작하지 않았다.

후속 `/readyz`는 HTTP 503 / `degraded`, `activeGatewayJobs: 1`, release `fd426cc588f03c1e187b689141018b6de4a38eca`, scheduler 비활성으로 확인됐다. 과거 ready 기록을 현재 정상으로 사용하지 않는다.
