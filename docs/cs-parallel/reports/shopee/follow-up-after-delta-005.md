# Shopee CS delta-006 정본 완료 체인·owner GET 검증

- 작성일: 2026-09-09 KST
- 기준: `S0-20260908-decaba426812a3ba`, branch `codex/cs-shopee-v1`, HEAD `3cb72144e991626fae98a30cf51022d9a1aa6b0b`
- 동결 선행 delta: `delta-after-integration-005.json` SHA-256 `bbd3d3062c6a0e492098824059246b24d41e351cb3b932fc311ddf39e179463a`
- 작업 경계: Shopee 전용 신규 시험과 보고서만 추가했다. 중앙 통합본, 공통 source, canonical migration, 운영 DB, Vault credential, provider, 고객 답변, 커밋·푸시·배포는 수정하지 않았다.

## 결론

delta-005의 full-chain 시험이 단순화한 공통 완료 fixture를 사용하던 부분을 별도의 delta-006 시험으로 보강했다. 새 시험은 현재 중앙 통합본의 canonical migration에서 실제 원자 완료 본체, serverless token-gate rewrite, 현재 Shopee 허용 matrix, 현재 serverless lease ownership 함수와 Qoo10·Temu·Lazada·Coupang 완료 wrapper 본문을 직접 추출해 격리 PGlite에 설치한다. 따라서 Shopee `inquiries.list`가 현재 공통 완료 wrapper 8단계를 통과하는지 실제 SQL 본문으로 검증한다.

같은 격리 DB에서 두 shop의 history start, 실제 worker 정규화, serverless lease/context, 원자 completion receipt와 history event, 인증된 실제 Shopee owner GET route를 연속 실행했다. SG Product Review는 첫 page 뒤 `partial`, continuation page 뒤 `complete`로 전환됐다. TW Product Review의 provider 403은 해당 shop만 `authorization_required`로 유지됐다. 양국 Returns는 실행하지 않았으므로 `pending`으로 남았고, Buyer Chat은 Product Review 원장에 섞이지 않았다.

공통 구현 결함은 이 검증에서 발견되지 않았다. 따라서 shared source 수정 proposal이나 migration은 새로 만들지 않았다.

## 정본 완료 wrapper 체인

시험이 정본에서 그대로 읽어 실행한 완료 경로는 다음과 같다.

1. `20260826090400_atomic_gateway_completion_side_effects.sql`의 원자 완료 본체와 completion context
2. `20260828145600_serverless_cs_claim_and_runtime_bootstrap.sql`의 serverless token-gate rewrite, touch/context/completion wrapper
3. `20260907200000_enable_shopee_comment_cs.sql`의 현재 `shopee + inquiries.list` 허용 matrix
4. `20260908013000_hydrate_exact_coupang_local_verifier_claim.sql`의 현재 serverless lease ownership 함수
5. `sellerpilot_056700_complete_gateway_before_qoo10_s1_activation`
6. `sellerpilot_133000_complete_gateway_before_temu_publication`
7. `sellerpilot_173960_complete_before_temu_exact`
8. `sellerpilot_173980_complete_before_lazada_exact`
9. `sp_173990_complete_pre`
10. `sellerpilot_090500_complete_before_qoo10_shipping_s1`
11. `sellerpilot_complete_before_coupang_exact_live`
12. 현재 `sellerpilot_service_complete_gateway_transaction`
13. `sellerpilot_service_complete_serverless_cs_transaction`
14. `sellerpilot_service_complete_serverless_cs_shopee_history_v1`

정본 migration 밖의 credential refresh, 실제 inquiry ingest 구현과 최하위 generic job finalizer는 provider·운영 DB를 건드리지 않는 격리 side-effect fixture로 대체했다. 그러나 원자 완료 본체, continuation enqueue, completion receipt, 모든 현재 common wrapper, Shopee history event 저장, owner read RPC와 실제 GET route는 정본 구현이다.

## 같은 DB 실행 결과

| 단계 | SG `1719148844` | TW `1758392145` | Returns / Buyer Chat |
|---|---|---|---|
| history start | Product Review 1 + Returns 1 계획 | Product Review 1 + Returns 1 계획 | 총 4 job |
| lease/context | current serverless ownership 통과, `running` | 독립 claim | Buyer Chat claim 없음 |
| 첫 완료 | 후기 1건 ingest fixture, receipt 1, page event 1, continuation 1 | provider-wrapper 403, receipt 1, interruption 1 | Returns 미실행 |
| 첫 owner GET | Product Review `partial`, active checkpoint 1 | Product Review `authorization_required` 1 | Returns `pending`, Buyer Chat 행 0 |
| SG 재개 완료 | sequence 2와 input checkpoint 결속, Product Review `complete` | `authorization_required` 유지 | Returns `pending`, Buyer Chat 행 0 |
| 최종 원장 | completion receipt 3, history event 3 | 한 shop 실패가 SG 완료를 가리지 않음 | 서로 다른 kind 상태 유지 |

403은 재인증 필요 상태 증거일 뿐 해결 증거가 아니다. 이 시험은 API 403을 successful read, operational apply, 권한 복구 또는 Buyer Chat 계약 확보로 해석하지 않는다.

## 검증 결과

- 신규 canonical common completion + owner GET 시험: 1/1 통과.
- 신규 시험 + delta-005 final-chain + 실제 route 시험: 5/5 통과.
- 전체 TypeScript `tsc --noEmit`: 통과.
- 신규 시험 ESLint: 통과.
- fixture는 2개 합성 shop, 합성 후기와 합성 credential 문자열만 사용한다. 실제 비밀·고객 원문은 없다.
- frozen delta-004 SHA-256 `6c98e6bf5f26a3618155c3fef0cd78489dc69f7d1233ee263d6f32955f42261a`, frozen delta-005 SHA-256 `bbd3d3062c6a0e492098824059246b24d41e351cb3b932fc311ddf39e179463a` 불변을 다시 확인했다.

## 실제 외부 범위와 다음 행동

실제 대상 목록은 SG `1719148844`, TW `1758392145`, TH `1758392144`, MY `1758392135`, VN `1758392139`, PH `1758392137`, BR `1758392161`, MX `1758392178`; 앱은 `Couplit` app ID `228518`, live partner ID `2031489`, main account ID `4940266`이다. 이번 후속은 로컬·격리 검증이므로 provider GET 성공 shop 0, 운영 DB 반영 0, 인증 운영 웹 대조 0, 고객 답변 0이다. Buyer Chat의 실제 앱 권한·webhook/history/reply 계약도 여전히 미확보다.

다음 외부 단계는 별도 승인 아래 SG `1719148844`만 최소 read-only GET→격리 DB→인증 웹으로 대조하는 것이다. 그 결과 전에는 SG 또는 Shopee 전체를 운영 완료로 보고하지 않는다.
