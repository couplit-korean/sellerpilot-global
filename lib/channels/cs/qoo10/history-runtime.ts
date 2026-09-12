import { createHash } from "node:crypto";
import {
  planQoo10History,
  qoo10HistoryWindowKey,
  splitSaturatedQoo10Window,
  type Qoo10HistoryInquiryWindow,
  type Qoo10ProviderHistoryWindow,
} from "./history.ts";
import {
  assessQoo10WindowCompleteness,
  qoo10InquiryListParams,
  qoo10JapanTimestamp,
  qoo10InquiryStatuses,
  type Qoo10InquiryStatus,
} from "./contracts.ts";

type Qoo10HistoryExecution = {
  steps: Array<{ name: string; ok: boolean; status: number; data: Record<string, unknown> }>;
  remoteId?: string;
};

export type Qoo10HistoryExecutor = (input: {
  operation: "inquiries.list";
  arguments: Record<string, unknown>;
}) => Promise<Qoo10HistoryExecution>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function resultRows(data: Record<string, unknown>, source: Qoo10ProviderHistoryWindow["source"]) {
  const result = data.ResultObject;
  const candidate = Array.isArray(result)
    ? result
    : source === "qapi_inquiry"
      ? record(result).InquiryInfo ?? record(result).InquiryMessage
      : record(result).ClaimInfo;
  if (!Array.isArray(candidate)
      || candidate.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("QOO10_HISTORY_PROVIDER_ROWS_INVALID");
  }
  return candidate as Record<string, unknown>[];
}

function providerTotal(data: Record<string, unknown>) {
  const keys = ["TotalCount", "totalCount", "TOTAL_COUNT", "Total", "total"];
  for (const root of [data, record(data.ResultObject)]) {
    for (const key of keys) {
      if (Object.hasOwn(root, key)) return root[key];
    }
  }
  return undefined;
}

function safeDigest(namespace: string, value: string) {
  return createHash("sha256").update(`${namespace}\u001f${value}`).digest("hex");
}

function inquiryIdentity(row: Record<string, unknown>) {
  const inquiryType = text(row.INQ_TYPE ?? row.inq_type).toUpperCase();
  const questionNo = text(row.QUESTION_NO ?? row.question_no);
  const sequenceNo = text(row.SEQ_NO ?? row.seq_no);
  if (!new Set(["MSG", "HELP", "ITEM"]).has(inquiryType)
      || !/^\d{1,40}$/u.test(questionNo) || !/^\d{1,40}$/u.test(sequenceNo)) {
    throw new Error("QOO10_HISTORY_INQUIRY_ID_INVALID");
  }
  const contentFingerprint = safeDigest("qoo10-history-content-v1", JSON.stringify({
    contents: text(row.CONTENTS ?? row.contents),
    receivedAt: text(row.INQ_DT ?? row.InquiryDate),
    title: text(row.TITLE ?? row.Title),
  }));
  return { inquiryType, questionNo, sequenceNo, contentFingerprint };
}

