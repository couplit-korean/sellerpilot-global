/** Creative routing only: never assigns marketplace category IDs or changes publication data. */
export const PRODUCT_SCENE_PROFILE_VERSION = "2026-09-07-v1";
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
  ["food-jelly-stick", "젤리스틱·휴대 젤리", "젤리스틱|스틱젤리|애사비|jelly stick|stick jelly|ゼリースティック", "간식을 챙기는 책상 가장자리", "패키지 색과 조화되는 무광 단색 상판", "정면 패키지·휴대 형태·실제 포 수·라벨", "주방 조리대, 냄비, 팬트리, 원료 사과 더미, 보이지 않은 낱개 젤리"],
  ["food-snack", "과자·쿠키·크래커", "과자|쿠키|비스킷|크래커|cookie|biscuit|cracker|snack|お菓子|クッキー", "간식 시간의 작은 라운지 테이블", "밝은 무광 테이블", "포장·맛 표기·확인된 구성", "조리 중인 주방, 미확인 내용물, 임의 접시 플레이팅"],
  ["food-chocolate", "초콜릿·캔디", "초콜릿|초콜렛|캔디|사탕|chocolate|candy|チョコレート|キャンディ", "선물 포장을 살펴보는 테이블", "차분한 무광 색지 상판", "포장 마감·종류·구성 수량", "녹은 초콜릿, 미확인 단면, 과장된 선물 구성"],
  ["food-nuts", "견과·건과일", "견과|아몬드|건과일|cashew|almond|mixed nuts|dried fruit|ナッツ", "휴대 간식을 정리하는 데스크", "내추럴 무광 목재 상판", "포장 단위·원재료·밀봉 상태", "조리 장면, 확인되지 않은 알맹이와 과일 더미"],
  ["food-cereal", "시리얼·그래놀라", "시리얼|그래놀라|오트밀|cereal|granola|oatmeal|シリアル", "아침 식사 준비용 테이블", "옅은 목재 식탁 상판", "포장·곡물 표시·구성량", "미확인 완성 시리얼, 우유가 쏟아지는 장면"],
  ["food-coffee-beans", "원두·분쇄커피", "원두|분쇄커피|coffee beans|ground coffee|コーヒー豆", "홈카페의 건조한 작업대", "짙은 목재 카페 상판", "원두 포장·로스팅 표시·중량", "미확인 원두 알갱이, 추출 결과, 다른 커피 상품"],
  ["food-coffee-instant", "스틱커피·캡슐커피", "스틱커피|커피믹스|인스턴트커피|캡슐커피|instant coffee|coffee capsule|coffee pod|インスタントコーヒー", "간단한 음료 준비 공간", "정돈된 카페 선반 상판", "호환 표기·실제 개수·개별 포장", "근거 없는 머신 호환, 미확인 캡슐 모양"],
  ["food-tea", "차·티백", "티백|녹차|홍차|허브티|보이차|tea bag|green tea|black tea|herbal tea|ティーバッグ|紅茶|緑茶", "차를 준비하는 작은 티 테이블", "은은한 질감의 찻상", "종류·포장·우림 안내의 실제 표시", "미확인 찻잎, 허구의 음료 색, 식품 효능 연출"],
  ["food-beverage", "병·캔·팩 음료", "주스|탄산수|탄산음료|캔음료|생수|juice|soda|sparkling water|bottled water|ジュース", "휴식 공간의 음료 테이블", "밝고 건조한 무광 상판", "밀봉 포장·용량·당류 표시", "미확인 냉장 보관, 물방울로 방수 암시, 추가 음료"],
  ["food-protein", "단백질 분말·바", "단백질|프로틴|protein powder|protein bar|プロテイン", "운동 준비 공간의 정리 벤치", "매트한 스포츠 벤치 상판", "성분표·포장·섭취 안내", "근육 변화, 체형 전후, 확인되지 않은 쉐이크나 스쿱"],
  ["food-rice", "쌀·잡곡", "백미|잡곡|쌀|rice grain|white rice|mixed grains|白米|雑穀", "건조한 식료품 정리 작업대", "내추럴 목재 정리 상판", "품종·중량·생산 정보 표시", "미확인 논과 산지, 임의 밥상"],
  ["food-noodles", "면·라면·파스타", "라면|파스타|스파게티|소면|ramen|noodles|pasta|spaghetti|ラーメン|パスタ", "식사 준비용 건조 조리대", "정돈된 밝은 조리 상판", "밀봉 제품·수량·조리 안내", "근거 없는 완성 요리, 재료 추가, 불꽃"],
  ["food-ready-meal", "즉석밥·즉석식품", "즉석밥|즉석식품|레토르트|cooked rice|ready meal|retort|ご飯パック", "간편 식사를 준비하는 테이블", "무광 식사 준비 상판", "밀봉 상태·조리법·내용량", "미확인 완성 음식, 포장을 임의로 연 장면"],
  ["food-condiment", "소스·오일·조미료", "소스|드레싱|식용유|올리브유|양념|조미료|sauce|dressing|olive oil|seasoning|調味料", "요리 준비용 작업대 가장자리", "어두운 무광 조리 상판", "용기·원료·용량·사용 안내", "미확인 재료와 요리, 향이나 효능 시각화"],
  ["food-baking", "베이킹 재료", "밀가루|베이킹파우더|베이킹믹스|flour|baking mix|baking powder|小麦粉", "베이킹 준비 작업대", "건조한 밝은 목재 상판", "포장·재료 종류·중량", "가루 날림, 미확인 완성 빵과 반죽"],
  ["food-canned", "통조림·병조림", "통조림|캔참치|참치캔|canned|tinned|缶詰", "상온 식품을 정리하는 작업대", "중립색 건조 상판", "밀봉 상태·원재료·내용량", "열린 캔, 미확인 내용물, 임의 조리 예시"],
  ["food-fresh", "신선 과일·채소", "생과일|신선과일|신선채소|fresh fruit|fresh vegetables|生鮮果物", "식재료 검수 테이블", "밝은 식재료 작업 상판", "실물의 크기 편차·표면 상태·구성", "촬영하지 않은 산지, 과장된 크기와 수량"],
  ["food-frozen", "냉동식품", "냉동|frozen food|frozen meal|冷凍", "냉동식품 포장 확인 작업대", "깨끗한 냉색 작업 상판", "냉동 표시·포장·보관 안내", "실온 장기 보관 암시, 미확인 해동 요리"],
  ["health-supplement", "영양제·건강기능식품", "영양제|건강기능식품|비타민|유산균|supplement|vitamin|probiotic|サプリメント", "밀봉 상품을 확인하는 조용한 정리대", "단정한 중립색 상판", "분류·용량·주의사항·밀봉 포장", "의료 공간, 복용 동작, 알약·캡슐 창작, 효과 전후"],
  ["beauty-serum", "세럼·앰플·에센스", "세럼|앰플|에센스|serum|ampoule|essence|美容液", "스킨케어를 정리하는 화장대", "매끄러운 무광 화장대 상판", "용기·라벨·제형은 실물 근거만", "피부 전후, 임의 성분 식물, 미확인 액체 방울"],
  ["beauty-toner", "토너·미스트", "화장수|페이셜토너|스킨토너|페이스미스트|facial toner|face mist|化粧水", "스킨케어 준비 화장대", "밝은 무광 상판", "용량·분사 구조·제품명", "프린터, 잉크, 미확인 분사와 물방울"],
  ["beauty-cream", "크림·로션", "보습크림|페이스크림|수분크림|로션|moisturizer|face cream|lotion|保湿クリーム", "저녁 스킨케어 정리 공간", "부드러운 중립색 상판", "용기·용량·마개·실제 표시", "피부 효과 전후, 제형 창작, 식품 크림 연출"],
  ["beauty-sunscreen", "선크림·선스틱", "선크림|선스틱|자외선차단|sunscreen|sunblock|日焼け止め", "외출 준비용 드레싱 콘솔", "밝은 건조 상판", "SPF 등 실제 표시·용기·휴대 형태", "검증되지 않은 차단 수치, 햇빛 효과 전후"],
  ["beauty-cleanser", "클렌저·세안제", "클렌저|클렌징|세안제|face wash|cleanser|cleansing|洗顔", "건조한 세안 준비 선반", "무광 세면 공간 선반", "용기·마개·사용 안내", "거품과 제형 창작, 피부 치료 효과"],
  ["beauty-mask", "마스크팩", "마스크팩|시트마스크|sheet mask|face mask pack|フェイスパック", "스킨케어 팩을 정리하는 화장대", "넓은 평면 화장대", "파우치 정면·실제 매수·표시", "미확인 시트 형태, 착용 얼굴, 피부 전후"],
  ["beauty-lip", "립스틱·립틴트", "립스틱|립틴트|립밤|lipstick|lip tint|lip balm|口紅", "메이크업 준비용 작은 화장대", "색 왜곡이 적은 무광 상판", "용기·실제 색상 번호·캡", "색상 스와치 창작, 입술 착색, 피부 톤 변경"],
  ["beauty-eye", "아이 메이크업", "마스카라|아이섀도|아이라이너|mascara|eyeshadow|eyeliner|アイシャドウ", "아이 메이크업 정리 공간", "중립색 메이크업 상판", "제품 타입·색상 표기·구성", "눈가 사용, 속눈썹 전후, 미확인 팔레트 내부"],
  ["beauty-tools", "화장 브러시·퍼프·뷰러", "메이크업브러시|화장브러시|퍼프|뷰러|makeup brush|makeup sponge|eyelash curler|ビューラー", "화장 도구 정리 테이블", "밝고 건조한 정리 상판", "도구 형태·모·실제 세트 구성", "얼굴 사용, 미확인 추가 도구"],
  ["beauty-hair", "샴푸·헤어케어", "샴푸|트리트먼트|헤어오일|컨디셔너|shampoo|conditioner|hair oil|シャンプー", "헤어케어를 정리하는 건조 선반", "방해 요소 없는 밝은 선반", "용기·펌프·용량", "탈모 치료, 모발 전후, 임의 거품"],
  ["beauty-body", "바디워시·핸드케어", "바디워시|핸드크림|핸드워시|비누|body wash|hand cream|hand wash|soap bar|石鹸", "개인 위생용품의 건조 정리대", "청결한 무광 상판", "실제 포장·용량·용도", "소독 효능 창작, 임의 피부 사용"],
  ["beauty-fragrance", "향수", "향수|perfume|eau de parfum|fragrance spray|香水", "외출 준비용 드레싱 테이블", "차분한 무광 드레싱 상판", "병·캡·라벨·용량", "미확인 향료 꽃, 분사 효과, 성분 암시"],
  ["fashion-tops", "티셔츠·셔츠·상의", "티셔츠|셔츠|블라우스|후드|t shirt|shirt|blouse|hoodie|Tシャツ", "의류를 정리하는 드레싱 작업대", "넓은 무광 의류 검수 상판", "실제 실루엣·봉제·소재·사이즈표", "미확인 착용 핏, 모델 신체 합성, 색상 변경"],
  ["fashion-bottoms", "바지·스커트", "청바지|슬랙스|스커트|바지|jeans|trousers|pants|skirt|ズボン", "의류 검수용 넓은 테이블", "색 재현이 중립적인 작업 상판", "기장·허리 구조·실제 사이즈", "착용 비율 조작, 허구 사이즈"],
  ["fashion-dress", "원피스·드레스", "원피스|드레스|dress|ワンピース", "드레스 실루엣을 확인하는 작업 공간", "넓은 무광 검수 평면", "실루엣·소매·밑단·소재", "모델 착용 창작, 임의 체형 보정"],
  ["fashion-outer", "재킷·코트", "재킷|자켓|코트|패딩|jacket|coat|parka|ジャケット", "외출 의류를 점검하는 드레싱 공간", "중립색 의류 정리 평면", "잠금·안감은 제공된 사진만·실루엣", "미확인 보온성 시각화, 착용 창작"],
  ["fashion-shoes", "신발", "운동화|스니커즈|구두|샌들|부츠|sneaker|shoes|sandals|boots|スニーカー", "외출 준비용 신발 검수 벤치", "단색 신발 검수 상판", "좌우 구성·밑창·측면·사이즈", "미확인 착화, 방수 연출, 상품 수량 복제"],
  ["fashion-bag", "가방·파우치", "백팩|핸드백|숄더백|크로스백|파우치|backpack|handbag|shoulder bag|pouch|バッグ", "외출 준비용 정리 콘솔", "밝고 넓은 건조 상판", "스트랩·잠금·수납은 실물 근거만", "미확인 수납물과 용량, 내부 구조 창작"],
  ["fashion-jewelry", "주얼리", "목걸이|귀걸이|팔찌|반지|necklace|earrings|bracelet|ring jewelry|ネックレス", "액세서리를 확인하는 드레싱 테이블", "색 재현이 중립적인 무광 평면", "장식·잠금·실제 소재·크기", "보석 등급 창작, 미확인 착용·선물 상자"],
  ["fashion-watch", "손목시계", "손목시계|wristwatch|腕時計", "시계를 준비하는 드레싱 콘솔", "무광 짙은 상판", "다이얼·밴드·측면·사양", "가짜 시각 표시, 방수 테스트, 미확인 착용"],
  ["home-bedding", "침구·쿠션", "이불|베개|침구|쿠션|bedding|duvet|pillow|cushion|寝具", "침실의 침구 정리 공간", "넓고 깨끗한 패브릭 검수 평면", "소재·봉제·구성·실제 패턴", "세트 수량 추가, 과장된 두께·푹신함"],
  ["home-towel", "수건·욕실 매트", "수건|타월|욕실매트|towel|bath mat|タオル", "린넨을 정리하는 건조 선반", "밝은 린넨 정리 상판", "올·마감·실제 수량", "흡수 성능 창작, 미확인 물 사용"],
  ["home-storage", "수납·정리용품", "수납함|정리함|서랍정리|storage box|organizer|収納", "집 안의 정리 작업 공간", "넓은 중립색 정리 상판", "개폐·구획·치수·구성", "허구 수납 용량, 미확인 내용물"],
  ["home-cleaning", "청소·세탁용품", "세제|청소솔|청소포|세탁|detergent|cleaning brush|laundry|洗剤", "청소용품을 준비하는 건조 작업대", "무광 유틸리티 상판", "용도·용량·도구 형태·주의사항", "식탁과 식품, 세정 전후, 살균 효능 창작"],
  ["home-cookware", "조리도구·냄비·팬", "프라이팬|냄비|조리도구|주걱|도마|frying pan|saucepan|cookware|cutting board|フライパン", "요리 준비 작업대", "정돈된 조리 상판", "손잡이·바닥·소재·치수", "미확인 열원 호환, 불꽃, 완성 음식"],
  ["home-tableware", "컵·식기·텀블러", "머그|컵|텀블러|접시|식기|mug|drinkware|tumbler|plate|tableware|マグカップ", "차분한 식사 테이블", "무광 식탁 상판", "전체 형태·손잡이·입구·실제 용량", "음료 내용물 창작, 내열 성능 암시"],
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
export type SceneProfileSelection = {profile:SceneProfile; reason:string; matchedSignals:string[]; conflicts:string[]; confidence:"specific"|"category"|"fallback"};
export function resolveProductSceneProfile(input:{name:string;category?:string;features?:readonly string[];isHealthFunctionalFood?:boolean|null;channelCategories?:readonly SceneCategoryHint[]}):SceneProfileSelection {
  const name=normalized(input.name),category=normalized(input.category??"");
  const features=normalized((input.features??[]).join(" "));
  const hints=(input.channelCategories??[]).filter(h=>sceneCategoryChannels.includes(h.channel)).slice(0,32);
  const ranked=productSceneProfiles.map(profile=>{
    const signals:string[]=[];let score=0;
    for(const alias of profile.aliases){
      if(matches(name,alias)){score=Math.max(score,100+Math.min(alias.length,30));signals.push(`name:${alias}`);}
      if(matches(category,alias)){score=Math.max(score,60+Math.min(alias.length,20));signals.push(`category:${alias}`);}
      // Features only corroborate an identity/category match: tea extract cannot classify a jelly as tea.
      if(matches(features,alias))signals.push(`feature:${alias}`);
      for(const hint of hints)if(matches(normalized([hint.name,...(hint.path??[])].filter(Boolean).join(" ")),alias)){score=Math.max(score,60+Math.min(alias.length,20));signals.push(`${hint.channel}:${hint.market??""}:${alias}`);}
    }
    return {profile,score,signals};
  }).filter(v=>v.score>0).sort((a,b)=>b.score-a.score||a.profile.id.localeCompare(b.profile.id));
  const petSignal=/강아지|고양이|반려동물|\b(?:pet|dog|cat)\b|ペット/.test(name+" "+category);
  const scoped=petSignal?ranked.filter(v=>v.profile.id.startsWith("pet-")):ranked;
  const best=scoped[0];
  if(!best)return {profile:neutralProductSceneProfile,reason:"세부 상품형태를 확인할 단서가 없어 중립 제품 연출 사용",matchedSignals:[],conflicts:[],confidence:"fallback"};
  const conflicts=scoped.filter(v=>v!==best&&v.score>=60&&v.profile.id.split("-")[0]!==best.profile.id.split("-")[0]).map(v=>v.profile.id);
  const ambiguous=scoped.filter(v=>v!==best&&best.score<100&&best.score-v.score<=3);
  if(ambiguous.length)return {profile:neutralProductSceneProfile,reason:"복수 세부 카테고리가 비슷하게 일치하여 상품명 확인 전 중립 연출 사용",matchedSignals:best.signals,conflicts:[...new Set([...conflicts,...ambiguous.map(v=>v.profile.id)])],confidence:"fallback"};
  if(best.score<100&&conflicts.length)return {profile:neutralProductSceneProfile,reason:"카테고리 단서가 서로 충돌하여 사용 공간을 추측하지 않음",matchedSignals:best.signals,conflicts,confidence:"fallback"};
  return {profile:best.profile,reason:best.score>=100?"상품명의 세부 형태·용도를 우선하고 카테고리를 보조 근거로 사용":"제공된 세부 카테고리 명칭으로 상품군 선택",matchedSignals:best.signals,conflicts,confidence:best.score>=100?"specific":"category"};
}

export function formatSceneProfileBrief(selection:SceneProfileSelection){
  const p=selection.profile;
  return `상품 연출 프로필 ${PRODUCT_SCENE_PROFILE_VERSION}: ${p.id} (${p.label}). 선택 근거: ${selection.reason}. 제품 중심 연출을 먼저 만들고 필요한 경우에만 ${p.context} 맥락을 사용한다. 확인할 정보: ${p.evidenceFocus}. 제외할 연출: ${p.forbiddenContexts}. 라벨·바코드·제조정보 사진은 읽는 근거 영역에 배치하고 광고 연출의 대표 외관으로 사용하지 않는다. 추가 내용물·사용 결과·인체 적용은 제공된 사진 근거 없이 만들지 않는다.`;
}
