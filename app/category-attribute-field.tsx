"use client";

import { useId } from "react";
import {
  categoryAttributeValueValid,
  type CategoryAttribute,
  type CategoryAttributeValue,
} from "./category-attribute-model";

function scalar(value: CategoryAttributeValue | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function list(value: CategoryAttributeValue | undefined) {
  return Array.isArray(value) ? value : typeof value === "string" && value.trim() ? [value] : [];
}

function numericParts(attribute: CategoryAttribute, value: CategoryAttributeValue | undefined) {
  const raw = scalar(value);
  const unit = [...attribute.units].sort((left, right) => right.length - left.length)
    .find((candidate) => raw.endsWith(candidate)) ?? attribute.units[0] ?? "";
  return {
    number: unit ? raw.slice(0, -unit.length).trim() : raw,
    unit,
  };
}

export function CategoryAttributeField({
  attribute,
  value,
  onChange,
}: {
  attribute: CategoryAttribute;
  value: CategoryAttributeValue | undefined;
  onChange: (value: CategoryAttributeValue) => void;
}) {
  const listId = useId();
  const supplied = list(value).length > 0;
  const invalid = supplied && !categoryAttributeValueValid(attribute, value);
  const requirementLabel = attribute.requirement === "required"
    ? "필수"
    : attribute.requirement === "one_of_group"
      ? "묶음 중 하나 필수"
      : "선택";
  const label = <span>{attribute.name}<em>{requirementLabel}</em>{attribute.units.length ? <small>단위 {attribute.units.join(" · ")}</small> : null}</span>;

  if (attribute.inputKind === "unsupported") {
    return <div className="category-attribute-unsupported" role="status">
      {label}
      <small>{attribute.unsupportedReason ?? `공식 입력 타입 ${attribute.mode ?? "unknown"}은 아직 지원하지 않습니다.`}</small>
    </div>;
  }

  if (attribute.inputKind === "multi_select") {
    const selected = new Set(list(value));
    return <label>{label}<select multiple value={[...selected]} aria-invalid={invalid || undefined} onChange={(event) => onChange([...event.currentTarget.selectedOptions].map((option) => option.value))}>{attribute.values.map((option) => <option value={option.id} key={option.id}>{option.name}</option>)}</select><small>여러 값을 선택할 수 있습니다.</small></label>;
  }

  if (attribute.inputKind === "repeatable_text") {
    return <label>{label}<textarea value={list(value).join("\n")} aria-invalid={invalid || undefined} onChange={(event) => onChange(event.target.value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean))} placeholder="값마다 한 줄씩 입력" /><small>반복 가능한 값은 한 줄에 하나씩 입력합니다.</small></label>;
  }

  if (attribute.inputKind === "number_with_unit") {
    const parts = numericParts(attribute, value);
    return <label>{label}<span className="category-number-unit-input"><input type="number" step="any" value={parts.number} aria-invalid={invalid || undefined} onChange={(event) => onChange(event.target.value ? `${event.target.value}${parts.unit}` : "")} /><select aria-label={`${attribute.name} 단위`} value={parts.unit} onChange={(event) => onChange(parts.number ? `${parts.number}${event.target.value}` : "")}>{attribute.units.map((unit) => <option value={unit} key={unit}>{unit}</option>)}</select></span></label>;
  }

  if (attribute.inputKind === "number") {
    return <label>{label}<input type="number" step="any" value={scalar(value)} aria-invalid={invalid || undefined} onChange={(event) => onChange(event.target.value)} /></label>;
  }

  if (attribute.inputKind === "boolean") {
    return <label>{label}<select value={scalar(value)} aria-invalid={invalid || undefined} onChange={(event) => onChange(event.target.value)}><option value="">값 선택</option><option value="true">예</option><option value="false">아니오</option></select></label>;
  }

  if (attribute.inputKind === "single_select") {
    return <label>{label}<select value={scalar(value)} aria-invalid={invalid || undefined} onChange={(event) => onChange(event.target.value)}><option value="">값 선택</option>{attribute.values.map((option) => <option value={option.id} key={option.id}>{option.name}</option>)}</select></label>;
  }

  return <label>{label}<input list={attribute.values.length ? listId : undefined} value={scalar(value)} aria-invalid={invalid || undefined} onChange={(event) => onChange(event.target.value)} placeholder={`${attribute.name} 입력`} />{attribute.values.length ? <datalist id={listId}>{attribute.values.map((option) => <option value={option.name} key={option.id} />)}</datalist> : null}</label>;
}
