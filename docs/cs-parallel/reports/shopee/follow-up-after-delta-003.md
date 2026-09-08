# Shopee CS delta-004 후속 불변조건 보고

- 작성 시각: 2026-09-08 KST
- 기준: `S0-20260908-decaba426812a3ba`, branch `codex/cs-shopee-v1`, HEAD `3cb72144e991626fae98a30cf51022d9a1aa6b0b`
- 동결 선행 delta: `delta-after-integration-003.json` SHA-256 `7a8fb97bd3ab4c4b04cf97358a429f32d9a33cf7981db70d08b12f8bca4589d1`
- 작업 경계: 전용 폴더의 신규 코드·시험과 `proposals/shopee/`만 변경했다. 통합본, 운영 DB, Vault credential, provider, 고객 답변, 커밋·푸시·배포는 변경하지 않았다.

## 결론

리뷰에서 확인된 6개 결함을 하나의 후속 적용 묶음으로 닫았다. SQL `shopee-010`은 요청 UUID의 기간·credential·shop/country 계획을 불변 원장으로 고정하고, scope와 event를 정확한 credential/Vault target 및 job의 수집 작업 ID·순서·재개 지점에 결속한다. `shopee-011` 패치는 strict KST 날짜·응답 작업 ID 검증을 실제 route에 연결하고, 요청 중 날짜 입력을 잠그며 내부 용어를 사용자용 한국어로 바꾼다.

## 실제 shop 범위와 외부 증거 경계

이번 후속에서도 실제 대상은 SG `1719148844`, TW `1758392145`, TH `1758392144`, MY `1758392135`, VN `1758392139`, PH `1758392137`, BR `1758392161`, MX `1758392178`의 8개다. 앱은 `Couplit` app ID `228518`, live partner ID `2031489`, main account ID `4940266`이다.

이는 Seller Centre와 credential 선언에서 확인된 shop 목록이다. 8개 access token 만료와 운영 credential 변경 금지 때문에 이번 후속의 provider GET 성공, 실제 격리 DB 적재, 인증 운영 웹 대조는 모두 0 shop이다. Buyer Chat module 109 권한·webhook/history/reply 계약도 여전히 미확보다. 이 외부 조건들은 후기·Returns의 로컬 불변조건 검증을 막지 않았지만, Shopee 실제 완료 증거로 대체되지 않는다.

## 리뷰 항목별 폐쇄 내용

| 리뷰 결함 | 후속 방어 | 격리 반례 |
|---|---|---|
| NULL `p_from`/`p_to`가 조건을 우회 | start RPC 첫 분기에서 두 값을 명시적으로 NULL 검사 | NULL 각각 거부, request/scope/queued job 모두 0 |
| 같은 요청 UUID로 기간·credential·shop 계획 변경 | private start-request 원장에 credential ID, 작업 ID, 기간, 정렬 target 계획과 SHA-256 저장; exact replay만 허용 | exact replay queued 0, 기간 변경 및 target 계획 변경 거부 |
| `2024-02-30` 정규화 및 오늘 23:59:59 미래 판정 | 달력 round-trip 검증, KST 오늘은 현재 시각, 이전 날짜만 23:59:59 포함 | 잘못된 날짜 400, KST 오늘 202, 과거 종료 초 포함 |
| 오래된 credential target·동일 shop 다국가 오결속 | 모든 target 조회에 exact `credential_id` 추가; Vault shop 1개와 market row 1개 및 country 단일성 요구; 실제 `verified_at NOT NULL` 제약을 fixture에 반영 | old credential target 거부, SG+MY 중복 country 거부, NULL verified_at 거부 |
| 같은 shop/scopeKey의 다른 작업 event 주입 | event trigger가 job credential/owner/작업 ID/scope/shop/kind/sequence/input checkpoint를 scope와 event에 모두 결속 | cross-run, sequence mismatch, checkpoint mismatch 모두 거부 |
| plan RPC가 임의 country/scope를 받을 수 있음 | scope insert/update trigger가 current credential의 Vault target 및 exact market country를 검사 | 틀린 country 거부, 정확한 SG scope만 수락 |

## route와 UI

- route는 `Date.parse` 대신 `history-start-request.ts`의 strict KST parser를 쓴다.
- 정상 스키마라도 응답 `historyRunId`가 요청 UUID에서 결정된 값과 다르면 HTTP 502로 차단한다.
- 로딩 중 시작일·종료일 입력을 disabled로 고정해 같은 요청키의 화면상 기간 변경을 막는다.
- 사용자 화면에서 `cursor corpus`, `window`, `run`, `checkpoint`를 각각 `조회 가능 범위`, `조회 구간`, `수집 작업`, `재개 지점`으로 표시한다.
- 기존 후기/Returns status·shop별 실패 분리는 유지하며 Returns action과 고객 답변 경로는 열지 않는다.

## 검증

- 전용 PGlite/TypeScript: 9/9 통과. NULL, immutable request, old credential/multi-country, exact plan binding, cross-run/sequence/checkpoint 및 strict 날짜를 검증했다.
- 현재 통합본의 route/UI/test preimage에 `shopee-011` `git apply --check`: 통과.
- 통합본 복제본에 신규 helper·SQL·시험과 patch를 적용한 실제 route PGlite 시험: 10/10 통과. 잘못된 날짜 400, KST 오늘 접수 202, 응답 작업 ID 불일치 502를 실제 `POST` 함수로 검증했다.
- 패치 적용 복제본 전체 `tsc --noEmit`: 통과.
- 변경 route/UI/helper/test ESLint: 통과.
- `git diff --check`: 통과.
- fixture와 로그에는 합성 식별자·본문 없는 digest/count만 사용했고 실제 credential·고객 원문을 추가하지 않았다.

## 적용 순서

통합 담당은 delta-004 해시를 확인한 다음 SQL `shopee-010`을 기존 Shopee history SQL 뒤에 격리 DB에서 실행하고, patch `shopee-011`을 적용한다. 이어서 `cs-shopee-history-invariants-db`, `cs-shopee-history-start-request`, 패치된 `cs-shopee-history-route-db`, 전체 TypeScript/선정 ESLint를 다시 실행한다. 운영 migration·Vault refresh·provider 요청은 이 후속 제출의 적용 범위가 아니다.

실제 증거의 다음 단일 단계는 기존과 같다. 승인된 공유 refresh 경로에서 SG `1719148844` target만 CAS 갱신하고 다른 7shop payload 불변을 readback한 뒤, SG 후기 GET→격리 DB→인증 웹을 완주해야 한다. SG 한 shop 성공도 나머지 7shop과 Returns, 신규 pull, 승인 후기 답변 readback, Buyer Chat 계약을 완료로 만들지 않는다.
