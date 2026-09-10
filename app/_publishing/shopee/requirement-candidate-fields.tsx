"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { registrationPatches, type RegistrationPatch, type RegistrationValue } from "../../../lib/channel-registration-form";
import {
  buildShopeeSgRequirementViewModel,
  planShopeeSgRequirementDraftSave,
  type ShopeeSgRequirementSavePlan,
  type ShopeeSgRequirementViewModel,
} from "../../../lib/product-registration/shopee/requirement-view-model";
import { shopeePositiveInteger, shopeePositiveMoney } from "../../../lib/product-registration/shopee/strict-numbers";

type UnknownRecord = Record<string, unknown>;

export type ShopeeSgRequirementLoadState =
  | { state: "loading" }
  | { state: "missing"; reason: string }
  | { state: "blocked"; code: string; message: string }
  | { state: "ready"; snapshot: unknown };

export type ShopeeSgRequirementSelectionState = {
  saveAllowed: boolean;
  blockers: Array<{ code: string; message: string }>;
  patches: RegistrationPatch[];
  evidence: ShopeeSgRequirementSavePlan["evidence"] | null;
};

export type ShopeeSgRequirementCandidateFieldsProps = {
  source: ShopeeSgRequirementLoadState;
  credentialId: string;
  shopId: string;
  categoryId: string;
  sourceFingerprint: string;
  draftData: unknown;
  baseDraft: Record<string, unknown>;
  currentDraft: Record<string, unknown>;
  maxAgeMs?: number;
  onChange: (path: string[], value: RegistrationValue) => void;
  onValidationChange: (state: ShopeeSgRequirementSelectionState) => void;
  onRefresh: () => void;
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function rows(value: unknown) {
  return Array.isArray(value)
    ? value.map(record).filter((item) => Object.keys(item).length > 0)
    : [];
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function positiveId(value: unknown) {
  const candidate = text(value);
  return /^[1-9][0-9]{0,31}$/u.test(candidate) ? candidate : "";
}

function enabled(value: unknown) {
  return value === true || value === 1 || value === "1" || text(value).toLowerCase() === "true";
}

function registrationValue(value: unknown) {
  return value as RegistrationValue;
}

type ShopeeBufferedTextInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "onBlur" | "onChange" | "value"> & {
  value: string;
  normalize: (value: string) => string;
  onValueChange: (value: string) => void;
};

export function ShopeeBufferedTextInput({
  value,
  normalize,
  onValueChange,
  onFocus,
  ...props
}: ShopeeBufferedTextInputProps) {
  const [editingValue, setEditingValue] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setEditingValue(value);
  }, [value]);
  return <input {...props} value={editingValue} onFocus={(event) => {
    editing.current = true;
    onFocus?.(event);
  }} onChange={(event) => {
    const next = event.target.value;
    setEditingValue(next);
    onValueChange(next);
  }} onBlur={() => {
    editing.current = false;
    const normalized = normalize(editingValue);
    setEditingValue(normalized);
    onValueChange(normalized);
  }} />;
}

function bodyFromDraft(draft: UnknownRecord) {
  return record(draft.body);
}

function itemFromDraft(draft: UnknownRecord) {
  return record(record(draft.publish).item);
}

function selectedAttributeRows(draft: UnknownRecord) {
  return rows(bodyFromDraft(draft).attribute_list);
}

function selectedAttributeMap(draft: UnknownRecord) {
  return new Map(selectedAttributeRows(draft).map((row) => [positiveId(row.attribute_id), row]));
}

function activeAttributeMetadata(tree: unknown, draft: UnknownRecord) {
  const selected = selectedAttributeMap(draft);
  const output: UnknownRecord[] = [];
  const visited = new Set<string>();
  const visit = (nodes: unknown) => {
    for (const node of rows(nodes)) {
      const attributeId = positiveId(node.attribute_id);
      if (!attributeId || visited.has(attributeId)) continue;
      visited.add(attributeId);
      output.push(node);
      const supplied = selected.get(attributeId);
      const selectedValueIds = new Set(rows(supplied?.attribute_value_list).map((value) => positiveId(value.value_id)).filter(Boolean));
      for (const value of rows(node.attribute_value_list)) {
        if (selectedValueIds.has(positiveId(value.value_id))) visit(value.child_attribute_list);
      }
    }
  };
  visit(tree);
  return output;
}