export function reconcileQoo10InquiryHistoryRows(observations: Array<{
  status: Qoo10InquiryStatus;
  rows: Record<string, unknown>[];
}>) {
  const rank: Record<Qoo10InquiryStatus, number> = { S1: 1, S2: 2, S3: 3 };
  const identities = new Map<string, {
    inquiryType: string;
    questionNo: string;
    sequenceNo: string;
    contentFingerprint: string;
    statuses: Set<Qoo10InquiryStatus>;
    observations: number;
  }>();
  const sequenceRoots = new Map<string, Set<string>>();
  let providerRows = 0;
  for (const observation of observations) {
    for (const row of observation.rows) {
      providerRows += 1;
      const identity = inquiryIdentity(row);
      const key = `${identity.inquiryType}\u001f${identity.questionNo}\u001f${identity.sequenceNo}`;
      const previous = identities.get(key);
      if (previous && previous.contentFingerprint !== identity.contentFingerprint) {
        throw new Error("QOO10_HISTORY_INQUIRY_IDENTITY_CONFLICT");
      }
      const entry = previous ?? { ...identity, statuses: new Set<Qoo10InquiryStatus>(), observations: 0 };
      entry.statuses.add(observation.status);
      entry.observations += 1;
      identities.set(key, entry);
      const roots = sequenceRoots.get(identity.sequenceNo) ?? new Set<string>();
      roots.add(`${identity.inquiryType}\u001f${identity.questionNo}`);
      sequenceRoots.set(identity.sequenceNo, roots);
    }
  }
  const projected = [...identities.values()].map((entry) => {
    const latestStatus = [...entry.statuses].sort((left, right) => rank[right] - rank[left])[0]!;
    return {
      identityDigest: safeDigest(
        "qoo10-history-identity-v1",
        `${entry.inquiryType}\u001f${entry.questionNo}\u001f${entry.sequenceNo}`,
      ),
      latestStatus,
      statusObservations: [...entry.statuses].sort(),
      observationCount: entry.observations,
    };
  }).sort((left, right) => left.identityDigest.localeCompare(right.identityDigest));
  const sequenceCollisions = [...sequenceRoots.entries()]
    .filter(([, roots]) => roots.size > 1)
    .map(([sequenceNo, roots]) => ({
      sequenceDigest: safeDigest("qoo10-history-sequence-v1", sequenceNo),
      distinctRoots: roots.size,
    }))
    .sort((left, right) => left.sequenceDigest.localeCompare(right.sequenceDigest));
  return {
    providerRows,
    uniqueRows: projected.length,
    duplicateObservations: providerRows - projected.length,
    crossStatusDuplicates: projected.filter((entry) => entry.statusObservations.length > 1).length,
    sequenceCollisions,
    identities: projected,
  };
}

function claimSummary(rows: Record<string, unknown>[]) {
  const unique = new Set<string>();
  for (const row of rows) {
    const orderNo = text(row.orderNo ?? row.OrderNo);
    const requestDate = text(row.requestDate ?? row.RequestDate);
    const claimStatus = text(row.claimStatus ?? row.ClaimStatus);
    if (!/^\d{1,40}$/u.test(orderNo) || !requestDate || !/^\d{1,2}$/u.test(claimStatus)) {
      throw new Error("QOO10_HISTORY_CLAIM_ID_INVALID");
    }
    unique.add(safeDigest("qoo10-history-claim-v1", JSON.stringify({ orderNo, requestDate, claimStatus })));
  }
  return { providerRows: rows.length, uniqueRows: unique.size, duplicateObservations: rows.length - unique.size };
}

export function qoo10HistoryArguments(window: Qoo10ProviderHistoryWindow) {
  const historyWindow = {
    contractVersion: "sellerpilot-qoo10-history-window/1",
    windowKey: qoo10HistoryWindowKey(window),
    source: window.source,
    calendarDate: window.calendarDate,
    refinement: window.refinement ?? "day",
    parentWindowKey: window.parentWindowKey ?? null,
    ...(window.source === "qapi_inquiry" ? { status: window.status } : {}),
  };
  return window.source === "qapi_inquiry"
    ? { params: window.params, sellerpilotHistoryWindow: historyWindow }
    : { kind: "claim", params: window.params, sellerpilotHistoryWindow: historyWindow };
}

function historyMetadata(argumentsValue: Record<string, unknown>) {
  const metadata = record(argumentsValue.sellerpilotHistoryWindow);
  const source = text(metadata.source) as Qoo10ProviderHistoryWindow["source"];
  const calendarDate = text(metadata.calendarDate);
  const refinement = text(metadata.refinement);
  const parentWindowKey = metadata.parentWindowKey;
  if (metadata.contractVersion !== "sellerpilot-qoo10-history-window/1"
      || !new Set(["qapi_inquiry", "qapi_claim"]).has(source)
      || !/^\d{4}-\d{2}-\d{2}$/u.test(calendarDate)
      || !new Set(["day", "hour", "minute", "second"]).has(refinement)
      || parentWindowKey !== null && typeof parentWindowKey !== "string") {
    throw new Error("QOO10_HISTORY_ARGUMENTS_INVALID");
  }
  return { metadata, source, calendarDate, refinement, parentWindowKey };
}

