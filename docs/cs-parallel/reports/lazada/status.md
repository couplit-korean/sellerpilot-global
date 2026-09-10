# Lazada CS 상태

- 시각: 2026-09-08 19:23:21 KST
- S0 ID: `S0-20260908-decaba426812a3ba`
- S0 소스/HEAD: `3cb72144e991626fae98a30cf51022d9a1aa6b0b`
- S0 검증: manifest 1,628/1,628, missing 0, mismatch 0, unexpected deleted 0
- 전용 작업폴더: `/Users/kimchangheemac/dev/sellerpilot-cs-lazada`
- 브랜치/포트: `codex/cs-lazada-v1` / `3216`
- 소스 변경분 manifest: `docs/cs-parallel/reports/lazada/delta.json`
- 실제 seller/app/country/shop 범위: seller `MY4N...ISR2D`, country `MY`, Commerce app `137451`, CS Bot IM app `137571`, 선택한 official IM session 1개
- 비밀/실고객 원문 없는 증거 경로: `actual-grant.json`, `message-reconciliation.json`, `raw-reprocess-card-attachment.json`, `reply-observation.json`, `local-verification.json`
- 이번에 닫은 정확한 기능: 실제 CS Bot token의 session/message read grant, 선택 세션 13개 remote ID의 DB·웹 count 대조, official/unknown/auto-reply template 보수적 role 처리, explicit seller role 보존, recall revision과 body/attachment conflict 구분, review/after-sales 잔여 scope inventory, 필수 로컬 반례

## 첫 실제 결과

CS Bot 전용 token으로 `/im/session/list`와 선택 session의 `/im/message/list`가 각각 HTTP 200/provider code 0을 반환했다. Commerce/IM app과 access token fingerprint는 서로 달랐다. 선택 session은 message pagination 종료까지 13개 고유 ID였지만 운영 DB에는 ticket/message가 0개, SellerPilot 웹에도 0개였다. 따라서 실제 IM 읽기 grant는 증명됐지만 연결·수집 완료는 아니다.

선택 session은 Lazada Seller Center에서 `official`로 표시됐고 원격 13개가 모두 `template_id=200016`이었다. 이 template은 조사한 공식 IM template 목록에서 확인되지 않았다. 이번 parser는 이를 답변 가능한 customer로 확정하지 않고 system/미확정 event로 보존한다. 이는 source field를 지우는 것이 아니라 오답 방지를 위한 보수적 projection이다.

| 게이트 | 상태(미착수/진행/통과/외부조건 대기/해당 없음) | 증거 | 남은 행동 |
|---|---|---|---|
| G1 범위·권한 | 진행 | CS Bot app 137571의 IM read grant와 access/refresh 만료 확인. Commerce app 137451과 분리됨. 다만 `provider_account_subject`/`country_user_info`가 없고 binding source가 `legacy_unattested` | `lazada-001` 반영 후 provider-certified seller/country binding 재발급·readback |
| G2 로컬 경로 | 진행 | Node 22 테스트 108/108, tsc/lint 통과, Next UI HTTP 200·overlay/error 0. 격리 브라우저는 인증값이 없어 로그인 화면까지 | 통합 DB migration을 격리 환경에 적용하고 인증된 raw/quarantine/card UI를 재검증 |
| G3 실제 읽기 | 통과 | MY session-list 1행과 선택 session 13개 메시지 전량 pagination 성공. 401/403 아님 | `has_more=true`인 account-wide session continuation은 durable bootstrap 배포 뒤 진행 |
| G4 과거·웹 대조 | 진행 | 선택 session remote 13 / DB 0 / SellerPilot web 0, remote-only gap 13 | durable ledger·bootstrap을 배포한 격리/운영 승인 단계에서 같은 ID로 재대조 |
| G5 신규 수신 | 외부조건 대기 | CS Bot Push callback 공란, 7개 group 모두 미선택. 공개 webhook/DB 변경 안 함 | `lazada-001`, `lazada-003` 뒤 signed Verify 200과 재전달 시험, 이후 IM group만 활성화 |
| G6 답변 관측 | 외부조건 대기 | 승인된 실제 ticket/text 없음, 운영 ticket 0, observation table 없음. 격리 DB reply/readback 반례 4/4 통과 | 승인 ticket/text와 observation ledger 준비 후 1회 send→동일 session seller echo 확인 |
| G7 복구 | 진행 | ACK 전 저장 실패, ACK 뒤 lease 재처리, 중복 claim, 256KB, 5,000행, TTL, attachment URL-only/만료 반례 통과 | 운영 table 부재 해소 뒤 실제 receipt crash/replay와 웹 표시 관측 |
| G8 운영 적용 | 외부조건 대기 | 커밋·푸시·배포·운영 DB/webhook 변경을 하지 않음 | 통합 담당이 exact preimage/ACL로 proposals 001~004를 순서대로 검토·반영 |

## scope별 분모

| account/shop/kind/상태/폴더 | from/to·timezone | 원격 고유 ID 수 | 정상 | 중복/기존 | 격리 | 근거 있는 제외 | 미처리/gap |
|---|---|---:|---:|---:|---:|---:|---:|
| MY masked seller / official IM / 선택 session | 2026-04-30T05:11:25.195Z ~ 2026-09-03T06:00:28.177Z / UTC | 13 | 0 | 0 | 0 | 13 (customer 문의 분모에서만 제외; system/미확정 timeline 대상) | 13 (운영 DB/web 미투영) |
| MY masked seller / IM / account-wide session list | 조회시점 ~ provider continuation / UTC | unknown | 0 | 0 | 0 | 0 | unknown (`has_more=true`, 첫 page 1행만 읽음) |
| PH/SG/TH/VN whitelist seller / IM | unknown | unknown | 0 | 0 | 0 | 0 | unknown (seller/token binding 미확인) |
| MY / product review | provider 보유기간 unknown | unknown | 0 | 0 | 0 | 0 | unknown (공식 read/reply 계약 존재, 앱 permission 미확인) |
| MY / reverse-order after-sales | provider 보유기간 unknown | unknown | 0 | 0 | 0 | 0 | unknown (Commerce permission Active, CS 구현 없음) |

