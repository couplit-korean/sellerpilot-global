# Shopee CS 보충 구현·검증 보고

- 동결 선행 delta: `delta-after-integration-002.json` SHA-256 `e50484e882d4ae16e76eeeeeba6d715646601f6cdaaa540bb81eabef74edf971`
- S0: `S0-20260908-decaba426812a3ba`, HEAD `3cb72144e991626fae98a30cf51022d9a1aa6b0b`, 전용 branch `codex/cs-shopee-v1`
- 전용 폴더: `/Users/kimchangheemac/dev/sellerpilot-cs-shopee`, 준비 원장상 S0 파일 1,628개 검증
- 정본 SHA-256: prompt `8e3e2ddd6b8a566946bdb57cbba3b2a396508d5b2e9ee77b5096387aaebc73a0`, ownership `09d64aa4a62513f9eb4ccfa6af4bdf809389f69cb0fefa7ed7d8041addddd24f`, Shopee 기준 `a5c3cf7416fee17b142404d6984aaa0072c000e85ec41a14b7646bd60ce1464c`
- 결론: 허용된 전용 경로와 공통 proposal만으로 shop별 history 시작·원장·인증 route/UI·continuation event·target refresh CAS·원자 completion을 구현하고 격리 검증했다. 운영 DB·credential·provider·실고객 답변에는 쓰지 않았다.

## 실제 범위와 현재 외부 증거

실제 Seller Centre와 credential 메타데이터에서 확인한 대상은 SG `1719148844`, TW `1758392145`, TH `1758392144`, MY `1758392135`, VN `1758392139`, PH `1758392137`, BR `1758392161`, MX `1758392178`의 8개 shop이다. 앱은 `Couplit` app ID `228518`, live partner ID `2031489`, main account ID `4940266`이다. 이 목록은 shop 존재·선언 일치 증거이지 API 성공 증거가 아니다.

8개 access token은 모두 만료 상태이며 refresh token 메타데이터만 준비 상태다. 공유 credential refresh와 운영 DB 변경이 금지되어 provider `get_comment` 성공은 여전히 0 shop이고, 따라서 실제 provider GET→격리 DB→SellerPilot 웹 완주도 0 shop이다. 한 shop 성공이나 합성 격리 시험을 Shopee 전체 완료로 계산하지 않는다.

Buyer Chat은 앱 module 109 권한이 없고 Live Push가 OFF이며 공식 webhook/history/reply 계약이 확보되지 않았다. Buyer Chat 모듈을 추측 구현하지 않았고, 이 권한 대기가 후기·Returns 전용 구현과 검증을 막지 않도록 분리했다.

## 이번 보충 구현

1. `shopee-004-history-ledger-draft.sql`: owner·credential·run·shop·kind·scope 결속, page/interruption sequence, body-free 원격/정규화/격리/제외/event digest, checkpoint chain, replay 충돌, Returns detailRevision 조정, authenticated owner/admin read RPC를 service-only write와 분리했다.
2. `shopee-005-target-refresh-cas-draft.sql`과 `target-refresh-cas.ts`: 공유 credential에서 provider refresh POST 전 credential 단위 claim을 획득하고, 최신 payload에 정확한 target만 병합한다. 다른 7개 target 변경, stale same-target, 중복 refresh를 차단한다.
3. `shopee-007-history-start-draft.sql`: active credential의 Vault target과 검증된 market target이 일치하는 1~8개 shop만 fan-out한다. 후기 cursor corpus 1개와 Returns 15일 이하·1초 중첩 window를 shop별 독립 job으로 생성하며 request UUID replay는 재enqueue하지 않는다.
4. `history-event-evidence.ts`와 `history-authorization.ts`: 정확한 shop/kind/scope/sequence를 확인하고, 후기 comment ID 및 Returns return SN을 본문 없는 digest로 기록한다. 401/403은 해당 shop의 `authorization_required`로 변환하고 다른 shop의 job과 상태를 합치지 않는다.
5. `shopee-008-history-event-wiring.patch`: 현재 통합본의 `operations.ts`, `serverless-gateway-provider.ts`, `serverless-gateway.ts` 문맥에 맞춘 exact proposal이다. continuation에 sequence/checkpoint를 이어 붙이고 page 또는 interruption evidence를 completion에 결속한다.
6. `shopee-009-atomic-history-completion-draft.sql`: 기존 gateway completion과 Shopee history event를 한 PostgreSQL 함수/트랜잭션으로 묶었다. event 검증이 실패하면 일반 completion·영수증·continuation도 함께 롤백되어 완료 job과 history 원장 사이의 영구 gap을 막는다.
7. 인증 route와 UI: GET은 로그인 사용자 client의 owner/admin read RPC만 사용하고, POST는 서버 service client로 정확한 owner와 request UUID를 전달한다. UI는 같은 불확실 재시도 동안 UUID를 보존하고, shop·국가·kind·상태·scope·원격/정상/중복/격리/제외/미처리·checkpoint·알려진 상세 잔량을 분리 표시한다.

