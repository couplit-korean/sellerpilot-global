"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  Bell,
  Bot,
  Box,
  CalendarDays,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CloudUpload,
  Command,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  Filter,
  Headphones,
  HelpCircle,
  ImagePlus,
  Inbox,
  Languages,
  LayoutDashboard,
  LifeBuoy,
  Link2,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  KeyRound,
  LogOut,
  Menu,
  MessageCircleMore,
  MoreHorizontal,
  Package,
  PackageCheck,
  PackageSearch,
  PanelLeftClose,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Send,
  Settings,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Trash2,
  Truck,
  Upload,
  UserRound,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { channels, type ChannelKey } from "./channel-config";
import { activeChannelKeys, type ActiveChannelKey } from "../lib/channels/catalog";
import { marketplaceListingDestination } from "../lib/channels/listing-normalization";
import { useOperationsSnapshot, type OperationsSnapshot } from "./use-operations-snapshot";
import { createClient as createSupabaseClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";
import { emptyProductIntake, productConditions, productCurrencies, productIntakeSchema, type ProductIntakeDraft } from "../lib/product-intake";
import { userFacingErrorMessage, userNotice, type UserNoticeTone } from "../lib/user-facing-errors";

const AiProductStudio = dynamic(() => import("./ai-product-studio").then((module) => module.AiProductStudio), { loading: () => <PageSectionLoading label="AI 상품 도구" /> });
const ApiCredentialCenter = dynamic(() => import("./api-credential-center").then((module) => module.ApiCredentialCenter), { loading: () => <PageSectionLoading label="채널 연결" /> });
const ChannelReadinessPage = dynamic(() => import("./channel-readiness").then((module) => module.ChannelReadinessPage), { loading: () => <PageSectionLoading label="연결 상태" /> });
const CategoryClassificationWorkbench = dynamic(() => import("./category-classification-workbench").then((module) => module.CategoryClassificationWorkbench), { loading: () => <PageSectionLoading label="판매 카테고리" /> });
const ProductPublishWorkbench = dynamic(() => import("./product-publish-workbench").then((module) => module.ProductPublishWorkbench), { loading: () => <PageSectionLoading label="채널 등록" /> });
const MarginCalculatorPage = dynamic(() => import("./margin-calculator").then((module) => module.MarginCalculatorPage), { loading: () => <PageSectionLoading label="수익 계산" /> });

function PageSectionLoading({ label }: { label: string }) {
  return <section className="panel page-section-loading" role="status"><LoaderCircle className="spin" size={22} /><b>{label} 불러오는 중</b></section>;
}

type View =
  | "overview"
  | "products"
  | "publishing"
  | "margin"
  | "orders"
  | "cs"
  | "readiness"
  | "credentials"
  | "qoo10"
  | "shopee"
  | "lazada"
  | "coupang"
  | "temu"
  | "smartstore"
  | "ebay";

type ToastNotice = { message: string; tone: UserNoticeTone };

function NoticeToast({ notice, onClose }: { notice: ToastNotice; onClose: () => void }) {
  const Icon = notice.tone === "success" ? CheckCircle2 : notice.tone === "error" ? AlertTriangle : notice.tone === "warning" ? AlertCircle : HelpCircle;
  const label = notice.tone === "success" ? "완료" : notice.tone === "error" ? "처리하지 못했어요" : notice.tone === "warning" ? "확인해 주세요" : "안내";
  return <div className={`toast notice-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"} aria-live={notice.tone === "error" ? "assertive" : "polite"} aria-atomic="true">
    <span className="toast-icon" aria-hidden="true"><Icon size={18} /></span>
    <span className="toast-copy"><b>{label}</b><span>{notice.message}</span></span>
    <button type="button" onClick={onClose} aria-label="알림 닫기"><X size={16} /></button>
  </div>;
}

const navGroups = [
  {
    label: "판매 관리",
    items: [
      { id: "overview" as View, label: "홈", icon: LayoutDashboard },
      { id: "products" as View, label: "상품", icon: Package },
      { id: "publishing" as View, label: "상품 등록", icon: CloudUpload },
      { id: "margin" as View, label: "수익 계산", icon: Calculator },
      { id: "orders" as View, label: "주문", icon: ShoppingCart },
      { id: "cs" as View, label: "고객 문의", icon: Headphones },
      { id: "readiness" as View, label: "연결 상태", icon: ShieldCheck },
      { id: "credentials" as View, label: "채널 연결", icon: KeyRound },
    ],
  },
  {
    label: "판매 채널",
    items: [
      { id: "qoo10" as View, label: "Qoo10 Japan", channel: "Q" },
      { id: "shopee" as View, label: "Shopee Global", channel: "S" },
      { id: "lazada" as View, label: "Lazada MY", channel: "L" },
      { id: "coupang" as View, label: "쿠팡", channel: "C" },
      { id: "smartstore" as View, label: "네이버 스마트스토어", channel: "N" },
      { id: "ebay" as View, label: "eBay Global", channel: "E" },
      { id: "temu" as View, label: "Temu Korea", channel: "T" },
    ],
  },
];

const pageMeta: Record<View, { title: string; description: string }> = {
  overview: { title: "홈", description: "모든 판매 채널의 오늘 할 일을 한눈에 확인하세요." },
  products: { title: "상품", description: "등록 상태와 재고, 판매 현황을 한곳에서 관리하세요." },
  publishing: { title: "상품 등록", description: "사진과 상품 정보를 입력하면 여러 판매 채널에 맞게 준비합니다." },
  margin: { title: "수익 계산", description: "상품 원가와 판매 비용을 반영해 예상 수익을 계산하세요." },
  orders: { title: "주문", description: "모든 판매 채널의 주문과 배송을 한곳에서 처리하세요." },
  cs: { title: "고객 문의", description: "여러 언어와 판매 채널의 문의를 한곳에서 답변하세요." },
  readiness: { title: "연결 상태", description: "판매 채널별 연결 상태와 필요한 조치를 확인하세요." },
  credentials: { title: "채널 연결", description: "판매 채널을 연결하고 만료 일정을 안전하게 관리하세요." },
  qoo10: { title: "Qoo10 Japan", description: "일본 스토어의 상품, 매출, 주문, 고객 문의 현황입니다." },
  shopee: { title: "Shopee Global", description: "8개 국가 Shopee 숍의 상품, 매출, 주문, 고객 문의 현황입니다." },
  lazada: { title: "Lazada Malaysia", description: "말레이시아 스토어의 상품, 매출, 주문, 고객 문의 현황입니다." },
  coupang: { title: "쿠팡", description: "쿠팡 스토어의 상품, 매출, 주문, 고객 문의 현황입니다." },
  smartstore: { title: "네이버 스마트스토어", description: "스마트스토어의 상품, 매출, 주문, 고객 문의 현황입니다." },
  ebay: { title: "eBay Global", description: "글로벌 스토어의 상품, 매출, 주문, 고객 문의 현황입니다." },
  temu: { title: "Temu Korea", description: "Temu 한국 스토어의 상품, 매출, 주문, 고객 문의 현황입니다." },
};

const ticketChannelCodes: Record<string, string> = {
  Qoo10: "Q",
  Shopee: "S",
  Lazada: "L",
  쿠팡: "C",
  "네이버 스마트스토어": "N",
  eBay: "E",
  Temu: "T",
};

const channelByCode = new Map(Object.values(channels).map((channel) => [channel.letter, channel]));
type DisplayProduct = {
  id: string;
  sourceId: string;
  name: string;
  sku: string;
  image: string | null;
  stock: number;
  sales: number;
  revenue: string;
  status: string;
  channels: string[];
  listings: Array<{
    channelKey: ActiveChannelKey;
    channelCode: string;
    remoteId: string;
    market: string;
    targetId: string;
  }>;
};

type DisplayOrder = {
  id: string;
  channel: string;
  customer: string;
  product: string;
  amount: string;
  status: string;
  time: string;
};

type DisplayTicket = {
  id: string;
  customer: string;
  channel: string;
  subject: string;
  preview: string;
  time: string;
  status: "긴급" | "답변 대기" | "처리 중" | "처리 완료";
};

const productStatusLabel = {
  draft: "등록 대기",
  active: "판매중",
  low_stock: "재고주의",
  out_of_stock: "품절",
  archived: "판매 종료",
} as const;

const orderStatusLabel = {
  paid: "결제완료",
  ready_to_ship: "출고대기",
  shipped: "배송중",
  delivered: "배송완료",
  cancelled: "취소완료",
  refunded: "환불완료",
} as const;

const ticketStatusLabel = {
  urgent: "긴급",
  waiting: "답변 대기",
  in_progress: "처리 중",
  resolved: "처리 완료",
} as const;

const channelNameByKey: Record<string, string> = {
  qoo10: "Qoo10",
  shopee: "Shopee",
  lazada: "Lazada",
  coupang: "쿠팡",
  smartstore: "네이버 스마트스토어",
  ebay: "eBay",
  temu: "Temu",
};

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}시간 전`;
  return new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric" }).format(new Date(value));
}

const initialExchangeRates = [
  { code: "USD", unit: 1, value: 1378.4, change: 0.24 },
  { code: "JPY", unit: 100, value: 931.12, change: -0.18 },
  { code: "SGD", unit: 1, value: 1072.65, change: 0.08 },
  { code: "MYR", unit: 1, value: 325.84, change: -0.11 },
];

function ChannelMark({ code, size = "md" }: { code: string; size?: "sm" | "md" | "lg" }) {
  const config = channelByCode.get(code) ?? channels.qoo10;
  return <span className={`channel-mark ${size} ${config.symbol.length > 1 ? "wide" : ""}`} style={{ "--channel-color": config.color } as React.CSSProperties} title={config.name} aria-label={config.name}>{config.symbol}</span>;
}

function isActiveChannelKey(value: string): value is ActiveChannelKey {
  return activeChannelKeys.includes(value as ActiveChannelKey);
}

function ChannelListingLink({ listing, productName }: { listing: DisplayProduct["listings"][number]; productName: string }) {
  const channel = channels[listing.channelKey];
  const destination = marketplaceListingDestination(listing.channelKey, listing.remoteId, productName, listing.market);
  const shortName = channelNameByKey[listing.channelKey] ?? channel.name;
  const scopedName = listing.market && (listing.channelKey === "shopee" || listing.channelKey === "lazada")
    ? `${shortName} ${listing.market}`
    : shortName;
  return <a
    className={`channel-listing-link ${listing.channelKey}`}
    style={{ "--channel-color": channel.color } as React.CSSProperties}
    href={destination.url}
    target="_blank"
    rel="noopener noreferrer"
    title={`${scopedName} ${destination.label} 새 창에서 열기`}
    aria-label={`${productName} ${scopedName} ${destination.label} 새 창에서 열기`}
  >
    <ChannelMark code={listing.channelCode} size="sm" />
    <span><b>{scopedName}</b><small>{destination.label}</small></span>
    <ExternalLink size={13} aria-hidden="true" />
  </a>;
}

function StatusBadge({ status }: { status: string }) {
  const tone = status.includes("완료") || status === "판매중" || status === "정상" ? "success" : status.includes("주의") || status.includes("대기") || status === "처리 중" ? "warning" : status.includes("긴급") || status === "품절" || status.includes("실패") ? "danger" : "neutral";
  return <span className={`status-badge ${tone}`}><i />{status}</span>;
}

function LoginScreen({ onLogin, onPasswordReset }: { onLogin: (email: string, password: string) => Promise<string | null>; onPasswordReset: (email: string) => Promise<string | null> }) {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError("아이디와 비밀번호를 모두 입력해 주세요.");
      return;
    }
    setLoading(true);
    setError("");
    const loginError = await onLogin(email.trim(), password);
    setLoading(false);
    if (loginError) setError(loginError);
  };

  const requestPasswordReset = async () => {
    if (!email.trim()) {
      setError("비밀번호를 재설정할 관리자 이메일을 먼저 입력해 주세요.");
      return;
    }
    setLoading(true);
    setError("");
    const resetError = await onPasswordReset(email.trim());
    setLoading(false);
    setError(resetError ?? "비밀번호 재설정 링크를 이메일로 보냈습니다.");
  };

  return (
    <main className="login-shell">
      <section className="login-brand-panel">
        <div className="brand-lockup"><span className="brand-symbol"><Zap size={18} fill="currentColor" /></span><strong>SellerPilot</strong><small>판매 운영을 더 간단하게</small></div>
        <div className="login-message">
          <span className="login-section-label">여러 판매 채널을 한곳에서</span>
          <h1>상품부터 주문·문의까지<br />SellerPilot 하나로.</h1>
          <p>판매 채널마다 반복하던 상품 등록, 주문 확인, 재고 관리와 고객 응대를<br />한 화면에서 쉽고 빠르게 처리하세요.</p>
          <div className="login-operations-preview">
            <div className="preview-heading"><b>오늘의 판매 업무</b><span>자동으로 정리해 드려요</span></div>
            <div className="preview-task urgent"><span>01</span><div><b>상품 정보 준비</b><small>사진 · 카테고리 · 필수 정보 확인</small></div><strong>준비 확인</strong></div>
            <div className="preview-task"><span>02</span><div><b>판매 채널 등록</b><small>연결된 채널에 상품 정보 전송</small></div><strong>자동 연결</strong></div>
            <div className="preview-task"><span>03</span><div><b>주문 · 문의 관리</b><small>주문과 고객 문의를 한 화면에서 확인</small></div><strong>한곳에서</strong></div>
            <div className="preview-settlement"><span>정보 업데이트</span><b>자동으로 최신 상태 유지</b><em>연결된 판매 채널 기준</em></div>
          </div>
          <div className="login-market-row"><span>판매 채널</span><div><ChannelMark code="Q" size="sm" /><ChannelMark code="S" size="sm" /><ChannelMark code="L" size="sm" /><ChannelMark code="C" size="sm" /><ChannelMark code="11" size="sm" /><ChannelMark code="N" size="sm" /><ChannelMark code="E" size="sm" /></div><b><i />연동 상태 통합 관리</b></div>
        </div>
        <footer><span>SellerPilot</span><span>상품 · 주문 · 문의 · 정산을 한곳에서</span></footer>
      </section>

      <section className="login-form-panel">
        <div className="mobile-brand"><div className="brand-lockup"><span className="brand-symbol"><Zap size={18} fill="currentColor" /></span><strong>SellerPilot</strong></div></div>
        <form className="login-card" onSubmit={submit}>
          <div className="login-card-heading">
            <span className="secure-mark"><LockKeyhole size={21} /></span>
            <h2>로그인</h2>
            <p>SellerPilot 계정으로 시작하세요.</p>
          </div>
          <label className="field-label" htmlFor="email">아이디</label>
          <div className="input-wrap"><UserRound size={17} /><input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="관리자 이메일" /></div>
          <div className="field-row"><label className="field-label" htmlFor="password">비밀번호</label><button type="button" className="text-button" onClick={() => void requestPasswordReset()}>비밀번호 찾기</button></div>
          <div className="input-wrap"><LockKeyhole size={17} /><input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /><button type="button" className="password-toggle" aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"} onClick={() => setShowPassword((current) => !current)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          <div className="remember-row"><span><Check size={12} /></span>이 브라우저에서 로그인 세션 유지</div>
          {error && <p className="login-error"><AlertCircle size={14} />{error}</p>}
          <button className="login-button" type="submit" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={18} />로그인 중...</> : <>로그인<ArrowRight size={18} /></>}</button>
          <div className="demo-account"><ShieldCheck size={15} /><span>판매 채널 연결 정보는 암호화해 안전하게 보호합니다.<br /><b>초대 메일에서 비밀번호를 설정해 주세요.</b></span></div>
        </form>
        <div className="login-support"><HelpCircle size={15} />접속에 문제가 있나요? <a href="mailto:couplit.official@gmail.com?subject=SellerPilot%20운영%20지원%20문의">운영 지원팀 문의</a></div>
      </section>
    </main>
  );
}

