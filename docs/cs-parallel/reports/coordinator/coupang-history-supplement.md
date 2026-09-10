# 쿠팡 답변 이력·복구 보완 통합

2026-09-08 delta-supplement 8개 파일은 채널 소유권/S0/통합 before/전용 after hash 대조 후 반영했다. 과거 seller observation이 현재 문의 parent/latestInbound/replyTarget를 상속하지 않게 하고, 공급자가 직접 준 parentAnswerId만 보존한다. replyContext는 비워 과거 관측을 현재 답변 대상으로 쓰지 않는다.

전용 history recovery 모듈은 기존 공통 generator를 재사용하고 기간×8scope가 온전한지 검사한다. 실패·중단은 같은 종료일 재실행, 모든 job 성공 이후만 이전 기간으로 전진한다. RPC/UI 실제 호출 연결은 아직 미완료다.

공통 reply verifier 및 8채널 최소 회귀 포함168/168 통과. /tmp/cs-coupang-history-supplement.tap. history source after18960e8afbb9588723b687432668ecbe7b65279ff77ecccaa0ea28789f5aff50. 새 recovery source after1e0332782546b9f75d0052640c592a970ad41fb175f3647df5954269f64f93f3.

수집 실제 출구, 자동 readback child enqueue, 격리 DB→인증 웹 및 최초 제공일까지 대조는 미완료. 운영 DB/실답변/커밋/푸시/배포 없음.