function expectedWindowBounds(input: {
  compactDate: string;
  from: string;
  refinement: string;
}) {
  if (!input.from.startsWith(input.compactDate)) throw new Error("QOO10_HISTORY_ARGUMENTS_INVALID");
  if (input.refinement === "day") {
    return { from: `${input.compactDate}000000`, to: `${input.compactDate}235959`, parent: null };
  }
  if (input.refinement === "hour") {
    const prefix = input.from.slice(0, 10);
    return {
      from: `${prefix}0000`,
      to: `${prefix}5959`,
      parent: { from: `${input.compactDate}000000`, to: `${input.compactDate}235959` },
    };
  }
  if (input.refinement === "minute") {
    const prefix = input.from.slice(0, 12);
    const hour = input.from.slice(0, 10);
    return {
      from: `${prefix}00`,
      to: `${prefix}59`,
      parent: { from: `${hour}0000`, to: `${hour}5959` },
    };
  }
  return {
    from: input.from,
    to: input.from,
    parent: { from: `${input.from.slice(0, 12)}00`, to: `${input.from.slice(0, 12)}59` },
  };
}

function windowKeyForBounds(input: {
  source: Qoo10ProviderHistoryWindow["source"];
  status?: Qoo10InquiryStatus;
  from: string;
  to: string;
}) {
  return input.source === "qapi_inquiry"
    ? `inquiries:history:qoo10:inquiry:${input.status}:${input.from}:${input.to}`
    : `inquiries:history:qoo10:claim:all:${input.from}:${input.to}`;
}

export function qoo10HistoryWindowFromArguments(
  argumentsValue: Record<string, unknown>,
): Qoo10ProviderHistoryWindow {
  const { metadata, source, calendarDate, refinement, parentWindowKey } = historyMetadata(argumentsValue);
  const compactDate = calendarDate.replaceAll("-", "");
  let window: Qoo10ProviderHistoryWindow;
  let from = "";
  let to = "";
  if (source === "qapi_inquiry") {
    const params = qoo10InquiryListParams(argumentsValue);
    const status = text(metadata.status).toUpperCase();
    if (!qoo10InquiryStatuses.includes(status as Qoo10InquiryStatus)
        || params.proc_status !== status) {
      throw new Error("QOO10_HISTORY_ARGUMENTS_INVALID");
    }
    from = params.search_start_dt;
    to = params.search_end_dt;
    window = {
      source,
      status: status as Qoo10InquiryStatus,
      calendarDate,
      refinement: refinement as Qoo10HistoryInquiryWindow["refinement"],
      ...(typeof parentWindowKey === "string" ? { parentWindowKey } : {}),
      params: {
        search_start_dt: from,
        search_end_dt: to,
        proc_status: status as Qoo10InquiryStatus,
      },
    };
  } else {
    const params = record(argumentsValue.params);
    const keys = Object.keys(params).sort();
    if (argumentsValue.kind !== "claim"
        || JSON.stringify(keys) !== JSON.stringify(["search_Edate", "search_Sdate", "search_condition"])
        || text(params.search_condition) !== "2") {
      throw new Error("QOO10_HISTORY_ARGUMENTS_INVALID");
    }
    from = text(params.search_Sdate);
    to = text(params.search_Edate);
    qoo10JapanTimestamp(from, "QOO10_HISTORY_ARGUMENTS_INVALID");
    qoo10JapanTimestamp(to, "QOO10_HISTORY_ARGUMENTS_INVALID");
    window = {
      source,
      calendarDate,
      refinement: refinement as Qoo10ProviderHistoryWindow["refinement"],
      ...(typeof parentWindowKey === "string" ? { parentWindowKey } : {}),
      params: { search_Sdate: from, search_Edate: to, search_condition: "2" },
    };
  }
  const expected = expectedWindowBounds({ compactDate, from, refinement });
  if (from !== expected.from || to !== expected.to
      || text(metadata.windowKey) !== qoo10HistoryWindowKey(window)) {
    throw new Error("QOO10_HISTORY_ARGUMENTS_INVALID");
  }
  if (refinement === "day") {
    if (parentWindowKey !== null) throw new Error("QOO10_HISTORY_ARGUMENTS_INVALID");
  } else {
    const expectedParent = windowKeyForBounds({
      source: window.source,
      ...(window.source === "qapi_inquiry" ? { status: window.status } : {}),
      from: expected.parent!.from,
      to: expected.parent!.to,
    });
    if (parentWindowKey !== expectedParent) throw new Error("QOO10_HISTORY_ARGUMENTS_INVALID");
  }
  return window;
}

