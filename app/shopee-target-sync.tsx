"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { shopeeMarkets } from "../lib/channels/markets";
import { createClient } from "../lib/supabase/client";
import { waitForAbortablePromise } from "./operations-snapshot-request-coordinator";
import type { ExactShopeeTarget } from "./channel-target-client";
import { syncExistingShopeeTarget } from "./shopee-target-sync-client";

export function ShopeeTargetSync({ disabled, onSynced }: { disabled: boolean; onSynced: (target: ExactShopeeTarget) => void }) {
  const [targetId, setTargetId] = useState("");
  const [marketCode, setMarketCode] = useState("SG");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const sync = async () => {
    if (active.current || disabled) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      const session = await waitForAbortablePromise(createClient().auth.getSession(), AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]));
      const accessToken = session.data.session?.access_token;
      if (!accessToken) throw new Error("현재 SellerPilot 관리자 로그인을 확인해 주세요.");
      const result = await syncExistingShopeeTarget({ accessToken, selection: { targetId, marketCode }, checkOnly: pending, signal: controller.signal });
      if (controller.signal.aborted) return;
      setPending(result.pending);
      setMessage(result.message);
      if (result.target) onSynced(result.target);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "숍 동기화 상태를 확인하지 못했습니다.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (active.current === controller) active.current = null;
    }
  };
  return <div className="category-manual-fallback">
    <b>기존 연결의 숍 동기화</b>
    <small>판매자센터의 숍 ID를 입력하면 기존 승인 계정으로 국가·언어 정보를 조회합니다.</small>
    <label><span>등록 국가</span><select aria-label="Shopee 숍 동기화 국가" value={marketCode} disabled={busy || pending} onChange={(event) => setMarketCode(event.target.value)}>{shopeeMarkets.map((market) => <option key={market.code} value={market.code}>{market.code} · {market.language}</option>)}</select></label>
    <label><span>숍 ID</span><input aria-label="Shopee 동기화 숍 ID" inputMode="numeric" value={targetId} disabled={busy || pending} onChange={(event) => setTargetId(event.target.value)} placeholder="판매자센터의 숫자 숍 ID" /></label>
    {marketCode !== "SG" && <small>현재 공식 동기화는 SG를 지원합니다. 선택한 국가를 임의로 변경해 전송하지 않습니다.</small>}
    <button type="button" disabled={disabled || busy || marketCode !== "SG" || !/^[1-9][0-9]{0,31}$/.test(targetId.trim())} onClick={() => void sync()}><RefreshCw size={14} className={busy ? "spin" : undefined} />{busy ? "숍 확인 중" : pending ? "동기화 상태 확인" : "기존 연결로 숍 동기화"}</button>
    {message && <p role="status">{message}</p>}
  </div>;
}
