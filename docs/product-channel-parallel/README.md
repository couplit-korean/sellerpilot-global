# 0번 중앙 + 8채널 상품등록 병렬 실행

사용자 지시에 따라 2026-09-09 기존 8개 작업을 재배정해 실행했다. 시작 기준은 `e8d821587a29933aebf31771672e56f515995245`이다. 과거 상품 복구 예외를 제거한 최신 구조를 사용한다.

0번은 이 정본 작업 폴더와 작업 ID `01a077b1-61db-7c20-a4a3-ae00dbbbef19`에서 공통 코드 통합·검증을 담당한다. 기존 상품등록 중앙 작업은 쿠팡 전담으로 전환했다. CS 전담 작업들은 재개하지 않았다. 상세 ID/폴더/브랜치/cursor는 [소유권 원장](ownership.json)을 따른다.

| 번호 | 작업 이름 | 채널 | 전용 폴더 |
|---|---|---|---|
| 1 | 1번 상품등록 · Shopee | shopee | /Users/kimchangheemac/dev/sellerpilot-product-shopee-20260909 |
| 2 | 2번 상품등록 · Lazada | lazada | /Users/kimchangheemac/dev/sellerpilot-product-lazada-20260909 |
| 3 | 3번 상품등록 · Temu | temu | /Users/kimchangheemac/dev/sellerpilot-product-temu-20260909 |
| 4 | 4번 상품등록 · 스마트스토어 | smartstore | /Users/kimchangheemac/dev/sellerpilot-product-smartstore-20260909 |
| 5 | 5번 상품등록 · 쿠팡 | coupang | /Users/kimchangheemac/dev/sellerpilot-product-coupang-20260909 |
| 6 | 6번 상품등록 · 11번가 | elevenst | /Users/kimchangheemac/dev/sellerpilot-product-elevenst-20260909 |
| 7 | 7번 상품등록 · Qoo10 | qoo10 | /Users/kimchangheemac/dev/sellerpilot-product-qoo10-20260909 |
| 8 | 8번 상품등록 · eBay | ebay | /Users/kimchangheemac/dev/sellerpilot-product-ebay-20260909 |

## 모델과 사이드바

사용자 최신 지정에 따라 1~8번은 모두 `gpt-5.6-sol`, 추론 `high`로 후속 실행 설정을 전달했고 8건 모두 접수됐다. 0번은 기존 모델을 유지한다. 재개 메시지에는 모델/추론 값을 생략하면 각 작업의 설정이 유지된다. 모델을 다시 임의 변경하지 않는다.

사이드바 `상품등록 · 0~8번` 섹션에 0~8번 작업을 번호순으로 배치했다. 새 작업을 만든 것이 아니라 기존 작업을 이동했다.

## 현재 증거

최신 중앙 통합과 잔여 작업은 [2026-09-09 세 번째 검토](integrations/20260909-review-03.md)를 따른다. Temu r3·쿠팡 r4·11번가 추가 증거 완료 경계는 관련 356/356과 업무40/채널28, 타입·lint·로컬 빌드를 통과했다. 실등록·운영 DB 쓰기·배포는 0이다. 아래 시작 상태는 초기 실행 이력이며 현재 active/idle은 ownership의 마지막 점검 cursor 기준이다.

8개 시작 메시지가 모두 접수됐고 각 작업의 최신 턴 `inProgress`, 작업 상태 `active`를 확인했다. 이는 실행 시작 증거다. 신규 상품 실제 등록이 완료됐다는 뜻은 아니다. 각 채널에 남아 있던 이전 작업은 보존했으며 새 전용 worktree를 기준 SHA에서 만들고 node_modules를 연결했다.

## 작업 경계

각 작업은 [자기 채널 지시문](prompts/)과 자기 worktree의 `docs/product-channel-parallel/reports/<channel>/status.md`, `status.json`을 사용한다. 직접 수정 범위는 자기 상품 채널 adapter/helper/테스트다. 같은 이름 접두사를 가진 CS·배송·OAuth 공유 파일은 자동으로 소유하지 않는다.

0번 소유: 공통 화면/입력 저장 스키마/API, 인증·protocol·gateway·worker, 공통 공급자 준비/검증, DB migration, 원장, 최종 빌드/배포 여부. 공통 패치는 원본 SHA256·최소 patch·호출 계약·검사 결과를 받아 통합한다. 채널별 동결 제출을 확인하기 전 작업 중 파일을 복사하지 않는다. 브랜치 전체 병합으로 삭제한 복구 코드를 되살리지 않는다.

기존 상품등록 0번 자동화 `sellerpilot-0-10`은 PAUSED로 유지한다. 이 작업에 연결된 기존 자동화 `sellerpilot-8-cs`를 **SellerPilot 0번 상품등록 통합 점검**으로 바꾸고 ACTIVE, 10분 간격으로 설정했다. 이전 CS 범위를 대신한다. 변화가 없으면 알리지 않고 통합할 제출/실패/필수 입력이 있을 때만 알린다. 채널 담당은 별도 자동화를 만들지 않는다.

## 0번 실행 순서

1. [파일 제출·수집 규칙](REPORTING.md)에 따라 수집기를 실행하고 pending 스냅샷부터 검토한다. ownership.json의 cursor로 8개 `wait_threads` compact snapshot도 묶어서 조회한다. 채팅 보고 도착을 작업 발견 조건으로 삼지 않는다.
2. idle이고 실행 가능한 미완료 구현이 있으면 다음 구체 작업을 보내 재개한다. 같은 심사/인증 차단은 반복 호출하지 않는다.
3. 공통 의존 요청을 먼저 해결하고 준비된 채널 패치를 한 개씩 검토·통합한다. 관련 회귀와 영향 받는 경계 검사를 실행한다.
4. provider 실등록을 실행할 채널은 판매자·market/shop·SKU·제품·가격·재고·승인 이미지와 중복 조회를 확인하고 담당을 하나로 확정한다. 같은 요청을 병렬 중복 발행하지 않는다.
5. 계정 확인 / 필수값 확인 / 로컬 흐름 통과 / 통합 / 신규 등록 / 원격 재조회 단계를 나눠 기록한다. fixture나 HTTP202 또는 기존 상품 복구는 신규 등록 완료가 아니다.
6. docs/현재상태.md와 통합 원장을 갱신하고 private origin integration-aside에만 검증된 변경을 전달한다. Vercel 연결 remote·배포·운영 migration·release gate는 이번 범위에서 변경하지 않는다.

8개 채널의 실제 검증이 끝났거나 가능한 개발/통합을 모두 마치고 외부 조건만 남았을 때만 그 결과를 보고하고 점검 자동화를 일시 중지한다. 같은 소스의 통과 검사를 불필요하게 반복하지 않는다.
