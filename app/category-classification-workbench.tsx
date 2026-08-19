"use client";

import { AlertTriangle, BadgeCheck, Check, ChevronRight, LoaderCircle, RefreshCw, Search, ShieldCheck, Tags } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeChannelKeys, channelCatalog, type ActiveChannelKey } from "../lib/channels/catalog";
import {
  applyCategoryLearning,
  categoryKindCompatibility,
  type CategoryLearningExample,
  type LearnableCategorySuggestion,
} from "../lib/channels/category-learning";
import { channelMarket } from "../lib/channels/markets";
import { createClient } from "../lib/supabase/client";
import { userFacingErrorMessage } from "../lib/user-facing-errors";
import { fetchChannelTargets } from "./channel-target-client";

type CredentialRow = {
  id: string;
  channel: ActiveChannelKey;
  environment: "sandbox" | "production";
  status: string;
};

type OperationStep = { name: string; ok: boolean; status: number; data: Record<string, unknown> };
type OperationPayload = { ok?: boolean; steps?: OperationStep[]; message?: string };
type CategorySuggestion = LearnableCategorySuggestion;
type CategoryAttribute = { id: string; name: string; required: boolean; values: Array<{ id: string; name: string }> };
type ChannelTarget = { targetId: string; displayName: string; marketCode: string; locale: string; language: string; currency: string; status?: string };
type LocalizedListing = { channel: "shopee" | "lazada"; market: string; locale: string; title: string; shortDescription: string; description: string; keywords: string[] };
type ChannelState = {
  phase: "idle" | "suggesting" | "inspecting" | "ready" | "confirmed" | "error";
  suggestions: CategorySuggestion[];
  selected?: CategorySuggestion;
  attributes: CategoryAttribute[];
  values: Record<string, string>;
  verifiedLeaf: boolean;
  manualCategoryId: string;
  manualCategoryName: string;
  manualCategoryPath: string;
  error?: string;
};

const initialState = (): ChannelState => ({
  phase: "idle",
  suggestions: [],
  attributes: [],
  values: {},
  verifiedLeaf: false,
  manualCategoryId: "",
  manualCategoryName: "",
  manualCategoryPath: "",
});

function records(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 8 || value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item) => records(item, depth + 1));
  if (typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  return [row, ...Object.values(row).flatMap((item) => records(item, depth + 1))];
}

function text(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function booleanValue(row: Record<string, unknown>, keys: string[], fallback: boolean) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "Y" || value === "MANDATORY") return true;
    if (value === 0 || value === "0" || value === "N" || value === "OPTIONAL") return false;
  }
  return fallback;
}

function queryScore(query: string, candidate: string) {
  const words = query.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 1);
  const haystack = candidate.toLocaleLowerCase();
  const matched = words.filter((word) => haystack.includes(word)).length;
  return words.length ? matched / words.length : 0;
}

