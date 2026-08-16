"use client";

import { AlertTriangle, BadgeCheck, Check, ChevronRight, LoaderCircle, RefreshCw, Search, ShieldCheck, Tags } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { activeChannelKeys, channelCatalog, type ActiveChannelKey } from "../lib/channels/catalog";
import { createClient } from "../lib/supabase/client";

type CredentialRow = {
  id: string;
  channel: ActiveChannelKey;
  environment: "sandbox" | "production";
  status: string;
};

type OperationStep = { name: string; ok: boolean; status: number; data: Record<string, unknown> };
type OperationPayload = { ok?: boolean; steps?: OperationStep[]; message?: string };
type CategorySuggestion = { id: string; name: string; path: string[]; confidence: number; leaf: boolean };
type CategoryAttribute = { id: string; name: string; required: boolean; values: string[] };
type ChannelState = {
  phase: "idle" | "suggesting" | "inspecting" | "ready" | "confirmed" | "error";
  suggestions: CategorySuggestion[];
  selected?: CategorySuggestion;
  attributes: CategoryAttribute[];
  values: Record<string, string>;
  verifiedLeaf: boolean;
  error?: string;
};

const initialState = (): ChannelState => ({ phase: "idle", suggestions: [], attributes: [], values: {}, verifiedLeaf: false });

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

