/** Creative routing only: never assigns marketplace category IDs or changes publication data. */
import { formatCategoryProductionGuideline } from "./category-production-guidelines";

export const PRODUCT_SCENE_PROFILE_VERSION = "2026-09-07-v3-category-production-playbooks";
export const sceneCategoryChannels = ["qoo10", "shopee", "lazada", "coupang", "elevenst", "smartstore", "ebay", "temu"] as const;
export type SceneCategoryHint = {
  channel: typeof sceneCategoryChannels[number];
  market?: string;
  name?: string;
  path?: readonly string[];
};
export type SceneProfile = {
  id: string; label: string; aliases: readonly string[];
  context: string; surface: string; evidenceFocus: string; forbiddenContexts: string;
};
type ProfileRow = readonly [string, string, string, string, string, string, string];
// Korean, English and Japanese are semantic aliases, NOT official channel paths or IDs.
// Each subtype owns its context: broad Food, Beauty or Home categories cannot choose a room.
const rows: readonly ProfileRow[] = [
  ["food-cup-noodles", "컵라면·컵누들", "컵라면|컵누들|신라면컵|육개장사발면|cup noodle|cup noodles|instant cup noodle|カップ麺", "끓는 물을 준비한 편의점·탕비실의 작은 식사 상판", "브랜드색과 조화되는 깨끗한 내열 상판", "밀봉 제품·용량·조리 안내와 열린 컵 속 완성 면·국물", "밀봉 뚜껑에서 나는 김, 제품 없는 라면, 별도 그릇, 확인되지 않은 계란·파·고기 토핑, 봉지라면·큰사발·다른 맛 패키지"],
  ["food-instant-bag-noodles", "봉지라면", "봉지라면|라면봉지|instant bag noodles|instant ramen packet|袋麺|インスタントラーメン", "봉지라면을 준비하는 건조한 조리대", "정돈된 밝은 조리 상판", "봉지 규격·스프 구성·조리법과 기본 조리 결과", "컵라면 용기, 확인되지 않은 토핑·소스·조리도구"],
  ["food-pasta-dry-noodles", "파스타·건면", "파스타면|스파게티면|펜네|마카로니|건면|dry pasta|spaghetti pasta|penne|macaroni|乾燥パスタ", "건면을 계량하는 식사 준비 작업대", "밝고 건조한 목재 조리 상판", "면 형태·중량·삶는 시간·원재료", "확인되지 않은 소스·치즈·고명·완성 플레이팅"],
  ["food-jelly-stick", "젤리스틱·휴대 젤리", "젤리스틱|스틱젤리|애사비|jelly stick|stick jelly|ゼリースティック", "간식을 챙기는 책상 가장자리", "패키지 색과 조화되는 무광 단색 상판", "정면 패키지·휴대 형태·실제 포 수·라벨", "주방 조리대, 냄비, 팬트리, 원료 사과 더미, 보이지 않은 낱개 젤리"],
  ["food-snack", "과자·쿠키·크래커", "과자|샌드과자|크림샌드|롯샌|웨하스|쿠키|비스킷|크래커|cookie|biscuit|cracker|snack|wafer|お菓子|クッキー", "간식 시간의 작은 라운지 테이블", "밝은 무광 테이블", "포장·맛 표기·확인된 구성", "조리 중인 주방, 미확인 내용물, 임의 접시 플레이팅"],
  ["food-chocolate", "초콜릿·캔디", "초콜릿|초콜렛|캔디|사탕|chocolate|candy|チョコレート|キャンディ", "선물 포장을 살펴보는 테이블", "차분한 무광 색지 상판", "포장 마감·종류·구성 수량", "녹은 초콜릿, 미확인 단면, 과장된 선물 구성"],
  ["food-nuts", "견과·건과일", "견과|아몬드|건과일|cashew|almond|mixed nuts|dried fruit|ナッツ", "휴대 간식을 정리하는 데스크", "내추럴 무광 목재 상판", "포장 단위·원재료·밀봉 상태", "조리 장면, 확인되지 않은 알맹이와 과일 더미"],
  ["food-cereal", "시리얼·그래놀라", "시리얼|그래놀라|오트밀|cereal|granola|oatmeal|シリアル", "아침 식사 준비용 테이블", "옅은 목재 식탁 상판", "포장·곡물 표시·구성량", "미확인 완성 시리얼, 우유가 쏟아지는 장면"],
  ["food-coffee-beans", "원두·분쇄커피", "원두|분쇄커피|coffee beans|ground coffee|コーヒー豆", "홈카페의 건조한 작업대", "짙은 목재 카페 상판", "원두 포장·로스팅 표시·중량", "미확인 원두 알갱이, 추출 결과, 다른 커피 상품"],
  ["food-coffee-instant", "스틱커피·캡슐커피", "스틱커피|커피믹스|인스턴트커피|캡슐커피|instant coffee|coffee capsule|coffee pod|インスタントコーヒー", "간단한 음료 준비 공간", "정돈된 카페 선반 상판", "호환 표기·실제 개수·개별 포장", "근거 없는 머신 호환, 미확인 캡슐 모양"],
  ["food-tea", "차·티백", "티백|녹차|홍차|허브티|보이차|tea bag|green tea|black tea|herbal tea|ティーバッグ|紅茶|緑茶", "차를 준비하는 작은 티 테이블", "은은한 질감의 찻상", "종류·포장·우림 안내의 실제 표시", "미확인 찻잎, 허구의 음료 색, 식품 효능 연출"],
  ["food-water", "생수·먹는샘물", "생수|먹는샘물|미네랄워터|mineral water|bottled water|天然水|ミネラルウォーター", "수분 보충을 준비하는 밝은 테이블", "물방울 없는 건조한 무광 상판", "밀봉 병·용량·수원·묶음 구성", "산지 풍경, 과장된 물방울, 확인되지 않은 미네랄"],
  ["food-juice", "과채주스·과즙음료", "과채주스|과일주스|과즙음료|오렌지주스|apple juice|orange juice|fruit juice|ジュース", "음료를 준비하는 밝은 테이블", "색 왜곡이 적은 건조한 상판", "팩·병·과즙 함량·용량", "촬영하지 않은 과일 더미, 확인되지 않은 음료 색"],
  ["food-soda", "탄산음료·탄산수", "탄산음료|탄산수|소다|콜라|sparkling water|soft drink|soda|cola|炭酸水|炭酸飲料", "차가운 음료를 준비하는 휴식 테이블", "건조한 짙은 무광 상판", "캔·병·용량·당류·카페인 표시", "탄산 폭발, 임의 얼음·레몬, 과장된 결로"],
  ["food-dairy", "우유·요거트·유제품", "우유|요거트|요구르트|치즈|milk|yogurt|yoghurt|cheese|牛乳|ヨーグルト", "냉장 식품을 확인하는 식사 준비대", "깨끗한 밝은 냉장 식품 상판", "냉장 포장·밀봉·용량·유형", "목장 풍경, 우유 splash, 미확인 과일·제형"],
  ["food-beverage", "기타 병·캔·팩 음료", "음료|캔음료|팩음료|beverage|bottled drink|canned drink|飲料", "휴식 공간의 음료 테이블", "밝고 건조한 무광 상판", "밀봉 포장·용량·당류 표시", "미확인 냉장 보관, 물방울로 방수 암시, 추가 음료"],
  ["food-protein", "단백질 분말·바", "단백질|프로틴|protein powder|protein bar|プロテイン", "운동 준비 공간의 정리 벤치", "매트한 스포츠 벤치 상판", "성분표·포장·섭취 안내", "근육 변화, 체형 전후, 확인되지 않은 쉐이크나 스쿱"],
  ["food-rice", "쌀·잡곡", "백미|잡곡|쌀|rice grain|white rice|mixed grains|白米|雑穀", "건조한 식료품 정리 작업대", "내추럴 목재 정리 상판", "품종·중량·생산 정보 표시", "미확인 논과 산지, 임의 밥상"],
  ["food-noodles", "기타 면류", "면류|소면|우동면|국수|noodles|wheat noodles|udon noodles|麺類|そうめん", "식사 준비용 건조 조리대", "정돈된 밝은 조리 상판", "밀봉 제품·수량·조리 안내와 기본 조리 결과", "확인되지 않은 토핑·소스·그릇, 제품 없는 완성 요리, 불꽃"],
  ["food-ready-meal", "즉석밥·즉석식품", "즉석밥|즉석식품|레토르트|cooked rice|ready meal|retort|ご飯パック", "간편 식사를 준비하는 테이블", "무광 식사 준비 상판", "밀봉 상태·조리법·내용량", "미확인 완성 음식, 포장을 임의로 연 장면"],
  ["food-soup-stew", "국·탕·찌개·죽", "국탕찌개|국·탕·찌개|즉석국|즉석탕|즉석찌개|죽|soup pouch|stew pouch|porridge|スープ|お粥", "국·탕 제품을 가열 준비하는 조리대", "내열성이 시각적으로 안정된 무광 상판", "파우치·고형분·인분·가열법", "확인되지 않은 고기·채소·뚝배기·고명"],
  ["food-kimchi-pickle", "김치·절임식품", "김치|깍두기|장아찌|피클|절임식품|kimchi|pickles|pickled vegetables|キムチ|漬物", "냉장 반찬을 확인하는 식사 준비대", "깨끗한 냉장 식품용 상판", "용기·절단 크기·중량·냉장 보관", "임의 밥상·발효 효과·촬영하지 않은 재료"],
  ["food-meal-kit", "밀키트·간편조리세트", "밀키트|간편조리세트|쿠킹박스|meal kit|cooking kit|ミールキット", "구성품을 순서대로 확인하는 조리 준비대", "넓고 건조한 조립형 조리 상판", "외포장·소포장 구성·인분·조리 순서", "구성품 추가·고급 플레이팅·다른 조리기구"],
  ["food-condiment", "소스·오일·조미료", "소스|드레싱|식용유|올리브유|양념|조미료|sauce|dressing|olive oil|seasoning|調味料", "요리 준비용 작업대 가장자리", "어두운 무광 조리 상판", "용기·원료·용량·사용 안내", "미확인 재료와 요리, 향이나 효능 시각화"],
  ["food-baking", "베이킹 재료", "밀가루|베이킹파우더|베이킹믹스|flour|baking mix|baking powder|小麦粉", "베이킹 준비 작업대", "건조한 밝은 목재 상판", "포장·재료 종류·중량", "가루 날림, 미확인 완성 빵과 반죽"],
  ["food-canned", "통조림·병조림", "통조림|캔참치|참치캔|canned|tinned|缶詰", "상온 식품을 정리하는 작업대", "중립색 건조 상판", "밀봉 상태·원재료·내용량", "열린 캔, 미확인 내용물, 임의 조리 예시"],
  ["food-fresh", "신선 과일·채소", "생과일|신선과일|신선채소|fresh fruit|fresh vegetables|生鮮果物", "식재료 검수 테이블", "밝은 식재료 작업 상판", "실물의 크기 편차·표면 상태·구성", "촬영하지 않은 산지, 과장된 크기와 수량"],
  ["food-frozen", "냉동식품", "냉동|frozen food|frozen meal|冷凍", "냉동식품 포장 확인 작업대", "깨끗한 냉색 작업 상판", "냉동 표시·포장·보관 안내", "실온 장기 보관 암시, 미확인 해동 요리"],
  ["food-bread", "빵·베이커리", "식빵|베이글|빵류|베이커리|bread|bagel|bakery|パン|ベーカリー", "포장 빵을 확인하는 아침 식사대", "부스러기 없는 밝은 무광 상판", "포장·개수·소비기한·실제 단면", "갓 구운 김·버터·잼·미확인 단면"],
  ["food-dessert", "케이크·아이스크림·디저트", "케이크|아이스크림|푸딩|디저트|cake|ice cream|pudding|dessert|ケーキ|アイスクリーム", "냉장·냉동 디저트를 확인하는 작은 테이블", "차갑고 단정한 무광 상판", "용기·개수·층·해동·보관 표시", "임의 과일·크림·장식·단면"],
  ["food-meat", "축산·육류", "소고기|돼지고기|닭고기|육류|정육|beef|pork|chicken meat|meat cut|精肉", "냉장 육류 포장을 검수하는 작업대", "깨끗한 냉색 식품 검수 상판", "부위·중량·밀봉·원산지", "농장 풍경·과장된 마블링·미확인 고명"],
  ["food-seafood", "수산물·해산물", "생선|수산물|해산물|새우|오징어|fish|seafood|shrimp|squid|魚介類", "냉장 수산물 포장을 검수하는 작업대", "깨끗한 냉색 식품 검수 상판", "어종·손질 상태·중량·보관", "바다 풍경·과장된 선도·미확인 레몬·고명"],
  ["health-vitamin-tablet", "비타민·미네랄 정제", "종합비타민|멀티비타민|비타민정|미네랄정|vitamin tablet|multivitamin|mineral tablet|ビタミン", "정제형 건기식을 확인하는 조용한 정리대", "색 재현이 중립적인 건조 상판", "건강기능식품 표시·성분·정제 수·섭취량", "정제 색·각인 창작, 복용 장면, 신체 변화"],
  ["health-probiotic-stick", "유산균·프로바이오틱스", "유산균|프로바이오틱스|probiotic|lactobacillus|乳酸菌", "스틱형 건기식을 정리하는 건조 선반", "밝고 단정한 포장 검수 상판", "균주·포 수·1포 중량·보관·섭취방법", "분말 쏟기, 장 이미지, 복용 동작"],
  ["health-omega3-softgel", "오메가3·연질캡슐", "오메가3|EPA DHA|피쉬오일|omega 3|fish oil|softgel|オメガ3", "연질캡슐 제품을 확인하는 조용한 정리대", "반사를 억제한 중립색 상판", "원료 표시·캡슐 수·1회분·주의사항", "혈관 이미지·생선 더미·캡슐 창작"],
  ["health-red-ginseng", "홍삼·액상 파우치", "홍삼|홍삼정|홍삼스틱|red ginseng|ginseng extract|紅参", "액상 파우치를 확인하는 차분한 정리대", "짙은 중립색 건조 상판", "원료 함량·포 수·1포 용량·섭취방법", "인삼밭·피로 전후·임의 액체 색"],
  ["health-gummy", "구미형 건강기능식품", "비타민구미|영양구미|건기식구미|supplement gummy|vitamin gummy|グミサプリ", "구미형 건기식을 확인하는 밝은 정리대", "캔디와 혼동되지 않는 단정한 상판", "건강기능식품 표시·구미 수·당류·섭취량", "간식 연출·구미 형태 창작·과다 섭취"],
  ["health-liquid-ampoule", "액상 앰플·바이알 건기식", "건기식앰플|액상앰플|마시는앰플|drinkable ampoule|liquid supplement vial|液体サプリ", "소용량 액상 건기식을 확인하는 정리대", "의료 공간처럼 보이지 않는 중립색 상판", "밀봉·1회 용기·포 수·섭취방법", "주사·의약품·임의 액체 색·복용 장면"],
  ["health-supplement", "기타 영양제·건강기능식품", "영양제|건강기능식품|supplement|dietary supplement|サプリメント", "밀봉 상품을 확인하는 조용한 정리대", "단정한 중립색 상판", "분류·용량·주의사항·밀봉 포장", "의료 공간, 복용 동작, 알약·캡슐 창작, 효과 전후"],
  ["beauty-serum", "세럼·앰플·에센스", "세럼|앰플|에센스|serum|ampoule|essence|美容液", "스킨케어를 정리하는 화장대", "매끄러운 무광 화장대 상판", "용기·라벨·제형은 실물 근거만", "피부 전후, 임의 성분 식물, 미확인 액체 방울"],
  ["beauty-toner", "토너·미스트", "화장수|페이셜토너|스킨토너|페이스미스트|facial toner|face mist|化粧水", "스킨케어 준비 화장대", "밝은 무광 상판", "용량·분사 구조·제품명", "프린터, 잉크, 미확인 분사와 물방울"],
  ["beauty-cream", "크림·로션", "보습크림|페이스크림|수분크림|로션|moisturizer|face cream|lotion|保湿クリーム", "저녁 스킨케어 정리 공간", "부드러운 중립색 상판", "용기·용량·마개·실제 표시", "피부 효과 전후, 제형 창작, 식품 크림 연출"],
  ["beauty-sunscreen", "선크림·선스틱", "선크림|선스틱|자외선차단|sunscreen|sunblock|日焼け止め", "외출 준비용 드레싱 콘솔", "밝은 건조 상판", "SPF 등 실제 표시·용기·휴대 형태", "검증되지 않은 차단 수치, 햇빛 효과 전후"],
  ["beauty-cleanser", "클렌저·세안제", "클렌저|클렌징|세안제|face wash|cleanser|cleansing|洗顔", "건조한 세안 준비 선반", "무광 세면 공간 선반", "용기·마개·사용 안내", "거품과 제형 창작, 피부 치료 효과"],
  ["beauty-cleansing-oil", "클렌징오일·클렌징밤", "클렌징오일|클렌징밤|cleansing oil|cleansing balm|クレンジングオイル|クレンジングバーム", "클렌징 제품을 정리하는 건조한 화장대", "오일 반사를 억제한 무광 상판", "펌프·단지·스패출러·용량", "메이크업 제거 전후, 임의 오일 방울·제형"],
  ["beauty-mask", "마스크팩", "마스크팩|시트마스크|sheet mask|face mask pack|フェイスパック", "스킨케어 팩을 정리하는 화장대", "넓은 평면 화장대", "파우치 정면·실제 매수·표시", "미확인 시트 형태, 착용 얼굴, 피부 전후"],
  ["beauty-lip", "립스틱·립틴트", "립스틱|립틴트|립밤|lipstick|lip tint|lip balm|口紅", "메이크업 준비용 작은 화장대", "색 왜곡이 적은 무광 상판", "용기·실제 색상 번호·캡", "색상 스와치 창작, 입술 착색, 피부 톤 변경"],
  ["beauty-eye", "아이 메이크업", "마스카라|아이섀도|아이라이너|mascara|eyeshadow|eyeliner|アイシャドウ", "아이 메이크업 정리 공간", "중립색 메이크업 상판", "제품 타입·색상 표기·구성", "눈가 사용, 속눈썹 전후, 미확인 팔레트 내부"],
  ["beauty-cushion-foundation", "쿠션·파운데이션", "쿠션팩트|쿠션파운데이션|파운데이션|foundation|cushion compact|ファンデーション|クッションファンデ", "베이스 메이크업을 확인하는 화장대", "색상 왜곡이 적은 중립 상판", "케이스·리필·퍼프·색상 번호·용량", "얼굴 피부 보정, 임의 스와치·내부 구조"],
  ["beauty-base-makeup", "프라이머·컨실러·메이크업베이스", "프라이머|컨실러|메이크업베이스|primer|concealer|makeup base|コンシーラー", "베이스 제품을 정리하는 화장대", "색상 재현이 정확한 무광 상판", "팁·펌프·색상 번호·용량", "커버 전후, 피부톤 변경, 임의 스와치"],
  ["beauty-cheek-powder", "블러셔·파우더·하이라이터", "블러셔|치크|페이스파우더|하이라이터|blush|face powder|highlighter|チーク", "색조 제품을 확인하는 메이크업 상판", "난반사를 줄인 중립색 평면", "팬·거울·브러시·색상 구성", "얼굴 적용, 가루 날림, 색상 추가"],
  ["beauty-nail", "네일컬러·네일팁", "네일컬러|매니큐어|네일팁|네일스티커|nail polish|nail tips|ネイルカラー", "네일 제품을 정리하는 작은 테이블", "색상 재현이 정확한 무광 상판", "병·브러시·팁·스티커·실제 색상", "손톱 착용 합성, 임의 색상·광택"],
  ["beauty-tools", "화장 브러시·퍼프·뷰러", "메이크업브러시|화장브러시|퍼프|뷰러|makeup brush|makeup sponge|eyelash curler|ビューラー", "화장 도구 정리 테이블", "밝고 건조한 정리 상판", "도구 형태·모·실제 세트 구성", "얼굴 사용, 미확인 추가 도구"],
  ["beauty-hair", "샴푸·헤어케어", "샴푸|트리트먼트|헤어오일|컨디셔너|shampoo|conditioner|hair oil|シャンプー", "헤어케어를 정리하는 건조 선반", "방해 요소 없는 밝은 선반", "용기·펌프·용량", "탈모 치료, 모발 전후, 임의 거품"],
  ["beauty-scalp", "두피토닉·두피앰플", "두피토닉|두피앰플|스칼프토닉|scalp tonic|scalp ampoule|頭皮トニック", "두피 제품을 확인하는 건조한 드레싱 선반", "노즐 윤곽이 잘 보이는 중립 상판", "빗형 노즐·스포이드·분사구·용량", "두피 확대, 발모 전후, 임의 분사"],
  ["beauty-body", "바디워시·핸드케어", "바디워시|핸드크림|핸드워시|비누|body wash|hand cream|hand wash|soap bar|石鹸", "개인 위생용품의 건조 정리대", "청결한 무광 상판", "실제 포장·용량·용도", "소독 효능 창작, 임의 피부 사용"],
  ["beauty-fragrance", "향수", "향수|perfume|eau de parfum|fragrance spray|香水", "외출 준비용 드레싱 테이블", "차분한 무광 드레싱 상판", "병·캡·라벨·용량", "미확인 향료 꽃, 분사 효과, 성분 암시"],
  ["fashion-tops", "티셔츠·셔츠·상의", "티셔츠|셔츠|블라우스|후드|후디|풀집 후디|t shirt|shirt|blouse|hoodie|full zip hoodie|Tシャツ", "의류를 정리하는 드레싱 작업대", "넓은 무광 의류 검수 상판", "실제 실루엣·봉제·소재·사이즈표", "미확인 착용 핏, 모델 신체 합성, 색상 변경"],
  ["fashion-knit", "니트·카디건", "니트|스웨터|카디건|가디건|knitwear|sweater|cardigan|ニット|カーディガン", "니트 조직을 확인하는 의류 검수 공간", "짜임이 선명한 넓은 무광 평면", "실루엣·짜임·단추·시보리·사이즈", "모델 착용, 신축성·보온 효과 과장"],
  ["fashion-bottoms", "바지·스커트", "청바지|슬랙스|스커트|바지|jeans|trousers|pants|skirt|ズボン", "의류 검수용 넓은 테이블", "색 재현이 중립적인 작업 상판", "기장·허리 구조·실제 사이즈", "착용 비율 조작, 허구 사이즈"],
  ["fashion-dress", "원피스·드레스", "원피스|드레스|dress|ワンピース", "드레스 실루엣을 확인하는 작업 공간", "넓은 무광 검수 평면", "실루엣·소매·밑단·소재", "모델 착용 창작, 임의 체형 보정"],
  ["fashion-outer", "재킷·코트", "재킷|자켓|코트|패딩|jacket|coat|parka|ジャケット", "외출 의류를 점검하는 드레싱 공간", "중립색 의류 정리 평면", "잠금·안감은 제공된 사진만·실루엣", "미확인 보온성 시각화, 착용 창작"],
  ["fashion-activewear", "스포츠웨어·레깅스", "스포츠웨어|운동복|레깅스|트레이닝복|activewear|sportswear|leggings|スポーツウェア", "기능성 의류를 검수하는 건조한 공간", "신축 없이 펼친 중립색 검수 평면", "패널·밴드·봉제·포켓·사이즈", "땀 배출·근육·체형·신축 전후"],
  ["fashion-underwear", "속옷·이너웨어", "속옷|브라|팬티|이너웨어|underwear|bra|briefs|下着", "인체 없이 제품 구조를 확인하는 검수대", "프라이버시를 지키는 중립색 평면", "밴드·컵·후크·봉제·구성", "인체 착용·노출·체형 보정"],
  ["fashion-sleepwear", "잠옷·홈웨어", "잠옷|파자마|홈웨어|pajamas|sleepwear|loungewear|パジャマ", "잠옷 세트를 정리하는 의류 검수대", "패턴이 선명한 넓은 무광 평면", "상하 구성·카라·허리밴드·사이즈", "침대 위 사람·수면 효과·세트 추가"],
  ["fashion-kids", "아동복", "아동복|유아복|키즈의류|kids clothing|children apparel|子供服", "아동 없이 의류를 확인하는 밝은 검수 공간", "작은 의류 전체가 보이는 무광 평면", "호수·잠금·봉제·혼용률", "어린이 모델 합성·연령 추측·세트 추가"],
  ["fashion-socks", "양말·스타킹", "양말|삭스|스타킹|레그웨어|socks|stockings|hosiery|靴下", "양말 구성을 펼쳐 확인하는 작은 검수대", "수량을 구분하기 쉬운 단색 평면", "길이·밴드·뒤꿈치·실제 켤레 수", "발 착용·신축성 과장·수량 복제"],
  ["fashion-shoes", "신발", "운동화|스니커즈|구두|샌들|부츠|sneaker|shoes|sandals|boots|スニーカー", "외출 준비용 신발 검수 벤치", "단색 신발 검수 상판", "좌우 구성·밑창·측면·사이즈", "미확인 착화, 방수 연출, 상품 수량 복제"],
  ["fashion-bag", "가방·파우치", "백팩|핸드백|숄더백|크로스백|파우치|backpack|handbag|shoulder bag|pouch|バッグ", "외출 준비용 정리 콘솔", "밝고 넓은 건조 상판", "스트랩·잠금·수납은 실물 근거만", "미확인 수납물과 용량, 내부 구조 창작"],
  ["fashion-wallet", "지갑·카드지갑", "지갑|카드지갑|반지갑|장지갑|wallet|card holder|ウォレット|財布", "지갑 구조를 확인하는 드레싱 테이블", "모서리와 봉제가 선명한 무광 평면", "슬롯·스냅·지퍼·모서리·치수", "카드·현금 추가, 수납량·내부 구조 창작"],
  ["fashion-jewelry", "주얼리", "목걸이|귀걸이|팔찌|반지|necklace|earrings|bracelet|ring jewelry|ネックレス", "액세서리를 확인하는 드레싱 테이블", "색 재현이 중립적인 무광 평면", "장식·잠금·실제 소재·크기", "보석 등급 창작, 미확인 착용·선물 상자"],
  ["fashion-watch", "손목시계", "손목시계|wristwatch|腕時計", "시계를 준비하는 드레싱 콘솔", "무광 짙은 상판", "다이얼·밴드·측면·사양", "가짜 시각 표시, 방수 테스트, 미확인 착용"],
  ["fashion-headwear", "모자", "모자|캡모자|버킷햇|비니|cap hat|bucket hat|beanie|帽子", "모자 형태를 확인하는 드레싱 검수대", "크라운 형태가 보이는 단색 평면", "챙·크라운·조절부·안쪽 밴드", "사람 착용·머리 크기·UV 성능 창작"],
  ["fashion-eyewear", "안경·선글라스", "안경|선글라스|아이웨어|eyeglasses|sunglasses|eyewear|眼鏡|サングラス", "아이웨어를 확인하는 드레싱 테이블", "렌즈 반사를 억제한 무광 평면", "렌즈·브리지·힌지·템플·치수", "얼굴 착용·시야 효과·UV 성능 과장"],
  ["fashion-hair-accessory", "헤어핀·헤어밴드", "헤어핀|머리핀|헤어집게|집게핀|헤어밴드|hair clip|hair band|ヘアクリップ", "헤어 액세서리를 정리하는 작은 화장대", "작은 부품을 구분하기 쉬운 단색 평면", "스프링·톱니·장식·마감·수량", "머리 착용·고정력 과장·수량 추가"],
  ["fashion-belt", "벨트", "벨트|허리띠|belt|waist belt|ベルト", "벨트 길이와 버클을 확인하는 의류 검수대", "전체 길이가 읽히는 넓은 무광 평면", "버클·홀·끝단·봉제·길이", "허리 착용·길이 변경·가죽 등급 창작"],
  ["fashion-scarf-gloves", "스카프·머플러·장갑", "스카프|머플러|장갑|scarf|muffler|gloves|スカーフ|手袋", "직물 잡화를 펼쳐 확인하는 드레싱 검수대", "패턴과 봉제가 선명한 넓은 평면", "가장자리·패턴·안감·실제 구성", "목·손 착용·보온 효과·패턴 변경"],
  ["fashion-umbrella", "우산·양산", "우산|양산|umbrella|parasol|傘|日傘", "우산 구조를 안전하게 확인하는 장비 검수대", "손잡이와 커버가 구분되는 건조 평면", "살대·버튼·손잡이·커버·직경", "비·강풍·방수·UV 성능 창작"],
  ["fashion-luggage", "캐리어·여행가방", "캐리어|여행가방|수트케이스|luggage|suitcase|キャリーケース", "여행가방을 확인하는 넓은 검수 공간", "바퀴 접지가 안정적인 중립 바닥", "휠·지퍼·락·핸들·내부·치수", "여행지·수납물·내구 시험·용량 과장"],
  ["home-bedding", "침구·쿠션", "이불|베개|침구|쿠션|bedding|duvet|pillow|cushion|寝具", "침실의 침구 정리 공간", "넓고 깨끗한 패브릭 검수 평면", "소재·봉제·구성·실제 패턴", "세트 수량 추가, 과장된 두께·푹신함"],
  ["home-towel", "수건·욕실 매트", "수건|타월|욕실매트|towel|bath mat|タオル", "린넨을 정리하는 건조 선반", "밝은 린넨 정리 상판", "올·마감·실제 수량", "흡수 성능 창작, 미확인 물 사용"],
  ["home-storage", "수납·정리용품", "수납함|정리함|서랍정리|storage box|organizer|収納", "집 안의 정리 작업 공간", "넓은 중립색 정리 상판", "개폐·구획·치수·구성", "허구 수납 용량, 미확인 내용물"],
  ["home-cleaning", "청소·세탁용품", "세제|청소솔|청소포|세탁|detergent|cleaning brush|laundry|洗剤", "청소용품을 준비하는 건조 작업대", "무광 유틸리티 상판", "용도·용량·도구 형태·주의사항", "식탁과 식품, 세정 전후, 살균 효능 창작"],
  ["home-cookware", "냄비·프라이팬", "프라이팬|냄비|궁중팬|소스팬|frying pan|saucepan|cookware pot|フライパン|鍋", "요리 준비 작업대", "정돈된 조리 상판", "손잡이·바닥·코팅·소재·치수", "미확인 열원 호환, 불꽃, 완성 음식"],
  ["home-tableware", "컵·그릇·접시·식기", "머그|도자기컵|접시|그릇|식기|mug cup|plate|bowl|tableware|マグカップ|食器", "차분한 식사 테이블", "무광 식탁 상판", "전체 형태·손잡이·입구·실제 용량", "음식·음료 내용물 창작, 내열 성능 암시"],
  ["kitchen-knife", "주방칼·가위·필러", "주방칼|식도|과도|주방가위|필러|chef knife|kitchen scissors|peeler|包丁", "날을 안전하게 눕혀 확인하는 조리도구 검수대", "반사와 미끄럼을 억제한 건조 상판", "날·팁·손잡이·결합부·커버·길이", "손·절단 장면·상처·절삭 성능 과장"],
  ["kitchen-cutting-board", "도마", "도마|커팅보드|cutting board|chopping board|まな板", "도마 양면을 확인하는 넓은 조리 준비대", "표면 질감이 보이는 건조 평면", "표면·모서리·홈·손잡이·두께", "음식·칼·항균 효과·칼자국 창작"],
  ["kitchen-utensil", "주걱·국자·집게·조리도구", "주걱|국자|집게|거품기|뒤집개|조리도구|spatula|ladle|tongs|whisk|調理器具", "도구 구성을 펼쳐 확인하는 조리 준비대", "헤드와 손잡이가 구분되는 단색 상판", "헤드·손잡이·이음부·길이·구성", "조리 중 음식·불꽃·도구 추가"],
  ["kitchen-food-container", "밀폐용기·도시락통", "밀폐용기|보관용기|도시락통|반찬통|food container|lunch box|保存容器", "용기와 뚜껑을 확인하는 주방 정리대", "투명 재질 경계가 보이는 중립 상판", "패킹·클립·칸막이·바닥·용량", "음식 수납·밀폐·누수 성능 창작"],
  ["kitchen-bottle", "물병·텀블러·보온병", "텀블러|물병|보온병|보냉병|tumbler bottle|water bottle|thermos|タンブラー|水筒", "마개와 입구를 확인하는 음료 준비대", "결로 없는 건조한 무광 상판", "입구·패킹·밸브·손잡이·용량", "음료·김·결로·보온보냉 성능 창작"],
  ["kitchen-bakeware", "베이킹틀·오븐팬", "베이킹틀|케이크틀|오븐팬|베이킹팬|bakeware|cake pan|oven tray|焼き型", "베이킹 도구를 확인하는 건조 작업대", "코팅과 모서리가 보이는 밝은 상판", "코팅·모서리·잠금·깊이·치수", "반죽·완성 빵·오븐 열기 창작"],
  ["kitchen-coffee-tea-tool", "드리퍼·주전자·티도구", "드리퍼|커피드리퍼|티포트|주전자|핸드드립|coffee dripper|teapot|kettle|ドリッパー", "추출 도구를 확인하는 건조한 음료 작업대", "필터와 주둥이가 구분되는 무광 상판", "필터·밸브·주둥이·손잡이·용량", "커피·차·김·추출 성능 창작"],
  ["kitchen-textile", "앞치마·주방장갑·행주", "앞치마|주방장갑|오븐장갑|행주|apron|oven mitt|dish cloth|エプロン", "주방 섬유를 펼쳐 확인하는 건조 검수대", "봉제와 패턴이 선명한 넓은 평면", "끈·포켓·퀼팅·가장자리·구성", "사람 착용·불꽃·흡수·내열 성능 창작"],
  ["kitchen-sink-organizer", "식기건조대·싱크대 정리용품", "식기건조대|수세미대|싱크대선반|싱크정리|dish rack|sink organizer|スポンジラック", "배수 구조를 확인하는 빈 싱크 주변 작업대", "물이 고이지 않은 건조한 상판", "배수구·발·와이어·흡착·치수", "젖은 식기·곰팡이 전후·하중 성능 창작"],
  ["kitchen-small-appliance", "소형 주방가전", "믹서기|블렌더|토스터|전기포트|커피머신|에어프라이어|blender|toaster|electric kettle|air fryer|調理家電", "전원 연결 없이 가전을 확인하는 주방 검수대", "조작부가 선명한 넓은 건조 상판", "버튼·포트·용기·부속·정격·모델", "작동 중 음식·불꽃·증기·성능 결과 창작"],
  ["home-fragrance", "디퓨저·캔들", "디퓨저|향초|캔들|diffuser|scented candle|ディフューザー", "휴식 공간의 사이드 테이블", "차분한 무광 콘솔 상판", "용기·밀봉·실제 구성", "불붙인 심지, 미확인 향료 식물"],
  ["digital-phone", "휴대폰 케이스·액세서리", "폰케이스|휴대폰케이스|스마트폰케이스|phone case|スマホケース", "모바일 기기를 정리하는 책상", "매끄러운 중립색 데스크", "포트·버튼 구멍·호환 모델", "미확인 휴대폰 삽입, 충격·방수 성능 시각화"],
  ["digital-power", "충전기·케이블·보조배터리", "충전기|충전케이블|보조배터리|charger|charging cable|power bank|充電器", "기기 연결을 준비하는 데스크", "무광 기술 제품 검수 상판", "커넥터·포트·정격·실제 구성", "스파크, 연결 성능 창작, 미확인 어댑터"],
  ["digital-audio", "이어폰·헤드폰·스피커", "이어폰|헤드폰|스피커|earbuds|headphones|speaker|イヤホン", "음악 감상 준비용 책상", "차분한 무광 데스크", "유닛·조작부·연결 사양·구성", "음질 시각화, 미확인 착용과 케이스"],
  ["digital-computer", "키보드·마우스·PC 주변기기", "키보드|마우스|노트북거치대|keyboard|computer mouse|laptop stand|キーボード", "업무용 책상의 정리 영역", "넓은 데스크 상판", "키 배열·포트·크기·재질", "키 인쇄 변경, 미확인 화면과 주변기기 추가"],
  ["digital-camera", "카메라·촬영용품", "카메라|삼각대|camera|tripod|カメラ", "촬영 장비 준비용 작업대", "정돈된 장비 검수 상판", "마운트·버튼·실제 구성", "미확인 렌즈와 결합, 성능·촬영 결과 창작"],
  ["pet-treat", "반려동물 사료·간식", "강아지간식|고양이간식|반려동물사료|사료|dog treats|cat treats|pet food|dog food|ペットフード", "반려동물 용품을 정리하는 선반", "건조한 펫용품 정리 상판", "대상 동물·연령·급여 안내·성분", "사람 식탁, 사람이 먹는 모습, 미확인 알갱이와 반려동물"],
  ["pet-supplies", "반려동물 생활용품", "강아지장난감|고양이장난감|반려동물용품|리드줄|pet toy|leash|pet bed|ペット用品", "산책·돌봄 용품 준비 공간", "청결한 펫용품 검수 상판", "잠금·재질·크기·대상 동물", "아동용 장난감 연출, 미확인 동물 착용"],
  ["baby-care", "아기 돌봄·수유용품", "젖병|유아용품|기저귀|수유|baby bottle|diaper|nursing pad|哺乳瓶", "유아 돌봄용품의 청결한 정리대", "밝고 건조한 상판", "연령·구성·소재·세척 안내", "아기 입·착용 합성, 살균 성능 창작, 침대 안 소품"],
  ["toy-building", "블록·조립완구", "블록완구|조립완구|레고|building blocks|construction toy|ブロック", "조립 놀이를 준비하는 테이블", "넓고 정돈된 놀이 상판", "패키지·연령·실제 부품 수", "미확인 완성 모델, 부품 추가, 어린이 합성"],
  ["toy-game", "보드게임·퍼즐", "보드게임|직소퍼즐|카드게임|board game|jigsaw puzzle|card game|ボードゲーム", "테이블 놀이 준비 공간", "넓은 무광 게임 테이블", "박스·연령·실제 구성·규칙 표시", "미확인 카드와 판, 구성품 복제"],
  ["toy-plush", "인형·봉제완구", "봉제인형|인형|plush|stuffed toy|doll|ぬいぐるみ", "완구를 살펴보는 낮은 테이블", "부드러운 색의 무광 평면", "표정·봉제·크기·실제 구성", "얼굴 변경, 어린이 합성, 수량 추가"],
  ["office-stationery", "문구·노트·필기구", "노트|공책|필기구|볼펜|연필|펜세트|notebook stationery|pen set|pencil|stationery|文房具", "필기 준비용 정돈된 책상", "밝은 데스크 평면", "표지·촉·실제 색상·매수", "내지·필기 결과 창작, 읽을 수 없는 가짜 글자"],
  ["sport-fitness", "운동·요가용품", "요가매트|덤벨|운동밴드|폼롤러|yoga mat|dumbbell|resistance band|foam roller|ヨガマット", "운동을 준비하는 건조한 공간", "중립색 운동 준비 평면", "전체 형태·표면·실제 규격", "몸매 전후, 근육 효과, 미확인 사용 자세"],
  ["outdoor-camping", "캠핑·아웃도어", "캠핑|텐트|침낭|camping|tent|sleeping bag|キャンプ", "야외 장비를 점검하는 준비 공간", "건조한 장비 검수 상판", "실제 구성·수납 상태·소재", "미확인 설치 완성도, 방수·방염 연출"],
  ["tools-diy", "공구·DIY", "드라이버세트|전동드릴|렌치|작업공구|screwdriver|power drill|wrench|hand tools|工具", "정돈된 작업대", "내구성 있는 무광 작업 상판", "헤드·손잡이·결합부·구성", "불꽃, 위험한 사용, 성능 창작"],
  ["auto-accessory", "차량용품", "차량용|자동차용|car accessory|car mount|automotive|車用品", "차량용품 장착 준비 작업대", "중립색 장비 검수 상판", "장착부·크기·호환 표기", "미확인 차종 내부 장착, 운전 중 사용"],
  ["garden-plant", "원예·화분용품", "화분|원예|분갈이|plant pot|gardening|planter|園芸", "원예용품을 정리하는 작업대", "건조한 원예 검수 평면", "배수구·재질·실제 규격", "미확인 식물 포함, 성장 효과 전후"],
];
export const productSceneProfiles: readonly SceneProfile[] = rows.map(([id, label, aliases, context, surface, evidenceFocus, forbiddenContexts]) => ({id, label, aliases: aliases.split("|"), context, surface, evidenceFocus, forbiddenContexts}));
export const neutralProductSceneProfile: SceneProfile = {id:"unclassified",label:"미분류 상품",aliases:[],context:"실물 상품 검수 작업대",surface:"중립색 무광 상판",evidenceFocus:"제공된 실물의 형태·라벨·구성",forbiddenContexts:"추측한 사용 장소, 미확인 내용물·기능·소품"};