function MetricCard({ label, value, delta, detail, icon: Icon, tone, reverse }: { label: string; value: string; delta?: string; detail: string; icon: React.ComponentType<{ size?: number }>; tone: string; reverse?: boolean }) {
  return (
    <article className="metric-card">
      <div className="metric-copy"><span>{label}</span><strong>{value}</strong></div>
      <div className={`metric-icon ${tone}`}><Icon size={18} /></div>
      <div className="metric-foot">{delta ? <span className={reverse ? "negative" : "positive"}>{reverse ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{delta}</span> : <span className="neutral" aria-label="최신 정보"><Activity size={13} aria-hidden="true" />최신 정보</span>}<small>{detail}</small></div>
    </article>
  );
}

function formatCompactWon(value: number) {
  return `₩${Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
}

function ProductVisual({ src, size }: { src: string | null; size: string }) {
  return src ? <Image src={src} alt="" fill sizes={size} /> : <span className="product-image-missing"><Package size={17} /><small>NO IMAGE</small></span>;
}

function OverviewPage({ onNavigate, displayProducts, operationSummary, channelMetrics, pipeline, operationsAvailable }: {
  onNavigate: (view: View) => void;
  displayProducts: DisplayProduct[];
  operationSummary: OperationsSnapshot["summary"] | null;
  channelMetrics: OperationsSnapshot["channelMetrics"];
  pipeline: OperationsSnapshot["pipeline"] | null;
  operationsAvailable: boolean;
}) {
  const [period, setPeriod] = useState("30일");
  const [exchangeRates, setExchangeRates] = useState(initialExchangeRates);
  const [rateUpdatedAt, setRateUpdatedAt] = useState("화면 기준값");
  const [rateSource, setRateSource] = useState("실데이터 확인 중");
  const [today] = useState(() => new Date());
  const monthlyTopProducts = useMemo(() => [...displayProducts].sort((a, b) => b.sales - a.sales).slice(0, 10), [displayProducts]);
  const activeMetrics = useMemo(() => channelMetrics.filter((channel) => activeChannelKeys.includes(channel.channelKey as (typeof activeChannelKeys)[number])), [channelMetrics]);
  const summary = operationSummary ?? { revenue30dKrw: 0, sold30d: 0, orderCount: 0, paidOrderCount: 0, readyToShipCount: 0, openTicketCount: 0, lowStockCount: 0, productCount: 0, registrationErrorCount: 0, activeCredentialCount: 0 };
  const livePipeline = pipeline ?? { aiRunning: 0, listingQueued: 0, listingPublished: 0, listingFailed: 0 };
  const totalTasks = summary.readyToShipCount + summary.openTicketCount + summary.lowStockCount + summary.registrationErrorCount;
  const totalListings = livePipeline.listingPublished + livePipeline.listingFailed;
  const successRate = totalListings > 0 ? (livePipeline.listingPublished / totalListings) * 100 : 0;
  const maxChannelRevenue = Math.max(1, ...activeMetrics.map((channel) => channel.revenue30dKrw));
  const currentDate = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(today);
  const rangeDays = period === "7일" ? 7 : period === "90일" ? 90 : 30;
  const rangeStart = new Date(today.getTime() - (rangeDays - 1) * 86_400_000).toISOString().slice(0, 10);
  const rangeEnd = today.toISOString().slice(0, 10);

  const refreshExchangeRates = useCallback(async () => {
    setRateSource("기준 환율 확인 중");
    try {
      const response = await fetch("/api/exchange-rates", { cache: "no-store" });
      if (!response.ok) throw new Error("exchange-rate request failed");
      const payload = await response.json() as { source: string; asOf: string; rates: typeof initialExchangeRates };
      setExchangeRates(payload.rates);
      setRateUpdatedAt(payload.asOf);
      setRateSource(`${payload.source} · 일일 기준`);
    } catch {
      setRateSource("연결 실패 · 화면 기준값 유지");
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refreshExchangeRates(), 0);
    const interval = window.setInterval(() => void refreshExchangeRates(), 3_600_000);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [refreshExchangeRates]);

  return (
    <div className="page-stack">
      <section className="daily-briefing">
        <div className="briefing-copy"><span>{currentDate}</span><h2>{operationsAvailable ? <>현재 처리할 업무가 <b>{totalTasks}건</b> 있습니다.</> : <>오늘 할 일을 <b>확인하고 있습니다.</b></>}</h2><p>주문·재고·고객 문의·상품 등록 결과를 기준으로 정리했습니다.</p></div>
        <div className="briefing-tasks">
          <button onClick={() => onNavigate("orders")}><span className="task-tone order" /><small>통합 주문</small><b>{operationsAvailable ? summary.orderCount : "—"}</b><em>주문 관리</em></button>
          <button onClick={() => onNavigate("orders")}><span className="task-tone shipping" /><small>출고 대기</small><b>{operationsAvailable ? summary.readyToShipCount : "—"}</b><em>배송 준비</em></button>
          <button onClick={() => onNavigate("cs")}><span className="task-tone claim" /><small>답변 대기</small><b>{operationsAvailable ? summary.openTicketCount : "—"}</b><em>고객 문의</em></button>
          <button onClick={() => onNavigate("publishing")}><span className="task-tone error" /><small>등록 확인</small><b>{operationsAvailable ? summary.registrationErrorCount : "—"}</b><em>확인 필요</em></button>
        </div>
        <aside className="briefing-settlement"><span>연결된 판매 채널</span><strong>{operationsAvailable ? `${summary.activeCredentialCount} / 7` : "확인 중"}</strong><small>상품과 주문을 불러올 수 있는 채널</small><button onClick={() => onNavigate("credentials")}>채널 연결<ChevronRight size={14} /></button></aside>
      </section>
      <section className="overview-toolbar">
        <article className="exchange-widget" aria-label="현재 환율">
          <div className="exchange-title"><span><i />기준 환율</span><small>KRW 기준 · {rateUpdatedAt}</small><small>{rateSource}</small></div>
          <div className="exchange-rate-list">{exchangeRates.map((rate) => <div className="exchange-rate" key={rate.code}><small>{rate.code} {rate.unit}</small><strong>₩{rate.value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><em className={rate.change >= 0 ? "up" : "down"}>{rate.change >= 0 ? "▲" : "▼"} {Math.abs(rate.change).toFixed(2)}%</em></div>)}</div>
          <button type="button" className="exchange-refresh" aria-label="환율 새로고침" title="환율 새로고침" onClick={refreshExchangeRates}><RefreshCw size={14} /></button>
        </article>
        <div className="overview-date-actions"><div className="period-control"><CalendarDays size={15} /><button>{rangeStart}</button><span>—</span><button>{rangeEnd}</button></div><div className="segmented-control">{["7일", "30일", "90일"].map((item) => <button className={period === item ? "active" : ""} key={item} onClick={() => setPeriod(item)}>{item}</button>)}</div></div>
      </section>

      <section className="metric-grid">
        <MetricCard label="30일 매출" value={operationsAvailable ? formatCompactWon(summary.revenue30dKrw) : "—"} detail="판매 상품 매출 합계" icon={CircleDollarSign} tone="violet" />
        <MetricCard label="주문" value={operationsAvailable ? summary.orderCount.toLocaleString() : "—"} detail={`결제완료 ${summary.paidOrderCount} · 출고대기 ${summary.readyToShipCount}`} icon={ShoppingBag} tone="blue" />
        <MetricCard label="관리 상품" value={operationsAvailable ? summary.productCount.toLocaleString() : "—"} detail={`최근 30일 ${summary.sold30d.toLocaleString()}개 판매`} icon={PackageCheck} tone="green" />
        <MetricCard label="답변 대기 문의" value={operationsAvailable ? summary.openTicketCount.toLocaleString() : "—"} detail={`재고주의 ${summary.lowStockCount}건`} icon={MessageCircleMore} tone="orange" />
      </section>

      <section className="dashboard-main-grid">
        <article className="panel revenue-panel">
          <div className="panel-heading"><div><span className="panel-kicker">매출 현황</span><h3>채널별 최근 30일 매출</h3></div><button className="ghost-button" onClick={() => onNavigate("products")}>상품 보기<ChevronRight size={15} /></button></div>
          <div className="live-channel-bars">{activeMetrics.map((channel) => <button key={channel.channelKey} onClick={() => onNavigate(channel.channelKey as View)}><span><i style={{ background: channel.color }} />{channel.name}</span><b>{formatCompactWon(channel.revenue30dKrw)}</b><em>{channel.orderCount.toLocaleString()}건</em><small><i style={{ width: `${Math.round((channel.revenue30dKrw / maxChannelRevenue) * 100)}%`, background: channel.color }} /></small></button>)}</div>
        </article>

        <article className="panel top-ranking-card">
          <div className="panel-heading"><div><span className="panel-kicker">최근 30일 판매량 기준</span><h3>이번 달 판매 TOP 10</h3></div><span className="rank-crown">1–10</span></div>
          <div className="monthly-ranking-list">
            {monthlyTopProducts.map((product, index) => <button className={`ranking-row ${index < 3 ? "podium" : ""}`} key={product.id} onClick={() => onNavigate("products")}>
              <span className="ranking-number">{index + 1}</span>
              <span className="ranking-thumb"><ProductVisual src={product.image} size="38px" /></span>
              <span className="ranking-product"><b>{product.name}</b><small>{product.channels.length}개 채널 판매중</small></span>
              <span className="ranking-channels">{product.channels.slice(0, 3).map((code) => <ChannelMark key={code} code={code} size="sm" />)}{product.channels.length > 3 && <em>+{product.channels.length - 3}</em>}</span>
              <span className="ranking-sales"><b>{product.sales.toLocaleString()}개</b><small>{product.revenue}</small></span>
            </button>)}
            {monthlyTopProducts.length === 0 && <div className="live-empty-state"><PackageSearch size={26} /><b>판매 상품이 아직 없습니다.</b><small>판매 채널을 연결하고 상품을 등록하면 순위가 표시됩니다.</small></div>}
          </div>
          <button className="full-ghost-button" onClick={() => onNavigate("products")}>전체 상품 성과 보기<ArrowRight size={15} /></button>
        </article>
      </section>

      <section className="dashboard-lower-grid">
        <article className="panel channel-performance">
          <div className="panel-heading"><div><span className="panel-kicker">판매 채널</span><h3>채널별 판매 현황</h3></div><span className="live-label"><i />최신</span></div>
          <div className="channel-list">
            {activeMetrics.map((channel) => <button className="channel-row" key={channel.channelKey} onClick={() => onNavigate(channel.channelKey as View)}><ChannelMark code={channel.channelCode} /><div className="channel-name"><strong>{channel.name}</strong><span className={channel.credentialStatus === "active" ? "connected" : ""}><i />{channel.credentialStatus === "active" ? "연결됨" : "채널 연결 필요"}</span></div><div className="channel-metric"><small>30일 매출</small><b>{formatCompactWon(channel.revenue30dKrw)}</b></div><div className="channel-metric"><small>주문</small><b>{channel.orderCount.toLocaleString()}</b></div><div className="channel-progress"><span><i style={{ width: `${channel.credentialStatus === "active" ? 100 : 0}%` }} /></span><b>{channel.failedAttemptCount ? `확인 ${channel.failedAttemptCount}` : "정상"}</b></div><ChevronRight size={16} /></button>)}
          </div>
        </article>

        <article className="panel automation-status">
          <div className="panel-heading"><div><span className="panel-kicker">오늘 자동 등록 작업</span><h3>상품 등록 현황</h3></div><button className="ghost-button" onClick={() => onNavigate("publishing")}>전체 보기<ChevronRight size={15} /></button></div>
          <div className="pipeline-summary"><div><strong>{totalListings}</strong><span>전체 등록 처리</span></div><i /><div><strong>{successRate.toFixed(1)}%</strong><span>등록 성공률</span></div></div>
          <div className="pipeline-list">
            {[{ label: "AI 분석 중", value: livePipeline.aiRunning, tone: "violet", icon: WandSparkles }, { label: "채널 등록 대기", value: livePipeline.listingQueued, tone: "blue", icon: Upload }, { label: "등록 완료", value: livePipeline.listingPublished, tone: "green", icon: CheckCircle2 }, { label: "확인 필요", value: livePipeline.listingFailed, tone: "red", icon: AlertCircle }].map((item) => <div key={item.label}><span className={`pipeline-icon ${item.tone}`}><item.icon size={16} /></span><span>{item.label}</span><strong>{item.value}<small>건</small></strong></div>)}
          </div>
        </article>
      </section>

      <section className="dashboard-bottom-grid">
        <article className="panel alert-panel">
          <div className="panel-heading"><div><span className="panel-kicker">우선 처리 필요</span><h3>지금 확인할 항목</h3></div><span className="count-chip">{summary.lowStockCount + summary.registrationErrorCount + summary.openTicketCount}</span></div>
          <div className="alert-list">
            <button onClick={() => onNavigate("products")}><span className="alert-icon danger"><Box size={16} /></span><span><b>재고주의 상품 {summary.lowStockCount}건</b><small>현재 재고와 재주문 기준으로 집계했습니다.</small></span><em>상품 보기<ChevronRight size={14} /></em></button>
            <button onClick={() => onNavigate("publishing")}><span className="alert-icon warning"><AlertCircle size={16} /></span><span><b>등록 확인 필요 {summary.registrationErrorCount}건</b><small>카테고리와 필수 정보를 확인해 주세요.</small></span><em>확인하기<ChevronRight size={14} /></em></button>
            <button onClick={() => onNavigate("cs")}><span className="alert-icon blue"><MessageCircleMore size={16} /></span><span><b>답변 대기 문의 {summary.openTicketCount}건</b><small>판매 채널에서 새로 받은 문의입니다.</small></span><em>답변하기<ChevronRight size={14} /></em></button>
          </div>
        </article>
        <article className="panel quick-actions">
          <div className="panel-heading"><div><span className="panel-kicker">자주 쓰는 메뉴</span><h3>빠른 실행</h3></div></div>
          <div className="quick-action-grid"><button onClick={() => onNavigate("publishing")}><span><ImagePlus size={19} /></span><b>새 상품 등록</b><small>사진으로 시작</small></button><button onClick={() => onNavigate("orders")}><span><Truck size={19} /></span><b>출고 처리</b><small>대기 {summary.readyToShipCount}건</small></button><button onClick={() => onNavigate("cs")}><span><Bot size={19} /></span><b>AI 답변</b><small>대기 {summary.openTicketCount}건</small></button></div>
        </article>
      </section>
    </div>
  );
}

function ProductsPage({ onNavigate, onOpenProduct, displayProducts }: { onNavigate: (view: View) => void; onOpenProduct: (product: DisplayProduct) => void; displayProducts: DisplayProduct[] }) {
  const [query, setQuery] = useState("");
  const filtered = displayProducts.filter((product) => product.name.toLowerCase().includes(query.toLowerCase()) || product.sku.toLowerCase().includes(query.toLowerCase()));
  const activeCount = displayProducts.filter((product) => product.status === "판매중").length;
  const lowStockCount = displayProducts.filter((product) => product.status === "재고주의").length;
  const outOfStockCount = displayProducts.filter((product) => product.status === "품절").length;
  return (
    <div className="page-stack">
      <section className="summary-strip"><div><Package size={18} /><span>전체 상품<strong>{displayProducts.length}</strong></span></div><div><CheckCircle2 size={18} /><span>정상 판매<strong>{activeCount}</strong></span></div><div><AlertCircle size={18} /><span>재고 주의<strong>{lowStockCount}</strong></span></div><div><Box size={18} /><span>품절<strong>{outOfStockCount}</strong></span></div><button className="primary-button" onClick={() => onNavigate("publishing")}><Plus size={16} />새 상품 등록</button></section>
      <section className="panel data-panel">
        <div className="data-toolbar"><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="상품명, SKU 검색" /></div><button className="filter-button" disabled><Filter size={15} />채널 필터<ChevronDown size={14} /></button><button className="filter-button" disabled><ListFilter size={15} />상태 필터<ChevronDown size={14} /></button><span className="toolbar-spacer" /><button className="icon-text-button" disabled title="판매 채널 연결 후 사용할 수 있습니다"><RefreshCw size={15} />정보 새로고침</button><button className="icon-only-button" aria-label="더보기" disabled><MoreHorizontal size={18} /></button></div>
        <div className="table-wrap"><table className="data-table product-table"><thead><tr><th><input type="checkbox" aria-label="전체 선택" /></th><th>상품</th><th>판매 채널 · 바로가기</th><th>재고</th><th>30일 판매</th><th>30일 매출</th><th>상태</th><th /></tr></thead><tbody>{filtered.map((product) => <tr key={product.id}><td><input type="checkbox" aria-label={`${product.name} 선택`} /></td><td><div className="product-cell"><div className="product-thumb"><ProductVisual src={product.image} size="52px" /></div><span><b>{product.name}</b><small>{product.sku} · {product.id}</small></span></div></td><td><div className="channel-listing-links">{product.listings.map((listing) => <ChannelListingLink key={`${listing.channelKey}-${listing.market}-${listing.targetId}-${listing.remoteId}`} listing={listing} productName={product.name} />)}{product.listings.length === 0 && product.channels.map((code) => { const channel = channelByCode.get(code); return <span className="channel-listing-pending" key={code}><ChannelMark code={code} size="sm" /><span><b>{channel?.name ?? code}</b><small>상품 주소 확인 중</small></span></span>; })}</div></td><td><strong className={product.stock < 20 ? "stock-low" : ""}>{product.stock}</strong><small> 개</small></td><td><b>{product.sales}</b><small> 개</small></td><td><b>{product.revenue}</b></td><td><StatusBadge status={product.status} /></td><td><button className="table-action" title="카테고리·채널 등록 준비 열기" aria-label={`${product.name} 등록 준비 열기`} onClick={() => onOpenProduct(product)}><ChevronRight size={17} /></button></td></tr>)}</tbody></table></div>
        {filtered.length === 0 && <div className="live-empty-state table-empty"><PackageSearch size={28} /><b>등록된 상품이 없습니다.</b><small>상품을 등록하면 이 목록에 표시됩니다.</small></div>}
        <div className="table-footer"><span>총 {displayProducts.length}개 중 1–{filtered.length}개 표시</span><div><button disabled><ChevronRight className="flip" size={15} /></button><button className="active">1</button><button disabled><ChevronRight size={15} /></button></div></div>
      </section>
    </div>
  );
}

type UploadedPhoto = { name: string; url: string; file: File; role: string; originalWidth: number; originalHeight: number };
type BatchProductItem = {
  id: string;
  mainPhoto: UploadedPhoto;
  photos: UploadedPhoto[];
  manualFields: ProductIntakeDraft;
  requestId: number;
  status: "ready" | "running" | "succeeded" | "failed";
  productId: string | null;
};

const optionalPhotoSlots = [
  { id: "front", label: "정면", guide: "제품 전체 정면" },
  { id: "back", label: "후면", guide: "뒷면 표시사항" },
  { id: "left", label: "좌측면", guide: "왼쪽 측면" },
  { id: "right", label: "우측면", guide: "오른쪽 측면" },
  { id: "top", label: "상단", guide: "상단 패키지" },
  { id: "bottom", label: "하단", guide: "하단 제조정보" },
  { id: "label", label: "성분 · 라벨", guide: "글자가 선명하게" },
  { id: "barcode", label: "바코드", guide: "숫자까지 보이게" },
] as const;

function PublishingPage({ notify, channelMetrics, pipeline, initialProduct }: { notify: (message: string) => void; channelMetrics: OperationsSnapshot["channelMetrics"]; pipeline: OperationsSnapshot["pipeline"] | null; initialProduct?: { id: string; name: string } | null }) {
  const [running, setRunning] = useState(false);
  const [recoveringRecentProducts, setRecoveringRecentProducts] = useState(false);
  const [mainPhoto, setMainPhoto] = useState<UploadedPhoto | null>(null);
  const [slotPhotos, setSlotPhotos] = useState<Record<string, UploadedPhoto>>({});
  const [extraPhotos, setExtraPhotos] = useState<UploadedPhoto[]>([]);
  const [intake, setIntake] = useState<ProductIntakeDraft>(() => ({ ...emptyProductIntake }));
  const [manualErrors, setManualErrors] = useState<Record<string, string>>({});
  const [uploadError, setUploadError] = useState("");
  const [mainPhotoUrl, setMainPhotoUrl] = useState("");
  const [importingMainPhoto, setImportingMainPhoto] = useState(false);
  const [studioRequestId, setStudioRequestId] = useState(0);
  const [analyzedProductName, setAnalyzedProductName] = useState(initialProduct?.name ?? "");
  const [analyzedProductId, setAnalyzedProductId] = useState<string | null>(initialProduct?.id ?? null);
  const [categoryDraftRef] = useState(() => crypto.randomUUID());
  const [publishRefreshVersion, setPublishRefreshVersion] = useState(0);
  const [channelSelection, setChannelSelection] = useState<Record<string, boolean>>({});
  const [batchItems, setBatchItems] = useState<BatchProductItem[]>([]);
  const connectedChannelKeys = useMemo(() => channelMetrics
    .filter((metric) => metric.credentialStatus === "active" && activeChannelKeys.includes(metric.channelKey as (typeof activeChannelKeys)[number]))
    .map((metric) => metric.channelKey), [channelMetrics]);
  const selectedChannels = useMemo(() => connectedChannelKeys.filter((key) => channelSelection[key] !== false), [channelSelection, connectedChannelKeys]);

  const recoverRecentProducts = useCallback(async () => {
    if (recoveringRecentProducts) return;
    setRecoveringRecentProducts(true);
    try {
      const { data } = await createSupabaseClient().auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error("완료된 상품을 불러오려면 다시 로그인해 주세요.");

      const jobsResponse = await fetch("/api/admin/ai-jobs?limit=100", {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const jobsPayload = await jobsResponse.json().catch(() => ({ jobs: [], message: "완료 작업을 확인하지 못했습니다." })) as {
        jobs?: Array<{ id: string; status: string; created_at: string }>;
        message?: string;
      };
      if (!jobsResponse.ok) throw new Error(jobsPayload.message ?? "완료 작업을 확인하지 못했습니다.");

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const jobs = (jobsPayload.jobs ?? []).filter((job) => job.status === "succeeded" && new Date(job.created_at).getTime() >= today.getTime());
      if (!jobs.length) {
        notify("오늘 완료된 상품이 아직 없습니다.");
        return;
      }

      const recoveredIds: string[] = [];
      for (const job of jobs) {
        const productResponse = await fetch("/api/operations/snapshot", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ action: "product_create", jobId: job.id }),
        });
        const productPayload = await productResponse.json().catch(() => ({})) as { id?: string | null; message?: string };
        if (!productResponse.ok || typeof productPayload.id !== "string") {
          throw new Error(productPayload.message ?? "완료된 상품 일부를 목록에 연결하지 못했습니다.");
        }
        recoveredIds.push(productPayload.id);
      }

      const latestProductId = recoveredIds.at(0) ?? null;
      if (latestProductId) {
        setAnalyzedProductName("");
        setAnalyzedProductId(latestProductId);
        setPublishRefreshVersion((current) => current + 1);
      }
      notify(`오늘 완료된 상품 ${recoveredIds.length}개를 목록에 연결했습니다.`);
    } catch (error) {
      notify(userFacingErrorMessage(error, "완료된 상품을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."));
    } finally {
      setRecoveringRecentProducts(false);
    }
  }, [notify, recoveringRecentProducts]);

  const setIntakeField = <Key extends keyof ProductIntakeDraft>(key: Key, value: ProductIntakeDraft[Key]) => {
    setIntake((current) => ({ ...current, [key]: value }));
    setManualErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const toPhoto = async (file: File, role: string): Promise<UploadedPhoto> => {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("JPG, PNG, WEBP 이미지만 등록할 수 있습니다.");
    if (file.size > 20 * 1024 * 1024) throw new Error("원본 이미지는 20MB 이하로 등록해 주세요.");
    const url = URL.createObjectURL(file);
    try {
      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new window.Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
        image.src = url;
      });
      if (dimensions.width < 600 || dimensions.height < 600) throw new Error("이미지는 최소 600×600px 이상이어야 합니다.");
      return { name: file.name, url, file, role, originalWidth: dimensions.width, originalHeight: dimensions.height };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  };

  const selectMainPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    try {
      const photo = await toPhoto(file, "main");
      if (mainPhoto) URL.revokeObjectURL(mainPhoto.url);
      setMainPhoto(photo);
      setUploadError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "대표사진을 확인해 주세요.";
      setUploadError(message);
      notify(message);
    }
  };

  const importMainPhotoFromUrl = async () => {
    if (importingMainPhoto) return;
    try {
      const url = new URL(mainPhotoUrl.trim(), window.location.href);
      if (!/^https?:$/.test(url.protocol)) throw new Error("http:// 또는 https:// 공개 이미지 URL을 입력해 주세요.");
      setImportingMainPhoto(true);
      const { data: sessionData } = await createSupabaseClient().auth.getSession();
      const response = await fetch("/api/images/import", {
        method: "POST",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${sessionData.session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ url: url.toString() }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { message?: string } | null;
        throw new Error(payload?.message || "이미지를 가져오지 못했습니다.");
      }
      const blob = await response.blob();
      const contentType = blob.type.split(";")[0].toLowerCase();
      if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new Error("URL이 JPG, PNG, WEBP 이미지를 가리키는지 확인해 주세요.");
      if (blob.size > 20 * 1024 * 1024) throw new Error("원본 이미지는 20MB 이하로 등록해 주세요.");
      const pathnameName = decodeURIComponent(url.pathname.split("/").pop() || "product-image").replace(/[^a-zA-Z0-9._-]+/g, "-");
      const extension = contentType === "image/png" ? ".png" : contentType === "image/webp" ? ".webp" : ".jpg";
      const fileName = /\.(?:jpe?g|png|webp)$/i.test(pathnameName) ? pathnameName : `${pathnameName}${extension}`;
      const photo = await toPhoto(new File([blob], fileName, { type: contentType }), "main");
      if (mainPhoto) URL.revokeObjectURL(mainPhoto.url);
      setMainPhoto(photo);
      setUploadError("");
      notify("공개 이미지 URL을 대표사진으로 불러왔습니다.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "공개 이미지 URL을 확인해 주세요.";
      setUploadError(message);
      notify(message);
    } finally {
      setImportingMainPhoto(false);
    }
  };

  const selectSlotPhoto = async (slotId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    try {
      const photo = await toPhoto(file, slotId);
      setSlotPhotos((current) => {
        if (current[slotId]) URL.revokeObjectURL(current[slotId].url);
        return { ...current, [slotId]: photo };
      });
      setUploadError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "옵션 사진을 확인해 주세요.";
      setUploadError(message);
      notify(message);
    }
  };

  const selectExtraPhotos = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    event.target.value = "";
    const remaining = Math.max(0, 100 - ((mainPhoto ? 1 : 0) + Object.keys(slotPhotos).length + extraPhotos.length));
    if (!remaining) return notify("한 상품은 분석용 사진을 최대 100장까지 등록할 수 있습니다.");
    const selected = files.slice(0, remaining);
    const settled = await Promise.allSettled(selected.map((file, index) => toPhoto(file, `extra-${extraPhotos.length + index + 1}`)));
    const accepted = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const firstFailure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (accepted.length) setExtraPhotos((current) => [...current, ...accepted]);
    if (firstFailure) {
      const message = firstFailure.reason instanceof Error ? firstFailure.reason.message : "일부 추가 사진을 확인해 주세요.";
      setUploadError(message);
      notify(`${accepted.length}장 등록 · ${message}`);
    }
  };

  const removeSlotPhoto = (slotId: string) => {
    setSlotPhotos((current) => {
      const next = { ...current };
      if (next[slotId]) URL.revokeObjectURL(next[slotId].url);
      delete next[slotId];
      return next;
    });
  };

  const removeExtraPhoto = (index: number) => {
    setExtraPhotos((current) => {
      URL.revokeObjectURL(current[index].url);
      return current.filter((_, photoIndex) => photoIndex !== index);
    });
  };

  const openProductUrl = () => {
    try {
      const url = new URL(intake.productUrl);
      if (!url.protocol.startsWith("http")) throw new Error("invalid protocol");
      window.open(url.toString(), "_blank", "noopener,noreferrer");
    } catch {
      notify("http:// 또는 https://로 시작하는 상품 링크를 입력해 주세요.");
    }
  };

  const startAutomation = () => {
    const parsed = productIntakeSchema.safeParse(intake);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = String(issue.path[0] ?? "form");
        if (!errors[field]) errors[field] = issue.message;
      }
      setManualErrors(errors);
      const message = parsed.error.issues[0]?.message ?? "필수 상품 정보를 확인해 주세요.";
      setUploadError(message);
      notify(message);
      return;
    }
    if (!mainPhoto) {
      setUploadError("AI 상품 분석을 시작하려면 대표사진 1장이 반드시 필요합니다.");
      notify("대표사진 1장을 먼저 등록해 주세요.");
      return;
    }
    const photoCount = 1 + Object.keys(slotPhotos).length + extraPhotos.length;
    setRunning(true);
    setUploadError("");
    notify(`${photoCount}장을 1200×1200 공통 규격으로 보정하고 필수 상품 정보와 함께 AI 분석에 반영합니다.`);
    setStudioRequestId((current) => current + 1);
  };

  const addCurrentProductToBatch = () => {
    const parsed = productIntakeSchema.safeParse(intake);
    if (!parsed.success || !mainPhoto) {
      startAutomation();
      return;
    }
    if (batchItems.length >= 8) {
      notify("동시 처리 대기열은 최대 8개 상품까지 담을 수 있습니다.");
      return;
    }
    if (batchItems.some((item) => item.manualFields.sellerSku === parsed.data.sellerSku)) {
      notify("동시 처리 대기열에 같은 판매자 SKU가 이미 있습니다.");
      return;
    }
    const photos = [mainPhoto, ...Object.values(slotPhotos), ...extraPhotos];
    setBatchItems((current) => [...current, {
      id: crypto.randomUUID(),
      mainPhoto,
      photos,
      manualFields: { ...intake },
      requestId: 0,
      status: "ready",
      productId: null,
    }]);
    setMainPhoto(null);
    setSlotPhotos({});
    setExtraPhotos([]);
    setIntake({ ...emptyProductIntake });
    setMainPhotoUrl("");
    setManualErrors({});
    setUploadError("");
    notify(`${parsed.data.productName}을 동시 처리 대기열에 담았습니다. ${batchItems.length + 1} / 8`);
  };

  const removeBatchItem = (id: string) => {
    setBatchItems((current) => {
      const target = current.find((item) => item.id === id);
      if (target) for (const url of new Set(target.photos.map((photo) => photo.url))) URL.revokeObjectURL(url);
      return current.filter((item) => item.id !== id);
    });
  };

  const startBatchAutomation = () => {
    const readyCount = batchItems.filter((item) => item.status === "ready" || item.status === "failed").length;
    if (!readyCount) {
      notify("함께 처리할 상품이 없습니다.");
      return;
    }
    const marker = Date.now();
    setBatchItems((current) => current.map((item, index) => item.status === "ready" || item.status === "failed"
      ? { ...item, requestId: marker + index, status: "running" }
      : item));
    notify(`${readyCount}개 상품을 동시에 분석 대기열에 등록했습니다. 최대 8개가 병렬 처리됩니다.`);
  };

  const totalPhotoCount = (mainPhoto ? 1 : 0) + Object.keys(slotPhotos).length + extraPhotos.length;
  const intakeReady = productIntakeSchema.safeParse(intake).success;
  const intakeCompletionItems = [
    Boolean(mainPhoto),
    intake.productName.trim().length >= 2,
    intake.sellerSku.trim().length >= 2,
    intake.categoryHint.trim().length >= 2,
    Boolean(intake.brandName.trim()),
    Boolean(intake.manufacturer.trim()),
    intake.countryOfOrigin.trim().length >= 2,
    intake.material.trim().length >= 2,
    intake.packageContents.trim().length >= 2,
    intake.sellingPrice > 0,
    intake.stock > 0,
    intake.weightKg > 0,
    intake.packageLengthCm > 0 && intake.packageWidthCm > 0 && intake.packageHeightCm > 0,
    intake.description.trim().length >= 20,
    /^https?:\/\//i.test(intake.productUrl.trim()),
    intake.imageRightsConfirmed,
    intake.productFactsConfirmed,
  ];
  const intakeCompletedCount = intakeCompletionItems.filter(Boolean).length;
  const intakeProgress = Math.round((intakeCompletedCount / intakeCompletionItems.length) * 100);
  const uploadChannelEntries = activeChannelKeys.map((key) => [key, channels[key]] as const);
  const connectedChannelEntries = uploadChannelEntries.filter(([key]) => connectedChannelKeys.includes(key));
  const unavailableChannelEntries = uploadChannelEntries.filter(([key]) => !connectedChannelKeys.includes(key));

  return (
    <div className="page-stack publishing-page">
      <section className="publishing-workflow-header">
        <div className="publishing-workflow-copy"><span className="eyebrow dark"><Sparkles size={14} /> 상품 등록 순서</span><h2>상품 하나를 완성하고, 최대 8개까지 함께 준비하세요.</h2><p>대표사진과 상품 정보를 먼저 확인하면 AI 분석·카테고리 선택·채널 등록이 순서대로 이어집니다.</p></div>
        <ol className="publishing-steps" aria-label="상품 등록 단계">
          <li className="active"><span>1</span><b>자료 입력</b><small>{intakeProgress}% 완료</small></li>
          <li><span>2</span><b>AI 분석</b><small>이미지·사실 검증</small></li>
          <li><span>3</span><b>채널 등록</b><small>{selectedChannels.length}개 채널 선택</small></li>
        </ol>
      </section>
      <section className="publishing-layout">
        <article className="panel upload-panel">
          <div className="panel-heading"><div><span className="panel-kicker">1단계</span><h3>새 상품 정보</h3></div><span className="step-chip">1 / 3</span></div>

          <section className="main-photo-section">
            <div className="upload-section-heading"><div><b>대표사진</b><span className="required-chip">필수</span><small>검색 결과와 채널 목록에서 가장 먼저 보이는 이미지입니다.</small></div><em>{mainPhoto ? "1장 등록됨" : "미등록"}</em></div>
            <label className={`drop-zone main-drop-zone ${mainPhoto ? "has-photo" : ""} ${running ? "running" : ""}`} htmlFor="main-product-photo">
              <input id="main-product-photo" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectMainPhoto} />
              {mainPhoto ? <><span className="main-photo-preview"><Image src={mainPhoto.url} alt="등록한 대표 상품 사진" fill sizes="700px" unoptimized /></span><span className="photo-preview-overlay"><ImagePlus size={17} />대표사진 교체</span><strong className="photo-file-name">{mainPhoto.name} · {mainPhoto.originalWidth}×{mainPhoto.originalHeight} → 1200×1200</strong></> : <><span className="upload-graphic"><CloudUpload size={31} /></span><strong>대표 상품 사진을 넣으세요</strong><p>JPG, PNG, WEBP · 최소 600×600px · 자동 1:1 여백 보정</p><em><ImagePlus size={15} />대표사진 선택</em></>}
              {running && <span className="analysis-overlay"><LoaderCircle className="spin" size={29} /><b>사진과 상품 정보를 분석하는 중</b><small>사진 속 글자와 입력한 정보를 함께 확인하고 있습니다.</small><i><span /></i></span>}
            </label>
            <div className="main-photo-url-import">
              <Link2 size={16} />
              <input type="url" value={mainPhotoUrl} onChange={(event) => setMainPhotoUrl(event.target.value)} placeholder="https:// 공개 이미지 URL" aria-label="공개 이미지 URL" />
              <button type="button" onClick={() => void importMainPhotoFromUrl()} disabled={!mainPhotoUrl.trim() || importingMainPhoto || running}>
                {importingMainPhoto ? <LoaderCircle className="spin" size={15} /> : <ImagePlus size={15} />}
                {importingMainPhoto ? "불러오는 중" : "URL로 불러오기"}
              </button>
            </div>
            <small className="main-photo-url-help">로그인 없이 열리는 JPG, PNG, WEBP URL을 기존 대표사진 규격으로 검사합니다.</small>
            {uploadError && <p className="upload-error"><AlertCircle size={14} />{uploadError}</p>}
          </section>

          <section className="option-photo-section">
            <div className="upload-section-heading"><div><b>옵션 사진</b><span className="optional-chip">선택</span><small>각도와 표시사항이 많을수록 분석 정확도가 높아집니다.</small></div><em>{Object.keys(slotPhotos).length} / {optionalPhotoSlots.length}장</em></div>
            <div className="option-photo-grid">
              {optionalPhotoSlots.map((slot) => {
                const photo = slotPhotos[slot.id];
                return <div className={`option-slot-wrap ${photo ? "has-photo" : ""}`} key={slot.id}><label className="option-photo-slot" htmlFor={`option-photo-${slot.id}`}><input id={`option-photo-${slot.id}`} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectSlotPhoto(slot.id, event)} />{photo ? <><Image src={photo.url} alt={`${slot.label} 상품 사진`} fill sizes="180px" unoptimized /><span className="slot-photo-label"><b>{slot.label}</b><small>{photo.originalWidth}×{photo.originalHeight} · 교체</small></span></> : <><span><ImagePlus size={18} /></span><b>{slot.label}</b><small>{slot.guide}</small></>}</label>{photo && <button type="button" className="remove-photo-button" aria-label={`${slot.label} 사진 삭제`} onClick={() => removeSlotPhoto(slot.id)}><Trash2 size={13} /></button>}</div>;
              })}
            </div>
          </section>

          <section className="extra-photo-section">
            <div className="upload-section-heading"><div><b>추가 사진</b><span className="optional-chip">여러 장</span><small>상세컷, 구성품, 포장 상태 등 필요한 만큼 한 번에 선택할 수 있습니다.</small></div><em>{extraPhotos.length}장 추가됨</em></div>
            <label className="extra-photo-uploader" htmlFor="extra-product-photos"><input id="extra-product-photos" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void selectExtraPhotos(event)} /><Plus size={17} /><span><b>추가 사진 더 넣기</b><small>분석용 최대 100장 · 채널 등록은 앞 8~9장 자동 선별</small></span></label>
            {extraPhotos.length > 0 && <div className="extra-photo-list">{extraPhotos.map((photo, index) => <div key={`${photo.name}-${index}`}><span><Image src={photo.url} alt={`추가 상품 사진 ${index + 1}`} fill sizes="100px" unoptimized /></span><small>{index + 1}</small><button type="button" aria-label={`추가 사진 ${index + 1} 삭제`} onClick={() => removeExtraPhoto(index)}><X size={12} /></button></div>)}</div>}
          </section>

          <section className="product-context-section required-product-intake">
            <div className="upload-section-heading"><div><b>판매자 필수 입력</b><span className="required-chip">전부 필수</span><small>AI가 추측하면 안 되는 실물·포장·책임 정보입니다. 사진과 함께 입력해야 다음 단계로 갈 수 있습니다.</small></div><em>{intakeReady ? "입력 완료" : "확인 필요"}</em></div>
            <div className="manual-field-grid">
              <div className="intake-group-heading"><span>01</span><div><b>기본 상품 정보</b><small>상품을 식별하고 채널 카테고리를 찾는 기준입니다.</small></div></div>
              <label className={manualErrors.productName ? "field-error" : ""}><span>상품명 <i>필수</i></span><input required value={intake.productName} maxLength={160} onChange={(event) => setIntakeField("productName", event.target.value)} placeholder="실물과 일치하는 상품명" />{manualErrors.productName && <small>{manualErrors.productName}</small>}</label>
              <label className={manualErrors.sellerSku ? "field-error" : ""}><span>상품 관리 코드(SKU) <i>필수</i></span><input required value={intake.sellerSku} maxLength={100} onChange={(event) => setIntakeField("sellerSku", event.target.value.toUpperCase())} placeholder="예: MUG-001" />{manualErrors.sellerSku && <small>{manualErrors.sellerSku}</small>}</label>
              <label className={manualErrors.categoryHint ? "field-error" : ""}><span>상품 종류 <i>필수</i></span><input required value={intake.categoryHint} maxLength={120} onChange={(event) => setIntakeField("categoryHint", event.target.value)} placeholder="예: 카페 머그컵" />{manualErrors.categoryHint && <small>{manualErrors.categoryHint}</small>}</label>
              <label className={manualErrors.brandName ? "field-error" : ""}><span>브랜드 <i>필수</i></span><input required value={intake.brandName} maxLength={120} onChange={(event) => setIntakeField("brandName", event.target.value)} placeholder="없으면 No Brand" />{manualErrors.brandName && <small>{manualErrors.brandName}</small>}</label>
              <label className={manualErrors.manufacturer ? "field-error" : ""}><span>제조사·공급처 <i>필수</i></span><input required value={intake.manufacturer} maxLength={160} onChange={(event) => setIntakeField("manufacturer", event.target.value)} placeholder="직접 제조 또는 공급처명" />{manualErrors.manufacturer && <small>{manualErrors.manufacturer}</small>}</label>
              <label className={manualErrors.countryOfOrigin ? "field-error" : ""}><span>원산지 <i>필수</i></span><input required value={intake.countryOfOrigin} maxLength={80} onChange={(event) => setIntakeField("countryOfOrigin", event.target.value)} placeholder="예: 대한민국" />{manualErrors.countryOfOrigin && <small>{manualErrors.countryOfOrigin}</small>}</label>
              <div className="intake-group-heading"><span>02</span><div><b>구성·표시 정보</b><small>라벨과 실물 기준으로 소재, 구성품, 바코드를 확인합니다.</small></div></div>
              <label className={manualErrors.material ? "field-error" : ""}><span>소재·성분 <i>필수</i></span><input required value={intake.material} maxLength={500} onChange={(event) => setIntakeField("material", event.target.value)} placeholder="예: 도자기 100%" />{manualErrors.material && <small>{manualErrors.material}</small>}</label>
              <label className={manualErrors.packageContents ? "field-error" : ""}><span>판매 구성 <i>필수</i></span><input required value={intake.packageContents} maxLength={500} onChange={(event) => setIntakeField("packageContents", event.target.value)} placeholder="예: 머그컵 1개" />{manualErrors.packageContents && <small>{manualErrors.packageContents}</small>}</label>
              <label><span>상품 상태 <i>필수</i></span><select value={intake.condition} onChange={(event) => setIntakeField("condition", event.target.value as ProductIntakeDraft["condition"])}>{productConditions.map((value) => <option value={value} key={value}>{value === "NEW" ? "신품" : value === "USED" ? "중고" : "리퍼브"}</option>)}</select></label>
              <label><span>바코드 상태 <i>필수</i></span><select value={intake.gtinStatus} onChange={(event) => setIntakeField("gtinStatus", event.target.value as ProductIntakeDraft["gtinStatus"])}><option value="NO_GTIN">GTIN 없음</option><option value="HAS_GTIN">GTIN 있음</option></select></label>
              {intake.gtinStatus === "HAS_GTIN" && <label className={manualErrors.gtin ? "field-error" : ""}><span>GTIN / EAN / UPC <i>필수</i></span><input inputMode="numeric" required value={intake.gtin} maxLength={14} onChange={(event) => setIntakeField("gtin", event.target.value.replace(/\D/g, ""))} placeholder="8~14자리 숫자" />{manualErrors.gtin && <small>{manualErrors.gtin}</small>}</label>}
              <div className="intake-group-heading"><span>03</span><div><b>판매·재고</b><small>기준 통화의 판매가와 실제 가용 재고를 입력합니다.</small></div></div>
              <label className={manualErrors.sellingPrice ? "field-error" : ""}><span>판매가 <i>필수</i></span><input type="number" required min="0.01" step="0.01" value={intake.sellingPrice || ""} onChange={(event) => setIntakeField("sellingPrice", Number(event.target.value))} placeholder="0" />{manualErrors.sellingPrice && <small>{manualErrors.sellingPrice}</small>}</label>
              <label><span>통화 <i>필수</i></span><select value={intake.currency} onChange={(event) => setIntakeField("currency", event.target.value as ProductIntakeDraft["currency"])}>{productCurrencies.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
              <label className={manualErrors.stock ? "field-error" : ""}><span>재고 <i>필수</i></span><input type="number" required min="1" step="1" value={intake.stock || ""} onChange={(event) => setIntakeField("stock", Number(event.target.value))} placeholder="1" />{manualErrors.stock && <small>{manualErrors.stock}</small>}</label>
              <div className="intake-group-heading"><span>04</span><div><b>포장·배송 규격</b><small>운임 계산과 채널 배송 제한 검증에 사용합니다.</small></div></div>
              <label className={manualErrors.weightKg ? "field-error" : ""}><span>포장 중량 kg <i>필수</i></span><input type="number" required min="0.01" step="0.01" value={intake.weightKg || ""} onChange={(event) => setIntakeField("weightKg", Number(event.target.value))} placeholder="0.35" />{manualErrors.weightKg && <small>{manualErrors.weightKg}</small>}</label>
              <label className={manualErrors.packageLengthCm ? "field-error" : ""}><span>포장 가로 cm <i>필수</i></span><input type="number" required min="0.1" step="0.1" value={intake.packageLengthCm || ""} onChange={(event) => setIntakeField("packageLengthCm", Number(event.target.value))} placeholder="12" />{manualErrors.packageLengthCm && <small>{manualErrors.packageLengthCm}</small>}</label>
              <label className={manualErrors.packageWidthCm ? "field-error" : ""}><span>포장 세로 cm <i>필수</i></span><input type="number" required min="0.1" step="0.1" value={intake.packageWidthCm || ""} onChange={(event) => setIntakeField("packageWidthCm", Number(event.target.value))} placeholder="12" />{manualErrors.packageWidthCm && <small>{manualErrors.packageWidthCm}</small>}</label>
              <label className={manualErrors.packageHeightCm ? "field-error" : ""}><span>포장 높이 cm <i>필수</i></span><input type="number" required min="0.1" step="0.1" value={intake.packageHeightCm || ""} onChange={(event) => setIntakeField("packageHeightCm", Number(event.target.value))} placeholder="10" />{manualErrors.packageHeightCm && <small>{manualErrors.packageHeightCm}</small>}</label>
            </div>
            <label className={`context-field ${manualErrors.description ? "field-error" : ""}`}><span>상품 사실 설명 <i>필수</i></span><textarea required value={intake.description} onChange={(event) => setIntakeField("description", event.target.value)} maxLength={4000} placeholder="용도, 재질, 구성, 핵심 특징, 주의사항을 실물 기준으로 입력하세요." /><small>{manualErrors.description ?? `${intake.description.length} / 4,000자`}</small></label>
            <label className={`context-field ${manualErrors.productUrl ? "field-error" : ""}`}><span>자료 출처·상품 링크 <i>필수</i></span><div className="product-link-input"><Link2 size={16} /><input type="url" required value={intake.productUrl} onChange={(event) => setIntakeField("productUrl", event.target.value)} placeholder="https:// 제조사, 공급사 또는 오픈라이선스 원문" /><button type="button" onClick={openProductUrl} disabled={!intake.productUrl.trim()}><ExternalLink size={14} />링크 열기</button></div><small>{manualErrors.productUrl ?? "로그인 없이 접근 가능한 공개 링크를 입력하세요."}</small></label>
            <div className="intake-confirmations">
              <label htmlFor="image-rights-confirmed" className={manualErrors.imageRightsConfirmed ? "field-error" : ""}><input id="image-rights-confirmed" aria-label="이미지와 상품 자료 사용 권한 확인" type="checkbox" checked={intake.imageRightsConfirmed} onChange={(event) => setIntakeField("imageRightsConfirmed", event.target.checked)} /><span><b>이미지·상품 자료 사용 권한</b><small>본인 촬영, 공급사 승인 또는 오픈라이선스 자료임을 확인합니다.</small></span></label>
              <label htmlFor="product-facts-confirmed" className={manualErrors.productFactsConfirmed ? "field-error" : ""}><input id="product-facts-confirmed" aria-label="상품 사실정보 확인" type="checkbox" checked={intake.productFactsConfirmed} onChange={(event) => setIntakeField("productFactsConfirmed", event.target.checked)} /><span><b>상품 사실정보 확인</b><small>원산지·소재·구성·규격이 실물과 일치합니다.</small></span></label>
            </div>
            <div className="analysis-context-note"><ShieldCheck size={16} /><span><b>사진과 입력 정보 함께 확인</b><small>대표사진, 상품 라벨, 바코드와 공개 링크를 비교하고 서로 다른 정보는 확인이 필요하다고 알려드립니다.</small></span></div>
          </section>

          <div className={`analysis-start-bar ${intakeReady && mainPhoto ? "ready" : "not-ready"}`}><span><b>{totalPhotoCount}장</b> · 1200×1200 JPG 자동보정 · 필수정보 {intakeReady ? "완료" : "미완료"} · 대표사진 {mainPhoto ? "완료" : "미완료"}</span><div><button type="button" className="batch-add-button" onClick={addCurrentProductToBatch} disabled={running || batchItems.length >= 8}><Plus size={17} />대기열에 담기</button><button type="button" onClick={startAutomation} disabled={running}>{running ? <><LoaderCircle className="spin" size={17} />분석 중</> : <><WandSparkles size={17} />1개 바로 분석</>}</button></div></div>
        </article>
        <aside className="panel publishing-settings"><div className="panel-heading"><div><span className="panel-kicker">등록 준비 상태</span><h3>입력·채널 사전 점검</h3></div><span className={`completion-ring ${intakeReady && mainPhoto ? "complete" : ""}`} style={{ "--progress": `${intakeProgress * 3.6}deg` } as React.CSSProperties}><b>{intakeProgress}</b><small>%</small></span></div>
          <div className="publishing-readiness-card"><div><span>대표사진</span><b className={mainPhoto ? "done" : ""}>{mainPhoto ? "완료" : "필수"}</b></div><div><span>필수정보</span><b className={intakeReady ? "done" : ""}>{intakeCompletedCount} / {intakeCompletionItems.length}</b></div><div><span>동시 대기열</span><b>{batchItems.length} / 8</b></div></div>
          <div className="channel-selection-heading"><div><b>등록할 판매 채널</b><small>연결된 채널을 선택할 수 있습니다.</small></div><em>{selectedChannels.length}개 선택</em></div>
          <div className="publish-channel-list active-channels">{connectedChannelEntries.map(([key, channel]) => { const selected = selectedChannels.includes(key); return <label key={channel.letter}><ChannelMark code={channel.letter} /><span><b>{channel.name}</b><small>{channel.market} · 등록 가능</small></span><input type="checkbox" checked={selected} onChange={(event) => setChannelSelection((current) => ({ ...current, [key]: event.target.checked }))} aria-label={`${channel.name} ${selected ? "선택됨" : "선택 가능"}`} /><i><Check size={12} /></i></label>; })}</div>
          <details className="unavailable-channels"><summary><span>연결 대기 채널 {unavailableChannelEntries.length}개</span><ChevronDown size={15} /></summary><div>{unavailableChannelEntries.map(([key, channel]) => { const connected = connectedChannelKeys.includes(key); return <span key={channel.letter}><ChannelMark code={channel.letter} size="sm" /><b>{channel.name}</b><em>{!channel.enabled ? "준비 중" : connected ? "연결됨" : "연결 필요"}</em></span>; })}</div></details>
          <div className="auto-options"><h4>등록 전 확인</h4><div className="automation-requirement"><span><b>AI 상품 분석</b><small>상품 사진과 필수 정보 분석 완료</small></span><em>필수</em></div><div className="automation-requirement"><span><b>여러 상품 한 번에 처리</b><small>상품은 한 번에 최대 8개까지 준비</small></span><em>자동</em></div><div className="automation-requirement"><span><b>판매 카테고리</b><small>등록 가능한 카테고리와 필수 정보 확인</small></span><em>필수</em></div><div className="automation-requirement"><span><b>등록 전 마지막 확인</b><small>가격, 재고와 배송 정보를 확인한 뒤 등록</small></span><em>필수</em></div></div>
        </aside>
      </section>
      <section className="panel product-batch-panel">
        <div className="panel-heading"><div><span className="panel-kicker">여러 상품 등록</span><h3>상품 한 번에 준비하기</h3><p>필수 정보와 대표사진을 입력한 상품을 담아 한 번에 최대 8개까지 분석할 수 있습니다.</p></div><span className="step-chip">{batchItems.length} / 8</span></div>
        {batchItems.length ? <div className="batch-product-list">{batchItems.map((item) => <div className="batch-product-row" key={item.id}><AiProductStudio mainPhoto={item.mainPhoto} photos={item.photos} manualFields={item.manualFields} requestId={item.requestId} compact notify={notify} onRunningChange={(isRunning) => setBatchItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: isRunning ? "running" : entry.status === "succeeded" ? "succeeded" : "failed" } : entry))} onResultReady={(_, productId) => { setBatchItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: productId ? "succeeded" : "failed", productId } : entry)); if (productId) { setAnalyzedProductId(productId); setAnalyzedProductName(item.manualFields.productName); setPublishRefreshVersion((current) => current + 1); } }} /><div className="batch-product-row-actions">{item.productId && <button type="button" className="batch-open-product" onClick={() => { setAnalyzedProductId(item.productId); setAnalyzedProductName(item.manualFields.productName); setPublishRefreshVersion((current) => current + 1); notify(`${item.manualFields.productName}의 카테고리·채널 등록 화면을 열었습니다.`); }}><ChevronRight size={13} />등록 준비</button>}<button type="button" className="batch-remove-product" aria-label={`${item.manualFields.productName} 대기열에서 삭제`} disabled={item.status === "running"} onClick={() => removeBatchItem(item.id)}><X size={14} /></button></div></div>)}</div> : <div className="batch-product-empty"><Upload size={22} /><span><b>대기열이 비어 있습니다.</b><small>현재 상품의 필수정보와 사진을 입력하고 ‘대기열에 담기’를 누르세요.</small></span></div>}
        <div className="batch-product-actions"><span>확인이 필요한 항목은 정보를 보완해 다시 처리할 수 있으며, 완료한 상품은 상품 목록에 저장됩니다.</span><div className="batch-product-action-buttons"><button type="button" className="secondary" disabled={recoveringRecentProducts} onClick={() => void recoverRecentProducts()}>{recoveringRecentProducts ? <LoaderCircle className="spin" size={16} /> : <PackageCheck size={16} />}{recoveringRecentProducts ? "불러오는 중" : "오늘 완료 상품 불러오기"}</button><button type="button" disabled={!batchItems.some((item) => item.status === "ready" || item.status === "failed")} onClick={startBatchAutomation}><Rocket size={16} />최대 8개 함께 분석</button></div></div>
      </section>
      <AiProductStudio
        mainPhoto={mainPhoto}
        photos={mainPhoto ? [mainPhoto, ...Object.values(slotPhotos), ...extraPhotos] : []}
        manualFields={intake}
        requestId={studioRequestId}
        onRunningChange={setRunning}
        notify={notify}
        onResultReady={(studioResult, productId) => {
          setAnalyzedProductName(studioResult.product.name);
          setAnalyzedProductId(productId);
          setPublishRefreshVersion((current) => current + 1);
        }}
      />
      <CategoryClassificationWorkbench
        productId={analyzedProductId}
        productName={analyzedProductName || `${intake.productName} ${intake.categoryHint}`.trim()}
        description={intake.description}
        sourceRef={analyzedProductId ?? categoryDraftRef}
        enabledChannels={selectedChannels}
        notify={notify}
        onConfirmed={() => setPublishRefreshVersion((current) => current + 1)}
      />
      <ProductPublishWorkbench
        productId={analyzedProductId}
        selectedChannels={selectedChannels}
        refreshVersion={publishRefreshVersion}
        notify={notify}
      />
      <section className="panel queue-panel"><div className="panel-heading"><div><span className="panel-kicker">등록 진행</span><h3>상품 등록 현황</h3></div><button className="ghost-button" onClick={() => notify("최근 상품 등록 결과를 이 화면에서 확인할 수 있습니다.")}>등록 기록<ChevronRight size={15} /></button></div>
        <div className="queue-live-summary"><div><small>AI 제작 중</small><b>{pipeline?.aiRunning ?? 0}건</b></div><div><small>등록 대기</small><b>{pipeline?.listingQueued ?? 0}건</b></div><div><small>등록 완료</small><b>{pipeline?.listingPublished ?? 0}건</b></div><div><small>확인 필요</small><b>{pipeline?.listingFailed ?? 0}건</b></div></div>
        {!pipeline || pipeline.aiRunning + pipeline.listingQueued + pipeline.listingPublished + pipeline.listingFailed === 0 ? <div className="live-empty-state"><Upload size={26} /><b>상품 등록 기록이 아직 없습니다.</b><small>대표사진 분석과 카테고리 확인 후 상품을 등록하면 여기에 표시됩니다.</small></div> : null}
      </section>
    </div>
  );
}

function OrdersPage({ displayOrders, onAdvance }: { displayOrders: DisplayOrder[]; onAdvance: (order: DisplayOrder) => Promise<void> }) {
  const [active, setActive] = useState("전체 주문");
  const paidCount = displayOrders.filter((order) => order.status === "결제완료").length;
  const readyCount = displayOrders.filter((order) => order.status === "출고대기").length;
  const shippingCount = displayOrders.filter((order) => order.status === "배송중").length;
  return (
    <div className="page-stack">
      <section className="order-summary-grid"><article><span className="metric-icon blue"><ShoppingCart size={19} /></span><div><small>전체 주문</small><strong>{displayOrders.length}</strong></div><em>모든 채널</em></article><article><span className="metric-icon orange"><Clock3 size={19} /></span><div><small>출고 대기</small><strong>{readyCount}</strong></div><em className="neutral">결제완료 {paidCount}건</em></article><article><span className="metric-icon violet"><Truck size={19} /></span><div><small>배송 중</small><strong>{shippingCount}</strong></div><em className="neutral">상태 변경 가능</em></article><article><span className="metric-icon green"><CircleDollarSign size={19} /></span><div><small>정보 업데이트</small><strong>자동</strong></div><em>1분마다 확인</em></article></section>
      <section className="panel data-panel"><div className="tab-toolbar"><div>{["전체 주문", "결제완료", "출고대기", "배송중", "완료 · 취소"].map((tab) => <button className={active === tab ? "active" : ""} onClick={() => setActive(tab)} key={tab}>{tab}{tab === "출고대기" && <span>{readyCount}</span>}</button>)}</div><div className="search-field"><Search size={16} /><input placeholder="주문번호, 구매자 검색" /></div><button className="filter-button"><Filter size={15} />필터</button></div>
        <div className="table-wrap"><table className="data-table order-table"><thead><tr><th>주문번호</th><th>채널</th><th>구매자</th><th>상품</th><th>결제금액</th><th>주문상태</th><th>주문시간</th><th /></tr></thead><tbody>{displayOrders.filter((order) => active === "전체 주문" || active === "완료 · 취소" && ["배송완료", "취소완료", "환불완료"].includes(order.status) || order.status === active).map((order) => <tr key={order.id}><td><b className="mono">{order.id}</b></td><td><ChannelMark code={order.channel} size="sm" /></td><td><b>{order.customer}</b></td><td><span className="truncate-product">{order.product}</span></td><td><b>{order.amount}</b></td><td><StatusBadge status={order.status} /></td><td><span className="muted-cell">{order.time}</span></td><td><button className="table-action" title="다음 주문 상태로 변경" aria-label={`${order.id} 다음 상태로 변경`} onClick={() => void onAdvance(order)}><ChevronRight size={16} /></button></td></tr>)}</tbody></table></div>
        {displayOrders.length === 0 && <div className="live-empty-state table-empty"><ShoppingCart size={28} /><b>불러온 주문이 없습니다.</b><small>판매 채널을 연결하면 주문이 여기에 표시됩니다.</small></div>}
        <div className="bulk-order-bar"><span><input type="checkbox" disabled />선택한 주문</span><button disabled><Truck size={15} />일괄 출고 처리</button><button disabled>송장 올리기</button><span className="toolbar-spacer" /><small>주문을 불러오면 사용할 수 있습니다</small><button className="table-action" disabled><RefreshCw size={15} /></button></div>
      </section>
    </div>
  );
}

function CsPage({ notify, displayTickets, displayOrders, onSend }: { notify: (message: string) => void; displayTickets: DisplayTicket[]; displayOrders: DisplayOrder[]; onSend: (ticket: DisplayTicket, reply: string) => Promise<boolean> }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const selected = displayTickets.find((ticket) => ticket.id === selectedId) ?? displayTickets[0] ?? null;
  const sendReply = async () => {
    if (selected && await onSend(selected, reply)) {
      notify(`${selected.customer} 고객 문의를 처리 완료로 저장했습니다.`);
      setReply("");
    }
  };
  const linkedOrder = selected ? displayOrders.find((order) => order.customer === selected.customer) ?? null : null;
  return (
    <div className="page-stack cs-page">
      <section className="cs-summary"><div><span className="metric-icon violet"><Inbox size={18} /></span><span><small>미처리 문의</small><strong>{displayTickets.length}</strong></span></div><div><span className="metric-icon orange"><Clock3 size={18} /></span><span><small>긴급 문의</small><strong>{displayTickets.filter((ticket) => ticket.status === "긴급").length}</strong></span></div><div><span className="metric-icon green"><BadgeCheck size={18} /></span><span><small>연결 주문</small><strong>{displayOrders.length}</strong></span></div><div><span className="metric-icon blue"><Bot size={18} /></span><span><small>AI 답변</small><strong>준비</strong></span></div></section>
      {!selected ? <section className="panel live-empty-state large"><Inbox size={32} /><b>불러온 고객 문의가 없습니다.</b><small>판매 채널을 연결하면 고객 문의와 관련 주문이 여기에 표시됩니다.</small></section> :
      <section className="cs-workspace panel">
        <aside className="ticket-list"><div className="ticket-list-header"><div className="search-field"><Search size={15} /><input placeholder="문의 검색" /></div><button className="icon-only-button"><Filter size={16} /></button></div><div className="ticket-tabs"><button className="active">미답변 <span>{displayTickets.length}</span></button><button>처리 중</button><button>완료</button></div>{displayTickets.map((ticket) => <button key={ticket.id} className={`ticket-item ${selected.id === ticket.id ? "active" : ""}`} onClick={() => { setSelectedId(ticket.id); setReply(""); }}><div className="ticket-avatar">{ticket.customer.charAt(0)}</div><div><div><b>{ticket.customer}</b><small>{ticket.time}</small></div><span><ChannelMark code={ticketChannelCodes[ticket.channel] ?? "Q"} size="sm" />{ticket.subject}</span><p>{ticket.preview}</p><StatusBadge status={ticket.status} /></div></button>)}</aside>
        <article className="conversation"><header><div><button className="mobile-back"><ArrowLeft size={16} /></button><span className="ticket-avatar large">{selected.customer.charAt(0)}</span><span><b>{selected.customer}</b><small>{selected.channel} · {selected.id}</small></span></div><div><button className="filter-button">처리 중<ChevronDown size={14} /></button><button className="icon-only-button"><MoreHorizontal size={18} /></button></div></header>
          <div className="conversation-body"><div className="order-context"><Package size={16} /><span><small>문의 주문</small><b>{linkedOrder?.product ?? "연결된 주문 없음"}</b></span><em>{linkedOrder?.id ?? "-"}<ChevronRight size={14} /></em></div><div className="message-date"><span>받은 문의</span></div><div className="customer-message"><div className="ticket-avatar">{selected.customer.charAt(0)}</div><div><small>{selected.customer} · {selected.time}</small><p>{selected.preview}</p><span>판매 채널에서 받은 내용</span></div></div></div>
          <footer className="reply-composer"><div className="ai-draft-head"><span><Sparkles size={14} />주문 정보와 판매 채널 정책을 확인해 AI 답변을 준비합니다.</span><button disabled><RefreshCw size={13} />AI 답변</button></div><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="고객에게 보낼 답변을 입력하세요." /><div><span><button disabled><Languages size={15} />번역 후 전송<ChevronDown size={13} /></button><button disabled><FileText size={15} />자주 쓰는 답변</button></span><button className="send-button" disabled={!reply} onClick={() => void sendReply()}>답변 저장<Send size={15} /></button></div></footer>
        </article>
        <aside className="customer-panel"><div className="customer-profile"><div className="ticket-avatar xl">{selected.customer.charAt(0)}</div><h4>{selected.customer}</h4><span>{selected.channel} 구매자</span></div><div className="customer-facts"><div><small>총 주문</small><b>{displayOrders.filter((order) => order.customer === selected.customer).length}건</b></div><div><small>정보 기준</small><b>판매 채널 최신 정보</b></div></div><div className="detail-section"><h5>현재 주문</h5><div className="mini-order"><span className="tiny-thumb"><Package size={17} /></span><span><b>{linkedOrder?.product ?? "연결된 주문 없음"}</b><small>{linkedOrder?.amount ?? "-"}</small></span></div><dl><div><dt>주문번호</dt><dd>{linkedOrder?.id ?? "-"}</dd></div><div><dt>배송상태</dt><dd><StatusBadge status={linkedOrder?.status ?? "확인 필요"} /></dd></div><div><dt>운송장</dt><dd>판매 채널에서 확인한 정보</dd></div></dl></div><div className="detail-section"><h5>응대 원칙</h5><p className="ai-guide"><Bot size={16} />실제 주문·배송 상태를 확인한 뒤 답변을 저장하세요.</p></div></aside>
      </section>}
    </div>
  );
}

function ChannelPage({ channelKey, onNavigate, metric, displayProducts }: {
  channelKey: ChannelKey;
  onNavigate: (view: View) => void;
  metric: OperationsSnapshot["channelMetrics"][number] | null;
  displayProducts: DisplayProduct[];
}) {
  const channel = channels[channelKey];
  const connected = metric?.credentialStatus === "active";
  const channelProducts = displayProducts.filter((product) => product.channels.includes(channel.letter)).sort((a, b) => b.sales - a.sales);
  const revenue = metric?.revenue30dKrw ?? 0;
  const orderCount = metric?.orderCount ?? 0;
  const averageOrder = orderCount > 0 ? revenue / orderCount : 0;
  return (
    <div className="page-stack">
      <section className="channel-hero" style={{ "--channel-color": channel.color } as React.CSSProperties}><div><ChannelMark code={channel.letter} size="lg" /><span><small>{channel.market} 판매 채널</small><h2>{channel.name}</h2><em className={connected ? "connected" : ""}><i />{connected ? "연결됨 · 판매 정보 자동 업데이트" : "채널 연결 필요"}</em></span></div><div><button className="filter-button" onClick={() => onNavigate("readiness")}><ShieldCheck size={15} />연결 상태</button><button className="primary-button" onClick={() => onNavigate("credentials")}><KeyRound size={15} />채널 연결</button></div></section>
      <section className="metric-grid channel-metrics"><MetricCard label="30일 매출" value={formatCompactWon(revenue)} detail="판매 상품 매출" icon={CircleDollarSign} tone="violet" /><MetricCard label="주문" value={orderCount.toLocaleString()} detail={`출고대기 ${metric?.readyToShipCount ?? 0}건`} icon={ShoppingBag} tone="blue" /><MetricCard label="판매 상품" value={(metric?.publishedCount ?? 0).toLocaleString()} detail={`관리 상품 ${metric?.productCount ?? 0}개`} icon={Package} tone="green" /><MetricCard label="답변 대기 문의" value={(metric?.openTicketCount ?? 0).toLocaleString()} detail="판매 채널 문의" icon={Headphones} tone="orange" /></section>
      <section className="channel-detail-grid"><article className="panel"><div className="panel-heading"><div><span className="panel-kicker">판매 현황</span><h3>최근 30일 요약</h3></div><span className="live-label"><i />최신</span></div><div className="channel-live-summary"><div><small>판매량</small><b>{(metric?.sold30d ?? 0).toLocaleString()}개</b></div><div><small>평균 주문금액</small><b>{formatCompactWon(averageOrder)}</b></div><div><small>주문</small><b>{orderCount.toLocaleString()}건</b></div><div><small>확인할 등록</small><b>{metric?.failedAttemptCount ?? 0}건</b></div></div></article><article className="panel store-health"><div className="panel-heading"><div><span className="panel-kicker">연결 상태</span><h3>판매 채널 연결</h3></div><span className={`score-grade ${connected ? "connected" : ""}`}>{connected ? "연결됨" : "연결 전"}</span></div>{[{ label: "채널 연결", score: connected ? "정상" : "연결 필요" }, { label: "등록 상품", score: `${metric?.publishedCount ?? 0}개` }, { label: "출고 대기", score: `${metric?.readyToShipCount ?? 0}건` }, { label: "확인할 작업", score: `${metric?.failedAttemptCount ?? 0}건` }].map((item) => <div className="health-row" key={item.label}><span>{item.label}</span><b>{item.score}</b></div>)}</article></section>
      <section className="panel data-panel"><div className="panel-heading table-title"><div><span className="panel-kicker">판매 상품</span><h3>채널에 등록된 상품</h3></div><button className="ghost-button" onClick={() => onNavigate("products")}>전체 상품<ChevronRight size={15} /></button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>순위</th><th>상품</th><th>30일 판매</th><th>30일 매출</th><th>재고</th><th>상태</th></tr></thead><tbody>{channelProducts.slice(0, 10).map((product, index) => <tr key={product.id}><td><b className="rank-number">{String(index + 1).padStart(2, "0")}</b></td><td><div className="product-cell"><div className="product-thumb"><ProductVisual src={product.image} size="52px" /></div><span><b>{product.name}</b><small>{product.sku}</small></span></div></td><td><b>{product.sales}</b>개</td><td><b>{product.revenue}</b></td><td><b>{product.stock}</b>개</td><td><StatusBadge status={product.status} /></td></tr>)}</tbody></table></div>{channelProducts.length === 0 && <div className="live-empty-state table-empty"><PackageSearch size={28} /><b>이 채널에 등록된 상품이 없습니다.</b><small>판매 채널을 연결한 뒤 상품을 등록해 주세요.</small></div>}</section>
    </div>
  );
}

function DashboardShell({ onLogout, userEmail }: { onLogout: () => Promise<void>; userEmail: string }) {
  const [view, setView] = useState<View>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [toast, setToast] = useState<ToastNotice | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<{ id: string; name: string } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const operations = useOperationsSnapshot();
  const operationsAvailable = operations.data !== null;
  const operationSummary = operations.data?.summary ?? null;
  const channelMetrics = useMemo(() => operations.data?.channelMetrics ?? [], [operations.data]);
  const pipeline = operations.data?.pipeline ?? null;
  const meta = pageMeta[view];

  const notify = useCallback((message: string) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast(userNotice(message));
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 5_200);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  const displayProducts = useMemo<DisplayProduct[]>(() => operations.data?.products.map((product) => {
    const listings = (product.listings ?? []).flatMap((listing) => isActiveChannelKey(listing.channelKey) && listing.remoteId.trim()
      ? [{
        channelKey: listing.channelKey,
        channelCode: listing.channelCode,
        remoteId: listing.remoteId,
        market: listing.market,
        targetId: listing.targetId,
      }]
      : []);
    return {
      id: product.externalCode,
      sourceId: product.id,
      name: product.name,
      sku: product.sku,
      image: product.imageUrl ?? null,
      stock: product.available,
      sales: product.sold30d,
      revenue: `₩${Math.round(product.revenue30dKrw).toLocaleString("ko-KR")}`,
      status: productStatusLabel[product.status],
      channels: product.listingChannels,
      listings,
    };
  }) ?? [], [operations.data]);

  const displayOrders = useMemo<DisplayOrder[]>(() => operations.data?.orders.map((order) => ({
    id: order.externalOrderId,
    channel: order.channelCode,
    customer: order.customerName,
    product: order.productName,
    amount: new Intl.NumberFormat("ko-KR", { style: "currency", currency: order.currency, maximumFractionDigits: order.currency === "KRW" ? 0 : 2 }).format(order.amount),
    status: orderStatusLabel[order.status],
    time: relativeTime(order.orderedAt),
  })) ?? [], [operations.data]);

  const displayTickets = useMemo<DisplayTicket[]>(() => operations.data?.tickets.map((ticket) => ({
    id: ticket.externalTicketId,
    customer: ticket.customerName,
    channel: channelNameByKey[ticket.channelKey] ?? ticket.channelKey,
    subject: ticket.subject,
    preview: ticket.translatedMessage ?? ticket.message,
    time: relativeTime(ticket.receivedAt),
    status: ticketStatusLabel[ticket.status],
  })) ?? [], [operations.data]);

  const advanceOrder = useCallback(async (order: DisplayOrder) => {
    const source = operations.data?.orders.find((item) => item.externalOrderId === order.id);
    if (!source) {
      notify("지금은 주문 상태를 변경할 수 없습니다. 판매 정보를 새로고침한 뒤 다시 시도해 주세요.");
      return;
    }
    const nextStatus = ({
      paid: "ready_to_ship",
      ready_to_ship: "shipped",
      shipped: "delivered",
      delivered: "delivered",
      cancelled: "cancelled",
      refunded: "refunded",
    } as const)[source.status];
    try {
      const response = await operations.authenticatedFetch("/api/operations/snapshot", {
        method: "POST",
        body: JSON.stringify({ action: "order_status", id: source.id, status: nextStatus }),
      });
      if (!response.ok) throw new Error("주문 상태를 저장하지 못했습니다.");
      await operations.reload();
      notify(`${order.id} 주문을 ${orderStatusLabel[nextStatus]} 상태로 변경했습니다.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "주문 상태를 저장하지 못했습니다.");
    }
  }, [operations, notify]);

  const saveTicketReply = useCallback(async (ticket: DisplayTicket, reply: string) => {
    const source = operations.data?.tickets.find((item) => item.externalTicketId === ticket.id);
    if (!source) {
      notify("지금은 답변을 저장할 수 없습니다. 판매 정보를 새로고침한 뒤 다시 시도해 주세요.");
      return false;
    }
    try {
      const response = await operations.authenticatedFetch("/api/operations/snapshot", {
        method: "POST",
        body: JSON.stringify({ action: "ticket_update", id: source.id, status: "resolved", replyDraft: reply }),
      });
      if (!response.ok) throw new Error("CS 답변을 저장하지 못했습니다.");
      await operations.reload();
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "CS 답변을 저장하지 못했습니다.");
      return false;
    }
  }, [operations, notify]);

  const navigate = useCallback((next: View) => {
    if (next === "publishing") setSelectedProduct(null);
    setView(next);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const openProductForPublishing = useCallback((product: DisplayProduct) => {
    setSelectedProduct({ id: product.sourceId, name: product.name });
    setView("publishing");
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const content = (() => {
    if (view === "overview") return <OverviewPage onNavigate={navigate} displayProducts={displayProducts} operationSummary={operationSummary} channelMetrics={channelMetrics} pipeline={pipeline} operationsAvailable={operationsAvailable} />;
    if (view === "products") return <ProductsPage onNavigate={navigate} onOpenProduct={openProductForPublishing} displayProducts={displayProducts} />;
    if (view === "publishing") return <PublishingPage key={selectedProduct?.id ?? "new-product"} notify={notify} channelMetrics={channelMetrics} pipeline={pipeline} initialProduct={selectedProduct} />;
    if (view === "margin") return <MarginCalculatorPage notify={notify} scenarios={operations.data?.marginScenarios ?? []} onChanged={() => void operations.reload()} />;
    if (view === "orders") return <OrdersPage displayOrders={displayOrders} onAdvance={advanceOrder} />;
    if (view === "cs") return <CsPage notify={notify} displayTickets={displayTickets} displayOrders={displayOrders} onSend={saveTicketReply} />;
    if (view === "readiness") return <ChannelReadinessPage />;
    if (view === "credentials") return <ApiCredentialCenter notify={notify} />;
    const channelKey = view as ChannelKey;
    return <ChannelPage channelKey={channelKey} onNavigate={navigate} metric={channelMetrics.find((metric) => metric.channelKey === channelKey) ?? null} displayProducts={displayProducts} />;
  })();

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-head"><div className="brand-lockup light"><span className="brand-symbol"><Zap size={17} fill="currentColor" /></span><span className="sidebar-brand-copy"><strong>SellerPilot</strong><small>통합 판매 관리</small></span></div><button aria-label="메뉴 닫기" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={18} /></button></div>
        <nav>{navGroups.map((group) => <div className="nav-group" key={group.label}><span className="nav-label">{group.label}</span>{group.items.map((item) => {
          const Icon = "icon" in item ? item.icon : null;
          const isActive = view === item.id;
          return <button key={item.id} className={isActive ? "active" : ""} onClick={() => navigate(item.id)} aria-label={item.label}>{Icon ? <Icon size={17} /> : <ChannelMark code={(item as { channel: string }).channel} size="sm" />}<span>{item.label}</span>{isActive ? <ChevronRight size={14} /> : null}</button>;
        })}</div>)}</nav>
        <div className="sidebar-insight"><div><Activity size={15} /><span>채널 연결 현황</span></div><p><b>7개 판매 채널</b>을 한곳에서<br />연결하고 관리할 수 있습니다.</p><span><i /></span><small>연결 상태와 갱신 일정 확인</small></div>
        <div className="sidebar-foot"><button><LifeBuoy size={17} /><span>도움말</span></button><button onClick={() => navigate("credentials")}><Settings size={17} /><span>채널 연결 설정</span></button><button onClick={() => void onLogout()}><LogOut size={17} /><span>로그아웃</span></button></div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="메뉴 닫기" onClick={() => setSidebarOpen(false)} />}

      <section className="app-main">
        <div className="app-header-stack">
          <div className="commerce-service-rail" aria-label="채널 운영 상태">
            <strong>통합 판매관리</strong>
            <span><i className={operations.state === "database" ? "rail-ok" : "rail-pending"} />{operations.state === "database" ? "판매 정보 연결됨" : operations.state === "stale" ? "최근 저장 정보 표시 중" : "판매 정보 확인 중"}</span>
            <span><i className={operationSummary?.activeCredentialCount ? "rail-ok" : "rail-pending"} />채널 {operationSummary?.activeCredentialCount ?? 0}개 연결</span>
            <span><i className="rail-ok" />연결 정보 안전하게 보호</span>
            <em>{operations.state === "database" ? "1분마다 자동 업데이트" : operations.state === "stale" ? "연결되면 자동으로 갱신됩니다" : operations.state === "loading" ? "정보를 불러오는 중" : "연결 상태를 확인해 주세요"}</em>
          </div>
          <header className="topbar">
          <div className="topbar-title"><button className="mobile-menu-button" aria-label="전체 메뉴 열기" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><div><h1>{meta.title}</h1><p>{meta.description}</p></div></div>
          <div className="topbar-actions"><span className={`demo-data-badge ${operations.state === "database" ? "database" : ""}`} title={userFacingErrorMessage(operations.message, "판매 정보를 확인하고 있습니다.")}><Activity size={13} /><b>{operations.state === "database" ? "최신 정보" : operations.state === "stale" ? "업데이트 지연" : operations.state === "loading" ? "확인 중" : "연결 확인"}</b><small>{operations.state === "database" ? "자동 업데이트" : operations.state === "stale" ? "최근 정보 표시 중" : "잠시 후 다시 확인해 주세요"}</small></span><button className="global-search" aria-label="통합 검색 열기" onClick={() => setSearchOpen(true)}><Search size={16} /><span>상품, 주문, 문의 검색</span><kbd><Command size={11} />K</kbd></button><div className="notification-wrap"><button className="top-icon-button" aria-label="알림" onClick={() => setNotificationsOpen((current) => !current)}><Bell size={18} />{Boolean((operationSummary?.lowStockCount ?? 0) + (operationSummary?.registrationErrorCount ?? 0)) && <i />}</button>{notificationsOpen && <div className="notification-popover"><div><h4>알림</h4><button onClick={() => setNotificationsOpen(false)}>닫기</button></div><button onClick={() => navigate("products")}><span className="alert-icon danger"><Box size={15} /></span><span><b>재고 부족 상품 {operationSummary?.lowStockCount ?? 0}건</b><small>현재 재고 기준</small></span></button><button onClick={() => navigate("publishing")}><span className="alert-icon warning"><AlertCircle size={15} /></span><span><b>등록 확인 필요 {operationSummary?.registrationErrorCount ?? 0}건</b><small>최근 등록 결과 기준</small></span></button></div>}</div><button className="user-menu"><span className="user-avatar">관</span><span><b>{userEmail.split("@")[0]}</b><small>관리자</small></span><ChevronDown size={14} /></button></div>
          </header>
        </div>
        <div className="app-content">{content}</div>
      </section>

      <nav className="mobile-bottom-nav" aria-label="주요 메뉴">
        {([
          { id: "overview" as View, label: "홈", icon: LayoutDashboard },
          { id: "products" as View, label: "상품", icon: Package },
          { id: "publishing" as View, label: "등록", icon: Plus },
          { id: "orders" as View, label: "주문", icon: ShoppingCart },
          { id: "cs" as View, label: "문의", icon: MessageCircleMore },
        ]).map((item) => <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)} aria-current={view === item.id ? "page" : undefined}><item.icon size={20} /><span>{item.label}</span></button>)}
      </nav>

      {searchOpen && <div className="command-overlay" role="button" tabIndex={0} aria-label="검색창 닫기" onClick={(event) => { if (event.target === event.currentTarget) setSearchOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape" || event.key === "Enter") setSearchOpen(false); }}><div className="command-dialog" role="dialog" aria-modal="true" aria-label="통합 검색"><div className="command-input"><Search size={18} /><input placeholder="상품명, 주문번호, 고객명 검색" /><button aria-label="검색창 닫기" onClick={() => setSearchOpen(false)}><X size={17} /></button></div><span className="command-label">빠른 이동</span>{navGroups[0].items.map((item) => { const Icon = "icon" in item ? item.icon : null; return Icon ? <button key={item.id} onClick={() => { navigate(item.id); setSearchOpen(false); }}><Icon size={17} /><span>{item.label}</span><ArrowRight size={14} /></button> : null; })}</div></div>}
      {toast && <NoticeToast notice={toast} onClose={() => setToast(null)} />}
    </main>
  );
}

export default function Home() {
  const [accessState, setAccessState] = useState<"checking" | "signed_out" | "admin" | "forbidden">(isSupabaseConfigured ? "checking" : "signed_out");
  const [userEmail, setUserEmail] = useState("");
  const [pendingChannelOAuth, setPendingChannelOAuth] = useState<{ channel: "shopee" | "lazada" | "ebay"; code: string; state: string; shopId?: string; mainAccountId?: string } | null>(null);
  const [oauthNotice, setOauthNotice] = useState("");
  const oauthHandled = useRef(false);

  useEffect(() => {
    const captureCallback = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code") ?? "";
      const state = params.get("state") ?? "";
      const channel = state.startsWith("sellerpilot-shopee-") ? "shopee" : state.startsWith("sellerpilot-lazada-") ? "lazada" : state.startsWith("sellerpilot-ebay-") ? "ebay" : null;
      if (!code || !channel) return;
      window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
      setPendingChannelOAuth({
        channel,
        code,
        state,
        shopId: params.get("shop_id") ?? undefined,
        mainAccountId: params.get("main_account_id") ?? undefined,
      });
    }, 0);
    return () => window.clearTimeout(captureCallback);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = createSupabaseClient();
    const verifyAdmin = async (session: Session | null) => {
      if (!session) {
        setUserEmail("");
        setAccessState("signed_out");
        return;
      }
      setUserEmail(session.user.email ?? "");
      const { data: isAdmin, error } = await supabase.rpc("sellerpilot_is_admin");
      setAccessState(!error && isAdmin === true ? "admin" : "forbidden");
    };
    void supabase.auth.getSession().then(({ data }) => void verifyAdmin(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccessState(session ? "checking" : "signed_out");
      window.setTimeout(() => void verifyAdmin(session), 0);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (accessState !== "admin" || !pendingChannelOAuth || oauthHandled.current) return;
    oauthHandled.current = true;
    const completeChannelOAuth = async () => {
      try {
        const { data: sessionData } = await createSupabaseClient().auth.getSession();
        const response = await fetch(`/api/admin/channel-credentials/${pendingChannelOAuth.channel}/authorize`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${sessionData.session?.access_token ?? ""}` },
          body: JSON.stringify({
            secretPayload: {
              authorization_code: pendingChannelOAuth.code,
              ...(pendingChannelOAuth.shopId ? { shop_id: pendingChannelOAuth.shopId } : {}),
              ...(pendingChannelOAuth.mainAccountId ? { main_account_id: pendingChannelOAuth.mainAccountId } : {}),
            },
            oauthState: pendingChannelOAuth.state,
          }),
        });
        const payload = await response.json().catch(() => ({ message: "판매 채널 연결 결과를 확인하지 못했습니다." })) as { message: string };
        if (!response.ok) throw new Error(payload.message);
        setOauthNotice(userFacingErrorMessage(payload.message, "판매자 계정 연결이 완료됐습니다."));
      } catch (oauthError) {
        setOauthNotice(userFacingErrorMessage(oauthError, "판매자 계정 연결을 완료하지 못했습니다. 다시 연결해 주세요."));
      } finally {
        setPendingChannelOAuth(null);
        window.setTimeout(() => setOauthNotice(""), 6_000);
      }
    };
    void completeChannelOAuth();
  }, [accessState, pendingChannelOAuth]);

  const login = async (email: string, password: string) => {
    if (!isSupabaseConfigured) return "운영 인증 서버가 아직 연결되지 않았습니다.";
    const { error } = await createSupabaseClient().auth.signInWithPassword({ email, password });
    if (error) return "아이디 또는 비밀번호를 확인해 주세요.";
    return null;
  };

  const resetPassword = async (email: string) => {
    if (!isSupabaseConfigured) return "운영 인증 서버가 아직 연결되지 않았습니다.";
    const redirectTo = `${window.location.origin}/auth/callback?next=/update-password`;
    const { error } = await createSupabaseClient().auth.resetPasswordForEmail(email, { redirectTo });
    return error ? "재설정 메일을 보내지 못했습니다. 관리자에게 문의해 주세요." : null;
  };

  const logout = async () => {
    if (isSupabaseConfigured) await createSupabaseClient().auth.signOut();
    setAccessState("signed_out");
    setUserEmail("");
  };

  const oauthCustomerNotice = oauthNotice ? userNotice(oauthNotice) : null;

  if (accessState === "checking") {
    return <main className="login-shell"><section className="login-form-panel"><div className="login-card"><LoaderCircle className="spin" size={24} /><h2>로그인 정보를 확인하고 있어요</h2><p>판매 정보를 안전하게 불러오는 중입니다. 잠시만 기다려 주세요.</p></div></section></main>;
  }
  if (accessState === "forbidden") {
    return <main className="login-shell"><section className="login-form-panel"><div className="login-card"><AlertTriangle size={26} /><h2>이 계정으로는 이용할 수 없어요</h2><p>{userEmail || "현재 계정"}에는 SellerPilot 이용 권한이 없습니다. 관리자에게 계정 승인을 요청하거나 다른 계정으로 로그인해 주세요.</p><button type="button" className="login-submit" onClick={() => void logout()}><LogOut size={16} />다른 계정으로 로그인</button></div></section></main>;
  }
  return accessState === "admin"
    ? <><DashboardShell onLogout={logout} userEmail={userEmail} />{oauthCustomerNotice && <NoticeToast notice={oauthCustomerNotice} onClose={() => setOauthNotice("")} />}</>
    : <LoginScreen onLogin={login} onPasswordReset={resetPassword} />;
}
