# Lazada 인증 raw/quarantine 웹 관측 상태

- 시각: 2026-09-08 22:55:00 KST
- 기준 후속 delta: `0e0ec4f3a9d20e4bf86c94baeb29bc59376e6c51b308761d5b0b9c47d4db5ba1`
- 결과: 실제 admin helper + exported raw/quarantine GET + V3 PGlite projection 25/25 통과
- production source patch: 필요 없음

## 확인 결과

- system: V3 DB `sender_role=system`, raw GET `normalized`, UI exact raw 표시.
- recall: V3 DB `eventKind=recalled`, raw GET `normalized`, UI exact raw 표시.
- conflict: V3 DB partial/quarantine, raw GET `pending`, quarantine GET `reason=conflict`와 정확한 원문, UI 충돌 label 표시.
- GET은 actual `authenticateAdminRequest`를 거쳐 `userClient.rpc`만 사용했다.
- 무 token 401, 만료 token 401, 다른 owner 비관리자 403이며 read RPC는 실행되지 않았다.
- 잘못된 credential의 raw mark와 seller lineage가 다른 V3 ingest는 각각 DB에서 거부됐다.
- private raw/revision table은 anon/authenticated/service role 모두 직접 읽을 수 없다.

승인 관리자와 데이터 creator가 다른 것은 공유 CS 운영 workspace의 정상 계약이다. 이 경우까지 거부하면 현재 관리자 운영 모델을 깨뜨린다. 대신 비관리자, credential, seller lineage를 경계로 검증했다.

raw inbox는 normalized semantic timeline이 아니라 exact original과 lifecycle 화면이다. history page receipt에는 여러 native event가 들어갈 수 있으므로 explicit receipt/revision lineage 없이 system/recall badge를 새로 추론하지 않았다. 현재 요구된 raw 원문·상태와 quarantine conflict 표시는 정확했다.

## 남은 운영 조건

- V3 SQL은 아직 proposal이며 운영 DB에 적용되지 않았다.
- 실제 signed Push receipt와 운영 인증 웹 관측은 아직 없다.
- 선택 official session 13개 remote→raw→DB→web 재대조와 승인 reply echo가 남아 있다.
- 로그인 완료는 이 운영 적용·관측을 대신하지 않는다.