`정상`은 답변 가능한 customer inquiry만 센다. official/system event 13개는 raw/timeline 보존 대상이며 손실로 제외한 것이 아니다. 한 session의 API 반환 범위가 4개월을 넘었어도 account-wide 과거 전체로 부르지 않는다.

## 검증

| 명령 | source hash | 환경 | exit code | 통과/실패 | 로그 |
|---|---|---|---:|---|---|
| Node 22 `--import tsx --test` canonical 17 files + `cs-lazada-scope-inventory` | `delta.json`의 9개 code/test hash | local + ephemeral isolated PostgreSQL fixtures | 0 | 108/108, skip 0 | `local-verification.json` |
| `tsc --noEmit` | S0 이후 worktree | Node 22 | 0 | 통과 | `local-verification.json` |
| ESLint owned modified files | `delta.json`의 9개 code/test hash | Node 22 | 0 | 통과 | `local-verification.json` |
| Next 16.3.1 dev `--webpack -p 3216` + browser verify | S0 이후 worktree | localhost, isolated no-env | 0 | HTTP 200, overlay 0, console error 0 | `local-verification.json` |
| actual CS Bot read-only probe | CS Bot app 137571/token fingerprint only | production provider + production DB read-only | 0 | session/message read 성공 | `actual-grant.json`, `message-reconciliation.json` |

## 공식 계약과 판매자 화면 조사

- IM 계약: `/im/session/list`, `/im/message/list`, `/im/message/send`, `/im/session/get`, `/im/session/read`, `/im/message/recall`; page size 최대 20, `has_more`와 `next_start_time`/last ID continuation, 같은 session/message ID update semantics가 있다. 공식 문서는 인증 후 historical sync를 최근 1개월, 최대 3,000 session 및 session별 최근 1개월로 권고하므로 그 창 밖은 공급자 결과로 실제 확인될 때만 범위에 넣는다.
- Push 계약: raw body 앞에 app key를 붙인 HMAC-SHA256, HTTPS callback, 500ms 안에 HTTP 200, 실패 시 최대 30분/12회 재전달의 at-least-once 계약이다. 현재 콘솔 callback과 group은 비어 있어 새 수신 증거가 없다.
- 리뷰: 공식 read `/review/seller/list`, 승인 reply `/review/seller/reply/add`, review notification type 21이 존재한다. 현재 Commerce 앱 permission 화면에서 Product Review group은 보이지 않아 `permission_pending`이다.
- 사후지원: 공식 reverse-order read endpoint들과 push type 10이 존재하며 Commerce 앱의 Reverse Order Management는 Active다. cancel/return/refund/reject mutation은 별도 주문/반품 권한이므로 이번 CS read 범위에서 제외한다.
- 판매자 메뉴에는 Chat, Reviews, Reverse Orders가 보였고 Seller Center IM 목록은 official conversation 1개/unread 13이었다. unread mutation을 피하려고 대화 row는 열지 않았다.

## 구현 완료·대기·복구 불가

- 구현 완료: official session tag 보존, known template 10011/10015, unknown template/type fail-closed role, recall revision convergence, changed body/attachment conflict, supplemental review/after-sales inventory, parser v2, 관련 반례.
- 운영 증명 대기: signed Push receipt, raw 저장/ACK, crash 뒤 동일 receipt 재처리, 실제 quarantine/raw/card/attachment UI, 승인 reply provider 접수와 seller echo.
- 외부 권한/계약 부족: provider-certified seller/country identity, Product Review permission, PH/SG/TH/VN seller/token lineage.
- 복구 불가 기간: 아직 확정하지 않았다. 공식 historical bootstrap 권고 창 밖 자료의 export/backup 존재 여부와 durable account-wide continuation을 확인하기 전에는 `unknown`이다.

## 다음 행동

- 지금 가장 먼저 해야 하는 단일 행동: 통합 담당이 `lazada-001`의 IM token/seller binding과 `lazada-003`의 durable raw ledger를 격리 DB에 exact preimage로 적용하고, 동일 MY session 13개 ID를 bootstrap→DB→인증 웹에서 재대조한다.
- 공통 변경 요청 ID: `lazada-001`, `lazada-002`, `lazada-003`, `lazada-004`
- 외부 선행조건과 필요한 사실/자료: provider-certified MY seller subject/country overlay, Product Review permission 결정, 승인된 reply ticket/text, 공개 route 배포 승인
- 전체 자동연동 제한: IM read grant만 실제 확인됨. Push·운영 저장·웹 투영·실답변·리뷰·사후지원은 완료가 아니다.

## 공식 출처

- IM API: <https://open.lazada.com/apps/doc/doc?docId=120971&nodeId=10544>
- Push mechanism: <https://open.lazada.com/apps/doc/doc?docId=120168&nodeId=29524>
- Seller authorization/token binding: <https://open.lazada.com/apps/doc/doc?docId=108260&nodeId=10777>
- Review/reverse-order endpoint overview: <https://open.lazada.com/apps/doc/getting_started>
- Review notification type 21: <https://open.lazada.com/apps/doc/doc?docId=120982&nodeId=30756>
- Reverse-order notification type 10: <https://open.lazada.com/apps/doc/doc?docId=120232&nodeId=29537>