const normalized = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\s_–—-]+/gu," ").trim();
function matches(text: string, alias: string) {
  const term=normalized(alias);
  if (/^[a-z0-9 ]+$/.test(term)) return new RegExp(`(?:^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}(?:s|es)?(?:$|[^a-z])`,"u").test(text);
  return text.replaceAll(" ","").includes(term.replaceAll(" ",""));
}
function isFlavorOnlyNameMatch(name: string, alias: string) {
  const compactName=name.replaceAll(" ","");
  const compactAlias=normalized(alias).replaceAll(" ","");
  if (!["우유","milk","요거트","yogurt","치즈","cheese","커피","coffee","차","tea"].includes(compactAlias)) return false;
  const flavorPattern=new RegExp(`${compactAlias}(?:맛|향|flavou?r)`,"iu");
  if (!flavorPattern.test(compactName)) return false;
  return !/(?:우유제품|멸균우유|저지방우유|요거트|요구르트|치즈|milk drink|yogurt|cheese|coffee beans|ground coffee|tea bag)/iu.test(name);
}
export type SceneProfileSelection = {profile:SceneProfile; reason:string; matchedSignals:string[]; conflicts:string[]; confidence:"specific"|"category"|"fallback"};
export function resolveProductSceneProfile(input:{name:string;category?:string;features?:readonly string[];isHealthFunctionalFood?:boolean|null;channelCategories?:readonly SceneCategoryHint[]}):SceneProfileSelection {
  const name=normalized(input.name),category=normalized(input.category??"");
  const features=normalized((input.features??[]).join(" "));
  const hints=(input.channelCategories??[]).filter(h=>sceneCategoryChannels.includes(h.channel)).slice(0,32);
  const ranked=productSceneProfiles.map(profile=>{
    const signals:string[]=[];let score=0;
    for(const alias of profile.aliases){
      if(matches(name,alias)&&!isFlavorOnlyNameMatch(name,alias)){score=Math.max(score,100+Math.min(alias.length,30));signals.push(`name:${alias}`);}
      if(matches(category,alias)){score=Math.max(score,60+Math.min(alias.length,20));signals.push(`category:${alias}`);}
      // Features only corroborate an identity/category match: tea extract cannot classify a jelly as tea.
      if(matches(features,alias))signals.push(`feature:${alias}`);
      for(const hint of hints)if(matches(normalized([hint.name,...(hint.path??[])].filter(Boolean).join(" ")),alias)){score=Math.max(score,60+Math.min(alias.length,20));signals.push(`${hint.channel}:${hint.market??""}:${alias}`);}
    }
    // A broad catch-all may corroborate a subtype, but it must not outrank a concrete
    // dosage/form signal found deeper in the same category path.
    if(profile.id==="health-supplement"&&score>0)score=Math.max(1,score-20);
    return {profile,score,signals};
  }).filter(v=>v.score>0).sort((a,b)=>b.score-a.score||a.profile.id.localeCompare(b.profile.id));
  const petSignal=/강아지|고양이|반려동물|\b(?:pet|dog|cat)\b|ペット/.test(name+" "+category);
  const healthSignal=input.isHealthFunctionalFood===true||/건강기능식품|건기식|health functional food/.test(category);
  const scoped=petSignal
    ? ranked.filter(v=>v.profile.id.startsWith("pet-"))
    : healthSignal
      ? ranked.filter(v=>v.profile.id.startsWith("health-"))
      : ranked;
  const best=scoped[0];
  if(!best)return {profile:neutralProductSceneProfile,reason:"세부 상품형태를 확인할 단서가 없어 중립 제품 연출 사용",matchedSignals:[],conflicts:[],confidence:"fallback"};
  const conflicts=scoped.filter(v=>v!==best&&v.score>=60&&v.profile.id.split("-")[0]!==best.profile.id.split("-")[0]).map(v=>v.profile.id);
  const bestFamily=best.profile.id.split("-")[0];
  const ambiguous=scoped.filter(v=>v!==best&&best.score<100&&best.score-v.score<=3&&v.profile.id.split("-")[0]!==bestFamily);
  if(ambiguous.length)return {profile:neutralProductSceneProfile,reason:"복수 세부 카테고리가 비슷하게 일치하여 상품명 확인 전 중립 연출 사용",matchedSignals:best.signals,conflicts:[...new Set([...conflicts,...ambiguous.map(v=>v.profile.id)])],confidence:"fallback"};
  if(best.score<100&&conflicts.length)return {profile:neutralProductSceneProfile,reason:"카테고리 단서가 서로 충돌하여 사용 공간을 추측하지 않음",matchedSignals:best.signals,conflicts,confidence:"fallback"};
  return {profile:best.profile,reason:best.score>=100?"상품명의 세부 형태·용도를 우선하고 카테고리를 보조 근거로 사용":"제공된 세부 카테고리 명칭으로 상품군 선택",matchedSignals:best.signals,conflicts,confidence:best.score>=100?"specific":"category"};
}

export function formatSceneProfileBrief(selection:SceneProfileSelection){
  const p=selection.profile;
  return `상품 연출 프로필 ${PRODUCT_SCENE_PROFILE_VERSION}: ${p.id} (${p.label}). 선택 근거: ${selection.reason}. 제품 중심 연출을 먼저 만들고 필요한 경우에만 ${p.context} 맥락을 사용한다. 확인할 정보: ${p.evidenceFocus}. 제외할 연출: ${p.forbiddenContexts}. 라벨·바코드·제조정보 사진은 읽는 근거 영역에 배치하고 광고 연출의 대표 외관으로 사용하지 않는다. 추가 내용물·사용 결과·인체 적용은 제공된 사진 근거 없이 만들지 않는다. ${formatCategoryProductionGuideline(p.id)}`;
}
