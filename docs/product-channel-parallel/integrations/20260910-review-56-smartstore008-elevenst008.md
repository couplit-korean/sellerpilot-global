# 중앙 검토56 — SmartStore008 최종본, Elevenst008

검토 시각: 2026-09-10 04:18 KST

최신 수집본을 재대조해 SmartStore008 최종 patch와 Elevenst008을 중앙 로컬 정본에 적용했다. Lazada013-r1은 공식 CreateProduct 응답에 존재하지 않는 `item_status`를 요구한다는 담당의 정정을 받아 즉시 역적용했고 최종 통합에서 제외했다. 운영 provider mutation, 운영 DB, 배포, commit, push는 수행하지 않았다.

## SmartStore008 최종본

최종 patch SHA-256은 `40d8bac7109cb68cf2caf6895ff16aa5cc1158af0b62bee47b40bf3a593ff468`이다. 이전 inbox의 `d71e9c...` 관찰본은 최종 제출이 아니며, 검토54의 해당 hash 기록은 이 문서로 대체한다.

신규 CREATE의 실제 prepared body를 상품 입력, category/attributes, brand/notice, shipping/returns, approved images/detail, channel product 여섯 그룹으로 canonical digest에 묶는다. CREATE가 반환한 서로 다른 `originProductNo`와 `channelProductNo`를 각각 공식 GET으로 조회하고, 여섯 그룹 중 하나라도 누락·변경되면 `SMARTSTORE_CREATE_EXACT_READBACK_MISMATCH`로 종료한다. 이때 두 번째 CREATE나 보정 PUT을 보내지 않는다.

중앙 SmartStore 집중 검사는 `38/38`, nonincremental TypeScript, 변경 파일 ESLint가 통과했다. confirmed category assignment의 `providedAttributes`를 Naver `productAttributes`로 만드는 공통 builder와 assignment revision/digest 결속은 009로 담당에 재배정했다.

## Elevenst008

`elevenst-008-r1.patch` SHA-256 `eb87639bd880a29f69b0664bb9039094a4964cd86d85be643d1cd0ece7d64c68`를 적용했다. category `1346631` 신규 CREATE는 첫 provider category GET 전에 `sellerpilotElevenstNewProductInputReceipt`를 검사한다. 11개 고시의 값·순서·source revision·approval revision, product/category/SKU/environment, credential ID/version, seller digest, freshness가 맞지 않으면 provider GET/POST와 mutation hook 0회로 종료한다.

중앙 선택 회귀는 `82/82`, nonincremental TypeScript, 변경 파일 ESLint가 통과했다. browser receipt와 browser ProductNotification을 제거하고 DB/RPC 원천에서 서버 receipt를 새로 만드는 009 builder를 담당에 재배정했다. 고시 9개, 배송·반품, 승인 상세·이미지와 Seller Office/buyer-visible readback은 여전히 실제 증거가 없다.

## Lazada013-r1 제외

013-r1은 item/SKU identity와 post-create completion을 보강하려는 방향은 맞지만, 공식 CreateProduct 응답에 없는 `data.item_status`까지 필수로 요구했다. 담당이 최신 공식 응답 예제를 재확인하고 r2를 준비한다고 알렸으므로 중앙은 적용 직후 역적용했다. r2는 CreateProduct의 `item_id`와 `sku_list` identity를 검사하고, 상태/visibility는 공식 `GET /product/item/get`에서만 검증해야 한다.

## 최종 로컬 검증

- SmartStore 집중: `38/38`
- Elevenst 집중: `82/82`
- nonincremental TypeScript: 통과
- 변경 파일 ESLint: 통과
- 업무 도메인 6방향 교차 의존: 모두 0
- 채널 간 직접 의존: 0
- Next 16 webpack production build: 통과
- 실제 신규 CREATE·공식 원격/판매자 화면 완료: `0/8`
- 6단계 진행률: `19/48 = 39.6%`