function attributeLabel(metadata: UnknownRecord) {
  return text(metadata.display_attribute_name ?? metadata.original_attribute_name ?? metadata.attribute_name)
    || `Attribute ${text(metadata.attribute_id)}`;
}

function valueLabel(value: UnknownRecord) {
  return text(value.display_value_name ?? value.original_value_name ?? value.value_name)
    || `Value ${text(value.value_id)}`;
}

function brandLabel(brand: UnknownRecord) {
  return text(brand.display_brand_name ?? brand.brand_name ?? brand.original_brand_name)
    || `Brand ${text(brand.brand_id)}`;
}

function logisticsLabel(channel: UnknownRecord) {
  return text(channel.logistics_channel_name ?? channel.logistic_name ?? channel.channel_name)
    || `Logistics ${text(channel.logistics_channel_id ?? channel.logistic_id)}`;
}

function nextAttributes(draft: UnknownRecord, attributeId: number, values: UnknownRecord[]) {
  const current = selectedAttributeRows(draft).filter((row) => shopeePositiveInteger(row.attribute_id) !== attributeId);
  return values.length
    ? [...current, { attribute_id: attributeId, attribute_value_list: values }]
    : current;
}

export function shopeeSgGlobalLocalSelectionChanges(
  field: "brand" | "attribute_list" | "seller_stock",
  value: RegistrationValue,
) {
  return [
    { path: ["body", field], value },
    { path: ["publish", "item", field], value },
  ] satisfies Array<{ path: string[]; value: RegistrationValue }>;
}

export function serializeShopeeSgChannelPatches(
  baseDraft: Record<string, unknown>,
  currentDraft: Record<string, unknown>,
) {
  const patches = registrationPatches(baseDraft, currentDraft);
  const localPriceSgd = shopeePositiveMoney(itemFromDraft(currentDraft).original_price);
  if (localPriceSgd === null) return patches;
  const localPricePath = ["publish", "item", "original_price"];
  return [
    ...patches.filter((patch) => patch.path.length !== localPricePath.length
      || patch.path.some((part, index) => part !== localPricePath[index])),
    { path: localPricePath, value: localPriceSgd },
  ] satisfies RegistrationPatch[];
}

function changeGlobalAndLocal(
  onChange: ShopeeSgRequirementCandidateFieldsProps["onChange"],
  field: "brand" | "attribute_list" | "seller_stock",
  value: RegistrationValue,
) {
  for (const change of shopeeSgGlobalLocalSelectionChanges(field, value)) {
    onChange(change.path, change.value);
  }
}

function requirementSelectionsReset(onChange: ShopeeSgRequirementCandidateFieldsProps["onChange"], draft: UnknownRecord) {
  const body = bodyFromDraft(draft);
  const stockRows = rows(body.seller_stock);
  const stock = shopeePositiveInteger(body.normal_stock ?? stockRows[0]?.stock);
  changeGlobalAndLocal(onChange, "brand", { brand_id: 0, original_brand_name: "" });
  changeGlobalAndLocal(onChange, "attribute_list", []);
  onChange(["publish", "item", "logistic"], []);
  changeGlobalAndLocal(onChange, "seller_stock", stock === null ? [] : [{ stock }]);
}

function blockedSelection(code: string, message: string): ShopeeSgRequirementSelectionState {
  return { saveAllowed: false, blockers: [{ code, message }], patches: [], evidence: null };
}

type ShopeeSgRequirementEvaluationInput = Pick<ShopeeSgRequirementCandidateFieldsProps,
  "source" | "credentialId" | "shopId" | "categoryId" | "sourceFingerprint" | "draftData" | "baseDraft" | "currentDraft"
> & { now?: Date; maxAgeMs?: number };

