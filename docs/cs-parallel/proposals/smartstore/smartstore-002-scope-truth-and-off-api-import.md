# 공통 변경 요청 smartstore-002

- 목적: 스마트스토어 CS를 상품문의·네이버페이 고객문의·톡톡·리뷰 네 행으로 계속 노출하고, Commerce API 밖 표면을 자동연동 완료에 합산하지 않으면서 공식 자료가 확보된 경우에만 검증형 import를 연다.
- 요청 채널: smartstore
- S0 ID / 현재 인터페이스 버전: `S0-20260908-decaba426812a3ba` / `sellerpilot-cs-capability-inventory/1`
- 수정할 공통 파일과 함수: `app/channel-readiness-data.ts` SmartStore 항목, `lib/cs/capability-inventory.ts` SmartStore capability 상태/설명, 공통 import UI와 route는 실제 공식 export 샘플 확보 후 전용 parser를 연결하는 지점만 추가한다. `app/cs/capability-inventory.tsx`는 현재 네 행 renderer를 재사용한다.
- 현재 파일 SHA-256: `app/channel-readiness-data.ts`=`9d0bdb4dc824a5b024985f593c006fb2cfaa8734f53c8c027c473541d4eda5ac`, `lib/cs/capability-inventory.ts`=`a0e72d200e7d7cc6ab22c47c74be31875b3c2a161672467cc53beca0b86f763e`, `app/cs/capability-inventory.tsx`=`51bb943d42c3ca389a9e5965f186618e991005dcbc025812db661f554033cc97`, `lib/cs/import-staging.ts`=`556570c1a6a63c4d97f1ac691189f06f1f1272a87e735ec056303fc571dd90a1`
- DB 객체: 기존 CS import staging ledger를 재사용하되, SmartStore 리뷰 export의 실제 header/version을 확보하기 전에는 parser나 commit scope를 추가하지 않는다.
- 기존 동작: capability inventory 자체는 네 행을 갖지만 readiness 요약은 리뷰·톡톡을 한 행으로 묶고, 별도 네이버 제품/계약 조사와 현재 계정의 export 가용성을 표현하지 않는다. 현재 앱에는 상품·고객문의만 원격 수집 경로가 있다.
- 문제를 재현하는 최소 입력: SmartStore readiness 화면에서 `상품 리뷰·톡톡`이 한 차단 항목으로만 보이며, 운영자가 어느 표면이 Commerce API 연결인지, 별도 계약 대기인지, seller-center export 가능한지 구분할 수 없다.
- 원하는 동작: `product_qna`와 `customer_inquiry`는 Commerce API 실제 GET 연결, `talktalk`은 현재 앱 scope 없음 및 별도 톡톡 계약/자격 재확인 대기, `review`는 현재 Commerce API 미제공·판매자센터 엑셀 다운로드 관측으로 표시한다. 네 행 모두 분모에 남기고 `receive/reply/history`를 표면별로 계산한다.
- 전용 모듈 경로와 export: 실제 export를 사용자 승인으로 받은 뒤 `lib/cs/channels/smartstore/review-export.ts`에 header fingerprint와 정규화 함수를 제안한다. 샘플 전에는 파일과 parser를 만들지 않는다.
- 기존/새 입력·출력 계약: 기존 합산 `{label:"상품 리뷰·톡톡", state:"blocked"}`; 새 네 표면별 `{key,state,source,lastVerifiedAt,receive,reply,history,manualImport,reason}`. `manualImport=true`도 자동연동 완료로 집계하지 않는다.
- 최소 변경안: readiness의 SmartStore check를 네 행으로 분리하고 2026-09-08 실계정/API센터 증거를 갱신한다. TalkTalk는 “네이버 전체에서 불가능”이 아니라 “현재 Commerce 앱 scope 없음, 별도 계약 재확인”으로 표시한다. 리뷰는 공식 Commerce API 미제공과 seller-center 엑셀 다운로드를 함께 표시한다. 실제 export 샘플이 생긴 뒤에만 전용 parser→preview→승인 commit을 연결한다.
- 다른 채널 영향: capability 총계의 blocked/permission 상태 문구와 SmartStore 표시만 달라질 수 있다. 다른 채널 adapter나 분모는 변경하지 않는다.
- 상품/주문/배송 mutation 영향: 없음. CS capability/read-only import 표시만 변경하며 상품등록·재고·주문·송장 경로를 호출하지 않는다.
- 재현·회귀 시험 명령: `node --import tsx --test tests/cs-capability-inventory.test.ts tests/channel-readiness-truth.test.ts tests/cs-import-staging.test.ts tests/cs-import-route.test.ts`
- migration 선행/preimage/ACL 요구: export parser 도입 전 없음. 도입 시 기존 import staging ACL·preview·중복키를 재사용하고 원본 파일은 Git에 넣지 않는다.
- 우선순위: 과거누락 / 추가기능
- 통합 담당 처리 상태: 요청 제출, 미반영
- 반영된 통합 소스 hash와 검증: 미반영

