# SmartStore 보완002 리뷰 — 통합 보류

2026-09-08 제출 manifest 및 전용 소스 검토. order-binding-projection의 rawIds.map(string).filter(Boolean)가 invalid 원소를 제거하여 유효ID+null/빈문자열 혼합을 exact 자동연결 가능으로 승격할 수 있다. 담당에게 모든 원소 타입/형식/중복 검증과 반례를 요청했다. 보완002의11개 파일은 아직 복사하지 않았다.

snapshot verifier의 auth200/401은 입력값 비교이며 실제 인증 웹 접근 시험이 아니다. ledger 비교도 계정/기간 provenance 결속을 요구했다. 이 fixture 통과를 실원격→DB→웹 완료로 보고하지 않는다.

담당 작업을 다시 실행시켜003/004의 실제 SQL초안/공통patch/격리DB시험을 전용proposals에서 계속 구현하도록 요청했다. 공통 소유권/운영변경금지 유지. 기존 통합본은 변경하지 않았다.
