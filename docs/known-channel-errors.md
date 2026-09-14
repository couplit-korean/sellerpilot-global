# 확인된 채널 오류와 재작업 금지 기준

2026-09-14 12:39 KST 사용자 지시: 이미 확인한 오류를 기억하고 같은 원인 조사를 반복하지 않는다. 이 문서의 완료/미완료 상태와 최신 실행 증거를 먼저 읽는다. 과거 로그의 실패를 현재의 새 실패로 발표하지 않는다.

| 오류 | 이미 확인한 원인·결정 | 현재 남은 조치 | 반복하지 않을 작업 |
| --- | --- | --- | --- |
| Shopee `source_ip_undeclared` | Vercel 동적 송신 IP 제한. 기존 승인된 Mac 경로 사용 | 160000 운영 적용 완료. `shops.get`은 승인된 Mac 경로로 변경, Vercel 실행 차단. 다음은 현재 SG 숍 조회·카테고리 확인 | 새 원인 조사, Vercel 재시도, 바뀌는 Vercel IP 추가, 새 로그인/OAuth |
| Shopee SG 갱신4a45f463 | 공식 API 로그 요청e3e3e7f35b66e2a3e590809314fc7700, 2026-09-14 00:55:07 UTC, HTTP403, 송신16.184.44.4. 해당 요청 발급 전 거절 확인 | 160000에서 원본 job/target claim과 거절 증거 보존·표시 정리 완료. 기존 정상 v91 SG 토큰 재사용 | 증거 없는 토큰 갱신 재실행, 다른 미확정 기록 일괄 해제 |
| eBay c9d6431c 갱신 표시가 신규 요청 차단 | 현재 v211 동일 판매자 GetUser 검증·저장 audit586은 이미 완료. 과거 표시만 남음 | 161000 운영 적용·원문MD5검증, rollback 확인 후 audit588로 해소 완료. 004aff8e의 claim 응답 오류도162000/a1fa712로 수정 완료. 이후 실제 Inventory API 설명 길이 거절은 별도 오류로 기록 | 신규 CREATE 중복 전송, 과거 CS를 성공 처리, 표준 AI 상품을 외부 상세 전용 local 경로로 강제 이동 |
| 국내 배송비0과 채널 요금 불일치 | 사용자가 배송3000/반품3000/교환6000 승인. 원본 배송비 편집 경로와11번가 유료 배송 필드 누락 | f2d75c6 운영 반영·Aside 화면 저장 완료. 국내 3채널 배송3000 및 확인된 반품/교환 조건 저장; 아래 최신 실행 기록 참고 | 비용 승인 재질문, 0원을 무료배송 승인으로 처리 |

기존 조회/저장/토큰 검증 성공은 다시 수행할 목록이 아니다. 재검사는 수정된 경로나 유효기간 만료 등 구체적인 새 근거가 있을 때만 한다. 실제 신규 게시, 작업 접수, 로컬 검사, 배포 완료를 구분한다. 후속 결과가 나오면 해당 행의 남은 조치만 갱신한다.

## 이력: 2026-09-14 12:47 KST — eBay claim 응답 필드 누락 (13:15 수정 완료)

`EBAY_CREATE_CLAIM_INCARNATION_UNAVAILABLE`는 토큰/IP 문제가 아니다. f697 운영 `/api/channel-gateway/worker/claim` HTTP200 (03:36:57.394 UTC, request `qfgqt-1789357017394-22ee38d44634`) 직후 Mac에서 실패했다. 현재 job `004aff8e-7f0c-4c8e-bff5-ac75b395b2cb`, health 오류시각03:36:58.572 UTC, active0, provider mutation/stage receipt0이다.

`gatewayClaimSchema`에 `attempt_id`, `credential_version`, `credential_fingerprint`가 없어 safeParse 응답에서 제거되고, Mac의 `attachEbayCreateClaimIncarnation`이 실제 작업 실행/heartbeat 이전에 거부한다. 같은 요청의 정상 전달만 수정한다. 기존 GetUser/정책/API토큰 검증, IP 조사, 새 CREATE는 반복하지 않는다. 현재 수정·집중 회귀 진행 중이며 운영 반영 전이다.

Shopee 문의 완료 HTTP400 로그는 위 IP403과 다른 현상이다. 현재 로거에 job ID/시각이 없어17ff 작업의 오류로 단정하지 않는다.17ff는03:44:57 UTC 자동 재수령되어attempt4/lease03:59:57로 관측됐다. 160000의 실행 중 보호를 우회하지 않고 적용 전 종료 상태를 확인한다.

