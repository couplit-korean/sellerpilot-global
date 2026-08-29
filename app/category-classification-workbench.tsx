"use client";

import { AlertTriangle, BadgeCheck, Check, ChevronRight, LoaderCircle, RefreshCw, Search, ShieldCheck, Tags } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { activeChannelKeys, channelCatalog, type ActiveChannelKey } from "../lib/channels/catalog";
import { channelMarket } from "../lib/channels/markets";
import { createClient } from "../lib/supabase/client";
import { fetchChannelTargets } from "./channel-target-client";
import { createBoundedRequestSignal, waitForAbortablePromise } from "./operations-snapshot-request-coordinator";

export type CredentialRow = {
  id: string;
  channel: ActiveChannelKey;
  environment: "sandbox" | "production";
  status: string;
};

type OperationStep = { name: string; ok: boolean; status: number; data: Record<string, unknown> };
export type OperationPayload = { ok?: boolean; steps?: OperationStep[]; remoteId?: string; message?: string };
type CategorySuggestion = { id: string; name: string; path: string[]; confidence: number; leaf: boolean };
type CategoryAttribute = { id: string; name: string; required: boolean; values: Array<{ id: string; name: string }> };
type ChannelTarget = { targetId: string; displayName: string; marketCode: string; locale: string; language: string; currency: string; status?: string };
export type EbayCategoryTreeBinding = { marketplaceId: string; categoryTreeId: string };
const ebayMarketplaceTargets: ChannelTarget[] = [
  { targetId: "EBAY_US", displayName: "United States", marketCode: "US", locale: "en-US", language: "English", currency: "USD" },
  { targetId: "EBAY_GB", displayName: "United Kingdom", marketCode: "GB", locale: "en-GB", language: "English", currency: "GBP" },
  { targetId: "EBAY_DE", displayName: "Deutschland", marketCode: "DE", locale: "de-DE", language: "Deutsch", currency: "EUR" },
  { targetId: "EBAY_AU", displayName: "Australia", marketCode: "AU", locale: "en-AU", language: "English", currency: "AUD" },
  { targetId: "EBAY_CA", displayName: "Canada", marketCode: "CA", locale: "en-CA", language: "English", currency: "CAD" },
  { targetId: "EBAY_FR", displayName: "France", marketCode: "FR", locale: "fr-FR", language: "Français", currency: "EUR" },
  { targetId: "EBAY_IT", displayName: "Italia", marketCode: "IT", locale: "it-IT", language: "Italiano", currency: "EUR" },
  { targetId: "EBAY_ES", displayName: "España", marketCode: "ES", locale: "es-ES", language: "Español", currency: "EUR" },
  { targetId: "EBAY_AT", displayName: "Österreich", marketCode: "AT", locale: "de-AT", language: "Deutsch", currency: "EUR" },
  { targetId: "EBAY_BE", displayName: "België", marketCode: "BE", locale: "nl-BE", language: "Nederlands", currency: "EUR" },
  { targetId: "EBAY_CH", displayName: "Schweiz", marketCode: "CH", locale: "de-CH", language: "Deutsch", currency: "CHF" },
  { targetId: "EBAY_HK", displayName: "Hong Kong", marketCode: "HK", locale: "zh-HK", language: "繁體中文", currency: "HKD" },
  { targetId: "EBAY_IE", displayName: "Ireland", marketCode: "IE", locale: "en-IE", language: "English", currency: "EUR" },
  { targetId: "EBAY_NL", displayName: "Nederland", marketCode: "NL", locale: "nl-NL", language: "Nederlands", currency: "EUR" },
  { targetId: "EBAY_PL", displayName: "Polska", marketCode: "PL", locale: "pl-PL", language: "Polski", currency: "PLN" },
];
type LocalizedListing = { channel: ActiveChannelKey; market: string; locale: string; title: string; shortDescription: string; description: string; keywords: string[] };
const categoryBootstrapRequestTimeoutMs = 30_000;
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
  ebayCategoryTreeBinding?: EbayCategoryTreeBinding;
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

const categoryStateStorageKey = (productId: string) => `sellerpilot:category-workbench:${productId}:v1`;

function isCredentialRow(value: unknown): value is CredentialRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.channel === "string"
    && activeChannelKeys.includes(row.channel as ActiveChannelKey)
    && (row.environment === "production" || row.environment === "sandbox")
    && typeof row.status === "string";
}

export function selectActiveProductionCredential(rows: unknown, channel: ActiveChannelKey) {
  if (!Array.isArray(rows)) return undefined;
  return rows.find((row): row is CredentialRow => isCredentialRow(row)
    && row.channel === channel
    && row.environment === "production"
    && row.status === "active");
}

export function activeProductionCredentialMap(rows: readonly CredentialRow[]) {
  const credentials = new Map<ActiveChannelKey, CredentialRow>();
  for (const row of rows) {
    if (row.environment !== "production" || row.status !== "active" || credentials.has(row.channel)) continue;
    credentials.set(row.channel, row);
  }
  return credentials;
}

export function bindEbayCategoryTree(payload: OperationPayload, marketplaceId: string): EbayCategoryTreeBinding | null {
  const normalizedMarketplaceId = marketplaceId.trim().toUpperCase();
  const categoryTreeId = payload.remoteId?.trim() ?? "";
  if (!/^EBAY_[A-Z]{2}$/.test(normalizedMarketplaceId) || !/^\d{1,20}$/.test(categoryTreeId)) return null;
  return { marketplaceId: normalizedMarketplaceId, categoryTreeId };
}

export function ebayCategoryInspectionArguments(
  categoryId: string,
  binding: EbayCategoryTreeBinding | undefined,
  marketplaceId: string,
) {
  const normalizedCategoryId = categoryId.trim();
  const normalizedMarketplaceId = marketplaceId.trim().toUpperCase();
  if (!normalizedCategoryId
      || !binding
      || binding.marketplaceId !== normalizedMarketplaceId
      || !/^\d{1,20}$/.test(binding.categoryTreeId)) return null;
  return { categoryId: normalizedCategoryId, categoryTreeId: binding.categoryTreeId };
}