function evaluateWithViewModel(input: ShopeeSgRequirementEvaluationInput): {
  viewModel: ShopeeSgRequirementViewModel | null;
  validation: ShopeeSgRequirementSelectionState;
} {
  if (input.source.state === "loading") return { viewModel: null, validation: blockedSelection("SHOPEE_SG_REQUIREMENT_LOADING", "Shopee 공식 필수조건을 조회하고 있습니다.") };
  if (input.source.state === "missing") return { viewModel: null, validation: blockedSelection("SHOPEE_SG_REQUIREMENT_MISSING", input.source.reason) };
  if (input.source.state === "blocked") return { viewModel: null, validation: blockedSelection(input.source.code, input.source.message) };
  const tuple = record(record(input.source.snapshot).tuple);
  let viewModel: ShopeeSgRequirementViewModel;
  try {
    viewModel = buildShopeeSgRequirementViewModel({
      draftData: input.draftData,
      baseDraft: input.baseDraft,
      snapshot: input.source.snapshot,
      credentialId: input.credentialId,
      merchantId: positiveId(tuple.merchantId),
      shopId: input.shopId,
      categoryId: input.categoryId,
      expectedSourceFingerprint: input.sourceFingerprint,
      now: input.now ?? new Date(),
      maxAgeMs: input.maxAgeMs ?? 10 * 60_000,
    });
  } catch {
    return { viewModel: null, validation: blockedSelection("SHOPEE_SG_REQUIREMENT_SNAPSHOT_INVALID", "현재 Shopee SG 공식 snapshot 형식을 해석할 수 없습니다.") };
  }
  if (!viewModel.saveAllowed) {
    return {
      viewModel,
      validation: {
        saveAllowed: false,
        blockers: viewModel.blockers.map(({ code, message }) => ({ code, message })),
        patches: [],
        evidence: null,
      },
    };
  }
  try {
    const plan = planShopeeSgRequirementDraftSave({ viewModel, currentDraft: input.currentDraft });
    return { viewModel, validation: { saveAllowed: true, blockers: [], patches: plan.patches, evidence: plan.evidence } };
  } catch (error) {
    const code = error instanceof Error ? error.message.split(":")[0] : "SHOPEE_SG_REQUIREMENT_SAVE_BLOCKED";
    return { viewModel, validation: blockedSelection(code, "현재 Shopee SG 필수조건 선택으로는 등록할 수 없습니다.") };
  }
}

export function evaluateShopeeSgRequirementSelection(input: ShopeeSgRequirementEvaluationInput) {
  return evaluateWithViewModel(input).validation;
}

export function shopeeSgChannelExecutionAllowed(
  channel: string,
  operation: string,
  validation: ShopeeSgRequirementSelectionState,
) {
  return channel !== "shopee" || operation !== "listing.create" || validation.saveAllowed;
}

