"use client";

import { useEffect, useRef, useState } from "react";
import { activeChannelKeys, channelCatalog } from "../../lib/channels/catalog";
import { csImportMaxFileBytes, csImportMaxRows, csImportPreviewPageSize } from "../../lib/cs/import-limits";
import { csImportPreviewSchema, type CsImportPreview } from "../../lib/cs/import-preview";
import styles from "./lazada-quarantine.module.css";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;
const normalizedCsImportContract = "sellerpilot-normalized-cs-export/1" as const;
type Batch = {
  batchId: string;
  status: CsImportPreview["status"];
  declaredRowCount: number;
  stagedRowCount: number;
  nextRowNumber: number | null;
  sourceDigest: string;
  remainingRowCount?: number | null;
};
type NormalizedSource = {
  contract: typeof normalizedCsImportContract;
  channel: (typeof activeChannelKeys)[number];
  sourceAccountKey: string;
  records: unknown[];
};

const outcomeLabels = {
  new_ticket: "새 문의",
  new_message: "기존 문의의 새 메시지",
  duplicate_message: "이미 보관된 메시지",
} as const;
const uploadChunkMaxBytes = 600_000;

function normalizedSource(value: unknown, expectedChannel: (typeof activeChannelKeys)[number]): NormalizedSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid source");
  const source = value as Partial<NormalizedSource>;
  if (source.contract !== normalizedCsImportContract
      || source.channel !== expectedChannel
      || !/^[a-f0-9]{64}$/u.test(String(source.sourceAccountKey ?? ""))
      || !Array.isArray(source.records)
      || source.records.length < 1
      || source.records.length > csImportMaxRows) {
    throw new Error("invalid source");
  }
  return source as NormalizedSource;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function sourceChunk(records: unknown[], startRowNumber: number) {
  const startIndex = startRowNumber - 1;
  const rows: unknown[] = [];
  for (let index = startIndex; index < records.length && rows.length < 500; index += 1) {
    const candidate = [...rows, records[index]];
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > uploadChunkMaxBytes) {
      if (!rows.length) throw new Error("row too large");
      break;
    }
    rows.push(records[index]);
  }
  if (!rows.length) throw new Error("empty chunk");
  return rows;
}

function parsedBatch(value: unknown): Batch {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid batch");
  const batch = value as Partial<Batch>;
  if (typeof batch.batchId !== "string"
      || !["staging", "preview_ready", "committing", "committed", "cancelled"].includes(String(batch.status))
      || !Number.isInteger(batch.declaredRowCount)
      || !Number.isInteger(batch.stagedRowCount)
      || (batch.remainingRowCount !== undefined && batch.remainingRowCount !== null
        && !Number.isInteger(batch.remainingRowCount))
      || typeof batch.sourceDigest !== "string"
      || !/^[a-f0-9]{64}$/u.test(batch.sourceDigest)) {
    throw new Error("invalid batch");
  }
  return batch as Batch;
}

