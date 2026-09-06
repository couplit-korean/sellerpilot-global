# 실행 지시 — SellerPilot 8채널 자동 업로드 복구

작업 폴더 `/Users/kimchangheemac/dev/sellerpilot`, 브랜치 `integration-aside`에서 계속한다. 사용자는 판매자센터 수동 등록이 아니라 **프로그램을 완성해 자동으로 업로드**하라고 명확히 정정했다. 수동 폼 입력이나 상품등록 버튼 클릭으로 자동화 완료를 대체하지 않는다.

먼저 아래 문서를 읽고 이미 확인한 증거·코드·자산을 재사용한다.

- `docs/자동업로드-장애분석-20260907.md`: 01:30–01:40 KST 운영 DB·Vercel·실행기 및 3명 독립 감사 결과.
- `docs/Codex-직접실행-20260907.md`: 실행 이력. 최신 절이 우선.
- `docs/Codex-잔여목록-20260907.md`: 현재 복구 작업과 완료 조건.

## 바로 할 작업

1. AUTO-01: 현재 상품의 승인 source 불일치를 정상 계약으로 복구한다. 상품 updated_at은 2026-09-06T13:08:23.846181Z, approved v2는 03:19:01.757195Z다. `publish-context` 409가 작업대를 막는다. 222500은 미래 completion 예방만 적용했고 기존 불일치를 복구하지 않았다. 승인 manifest·실제 상품 사실·내용 해시를 검증하고 내용/운영 메타데이터를 분리한다. 전체행 commitment가 이미 불일치했으므로 timestamp를 그냥 되감거나 비교 필드를 임의 제외하지 않는다. 같은 이미지8장 재제작 금지. GET200 및 내용변경 차단/상태갱신 허용 회귀가 완료 조건이다.
2. AUTO-02: 정상적인 채널별 자동 실행 경로를 완성한다. 로컬 worker는 살아 있지만 claim에서 쿠팡과 일반 Smartstore 쓰기를 제외하고 특정 옛 job만 예외로 허용한다. 새 상품마다 UUID SQL을 추가하지 말고 채널·operation·판매자·릴리스·실제 송신IP·승인receipt에 결속되는 일반 경로로 고친다. 운영 source SHA와 worker가 같은 코드를 실행함을 검증한다. 유료 Static IP는 구매하지 않는다.
3. AUTO-03: 쿠팡 공식 카테고리59631·상품사실·고시·315g×1개·출고/배송값을 SellerPilot 프로그램에 영속 저장한다. 현재 Coupang assignment 없음, weightAttribute/quantityAttribute/noticeContent/channelDrafts 없음이다. WING에 입력된 것과 program DB 저장은 다르다. 기존 조사를 재사용해 정상 UI/API→job→provider→동일 SKU readback을 검증한다. WING 수동 등록은 실행하지 않는다.
4. AUTO-04: Smartstore와 11번가는 이미 존재하는 원격 상품을 정확히 채택하고 자동 UPDATE 복구를 완성한다. 단순 receipt 저장이 정상 update lineage까지 복구하는지 별도 확인한다. 11번가 유료배송3000 지원과 full snapshot 보존은 미구현 범위다.
5. AUTO-05: Shopee v80 인증은 복구됐으므로 재인가를 반복하지 않는다. 미전송 old recon의 증거/정상 successor를 처리한다. eBay v151·카테고리는 준비됐고 상품별 정책4종 handoff가 없다. Qoo10은 기존상품의 v2 update만 검토한다.
6. AUTO-06/07: Lazada 기존 티켓58021·OAuth short-code 문제, Temu Rejected/Inactive를 별도 병렬 추적한다. 상태 화면에서 처리종료율100을 업로드 성공률로 오인하게 하는 표시도 고친다. CS/재고/배송 기존 수정은 보존하고 자동 업로드보다 먼저 새 작업을 벌이지 않는다.
7. AUTO-08: 기능코드78c9cd3은 Preview만 Ready, Production/runtime/gate는 d409055다. 검증한 동일 판본을 DB·실행기·운영에 반영한 뒤 프로그램에서 실동작으로 마감한다. Preview/빌드/테스트/queue만으로 완료라고 하지 않는다.

## 병렬 실행과 기록

- 현재 4슬롯이면 총괄1+하위3을 사용한다. 승인/DB, 실행기, 쿠팡 준비를 분리하고 공통 파일/동일 상품/운영 DB 쓰기는 총괄이 직렬 통합한다. 담당 종료 후 다음 독립 채널을 같은 원장으로 이어받는다.
- 기존 task ID AUTO-01~08와 담당, 소유파일, 입력/기준SHA, 실제 변경, 검증, 운영반영, 원격결과, 다음행동을 기록한다. 계획표를 실제 실행으로 쓰지 않는다.
- 변경 없는 통과 테스트·승인 상세·카테고리 조사·키 저장을 반복하지 않는다. 불확실한 외부 요청은 재전송하지 않고 기존 계보의 결과부터 조회한다.
- Chrome은 매 동작 전 프로필 목록을 확인하고 쇼핑/물류는 CHANGHEE, Vercel/Supabase는 JEONGHUN을 사용한다. 숫자 browser ID를 고정하지 않는다.
- 작업마다 `docs/Codex-직접실행-20260907.md`에 기록하고 현재상태/잔여목록/복붙 지시를 맞춘다. 최종 커밋은 필요한 파일만 선택하며 main/Production은 운영 반영 절차를 따른다.

## 중복 생성·보호 범위

- Smartstore SKU AUTO-780720401E2D4E4EA45F: 원상품13688607602/공개13749310594. 수동 등록되었으므로 자동 CREATE 금지.
- Qoo10 remote1217536689, 11번가remote9598600918: 기존 ID 재조회/UPDATE만. 새 SKU나 새 멱등키로 중복 생성을 우회하지 않는다.
- 기존 job/attempt/recon, 승인 manifest는 감사 원본으로 보존한다. 복구는 검증 가능한 전용 계약으로 한다.
- `supabase/migrations/20260903150000_unblock_shopee_second_oauth_deadlock.sql`은 읽기·복사·수정·삭제·테스트·stage·적용 모두 제외한다.
- 고객 메시지 발송·실출고·유료구매는 이번 자동 상품 업로드 복구에 포함되지 않는다.

첫 응답에서는 실제 맡긴 담당과 바로 수행할 수정만 짧게 말하고 AUTO-01부터 작업한다. 이미 끝낸 분석을 반복하거나 수동 등록으로 목표를 바꾸지 않는다.
