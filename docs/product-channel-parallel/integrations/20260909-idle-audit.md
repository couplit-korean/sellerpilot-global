# 상품등록 대기 작업 점검 — 2026-09-09

최초 live 조회는 8개 중 3개 active, 5개 idle이었다. Shopee와 eBay는 제출 이후 중앙 통합 대기, SmartStore와 Coupang은 신규 상품 입력 대기, Qoo10은 이후 직접 사용자 지시로 기존 상품 UPDATE 전용 재지정 상태였다.

## 실제 처리

- Shopee006: exact SG route/RPC 연결 수정안과 호출 경로 검증을 담당의 격리된 scratch에 배정했다. 중앙은 같은 route/RPC를 동시에 편집하지 않는다. 실행 상태를 확인했다.
- eBay005: 동결 진단 4파일의 before/after SHA를 확인해 중앙 로컬에 적용했다. HTTP200+errors 응답을 성공으로 오인하지 않는 수정이다. 실제 OAuth 진단 CLI는 실행하지 않았다.
- eBay005, durable refresh, Shopee helper 묶음 17/17, 비증분 TypeScript, 변경 6파일 ESLint 통과. 업무 교차 의존 6종 모두 0, 채널 교차 의존 0. 전체 빌드는 이번에 반복하지 않았다.
- 11번가: 기존 API GET 성공 보고를 접수했으나 seller_id=sample과 의도 계정 couplit 불일치가 발견됐다. 값을 덮어쓰지 않고 attestation/CREATE 검증 경로의 코드 추적 및 필요 수정안을 배정했다.
- 최종 live 조회: Shopee/Lazada/Temu/11번가 active, eBay/SmartStore/Coupang/Qoo10 idle. 조회 이후의 지속 실행을 보장하는 기록은 아니다.

## 대기 사유와 다음 담당

- eBay005 중앙 코드 통합 대기는 해소했다. 실제 영문 문안·이미지·USD 가격·반품정책 선택이 남았다. 중앙이 승인된 입력을 확정해 단일 실행자를 배정한다.
- SmartStore/Coupang은 현재 신규 검증용 상품 및 승인값이 없다. 기존 SKU 중복 CREATE로 대기를 해소하지 않는다.
- Qoo10의 현재 작업은 `/Users/kimchangheemac/dev/sellerpilot-channel-qoo10`, branch `codex/channel-qoo10`, 중앙 `01a075d8-40c6-7102-a7e3-526de202bcb4`의 C02 기존 상품 UPDATE 전용이다. 담당의 계보 확인 기록은 `6f3bc64`다. 과거 product worktree 보고는 동결 제출 수집용으로만 보존하며 신규 CREATE 명령을 보내지 않는다.

이번 적용은 로컬 미커밋 상태다. provider 등록, credential 회전, 운영 SQL, 배포는 수행하지 않았다. accepted 19/48, 현재 통합본 신규 CREATE+readback 0/8은 유지한다.

## 후속 재검토 — 대기 정당성 판정 정정

대기 원인이 확인됐다는 사실만으로 독립 개발이 없다고 판단하면 안 된다. 특히 Qoo10 C02 원본에는 common/source RPC/collector 미구현과 미통합 제출 3건, 검사 355/356이 남아 있었다. 작업 범위 변경만 설명하고 이 중앙 의존성을 빠뜨린 이전 설명을 정정한다.

- SmartStore 담당: 신규 실상품 없이 가능한 실제 React 입력→초안 저장/복원→서버 route→adapter 연결 검증. 이미 동일한 실제 경로 증거가 있으면 중복 테스트를 만들지 않고 증거를 제출한다.
- eBay 담당: 실제 정책·USD 가격·이미지 선택의 저장/복원 및 시장 전환 후 stale 값 차단 검증. 기존 소스 regex 검사와 실제 컴포넌트/서버 실행 검증을 구분한다.
- Coupang 작업에 지정된 C02 중앙: 최신 직접 사용자 범위·소유권 확인 후 별도 scratch에서 Qoo10 common/source RPC/collector/caller 연결 로컬 수정안 작성. 다른 중앙의 공유 파일이나 운영 상태를 직접 변경하지 않는다.
- Qoo10 담당: C02 범위를 유지하며 남은 검사 1실패를 실제 호출 경로와 대조하고, 사후 QSM 증거와 완료 처리 검증의 누락을 확인한다. provider 호출을 반복하지 않는다.

위 4개 작업에 단순 재개가 아닌 구체 산출물을 배정했고, 모두 active/inProgress로 전환된 것을 묶음 상태 조회로 확인했다. 이 기록은 실등록 완료나 지속 실행 보장이 아니다.

11번가002 보고에서 seller_id=sample이 기존 CREATE 사전 검사를 통과한다는 반례를 접수했다. 정확히 관측된 placeholder를 차단하는 최소 방어 2파일을 before/after SHA 검증 후 중앙 로컬에 적용했다. 이는 임의의 다른 seller ID를 provider가 검증했다는 증명이 아니며 일반 계정 결속은 별도 미완료다. 운영 seller_id를 추정 변경하지 않았다.