export function CsImportStaging({ authenticatedFetch }: { authenticatedFetch: AuthenticatedFetch }) {
  const [channel, setChannel] = useState<(typeof activeChannelKeys)[number]>("qoo10");
  const [credentialId, setCredentialId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [preview, setPreview] = useState<CsImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  const loadPreview = async (batchId: string, append = false, afterRowNumber = 0) => {
    const response = await authenticatedFetch(`/api/admin/cs/import?batchId=${encodeURIComponent(batchId)}&afterRowNumber=${afterRowNumber}&limit=${csImportPreviewPageSize}`, {
      cache: "no-store",
      signal: request.current?.signal,
    });
    if (!response.ok) throw new Error("preview failed");
    const next = csImportPreviewSchema.parse(await response.json());
    setPreview(current => append && current ? { ...next, rows: [...current.rows, ...next.rows] } : next);
  };

  const postUpload = async (body: Record<string, unknown>) => {
    const response = await authenticatedFetch("/api/admin/cs/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: request.current?.signal,
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error("stage failed");
    return parsedBatch(await response.json());
  };

  const stage = async () => {
    if (!file) return;
    request.current?.abort();
    request.current = new AbortController();
    setBusy(true);
    setError("");
    setBatch(null);
    setPreview(null);
    try {
      if (file.size > csImportMaxFileBytes) throw new Error("file too large");
      const text = await file.text();
      const source = normalizedSource(JSON.parse(text), channel);
      const sourceDigest = await sha256(text);
      let next = await postUpload({
        action: "begin",
        credentialId,
        channel,
        sourceName: file.name,
        sourceDigest,
        sourceAccountKey: source.sourceAccountKey,
        declaredRowCount: source.records.length,
      });
      setBatch(next);
      while (next.status === "staging") {
        const startRowNumber = next.nextRowNumber;
        if (!startRowNumber) throw new Error("resume row missing");
        const records = sourceChunk(source.records, startRowNumber);
        next = await postUpload({
          action: "stage",
          batchId: next.batchId,
          sourceDigest,
          startRowNumber,
          records,
        });
        setBatch(next);
      }
      await loadPreview(next.batchId);
    } catch {
      if (!request.current.signal.aborted) {
        setError(`원본 형식·계정 결속·행 내용을 확인하지 못했습니다. 파일은 ${csImportMaxFileBytes / 1024 / 1024}MB 이하여야 하며, 중단된 작업은 같은 파일을 다시 선택하면 이어집니다.`);
      }
    } finally {
      if (!request.current.signal.aborted) setBusy(false);
    }
  };

  const act = async (action: "commit" | "cancel") => {
    if (!batch) return;
    setBusy(true);
    setError("");
    try {
      if (action === "cancel") {
        const response = await authenticatedFetch("/api/admin/cs/import", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ batchId: batch.batchId, action }),
        });
        if (!response.ok) throw new Error("cancel failed");
        const result = await response.json() as Record<string, unknown>;
        if (result.batchId !== batch.batchId || result.status !== "cancelled" || result.existingDataChanged !== false) {
          throw new Error("invalid cancel response");
        }
        setBatch(current => current ? { ...current, status: "cancelled" } : null);
        await loadPreview(batch.batchId);
        return;
      }

      let status: "committing" | "committed" = "committing";
      while (status === "committing") {
        const response = await authenticatedFetch("/api/admin/cs/import", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ batchId: batch.batchId, action: "commit" }),
        });
        if (!response.ok) throw new Error("commit failed");
        const result = await response.json() as Record<string, unknown>;
        if (result.batchId !== batch.batchId
            || (result.status !== "committing" && result.status !== "committed")
            || !Number.isInteger(result.remainingRowCount)) {
          throw new Error("invalid commit response");
        }
        status = result.status;
        setBatch(current => current ? {
          ...current,
          status,
          remainingRowCount: result.remainingRowCount as number,
        } : null);
      }
      await loadPreview(batch.batchId);
    } catch {
      setError(action === "commit"
        ? "가져오기가 중단되었습니다. 같은 파일을 다시 선택한 뒤 ‘가져오기 계속’을 누르면 이미 반영한 행 다음부터 이어집니다."
        : "배치 상태를 변경하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const staged = batch ? Math.max(0, Math.min(batch.stagedRowCount, batch.declaredRowCount)) : 0;
  const imported = typeof batch?.remainingRowCount !== "number"
    ? 0
    : Math.max(0, batch.declaredRowCount - batch.remainingRowCount);

  return <details className={`panel ${styles.panel}`}><summary>과거 CS 파일 안전 가져오기</summary>
    <p>검증 가능한 공통 JSON 계약을 작은 배치로 저장합니다. 전송이나 반영이 중단되면 같은 파일을 다시 선택해 저장된 행 다음부터 재개합니다. 채널별 판매자센터 export는 실제 원본 샘플 검증 전까지 활성화하지 않습니다.</p>
    <label>채널<select value={channel} onChange={event => setChannel(event.target.value as typeof channel)}>{activeChannelKeys.map(key => <option key={key} value={key}>{channelCatalog[key].name}</option>)}</select></label>
    <label>연결 자격증명 ID<input value={credentialId} onChange={event => setCredentialId(event.target.value)} placeholder="UUID" /></label>
    <label>정규화 CS JSON<input type="file" accept="application/json,.json" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
    <button type="button" className="filter-button" disabled={busy || !file || !credentialId} onClick={() => void stage()}>{busy ? "검증·저장 중…" : "미리보기 배치 만들기"}</button>
    {error ? <p role="alert">{error}</p> : null}
    {batch && preview ? <section><p role="status">{staged}/{batch.declaredRowCount}행 준비{batch.status === "committing" || batch.status === "committed" ? ` · ${imported}/${batch.declaredRowCount}행 반영` : ""} · {batch.status} · 원본 지문 {batch.sourceDigest.slice(0, 12)}</p>
      <div className={styles.messages}>{preview.rows.map(row => <article key={row.rowNumber}><header><strong>{row.rowNumber}. {row.subject}</strong><span>{outcomeLabels[row.outcome]}</span></header><p>{row.customerName} · {row.receivedAt}</p><pre>{row.messagePreview}</pre>{row.externalOrderReference ? <p>주문 참조: {row.externalOrderReference}</p> : null}</article>)}</div>
      {preview.nextAfterRowNumber ? <button type="button" className="filter-button" disabled={busy} onClick={() => void loadPreview(batch.batchId, true, preview.nextAfterRowNumber ?? 0)}>검증 행 더 보기</button> : null}
      {batch.status === "preview_ready" || batch.status === "committing" ? <button type="button" className="filter-button" disabled={busy} onClick={() => void act("commit")}>{batch.status === "committing" ? "가져오기 계속" : "검증 행 가져오기"}</button> : null}
      {batch.status === "preview_ready" ? <button type="button" className="filter-button" disabled={busy} onClick={() => void act("cancel")}>배치 취소</button> : null}
    </section> : null}
  </details>;
}
