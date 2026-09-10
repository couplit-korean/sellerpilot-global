# Lazada 최종 실패 집계 수정

첫 delta 전체는 아직 미통합이다. supplemental-delta의 current source/test after hash를 확인하고 통합본 preimage와 비교했다. 전체 diff에서 parser/2 전환은 제외하고 completion RPC 상태를 보존하는 수정 및 attempt-5 회귀를 선택 반영했다. 통합본 parser/1은 유지했다. 따라서 담당 after hash와 통합 after는 의도적으로 다르다.

최종 failed는 retried가 아니라 failed로 집계한다. unsupported/normalized도 completion 실제 상태와 일치할 때만 집계한다. /tmp/cs-lazada-retry-status.tap에 통합 회귀 결과를 기록했다.

parser/2 official/system/recall과 lazada_ingest_v2 불일치가 남아 있으며 lazada-005 V3 설계는 미반영이다. 이 변경으로 remote13/DB0/web0 차단이 해결됐다고 보고하지 않는다. 전용 폴더/운영 DB/배포/커밋/푸시/실답변 변경 없음.
