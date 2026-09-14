# 확인된 채널 오류와 재작업 금지 기준

2026-09-14 12:39 KST 사용자 지시: 이미 확인한 오류를 기억하고 같은 원인 조사를 반복하지 않는다. 이 문서의 완료/미완료 상태와 최신 실행 증거를 먼저 읽는다. 과거 로그의 실패를 현재의 새 실패로 발표하지 않는다.

| 오류 | 이미 확인한 원인·결정 | 현재 남은 조치 | 반복하지 않을 작업 |
| --- | --- | --- | --- |
| Shopee `source_ip_undeclared` | Vercel 동적 송신 IP 제한. 기존 승인된 Mac 경로 사용 | `shops.get`만 cloud 허용·local 목록에서 누락. 160000/TS 수정·13개 검사 완료, 운영 rollback은 실행 중 문의17ff7850 보호 조건으로 차단. 아직 운영 적용 전 | 새 원인 조사, Vercel 재시도, 바뀌는 Vercel IP 추가, 새 로그인/OAuth |
| Shopee SG 갱신4a45f463 | 공식 API 로그 요청e3e3e7f35b66e2a3e590809314fc7700, 2026-09-14 00:55:07 UTC, HTTP403, 송신16.184.44.4. 해당 요청 발급 전 거절 확인 | 위160000에서 원본 job/target claim+거절 증거 보존 후 해당 표시만 정리 | 증거 없는 토큰 갱신 재실행, 다른 미확정 기록 일괄 해제 |
| eBay c9d6431c 갱신 표시가 신규 요청 차단 | 현재 v211 동일 판매자 GetUser 검증·저장 audit586은 이미 완료. 과거 표시만 남음 | 161000 운영 적용·원문MD5검증, rollback 확인 후 audit588로 해소 완료. 신규004aff8e 요청은03:36:57 UTC Mac claim 후 아래 응답 계약 오류로 제공자 실행 전 중단 | 신규 CREATE 중복 전송, 과거 CS를 성공 처리, 표준 AI 상품을 외부 상세 전용 local 경로로 강제 이동 |
| 국내 배송비0과 채널 요금 불일치 | 사용자가 배송3000/반품3000/교환6000 승인. 원본 배송비 편집 경로와11번가 유료 배송 필드 누락 | f2d75c6 수정·85개 검사·후보 canary6 통과. 운영 배포/화면 저장 미완료 | 비용 승인 재질문, 0원을 무료배송 승인으로 처리 |

기존 조회/저장/토큰 검증 성공은 다시 수행할 목록이 아니다. 재검사는 수정된 경로나 유효기간 만료 등 구체적인 새 근거가 있을 때만 한다. 실제 신규 게시, 작업 접수, 로컬 검사, 배포 완료를 구분한다. 후속 결과가 나오면 해당 행의 남은 조치만 갱신한다.

## 2026-09-14 12:47 KST — eBay claim 응답 필드 누락

`EBAY_CREATE_CLAIM_INCARNATION_UNAVAILABLE`는 토큰/IP 문제가 아니다. f697 운영 `/api/channel-gateway/worker/claim` HTTP200 (03:36:57.394 UTC, request `qfgqt-1789357017394-22ee38d44634`) 직후 Mac에서 실패했다. 현재 job `004aff8e-7f0c-4c8e-bff5-ac75b395b2cb`, health 오류시각03:36:58.572 UTC, active0, provider mutation/stage receipt0이다.

`gatewayClaimSchema`에 `attempt_id`, `credential_version`, `credential_fingerprint`가 없어 safeParse 응답에서 제거되고, Mac의 `attachEbayCreateClaimIncarnation`이 실제 작업 실행/heartbeat 이전에 거부한다. 같은 요청의 정상 전달만 수정한다. 기존 GetUser/정책/API토큰 검증, IP 조사, 새 CREATE는 반복하지 않는다. 현재 수정·집중 회귀 진행 중이며 운영 반영 전이다.

Shopee 문의 완료 HTTP400 로그는 위 IP403과 다른 현상이다. 현재 로거에 job ID/시각이 없어17ff 작업의 오류로 단정하지 않는다.17ff는03:44:57 UTC 자동 재수령되어attempt4/lease03:59:57로 관측됐다. 160000의 실행 중 보호를 우회하지 않고 적용 전 종료 상태를 확인한다.
