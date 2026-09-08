# 쿠팡 첫 로컬 통합 — 2026-09-08

쿠팡 담당의 수정 제출을 검토하고 S0 delta 8개 파일을 통합했다. source snapshot ID, 채널별 소유권, 모든 before/after SHA-256이 일치한 뒤 제출된 바이트만 복사했다. 전용 작업 폴더는 수정하지 않았다.

- 콜센터 단건 GET 경로 및 30행 목록 제한.
- 최신 inbound와 유일한 actionable parent 결속 및 단건 응답 정규화.
- 날짜를 확정할 수 없는 positive answerId의 csAgent/vendor reply는 reply_sequence_unresolved로 차단. 요청했던 undated inbound/vendor 반례 포함.
- contact-center.ts hash: c33be610cb7d892f1bd78f9e90e0620f9be851d35d1c1687f7284d4fe0e6737f.
- 전용 시험 hash: d23c2f81e8cb5dec94d23f3537ecbec4ed3df6e89df167fdfcb2a9c383f110f6.
- 쿠팡 전용 + 공통 gateway/pagination + 나머지 7채널 최소 회귀 116/116 통과. 로그 /tmp/cs-coordinator-coupang-integrated.tap.

전용 보고서/proposals는 제출 상태 그대로 보존했으므로 거기 기록된 공통 11번가 실패는 제출 당시 결과다. 현재 통합본에서는 기대값 수정 후 통과했다.

실제 읽기 출구, DB replay, 이력/웹 대조, 원격 답변 관측은 이 시험으로 입증되지 않는다. 이관 확인 전송과 운영 route 등록도 실행하지 않았다. 쿠팡 전체 완료 아님.

다음 작업은 미반영 Shopee delta 리뷰/통합 및 최신 continuation DB wrapper의 격리 replay다. 쿠팡 추가 공통 요청은 proposals/coupang 아래 보존했다. 커밋/푸시/배포/운영 변경 없음.
