"use client";
import {
  AlertTriangle,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  LoaderCircle,
  RefreshCw,
  Search,
  ShoppingCart,
  Truck,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { useModalInteraction } from ".././use-modal-interaction";
import { channels } from ".././channel-config";
import { isActiveChannelKey } from "../../lib/channels/catalog";
import {
  shipmentVerificationSummary,
  shipmentWriteAvailability,
} from "../../lib/channels/shipment-release";
import {
  buildPaidOrdersExcelWorkbook,
  paidOrdersExcelFilename,
} from "../../lib/order-excel";
import type { ShippingSnapshot } from "../../lib/shipping/snapshot";
const channelByCode = new Map(
  Object.values(channels).map((channel) => [channel.letter, channel]),
);
export type DisplayOrder = {
  sourceId: string;
  id: string;
  channelKey: string;
  channel: string;
  customer: string;
  product: string;
  amount: string;
  status: string;
  time: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  carrierCode: string | null;
  trackingNumber: string | null;
  settlementStatus: string;
  settlementAmount: number | null;
  settlementCurrency: string | null;
  exchangeLossPercent: number | null;
};
function normalizeSearchText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, " ")
    .trim();
}
function matchesSearch(searchable: string, query: string) {
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  const normalized = normalizeSearchText(searchable);
  return (
    tokens.length > 0 && tokens.every((token) => normalized.includes(token))
  );
}
function relativeTime(value: string) {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(value).getTime()) / 60_000),
  );
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}시간 전`;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
  }).format(new Date(value));
}
function ChannelMark({
  code,
  size = "md",
}: {
  code: string;
  size?: "sm" | "md" | "lg";
}) {
  const config = channelByCode.get(code) ?? channels.qoo10;
  return (
    <span
      className={`channel-mark ${size} ${config.mark.length > 2 ? "wide" : ""}`}
      title={config.name}
      aria-label={config.name}
      style={{ "--channel-color": config.color } as React.CSSProperties}
    >
      {config.mark}
    </span>
  );
}
function StatusBadge({ status }: { status: string }) {
  const tone =
    status.includes("완료") || status === "판매중" || status === "정상"
      ? "success"
      : status.includes("주의") ||
          status.includes("대기") ||
          status === "처리 중"
        ? "warning"
        : status.includes("긴급") ||
            status === "품절" ||
            status.includes("실패")
          ? "danger"
          : "neutral";
  return (
    <span className={`status-badge ${tone}`}>
      <i />
      {status}
    </span>
  );
}
export type ShipmentInput = {
  id: string;
  carrierCode: string;
  trackingNumber: string;
  tracxReferenceKind?: "packing_no" | "reference_order_no";
  tracxReference?: string;
};
type ShipmentDraftInput = Omit<ShipmentInput, "id">;
export type ShipmentResult = {
  succeeded: number;
  failed: number;
  reconciliationRequired: number;
  results: Array<{
    id: string;
    channel: string;
    ok: boolean;
    message: string;
    reconciliationRequired?: boolean;
  }>;
};
export function OrdersPage({
  notify,
  displayOrders,
  onFulfill,
  syncStatus,
  initialQuery = "",
  initialOrderId = null,
}: {
  notify: (message: string) => void;
  displayOrders: DisplayOrder[];
  onFulfill: (shipments: ShipmentInput[]) => Promise<ShipmentResult>;
  syncStatus: ShippingSnapshot["syncStatus"];
  initialQuery?: string;
  initialOrderId?: string | null;
}) {
  const [active, setActive] = useState("전체 주문");
  const [query, setQuery] = useState(initialQuery);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [shipmentDrafts, setShipmentDrafts] = useState<
    Record<string, ShipmentDraftInput>
  >({});
  const [fulfillmentOpen, setFulfillmentOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<DisplayOrder | null>(
    () => displayOrders.find((order) => order.id === initialOrderId) ?? null,
  );
  const [fulfilling, setFulfilling] = useState(false);
  const invoiceInputRef = useRef<HTMLInputElement>(null);
  const detailDialogRef = useRef<HTMLElement>(null);
  const fulfillmentDialogRef = useRef<HTMLElement>(null);
  useModalInteraction(Boolean(detailOrder), detailDialogRef, () =>
    setDetailOrder(null),
  );
  useModalInteraction(
    fulfillmentOpen,
    fulfillmentDialogRef,
    () => {
      if (!fulfilling) setFulfillmentOpen(false);
    },
    { dismissible: !fulfilling },
  );
  const paidCount = displayOrders.filter(
    (order) => order.status === "결제완료",
  ).length;
  const readyCount = displayOrders.filter(
    (order) => order.status === "출고대기",
  ).length;
  const fulfillmentCandidateCount = displayOrders.filter(
    (order) =>
      ["결제완료", "출고대기"].includes(order.status) &&
      isActiveChannelKey(order.channelKey) &&
      shipmentWriteAvailability(order.channelKey).available,
  ).length;
  const shipmentVerification = shipmentVerificationSummary(
    fulfillmentCandidateCount,
  );
  const shippingCount = displayOrders.filter(
    (order) => order.status === "배송중",
  ).length;
  const deliveredCount = displayOrders.filter(
    (order) => order.status === "배송완료",
  ).length;
  const settledCount = displayOrders.filter(
    (order) => order.settlementStatus === "정산 완료",
  ).length;
  const exchangeRiskCount = displayOrders.filter(
    (order) => (order.exchangeLossPercent ?? 0) >= 2,
  ).length;
  const lastSuccess =
    syncStatus
      .filter((item) => item.data_type === "orders" && item.last_succeeded_at)
      .sort(
        (left, right) =>
          Date.parse(right.last_succeeded_at ?? "") -
          Date.parse(left.last_succeeded_at ?? ""),
      )[0]?.last_succeeded_at ?? null;
  const failedCount = syncStatus.filter(
    (item) => item.data_type === "orders" && item.status === "failed",
  ).length;
  const downloadPaidOrders = () => {
    const workbook = buildPaidOrdersExcelWorkbook(displayOrders);
    if (workbook.count === 0) {
      notify("내려받을 결제완료 주문이 없습니다.");
      return;
    }
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", workbook.xml], {
        type: "application/vnd.ms-excel;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = paidOrdersExcelFilename();
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    notify(`결제완료 주문 ${workbook.count}건을 Excel 파일로 내려받았습니다.`);
  };
  const filteredOrders = displayOrders.filter((order) => {
    const matchesTab =
      active === "전체 주문" ||
      (active === "완료 · 취소" &&
        ["배송완료", "취소완료", "환불완료"].includes(order.status)) ||
      order.status === active;
    return (
      matchesTab &&
      (!query.trim() ||
        matchesSearch(
          `${order.id} ${order.customer} ${order.product} ${order.status}`,
          query,
        ))
    );
  });
  const eligibleOrders = filteredOrders.filter(
    (order) =>
      ["결제완료", "출고대기"].includes(order.status) &&
      isActiveChannelKey(order.channelKey) &&
      shipmentWriteAvailability(order.channelKey).available,
  );
  const selectedOrders = displayOrders.filter(
    (order) =>
      selectedIds.has(order.sourceId) &&
      isActiveChannelKey(order.channelKey) &&
      shipmentWriteAvailability(order.channelKey).available,
  );
  const allEligibleSelected =
    eligibleOrders.length > 0 &&
    eligibleOrders.every((order) => selectedIds.has(order.sourceId));
  const toggleAllEligible = () =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allEligibleSelected)
        eligibleOrders.forEach((order) => next.delete(order.sourceId));
      else eligibleOrders.forEach((order) => next.add(order.sourceId));
      return next;
    });
  const toggleOrder = (order: DisplayOrder) => {
    if (
      !isActiveChannelKey(order.channelKey) ||
      !shipmentWriteAvailability(order.channelKey).available
    ) {
      notify(
        "이 채널은 자동 발송 API 범위가 검증되지 않아 선택할 수 없습니다. 판매자센터에서 처리해 주세요.",
      );
      return;
    }
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(order.sourceId)) next.delete(order.sourceId);
      else next.add(order.sourceId);
      return next;
    });
  };
  const openFulfillment = () => {
    if (!selectedOrders.length) {
      notify("결제완료 또는 출고대기 주문을 먼저 선택해 주세요.");
      return;
    }
    setShipmentDrafts((current) =>
      Object.fromEntries(
        selectedOrders.map((order) => [
          order.sourceId,
          current[order.sourceId] ?? { carrierCode: "", trackingNumber: "" },
        ]),
      ),
    );
    setFulfillmentOpen(true);
  };
  const importInvoices = async (file: File | null) => {
    if (!file) return;
    try {
      const lines = (await file.text())
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (!lines.length) throw new Error("empty");
      const rows = lines.map((line) =>
        line.split(",").map((value) => value.trim().replace(/^"|"$/g, "")),
      );
      const header = rows[0].map((value) => normalizeSearchText(value));
      const hasHeader = header.some((value) =>
        ["orderid", "주문번호", "tracking", "운송장번호"].includes(
          value.replace(/\s/g, ""),
        ),
      );
      const dataRows = hasHeader ? rows.slice(1) : rows;
      const nextDrafts: Record<string, ShipmentDraftInput> = {};
      const nextSelected = new Set<string>();
      for (const row of dataRows) {
        const [
          externalOrderId,
          carrierCode,
          trackingNumber,
          tracxReference = "",
          rawTracxReferenceKind = "packing_no",
        ] = row;
        const matchingOrders = displayOrders.filter(
          (candidate) => candidate.id === externalOrderId,
        );
        const order = matchingOrders.length === 1 ? matchingOrders[0] : null;
        if (
          !order ||
          !carrierCode ||
          !trackingNumber ||
          !isActiveChannelKey(order.channelKey) ||
          !shipmentWriteAvailability(order.channelKey).available
        )
          continue;
        nextSelected.add(order.sourceId);
        nextDrafts[order.sourceId] = {
          carrierCode,
          trackingNumber,
          tracxReference,
          tracxReferenceKind:
            rawTracxReferenceKind === "reference_order_no"
              ? "reference_order_no"
              : "packing_no",
        };
      }
      if (!nextSelected.size) throw new Error("unmatched");
      setSelectedIds(nextSelected);
      setShipmentDrafts(nextDrafts);
      setFulfillmentOpen(true);
      notify(`${nextSelected.size}건의 송장 정보를 불러왔습니다.`);
    } catch {
      notify(
        "CSV를 ‘주문번호,택배사코드,운송장번호[,TracX참조번호,참조종류]’ 순서로 확인해 주세요.",
      );
    } finally {
      if (invoiceInputRef.current) invoiceInputRef.current.value = "";
    }
  };
  const confirmFulfillment = async () => {
    const shipments = selectedOrders.map((order) => ({
      id: order.sourceId,
      ...shipmentDrafts[order.sourceId],
    }));
    if (
      shipments.some((shipment) => {
        const order = selectedOrders.find(
          (candidate) => candidate.sourceId === shipment.id,
        );
        return (
          !shipment.carrierCode?.trim() ||
          (order?.channelKey !== "lazada" && !shipment.trackingNumber?.trim())
        );
      })
    ) {
      notify("택배사 코드와 Lazada 외 채널의 실제 운송장번호를 입력해 주세요.");
      return;
    }
    setFulfilling(true);
    try {
      const result = await onFulfill(shipments);
      if (result.succeeded)
        setSelectedIds((current) => {
          const next = new Set(current);
          result.results
            .filter((item) => item.ok)
            .forEach((item) => next.delete(item.id));
          return next;
        });
      if (result.failed === 0 && result.reconciliationRequired === 0)
        setFulfillmentOpen(false);
    } finally {
      setFulfilling(false);
    }
  };
  return (
    <div className="page-stack">
      <section className="order-summary-grid">
        <article>
          <span className="metric-icon blue">
            <ShoppingCart size={19} />
          </span>
          <div>
            <small>통합 주문</small>
            <strong>{displayOrders.length}</strong>
          </div>
          <em>운영 원장</em>
        </article>
        <article>
          <span className="metric-icon orange">
            <Clock3 size={19} />
          </span>
          <div>
            <small>출고 대기</small>
            <strong>{readyCount}</strong>
          </div>
          <em className="neutral">결제완료 {paidCount}건</em>
        </article>
        <article>
          <span className="metric-icon violet">
            <Truck size={19} />
          </span>
          <div>
            <small>배송 중 · 완료</small>
            <strong>
              {shippingCount} · {deliveredCount}
            </strong>
          </div>
          <em className="neutral">운송장 추적</em>
        </article>
        <article>
          <span
            className={`metric-icon ${exchangeRiskCount ? "orange" : "green"}`}
          >
            <CircleDollarSign size={19} />
          </span>
          <div>
            <small>정산 완료</small>
            <strong>{settledCount}</strong>
          </div>
          <em className={exchangeRiskCount ? "negative" : "neutral"}>
            {exchangeRiskCount
              ? `환율 손실주의 ${exchangeRiskCount}건`
              : "환율 손실주의 없음"}
          </em>
        </article>
        <article>
          <span className={`metric-icon ${failedCount ? "orange" : "green"}`}>
            <RefreshCw size={19} />
          </span>
          <div>
            <small>최근 동기화</small>
            <strong>{lastSuccess ? relativeTime(lastSuccess) : "대기"}</strong>
          </div>
          <em className={failedCount ? "neutral" : ""}>
            {failedCount ? `${failedCount}개 채널 확인 필요` : "실제 채널 API"}
          </em>
        </article>
      </section>
      <section
        className="shipment-warning shipment-release-status"
        role="status"
      >
        <AlertTriangle size={16} />
        <span>
          <b>{shipmentVerification.title}</b>
          <small>{shipmentVerification.detail}</small>
        </span>
      </section>
      <section className="panel data-panel">
        <div className="tab-toolbar">
          <div>
            {["전체 주문", "결제완료", "출고대기", "배송중", "완료 · 취소"].map(
              (tab) => (
                <button
                  className={active === tab ? "active" : ""}
                  onClick={() => setActive(tab)}
                  key={tab}
                >
                  {tab}
                  {tab === "출고대기" && <span>{readyCount}</span>}
                </button>
              ),
            )}
          </div>
          <label className="search-field">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="주문번호, 구매자, 상품 검색"
              aria-label="주문 검색"
            />
          </label>
          <button
            type="button"
            className="icon-text-button paid-orders-export-button"
            onClick={downloadPaidOrders}
            title="결제완료 상태의 주문만 Excel 파일로 내려받기"
          >
            <Download size={15} />
            결제완료 Excel <b>{paidCount}</b>건
          </button>
          <span className="automatic-sync-label">
            <RefreshCw size={14} />
            5분마다 자동 업데이트
          </span>
        </div>
        <div className="table-wrap">
          <table className="data-table order-table">
            <thead>
              <tr>
                <th>
                  <label className="order-checkbox-control">
                    <input
                      type="checkbox"
                      aria-label="출고 가능 주문 전체 선택"
                      checked={allEligibleSelected}
                      onChange={toggleAllEligible}
                    />
                  </label>
                </th>
                <th>주문번호</th>
                <th>채널</th>
                <th>구매자</th>
                <th>상품</th>
                <th>결제금액</th>
                <th>주문 · 배송</th>
                <th>정산</th>
                <th>주문시간</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((order) => {
                const supported =
                  isActiveChannelKey(order.channelKey) &&
                  shipmentWriteAvailability(order.channelKey).available;
                const eligible =
                  ["결제완료", "출고대기"].includes(order.status) && supported;
                return (
                  <tr
                    key={order.sourceId}
                    className={`${initialOrderId === order.id ? "search-target-row" : ""} ${selectedIds.has(order.sourceId) ? "selected-row" : ""}`.trim()}
                  >
                    <td>
                      <label className="order-checkbox-control">
                        <input
                          type="checkbox"
                          aria-label={`${order.id} 출고 선택`}
                          checked={selectedIds.has(order.sourceId)}
                          disabled={!eligible}
                          title={
                            !supported ? "자동 발송 API 검증 전" : undefined
                          }
                          onChange={() => toggleOrder(order)}
                        />
                      </label>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="order-detail-link mono"
                        onClick={() => setDetailOrder(order)}
                      >
                        {order.id}
                      </button>
                    </td>
                    <td>
                      <ChannelMark code={order.channel} size="sm" />
                    </td>
                    <td>
                      <b>{order.customer}</b>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="order-product-button truncate-product"
                        onClick={() => setDetailOrder(order)}
                      >
                        {order.product}
                      </button>
                    </td>
                    <td>
                      <b>{order.amount}</b>
                    </td>
                    <td>
                      <StatusBadge status={order.status} />
                      {order.trackingNumber ? (
                        <small className="tracking-fact">
                          {order.carrierCode} · {order.trackingNumber}
                        </small>
                      ) : !supported &&
                        ["결제완료", "출고대기"].includes(order.status) ? (
                        <small className="tracking-fact">
                          자동 발송 미검증 · 판매자센터 처리
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <StatusBadge status={order.settlementStatus} />
                      {(order.exchangeLossPercent ?? 0) >= 2 ? (
                        <small className="exchange-loss-warning">
                          환율 -{order.exchangeLossPercent}%
                        </small>
                      ) : null}
                    </td>
                    <td>
                      <span className="muted-cell">{order.time}</span>
                    </td>
                    <td>
                      <button
                        className="table-action"
                        title="주문 상세정보 보기"
                        aria-label={`${order.id} 주문 상세정보 보기`}
                        onClick={() => setDetailOrder(order)}
                      >
                        <ChevronRight size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {displayOrders.length === 0 ? (
          <div className="live-empty-state table-empty">
            <ShoppingCart size={28} />
            <b>동기화된 실제 주문이 없습니다.</b>
            <small>채널 API 키 연결 후 주문 조회를 실행하면 표시됩니다.</small>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="live-empty-state table-empty">
            <Search size={28} />
            <b>검색 조건에 맞는 주문이 없습니다.</b>
            <small>주문번호, 구매자명 또는 상품명을 다시 확인해 주세요.</small>
          </div>
        ) : null}
        <div className="bulk-order-bar">
          <label className="bulk-order-selection">
            <input
              type="checkbox"
              aria-label="출고 가능 주문 전체 선택"
              checked={allEligibleSelected}
              onChange={toggleAllEligible}
            />
            선택한 주문 <b>{selectedIds.size}</b>건
          </label>
          <button
            type="button"
            disabled={!selectedIds.size || fulfilling}
            onClick={openFulfillment}
          >
            <Truck size={15} />
            일괄 출고 처리
          </button>
          <button
            type="button"
            disabled={fulfilling}
            onClick={() => invoiceInputRef.current?.click()}
          >
            <Upload size={15} />
            송장 CSV 업로드
          </button>
          <input
            ref={invoiceInputRef}
            className="sr-only"
            type="file"
            accept=".csv,text/csv"
            aria-label="송장 CSV 파일 선택"
            onChange={(event) =>
              void importInvoices(event.target.files?.[0] ?? null)
            }
          />
          <span className="toolbar-spacer" />
          <small>
            {syncStatus.length
              ? "채널별 동기화 상태 기록 중 · 5분 자동 업데이트"
              : "채널 연결 상태 확인 중"}
          </small>
        </div>
      </section>
      {detailOrder && (
        <div
          className="shipment-dialog-overlay"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget) setDetailOrder(null);
          }}
        >
          <section
            ref={detailDialogRef}
            tabIndex={-1}
            className="shipment-dialog order-detail-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-detail-title"
          >
            <header>
              <div>
                <span className="metric-icon blue">
                  <ShoppingCart size={18} />
                </span>
                <span>
                  <h3 id="order-detail-title">주문 상세정보</h3>
                  <small>주문 · 배송 · 정산 원장을 한곳에서 확인합니다.</small>
                </span>
              </div>
              <button
                className="icon-only-button"
                aria-label="주문 상세 닫기"
                onClick={() => setDetailOrder(null)}
              >
                <X size={17} />
              </button>
            </header>
            <dl className="order-detail-ledger">
              <div>
                <dt>주문번호</dt>
                <dd>{detailOrder.id}</dd>
              </div>
              <div>
                <dt>판매 채널</dt>
                <dd>
                  <ChannelMark code={detailOrder.channel} size="sm" />
                </dd>
              </div>
              <div>
                <dt>구매 상품</dt>
                <dd>{detailOrder.product}</dd>
              </div>
              <div>
                <dt>구매자</dt>
                <dd>{detailOrder.customer}</dd>
              </div>
              <div>
                <dt>결제금액</dt>
                <dd>{detailOrder.amount}</dd>
              </div>
              <div>
                <dt>주문상태</dt>
                <dd>
                  <StatusBadge status={detailOrder.status} />
                </dd>
              </div>
              <div>
                <dt>배송 추적</dt>
                <dd>
                  {detailOrder.trackingNumber
                    ? `${detailOrder.carrierCode ?? "택배사"} · ${detailOrder.trackingNumber}`
                    : "운송장 등록 전"}
                </dd>
              </div>
              <div>
                <dt>배송 완료</dt>
                <dd>
                  {detailOrder.deliveredAt
                    ? formatOrderUpdatedAt(detailOrder.deliveredAt)
                    : "완료 전"}
                </dd>
              </div>
              <div>
                <dt>정산 상태</dt>
                <dd>
                  <StatusBadge status={detailOrder.settlementStatus} />
                </dd>
              </div>
              <div>
                <dt>정산 금액</dt>
                <dd>
                  {detailOrder.settlementAmount != null &&
                  detailOrder.settlementCurrency
                    ? new Intl.NumberFormat("ko-KR", {
                        style: "currency",
                        currency: detailOrder.settlementCurrency,
                      }).format(detailOrder.settlementAmount)
                    : "정산 데이터 대기"}
                </dd>
              </div>
              <div>
                <dt>환율 손익 참고</dt>
                <dd
                  className={
                    (detailOrder.exchangeLossPercent ?? 0) >= 2
                      ? "exchange-loss-warning"
                      : ""
                  }
                >
                  {detailOrder.exchangeLossPercent == null
                    ? "기준환율 데이터 대기"
                    : `${detailOrder.exchangeLossPercent > 0 ? "손실 " : "이익 "}${Math.abs(detailOrder.exchangeLossPercent).toFixed(2)}%`}
                </dd>
              </div>
              <div>
                <dt>주문시간</dt>
                <dd>{detailOrder.time}</dd>
              </div>
            </dl>
            <footer>
              <button
                type="button"
                className="credential-secondary"
                onClick={() => setDetailOrder(null)}
              >
                닫기
              </button>
              {["결제완료", "출고대기"].includes(detailOrder.status) &&
              isActiveChannelKey(detailOrder.channelKey) &&
              shipmentWriteAvailability(detailOrder.channelKey).available ? (
                <button
                  type="button"
                  className="publish-execute"
                  onClick={() => {
                    setSelectedIds(new Set([detailOrder.sourceId]));
                    setShipmentDrafts({
                      [detailOrder.sourceId]: shipmentDrafts[
                        detailOrder.sourceId
                      ] ?? { carrierCode: "", trackingNumber: "" },
                    });
                    setDetailOrder(null);
                    setFulfillmentOpen(true);
                  }}
                >
                  <Truck size={15} />
                  출고 정보 입력
                </button>
              ) : null}
            </footer>
          </section>
        </div>
      )}
      {fulfillmentOpen && (
        <div
          className="shipment-dialog-overlay"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget && !fulfilling)
              setFulfillmentOpen(false);
          }}
        >
          <section
            ref={fulfillmentDialogRef}
            tabIndex={-1}
            className="shipment-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shipment-dialog-title"
          >
            <header>
              <div>
                <span className="metric-icon violet">
                  <Truck size={18} />
                </span>
                <span>
                  <h3 id="shipment-dialog-title">판매채널 발송 처리</h3>
                  <small>
                    선택한 {selectedOrders.length}건을 외부 판매채널에 실제 발송
                    처리합니다.
                  </small>
                </span>
              </div>
              <button
                className="icon-only-button"
                aria-label="출고 창 닫기"
                disabled={fulfilling}
                onClick={() => setFulfillmentOpen(false)}
              >
                <X size={17} />
              </button>
            </header>
            <div className="shipment-warning">
              <AlertTriangle size={16} />
              <span>
                <b>실제 판매 상태가 변경됩니다.</b>
                <small>
                  판매채널이 성공 응답한 주문만 SellerPilot에서 배송중으로
                  변경됩니다. TracX 참조번호는 운송장이나 마켓 주문번호 대신
                  SmartShip 원문 값을 입력해야 합니다.
                </small>
              </span>
            </div>
            <fieldset
              className="shipment-draft-list"
              disabled={fulfilling}
              aria-busy={fulfilling}
            >
              {selectedOrders.map((order) => (
                <article key={order.sourceId}>
                  <div>
                    <ChannelMark code={order.channel} size="sm" />
                    <span>
                      <b>{order.id}</b>
                      <small>{order.product}</small>
                    </span>
                  </div>
                  <label>
                    <span>택배사 코드</span>
                    <input
                      value={shipmentDrafts[order.sourceId]?.carrierCode ?? ""}
                      onChange={(event) =>
                        setShipmentDrafts((current) => ({
                          ...current,
                          [order.sourceId]: {
                            ...(current[order.sourceId] ?? {
                              trackingNumber: "",
                            }),
                            carrierCode: event.target.value,
                          },
                        }))
                      }
                      placeholder="채널 공식 택배사 코드"
                    />
                  </label>
                  <label>
                    <span>
                      {order.channelKey === "lazada"
                        ? "운송장번호 · 자동 발급"
                        : "운송장번호"}
                    </span>
                    <input
                      disabled={order.channelKey === "lazada"}
                      value={
                        order.channelKey === "lazada"
                          ? "Pack 완료 후 Lazada 발급"
                          : (shipmentDrafts[order.sourceId]?.trackingNumber ??
                            "")
                      }
                      onChange={(event) =>
                        setShipmentDrafts((current) => ({
                          ...current,
                          [order.sourceId]: {
                            ...(current[order.sourceId] ?? { carrierCode: "" }),
                            trackingNumber: event.target.value,
                          },
                        }))
                      }
                      placeholder="숫자·영문 운송장번호"
                    />
                  </label>
                  <label>
                    <span>TracX 참조 종류 · 선택</span>
                    <select
                      value={
                        shipmentDrafts[order.sourceId]?.tracxReferenceKind ??
                        "packing_no"
                      }
                      onChange={(event) =>
                        setShipmentDrafts((current) => ({
                          ...current,
                          [order.sourceId]: {
                            ...(current[order.sourceId] ?? {
                              carrierCode: "",
                              trackingNumber: "",
                            }),
                            tracxReferenceKind: event.target.value as
                              | "packing_no"
                              | "reference_order_no",
                          },
                        }))
                      }
                    >
                      <option value="packing_no">PackingNo</option>
                      <option value="reference_order_no">RefOrderNo</option>
                    </select>
                  </label>
                  <label>
                    <span>TracX 정확한 참조번호 · 선택</span>
                    <input
                      value={
                        shipmentDrafts[order.sourceId]?.tracxReference ?? ""
                      }
                      onChange={(event) =>
                        setShipmentDrafts((current) => ({
                          ...current,
                          [order.sourceId]: {
                            ...(current[order.sourceId] ?? {
                              carrierCode: "",
                              trackingNumber: "",
                            }),
                            tracxReference: event.target.value,
                          },
                        }))
                      }
                      placeholder="SmartShip 원문 그대로 입력"
                    />
                  </label>
                </article>
              ))}
            </fieldset>
            <footer>
              <button
                type="button"
                className="credential-secondary"
                disabled={fulfilling}
                onClick={() => setFulfillmentOpen(false)}
              >
                취소
              </button>
              <button
                type="button"
                className="publish-execute"
                disabled={
                  fulfilling ||
                  selectedOrders.some(
                    (order) =>
                      !shipmentDrafts[order.sourceId]?.carrierCode.trim() ||
                      (order.channelKey !== "lazada" &&
                        !shipmentDrafts[order.sourceId]?.trackingNumber.trim()),
                  )
                }
                onClick={() => void confirmFulfillment()}
              >
                {fulfilling ? (
                  <LoaderCircle className="spin" size={15} />
                ) : (
                  <Truck size={15} />
                )}
                {fulfilling ? "판매채널 처리 중" : "확인 후 실제 발송 처리"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
function formatOrderUpdatedAt(value: string) {
  const time = new Date(value);
  return Number.isNaN(time.getTime())
    ? "확인 필요"
    : new Intl.DateTimeFormat("ko-KR", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(time);
}