export function qoo10HistoryExecutionRequests(fromDate: string, toDate: string) {
  const plan = planQoo10History(fromDate, toDate);
  return [...plan.inquiries, ...plan.claims].map((window) => ({
    periodicKey: qoo10HistoryWindowKey(window),
    arguments: qoo10HistoryArguments(window),
  }));
}

export function assessQoo10HistoryExecution(input: {
  window: Qoo10ProviderHistoryWindow;
  execution: Qoo10HistoryExecution;
  observedRowLimit?: number | null;
}) {
  if (input.execution.steps.length !== 1) throw new Error("QOO10_HISTORY_EXECUTION_STEPS_INVALID");
  const step = input.execution.steps[0]!;
  const rows = step.ok ? resultRows(step.data, input.window.source) : [];
  const reportedTotal = providerTotal(step.data);
  const safeProviderTotal = Number.isSafeInteger(reportedTotal) && Number(reportedTotal) >= 0
    ? Number(reportedTotal)
    : null;
  const safeObservedRowLimit = Number.isSafeInteger(input.observedRowLimit)
      && Number(input.observedRowLimit) > 0
    ? Number(input.observedRowLimit)
    : null;
  const completeness = assessQoo10WindowCompleteness({
    providerSucceeded: step.ok,
    rowCount: rows.length,
    providerTotal: reportedTotal,
    observedRowLimit: input.observedRowLimit,
  });
  const reconciliation = input.window.source === "qapi_inquiry"
    ? reconcileQoo10InquiryHistoryRows([{ status: input.window.status, rows }])
    : claimSummary(rows);
  const refinement = ["observed_row_limit_reached", "provider_total_mismatch"].includes(completeness.reason)
    ? splitSaturatedQoo10Window(input.window)
    : [];
  return {
    execution: input.execution,
    coverage: {
      contractVersion: "sellerpilot-qoo10-history-coverage/1",
      windowKey: qoo10HistoryWindowKey(input.window),
      source: input.window.source,
      providerStatus: step.status,
      providerTotal: safeProviderTotal,
      observedRowLimit: safeObservedRowLimit,
      completeness,
      ...reconciliation,
      refinementRequired: refinement.length > 0,
      irreducibleGap: ["observed_row_limit_reached", "provider_total_mismatch"].includes(completeness.reason)
        && refinement.length === 0,
      irreducibleSaturation: completeness.reason === "observed_row_limit_reached" && refinement.length === 0,
    },
    refinement,
  };
}

export async function executeQoo10HistoryWindow(input: {
  window: Qoo10ProviderHistoryWindow;
  execute: Qoo10HistoryExecutor;
  observedRowLimit?: number | null;
}) {
  const execution = await input.execute({
    operation: "inquiries.list",
    arguments: qoo10HistoryArguments(input.window),
  });
  return assessQoo10HistoryExecution({
    window: input.window,
    execution,
    observedRowLimit: input.observedRowLimit,
  });
}

export function isQoo10InquiryHistoryWindow(
  window: Qoo10ProviderHistoryWindow,
): window is Qoo10HistoryInquiryWindow {
  return window.source === "qapi_inquiry";
}