export function ShopeeSgRequirementCandidateFields({
  source,
  credentialId,
  shopId,
  categoryId,
  sourceFingerprint,
  draftData,
  baseDraft,
  currentDraft,
  maxAgeMs = 10 * 60_000,
  onChange,
  onValidationChange,
  onRefresh,
}: ShopeeSgRequirementCandidateFieldsProps) {
  const [now, setNow] = React.useState(() => new Date());
  const requestTuple = `${credentialId}\u0000${shopId}\u0000${categoryId}\u0000${sourceFingerprint}`;
  const sourceTuple = record(record(source.state === "ready" ? source.snapshot : null).tuple);
  const sourceMerchantId = positiveId(sourceTuple.merchantId);
  const snapshotObservedAt = text(record(source.state === "ready" ? source.snapshot : null).observedAt);
  const snapshotTimestamp = Date.parse(snapshotObservedAt);
  const snapshotFresh = source.state === "ready"
    && Number.isFinite(snapshotTimestamp)
    && snapshotTimestamp <= now.getTime() + 60_000
    && now.getTime() - snapshotTimestamp <= maxAgeMs;
  const providerTuple = source.state === "ready"
    ? `${requestTuple}\u0000${sourceMerchantId}`
    : requestTuple;
  const previousRequestTuple = useRef(requestTuple);
  const previousProviderTuple = useRef(providerTuple);
  const previousSnapshotFresh = useRef(snapshotFresh);
  const currentDraftRef = useRef(currentDraft);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    currentDraftRef.current = currentDraft;
    onChangeRef.current = onChange;
  }, [currentDraft, onChange]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), Math.min(30_000, Math.max(1_000, maxAgeMs / 4)));
    return () => window.clearInterval(timer);
  }, [maxAgeMs]);

  useEffect(() => {
    if (previousRequestTuple.current !== requestTuple) {
      requirementSelectionsReset(onChangeRef.current, currentDraftRef.current);
      previousRequestTuple.current = requestTuple;
    }
  }, [requestTuple]);

  useEffect(() => {
    if (source.state !== "ready") return;
    if (previousProviderTuple.current !== providerTuple) {
      requirementSelectionsReset(onChangeRef.current, currentDraftRef.current);
      previousProviderTuple.current = providerTuple;
    }
  }, [providerTuple, source.state]);

  useEffect(() => {
    if (previousSnapshotFresh.current && !snapshotFresh) {
      requirementSelectionsReset(onChangeRef.current, currentDraftRef.current);
    }
    previousSnapshotFresh.current = snapshotFresh;
  }, [snapshotFresh]);

  const evaluation = useMemo(() => evaluateWithViewModel({
    source,
    credentialId,
    shopId,
    categoryId,
    sourceFingerprint,
    draftData,
    baseDraft,
    currentDraft,
    now,
    maxAgeMs,
  }), [baseDraft, categoryId, credentialId, currentDraft, draftData, maxAgeMs, now, shopId, source, sourceFingerprint]);
  const validation = evaluation.validation;
  const validationSignature = JSON.stringify(validation);
  const emittedValidationSignature = useRef("");
  const validationRef = useRef(validation);
  const onValidationChangeRef = useRef(onValidationChange);
  useEffect(() => {
    validationRef.current = validation;
    onValidationChangeRef.current = onValidationChange;
  }, [onValidationChange, validation]);
  useEffect(() => {
    if (emittedValidationSignature.current === validationSignature) return;
    emittedValidationSignature.current = validationSignature;
    onValidationChangeRef.current(validationRef.current);
  }, [validationSignature]);

  if (source.state === "loading") return <section className="shopee-requirement-fields" aria-busy="true"><b>Shopee SG 공식 필수조건 조회 중</b><p>현재 credential·merchant·shop·category에 맞는 후보를 불러오고 있습니다.</p><button type="button" disabled>조회 중</button></section>;
  if (source.state === "missing") return <section className="shopee-requirement-fields" role="status"><b>Shopee SG 필수조건 없음</b><p>{source.reason}</p><button type="button" onClick={onRefresh}>공식 조건 다시 조회</button></section>;
  if (source.state === "blocked") return <section className="shopee-requirement-fields" role="alert"><b>Shopee SG 필수조건 조회 차단</b><p>{source.message}</p><code>{source.code}</code><button type="button" onClick={onRefresh}>공식 조건 다시 조회</button></section>;

  const snapshot = evaluation.viewModel;
  if (!snapshot) return <section className="shopee-requirement-fields" role="alert"><b>Shopee SG 필수조건 해석 차단</b><p>공식 snapshot 형식을 확인할 수 없습니다.</p><button type="button" onClick={onRefresh}>공식 조건 다시 조회</button></section>;
  const resources = snapshot.resources;
  const resourceBlock = Object.entries(resources).find(([, state]) => state.state !== "ready");
  if (resourceBlock) {
    const [name, state] = resourceBlock;
    const message = state.state === "loading" ? "공식 조회 중입니다."
      : state.state === "missing" ? state.reason
        : state.state === "blocked" ? state.message
          : "공식 후보를 확인할 수 없습니다.";
    return <section className="shopee-requirement-fields" role={state.state === "blocked" ? "alert" : "status"}><b>{name} 필수조건 확인 필요</b><p>{message}</p><button type="button" onClick={onRefresh}>공식 조건 다시 조회</button></section>;
  }
  if (resources.category.state !== "ready"
    || resources.brand.state !== "ready"
    || resources.attributes.state !== "ready"
    || resources.logistics.state !== "ready"
    || resources.warehouses.state !== "ready"
    || resources.eligibleShops.state !== "ready") return null;

  const category = resources.category.value;
  const brandResource = resources.brand.value;
  const brands = brandResource.brands.filter((brand) => positiveId(brand.brand_id) && brandLabel(brand));
  const selectedBrand = record(bodyFromDraft(currentDraft).brand);
  const selectedBrandId = positiveId(selectedBrand.brand_id);
  const directBrandAllowed = !brandResource.mandatory
    && ["TEXT_FILED", "TEXT_FIELD", "FREE_TEXT"].includes(text(brandResource.inputType).toUpperCase());
  const directBrandName = selectedBrandId ? "" : text(selectedBrand.original_brand_name);
  const attributes = activeAttributeMetadata(resources.attributes.value.attributeTree, currentDraft);
  const attributeSelections = selectedAttributeMap(currentDraft);
  const officialLogistics = resources.logistics.value.channels.filter((channel) => enabled(channel.enabled));
  const selectedLogistics = rows(itemFromDraft(currentDraft).logistic);
  const warehouseRows = resources.warehouses.value.warehouses;
  const selectedLocation = text(rows(bodyFromDraft(currentDraft).seller_stock)[0]?.location_id);
  const selectedWarehouse = warehouseRows.find((warehouse) => warehouse.locationId === selectedLocation);
  const eligible = selectedWarehouse
    ? resources.eligibleShops.value.byWarehouse.find((candidate) => candidate.warehouseId === selectedWarehouse.warehouseId)
    : null;
  const exactShopEligible = Boolean(eligible && eligible.shops.filter((candidate) => positiveId(candidate.shop_id) === shopId).length === 1);

  return <section className="shopee-requirement-fields" aria-label="Shopee SG 공식 필수조건 선택">
    <header><div><b>Shopee SG 공식 필수조건</b><small>{snapshot.tuple.merchantId} · {snapshot.tuple.shopId} · {new Date(snapshot.observedAt).toLocaleString("ko-KR")}</small></div><span className={validation.saveAllowed ? "ready" : "blocked"}>{validation.saveAllowed ? "등록 준비 완료" : "등록 조건 미완료"}</span><button type="button" onClick={onRefresh}>공식 조건 다시 조회</button></header>
    <label><span>공식 Global leaf category</span><input readOnly value={`${category.path.join(" › ")} · ${category.categoryId}`} /></label>
    <label><span>브랜드 {brandResource.mandatory ? "· 필수" : ""}</span><select value={selectedBrandId} onChange={(event) => {
      const selected = brands.find((brand) => positiveId(brand.brand_id) === event.target.value);
      changeGlobalAndLocal(onChange, "brand", selected ? { brand_id: shopeePositiveInteger(selected.brand_id)!, original_brand_name: brandLabel(selected) } : { brand_id: 0, original_brand_name: "" });
    }}><option value="">브랜드를 명시적으로 선택</option>{brands.map((brand) => <option key={positiveId(brand.brand_id)} value={positiveId(brand.brand_id)}>{brandLabel(brand)} · {positiveId(brand.brand_id)}</option>)}</select></label>
    {directBrandAllowed && <label htmlFor="shopee-direct-brand-name"><span>공식 정책 허용 직접 브랜드명</span><ShopeeBufferedTextInput id="shopee-direct-brand-name" value={directBrandName} normalize={(value) => value.trim()} onValueChange={(value) => changeGlobalAndLocal(onChange, "brand", { brand_id: 0, original_brand_name: value })} placeholder="브랜드명을 직접 입력" /></label>}
    <fieldset><legend>카테고리 속성</legend>{attributes.map((metadata) => {
      const attributeId = shopeePositiveInteger(metadata.attribute_id)!;
      const info = record(metadata.attribute_info);
      const inputType = shopeePositiveInteger(info.input_type)!;
      const allowed = rows(metadata.attribute_value_list);
      const selectedValues = rows(attributeSelections.get(String(attributeId))?.attribute_value_list);
      const required = enabled(metadata.mandatory ?? metadata.is_mandatory)
        || (Array.isArray(info.mandatory_region) && info.mandatory_region.map((region) => text(region).toUpperCase()).includes("SG"));
      if (inputType === 1 || inputType === 4) {
        const selectedIds = selectedValues.map((value) => positiveId(value.value_id)).filter(Boolean);
        return <label key={attributeId}><span>{attributeLabel(metadata)} {required ? "· 필수" : ""}</span><select multiple={inputType === 4} value={inputType === 4 ? selectedIds : selectedIds[0] ?? ""} onChange={(event) => {
          const ids = inputType === 4 ? Array.from(event.currentTarget.selectedOptions, (option) => option.value) : [event.currentTarget.value];
          changeGlobalAndLocal(onChange, "attribute_list", registrationValue(nextAttributes(currentDraft, attributeId, ids.filter(Boolean).map((valueId) => ({ value_id: shopeePositiveInteger(valueId)! })))));
        }}>{inputType === 1 && <option value="">속성값을 명시적으로 선택</option>}{allowed.map((value) => <option key={positiveId(value.value_id)} value={positiveId(value.value_id)}>{valueLabel(value)}</option>)}</select></label>;
      }
      const suppliedText = selectedValues.map((value) => text(value.original_value_name) || valueLabel(allowed.find((candidate) => positiveId(candidate.value_id) === positiveId(value.value_id)) ?? {})).filter(Boolean).join(", ");
      const normalizeAttributeInput = (value: string) => (inputType === 5
        ? value.split(",").map((token) => token.trim()).filter(Boolean).join(", ")
        : value.trim());
      const changeAttributeInput = (value: string) => {
        const tokens = (inputType === 5 ? value.split(",") : [value]).map((token) => token.trim()).filter(Boolean);
        const values = tokens.map((token) => {
          const official = allowed.find((candidate) => valueLabel(candidate).toLocaleLowerCase() === token.toLocaleLowerCase());
          return official ? { value_id: shopeePositiveInteger(official.value_id)! } : { original_value_name: token };
        });
        changeGlobalAndLocal(onChange, "attribute_list", registrationValue(nextAttributes(currentDraft, attributeId, values)));
      };
      return <label key={attributeId} htmlFor={`shopee-attribute-input-${attributeId}`}><span>{attributeLabel(metadata)} {required ? "· 필수" : ""}</span><ShopeeBufferedTextInput id={`shopee-attribute-input-${attributeId}`} value={suppliedText} list={`shopee-attribute-${attributeId}`} normalize={normalizeAttributeInput} onValueChange={changeAttributeInput} placeholder={inputType === 5 ? "값을 쉼표로 구분해 명시적으로 입력" : "속성값을 명시적으로 입력"} /><datalist id={`shopee-attribute-${attributeId}`}>{allowed.map((value) => <option key={positiveId(value.value_id)} value={valueLabel(value)} />)}</datalist></label>;
    })}</fieldset>
    <fieldset><legend>물류 채널</legend>{officialLogistics.map((channel) => {
      const logisticId = Number(channel.logistics_channel_id ?? channel.logistic_id);
      const selected = selectedLogistics.find((row) => Number(row.logistic_id) === logisticId);
      const feeType = text(channel.fee_type).toUpperCase();
      return <div key={logisticId}><label><input type="checkbox" checked={Boolean(selected && enabled(selected.enabled))} onChange={(event) => {
        const next = selectedLogistics.filter((row) => Number(row.logistic_id) !== logisticId);
        if (event.target.checked) next.push({ logistic_id: logisticId, enabled: true });
        onChange(["publish", "item", "logistic"], registrationValue(next));
      }} /><span>{logisticsLabel(channel)} {enabled(channel.compulsory_channel) ? "· 필수 채널" : ""}</span></label>{selected && feeType === "SIZE_SELECTION" && <label><span>포장 크기</span><select value={text(selected.size_id)} onChange={(event) => onChange(["publish", "item", "logistic"], registrationValue(selectedLogistics.map((row) => Number(row.logistic_id) === logisticId ? { ...row, size_id: event.target.value } : row)))}><option value="">크기를 명시적으로 선택</option>{rows(channel.size_list).map((size) => <option key={text(size.size_id)} value={text(size.size_id)}>{text(size.name ?? size.size_name ?? size.size_id)}</option>)}</select></label>}{selected && feeType === "CUSTOM_PRICE" && <label><span>배송비</span><input type="number" min="0" step="0.01" value={text(selected.shipping_fee)} onChange={(event) => onChange(["publish", "item", "logistic"], registrationValue(selectedLogistics.map((row) => Number(row.logistic_id) === logisticId ? { ...row, shipping_fee: event.target.value === "" ? null : Number(event.target.value) } : row)))} /></label>}</div>;
    })}</fieldset>
    <label><span>Pickup warehouse</span><select value={selectedLocation} onChange={(event) => {
      const stockRows = rows(bodyFromDraft(currentDraft).seller_stock);
      const stock = shopeePositiveInteger(bodyFromDraft(currentDraft).normal_stock ?? stockRows[0]?.stock);
      const selection = stock === null ? [] : event.target.value ? [{ location_id: event.target.value, stock }] : [{ stock }];
      changeGlobalAndLocal(onChange, "seller_stock", selection);
    }}><option value="">창고를 명시적으로 선택</option>{warehouseRows.map((warehouse) => <option key={`${warehouse.warehouseId}:${warehouse.locationId}`} value={warehouse.locationId}>{warehouse.name || warehouse.locationId} · {warehouse.warehouseId}</option>)}</select></label>
    <p className={exactShopEligible ? "ready" : "blocked"}>{selectedWarehouse ? exactShopEligible ? `선택 창고가 SG shop ${shopId}에 사용 가능합니다.` : `선택 창고가 SG shop ${shopId}의 공식 eligible 목록과 일치하지 않습니다.` : "창고를 선택해야 exact SG shop eligibility를 확인할 수 있습니다."}</p>
    {!validation.saveAllowed && <div role="alert"><b>등록 차단 · 현재 입력은 초안으로 저장 가능</b><ul>{validation.blockers.map((blocker) => <li key={blocker.code}><code>{blocker.code}</code> · {blocker.message}</li>)}</ul></div>}
  </section>;
}
