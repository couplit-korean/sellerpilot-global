# Shopee 7개 가격·운임 문서 반영 (2026-09-14)

사용자가 제공한 Google Sheets 7개를 공개 XLSX로 내려받아 숨김 이력을 포함한 전체 59개 탭의 값·수식·합병셀·링크를 읽었다. 원본 Google 문서는 수정하지 않았다. 이 자료는 카테고리별 상품 필수 속성표가 아니라 **Shopee 국가별 가격 계산·국제운임·수수료 안내**다. 따라서 상품 등록의 Shopee 가격 계산에 반영했으며 다른 판매채널의 필수 입력 규격으로 전용하지 않았다.

## 읽은 원본과 적용 범위

|국가|원본|적용 요율|중량행|600g 전체 / 구매자 / 판매자 운임|PG / 판매수수료 기본값|
|---|---|---|---:|---|---|
|대만|[TW](https://docs.google.com/spreadsheets/d/16HHhzRsxg3QiJTMJfPs46XoFR7Pvm7ai3IynwbNdUZo/edit#gid=1271427692)|NEW TW Rate Table (2026.07.01~)|2,000|156.6 / 70 / 86.6 TWD (택배)|2% / 12.35%|
|멕시코|[MX](https://docs.google.com/spreadsheets/d/1G4dT9119UcZ7XPAQ9nDsvN13e2Mxx2219H7jFOQrZ4U/edit#gid=1389386158)|NEW MX Rate Table (2026.07.01~)|1,500|249.6 / 0 / 249.6 MXN|2% / 15.35%|
|태국|[TH](https://docs.google.com/spreadsheets/d/1TJSmtFB60wmE9Q1Lin1WUhN2eq3byZDpxHBoEDeyASM/edit#gid=1577697739)|NEW TH Rate Table (2026.07.01~)|3,000|151.7 / 22 / 129.7 THB (A)|3.21% / 21.77%|
|브라질|[BR](https://docs.google.com/spreadsheets/d/1M624_9zJ4gNa8tXWJ3jmBMWBDjOrp89NbKvies_I1Xg/edit#gid=1783584448)|NEW BR Rate Table (2026.07.01~)|3,000|95 / 13 / 82 BRL (A)|2% / 13.35%|
|베트남|[VN](https://docs.google.com/spreadsheets/d/1QgCC0WNYfeeNa035muo5XSMECA8QND-cTEagaCifSfg/edit#gid=1715668820)|NEW VN Rate table (2026.07.01~)|3,000|84,950 / 15,000 / 69,950 VND (A1)|4.91% / 17%|
|말레이시아|[MY](https://docs.google.com/spreadsheets/d/1jcNwhlxzkMH3sxFePYp8jDS704bV3xikVXYoLqQCA9w/edit#gid=845710254)|NEW MY Rate Table (2026.07.01~)|3,000|17.7 / 4.9 / 12.8 MYR (Standard A)|3.78% / 16.58%|
|필리핀|[PH](https://docs.google.com/spreadsheets/d/1AK_XgHA_0CC7ggGjfPjgAc-h5fosfcda2UOPmokvNJE/edit#gid=1416708703)|NEW PH Rate table (2026.07.01~)|3,000|246 / 40 / 206 PHP (A)|2.4% / 10.01%|

수수료는 문서의 실제 계산식 계수다. 숍·프로그램별 현행 수수료를 API로 확인했다는 뜻이 아니며 화면에서 수정할 수 있다. 싱가포르(SG)는 제공 자료에 없으므로 계산/가격 적용 대상에 추가하지 않았다. 기존 SG 상품에는 다른 국가의 비교 계산만 가능하며 적용 버튼은 비활성이다. 이 변경은 다른 국가 숍의 권한이나 실제 운송 서비스를 활성화하지 않는다.

## 원본 오류를 그대로 가져오지 않은 부분

- MX Price Tool E52:E1013의 962개 행이 존재하지 않는 구 요율 탭을 참조하고 IFERROR로 가린다. 앱은 2026.07.01 현재 운임표를 직접 사용한다.
- MY Price Tool I/J는 판매자 실부담과 구매자 배송비를 뒤집는다. 앱은 NEW I열 판매자 부담 및 O/P/Q열 구매자 부담을 각각 사용한다. MY 40 MYR·600g·A의 올바른 문서 방식 합계는63.532859076, 최종 올림 가격63.54 MYR이다.
- PH Zone A 계산이 C&D 총운임 H열을 조회한다. 앱은 A=F, B=G, C/D=H와 공통 판매자 부담 I열을 대조한다. Zone D 구매자80 PHP는 C&D 총운임−전 Zone 판매자 부담에서 도출한 값임을 표시한다.
- BR의 옛 구매자15 BRL 설명 대신 현행13 BRL을 사용한다. PH의 옛 PG2.24%·판매수수료9.01% 설명은 현재 수식2.4%·10.01%와 구분해 기록했다.
- 빈 가격·중량, 잘못된 숫자, 요율 상한 밖 입력은0원이나 음수 가격으로 계산하지 않는다.

## 계산과 등록 동작

`app/product-publish-workbench.tsx`의 Shopee 등록 준비 영역에 접을 수 있는 `ShopeePriceTool`을 연결했다. 국가·운송 방식·배송 Zone·포장 실중량·확인한 부피중량·현지 기준금액·수수료·선택 인상률을 사용한다. 전체 해외운임/구매자 배송비/판매자 부담/각 수수료/예상 판매가를 구분한다. 원본 링크와 실제 셀 근거는 펼쳐서 확인할 수 있다.

문서 방식은 PG=(현지 기준금액+구매자 배송비)×PG%, 판매수수료=(기준금액+판매자 운임+PG)×판매수수료%, 합계=기준금액+판매자 운임+PG+판매수수료다. MY Standard PG는 문서처럼 기본 ESF만 포함하며800g 초과 추가 ESF는 제외한다. 중간값은 반올림하지 않고 최종 적용금액만 VND 정수/다른 통화0.01로 올림한다. 선택 인상률 기본값은0%;30%는 사용자가 선택하는 인상률로, 순이익률30%나 수수료 차감 후 목표 이익의 보장이 아니다.

앱은 큰 중량을10g 단위로 올리는 **예상 청구중량**임을 보여준다. 문서에 부피중량 환산계수·환율이 없어서 임의 환산하지 않고, 부피중량 미입력시 실중량 기반 예상이라고 표시한다. 실제 운송사 정산중량/계정 비용이 우선한다.

적용 버튼을 눌렀을 때만 현재 마켓/통화가 일치하는 초안의 `publish.item.original_price`를 바꾼다. 기존 초안 저장 흐름을 사용하며 글로벌 USD 기준가·재고·물류 설정·구매자 배송비를 보존한다. 다른 국가/통화, 원격 수정 모드, 등록 실행 중에는 적용할 수 없다. 외부 상품 CREATE/UPDATE를 자동 실행하지 않는다.

다음은 명시적으로 제한했다.

- TW F&B의 독립 구매자 배송비 근거가 없어서 확정 계산을 차단한다.
- MX 표는 Cosmetics 전용으로 안내하며 음료 운송 가능성을 승인하지 않는다.
- MY BSC는10kg까지만 사용한다. 그 이후 J/K/L의 `-`/빈칸은 null로 보존한다. B/C의 판매자 부담은 K열 전체 운임이다.
- 원가/국내 배송비는 사용자가 기준금액에 고려한다. 출금수수료1.2%, 별도 수입세, FSP/CCB 등 미확정 프로그램 비용은 합계에 몰래 추가하거나0원으로 확정하지 않는다.

## 구현·검증 증거

- `scripts/import-shopee-price-tables.py`: 원본7개 SHA256과 선택된 현행 탭 확인,10g 전체구간 검증, 전 행 손실 없는 구간 압축.
- `lib/pricing/shopee-rate-tables-20260701.json`:18,500개 중량 행을16,858바이트로 저장. 런타임 Google 문서 접근이나 XLSX 라이브러리가 필요 없다.
- 독립 Decimal 대조: 선택열 숫자89,000셀과 MY 비수치6,000셀, 불일치0. 숨김 구표 혼입0.
- `tests/shopee-price-tool.test.ts`:13/13 통과.7개 국가, 서비스/Zone,800g 경계, BSC상한, SG/F&B거부, 단위 올림, 초안 복제 및 다른 필드 보존 검사.
- 전체 TypeScript 검사 통과.
- CUA 실제 React 컴포넌트 검증: MY600g가격63.54/선택30%82.60, 적용 후 USD2.24·재고10·배송비4.9 보존, 입력 변경 뒤 이전 적용 메시지 제거, BSC10.01kg차단, PH A/D운임 구분, SG오적용 버튼 차단.390px에서 문서너비390px로 가로넘침 없음, 브라우저 오류 로그0.
- 원본·59탭 목록·국가별 상세 검토·독립 대조 결과는 Git 제외 경로 `outputs/reference-data/shopee-price-tables/20260914/`에 보존한다. 테스트 화면은 `outputs/qa/shopee-price-tool/`이며 실제 API를 호출하지 않는다.

코드와 문서 검증 완료. 배포 결과는 아래에 실제 확인 후 추가한다. 이 작업에서 DB 스키마 변경이나 실제 신규 상품 게시는 하지 않았다.