export function sanitizeCategoryQuery(value: string) {
  return value
    .replace(/\[(?:(?:api|program)\s*test|업로드\s*테스트)[^\]]*\]/giu, " ")
    .replace(/\b(?:api|program)\s*test\b/giu, " ")
    .replace(/(?:판매\s*금지|섭취\s*금지|샘플\s*등록|not\s*for\s*sale|do\s*not\s*(?:sell|consume))/giu, " ")
    .replace(/이미지\s*샘플(?:\s*\d+차)?/gu, " ")
    .replace(/[·|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function englishCategoryQuery(value: string) {
  const normalized = value.toLocaleLowerCase();
  const aliases: Array<[RegExp, string]> = [
    [/(립스틱|lipstick)/u, "lipstick"],
    [/(브러시|brush)/u, "makeup brush set"],
    [/(흰쌀밥|백미|쌀|rice)/u, "white rice"],
    [/(펜네|파스타|penne|pasta)/u, "penne pasta"],
    [/(원피스|데님.*드레스|dress(?:es)?)/u, "women's dress"],
    [/(티셔츠|t[\s-]?shirt)/u, "white t-shirt"],
    [/(후드|hood)/u, "hoodie"],
    [/(테디|곰인형|teddy|plush)/u, "teddy bear plush toy"],
    [/(장난감.*자동차|자동차.*장난감|toy\s*car)/u, "toy car"],
    [/(원목.*기차|기차|열차|wooden\s*train|toy\s*train)/u, "wooden toy train"],
    [/(컬러.*블록|블록|blocks?|building\s*set)/u, "building blocks toy"],
    [/(어유|오메가|fish\s*oil|omega)/u, "fish oil supplement"],
    [/(비타민|vitamin)/u, "vitamin supplement"],
    [/(캔버스.*토트|토트.*백|tote)/u, "canvas tote bag"],
    [/(수납.*박스|보관.*박스|storage\s*(?:box|bin))/u, "storage box"],
  ];
  return aliases.find(([pattern]) => pattern.test(normalized))?.[1] ?? value;
}

function isGenericFallbackTitle(value: string) {
  return /(?:sample product|sampel produk|listing test|ujian penyenaraian)/iu.test(value);
}

function lazadaQueryScore(query: string, candidate: string) {
  const words = query.toLocaleLowerCase().split(/[^a-z0-9]+/u).filter((word) => word.length > 1);
  const tokens = candidate.toLocaleLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
  const sameWord = (word: string, token: string) => word === token
    || `${word}s` === token
    || `${word}es` === token
    || word === `${token}s`
    || word === `${token}es`;
  const matched = words.filter((word) => tokens.some((token) => sameWord(word, token))).length;
  return words.length ? matched / words.length : 0;
}

function qoo10SearchTerms(query: string) {
  const normalized = query.toLocaleLowerCase();
  const aliases = [query];
  if (/(컵|머그|cup|mug|잔)/u.test(normalized)) aliases.push("マグカップ", "ティーカップ", "食器");
  if (/(에스프레소|커피|coffee|espresso)/u.test(normalized)) aliases.push("コーヒー");
  if (/(의류|옷|shirt|dress|팬츠|바지)/u.test(normalized)) aliases.push("服", "シャツ", "パンツ");
  if (/(원피스|dress(?:es)?)/u.test(normalized)) aliases.push("ワンピース", "ドレス", "レディース ワンピース");
  if (/(티셔츠|t[\s-]?shirt|반팔)/u.test(normalized)) aliases.push("Tシャツ", "カットソー", "トップス");
  if (/(후드|재킷|hood|jacket)/u.test(normalized)) aliases.push("パーカー", "ジャケット", "アウター", "服");
  if (/(화장품|스킨|크림|cosmetic|beauty)/u.test(normalized)) aliases.push("コスメ", "スキンケア", "クリーム");
  if (/(마스카라|mascara)/u.test(normalized)) aliases.push("マスカラ", "アイメイク", "ポイントメイク");
  if (/(아이섀도|팔레트|eye\s*shadow|eyeshadow|palette)/u.test(normalized)) aliases.push("アイシャドウ", "アイシャドウパレット", "ポイントメイク");
  if (/(비누|세정|soap|cleanser|cleansing)/u.test(normalized)) aliases.push("石鹸", "石鹼", "ボディソープ", "洗顔", "クレンジング");
  if (/(립스틱|립|lipstick|lip\s?care)/u.test(normalized)) aliases.push("口紅", "リップ", "リップケア", "メイクアップ");
  if (/(브러시|brush)/u.test(normalized)) aliases.push("メイクブラシ", "化粧ブラシ", "ブラシ");
  if (/(스펀지|퍼프|sponge|puff)/u.test(normalized)) aliases.push("メイクスポンジ", "化粧スポンジ", "パフ");
  if (/(뷰러|속눈썹|curler|eyelash)/u.test(normalized)) aliases.push("ビューラー", "まつ毛カーラー", "アイラッシュカーラー");
  if (/(쌀|밥|rice)/u.test(normalized)) aliases.push("米", "ご飯", "白米", "米・雑穀");
  if (/(파스타|펜네|pasta|penne)/u.test(normalized)) aliases.push("パスタ", "ペンネ", "乾麺");
  if (/(밀가루|flour)/u.test(normalized)) aliases.push("小麦粉", "粉類", "製菓材料");
  if (/(가방|백|bag)/u.test(normalized)) aliases.push("バッグ");
  if (/(신발|슈즈|shoe|sneaker)/u.test(normalized)) aliases.push("シューズ", "スニーカー");
  if (/(테디|곰인형|봉제|teddy|plush)/u.test(normalized)) aliases.push("テディベア", "ぬいぐるみ", "おもちゃ");
  if (/(자동차.*완구|완구.*자동차|장난감.*차|toy\s?car|miniature\s?car)/u.test(normalized)) aliases.push("ミニカー", "車のおもちゃ", "おもちゃ");
  if (/(완구|장난감|toy)/u.test(normalized)) aliases.push("おもちゃ", "玩具");
  if (/(기차|열차|train)/u.test(normalized)) aliases.push("電車のおもちゃ", "木製玩具", "知育玩具");
  if (/(블록|blocks?)/u.test(normalized)) aliases.push("ブロック", "積み木", "知育玩具");
  if (/(어유|오메가|fish\s?oil|omega|オメガ|フィッシュオイル|dha|epa)/u.test(normalized)) aliases.push("DHA・EPA", "DHA", "EPA", "オメガ3", "フィッシュオイル");
  if (/(비타민|vitamin|ビタミン)/u.test(normalized)) aliases.push("その他ビタミン", "ビタミン", "サプリメント", "健康食品");
  if (/(칼슘|calcium)/u.test(normalized)) aliases.push("カルシウム", "ミネラル", "サプリメント", "健康食品");
  if (/(건강식품|보충제|supplement)/u.test(normalized)) aliases.push("サプリメント", "健康食品");
  if (/(수납.*박스|보관.*박스|storage\s?(?:box|bin)|organizer)/u.test(normalized)) aliases.push("収納ボックス", "収納ケース", "収納用品");
  if (/(옷걸이|행거|hanger|ハンガー)/u.test(normalized)) aliases.push("ハンガー", "衣類ハンガー", "衣類収納");
  if (/(우산|umbrella)/u.test(normalized)) aliases.push("傘", "雨具", "ファッション雑貨");
  return aliases.join(" ");
}

function qoo10PriorityTerms(query: string) {
  const normalized = query.toLocaleLowerCase();
  if (/(립스틱|lipstick)/u.test(normalized)) return ["リップスティック", "口紅"];
  if (/(마스카라|mascara)/u.test(normalized)) return ["マスカラ"];
  if (/(아이섀도|팔레트|eye\s*shadow|eyeshadow|palette)/u.test(normalized)) return ["アイシャドウパレット", "アイシャドウ"];
  if (/(고체.*비누|비누|soap)/u.test(normalized)) return ["洗顔せっけん", "石鹸", "石鹼"];
  if (/(보습.*크림|스킨.*크림|moistur)/u.test(normalized)) return ["乳液・クリーム"];
  if (/(브러시|brush)/u.test(normalized)) return ["メイクブラシ", "化粧ブラシ"];
  if (/(스펀지|퍼프|sponge|puff)/u.test(normalized)) return ["メイクスポンジ", "化粧スポンジ", "パフ"];
  if (/(뷰러|속눈썹|curler|eyelash)/u.test(normalized)) return ["ビューラー"];
  if (/(흰쌀밥|밥|cooked\s?rice)/u.test(normalized)) return ["ご飯パック", "白米", "米・雑穀", "米"];
  if (/(흰쌀|백미|rice)/u.test(normalized)) return ["白米", "米・雑穀", "米"];
  if (/(펜네|penne)/u.test(normalized)) return ["ペンネ", "パスタ"];
  if (/(파스타|pasta)/u.test(normalized)) return ["パスタ"];
  if (/(밀가루|flour)/u.test(normalized)) return ["小麦粉"];
  if (/(원피스|dress(?:es)?)/u.test(normalized)) return ["ワンピース", "シャツワンピ", "ドレス"];
  if (/(티셔츠|t[\s-]?shirt|반팔)/u.test(normalized)) return ["Tシャツ・カットソー", "Tシャツ"];
  if (/(후드|hood)/u.test(normalized)) return ["パーカー", "フード付きジャケット", "ジャケット"];
  if (/(재킷|jacket)/u.test(normalized)) return ["ジャケット", "アウター"];
  if (/(테디|곰인형|teddy)/u.test(normalized)) return ["テディベア", "ぬいぐるみ"];
  if (/(기차|열차|train)/u.test(normalized)) return ["電車・汽車・レール", "電車のおもちゃ", "鉄道玩具", "木製玩具"];
  if (/(블록|blocks?)/u.test(normalized)) return ["ブロック", "積み木"];
  if (/(자동차.*완구|완구.*자동차|toy\s?car)/u.test(normalized)) return ["ミニカー", "車のおもちゃ"];
  if (/(어유|오메가|fish\s?oil|omega|オメガ|フィッシュオイル|dha|epa)/u.test(normalized)) return ["DHA・EPA", "DHA", "EPA", "オメガ3", "フィッシュオイル"];
  if (/(비타민|vitamin|ビタミン)/u.test(normalized)) return ["その他ビタミン", "ビタミン"];
  if (/(칼슘|calcium)/u.test(normalized)) return ["カルシウム", "ミネラル"];
  if (/(캔버스.*토트|토트.*백|tote)/u.test(normalized)) return ["トートバッグ"];
  if (/(수납.*박스|storage\s?(?:box|bin))/u.test(normalized)) return ["収納ボックス", "収納ケース"];
  if (/(옷걸이|행거|hanger|ハンガー)/u.test(normalized)) return ["衣類ハンガー", "ハンガー"];
  if (/(컵|머그|cup|mug)/u.test(normalized)) return ["マグカップ・ティーカップ", "マグカップ"];
  if (/(우산|umbrella)/u.test(normalized)) return ["傘"];
  return [];
}

function qoo10PriorityScore(query: string, candidate: CategorySuggestion) {
  const name = candidate.name.toLocaleLowerCase();
  const path = candidate.path.join(" ").toLocaleLowerCase();
  if (/(옷걸이|행거|hanger|ハンガー)/u.test(query.toLocaleLowerCase()) && name === "ハンガー".toLocaleLowerCase() && path.includes("洗濯用品".toLocaleLowerCase())) return 500;
  const terms = qoo10PriorityTerms(query);
  for (let index = 0; index < terms.length; index += 1) {
    const term = terms[index].toLocaleLowerCase();
    const termRank = terms.length - index;
    if (name === term) return 300 + termRank;
    if (name.includes(term)) return 200 + termRank;
    if (path.includes(term)) return 100 + termRank;
  }
  return 0;
}

function qoo10CategoryCompatibility(query: string, candidate: CategorySuggestion) {
  const path = candidate.path.join(" ").toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  if (!/(ふるさと納税|고향세)/u.test(normalizedQuery) && path.includes("ふるさと納税")) return false;
  if (/(teddy|plush|stuffed|테디|곰인형|봉제)/u.test(normalizedQuery) && /(犬用品|猫用品|ペット)/u.test(candidate.path.join(" "))) return false;
  if (/(원목.*기차|기차|열차|wooden\s*train|toy\s*train)/u.test(normalizedQuery)) {
    return /(電車|鉄道|列車|トレイン|木製玩具|知育玩具)/u.test(candidate.path.join(" "));
  }
  if (/(컬러.*블록|블록|blocks?|building\s*set)/u.test(normalizedQuery)) {
    return /(ブロック|積み木|組み立て|知育玩具)/u.test(candidate.path.join(" "));
  }
  return queryScore(qoo10SearchTerms(query), `${candidate.path.join(" ")} ${candidate.name}`) > 0;
}

function shopeeSearchTerms(query: string) {
  const normalized = query.toLocaleLowerCase();
  const aliases = [query];
  if (/(cup|mug|espresso|컵|머그|잔)/u.test(normalized)) aliases.push("mug cups drinkware dinnerware coffee tea");
  if (/(shirt|dress|pants|clothes|의류|옷|바지)/u.test(normalized)) aliases.push("fashion apparel tops bottoms clothing");
  if (/(원피스|dress(?:es)?)/u.test(normalized)) aliases.push("women dresses dress fashion clothing");
  if (/(t[\s-]?shirt|tee|티셔츠|반팔)/u.test(normalized)) aliases.push("t-shirt tee shirts tops");
  if (/(hoodie|hood|jacket|후드|재킷)/u.test(normalized)) aliases.push("hoodies sweatshirts jackets outerwear clothing");
  if (/(cosmetic|beauty|skin|cream|화장품|스킨|크림)/u.test(normalized)) aliases.push("beauty skincare makeup cosmetics");
  if (/(soap|cleanser|cleansing|wash|비누|세정)/u.test(normalized)) aliases.push("soap cleanser cleansing bath body wash skincare");
  if (/(brush|브러시)/u.test(normalized)) aliases.push("makeup brushes beauty tools");
  if (/(sponge|puff|스펀지|퍼프)/u.test(normalized)) aliases.push("makeup sponges puffs beauty tools");
  if (/(curler|eyelash|뷰러|속눈썹)/u.test(normalized)) aliases.push("eyelash curlers makeup tools");
  if (/(rice|쌀|밥)/u.test(normalized)) aliases.push("rice instant rice food staples ready meals");
  if (/(pasta|penne|파스타|펜네)/u.test(normalized)) aliases.push("pasta noodles penne food staples");
  if (/(flour|밀가루)/u.test(normalized)) aliases.push("flour baking cooking ingredients food staples");
  if (/(teddy|plush|stuffed|테디|곰인형|봉제)/u.test(normalized)) aliases.push("teddy bears plush stuffed toys");
  if (/(toy\s?car|자동차.*완구|완구.*자동차|장난감.*차)/u.test(normalized)) aliases.push("toy cars vehicles toys");
  if (/(wooden\s*train|toy\s*train|기차|열차)/u.test(normalized)) aliases.push("toy trains train sets railway wooden toys vehicles");
  if (/(building\s*blocks?|blocks?|블록)/u.test(normalized)) aliases.push("building blocks block toys construction toys building toys bricks educational toys");
  if (/(fish\s?oil|omega|어유|오메가|dha|epa)/u.test(normalized)) aliases.push("fish oil omega 3 vitamins supplements health");
  if (/(vitamin|비타민)/u.test(normalized)) aliases.push("vitamins supplements health");
  if (/(tote|canvas|캔버스.*토트|토트백)/u.test(normalized)) aliases.push("tote bags fashion bags");
  if (/(storage\s?(?:box|bin)|organizer|수납.*박스|보관.*박스)/u.test(normalized)) aliases.push("storage boxes organizers home organization");
  if (/(hanger|옷걸이|행거)/u.test(normalized)) aliases.push("clothes hangers laundry organization home living");
  if (/(bag|pouch|가방|백)/u.test(normalized)) aliases.push("bags luggage accessories");
  if (/(shoe|sneaker|sandal|신발|슈즈)/u.test(normalized)) aliases.push("shoes sneakers footwear sandals");
  return aliases.join(" ");
}

function shopeeCategoryCompatibility(query: string, candidate: string) {
  const normalizedQuery = query.toLocaleLowerCase();
  const normalizedCandidate = candidate.toLocaleLowerCase().trim();
  const exactOrLeaf = (term: string) => normalizedCandidate === term
    || normalizedCandidate.endsWith(`> ${term}`)
    || normalizedCandidate.endsWith(`› ${term}`)
    || normalizedCandidate.endsWith(`/ ${term}`);

  if (/(rice|쌀|밥)/u.test(normalizedQuery)) {
    if (/(rice\s+cooker|appliance)/u.test(normalizedCandidate)) return false;
    return exactOrLeaf("rice") || /(food|beverage|staple|instant rice|ready meal)/u.test(normalizedCandidate);
  }
  if (/(pasta|penne|파스타|펜네)/u.test(normalizedQuery)) {
    if (/(pasta\s+(maker|machine)|appliance)/u.test(normalizedCandidate)) return false;
    return exactOrLeaf("pasta") || /(food|beverage|staple|noodle|penne)/u.test(normalizedCandidate);
  }
  if (/(flour|밀가루)/u.test(normalizedQuery)) {
    if (/(flour\s+mill|appliance)/u.test(normalizedCandidate)) return false;
    return exactOrLeaf("flour") || /(food|beverage|baking|cooking ingredient|staple)/u.test(normalizedCandidate);
  }
  if (/(teddy|plush|stuffed|테디|곰인형|봉제)/u.test(normalizedQuery)) {
    return /(plush|stuffed|teddy)/u.test(normalizedCandidate) && !/(sex|pet|bird)/u.test(normalizedCandidate);
  }
  if (/(toy\s?car|자동차.*완구|완구.*자동차|자동차.*장난감|장난감.*차)/u.test(normalizedQuery)) {
    return /(toy vehicle|toy car|vehicle playset|diecast)/u.test(normalizedCandidate)
      && !/(sex|pet|bird)/u.test(normalizedCandidate);
  }
  if (/(wooden\s*train|toy\s*train|기차|열차)/u.test(normalizedQuery)) {
    return /(toy trains?|train sets?|railway|wooden toys?|toy vehicles?|vehicle toys?)/u.test(normalizedCandidate)
      && !/(sex|pet|shoe|performance enhancement)/u.test(normalizedCandidate);
  }
  if (/(building\s*blocks?|blocks?|블록)/u.test(normalizedQuery)) {
    return /(building blocks?|block toys?|construction (?:sets?|toys?)|building toys?|stacking blocks?|bricks?|educational toys?)/u.test(normalizedCandidate)
      && !/(sex|pet|engine|motor)/u.test(normalizedCandidate);
  }
  if (/(fish\s?oil|omega|어유|오메가|dha|epa|vitamin|비타민)/u.test(normalizedQuery)) {
    return /(health|wellness|vitamin|supplement|fish oil|omega|dha|epa)/u.test(normalizedCandidate)
      && !/(pet|animal feed)/u.test(normalizedCandidate);
  }
  if (/(sponge|puff|스펀지|퍼프)/u.test(normalizedQuery)) {
    return /(sponge|puff|applicator)/u.test(normalizedCandidate) && !/(cleaner|brush)/u.test(normalizedCandidate);
  }
  if (/(brush|브러시)/u.test(normalizedQuery)) {
    return /(makeup brush|cosmetic brush)/u.test(normalizedCandidate) && !/(cleaner|bag|organizer)/u.test(normalizedCandidate);
  }
  if (/(cream|moistur|크림|보습)/u.test(normalizedQuery)) {
    return /(moistur|face cream|facial cream|skin care)/u.test(normalizedCandidate) && !/(supplement|tool|brush)/u.test(normalizedCandidate);
  }
  if (/(curler|eyelash|뷰러|속눈썹)/u.test(normalizedQuery)) {
    return /(eyelash curler|lash curler)/u.test(normalizedCandidate);
  }
  if (/(cosmetic|beauty|skin|화장품|스킨)/u.test(normalizedQuery)) {
    return /(beauty|personal care|makeup|cosmetic|skin care)/u.test(normalizedCandidate);
  }
  if (/(hoodie|hood|후드)/u.test(normalizedQuery)) {
    return /(hoodie|sweatshirt)/u.test(normalizedCandidate) && !/(pet|baby costume)/u.test(normalizedCandidate);
  }
  if (/(jacket|재킷)/u.test(normalizedQuery)) {
    return /(jacket|outerwear)/u.test(normalizedCandidate) && !/(pet|baby costume)/u.test(normalizedCandidate);
  }
  if (/(원피스|dress(?:es)?)/u.test(normalizedQuery)) {
    return /(?:^|\b)dresses?(?:\b|$)/u.test(normalizedCandidate)
      && !/(dress\s*up|costume|toy|maternity|wash|cream|liner)/u.test(normalizedCandidate);
  }
  if (/(t[\s-]?shirt|tee|티셔츠|반팔)/u.test(normalizedQuery)) {
    return /(fashion|clothes|clothing|apparel|top|shirt|hoodie|sweatshirt|jacket|outerwear)/u.test(normalizedCandidate);
  }
  if (/(storage\s?(?:box|bin)|organizer|수납.*박스|보관.*박스)/u.test(normalizedQuery)) {
    return /(home|living|organizer|organization|storage box|storage bin)/u.test(normalizedCandidate);
  }
  if (/(hanger|옷걸이|행거)/u.test(normalizedQuery)) {
    return exactOrLeaf("hangers") || /(clothes? hangers?|clothing hangers?|coat hangers?)/u.test(normalizedCandidate);
  }
  if (/(tote|canvas|캔버스.*토트|토트백)/u.test(normalizedQuery)) {
    return /(fashion|bag|luggage|accessor)/u.test(normalizedCandidate);
  }
  return queryScore(shopeeSearchTerms(query), candidate) > 0;
}

function shopeePriorityScore(query: string, candidate: CategorySuggestion) {
  const normalizedQuery = query.toLocaleLowerCase();
  const value = `${candidate.path.join(" ")} ${candidate.name}`.toLocaleLowerCase();
  const score = (terms: string[]) => terms.reduce((total, term, index) => (
    value.includes(term) ? Math.max(total, terms.length - index) : total
  ), 0);
  if (/(rice|쌀|밥)/u.test(normalizedQuery)) return score(["food staples", "food & beverages", "instant rice", "ready meal", "rice"]);
  if (/(pasta|penne|파스타|펜네)/u.test(normalizedQuery)) return score(["pasta", "penne", "noodles", "food staples", "food & beverages"]);
  if (/(flour|밀가루)/u.test(normalizedQuery)) return score(["flour", "baking", "cooking ingredients", "food staples", "food & beverages"]);
  if (/(teddy|plush|stuffed|테디|곰인형|봉제)/u.test(normalizedQuery)) return score(["teddy", "plush", "stuffed", "toys"]);
  if (/(toy\s?car|자동차.*완구|완구.*자동차|장난감.*차)/u.test(normalizedQuery)) return score(["toy cars", "toy vehicles", "toys"]);
  if (/(wooden\s*train|toy\s*train|기차|열차)/u.test(normalizedQuery)) return score(["toy trains", "train sets", "railway", "toy vehicles", "vehicle toys", "wooden toys", "toys"]);
  if (/(building\s*blocks?|blocks?|블록)/u.test(normalizedQuery)) return score(["building blocks", "block toys", "construction toys", "construction sets", "building toys", "bricks", "stacking blocks", "educational toys", "toys"]);
  if (/(fish\s?oil|omega|어유|오메가|dha|epa)/u.test(normalizedQuery)) return score(["fish oil", "omega 3", "omega", "supplements", "health"]);
  if (/(vitamin|비타민)/u.test(normalizedQuery)) return score(["vitamins", "supplements", "health"]);
  if (/(sponge|puff|스펀지|퍼프)/u.test(normalizedQuery)) return score(["makeup sponges", "makeup puffs", "sponges", "puffs", "applicators"]);
  if (/(brush|브러시)/u.test(normalizedQuery)) return score(["makeup brushes", "cosmetic brushes"]);
  if (/(cream|moistur|크림|보습)/u.test(normalizedQuery)) return score(["face moisturizers", "facial moisturizers", "face cream", "skin care"]);
  if (/(hoodie|hood|후드)/u.test(normalizedQuery)) return score(["hoodies", "hooded sweatshirts", "sweatshirts"]);
  if (/(jacket|재킷)/u.test(normalizedQuery)) return score(["jackets", "outerwear"]);
  if (/(원피스|dress(?:es)?)/u.test(normalizedQuery)) return score(["women's dresses", "dresses", "dress"]);
  if (/(storage\s?(?:box|bin)|organizer|수납.*박스|보관.*박스)/u.test(normalizedQuery)) return score(["storage boxes", "home organizers", "home & living"]);
  if (/(hanger|옷걸이|행거)/u.test(normalizedQuery)) return score(["clothes hangers", "clothing hangers", "coat hangers", "hangers"]);
  return 0;
}

function lazadaSearchTerms(query: string) {
  const normalized = query.toLocaleLowerCase();
  const aliases = [query];
  if (/(krim|cream|크림|moistur)/u.test(normalized)) aliases.push("facial moisturizers skin care cream");
  if (/(sabun|soap|cleanser|cleansing|비누|세정)/u.test(normalized)) aliases.push("soap facial cleansers bath body skin care");
  if (/(lipstik|lipstick|립스틱|gincu)/u.test(normalized)) aliases.push("lipstick lip color makeup lips");
  if (/(berus|brush|브러시)/u.test(normalized)) aliases.push("makeup brushes beauty tools");
  if (/(span|sponge|puff|스펀지|퍼프)/u.test(normalized)) aliases.push("makeup sponges puffs beauty tools");
  if (/(pelentik|curler|eyelash|뷰러|속눈썹)/u.test(normalized)) aliases.push("eyelash curlers makeup tools");
  if (/(nasi|rice|쌀|밥)/u.test(normalized)) aliases.push("rice instant rice food staples");
  if (/(pasta|penne|파스타|펜네)/u.test(normalized)) aliases.push("pasta noodles penne");
  if (/(tepung|flour|밀가루)/u.test(normalized)) aliases.push("flour baking cooking ingredients");
  if (/(t-?shirt|티셔츠|반팔)/u.test(normalized)) aliases.push("t-shirts tops clothing");
  if (/(원피스|dress(?:es)?)/u.test(normalized)) aliases.push("women dresses women's clothing fashion");
  if (/(hoodie|후드|jaket)/u.test(normalized)) aliases.push("hoodies sweatshirts jackets clothing");
  if (/(teddy|beruang|곰인형|테디)/u.test(normalized)) aliases.push("teddy bears plush toys stuffed animals");
  if (/(kereta|toy\s?car|자동차.*완구|완구.*자동차)/u.test(normalized)) aliases.push("toy cars vehicles toys");
  if (/(wooden\s*train|toy\s*train|기차|열차)/u.test(normalized)) aliases.push("toy trains train sets railway wooden toys");
  if (/(building\s*blocks?|blocks?|블록)/u.test(normalized)) aliases.push("building toys building blocks block toys construction toys construction sets educational toys");
  if (/(minyak ikan|fish\s?oil|omega|오메가|어유)/u.test(normalized)) aliases.push("fish oil omega 3 supplements dha epa");
  if (/(vitamin|비타민)/u.test(normalized)) aliases.push("vitamins supplements health");
  if (/(tote|kanvas|캔버스.*토트|토트백)/u.test(normalized)) aliases.push("tote bags fashion bags");
  if (/(kotak simpanan|storage\s?(?:box|bin)|수납.*박스)/u.test(normalized)) aliases.push("storage boxes organizers home organization");
  if (/(penyangkut|hanger|옷걸이|행거)/u.test(normalized)) aliases.push("clothes hangers laundry organization");
  return aliases.join(" ");
}

function lazadaCategoryCompatibility(query: string, candidate: CategorySuggestion) {
  const normalizedQuery = query.toLocaleLowerCase();
  const name = candidate.name.toLocaleLowerCase();
  const path = candidate.path.join(" ").toLocaleLowerCase();
  if (/(rice|쌀|밥|nasi)/u.test(normalizedQuery)) return /rice|beras|nasi/u.test(name);
  if (/(pasta|penne|파스타|펜네)/u.test(normalizedQuery)) return /pasta|penne|noodle/u.test(name) && !/rice|beras/u.test(name);
  if (/(flour|밀가루|tepung)/u.test(normalizedQuery)) return /flour|tepung/u.test(name);
  if (/(teddy|plush|stuffed|테디|곰인형|beruang)/u.test(normalizedQuery)) return /teddy|plush|stuffed|soft toy|beruang/u.test(name);
  if (/(toy\s?car|자동차.*완구|완구.*자동차|kereta)/u.test(normalizedQuery)) return /toy car|vehicle|kereta|car/u.test(name) && /toy|kereta|vehicle/u.test(path);
  if (/(wooden\s*train|toy\s*train|기차|열차)/u.test(normalizedQuery)) return /toy train|train car|train set|railway|wooden toy|push & pull toy/u.test(`${path} ${name}`) && /toy|game|vehicle|wooden/u.test(path);
  if (/(building\s*blocks?|blocks?|블록)/u.test(normalizedQuery)) return /building toy|building block|block toy|construction (?:set|toy)|stacking block|brick|educational toy/u.test(`${path} ${name}`);
  if (/(fish\s?oil|omega|오메가|어유|minyak ikan)/u.test(normalizedQuery)) return /fish oil|omega|dha|epa|minyak ikan|vitamin|supplement|health/u.test(`${path} ${name}`)
    && !/pet|animal feed|veterinary|mother|baby|infant|bayi|kanak|ibu/u.test(`${path} ${name}`);
  if (/(vitamin|비타민)/u.test(normalizedQuery)) return /vitamin|supplement/u.test(`${path} ${name}`)
    && !/pet|animal feed|veterinary|mother|baby|infant|bayi|kanak|ibu/u.test(`${path} ${name}`);
  if (/(원피스|dress(?:es)?)/u.test(normalizedQuery)) return /dresses?/u.test(name)
    && /women'?s clothing|women fashion|pakaian wanita/u.test(path)
    && !/maternity|costume|pretend|toy/u.test(`${path} ${name}`);
  if (/(storage\s?(?:box|bin)|수납.*박스|kotak simpanan)/u.test(normalizedQuery)) return /storage|organizer|kotak|box/u.test(name);
  return lazadaQueryScore(lazadaSearchTerms(query), `${path} ${name}`) > 0;
}

function lazadaPriorityScore(query: string, candidate: CategorySuggestion) {
  const normalizedQuery = query.toLocaleLowerCase();
  const name = candidate.name.toLocaleLowerCase();
  const score = (terms: string[]) => terms.reduce((total, term, index) => name.includes(term) ? Math.max(total, terms.length - index) : total, 0);
  if (/(rice|쌀|밥|nasi)/u.test(normalizedQuery)) return score(["ready to eat rice", "instant rice", "white rice", "rice"]);
  if (/(pasta|penne|파스타|펜네)/u.test(normalizedQuery)) return score(["penne", "pasta", "noodles"]);
  if (/(flour|밀가루|tepung)/u.test(normalizedQuery)) return score(["wheat flour", "flour", "tepung"]);
  if (/(wooden\s*train|toy\s*train|기차|열차)/u.test(normalizedQuery)) return score(["train cars & sets", "toy trains", "train sets", "railway", "wooden toys", "push & pull toys"]);
  if (/(building\s*blocks?|blocks?|블록)/u.test(normalizedQuery)) return score(["building toys", "building blocks", "block toys", "construction toys", "construction sets", "bricks", "stacking blocks", "educational toys"]);
  if (/(fish\s?oil|omega|오메가|어유|minyak ikan)/u.test(normalizedQuery)) return score(["fish oil", "omega 3", "omega", "dietary supplements", "vitamins & supplements", "health supplements"]);
  if (/(원피스|dress(?:es)?)/u.test(normalizedQuery)) return score(["dresses", "dress"]);
  return 0;
}

function smartstoreSearchTerms(query: string) {
  const normalized = query.toLocaleLowerCase();
  const aliases = [query];
  if (/(화장품|메이크업|스킨|크림|립스틱|cosmetic|beauty)/u.test(normalized)) aliases.push("화장품 메이크업 스킨케어 뷰티");
  if (/(브러시|스펀지|퍼프|뷰러|속눈썹|화장도구)/u.test(normalized)) aliases.push("메이크업소품 화장소품 미용소품 브러시 퍼프 뷰러");
  if (/(쌀|밥|파스타|펜네|밀가루|식품|food|rice|pasta|flour)/u.test(normalized)) aliases.push("식품 농산물 가공식품 면류 쌀 밀가루");
  if (/(티셔츠|셔츠|후드|재킷|의류|옷|clothes|shirt|jacket)/u.test(normalized)) aliases.push("패션의류 티셔츠 셔츠 후드 집업 재킷");
  if (/(원피스|dress(?:es)?)/u.test(normalized)) aliases.push("여성의류 원피스 미디원피스 롱원피스");
  if (/(테디|곰인형|자동차.*완구|완구|장난감|toy|plush)/u.test(normalized)) aliases.push("완구 장난감 봉제인형 자동차완구 미니카");
  if (/(원목.*기차|기차|열차|wooden\s*train|toy\s*train)/u.test(normalized)) aliases.push("완구 작동완구 기차 트랙 철도 기차완구 원목완구");
  if (/(컬러.*블록|블록|blocks?|building\s*set)/u.test(normalized)) aliases.push("완구 블록 블록완구 조립완구 쌓기나무");
  if (/(비타민|오메가|어유|건강식품|보충제|supplement|vitamin|omega)/u.test(normalized)) aliases.push("건강식품 건강기능식품 영양제 비타민 오메가3 어유");
  if (/(수납.*박스|보관.*박스|리빙박스|정리함|storage\s?(?:box|bin)|organizer)/u.test(normalized)) aliases.push("수납 박스 수납박스 리빙박스 수납함 정리함 정리 바구니");
  if (/(옷걸이|행거|hanger)/u.test(normalized)) aliases.push("옷걸이 행거 의류수납 세탁용품");
  if (/(머그|컵|잔|mug|cup)/u.test(normalized)) aliases.push("머그컵 머그잔 컵 물컵 찻잔 식기 주방용품");
  return aliases.join(" ");
}

function smartstoreCategoryCompatibility(query: string, candidate: string) {
  const normalizedQuery = query.toLocaleLowerCase();
  const normalizedCandidate = candidate.toLocaleLowerCase();
  if (/(쌀|밥|rice)/u.test(normalizedQuery)) return /(즉석밥|쌀|백미|현미|잡곡|볶음밥|밥류)/u.test(normalizedCandidate);
  if (/(파스타|펜네|pasta|penne)/u.test(normalizedQuery)) return /(파스타|스파게티|펜네|면류)/u.test(normalizedCandidate) && !/소스/u.test(normalizedCandidate);
  if (/(밀가루|flour)/u.test(normalizedQuery)) return /(밀가루|부침가루|튀김가루|제빵용가루)/u.test(normalizedCandidate);
  if (/(스펀지|퍼프)/u.test(normalizedQuery)) return /(스펀지|퍼프)/u.test(normalizedCandidate)
    && /(화장품|미용|뷰티|메이크업)/u.test(normalizedCandidate)
    && !/(유아|목욕|청소|주방|브러시)/u.test(normalizedCandidate);
  if (/(브러시)/u.test(normalizedQuery)) return /브러시/u.test(normalizedCandidate)
    && /(화장품|미용|뷰티|메이크업)/u.test(normalizedCandidate)
    && !/(클렌저|세척|케이스|칫솔)/u.test(normalizedCandidate);
  if (/(뷰러|속눈썹)/u.test(normalizedQuery)) return /(뷰러|아이래쉬컬러)/u.test(normalizedCandidate);
  if (/(화장도구)/u.test(normalizedQuery)) return /(메이크업소품|화장소품|미용소품|브러시|퍼프|스펀지|뷰러)/u.test(normalizedCandidate);
  if (/(화장품|스킨|크림|cosmetic|beauty)/u.test(normalizedQuery)) return /(화장품|스킨케어|크림|로션|메이크업)/u.test(normalizedCandidate);
  if (/(티셔츠|셔츠|반팔|t[\s-]?shirt)/u.test(normalizedQuery)) return /(티셔츠|반팔티|상의|패션의류)/u.test(normalizedCandidate);
  if (/(후드|재킷|hood|jacket)/u.test(normalizedQuery)) return /(후드|후드집업|재킷|점퍼|아우터)/u.test(normalizedCandidate);
  if (/(원피스|dress(?:es)?)/u.test(normalizedQuery)) return /(여성의류.*원피스|원피스.*여성의류|미디원피스|롱원피스|미니원피스)/u.test(normalizedCandidate);
  if (/(테디|곰인형|봉제|teddy|plush)/u.test(normalizedQuery)) return /(봉제인형|곰인형|테디베어)\s*$/u.test(normalizedCandidate);
  if (/(자동차.*완구|완구.*자동차|자동차.*장난감|장난감.*차|toy\s?car)/u.test(normalizedQuery)) return /(자동차완구|미니카|장난감자동차|자동차장난감|작동완구|탈것완구|운송수단완구)/u.test(normalizedCandidate);
  if (/(원목.*기차|기차|열차|wooden\s*train|toy\s*train)/u.test(normalizedQuery)) return /((기차|철도|트랙).*(완구|장난감|놀이)|(완구|장난감|작동완구).*(기차|철도|트랙)|기차\/트랙|원목완구)/u.test(normalizedCandidate);
  if (/(컬러.*블록|블록|blocks?|building\s*set)/u.test(normalizedQuery)) return /(블록완구|블록|조립완구|쌓기나무)/u.test(normalizedCandidate);
  if (/(비타민|오메가|어유|건강식품|보충제|supplement|vitamin|omega)/u.test(normalizedQuery)) {
    return /(건강식품|건강기능식품|영양제|비타민|오메가3|어유|epa|dha)/u.test(normalizedCandidate)
      && !/(반려|애완|동물)/u.test(normalizedCandidate);
  }
  if (/(수납.*박스|보관.*박스|리빙박스|정리함|storage\s?(?:box|bin)|organizer)/u.test(normalizedQuery)) return /(수납박스|리빙박스|수납함|정리함|정리 바구니)/u.test(normalizedCandidate);
  if (/(옷걸이|행거|hanger)/u.test(normalizedQuery)) return /(옷걸이|의류수납|세탁용품)/u.test(normalizedCandidate);
  if (/(캔버스.*토트|토트백|tote)/u.test(normalizedQuery)) return /(토트백|숄더백|에코백)/u.test(normalizedCandidate);
  if (/(머그|컵|잔|mug|cup)/u.test(normalizedQuery)) return /(머그컵|머그잔|물컵|찻잔|커피잔|일반컵)/u.test(normalizedCandidate)
    && !/(월경|생리|계량|흡착|유아)/u.test(normalizedCandidate);
  return queryScore(smartstoreSearchTerms(query), candidate) > 0;
}

function smartstorePriorityScore(query: string, candidate: CategorySuggestion) {
  const normalizedQuery = query.toLocaleLowerCase();
  const value = `${candidate.path.join(" ")} ${candidate.name}`.toLocaleLowerCase();
  const score = (terms: string[]) => terms.reduce((total, term, index) => value.includes(term) ? Math.max(total, terms.length - index) : total, 0);
  if (/(쌀|밥|rice)/u.test(normalizedQuery)) return score(["즉석밥", "백미", "쌀", "밥류"]);
  if (/(파스타|펜네|pasta|penne)/u.test(normalizedQuery)) return score(["펜네", "스파게티면", "면/파스타", "면류", "파스타"]);
  if (/(밀가루|flour)/u.test(normalizedQuery)) return score(["밀가루", "제빵용가루", "가루"]);
  if (/(스펀지|퍼프)/u.test(normalizedQuery)) return score(["메이크업스펀지", "메이크업퍼프", "스펀지", "퍼프"]);
  if (/(브러시)/u.test(normalizedQuery)) return score(["브러시세트", "메이크업브러시", "브러시"]);
  if (/(자동차.*완구|완구.*자동차|자동차.*장난감|장난감.*차|toy\s?car)/u.test(normalizedQuery)) return score(["미니카", "자동차완구", "장난감자동차", "작동완구", "탈것완구"]);
  if (/(원목.*기차|기차|열차|wooden\s*train|toy\s*train)/u.test(normalizedQuery)) return score(["기차/트랙 작동완구", "기차완구", "철도완구", "원목완구", "작동완구"]);
  if (/(컬러.*블록|블록|blocks?|building\s*set)/u.test(normalizedQuery)) return score(["블록완구", "블록", "조립완구", "쌓기나무"]);
  if (/(원피스|dress(?:es)?)/u.test(normalizedQuery)) return score(["여성의류 원피스", "미디원피스", "롱원피스", "미니원피스", "원피스"]);
  if (/(수납.*박스|보관.*박스|리빙박스|정리함|storage\s?(?:box|bin)|organizer)/u.test(normalizedQuery)) return score(["리빙박스", "수납박스", "수납함", "정리함"]);
  if (/(머그|컵|잔|mug|cup)/u.test(normalizedQuery)) return score(["머그컵", "머그잔", "물컵", "커피잔", "찻잔", "일반컵"]);
  return 0;
}

function lazadaTreeLeaves(value: unknown, parentPath: string[] = [], depth = 0): CategorySuggestion[] {
  if (depth > 10 || value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap((item) => lazadaTreeLeaves(item, parentPath, depth + 1));
  if (typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const id = text(row, ["category_id", "categoryId", "id"]);
  const name = text(row, ["name", "category_name", "categoryName"]);
  const nodePath = id && name ? [...parentPath, name] : parentPath;
  const children = Array.isArray(row.children)
    ? row.children
    : Array.isArray(row.Children)
      ? row.Children
      : [];
  const explicitlyLeaf = booleanValue(row, ["leaf", "is_leaf", "isLeaf"], children.length === 0);
  const current = id && name && children.length === 0 && explicitlyLeaf
    ? [{ id, name, path: nodePath, confidence: 0.58, leaf: true }]
    : [];
  if (id && name) return [...current, ...children.flatMap((item) => lazadaTreeLeaves(item, nodePath, depth + 1))];
  return [...current, ...Object.values(row).flatMap((item) => lazadaTreeLeaves(item, parentPath, depth + 1))];
}

export function normalizeSuggestions(channel: ActiveChannelKey, payload: OperationPayload, query: string) {
  const root = { steps: payload.steps ?? [] };
  const directCoupang = records(root).find((row) => text(row, ["predictedCategoryId"]));
  if (channel === "coupang" && directCoupang) {
    const suggestion = {
      id: text(directCoupang, ["predictedCategoryId"]),
      name: text(directCoupang, ["predictedCategoryName"]) || "쿠팡 추천 카테고리",
      path: [text(directCoupang, ["predictedCategoryName"])].filter(Boolean),
      confidence: text(directCoupang, ["autoCategorizationPredictionResultType"]) === "SUCCESS" ? 0.98 : 0.72,
      leaf: true,
    };
    return categoryKindCompatibility(query, `${suggestion.path.join(" ")} ${suggestion.name}`) ? [suggestion] : [];
  }
  const directTemu = records(root).find((row) => text(row, ["catId"]));
  if (channel === "temu" && directTemu) {
    const id = text(directTemu, ["catId"]);
    return [{ id, name: `Temu 자동 추천 · ${id}`, path: [query, id], confidence: 0.95, leaf: true }];
  }

  const candidates = records(root).flatMap((row): CategorySuggestion[] => {
    const id = text(row, ["categoryId", "category_id", "category_id_list", "id", "catId", "category_code", "SecondSubCatCd", "CATE_S_CD"]);
    const name = text(row, ["categoryName", "category_name", "display_category_name", "display_name", "name", "catName", "SecondSubCatNm", "CATE_S_NM"]);
    if (!id || !name || id.length > 120 || name.length > 300) return [];
    const whole = text(row, ["wholeCategoryName", "category_path", "categoryPath", "path"]);
    const qoo10Path = [text(row, ["CATE_L_NM"]), text(row, ["CATE_M_NM"]), text(row, ["CATE_S_NM"])].filter(Boolean);
    const ancestors = Array.isArray(row.categoryTreeNodeAncestors)
      ? row.categoryTreeNodeAncestors.map((item) => item && typeof item === "object" ? text(item as Record<string, unknown>, ["categoryName", "name"]) : "").filter(Boolean).reverse()
      : [];
    const path = qoo10Path.length ? qoo10Path : whole ? whole.split(/\s*>\s*|\s*\/\s*/).filter(Boolean) : [...ancestors, name];
    const leaf = qoo10Path.length > 0 || booleanValue(row, ["leaf", "last", "leafCategoryTreeNode"], !booleanValue(row, ["has_children", "hasChildren"], false));
    const scoreQuery = channel === "qoo10"
      ? qoo10SearchTerms(query)
      : channel === "shopee"
        ? shopeeSearchTerms(query)
        : channel === "lazada"
          ? lazadaSearchTerms(query)
          : channel === "smartstore"
            ? smartstoreSearchTerms(query)
            : query;
    const score = Math.max(
      channel === "lazada" ? lazadaQueryScore(scoreQuery, `${path.join(" ")} ${name}`) : queryScore(scoreQuery, `${path.join(" ")} ${name}`),
      Number(row.confidence ?? row.score ?? 0),
    );
    const confidence = channel === "qoo10" || channel === "lazada" || channel === "smartstore"
      ? Math.min(0.99, 0.45 + score * 0.54)
      : Math.min(0.99, Math.max(0.45, score));
    return [{ id, name, path: path.length ? path : [name], confidence, leaf }];
  });

  const officialLazadaTree = channel === "lazada"
    ? lazadaTreeLeaves(payload.steps?.find((item) => item.name === "category-tree")?.data).map((item) => ({
      ...item,
      confidence: Math.min(0.99, 0.45 + lazadaQueryScore(lazadaSearchTerms(query), `${item.path.join(" ")} ${item.name}`) * 0.54),
    }))
    : [];
  // Category suggestion is often more precise for regulated or localized
  // categories, while the tree supplies parent paths and true leaf nodes. Keep
  // both sources: selection still runs the official attributes endpoint before
  // it can be saved, so a stale suggestion cannot bypass leaf validation.
  const candidatePool = channel === "lazada" ? [...officialLazadaTree, ...candidates] : candidates;

  const deduplicated = new Map<string, CategorySuggestion>();
  for (const item of candidatePool) {
    const key = `${item.id}:${item.name}`;
    const existing = deduplicated.get(key);
    if (!existing) {
      deduplicated.set(key, item);
      continue;
    }
    deduplicated.set(key, {
      ...(item.path.length > existing.path.length ? item : existing),
      confidence: Math.max(existing.confidence, item.confidence),
    });
  }

  return [...deduplicated.values()]
    .filter((item) => item.leaf)
    .filter((item) => channel !== "qoo10" || qoo10CategoryCompatibility(query, item))
    .filter((item) => channel !== "shopee" || shopeeCategoryCompatibility(query, `${item.path.join(" ")} ${item.name}`))
    .filter((item) => channel !== "lazada" || lazadaCategoryCompatibility(query, item))
    .filter((item) => channel !== "smartstore" || smartstoreCategoryCompatibility(query, `${item.path.join(" ")} ${item.name}`))
    .filter((item) => categoryKindCompatibility(query, `${item.path.join(" ")} ${item.name}`))
    .sort((left, right) => {
      if (channel === "qoo10") {
        const leftPriority = qoo10PriorityScore(query, left);
        const rightPriority = qoo10PriorityScore(query, right);
        if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      }
      if (channel === "shopee") {
        const leftPriority = shopeePriorityScore(query, left);
        const rightPriority = shopeePriorityScore(query, right);
        if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      }
      if (channel === "smartstore") {
        const leftPriority = smartstorePriorityScore(query, left);
        const rightPriority = smartstorePriorityScore(query, right);
        if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      }
      if (channel === "lazada") {
        const leftPriority = lazadaPriorityScore(query, left);
        const rightPriority = lazadaPriorityScore(query, right);
        if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      }
      return right.confidence - left.confidence;
    })
    .slice(0, 5);
}

export function normalizeAttributes(payloads: OperationPayload[]) {
  const found = records({ payloads }).flatMap((row): CategoryAttribute[] => {
    const constraint = row.aspectConstraint && typeof row.aspectConstraint === "object" && !Array.isArray(row.aspectConstraint)
      ? row.aspectConstraint as Record<string, unknown>
      : {};
    const id = text(row, ["attribute_id", "attributeId", "attributeSeq", "attributeTypeName", "name", "localizedAspectName"]);
    const name = text(row, ["display_attribute_name", "original_attribute_name", "attributeName", "attributeTypeName", "label", "name", "localizedAspectName"]);
    const looksLikeAttribute = Boolean(
      row.attribute_id !== undefined || row.attributeSeq !== undefined || row.attributeTypeName !== undefined
      || row.localizedAspectName !== undefined || row.is_mandatory !== undefined || row.mandatory !== undefined,
    );
    if (!id || !name || !looksLikeAttribute) return [];
    const required = booleanValue(row, ["required", "mandatory", "is_mandatory", "isMandatory"], false)
      || constraint.aspectRequired === true
      || row.attributeType === "PRIMARY";
    const optionRows = Array.isArray(row.options) ? row.options
      : Array.isArray(row.attribute_value_list) ? row.attribute_value_list
        : Array.isArray(row.attributeValues) ? row.attributeValues
          : Array.isArray(row.aspectValues) ? row.aspectValues : [];
    const values = optionRows.flatMap((item) => {
      if (item && typeof item === "object") {
        const option = item as Record<string, unknown>;
        const name = text(option, ["display_value_name", "original_value_name", "name", "value", "localizedValue", "display_value", "en_name"]);
        const id = text(option, ["value_id", "id", "option_id"]) || name;
        return id && name ? [{ id, name }] : [];
      }
      return typeof item === "string" && item ? [{ id: item, name: item }] : [];
    }).slice(0, 100);
    return [{ id, name, required, values }];
  });
  const childCertificationRows = records({ payloads }).filter((row) => (
    Array.isArray(row.kindTypes)
    && row.kindTypes.map(String).includes("CHILD_CERTIFICATION")
    && text(row, ["id"])
  ));
  const childCategorySignal = found.some((attribute) => /(연령|어린이|아동|키즈|(?:^|\s)age(?:\s|$))/iu.test(attribute.name));
  const childCertificationAttributes: CategoryAttribute[] = childCertificationRows.length && childCategorySignal ? [
    { id: "NAVER_MODEL_NAME", name: "모델명", required: true, values: [] },
    { id: "NAVER_COLOR", name: "색상", required: true, values: [] },
    { id: "NAVER_SIZE", name: "크기", required: true, values: [] },
    { id: "NAVER_RECOMMENDED_AGE", name: "권장 사용 연령", required: true, values: [] },
    { id: "NAVER_RELEASE_DATE_TEXT", name: "동일 모델 출시연월", required: true, values: [] },
    {
      id: "NAVER_CHILD_CERTIFICATION_INFO_ID",
      name: "어린이제품 인증 종류",
      required: true,
      values: childCertificationRows.map((row) => ({ id: text(row, ["id"]), name: text(row, ["name"]) })).filter((item) => item.id && item.name),
    },
    { id: "NAVER_CHILD_CERTIFICATION_TYPE", name: "KC 인증정보", required: true, values: [] },
    { id: "NAVER_CHILD_CERTIFICATION_NUMBER", name: "어린이제품 인증번호", required: true, values: [] },
    { id: "NAVER_CHILD_CERTIFICATION_AGENCY", name: "인증 기관명", required: true, values: [] },
    { id: "NAVER_CHILD_CERTIFICATION_COMPANY", name: "인증 상호명", required: true, values: [] },
  ] : [];
  return [...new Map([...found, ...childCertificationAttributes].map((item) => [item.id, item])).values()]
    .sort((left, right) => Number(right.required) - Number(left.required));
}

function categoryPathLabel(category: CategorySuggestion) {
  return category.path.length > 1 ? category.path.join(" › ") : category.name;
}

export function CategoryClassificationWorkbench({ productId, productName, description, sourceRef, enabledChannels, notify, onConfirmed }: {
  productId: string | null;
  productName: string;
  description: string;
  sourceRef: string;
  enabledChannels?: string[];
  notify: (message: string) => void;
  onConfirmed?: (channel: ActiveChannelKey) => void;
}) {
  const [query, setQuery] = useState(productName);
  const [credentials, setCredentials] = useState<CredentialRow[]>([]);
  const [states, setStates] = useState<Record<string, ChannelState>>({});
  const [targets, setTargets] = useState<Partial<Record<"shopee" | "lazada", ChannelTarget[]>>>({});
  const [targetErrors, setTargetErrors] = useState<Partial<Record<"shopee" | "lazada", string>>>({});
  const [selectedMarkets, setSelectedMarkets] = useState<Partial<Record<"shopee" | "lazada", string>>>({});
  const [localizedListings, setLocalizedListings] = useState<LocalizedListing[]>([]);
  const [sourceImageUrl, setSourceImageUrl] = useState("");
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const stateScopeRef = useRef(sourceRef);

  useEffect(() => {
    stateScopeRef.current = sourceRef;
    setQuery(productName);
    setStates({});
  }, [productId, productName, sourceRef]);
  useEffect(() => {
    let mounted = true;
    setSourceImageUrl("");
    void (async () => {
      const supabase = createClient();
      const [{ data, error }, { data: sessionData }] = await Promise.all([
        supabase.rpc("sellerpilot_list_credentials"),
        supabase.auth.getSession(),
      ]);
      if (!mounted) return;
      setCredentials(error || !Array.isArray(data) ? [] : data.filter((row): row is CredentialRow => Boolean(row && typeof row === "object" && "id" in row && "channel" in row && "environment" in row && "status" in row)));
      const accessToken = sessionData.session?.access_token;
      if (accessToken) {
        const [shopeeResponse, lazadaResponse, contextResponse] = await Promise.all([
          fetchChannelTargets("shopee", accessToken),
          fetchChannelTargets("lazada", accessToken),
          productId ? fetch(`/api/admin/products/${productId}/publish-context`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" }) : null,
        ]);
        const shopeePayload = await shopeeResponse.json().catch(() => ({ targets: [] })) as { targets?: ChannelTarget[]; message?: string };
        const lazadaPayload = await lazadaResponse.json().catch(() => ({ targets: [] })) as { targets?: ChannelTarget[]; message?: string };
        const contextPayload = contextResponse ? await contextResponse.json().catch(() => ({ localizedListings: [] })) as {
          localizedListings?: LocalizedListing[];
          sourceImages?: Array<{ url?: string | null }>;
          generatedImages?: Array<{ url?: string | null }>;
        } : { localizedListings: [] };
        if (mounted) {
          const shopeeTargets = shopeeResponse.ok && Array.isArray(shopeePayload.targets) ? shopeePayload.targets : [];
          const lazadaTargets = lazadaResponse.ok && Array.isArray(lazadaPayload.targets) ? lazadaPayload.targets : [];
          setTargets({ shopee: shopeeTargets, lazada: lazadaTargets });
          setTargetErrors({
            shopee: shopeeResponse.ok ? "" : userFacingErrorMessage(shopeePayload.message, "Shopee 판매 국가 정보를 불러오지 못했습니다. 다시 연결해 주세요."),
            lazada: lazadaResponse.ok ? "" : userFacingErrorMessage(lazadaPayload.message, "Lazada 판매 국가 정보를 불러오지 못했습니다. 다시 연결해 주세요."),
          });
          setSelectedMarkets((current) => ({
            shopee: current.shopee ?? shopeeTargets[0]?.marketCode,
            lazada: current.lazada ?? lazadaTargets[0]?.marketCode,
          }));
          setLocalizedListings(Array.isArray(contextPayload.localizedListings) ? contextPayload.localizedListings : []);
          setSourceImageUrl(
            contextPayload.sourceImages?.find((image) => image.url)?.url
            ?? contextPayload.generatedImages?.find((image) => image.url)?.url
            ?? "",
          );
        }
      }
      setLoadingCredentials(false);
    })();
    return () => { mounted = false; };
  }, [productId]);

  const activeCredential = useMemo(() => new Map(credentials
    .filter((row) => row.status === "active" && row.environment === "production")
    .map((row) => [row.channel, row])), [credentials]);
  const visibleChannels = useMemo(() => {
    if (!enabledChannels?.length) return activeChannelKeys;
    const enabled = new Set(enabledChannels);
    return activeChannelKeys.filter((channel) => enabled.has(channel));
  }, [enabledChannels]);

  const selectedTarget = useCallback((channel: ActiveChannelKey) => {
    if (channel !== "shopee" && channel !== "lazada") return undefined;
    const rows = targets[channel] ?? [];
    return rows.find((target) => target.marketCode === selectedMarkets[channel]) ?? rows[0];
  }, [selectedMarkets, targets]);

  const stateKey = useCallback((channel: ActiveChannelKey) => {
    const target = selectedTarget(channel);
    return `${channel}:${target?.marketCode ?? channelCatalog[channel].market}`;
  }, [selectedTarget]);

  const marketArguments = useCallback((channel: ActiveChannelKey) => {
    const target = selectedTarget(channel);
    if (channel === "shopee") {
      return { globalProduct: true, shopId: target?.targetId ?? "", query: { language: "en" } };
    }
    if (channel === "lazada") {
      const market = target ? channelMarket("lazada", target.marketCode) : undefined;
      return { country: target?.marketCode.toLowerCase() ?? "my", queryParams: { language_code: market?.lazadaLanguage ?? "en_US" } };
    }
    return {};
  }, [selectedTarget]);

  const localizedQuery = useCallback((channel: ActiveChannelKey) => {
    const manualQuery = sanitizeCategoryQuery(query);
    const defaultQuery = sanitizeCategoryQuery(productName);
    if (manualQuery && manualQuery !== defaultQuery) return manualQuery;
    if (channel === "lazada") {
      // Lazada's MY suggestion endpoint reliably accepts English product terms,
      // while generated Malay display copy may omit the catalog noun entirely.
      return englishCategoryQuery(defaultQuery || manualQuery);
    }
    if (channel === "shopee") {
      const targetMarket = selectedTarget(channel)?.marketCode;
      const localized = localizedListings.find((listing) => listing.channel === channel && (listing.market === targetMarket || listing.market === "SG"));
      const localizedTitle = sanitizeCategoryQuery(localized?.title ?? "");
      return localizedTitle && !isGenericFallbackTitle(localizedTitle)
        ? localizedTitle
        : englishCategoryQuery(defaultQuery || manualQuery);
    }
    if (channel === "ebay") {
      // eBay category search is most stable with a short catalog noun. Reusing a
      // generated display title can bury that noun and produce unrelated leaves.
      return englishCategoryQuery(defaultQuery || manualQuery);
    }
    return manualQuery;
  }, [localizedListings, productName, query, selectedTarget]);

  const operation = useCallback(async (channel: ActiveChannelKey, name: "categories.suggest" | "categories.attributes" | "categories.validate", args: Record<string, unknown>) => {
    const credential = activeCredential.get(channel);
    if (!credential) throw new Error("판매 채널 연결이 필요합니다.");
    const { data: sessionData } = await createClient().auth.getSession();
    const response = await fetch("/api/admin/channel-operations", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sessionData.session?.access_token ?? ""}` },
      body: JSON.stringify({ credentialId: credential.id, channel, operation: name, idempotencyKey: crypto.randomUUID(), confirmWrite: false, arguments: args }),
    });
    const payload = await response.json().catch(() => ({ message: "채널 응답을 읽지 못했습니다." })) as OperationPayload;
    if (!response.ok || payload.ok === false) throw new Error(userFacingErrorMessage(payload.message, `${channelCatalog[channel].name}에서 카테고리를 확인하지 못했습니다.`));
    return payload;
  }, [activeCredential]);

  const suggest = async (channel: ActiveChannelKey) => {
    const requestScope = stateScopeRef.current;
    const textQuery = localizedQuery(channel);
    if (textQuery.length < 2) return notify("카테고리 검색에 사용할 상품명을 2자 이상 입력해 주세요.");
    const key = stateKey(channel);
    setStates((current) => ({ ...current, [key]: { ...(current[key] ?? initialState()), phase: "suggesting", error: undefined } }));
    try {
      if (channel === "lazada" && !sourceImageUrl) throw new Error("Lazada 카테고리를 찾는 데 필요한 대표사진을 불러오지 못했습니다.");
      const marketArgs = marketArguments(channel);
      const args: Record<string, unknown> = channel === "coupang"
        ? { query: textQuery, body: { productDescription: description.slice(0, 3000), attributes: {} } }
        : channel === "ebay"
          ? { query: textQuery, marketplaceId: "EBAY_US", categoryTreeId: "" }
          : channel === "shopee"
            ? { queryText: textQuery, ...marketArguments(channel) }
            : channel === "lazada"
              ? {
                  query: textQuery,
                  ...marketArgs,
                  queryParams: {
                    ...((marketArgs.queryParams as Record<string, string> | undefined) ?? {}),
                    image_url: sourceImageUrl,
                  },
                }
              : channel === "qoo10"
                ? { query: textQuery, params: {} }
                : { query: textQuery };
      const credential = activeCredential.get(channel);
      const learningMarket = selectedTarget(channel)?.marketCode ?? (channel === "ebay" ? "EBAY_US" : channelCatalog[channel].market);
      const [payload, learningResult] = await Promise.all([
        operation(channel, "categories.suggest", args),
        credential
          ? createClient().rpc("sellerpilot_list_category_learning", {
              p_channel: channel,
              p_environment: credential.environment,
              p_market: learningMarket,
            })
          : Promise.resolve({ data: [], error: null }),
      ]);
      const officialSuggestions = normalizeSuggestions(channel, payload, textQuery);
      const examples = !learningResult.error && Array.isArray(learningResult.data)
        ? learningResult.data as CategoryLearningExample[]
        : [];
      const suggestions = applyCategoryLearning(textQuery, officialSuggestions, examples);
      if (!suggestions.length) throw new Error("상품과 일치하는 최종 카테고리를 찾지 못했습니다. 상품명을 더 구체적으로 입력해 주세요.");
      if (stateScopeRef.current !== requestScope) return;
      setStates((current) => ({ ...current, [key]: { ...initialState(), phase: "idle", suggestions } }));
    } catch (error) {
      if (stateScopeRef.current !== requestScope) return;
      setStates((current) => ({ ...current, [key]: { ...(current[key] ?? initialState()), phase: "error", error: userFacingErrorMessage(error, "카테고리를 찾지 못했습니다. 상품명을 확인하고 다시 시도해 주세요.") } }));
    }
  };

  const inspect = async (channel: ActiveChannelKey, selected: CategorySuggestion) => {
    const requestScope = stateScopeRef.current;
    const key = stateKey(channel);
    setStates((current) => ({ ...current, [key]: { ...(current[key] ?? initialState()), selected, phase: "inspecting", error: undefined } }));
    try {
      const common = channel === "ebay"
        ? { categoryId: selected.id, categoryTreeId: "0" }
        : channel === "temu"
          ? { categoryId: selected.id, goodsName: localizedQuery(channel), description: description.slice(0, 3000) }
          : { categoryId: selected.id, ...marketArguments(channel) };
      const [attributesPayload, validationPayload] = await Promise.all([
        operation(channel, "categories.attributes", common),
        operation(channel, "categories.validate", common),
      ]);
      const attributes = normalizeAttributes([attributesPayload]);
      const verifiedLeaf = selected.leaf && validationPayload.ok !== false;
      if (stateScopeRef.current !== requestScope) return;
      setStates((current) => ({ ...current, [key]: { ...(current[key] ?? initialState()), selected, attributes, values: {}, verifiedLeaf, phase: "ready" } }));
    } catch (error) {
      if (stateScopeRef.current !== requestScope) return;
      setStates((current) => ({ ...current, [key]: { ...(current[key] ?? initialState()), selected, phase: "error", error: userFacingErrorMessage(error, "카테고리 필수 정보를 불러오지 못했습니다. 다시 시도해 주세요.") } }));
    }
  };

  const inspectManualCategory = async (channel: ActiveChannelKey) => {
    const key = stateKey(channel);
    const state = states[key] ?? initialState();
    const id = state.manualCategoryId.trim();
    const name = state.manualCategoryName.trim();
    const path = state.manualCategoryPath.split(/\s*>\s*|\s*›\s*|\s*\/\s*/).map((item) => item.trim()).filter(Boolean);
    if (!id || !name) {
      notify("공식 카테고리 ID와 카테고리명을 입력해 주세요.");
      return;
    }
    await inspect(channel, {
      id,
      name,
      path: path.length ? path : [name],
      confidence: 1,
      leaf: true,
    });
  };

  const confirm = async (channel: ActiveChannelKey) => {
    const requestScope = stateScopeRef.current;
    const key = stateKey(channel);
    const state = states[key];
    const credential = activeCredential.get(channel);
    const target = selectedTarget(channel);
    if (!state?.selected || !credential) return;
    const selectedCategory = state.selected;
    if (!productId) {
      notify("AI 상품 분석을 먼저 완료해 주세요.");
      return;
    }
    const missing = state.attributes.filter((attribute) => attribute.required && !state.values[attribute.id]?.trim());
    if (!state.verifiedLeaf || missing.length) {
      notify(!state.verifiedLeaf ? "등록 가능한 카테고리인지 먼저 확인해 주세요." : `필수 정보 ${missing.length}개를 모두 입력해 주세요.`);
      return;
    }
    const requiredAttributes = state.attributes.map((attribute) => ({ id: attribute.id, name: attribute.name, required: attribute.required, values: attribute.values }));
    const providedAttributes = channel === "lazada"
      ? Object.fromEntries(state.attributes.map((attribute) => {
          const selectedValue = state.values[attribute.id] ?? "";
          const selectedOption = attribute.values.find((value) => value.id === selectedValue);
          return [attribute.id, selectedOption?.name ?? selectedValue];
        }))
      : state.values;
    const shopeeTargets = targets.shopee ?? [];
    const assignmentTargets: Array<ChannelTarget | undefined> = channel === "shopee" && shopeeTargets.length > 0
      ? shopeeTargets
      : [target];
    const results = await Promise.all(assignmentTargets.map((assignmentTarget) => createClient().rpc("sellerpilot_save_product_category_assignment", {
      p_product_id: productId,
      p_source_ref: sourceRef,
      p_product_name: productName,
      p_channel: channel,
      p_environment: credential.environment,
      p_market: assignmentTarget?.marketCode ?? (channel === "ebay" ? "EBAY_US" : channelCatalog[channel].market),
      p_category_id: selectedCategory.id,
      p_category_path: selectedCategory.path,
      p_is_leaf: state.verifiedLeaf,
      p_confidence: selectedCategory.confidence,
      p_classification_source: channel === "coupang" || channel === "lazada" || channel === "ebay" ? "channel_recommendation" : "official_tree_search",
      p_required_attributes: requiredAttributes,
      p_provided_attributes: providedAttributes,
      p_official_metadata: { verifiedBy: "channel_api", verifiedAt: new Date().toISOString(), targetId: assignmentTarget?.targetId ?? null, locale: assignmentTarget?.locale ?? null, globalProduct: channel === "shopee" },
      p_confirm: true,
    })));
    if (results.some((result) => result.error)) return notify("카테고리를 저장하지 못했습니다. 로그인 상태를 확인하고 다시 시도해 주세요.");
    if (stateScopeRef.current !== requestScope) return;
    setStates((current) => ({ ...current, [key]: { ...state, phase: "confirmed" } }));
    onConfirmed?.(channel);
    notify(`${channelCatalog[channel].name} 카테고리와 필수 속성을 ${channel === "shopee" ? `${assignmentTargets.length}개 숍에 ` : ""}확정했습니다.`);
  };

  return <section className="panel category-workbench">
    <div className="category-workbench-head"><div><span className="panel-kicker">2단계</span><h3>판매 카테고리 확인</h3><p>각 판매 채널에서 상품에 맞는 카테고리를 찾고, 등록에 꼭 필요한 정보를 확인합니다.</p></div><span className="step-chip">2 / 3</span></div>
    <div className="category-query"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="예: 브랜드 + 상품 종류 + 용량" /><small>카테고리에 따라 수수료와 노출 위치가 달라질 수 있으니 추천 결과를 확인해 주세요.</small></div>
    <div className="category-channel-grid">{visibleChannels.map((channel) => {
      const definition = channelCatalog[channel];
      const credential = activeCredential.get(channel);
      const target = selectedTarget(channel);
      const key = stateKey(channel);
      const state = states[key] ?? initialState();
      const busy = state.phase === "suggesting" || state.phase === "inspecting";
      const required = state.attributes.filter((attribute) => attribute.required);
      const completedRequired = required.filter((attribute) => state.values[attribute.id]?.trim()).length;
      const requiresTarget = channel === "shopee" || channel === "lazada";
      const targetReady = !requiresTarget || Boolean(target);
      return <article className={`category-channel-card ${state.phase}`} key={channel}>
        <header><span>{definition.code}</span><div><small>{target ? `${target.marketCode} · ${target.language}` : definition.market}</small><h4>{definition.name}</h4></div><em className={credential ? "connected" : "missing"}>{loadingCredentials ? "확인 중" : credential ? "연결됨" : "연결 필요"}</em></header>
        {(channel === "shopee" || channel === "lazada") && (targets[channel]?.length ?? 0) > 0 && <label className="category-market-select"><span>등록 국가·언어</span><select value={target?.marketCode ?? ""} onChange={(event) => setSelectedMarkets((current) => ({ ...current, [channel]: event.target.value }))}>{targets[channel]?.map((item) => <option value={item.marketCode} key={`${item.marketCode}-${item.targetId}`}>{item.marketCode} · {item.displayName || item.language} · {item.locale}</option>)}</select></label>}
        {requiresTarget && targetErrors[channel] && <p className="category-error" role="alert"><AlertTriangle size={14} />{targetErrors[channel]}</p>}
        {!state.suggestions.length && !state.selected && <div className="category-empty"><Tags size={21} /><b>{!targetReady ? "판매 국가 확인 필요" : credential ? productId ? "카테고리를 찾아보세요" : "상품 분석을 먼저 완료해 주세요" : "판매 채널을 먼저 연결해 주세요"}</b><small>{!targetReady ? "판매 채널을 다시 연결한 뒤 국가와 언어를 확인해 주세요." : credential ? productId ? "상품명으로 알맞은 카테고리를 찾아드립니다." : "상품 사진과 정보를 분석하면 카테고리를 찾을 수 있습니다." : "채널 연결 메뉴에서 이 판매 채널을 연결해 주세요."}</small><button type="button" disabled={!credential || !productId || !targetReady || busy} onClick={() => void suggest(channel)}>{busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{!targetReady ? "다시 연결하기" : "추천 카테고리 찾기"}</button>{credential && productId && targetReady && <div className="category-manual-fallback"><b>카테고리 직접 입력</b><small>추천 결과가 없을 때 판매 채널에서 확인한 카테고리 정보를 입력해 주세요.</small><label><span>카테고리 번호 <em>필수</em></span><input required aria-label={`${definition.name} 수동 카테고리 번호`} value={state.manualCategoryId} onChange={(event) => setStates((current) => ({ ...current, [key]: { ...(current[key] ?? initialState()), manualCategoryId: event.target.value } }))} placeholder="판매 채널의 카테고리 번호" /></label><label><span>카테고리명 <em>필수</em></span><input required aria-label={`${definition.name} 수동 카테고리명`} value={state.manualCategoryName} onChange={(event) => setStates((current) => ({ ...current, [key]: { ...(current[key] ?? initialState()), manualCategoryName: event.target.value } }))} placeholder="카테고리명" /></label><label><span>카테고리 경로</span><input aria-label={`${definition.name} 수동 카테고리 경로`} value={state.manualCategoryPath} onChange={(event) => setStates((current) => ({ ...current, [key]: { ...(current[key] ?? initialState()), manualCategoryPath: event.target.value } }))} placeholder="상위 › 하위 › 선택한 카테고리" /></label><button type="button" className="category-manual-verify" disabled={busy || !state.manualCategoryId.trim() || !state.manualCategoryName.trim()} onClick={() => void inspectManualCategory(channel)}><ShieldCheck size={14} />카테고리 확인</button></div>}</div>}
        {state.suggestions.length > 0 && !state.selected && <div className="category-suggestions">{state.suggestions.map((suggestion, index) => {
          const blocked = suggestion.learning?.permissionBlocked === true;
          const successes = suggestion.learning?.successfulListings ?? 0;
          return <button type="button" disabled={blocked} onClick={() => void inspect(channel, suggestion)} key={`${suggestion.id}-${suggestion.name}`}><span><b>{index + 1}. {suggestion.name}</b><small>{categoryPathLabel(suggestion)}</small></span><em className={blocked ? "blocked" : successes > 0 ? "learned" : ""}>{blocked ? "판매 권한 확인" : successes > 0 ? `이전 등록 성공 ${successes}회` : `${Math.round(suggestion.confidence * 100)}%`}</em><ChevronRight size={14} /></button>;
        })}{state.suggestions.some((suggestion) => suggestion.learning?.permissionBlocked) && <p className="category-learning-note"><AlertTriangle size={13} />판매 권한이 거절된 카테고리는 자동 선택에서 제외했습니다. 해당 채널에서 판매 권한을 받은 뒤 다시 찾아보세요.</p>}</div>}
        {state.selected && <div className="category-inspection"><div className="selected-category"><BadgeCheck size={18} /><span><b>{state.selected.name}</b><small>{categoryPathLabel(state.selected)} · 카테고리 번호 {state.selected.id}</small></span><button type="button" onClick={() => setStates((current) => ({ ...current, [key]: { ...initialState(), suggestions: state.suggestions } }))}>다시 선택</button></div>{state.phase === "inspecting" ? <p className="category-loading"><LoaderCircle className="spin" size={16} />카테고리 정보를 확인하는 중</p> : <><div className="category-proof"><span className={state.verifiedLeaf ? "passed" : "failed"}><ShieldCheck size={14} />{state.verifiedLeaf ? "등록 가능한 카테고리" : "카테고리 확인 필요"}</span><span className={completedRequired === required.length ? "passed" : "failed"}><Check size={14} />필수 정보 {completedRequired}/{required.length}</span></div>{required.length > 0 && <div className="category-attribute-list">{required.map((attribute) => <label key={attribute.id}><span>{attribute.name}<em>필수</em></span>{attribute.values.length ? <select value={state.values[attribute.id] ?? ""} onChange={(event) => setStates((current) => ({ ...current, [key]: { ...state, values: { ...state.values, [attribute.id]: event.target.value } } }))}><option value="">값 선택</option>{attribute.values.map((value) => <option value={value.id} key={value.id}>{value.name}</option>)}</select> : <input value={state.values[attribute.id] ?? ""} onChange={(event) => setStates((current) => ({ ...current, [key]: { ...state, values: { ...state.values, [attribute.id]: event.target.value } } }))} placeholder={`${attribute.name} 입력`} />}</label>)}</div>}<button type="button" className="category-confirm" onClick={() => void confirm(channel)} disabled={!state.verifiedLeaf || completedRequired !== required.length || state.phase === "confirmed"}>{state.phase === "confirmed" ? <><Check size={15} />카테고리 저장됨</> : "카테고리 저장"}</button></>}</div>}
        {state.error && <p className="category-error" role="alert"><AlertTriangle size={14} />{state.error}</p>}
      </article>;
    })}</div>
  </section>;
}