## 2026-09-14 13:15 KST — 실제 실행 후 남은 항목

- 운영 웹·DB active release·Mac gateway: `a1fa71283c2bfaa20662ce502deb368bf453c383`, Vercel `dpl_4Qz9JZLoSoCKFjQ2KjwKjzwMvST9`. 후보6/운영6 canary 및 Mac ready 확인. DB162000 원문MD5 `b37b1446d4c0eed80d5e08452514d64a` 일치.
- eBay 응답3필드 누락 수정은 실제 전달 통과했다. 004aff의 전송 전 실패를 정확한 request/attempt/credential/원행 및 stage0 근거로 감사하고 배포 후 **동일 job**을 재개했다. 이력은 /tmp/sellerpilot-ebay-noexec-pause-apply.sql 및 -resume-apply.sql, 각 rollback/result에 있다.
- 재개 후 eBay Inventory 실제 API가 `25718`, description 1..4000자 제한으로 거절했다. Gateway 작업 succeeded는 처리 완료일 뿐이며 상품 listing은 failed, 실제 신규게시0/8. 승인된 Offer 상세 HTML은 유지하고 Inventory에만 결정적 일반 텍스트를 적용하는 수정70개 검사 통과, 아직 배포 전.
- 국내 비용은 Aside에서 저장했다. 초안v69에서 쿠팡/11번가/스마트스토어 원화 배송3000, 각 채널 유료배송3000 일치. 11번가와 스마트스토어 반품3000/교환6000 저장. 이후 쿠팡 수동 반품편도3000·기존CJGLS를 입력했다. 비용 재승인 질문 금지.
- 스마트스토어 등록 전 차단: source `1e70b988...`가02:30:16UTC 만료됐고 product_updated_at도달라 snapshot null. 계정/credential/category50002253/속성누락[]/상세digest는 정상이다. 150000·source 저장 버그 재작업 금지. 같은 카테고리의 근거를 새로 조회·저장해야 한다.
- 11번가 승인 차단: active credential v2의 seller_id가임시값 `sample`. 키/복호화/권한/소유자 문제 아님. 공식 Aside SellerOffice 로그인 `couplit`, 현재 공지의 점검은9/17 02:00~05:30(현재9/14아님)으로 확인. 기존 키를 보존하고 공식 seller_id만기존수정경로로정정해야 한다. 새키/로그인/digest위조 금지.
- Shopee는04:00:24UTC 정상기존읽기에서v91로SG토큰 갱신·저장 완료, SG만료08:00:21UTC. 추가갱신요청불필요. 160000은이정상동일판매자승계를재사용하도록수정중. 과거403과정상v91, 현재문의결과저장400을섞어보고하지않는다.

### Shopee 경로 수정 운영 적용 완료

2026-09-14 DB160000 적용 및 원문MD5 `5ecd163c74a65688b73feac7b15eb32c` 검증 완료. 기존 거절 기록과 정상 v91 성공 기록 보존, local shops.get 경로1개 및 현재credential 승인경로5개 확인, serverless shops.get=false. 실제 갱신 시작과 같은 전역잠금으로 경쟁을 막고 정상 문의 read만 허용한다. 정적guard원인 재조사는 끝났으며 source_ip 문제를 다시 발견한 것으로 보고하지 않는다. 다음은 현재SG숍 정보조회·카테고리/필수입력, 실제등록 결과검증이다.

## 2026-09-14 13:29 KST — 후속 실행 기록

- SG `shops.get` 요청 `39c870a8-2ab1-4c73-b859-a2d0b7f2a107`은 현재 v91로 기존 Mac 큐에 접수됐고 attempt0/queued다. 새 IP 거절이나 새 토큰 갱신이 아니다. 동일 POST를 반복하지 않고 이 작업의 결과를 확인한다. 화면의 동기화 응답은 대기 결과를 완료 검증에 넣는 경로인지 별도 검토 중이다.
- SmartStore 공식 속성 재저장 완료 후 이전 카테고리 source 오류는 통과했다. 다음 TS 상태 검증이 `active`만 허용하여 정상 승인된 `draft`를 거절했다. 운영 DB의 `draft|active` 계약과 맞추는 두 파일 수정 중이며, 상품 상태를 강제로 바꾸거나 DB source 함수를 다시 수정하지 않는다.
- eBay 설명 길이 수정 `15be328`은 후보 배포 READY/무실행 canary6 통과. SmartStore의 위 수정과 함께 운영 반영하기 위해 아직 promote하지 않았다. 현재 운영은 `a1fa712`다.
