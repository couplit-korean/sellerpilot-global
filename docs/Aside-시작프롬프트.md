# Aside 복사·붙여넣기 실행 지시 — 완료 계보를 보존하고 남은 작업만 실행

작업 폴더는 `/Users/kimchangheemac/dev/sellerpilot`, 브랜치는 `integration-aside`다. 가장 먼저 아래 두 문서의 **최신 절**을 읽고, 이미 완료된 작업은 증거를 재사용해라.

- `/Users/kimchangheemac/dev/sellerpilot/docs/Codex-직접실행-20260907.md`
- `/Users/kimchangheemac/dev/sellerpilot/docs/Aside-작업원장-20260906.md`

## 절대 중복 실행 금지

- Smartstore SKU `AUTO-780720401E2D4E4EA45F`는 이미 실제 등록·판매중이다. 원상품번호 `13688607602`, 공개 채널상품번호 `13749310594`, 구매자 페이지는 `https://smartstore.naver.com/coupletseoul/products/13749310594`다.
- 이 SKU의 Smartstore create·retry·requeue·새 멱등키·새 reconcile·수동 drain을 만들지 마. 과거 실패 job `66147e5d-0479-4c51-896e-97e782af99e1`, attempt `0d2c492e-2025-4717-bb3f-0fd2b886fd4f`, listing은 감사 원본으로 불변 보존한다.
- Smartstore 후속은 별도 수동 채택 receipt의 코드·DB 계약 검증, 선택 적용, receipt 원격 readback뿐이다. 과거 행의 status나 remote_id를 직접 UPDATE하지 마.
- 쿠팡 category59631, exact SKU/GTIN 0건, 승인 자산·공식 표시사항 조사를 다시 하지 마. `Codex-직접실행-20260907.md`의 최신 쿠팡 절을 이어라.

## 최우선 외부 실행

1. CHANGHEE Chrome의 현재 쿠팡 WING 등록 폼을 먼저 확인한다. 공식 카테고리, 브랜드, 315g×1개, 가격3,190원, 재고1, SKU/GTIN, 유료배송3,000원, 출고2일, 실물 이미지3장, 승인 상세8장, 가공식품 고시가 입력된 상태다.
2. 누락·자동변경만 읽기 전용으로 점검한다. 현재 로트의 소비기한을 추정하거나 배송중량을 순중량으로 바꾸지 마. 공식 라벨 이미지는 재배포 권리가 확인되지 않아 업로드하지 않는다.
3. `상품등록`은 외부 공개 동작이므로 실행시점에 사용자에게 상품명·가격·재고·배송·SKU와 계정 저장 출고/반품 정보가 함께 전송됨을 명시하고 승인받은 뒤 1회만 누른다.
4. 성공 응답만으로 끝내지 말고 반환 상품번호, 판매/심사 상태, exact SKU/GTIN, 가격, 재고, 배송, 이미지/상세를 판매자센터와 가능한 구매자 화면에서 재조회한다. 불확실한 응답이면 재전송하지 말고 `reconciliation_required`로 기록한다.

## 병렬 작업

- 현재 허용된 에이전트 슬롯을 실제로 사용하되 같은 파일·상품·주문·브라우저 탭을 동시에 쓰지 마. 총괄 한 명만 공용 원장을 수정한다.
- 독립 레인은 Smartstore 수동 채택 감사, 변경 영향 테스트/빌드, 쿠팡 자산 검증, 기존 Qoo10·11번가·eBay readback, CS, 재고/배송, Shopee, Lazada/Temu 상태 확인이다. 완료된 레인은 재실행하지 말고 미검증 범위만 넘겨라.
- 하위 에이전트 완료나 HTTP 202/queue 상태를 채널 등록 성공으로 계산하지 마. provider mutation 뒤 remote readback과 구매자 노출을 분리 기록한다.

## 안전·기록

- Chrome 프로필은 매 동작 전 목록을 읽고 `profileName`으로 선택한다. 쇼핑·물류·판매자센터는 CHANGHEE, Vercel·Supabase는 JEONGHUN이다. 숫자 browser ID를 재사용하지 마.
- 보호 미추적 SQL `supabase/migrations/20260903150000_unblock_shopee_second_oauth_deadlock.sql`은 읽기·수정·삭제·복사·커밋·테스트·적용 모두 제외한다.
- 고객 답변 발송, 실출고, 유료 구매, main 변경은 실행하지 마. 검증된 변경은 선택적으로 stage하고 보호 SQL을 포함하지 마.
- 실행할 때마다 시각, 담당, 정확한 계보 ID, 수행 동작, 결과, 원격 증거, 다음 단일 행동을 `docs/Codex-직접실행-20260907.md`에 추가한다. 과거 기록은 삭제하지 말고 최신 절이 우선한다는 구조를 유지한다.

첫 응답은 실제 에이전트 배정 결과와 바로 실행하는 단일 동작만 짧게 말하고, 상태 요약으로 끝내지 말고 작업을 계속해라.