function normalizeSuggestions(channel: ActiveChannelKey, payload: OperationPayload, query: string) {
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

  const candidates = records(root).flatMap((row): CategorySuggestion[] => {
    const id = text(row, ["categoryId", "category_id", "category_id_list", "categoryId", "id", "catId", "category_code", "SecondSubCatCd"]);
    const name = text(row, ["categoryName", "category_name", "display_category_name", "display_name", "name", "catName", "SecondSubCatNm"]);
    if (!id || !name || id.length > 120 || name.length > 300) return [];
    const whole = text(row, ["wholeCategoryName", "category_path", "categoryPath", "path"]);
    const ancestors = Array.isArray(row.categoryTreeNodeAncestors)
      ? row.categoryTreeNodeAncestors.map((item) => item && typeof item === "object" ? text(item as Record<string, unknown>, ["categoryName", "name"]) : "").filter(Boolean).reverse()
      : [];
    const path = whole ? whole.split(/\s*>\s*|\s*\/\s*/).filter(Boolean) : [...ancestors, name];
    const leaf = booleanValue(row, ["leaf", "last", "leafCategoryTreeNode"], !booleanValue(row, ["has_children", "hasChildren"], false));
    const score = Math.max(queryScore(query, `${path.join(" ")} ${name}`), Number(row.confidence ?? row.score ?? 0));
    return [{ id, name, path: path.length ? path : [name], confidence: Math.min(0.99, Math.max(0.45, score || 0.58)), leaf }];
  });

  return [...new Map(candidates.map((item) => [`${item.id}:${item.name}`, item])).values()]
    .filter((item) => item.leaf)
    .sort((left, right) => right.confidence - left.confidence)
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
    const optionRows = Array.isArray(row.options) ? row.options : Array.isArray(row.attributeValues) ? row.attributeValues : Array.isArray(row.aspectValues) ? row.aspectValues : [];
    const values = optionRows.map((item) => item && typeof item === "object"
      ? text(item as Record<string, unknown>, ["name", "value", "localizedValue", "display_value"])
      : typeof item === "string" ? item : "").filter(Boolean).slice(0, 100);
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
  const [states, setStates] = useState<Partial<Record<ActiveChannelKey, ChannelState>>>({});
  const [loadingCredentials, setLoadingCredentials] = useState(true);

  useEffect(() => setQuery(productName), [productName]);
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const { data, error } = await createClient().rpc("sellerpilot_list_credentials");
      if (!mounted) return;
      setCredentials(error || !Array.isArray(data) ? [] : data.filter((row): row is CredentialRow => Boolean(row && typeof row === "object" && "id" in row && "channel" in row && "environment" in row && "status" in row)));
      setLoadingCredentials(false);
    })();
    return () => { mounted = false; };
  }, []);

  const activeCredential = useMemo(() => new Map(credentials.filter((row) => row.status === "active").map((row) => [row.channel, row])), [credentials]);
  const visibleChannels = useMemo(() => {
    if (!enabledChannels?.length) return activeChannelKeys;
    const enabled = new Set(enabledChannels);
    return activeChannelKeys.filter((channel) => enabled.has(channel));
  }, [enabledChannels]);

  const operation = useCallback(async (channel: ActiveChannelKey, name: "categories.suggest" | "categories.attributes" | "categories.validate", args: Record<string, unknown>) => {
    const credential = activeCredential.get(channel);
    if (!credential) throw new Error("실제 API 키 연결이 필요합니다.");
    const { data: sessionData } = await createClient().auth.getSession();
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
    const textQuery = query.trim();
    if (textQuery.length < 2) return notify("카테고리 검색에 사용할 상품명을 2자 이상 입력해 주세요.");
    setStates((current) => ({ ...current, [channel]: { ...(current[channel] ?? initialState()), phase: "suggesting", error: undefined } }));
    try {
      const args: Record<string, unknown> = channel === "coupang"
        ? { query: textQuery, body: { productDescription: description.slice(0, 3000), attributes: {} } }
        : channel === "ebay"
          ? { query: textQuery, marketplaceId: "EBAY_US", categoryTreeId: "" }
          : channel === "shopee"
            ? { queryText: textQuery, query: { language: "en" } }
            : channel === "lazada"
              ? { query: textQuery, queryParams: {} }
              : channel === "qoo10"
                ? { query: textQuery, params: {} }
                : { query: textQuery };
      const payload = await operation(channel, "categories.suggest", args);
      const suggestions = normalizeSuggestions(channel, payload, textQuery);
      if (!suggestions.length) throw new Error("공식 카테고리 응답에서 일치하는 말단 카테고리를 찾지 못했습니다.");
      setStates((current) => ({ ...current, [channel]: { ...initialState(), phase: "idle", suggestions } }));
    } catch (error) {
      setStates((current) => ({ ...current, [channel]: { ...(current[channel] ?? initialState()), phase: "error", error: error instanceof Error ? error.message : "카테고리 추천 실패" } }));
    }
  };

  const inspect = async (channel: ActiveChannelKey, selected: CategorySuggestion) => {
    setStates((current) => ({ ...current, [channel]: { ...(current[channel] ?? initialState()), selected, phase: "inspecting", error: undefined } }));
    try {
      const common = channel === "ebay" ? { categoryId: selected.id, categoryTreeId: "0" } : { categoryId: selected.id };
      const [attributesPayload, validationPayload] = await Promise.all([
        operation(channel, "categories.attributes", common),
        operation(channel, "categories.validate", common),
      ]);
      const attributes = normalizeAttributes([attributesPayload]);
      const verifiedLeaf = selected.leaf && validationPayload.ok !== false;
      setStates((current) => ({ ...current, [channel]: { ...(current[channel] ?? initialState()), selected, attributes, values: {}, verifiedLeaf, phase: "ready" } }));
    } catch (error) {
      setStates((current) => ({ ...current, [channel]: { ...(current[channel] ?? initialState()), selected, phase: "error", error: error instanceof Error ? error.message : "카테고리 메타정보 조회 실패" } }));
    }
  };

  const confirm = async (channel: ActiveChannelKey) => {
    const state = states[channel];
    const credential = activeCredential.get(channel);
    if (!state?.selected || !credential) return;
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
    const { error } = await createClient().rpc("sellerpilot_save_product_category_assignment", {
      p_product_id: productId,
      p_source_ref: sourceRef,
      p_product_name: productName,
      p_channel: channel,
      p_environment: credential.environment,
      p_market: channel === "ebay" ? "EBAY_US" : channelCatalog[channel].market,
      p_category_id: state.selected.id,
      p_category_path: state.selected.path,
      p_is_leaf: state.verifiedLeaf,
      p_confidence: state.selected.confidence,
      p_classification_source: channel === "coupang" || channel === "lazada" || channel === "ebay" ? "channel_recommendation" : "official_tree_search",
      p_required_attributes: requiredAttributes,
      p_provided_attributes: state.values,
      p_official_metadata: { verifiedBy: "channel_api", verifiedAt: new Date().toISOString() },
      p_confirm: true,
    });
    if (error) return notify("카테고리 확정값을 저장하지 못했습니다. DB 마이그레이션과 관리자 권한을 확인해 주세요.");
    setStates((current) => ({ ...current, [channel]: { ...state, phase: "confirmed" } }));
    onConfirmed?.(channel);
    notify(`${channelCatalog[channel].name} 카테고리와 필수 속성을 확정했습니다.`);
  };

  return <section className="panel category-workbench">
    <div className="category-workbench-head"><div><span className="panel-kicker">OFFICIAL CATEGORY PREFLIGHT</span><h3>채널별 카테고리 확정</h3><p>공식 API 추천·말단 여부·필수 속성을 검증하고 실제 등록 사전조건으로 저장합니다.</p></div><span className="step-chip">STEP 3 / 3</span></div>
    <div className="category-query"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="브랜드·제품 종류·용량·용도를 포함한 정확한 상품명" /><small>카테고리 수수료와 노출이 달라질 수 있으므로 자동 추천 뒤 판매자가 최종 확정합니다.</small></div>
    <div className="category-channel-grid">{visibleChannels.map((channel) => {
      const definition = channelCatalog[channel];
      const credential = activeCredential.get(channel);
      const state = states[channel] ?? initialState();
      const busy = state.phase === "suggesting" || state.phase === "inspecting";
      const required = state.attributes.filter((attribute) => attribute.required);
      const completedRequired = required.filter((attribute) => state.values[attribute.id]?.trim()).length;
      return <article className={`category-channel-card ${state.phase}`} key={channel}>
        <header><span>{definition.code}</span><div><small>{definition.market}</small><h4>{definition.name}</h4></div><em className={credential ? "connected" : "missing"}>{loadingCredentials ? "확인 중" : credential ? "실키 연결" : "키 필요"}</em></header>
        {!state.suggestions.length && !state.selected && <div className="category-empty"><Tags size={21} /><b>{credential ? productId ? "공식 카테고리 추천 대기" : "상품 원장 연결 대기" : "API 키 연결 후 사용"}</b><small>{credential ? productId ? "상품명으로 채널 원본 분류를 조회합니다." : "AI 분석을 완료해 상품 UUID를 먼저 생성하세요." : "API 키 관리에서 운영 키를 먼저 연결하세요."}</small><button type="button" disabled={!credential || !productId || busy || channel === "elevenst"} onClick={() => void suggest(channel)}>{busy ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{channel === "elevenst" ? "판매자 명세 확인 필요" : "공식 API 추천"}</button></div>}
        {state.suggestions.length > 0 && !state.selected && <div className="category-suggestions">{state.suggestions.map((suggestion, index) => <button type="button" onClick={() => void inspect(channel, suggestion)} key={`${suggestion.id}-${suggestion.name}`}><span><b>{index + 1}. {suggestion.name}</b><small>{categoryPathLabel(suggestion)}</small></span><em>{Math.round(suggestion.confidence * 100)}%</em><ChevronRight size={14} /></button>)}</div>}
        {state.selected && <div className="category-inspection"><div className="selected-category"><BadgeCheck size={18} /><span><b>{state.selected.name}</b><small>{categoryPathLabel(state.selected)} · ID {state.selected.id}</small></span><button type="button" onClick={() => setStates((current) => ({ ...current, [channel]: { ...initialState(), suggestions: state.suggestions } }))}>다시 선택</button></div>{state.phase === "inspecting" ? <p className="category-loading"><LoaderCircle className="spin" size={16} />공식 속성·유효성 동시 확인 중</p> : <><div className="category-proof"><span className={state.verifiedLeaf ? "passed" : "failed"}><ShieldCheck size={14} />{state.verifiedLeaf ? "말단 카테고리 확인" : "유효성 확인 필요"}</span><span className={completedRequired === required.length ? "passed" : "failed"}><Check size={14} />필수 속성 {completedRequired}/{required.length}</span></div>{required.length > 0 && <div className="category-attribute-list">{required.map((attribute) => <label key={attribute.id}><span>{attribute.name}<em>필수</em></span>{attribute.values.length ? <select value={state.values[attribute.id] ?? ""} onChange={(event) => setStates((current) => ({ ...current, [channel]: { ...state, values: { ...state.values, [attribute.id]: event.target.value } } }))}><option value="">값 선택</option>{attribute.values.map((value) => <option value={value} key={value}>{value}</option>)}</select> : <input value={state.values[attribute.id] ?? ""} onChange={(event) => setStates((current) => ({ ...current, [channel]: { ...state, values: { ...state.values, [attribute.id]: event.target.value } } }))} placeholder={`${attribute.name} 입력`} />}</label>)}</div>}<button type="button" className="category-confirm" onClick={() => void confirm(channel)} disabled={!state.verifiedLeaf || completedRequired !== required.length || state.phase === "confirmed"}>{state.phase === "confirmed" ? <><Check size={15} />카테고리 저장됨</> : "카테고리·속성 저장"}</button></>}</div>}
        {state.error && <p className="category-error"><AlertTriangle size={14} />{state.error}</p>}
      </article>;
    })}</div>
  </section>;
}