## 요구 반례 검증

| 요구 | 격리 결과 | 운영/원격 한계 |
|---|---|---|
| 여러 shop의 동일 comment ID | shop ID를 포함한 record digest가 달라짐 | 실제 provider 표본은 token refresh 후 필요 |
| 한 shop 403과 다른 shop 진행 | TW 403, TH 401, MY token 만료를 별도 scope로 남기고 SG/다른 scope projection 진행 | 실제 8shop remote run은 미실행 |
| token 회전·중복 refresh | target-only merge, same-target stale reject, 다른 target busy, 재호출 idempotent 통과 | 운영 credential mutation 0 |
| 페이지 상한·빈 page+next·반복 cursor | generation rotation/재개 통과, 빈 후기 page+next 및 반복 checkpoint 차단 | provider 실제 상한 이후 범위는 미확정 |
| Returns 10/11·15일 경계 | 상세 10건 뒤 11번째 잔량 checkpoint, 정확히 15일 허용, 15일+1초 차단 | 실제 Returns remote rows 0 |
| 후기 수정·첨부 | 수정 세대는 distinct inbound revision, native media 보존 시험 통과; source URL 만료시각은 provider 미제공으로 unknown 유지 | 첨부 영구 보관·실 URL expiry 검증은 미수행 |
| 미결속 답변 | shop/item/comment 불일치가 POST 전 차단되고 DB reply enqueue는 latest inbound generation 결속 | 승인 대상·문구가 없어 실답변/readback 0 |
| 재수집 중복0·중단 재개 누락0 | event key replay 중복 집계 0, request UUID replay 신규 job 0, checkpoint sequence/원자 rollback 검증 | 실제 provider 재수집은 미실행 |

Returns는 사유·재평가 사유·상태·금액/통화·분쟁·협상·기한·증빙/첨부·역물류/부분수량을 allowlist로 보존하고 전화·주소·email branch는 제외한다. Returns action/reply는 계속 닫혀 있다.

## 검증 결과

- 전용 focused Node 시험: 최종 보충 32/32 통과, PGlite/HTTP test account만 사용.
- 원자 completion 단독: 3/3 통과. 정상은 completion receipt+history event 동시 commit, invalid event는 job status·receipt·event 전부 rollback, wrapper는 service-only.
- 현재 통합본 복제본에 전용 파일을 얹고 006+008 적용: 두 patch 모두 현재 통합본 `git apply --check` 통과, 전체 `tsc --noEmit` 및 수정 파일 ESLint 통과.
- 통합본 복제본의 공통 회귀 `channel-pagination`, `serverless-cs-gateway`, `serverless-gateway-provider`: 104개 중 103 통과. 유일 실패는 통합본 원본에서도 같은 `generic serverless operation matrix` 기대 불일치라 이번 Shopee delta가 만든 회귀가 아니다.
- 원본/통합본/격리본 어디에도 commit·push·deploy·운영 migration·credential refresh·provider POST·실고객 reply를 수행하지 않았다.

## 적용 순서와 외부 선행조건

통합 담당은 `delta-after-integration-003.json`의 전용 파일 해시를 확인한 뒤, 격리 DB에서 004→005→007→009 SQL 순서로 적용하고 006→008 공통 patch를 적용한다. 현재 통합본 preimage는 006/008 적용성 검사 시점의 해시로 delta에 기록한다. 운영 적용 전에는 같은 PGlite/route/atomic/TypeScript 회귀를 다시 실행해야 한다.

그 다음 승인된 단일 외부 작업은 SG `1719148844` target refresh를 CAS로 수행하고 다른 7shop target digest 불변을 readback한 뒤, SG 후기 GET→격리 DB→인증 웹을 완주하는 것이다. SG가 성공해도 나머지 7shop 후기, shop별 Returns, 신규 pull 관측, 승인 후기 답변+GET readback, Buyer Chat 권한/구현이 각각 닫히기 전에는 Shopee 전체 완료가 아니다.