function restoreCategoryStates(productId: string | null): Record<string, ChannelState> {
  if (!productId || typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(categoryStateStorageKey(productId)) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([key, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const state = value as Partial<ChannelState>;
      const phase = state.phase === "suggesting" || state.phase === "inspecting" ? "error" : state.phase;
      if (!phase || !["idle", "ready", "confirmed", "error"].includes(phase)) return [];
      return [[key, {
        ...initialState(),
        ...state,
        phase,
        suggestions: Array.isArray(state.suggestions) ? state.suggestions : [],
        attributes: Array.isArray(state.attributes) ? state.attributes : [],
        values: state.values && typeof state.values === "object" && !Array.isArray(state.values) ? state.values : {},
        // Taxonomy tree IDs are provider-issued market bindings. Never trust a
        // sessionStorage copy for a later official category validation call.
        ebayCategoryTreeBinding: undefined,
        error: state.phase === "suggesting" || state.phase === "inspecting"
          ? "페이지 전환 중 중단된 조회입니다. 현재 검색어로 다시 조회해 주세요."
          : state.error,
      } satisfies ChannelState]];
    }));
  } catch {
    return {};
  }
}

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
    .replace(/\[(?:api|program)\s*test[^\]]*\]/giu, " ")
    .replace(/\b(?:api|program)\s*test\b/giu, " ")
    .replace(/(?:판매\s*금지|섭취\s*금지|샘플\s*등록|not\s*for\s*sale|do\s*not\s*(?:sell|consume))/giu, " ")
    .replace(/[·|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  if (/(노트|수첩|notebook|notepad|ノート|メモ帳)/u.test(normalized)) aliases.push("リングノート", "ノート", "メモ帳", "文房具");
  if (/(청소천|극세사|행주|걸레|cleaning cloth|microfiber|クロス|ふきん)/u.test(normalized)) aliases.push("掃除クロス", "マイクロファイバークロス", "ふきん", "清掃用品");
  if (/(케이블|전선|cable|cord|ケーブル|コード|配線)/u.test(normalized)) aliases.push("ケーブルクリップ", "コードクリップ", "配線整理", "ケーブル整理");
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
  if (/(티셔츠|t[\s-]?shirt|반팔)/u.test(normalized)) return ["Tシャツ・カットソー", "Tシャツ"];
  if (/(후드|hood)/u.test(normalized)) return ["パーカー", "フード付きジャケット", "ジャケット"];
  if (/(재킷|jacket)/u.test(normalized)) return ["ジャケット", "アウター"];
  if (/(테디|곰인형|teddy)/u.test(normalized)) return ["テディベア", "ぬいぐるみ"];
  if (/(기차|열차|train)/u.test(normalized)) return ["電車のおもちゃ", "木製玩具"];
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
  if (/(노트|수첩|notebook|notepad|ノート|メモ帳)/u.test(normalized)) return ["リングノート", "ノート", "メモ帳"];
  if (/(청소천|극세사|행주|걸레|cleaning cloth|microfiber|クロス|ふきん)/u.test(normalized)) return ["マイクロファイバークロス", "掃除クロス", "ふきん", "清掃用品"];
  if (/(케이블|전선|cable|cord|ケーブル|コード|配線)/u.test(normalized)) return ["ケーブルクリップ", "コードクリップ", "配線整理", "ケーブル整理"];
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
  const value = `${path} ${candidate.name}`.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  if (!/(ふるさと納税|고향세)/u.test(query.toLocaleLowerCase()) && path.includes("ふるさと納税")) return false;
  if (/(teddy|plush|stuffed|테디|곰인형|봉제)/u.test(query.toLocaleLowerCase()) && /(犬用品|猫用品|ペット)/u.test(candidate.path.join(" "))) return false;
  if (/(노트|수첩|notebook|notepad|ノート|メモ帳)/u.test(normalizedQuery)) return /(リングノート|ノート|メモ帳|文房具)/u.test(value) && !/(ノートパソコン|パソコン|コンピュータ)/u.test(value);
  if (/(청소천|극세사|행주|걸레|cleaning cloth|microfiber|クロス|ふきん)/u.test(normalizedQuery)) return /(掃除.*クロス|マイクロファイバー|ふきん|雑巾|清掃用品)/u.test(value) && !/(デンタル|ホワイトニング|ブルーレイ)/u.test(value);
  if (/(케이블|전선|cable|cord|ケーブル|コード|配線)/u.test(normalizedQuery)) return /(ケーブル|コード|配線).*(クリップ|整理|収納)|クリップ.*(ケーブル|コード)/u.test(value) && !/(机|テーブル|こたつ)/u.test(value);
  return queryScore(qoo10SearchTerms(query), `${candidate.path.join(" ")} ${candidate.name}`) > 0;
}

function shopeeSearchTerms(query: string) {
  const normalized = query.toLocaleLowerCase();
  const aliases = [query];
  if (/(cup|mug|espresso|컵|머그|잔)/u.test(normalized)) aliases.push("mug cups drinkware dinnerware coffee tea");
  if (/(shirt|dress|pants|clothes|의류|옷|바지)/u.test(normalized)) aliases.push("fashion apparel tops bottoms clothing");
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
  if (/(fish\s?oil|omega|어유|오메가|dha|epa)/u.test(normalized)) aliases.push("fish oil omega 3 vitamins supplements health");
  if (/(vitamin|비타민)/u.test(normalized)) aliases.push("vitamins supplements health");
  if (/(tote|canvas|캔버스.*토트|토트백)/u.test(normalized)) aliases.push("tote bags fashion bags");
  if (/(storage\s?(?:box|bin)|organizer|수납.*박스|보관.*박스)/u.test(normalized)) aliases.push("storage boxes organizers home organization");
  if (/(hanger|옷걸이|행거)/u.test(normalized)) aliases.push("clothes hangers laundry organization home living");
  if (/(bag|pouch|가방|백)/u.test(normalized)) aliases.push("bags luggage accessories");
  if (/(shoe|sneaker|sandal|신발|슈즈)/u.test(normalized)) aliases.push("shoes sneakers footwear sandals");
  if (/(notebook|notepad|journal|노트|수첩)/u.test(normalized)) aliases.push("notebooks notepads journals stationery office supplies");
  if (/(cleaning cloth|microfiber|microfibre|청소천|극세사|행주|걸레)/u.test(normalized)) aliases.push("cleaning towels cloths microfiber rags household cleaning");
  if (/(cable|cord|wire|케이블|전선)/u.test(normalized)) aliases.push("cable clips ties organizers wire management computer accessories");
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
  if (/(t[\s-]?shirt|tee|티셔츠|반팔)/u.test(normalizedQuery)) {
    return /(fashion|clothes|clothing|apparel|top|shirt|hoodie|sweatshirt|jacket|outerwear)/u.test(normalizedCandidate);
  }
  if (/(cable|cord|wire|케이블|전선)/u.test(normalizedQuery)) {
    return /(cable|cord|wire).*(clip|tie|organizer|management)|(?:clip|tie|organizer).*(cable|cord|wire)/u.test(normalizedCandidate) && !/(table|desk|furniture)/u.test(normalizedCandidate);
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
  if (/(notebook|notepad|journal|노트|수첩)/u.test(normalizedQuery)) {
    return /(notebooks?|notepads?|journals?|stationery)/u.test(normalizedCandidate) && !/(laptop|computer|rubber-metal)/u.test(normalizedCandidate);
  }
  if (/(cleaning cloth|microfiber|microfibre|청소천|극세사|행주|걸레)/u.test(normalizedQuery)) {
    return /(cleaning.*(?:cloth|towel)|microfi(?:ber|bre)|dishcloth|household.*cleaning)/u.test(normalizedCandidate) && !/(diaper|baby|beauty)/u.test(normalizedCandidate);
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
  if (/(fish\s?oil|omega|어유|오메가|dha|epa)/u.test(normalizedQuery)) return score(["fish oil", "omega 3", "omega", "supplements", "health"]);
  if (/(vitamin|비타민)/u.test(normalizedQuery)) return score(["vitamins", "supplements", "health"]);
  if (/(sponge|puff|스펀지|퍼프)/u.test(normalizedQuery)) return score(["makeup sponges", "makeup puffs", "sponges", "puffs", "applicators"]);
  if (/(brush|브러시)/u.test(normalizedQuery)) return score(["makeup brushes", "cosmetic brushes"]);
  if (/(cream|moistur|크림|보습)/u.test(normalizedQuery)) return score(["face moisturizers", "facial moisturizers", "face cream", "skin care"]);
  if (/(hoodie|hood|후드)/u.test(normalizedQuery)) return score(["hoodies", "hooded sweatshirts", "sweatshirts"]);
  if (/(jacket|재킷)/u.test(normalizedQuery)) return score(["jackets", "outerwear"]);
  if (/(cable|cord|wire|케이블|전선)/u.test(normalizedQuery)) return score(["cable ties & organizers", "cable organizers", "cable clips", "wire management"]);
  if (/(storage\s?(?:box|bin)|organizer|수납.*박스|보관.*박스)/u.test(normalizedQuery)) return score(["storage boxes", "home organizers", "home & living"]);
  if (/(hanger|옷걸이|행거)/u.test(normalizedQuery)) return score(["clothes hangers", "clothing hangers", "coat hangers", "hangers"]);
  if (/(notebook|notepad|journal|노트|수첩)/u.test(normalizedQuery)) return score(["notebooks & notepads", "notebooks", "notepads", "journals", "stationery"]);
  if (/(cleaning cloth|microfiber|microfibre|청소천|극세사|행주|걸레)/u.test(normalizedQuery)) return score(["cleaning towels & cloths", "microfiber cloths", "cleaning cloths", "household cleaning"]);
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
  if (/(hoodie|후드|jaket)/u.test(normalized)) aliases.push("hoodies sweatshirts jackets clothing");
  if (/(teddy|beruang|곰인형|테디)/u.test(normalized)) aliases.push("teddy bears plush toys stuffed animals");
  if (/(kereta|toy\s?car|자동차.*완구|완구.*자동차)/u.test(normalized)) aliases.push("toy cars vehicles toys");
  if (/(minyak ikan|fish\s?oil|omega|오메가|어유)/u.test(normalized)) aliases.push("fish oil omega 3 supplements dha epa");
  if (/(vitamin|비타민)/u.test(normalized)) aliases.push("vitamins supplements health");
  if (/(tote|kanvas|캔버스.*토트|토트백)/u.test(normalized)) aliases.push("tote bags fashion bags");
  if (/(kotak simpanan|storage\s?(?:box|bin)|수납.*박스)/u.test(normalized)) aliases.push("storage boxes organizers home organization");
  if (/(penyangkut|hanger|옷걸이|행거)/u.test(normalized)) aliases.push("clothes hangers laundry organization");
  if (/(buku nota|notebook|notepad|journal|노트|수첩)/u.test(normalized)) aliases.push("notebooks notepads journals stationery office supplies");
  if (/(kain|lap|cleaning cloth|microfiber|microfibre|청소천|극세사|행주|걸레)/u.test(normalized)) aliases.push("cleaning cloths microfiber towels household cleaning kain pembersih");
  if (/(klip kabel|kabel|cable|cord|wire|케이블|전선)/u.test(normalized)) aliases.push("cable clips ties organizers wire management computer accessories");
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
  if (/(fish\s?oil|omega|오메가|어유|minyak ikan)/u.test(normalizedQuery)) return /fish oil|omega|dha|epa|minyak ikan|vitamin|supplement|health/u.test(`${path} ${name}`)
    && !/pet|animal feed|veterinary|mother|baby|infant|bayi|kanak|ibu/u.test(`${path} ${name}`);
  if (/(vitamin|비타민)/u.test(normalizedQuery)) return /vitamin|supplement/u.test(`${path} ${name}`);
  if (/(storage\s?(?:box|bin)|수납.*박스|kotak simpanan)/u.test(normalizedQuery)) return /storage|organizer|kotak|box/u.test(name);
  if (/(buku nota|notebook|notepad|journal|노트|수첩)/u.test(normalizedQuery)) return /notebook|notepad|journal|diary|stationery|buku nota/u.test(`${path} ${name}`) && !/computer|laptop|power supply/u.test(`${path} ${name}`);
  if (/(kain|lap|cleaning cloth|microfiber|microfibre|청소천|극세사|행주|걸레)/u.test(normalizedQuery)) return /cleaning.*(?:cloth|towel)|microfi(?:ber|bre)|kain pembersih|kain lap|household cleaning/u.test(`${path} ${name}`) && !/diaper|lampin|mother|baby|beauty/u.test(`${path} ${name}`);
  if (/(klip kabel|kabel|cable|cord|wire|케이블|전선)/u.test(normalizedQuery)) return /(cable|cord|wire|kabel).*(clip|tie|organizer|management|klip)|(?:clip|tie|organizer|klip).*(cable|cord|wire|kabel)/u.test(`${path} ${name}`) && !/furniture|table|desk/u.test(`${path} ${name}`);
  return lazadaQueryScore(lazadaSearchTerms(query), `${path} ${name}`) > 0;
}

function lazadaPriorityScore(query: string, candidate: CategorySuggestion) {
  const normalizedQuery = query.toLocaleLowerCase();
  const name = candidate.name.toLocaleLowerCase();
  const score = (terms: string[]) => terms.reduce((total, term, index) => name.includes(term) ? Math.max(total, terms.length - index) : total, 0);
  if (/(rice|쌀|밥|nasi)/u.test(normalizedQuery)) return score(["ready to eat rice", "instant rice", "white rice", "rice"]);
  if (/(pasta|penne|파스타|펜네)/u.test(normalizedQuery)) return score(["penne", "pasta", "noodles"]);
  if (/(flour|밀가루|tepung)/u.test(normalizedQuery)) return score(["wheat flour", "flour", "tepung"]);
  if (/(fish\s?oil|omega|오메가|어유|minyak ikan)/u.test(normalizedQuery)) return score(["fish oil", "omega 3", "omega", "dietary supplements", "vitamins & supplements", "health supplements"]);
  if (/(buku nota|notebook|notepad|journal|노트|수첩)/u.test(normalizedQuery)) return score(["notebooks", "notepads", "journals", "stationery"]);
  if (/(kain|lap|cleaning cloth|microfiber|microfibre|청소천|극세사|행주|걸레)/u.test(normalizedQuery)) return score(["cleaning cloths", "microfiber cloths", "cleaning towels", "household cleaning"]);
  if (/(klip kabel|kabel|cable|cord|wire|케이블|전선)/u.test(normalizedQuery)) return score(["cable clips", "cable ties", "cable organizers", "wire management"]);
  return 0;
}

function smartstoreSearchTerms(query: string) {
  const normalized = query.toLocaleLowerCase();
  const aliases = [query];
  if (/(화장품|메이크업|스킨|크림|립스틱|cosmetic|beauty)/u.test(normalized)) aliases.push("화장품 메이크업 스킨케어 뷰티");
  if (/(브러시|스펀지|퍼프|뷰러|속눈썹|화장도구)/u.test(normalized)) aliases.push("메이크업소품 화장소품 미용소품 브러시 퍼프 뷰러");
  if (/(쌀|밥|파스타|펜네|밀가루|식품|food|rice|pasta|flour)/u.test(normalized)) aliases.push("식품 농산물 가공식품 면류 쌀 밀가루");
  if (/(티셔츠|셔츠|후드|재킷|의류|옷|clothes|shirt|jacket)/u.test(normalized)) aliases.push("패션의류 티셔츠 셔츠 후드 집업 재킷");
  if (/(테디|곰인형|자동차.*완구|완구|장난감|toy|plush)/u.test(normalized)) aliases.push("완구 장난감 봉제인형 자동차완구 미니카");
  if (/(비타민|오메가|어유|건강식품|보충제|supplement|vitamin|omega)/u.test(normalized)) aliases.push("건강식품 건강기능식품 영양제 비타민 오메가3 어유");
  if (/(수납.*박스|보관.*박스|리빙박스|정리함|storage\s?(?:box|bin)|organizer)/u.test(normalized)) aliases.push("수납 박스 수납박스 리빙박스 수납함 정리함 정리 바구니");
  if (/(옷걸이|행거|hanger)/u.test(normalized)) aliases.push("옷걸이 행거 의류수납 세탁용품");
  if (/(노트|수첩|notebook|notepad|journal)/u.test(normalized)) aliases.push("문구 노트 수첩 메모지 스프링노트 다이어리");
  if (/(청소천|극세사|행주|걸레|cleaning cloth|microfiber)/u.test(normalized)) aliases.push("생활용품 청소용품 청소포 극세사 걸레 행주 타월 청소천");
  if (/(케이블|전선|cable|cord|wire)/u.test(normalized)) aliases.push("PC액세서리 케이블타이 케이블정리 전선정리 정리클립 정리함");
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
  if (/(테디|곰인형|봉제|teddy|plush)/u.test(normalizedQuery)) return /(봉제인형|곰인형|테디베어)\s*$/u.test(normalizedCandidate);
  if (/(자동차.*완구|완구.*자동차|자동차.*장난감|장난감.*차|toy\s?car)/u.test(normalizedQuery)) return /(자동차완구|미니카|장난감자동차|자동차장난감|작동완구|탈것완구|운송수단완구)/u.test(normalizedCandidate);
  if (/(비타민|오메가|어유|건강식품|보충제|supplement|vitamin|omega)/u.test(normalizedQuery)) {
    return /(건강식품|건강기능식품|영양제|비타민|오메가3|어유|epa|dha)/u.test(normalizedCandidate)
      && !/(반려|애완|동물)/u.test(normalizedCandidate);
  }
  if (/(수납.*박스|보관.*박스|리빙박스|정리함|storage\s?(?:box|bin)|organizer)/u.test(normalizedQuery)) return /(수납박스|리빙박스|수납함|정리함|정리 바구니)/u.test(normalizedCandidate);
  if (/(옷걸이|행거|hanger)/u.test(normalizedQuery)) return /(옷걸이|의류수납|세탁용품)/u.test(normalizedCandidate);
  if (/(캔버스.*토트|토트백|tote)/u.test(normalizedQuery)) return /(토트백|숄더백|에코백)/u.test(normalizedCandidate);
  if (/(노트|수첩|notebook|notepad|journal)/u.test(normalizedQuery)) return /(노트|수첩|메모지|다이어리)/u.test(normalizedCandidate) && !/(노트북|컴퓨터|가전)/u.test(normalizedCandidate);
  if (/(청소천|극세사|행주|걸레|cleaning cloth|microfiber)/u.test(normalizedQuery)) return /(청소천|청소포|극세사|걸레|행주|청소용품|다용도타월)/u.test(normalizedCandidate) && !/(유아|기저귀|패션|의류)/u.test(normalizedCandidate);
  if (/(케이블|전선|cable|cord|wire)/u.test(normalizedQuery)) return /(케이블타이|케이블.*정리|전선.*정리|정리클립|PC액세서리)/u.test(normalizedCandidate) && !/(가구|테이블|책상)/u.test(normalizedCandidate);
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
  if (/(노트|수첩|notebook|notepad|journal)/u.test(normalizedQuery)) return score(["스프링노트", "일반노트", "노트", "수첩", "메모지", "다이어리"]);
  if (/(청소천|극세사|행주|걸레|cleaning cloth|microfiber)/u.test(normalizedQuery)) return score(["극세사걸레", "청소천", "청소포", "걸레", "행주", "청소용품"]);
  if (/(케이블|전선|cable|cord|wire)/u.test(normalizedQuery)) return score(["케이블타이/정리함", "케이블정리", "전선정리", "정리클립", "PC액세서리"]);
  if (/(자동차.*완구|완구.*자동차|자동차.*장난감|장난감.*차|toy\s?car)/u.test(normalizedQuery)) return score(["미니카", "자동차완구", "장난감자동차", "작동완구", "탈것완구"]);
  if (/(수납.*박스|보관.*박스|리빙박스|정리함|storage\s?(?:box|bin)|organizer)/u.test(normalizedQuery)) return score(["리빙박스", "수납박스", "수납함", "정리함"]);
  return 0;
}

function ebayCategoryCompatibility(query: string, candidate: CategorySuggestion) {
  const normalizedQuery = query.toLocaleLowerCase();
  const normalizedCandidate = `${candidate.path.join(" ")} ${candidate.name}`.toLocaleLowerCase();
  if (/(노트|수첩|notebook|notepad|journal)/u.test(normalizedQuery)) {
    return /(notebook|notepad|diar|journal|office supplies)/u.test(normalizedCandidate)
      && !/(cell phone|smartphone|computer|laptop|tablet)/u.test(normalizedCandidate);
  }
  if (/(청소천|극세사|행주|걸레|cleaning cloth|microfiber)/u.test(normalizedQuery)) {
    return /(cleaning.*(?:towel|cloth|tool)|towels?.*dishcloth|household supplies)/u.test(normalizedCandidate)
      && !/(diaper|clothing|fashion)/u.test(normalizedCandidate);
  }
  if (/(케이블|전선|cable|cord|wire)/u.test(normalizedQuery)) {
    return /(?:cable|cord|wire).*(?:tie|organizer|connector)|cable ties & organizers/u.test(normalizedCandidate)
      && !/(furniture|desk|table|cell phone)/u.test(normalizedCandidate);
  }
  return queryScore(query, normalizedCandidate) > 0;
}

function ebayPriorityScore(query: string, candidate: CategorySuggestion) {
  const normalizedQuery = query.toLocaleLowerCase();
  const value = `${candidate.path.join(" ")} ${candidate.name}`.toLocaleLowerCase();
  const score = (terms: string[]) => terms.reduce((total, term, index) => value.includes(term) ? Math.max(total, terms.length - index) : total, 0);
  if (/(노트|수첩|notebook|notepad|journal)/u.test(normalizedQuery)) return score(["blank diaries & journals", "notebooks", "notepads", "journals", "office supplies"]);
  if (/(청소천|극세사|행주|걸레|cleaning cloth|microfiber)/u.test(normalizedQuery)) return score(["cleaning towels & cloths", "cleaning cloths", "towels & dishcloths", "cleaning tools", "household supplies"]);
  if (/(케이블|전선|cable|cord|wire)/u.test(normalizedQuery)) return score(["cable ties & organizers", "cable organizers", "cord organizers", "computer cables & connectors"]);
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
    return [{
      id: text(directCoupang, ["predictedCategoryId"]),
      name: text(directCoupang, ["predictedCategoryName"]) || "쿠팡 추천 카테고리",
      path: [text(directCoupang, ["predictedCategoryName"])].filter(Boolean),
      confidence: text(directCoupang, ["autoCategorizationPredictionResultType"]) === "SUCCESS" ? 0.98 : 0.72,
      leaf: true,
    }];
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
    .filter((item) => channel !== "ebay" || ebayCategoryCompatibility(query, item))
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
      if (channel === "ebay") {
        const leftPriority = ebayPriorityScore(query, left);
        const rightPriority = ebayPriorityScore(query, right);
        if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      }
      return right.confidence - left.confidence;
    })
    .slice(0, 5);
}

function normalizeAttributes(payloads: OperationPayload[]) {
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
  return [...new Map(found.map((item) => [item.id, item])).values()].sort((left, right) => Number(right.required) - Number(left.required));
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
  const [states, setStates] = useState<Record<string, ChannelState>>(() => restoreCategoryStates(productId));
  const [restoredProductId, setRestoredProductId] = useState(productId);
  const [targets, setTargets] = useState<Partial<Record<"shopee" | "lazada" | "ebay", ChannelTarget[]>>>({ ebay: ebayMarketplaceTargets });
  const [targetErrors, setTargetErrors] = useState<Partial<Record<"shopee" | "lazada" | "ebay", string>>>({});
  const [selectedMarkets, setSelectedMarkets] = useState<Partial<Record<"shopee" | "lazada" | "ebay", string>>>({ ebay: "US" });
  const [localizedListings, setLocalizedListings] = useState<LocalizedListing[]>([]);
  const [sourceImageUrl, setSourceImageUrl] = useState("");
  const [loadingCredentials, setLoadingCredentials] = useState(true);
  const [bootstrapVersion, setBootstrapVersion] = useState(0);
  const bootstrapGenerationRef = useRef(0);

  useEffect(() => setQuery(productName), [productName]);
  useEffect(() => {
    if (restoredProductId === productId) return;
    setStates(restoreCategoryStates(productId));
    setRestoredProductId(productId);
  }, [productId, restoredProductId]);
  useEffect(() => {
    if (!productId || restoredProductId !== productId) return;
    window.sessionStorage.setItem(categoryStateStorageKey(productId), JSON.stringify(states));
  }, [productId, restoredProductId, states]);
  useEffect(() => {
    let active = true;
    const generation = bootstrapGenerationRef.current + 1;
    bootstrapGenerationRef.current = generation;
    const controller = new AbortController();
    const bounded = createBoundedRequestSignal(
      controller.signal,
      categoryBootstrapRequestTimeoutMs,
      "채널 등록 준비 조회가 30초를 초과했습니다. 다시 확인해 주세요.",
    );
    const isLatestRequest = () => active && bootstrapGenerationRef.current === generation;
    setLoadingCredentials(true);
    setSourceImageUrl("");
    void (async () => {
      try {
        const supabase = createClient();
        const [{ data, error }, { data: sessionData }] = await Promise.all([
          waitForAbortablePromise(supabase.rpc("sellerpilot_list_credentials").abortSignal(bounded.signal), bounded.signal),
          waitForAbortablePromise(supabase.auth.getSession(), bounded.signal),
        ]);
        if (!isLatestRequest()) return;
        if (bounded.signal.aborted) throw bounded.signal.reason ?? new DOMException("채널 등록 준비 조회가 중단되었습니다.", "AbortError");
        setCredentials(error || !Array.isArray(data) ? [] : data.filter(isCredentialRow));
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) {
          const message = "채널 등록 대상을 보려면 다시 로그인해 주세요.";
          setTargets({ ebay: ebayMarketplaceTargets });
          setTargetErrors({ shopee: message, lazada: message });
          setLocalizedListings([]);
          return;
        }
        const [shopeeResult, lazadaResult, contextResult] = await Promise.allSettled([
          fetchChannelTargets("shopee", accessToken, { signal: bounded.signal }),
          fetchChannelTargets("lazada", accessToken, { signal: bounded.signal }),
          productId
            ? waitForAbortablePromise(fetch(`/api/admin/products/${productId}/publish-context`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: bounded.signal }), bounded.signal)
            : Promise.resolve(null),
        ]);
        if (!isLatestRequest()) return;
        if (bounded.signal.aborted) throw bounded.signal.reason ?? new DOMException("채널 등록 준비 조회가 중단되었습니다.", "AbortError");
        const readTargets = async (result: PromiseSettledResult<Response>, label: string) => {
          if (result.status === "rejected") {
            return { targets: [] as ChannelTarget[], error: result.reason instanceof Error ? result.reason.message : `${label} 등록 대상 정보를 불러오지 못했습니다.` };
          }
          const payload = await waitForAbortablePromise(
            result.value.json().catch(() => ({ targets: [] })),
            bounded.signal,
          ) as { targets?: ChannelTarget[]; message?: string };
          return {
            targets: result.value.ok && Array.isArray(payload.targets) ? payload.targets : [],
            error: result.value.ok ? "" : payload.message ?? `${label} 등록 대상 정보를 불러오지 못했습니다.`,
          };
        };
        const [shopee, lazada] = await Promise.all([
          readTargets(shopeeResult, "Shopee"),
          readTargets(lazadaResult, "Lazada"),
        ]);
        let contextPayload: {
          localizedListings?: LocalizedListing[];
          sourceImages?: Array<{ url?: string | null }>;
          generatedImages?: Array<{ url?: string | null }>;
        } = { localizedListings: [] };
        if (contextResult.status === "fulfilled" && contextResult.value?.ok) {
          contextPayload = await waitForAbortablePromise(
            contextResult.value.json().catch(() => ({ localizedListings: [] })),
            bounded.signal,
          );
        }
        if (!isLatestRequest()) return;
        if (bounded.signal.aborted) throw bounded.signal.reason ?? new DOMException("채널 등록 준비 조회가 중단되었습니다.", "AbortError");
        setTargets({ shopee: shopee.targets, lazada: lazada.targets, ebay: ebayMarketplaceTargets });
        setTargetErrors({ shopee: shopee.error, lazada: lazada.error });
        setSelectedMarkets((current) => ({
          shopee: shopee.targets.some((target) => target.marketCode === current.shopee) ? current.shopee : shopee.targets[0]?.marketCode,
          lazada: lazada.targets.some((target) => target.marketCode === current.lazada) ? current.lazada : lazada.targets[0]?.marketCode,
          ebay: current.ebay ?? ebayMarketplaceTargets[0].marketCode,
        }));
        setLocalizedListings(Array.isArray(contextPayload.localizedListings) ? contextPayload.localizedListings : []);
        setSourceImageUrl(
          contextPayload.sourceImages?.find((image) => image.url)?.url
          ?? contextPayload.generatedImages?.find((image) => image.url)?.url
          ?? "",
        );
      } catch (error) {
        if (!isLatestRequest() || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "채널 등록 준비 정보를 불러오지 못했습니다.";
        setCredentials([]);
        setTargets({ ebay: ebayMarketplaceTargets });
        setTargetErrors({ shopee: message, lazada: message });
        setLocalizedListings([]);
        setSourceImageUrl("");
      } finally {
        bounded.dispose();
        if (isLatestRequest()) setLoadingCredentials(false);
      }
    })();
    return () => {
      active = false;
      controller.abort(new DOMException("채널 등록 준비 화면이 변경되었습니다.", "AbortError"));
      bounded.dispose();
    };
  }, [bootstrapVersion, productId]);

  const activeCredential = useMemo(() => activeProductionCredentialMap(credentials), [credentials]);
  const visibleChannels = useMemo(() => {
    if (!enabledChannels?.length) return activeChannelKeys;
    const enabled = new Set(enabledChannels);
    return activeChannelKeys.filter((channel) => enabled.has(channel));
  }, [enabledChannels]);

  const selectedTarget = useCallback((channel: ActiveChannelKey) => {
    if (channel !== "shopee" && channel !== "lazada" && channel !== "ebay") return undefined;
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
    const targetMarket = (channel === "shopee" || channel === "lazada" || channel === "ebay")
      ? selectedTarget(channel)?.marketCode
      : ({ qoo10: "JP", coupang: "KR", elevenst: "KR", smartstore: "KR", ebay: "US", temu: "KR" } as const)[channel];
    const localized = localizedListings.find((listing) => listing.channel === channel && listing.market === targetMarket);
    return sanitizeCategoryQuery(localized?.title ?? manualQuery);
  }, [localizedListings, productName, query, selectedTarget]);

  const operation = useCallback(async (channel: ActiveChannelKey, name: "categories.suggest" | "categories.attributes" | "categories.validate", args: Record<string, unknown>) => {
    const supabase = createClient();
    const [{ data: sessionData }, { data: latestCredentialRows }] = await Promise.all([
      supabase.auth.getSession(),
      supabase.rpc("sellerpilot_list_credentials"),
    ]);
    const credential = selectActiveProductionCredential(latestCredentialRows, channel)
      ?? activeCredential.get(channel);
    if (!credential) throw new Error("실제 API 키 연결이 필요합니다.");
    const response = await fetch("/api/admin/channel-operations", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sessionData.session?.access_token ?? ""}` },
      body: JSON.stringify({ credentialId: credential.id, channel, operation: name, idempotencyKey: crypto.randomUUID(), confirmWrite: false, arguments: args }),
    });
    const payload = await response.json().catch(() => ({ message: "채널 응답을 읽지 못했습니다." })) as OperationPayload;
    if (!response.ok || payload.ok === false) throw new Error(payload.message ?? `${channelCatalog[channel].name} 공식 API가 오류를 반환했습니다.`);
    return payload;
  }, [activeCredential]);

  const suggest = async (channel: ActiveChannelKey) => {
    const textQuery = localizedQuery(channel);
    if (textQuery.length < 2) return notify("카테고리 검색에 사용할 상품명을 2자 이상 입력해 주세요.");
    const key = stateKey(channel);
    const target = selectedTarget(channel);
    let ebayTreeBinding: EbayCategoryTreeBinding | undefined;
    setStates((current) => ({ ...current, [key]: { ...(current[key] ?? initialState()), phase: "suggesting", error: undefined } }));
    try {
      if (channel === "lazada" && !sourceImageUrl) throw new Error("Lazada 공식 카테고리 추천에 사용할 대표이미지를 불러오지 못했습니다.");
      const marketArgs = marketArguments(channel);
      const args: Record<string, unknown> = channel === "coupang"
        ? { query: textQuery, body: { productDescription: description.slice(0, 3000), attributes: {} } }
        : channel === "ebay"
          ? { query: textQuery, marketplaceId: target?.targetId ?? "EBAY_US", categoryTreeId: "" }
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
      const payload = await operation(channel, "categories.suggest", args);
      if (channel === "ebay") {
        const binding = bindEbayCategoryTree(payload, target?.targetId ?? "");
        if (!binding) throw new Error("선택한 eBay 마켓의 공식 카테고리 트리를 확인하지 못했습니다.");
        ebayTreeBinding = binding;
      }
      const suggestions = normalizeSuggestions(channel, payload, textQuery);
      if (!suggestions.length) throw new Error("공식 카테고리 응답에서 일치하는 말단 카테고리를 찾지 못했습니다.");
      setStates((current) => ({ ...current, [key]: { ...initialState(), phase: "idle", suggestions, ebayCategoryTreeBinding: ebayTreeBinding } }));
    } catch (error) {
      setStates((current) => ({ ...current, [key]: {
        ...(current[key] ?? initialState()),
        ...(ebayTreeBinding ? { ebayCategoryTreeBinding: ebayTreeBinding } : {}),
        phase: "error",
        error: error instanceof Error ? error.message : "카테고리 추천 실패",
      } }));
    }
  };

  const inspect = async (channel: ActiveChannelKey, selected: CategorySuggestion) => {
    const key = stateKey(channel);
    const target = selectedTarget(channel);
    const currentState = states[key] ?? initialState();
    setStates((current) => ({ ...current, [key]: { ...(current[key] ?? initialState()), selected, phase: "inspecting", error: undefined } }));
    try {
      const ebayArguments = channel === "ebay"
        ? ebayCategoryInspectionArguments(selected.id, currentState.ebayCategoryTreeBinding, target?.targetId ?? "")
        : null;
      if (channel === "ebay" && !ebayArguments) {
        throw new Error("선택한 eBay 마켓에서 카테고리를 다시 검색한 뒤 공식 속성을 확인해 주세요.");
      }
      const common = channel === "ebay"
        ? ebayArguments!
        : channel === "temu"
          ? { categoryId: selected.id, goodsName: localizedQuery(channel), description: description.slice(0, 3000) }
          : { categoryId: selected.id, ...marketArguments(channel) };
      const [attributesPayload, validationPayload] = await Promise.all([
        operation(channel, "categories.attributes", common),
        operation(channel, "categories.validate", common),
      ]);
      const attributes = normalizeAttributes([attributesPayload]);
      const verifiedLeaf = selected.leaf && validationPayload.ok !== false;
      setStates((current) => ({ ...current, [key]: { ...(current[key] ?? initialState()), selected, attributes, values: {}, verifiedLeaf, phase: "ready" } }));
    } catch (error) {
      setStates((current) => ({ ...current, [key]: { ...(current[key] ?? initialState()), selected, phase: "error", error: error instanceof Error ? error.message : "카테고리 메타정보 조회 실패" } }));
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
    const key = stateKey(channel);
    const state = states[key];
    const credential = activeCredential.get(channel);
    const target = selectedTarget(channel);
    if (!state?.selected || !credential) return;
    const selectedCategory = state.selected;
    if (!productId) {
      notify("ChatGPT CLI 분석과 상품 원장 저장을 먼저 완료해 주세요.");
      return;
    }
    const missing = state.attributes.filter((attribute) => attribute.required && !state.values[attribute.id]?.trim());
    if (!state.verifiedLeaf || missing.length) {
      notify(!state.verifiedLeaf ? "공식 API로 말단 카테고리 유효성을 먼저 확인해 주세요." : `필수 속성 ${missing.length}개를 모두 입력해 주세요.`);
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
      p_market: assignmentTarget?.marketCode ?? channelCatalog[channel].market,
      p_category_id: selectedCategory.id,
      p_category_path: selectedCategory.path,
      p_is_leaf: state.verifiedLeaf,
      p_confidence: selectedCategory.confidence,
      p_classification_source: channel === "coupang" || channel === "lazada" || channel === "ebay" ? "channel_recommendation" : "official_tree_search",
      p_required_attributes: requiredAttributes,
      p_provided_attributes: providedAttributes,
      p_official_metadata: {
        verifiedBy: "channel_api",
        verifiedAt: new Date().toISOString(),
        targetId: assignmentTarget?.targetId ?? null,
        locale: assignmentTarget?.locale ?? null,
        globalProduct: channel === "shopee",
        categoryTreeId: channel === "ebay" ? state.ebayCategoryTreeBinding?.categoryTreeId ?? null : null,
      },
      p_confirm: true,
    })));
    if (results.some((result) => result.error)) return notify("카테고리 확정값을 저장하지 못했습니다. DB 마이그레이션과 관리자 권한을 확인해 주세요.");
    setStates((current) => ({ ...current, [key]: { ...state, phase: "confirmed" } }));
    onConfirmed?.(channel);
    notify(`${channelCatalog[channel].name} 카테고리와 필수 속성을 ${channel === "shopee" ? `${assignmentTargets.length}개 숍에 ` : ""}확정했습니다.`);
  };

  return <section className="panel category-workbench">
    <div className="category-workbench-head"><div><span className="panel-kicker">OFFICIAL CATEGORY PREFLIGHT</span><h3>채널별 카테고리 확정</h3><p>공식 API 추천·말단 여부·필수 속성을 검증하고 실제 등록 사전조건으로 저장합니다.</p></div><span className="step-chip">STEP 3 / 3</span></div>
    <div className="category-query"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="브랜드·제품 종류·용량·용도를 포함한 정확한 상품명" /><small>카테고리 수수료와 노출이 달라질 수 있으므로 자동 추천 뒤 판매자가 최종 확정합니다.</small></div>
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
        <header><span>{definition.mark}</span><div><small>{target ? `${target.marketCode} · ${target.language}` : definition.market}</small><h4>{definition.name}</h4></div><em className={credential ? "connected" : "missing"}>{loadingCredentials ? "확인 중" : credential ? "실키 연결" : "키 필요"}</em></header>
        {(channel === "shopee" || channel === "lazada" || channel === "ebay") && (targets[channel]?.length ?? 0) > 0 && <label className="category-market-select"><span>등록 국가·언어</span><select value={target?.marketCode ?? ""} onChange={(event) => setSelectedMarkets((current) => ({ ...current, [channel]: event.target.value }))}>{targets[channel]?.map((item) => <option value={item.marketCode} key={`${item.marketCode}-${item.targetId}`}>{item.marketCode} · {item.displayName || item.language} · {item.locale}</option>)}</select>{channel === "ebay" ? <small>선택 국가의 공식 category tree를 조회합니다.</small> : null}</label>}
        {requiresTarget && targetErrors[channel] && <p className="category-error"><AlertTriangle size={14} /><span>{targetErrors[channel]}</span><button type="button" disabled={loadingCredentials} onClick={() => setBootstrapVersion((current) => current + 1)}><RefreshCw className={loadingCredentials ? "spin" : undefined} size={13} />다시 확인</button></p>}
        {!state.suggestions.length && !state.selected && <div className="category-empty"><Tags size={21} /><b>{!targetReady ? "등록 대상 동기화 필요" : credential ? productId ? "공식 카테고리 추천 대기" : "상품 원장 연결 대기" : "API 키 연결 후 사용"}</b><small>{!targetReady ? "OAuth 재승인 후 국가·언어 정보를 다시 동기화하세요." : credential ? productId ? "상품명으로 채널 원본 분류를 조회합니다." : "AI 분석을 완료해 상품 UUID를 먼저 생성하세요." : "API 키 관리에서 운영 키를 먼저 연결하세요."}</small><button type="button" disabled={!credential || !productId || !targetReady || busy} onClick={() => void suggest(channel)}>{busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{!targetReady ? "OAuth 재승인 필요" : "공식 API 추천"}</button>{credential && productId && targetReady && <div className="category-manual-fallback"><b>공식 ID 수동 검증</b><small>추천 결과가 없을 때 판매자센터에서 확인한 실제 말단 카테고리를 입력합니다. 저장 전 공식 속성·유효성 API를 다시 통과해야 합니다.</small><label><span>카테고리 ID <em>필수</em></span><input required aria-label={`${definition.name} 수동 카테고리 ID`} value={state.manualCategoryId} onChange={(event) => setStates((current) => ({ ...current, [key]: { ...(current[key] ?? initialState()), manualCategoryId: event.target.value } }))} placeholder="공식 말단 카테고리 ID" /></label><label><span>카테고리명 <em>필수</em></span><input required aria-label={`${definition.name} 수동 카테고리명`} value={state.manualCategoryName} onChange={(event) => setStates((current) => ({ ...current, [key]: { ...(current[key] ?? initialState()), manualCategoryName: event.target.value } }))} placeholder="공식 카테고리명" /></label><label><span>전체 경로</span><input aria-label={`${definition.name} 수동 카테고리 경로`} value={state.manualCategoryPath} onChange={(event) => setStates((current) => ({ ...current, [key]: { ...(current[key] ?? initialState()), manualCategoryPath: event.target.value } }))} placeholder="상위 › 하위 › 말단" /></label><button type="button" className="category-manual-verify" disabled={busy || !state.manualCategoryId.trim() || !state.manualCategoryName.trim()} onClick={() => void inspectManualCategory(channel)}><ShieldCheck size={14} />공식 API로 검증</button></div>}</div>}
        {state.suggestions.length > 0 && !state.selected && <div className="category-suggestions"><div className="category-suggestions-toolbar"><small>후보가 맞지 않으면 위 검색어를 고친 뒤 이 채널만 다시 조회하세요.</small><button type="button" disabled={busy} onClick={() => void suggest(channel)}>{busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}현재 검색어로 다시 추천</button></div>{state.suggestions.map((suggestion, index) => <button type="button" onClick={() => void inspect(channel, suggestion)} key={`${suggestion.id}-${suggestion.name}`}><span><b>{index + 1}. {suggestion.name}</b><small>{categoryPathLabel(suggestion)}</small></span><em>{Math.round(suggestion.confidence * 100)}%</em><ChevronRight size={14} /></button>)}</div>}
        {state.selected && <div className="category-inspection"><div className="selected-category"><BadgeCheck size={18} /><span><b>{state.selected.name}</b><small>{categoryPathLabel(state.selected)} · ID {state.selected.id}</small></span><button type="button" onClick={() => setStates((current) => ({ ...current, [key]: { ...initialState(), suggestions: state.suggestions } }))}>다시 선택</button></div>{state.phase === "inspecting" ? <p className="category-loading"><LoaderCircle className="spin" size={16} />공식 속성·유효성 동시 확인 중</p> : <><div className="category-proof"><span className={state.verifiedLeaf ? "passed" : "failed"}><ShieldCheck size={14} />{state.verifiedLeaf ? "말단 카테고리 확인" : "유효성 확인 필요"}</span><span className={completedRequired === required.length ? "passed" : "failed"}><Check size={14} />필수 속성 {completedRequired}/{required.length}</span></div>{required.length > 0 && <div className="category-attribute-list">{required.map((attribute) => <label key={attribute.id}><span>{attribute.name}<em>필수</em></span>{attribute.values.length ? <select value={state.values[attribute.id] ?? ""} onChange={(event) => setStates((current) => ({ ...current, [key]: { ...state, values: { ...state.values, [attribute.id]: event.target.value } } }))}><option value="">값 선택</option>{attribute.values.map((value) => <option value={value.id} key={value.id}>{value.name}</option>)}</select> : <input value={state.values[attribute.id] ?? ""} onChange={(event) => setStates((current) => ({ ...current, [key]: { ...state, values: { ...state.values, [attribute.id]: event.target.value } } }))} placeholder={`${attribute.name} 입력`} />}</label>)}</div>}<button type="button" className="category-confirm" onClick={() => void confirm(channel)} disabled={!state.verifiedLeaf || completedRequired !== required.length || state.phase === "confirmed"}>{state.phase === "confirmed" ? <><Check size={15} />카테고리 저장됨</> : "카테고리·속성 저장"}</button></>}</div>}
        {state.error && <p className="category-error"><AlertTriangle size={14} />{state.error}</p>}
      </article>;
    })}</div>
  </section>;
}
