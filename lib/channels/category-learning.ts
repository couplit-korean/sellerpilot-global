export type CategoryLearningExample = {
  product_name: string;
  category_id: string;
  category_path: string[];
  assignment_status: "pending" | "confirmed" | "rejected" | "stale";
  listing_success: boolean;
  permission_blocked: boolean;
  confirmed_at: string | null;
  published_at: string | null;
  blocked_at: string | null;
  updated_at: string;
};

export type CategoryLearningSignal = {
  confirmations: number;
  successfulListings: number;
  permissionBlocked: boolean;
  learnedFromHistory: boolean;
};

export type LearnableCategorySuggestion = {
  id: string;
  name: string;
  path: string[];
  confidence: number;
  leaf: boolean;
  learning?: CategoryLearningSignal;
};

const productKinds: Array<[string, RegExp]> = [
  ["beauty.lipstick", /(립스틱|립틴트|lip\s?(?:stick|tint)|口紅|リップスティック)/iu],
  ["beauty.mascara", /(마스카라|mascara|マスカラ)/iu],
  ["beauty.eyeshadow", /(아이\s?섀도|아이섀도|메이크업\s*팔레트|makeup\s*palette|eyeshadow|eye\s*shadow|アイシャドウ)/iu],
  ["beauty.brush", /(메이크업|화장|makeup|cosmetic|化粧|メイク).{0,12}(브러시|brush|ブラシ)|(브러시|brush|ブラシ).{0,12}(메이크업|화장|makeup|cosmetic|化粧|メイク)/iu],
  ["beauty.sponge", /(메이크업|화장|makeup|cosmetic|化粧|メイク).{0,12}(스펀지|퍼프|sponge|puff|スポンジ|パフ)|(스펀지|퍼프|sponge|puff|スポンジ|パフ).{0,12}(메이크업|화장|makeup|cosmetic|化粧|メイク)/iu],
  ["beauty.curler", /(뷰러|속눈썹\s*컬러|eyelash\s*curler|ビューラー)/iu],
  ["beauty.soap", /(고체\s*비누|세안\s*비누|soap\s*bar|facial\s*soap|洗顔せっけん|石鹸)/iu],
  ["beauty.toner", /(스킨\s*[·/]?\s*토너|토너|화장수|facial\s*toner|face\s*mist|toner\s*(?:&|and)\s*mists?|化粧水)/iu],
  ["beauty.cream", /(보습|스킨|페이스|moistur|skin|face|乳液).{0,12}(크림|cream|クリーム)|(크림|cream|クリーム).{0,12}(보습|스킨|페이스|moistur|skin|face|乳液)/iu],
  ["beauty.serum", /(세럼|에센스|앰플|serum|essence|ampoule|美容液)/iu],
  ["beauty.cleanser", /(클렌저|클렌징\s*(?:폼|오일|밤)|face\s*wash|cleanser|cleansing\s*(?:foam|oil|balm)|洗顔フォーム|クレンジング)/iu],
  ["food.cooked_rice", /(흰쌀밥|즉석\s*밥|cooked\s*rice|rice\s*meal|ご飯パック)/iu],
  ["food.rice", /(백미|쌀|white\s*rice|rice\s*grain|白米|米・雑穀)/iu],
  ["food.pasta", /(파스타|펜네|스파게티|pasta|penne|spaghetti|パスタ|ペンネ)/iu],
  ["food.flour", /(밀가루|flour|小麦粉)/iu],
  ["food.snack", /(과자|스낵|쿠키|비스킷|snack|cookie|biscuit|お菓子|クッキー)/iu],
  ["food.tea", /(녹차|홍차|허브티|green\s*tea|black\s*tea|herbal\s*tea|緑茶|紅茶)/iu],
  ["clothing.dress", /(원피스|미디\s*드레스|women'?s\s*dress|denim\s*dress|ワンピース)/iu],
  ["clothing.tshirt", /(티셔츠|반팔\s*티|t[\s-]?shirt|tee\s*shirt|Tシャツ)/iu],
  ["clothing.hoodie", /(후드|후디|hoodie|sweatshirt|パーカー)/iu],
  ["clothing.pants", /(바지|팬츠|슬랙스|pants|trousers|slacks|パンツ)/iu],
  ["clothing.shoes", /(신발|스니커|운동화|shoes?|sneakers?|スニーカー|シューズ)/iu],
  ["toy.plush", /(테디|곰인형|봉제\s*인형|teddy|plush|stuffed\s*toy|ぬいぐるみ)/iu],
  ["toy.train", /(장난감|완구|toy|wooden|원목|おもちゃ|木製).{0,12}(기차|열차|train|電車)|(기차|열차|train|電車).{0,12}(장난감|완구|toy|wooden|원목|おもちゃ|木製)/iu],
  ["toy.blocks", /(조립\s*블록|building\s*blocks?|block\s*toy|ブロック|積み木|(?:블록).{0,12}(?:장난감|완구)|(?:장난감|완구).{0,12}(?:블록))/iu],
  ["toy.car", /(장난감|완구|toy|miniature|미니).{0,12}(자동차|차량|car|vehicle|ミニカー)|(자동차|차량|car|vehicle|ミニカー).{0,12}(장난감|완구|toy|miniature|미니)/iu],
  ["toy.puzzle", /(퍼즐|직소|puzzle|jigsaw|パズル)/iu],
  ["toy.doll", /(인형|doll|ドール|人形)/iu],
  ["health.fish_oil", /(어유|오메가\s*3|fish\s*oil|omega\s*3|dha|epa|フィッシュオイル|オメガ3)/iu],
  ["health.vitamin", /(비타민|vitamin|ビタミン)/iu],
  ["health.calcium", /(칼슘|calcium|カルシウム)/iu],
  ["health.probiotic", /(유산균|프로바이오틱|probiotic|乳酸菌)/iu],
  ["health.collagen", /(콜라겐|collagen|コラーゲン)/iu],
  ["misc.tote", /(토트\s*(?:백|가방)|tote\s*bag|トートバッグ)/iu],
  ["misc.storage_box", /(수납|보관|storage|organizer|収納).{0,12}(박스|상자|box|bin|ケース)|(박스|상자|box|bin|ケース).{0,12}(수납|보관|storage|organizer|収納)/iu],
  ["misc.hanger", /(옷걸이|의류\s*행거|clothes?\s*hanger|衣類ハンガー|ハンガー)/iu],
  ["misc.mug", /(머그|에스프레소\s*컵|mug|espresso\s*cup|マグカップ)/iu],
  ["misc.umbrella", /(우산|umbrella|傘)/iu],
  ["misc.stationery", /(문구|노트|메모지|필기구|stationery|notebook|memo\s*pad|文房具|ノート)/iu],
];

const unrelatedCategoryRisks: Array<[RegExp, RegExp]> = [
  [/(반려|애완|펫|강아지|고양이|pet|dog|cat|ペット|犬用|猫用)/iu, /(반려|애완|펫|강아지|고양이|pet|dog|cat|ペット|犬用|猫用)/iu],
  [/(성인용\s*완구|성인\s*토이|adult\s*(?:toy|novelty)|sexual|sex\s*toy|アダルト\s*グッズ)/iu, /(성인용\s*완구|성인\s*토이|adult\s*(?:toy|novelty)|sexual|sex\s*toy|アダルト\s*グッズ)/iu],
  [/(유아|아기|베이비|임산부|baby|infant|maternity|ベビー|マタニティ)/iu, /(유아|아기|베이비|임산부|baby|infant|maternity|ベビー|マタニティ)/iu],
  [/(가전|기계|머신|appliance|machine|cooker|家電|炊飯器)/iu, /(가전|기계|머신|appliance|machine|cooker|家電|炊飯器)/iu],
  [/(코스튬|의상놀이|costume|cosplay|コスプレ)/iu, /(코스튬|의상놀이|costume|cosplay|コスプレ)/iu],
];

const ignoredTokens = new Set([
  "상품", "제품", "세트", "샘플", "등록", "테스트", "판매", "용품", "기본", "프리미엄",
  "product", "sample", "listing", "test", "set", "pack", "premium", "official", "new",
]);

function normalizedTokens(value: string) {
  return [...new Set(value
    .toLocaleLowerCase()
    .replace(/\[[^\]]*]/g, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1 && !ignoredTokens.has(token)))];
}

export function productLearningKey(value: string) {
  const kind = productKinds.find(([, pattern]) => pattern.test(value))?.[0];
  if (kind) return kind;
  const tokens = normalizedTokens(value).sort().slice(0, 6);
  return tokens.length ? `terms:${tokens.join("|")}` : "";
}

function sameProductKind(left: string, right: string) {
  const leftKey = productLearningKey(left);
  const rightKey = productLearningKey(right);
  if (!leftKey || !rightKey) return false;
  if (!leftKey.startsWith("terms:") || !rightKey.startsWith("terms:")) return leftKey === rightKey;
  const leftTokens = new Set(leftKey.slice(6).split("|").filter(Boolean));
  const rightTokens = new Set(rightKey.slice(6).split("|").filter(Boolean));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared >= 2 && shared / Math.min(leftTokens.size, rightTokens.size) >= 0.66;
}

export function categoryKindCompatibility(query: string, candidate: string) {
  const queryKey = productLearningKey(query);
  const candidateKinds = productKinds.filter(([, pattern]) => pattern.test(candidate)).map(([kind]) => kind);
  if (queryKey === "beauty.toner" && !/(토너|화장수|미스트|toners?|mists?|化粧水)/iu.test(candidate)) {
    return false;
  }
  if (queryKey && !queryKey.startsWith("terms:") && candidateKinds.length && !candidateKinds.includes(queryKey)) {
    const queryFamily = queryKey.split(".")[0];
    const candidateFamilies = new Set(candidateKinds.map((kind) => kind.split(".")[0]));
    if (!candidateFamilies.has(queryFamily)) return false;
    const broadHealthCategory = queryFamily === "health"
      && /(vitamins?\s*(?:&|and)?\s*supplements?|supplements?|건강식품|영양제|サプリメント)/iu.test(candidate);
    const broadToyVehicleCategory = queryFamily === "toy"
      && /(toy\s*vehicles?|완구\s*차량|작동완구|ミニカー・電車・飛行機)/iu.test(candidate);
    if (!broadHealthCategory && !broadToyVehicleCategory) return false;
  }
  for (const [queryRisk, candidateRisk] of unrelatedCategoryRisks) {
    if (!queryRisk.test(query) && candidateRisk.test(candidate)) return false;
  }
  return true;
}

function time(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function applyCategoryLearning(
  query: string,
  officialSuggestions: LearnableCategorySuggestion[],
  examples: CategoryLearningExample[],
) {
  const relevant = examples.filter((example) => sameProductKind(query, example.product_name));
  const categoryIds = new Set([...officialSuggestions.map((item) => item.id), ...relevant.map((item) => item.category_id)]);
  const learned = new Map<string, {
    confirmations: number;
    successes: number;
    latestSuccess: number;
    latestBlock: number;
    path: string[];
  }>();

  for (const categoryId of categoryIds) {
    const sameCategory = examples.filter((example) => example.category_id === categoryId);
    const matchingKind = relevant.filter((example) => example.category_id === categoryId);
    learned.set(categoryId, {
      confirmations: matchingKind.filter((example) => example.assignment_status === "confirmed" || example.listing_success).length,
      successes: matchingKind.filter((example) => example.listing_success).length,
      latestSuccess: Math.max(0, ...sameCategory.filter((example) => example.listing_success).map((example) => time(example.published_at ?? example.updated_at))),
      latestBlock: Math.max(0, ...sameCategory.filter((example) => example.permission_blocked).map((example) => time(example.blocked_at ?? example.updated_at))),
      path: matchingKind.find((example) => example.category_path.length)?.category_path ?? [],
    });
  }

  const result = officialSuggestions
    .filter((suggestion) => categoryKindCompatibility(query, `${suggestion.path.join(" ")} ${suggestion.name}`))
    .map((suggestion) => {
    const signal = learned.get(suggestion.id);
    const permissionBlocked = Boolean(signal?.latestBlock && signal.latestBlock > signal.latestSuccess);
    const successfulListings = signal?.successes ?? 0;
    const confirmations = signal?.confirmations ?? 0;
    const confidence = permissionBlocked
      ? Math.min(suggestion.confidence, 0.35)
      : successfulListings > 0
        ? Math.max(suggestion.confidence, Math.min(0.99, 0.93 + successfulListings * 0.02))
        : confirmations > 0
          ? Math.max(suggestion.confidence, Math.min(0.9, 0.8 + confirmations * 0.02))
          : suggestion.confidence;
    return {
      ...suggestion,
      confidence,
      learning: {
        confirmations,
        successfulListings,
        permissionBlocked,
        learnedFromHistory: successfulListings > 0 || confirmations > 0,
      },
    };
    });

  for (const [categoryId, signal] of learned) {
    const permissionBlocked = Boolean(signal.latestBlock && signal.latestBlock > signal.latestSuccess);
    if (result.some((item) => item.id === categoryId) || signal.successes === 0 || permissionBlocked) continue;
    const name = signal.path.at(-1) ?? categoryId;
    if (!categoryKindCompatibility(query, `${signal.path.join(" ")} ${name}`)) continue;
    result.push({
      id: categoryId,
      name,
      path: signal.path.length ? signal.path : [name],
      confidence: Math.min(0.99, 0.93 + signal.successes * 0.02),
      leaf: true,
      learning: {
        confirmations: signal.confirmations,
        successfulListings: signal.successes,
        permissionBlocked: false,
        learnedFromHistory: true,
      },
    });
  }

  return result
    .sort((left, right) => {
      const leftLearning = left.learning;
      const rightLearning = right.learning;
      if (Boolean(leftLearning?.permissionBlocked) !== Boolean(rightLearning?.permissionBlocked)) {
        return leftLearning?.permissionBlocked ? 1 : -1;
      }
      if ((leftLearning?.successfulListings ?? 0) !== (rightLearning?.successfulListings ?? 0)) {
        return (rightLearning?.successfulListings ?? 0) - (leftLearning?.successfulListings ?? 0);
      }
      if ((leftLearning?.confirmations ?? 0) !== (rightLearning?.confirmations ?? 0)) {
        return (rightLearning?.confirmations ?? 0) - (leftLearning?.confirmations ?? 0);
      }
      return right.confidence - left.confidence;
    })
    .slice(0, 5);
}
