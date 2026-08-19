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
  ["beauty.cream", /(보습|스킨|페이스|moistur|skin|face|乳液).{0,12}(크림|cream|クリーム)|(크림|cream|クリーム).{0,12}(보습|스킨|페이스|moistur|skin|face|乳液)/iu],
  ["food.cooked_rice", /(흰쌀밥|즉석\s*밥|cooked\s*rice|rice\s*meal|ご飯パック)/iu],
  ["food.rice", /(백미|쌀|white\s*rice|rice\s*grain|白米|米・雑穀)/iu],
  ["food.pasta", /(파스타|펜네|스파게티|pasta|penne|spaghetti|パスタ|ペンネ)/iu],
  ["food.flour", /(밀가루|flour|小麦粉)/iu],
  ["clothing.dress", /(원피스|미디\s*드레스|women'?s\s*dress|denim\s*dress|ワンピース)/iu],
  ["clothing.tshirt", /(티셔츠|반팔\s*티|t[\s-]?shirt|tee\s*shirt|Tシャツ)/iu],
  ["clothing.hoodie", /(후드|후디|hoodie|sweatshirt|パーカー)/iu],
  ["toy.plush", /(테디|곰인형|봉제\s*인형|teddy|plush|stuffed\s*toy|ぬいぐるみ)/iu],
  ["toy.train", /(장난감|완구|toy|wooden|원목|おもちゃ|木製).{0,12}(기차|열차|train|電車)|(기차|열차|train|電車).{0,12}(장난감|완구|toy|wooden|원목|おもちゃ|木製)/iu],
  ["toy.blocks", /(조립\s*블록|building\s*blocks?|block\s*toy|ブロック|積み木|(?:블록).{0,12}(?:장난감|완구)|(?:장난감|완구).{0,12}(?:블록))/iu],
  ["toy.car", /(장난감|완구|toy|miniature|미니).{0,12}(자동차|차량|car|vehicle|ミニカー)|(자동차|차량|car|vehicle|ミニカー).{0,12}(장난감|완구|toy|miniature|미니)/iu],
  ["health.fish_oil", /(어유|오메가\s*3|fish\s*oil|omega\s*3|dha|epa|フィッシュオイル|オメガ3)/iu],
  ["health.vitamin", /(비타민|vitamin|ビタミン)/iu],
  ["health.calcium", /(칼슘|calcium|カルシウム)/iu],
  ["misc.tote", /(토트\s*(?:백|가방)|tote\s*bag|トートバッグ)/iu],
  ["misc.storage_box", /(수납|보관|storage|organizer|収納).{0,12}(박스|상자|box|bin|ケース)|(박스|상자|box|bin|ケース).{0,12}(수납|보관|storage|organizer|収納)/iu],
  ["misc.hanger", /(옷걸이|의류\s*행거|clothes?\s*hanger|衣類ハンガー|ハンガー)/iu],
  ["misc.mug", /(머그|에스프레소\s*컵|mug|espresso\s*cup|マグカップ)/iu],
  ["misc.umbrella", /(우산|umbrella|傘)/iu],
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

  const result = officialSuggestions.map((suggestion) => {
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
