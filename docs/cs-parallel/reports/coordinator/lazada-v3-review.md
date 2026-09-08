# Lazada V3 통합 검토

최종 제출 delta `0a02b66ae1b7feef010044e956b589d757b434ab48ef9370a657066a34c6dabf`의 11개 파일 after-hash 일치를 확인했다. 아직 공통 런타임과 정식 migration에는 적용하지 않았다.

## 통합 전 수정 필요

1. revision provider_context는 원문 키 denylist 삭제만 수행한다. 임의 키 또는 중첩 필드에 본문/URL이 남을 수 있으므로 필요한 scalar metadata의 명시 allowlist와 타입·길이 검사로 변경해야 한다.
2. gateway wrapper는 pending fingerprint/expiry 검증 전에 ingest를 호출한다. 불일치·만료 배치를 ingest 전에 차단하고 ticket/message/revision/job payload가 변하지 않음을 검증해야 한다. completed replay의 payload 검증 경계도 추가 확인한다.

라자다 담당 작업에 고정본 보존 및 별도 후속 delta 구현을 전달했다. 담당 보고 59/59는 통합 검증 통과로 간주하지 않는다.

운영 seller/country 인증, callback 및 signed redelivery, 실제 13 ID의 raw→DB→인증 웹 대조, 승인 대상 답변/readback, Product Review 권한과 reverse-order CS는 별도 미완료 항목이다.

## 후속 리뷰 검증

후속 delta `0e0ec4f3a9d20e4bf86c94baeb29bc59376e6c51b308761d5b0b9c47d4db5ba1` 및 5개 after-hash 일치를 직접 확인했다. SQL 최신 hash는 `b67d6901906ea6022471ba124520ae3a83a17e0708866ede8ab706dd9ddbeed7`이다.

원문 키 denylist를 타입·길이 제한 scalar allowlist로 바꾸고, pending batch 검증을 ingest 앞으로 이동한 것을 코드에서 확인했다. 담당 전용 폴더에서 V3 DB 8개 + runtime patch 2개 시험을 직접 실행해 10/10, skip0, exit0을 확인했다. 지적한 두 반례의 로컬 수정 검증은 통과했다.

Completed replay는 receipt 기반 기존 완료 확인이며 현재 입력 payload는 무시한다. 응답에 replayPayloadIgnored와 replayBasis를 명시한다. 새 payload 적용이나 digest 동일성 증명으로 해석하지 않는다.

정식 migration/통합 runtime 적용은 아직 미완료다. parser2 및 공통 파일의 실제 preimage 대조 후 합쳐야 한다.
