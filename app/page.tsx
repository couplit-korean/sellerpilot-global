"use client";

import Image from "next/image";
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
  ClipboardCheck,
  Command,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  Filter,
  Globe2,
  Headphones,
  HelpCircle,
  ImagePlus,
  Inbox,
  Languages,
  LayoutDashboard,
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
  Search,
  Send,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Store,
  TrendingUp,
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
import { AiProductStudio } from "./ai-product-studio";
import { AcceptanceChecklistPage } from "./acceptance-checklist";
import { ChannelConnectionsPage } from "./channel-connections";
import { CategoryClassificationWorkbench } from "./category-classification-workbench";
import { ProductPublishWorkbench } from "./product-publish-workbench";
import { StyleLearningCenter } from "./style-learning-center";
import { MarginCalculatorPage } from "./margin-calculator";
import { MobilePushManager } from "./mobile-push-manager";
import { marketplaceListingLinkLabel, marketplaceListingUrl, type RemoteListingReference } from "./channel-links";
import { channels, type ChannelKey } from "./channel-config";
import { activeChannelKeys } from "../lib/channels/catalog";
import { useOperationsSnapshot, type OperationsSnapshot } from "./use-operations-snapshot";
import { createClient as createSupabaseClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";
import type { ProductResearchResult } from "../lib/ai-cli-contract";
import { emptyProductIntake, productConditions, productCurrencies, productIntakeSchema, type ProductIntakeDraft } from "../lib/product-intake";

type View =
  | "overview"
  | "products"
  | "product-detail"
  | "publishing"
  | "style-learning"
  | "margin"
  | "orders"
  | "cs"
  | "connections"
  | "qoo10"
  | "shopee"
  | "lazada"
  | "coupang"
  | "elevenst"
  | "temu"
  | "smartstore"
  | "ebay"
  | "alibaba"
  | "one688"
  | "acceptance"
  | "storyboard";

const navGroups = [
  {
    label: "운영",
    items: [
      { id: "overview" as View, label: "통합 대시보드", icon: LayoutDashboard },
      { id: "products" as View, label: "상품 관리", icon: Package },
      { id: "publishing" as View, label: "상품 등록", icon: CloudUpload },
      { id: "style-learning" as View, label: "스타일 학습 검증", icon: Sparkles },
      { id: "margin" as View, label: "마진 계산", icon: Calculator },
      { id: "orders" as View, label: "주문 · 판매", icon: ShoppingCart },
      { id: "cs" as View, label: "CS 통합함", icon: Headphones },
      { id: "connections" as View, label: "채널 연결 · 상태", icon: ShieldCheck },
    ],
  },
  {
    label: "판매 채널",
    items: [
      { id: "qoo10" as View, label: "Qoo10 Japan", channel: "Q" },
      { id: "shopee" as View, label: "Shopee Global", channel: "S" },
      { id: "lazada" as View, label: "Lazada MY", channel: "L" },
      { id: "coupang" as View, label: "쿠팡", channel: "C" },
      { id: "elevenst" as View, label: "11번가", channel: "11" },
      { id: "smartstore" as View, label: "네이버 스마트스토어", channel: "N" },
      { id: "ebay" as View, label: "eBay Global", channel: "E" },
      { id: "temu" as View, label: "Temu Korea", channel: "T" },
      { id: "alibaba" as View, label: "Alibaba.com", channel: "A", disabled: true },
      { id: "one688" as View, label: "1688.com", channel: "1688", disabled: true },
    ],
  },
  {
    label: "기획",
    items: [
      { id: "acceptance" as View, label: "개발 · 실검수", icon: ClipboardCheck },
      { id: "storyboard" as View, label: "서비스 스토리보드", icon: FileText },
    ],
  },
];

const pageMeta: Record<View, { title: string; description: string }> = {
  overview: { title: "통합 대시보드", description: "모든 채널의 오늘을 한눈에 확인하세요." },
  products: { title: "상품 관리", description: "채널별 등록 상태, 재고와 판매 성과를 관리합니다." },
  "product-detail": { title: "상품 상세정보", description: "등록된 상품의 이미지, 기본 정보, 재고와 채널 상태를 확인합니다." },
  publishing: { title: "상품 등록 센터", description: "대표사진과 다양한 각도 사진, 설명과 링크를 함께 분석해 채널 등록을 자동화합니다." },
  "style-learning": { title: "스타일 학습 검증", description: "6개 카테고리 1,200개 상품 범위와 8개 채널의 국가·언어별 제작 규칙을 확인합니다." },
  margin: { title: "마진 계산", description: "원가와 채널 비용을 반영해 순이익과 목표 마진 판매가를 계산합니다." },
  orders: { title: "주문 · 판매", description: "전체 채널의 주문과 배송 흐름을 한곳에서 처리합니다." },
  cs: { title: "CS 통합함", description: "언어와 채널이 달라도 하나의 상담함에서 응대합니다." },
  connections: { title: "채널 연결 · 상태", description: "판매채널 연결 상태, API 인증과 차단 요인을 한곳에서 관리합니다." },
  qoo10: { title: "Qoo10 Japan", description: "일본 스토어의 상품, 매출, 주문, CS 성과입니다." },
  shopee: { title: "Shopee Global", description: "8개 국가 Shopee 숍의 상품, 매출, 주문, CS 성과입니다." },
  lazada: { title: "Lazada Malaysia", description: "말레이시아 스토어의 상품, 매출, 주문, CS 성과입니다." },
  coupang: { title: "쿠팡", description: "쿠팡 스토어의 상품, 매출, 주문, CS 성과입니다." },
  elevenst: { title: "11번가", description: "11번가 셀러오피스의 상품, 매출, 주문, CS 성과입니다." },
  smartstore: { title: "네이버 스마트스토어", description: "스마트스토어의 상품, 매출, 주문, CS 성과입니다." },
  ebay: { title: "eBay Global", description: "글로벌 스토어의 상품, 매출, 주문, CS 성과입니다." },
  temu: { title: "Temu Korea", description: "Temu 한국 스토어의 상품, 매출, 주문, CS 성과입니다." },
  alibaba: { title: "Alibaba.com", description: "글로벌 B2B 채널 연동을 준비하고 있습니다." },
  one688: { title: "1688.com", description: "중국 내수 B2B 채널 연동을 준비하고 있습니다." },
  acceptance: { title: "개발 · 실검수", description: "PPT 기반 175개 요구사항의 개발 상태와 실제 작동 증거를 분리해 관리합니다." },
  storyboard: { title: "서비스 스토리보드", description: "로그인부터 자동 등록, 판매, CS까지의 전체 사용자 흐름입니다." },
};

const ticketChannelCodes: Record<string, string> = {
  Qoo10: "Q",
  Shopee: "S",
  Lazada: "L",
  쿠팡: "C",
  "11번가": "11",
  "네이버 스마트스토어": "N",
  eBay: "E",
  Temu: "T",
};

const channelByCode = new Map(Object.values(channels).map((channel) => [channel.letter, channel]));
const enabledSalesChannelCount = Object.values(channels).filter((channel) => channel.enabled).length;
const deepLinkViews = new Set<View>(["overview", "products", "publishing", "margin", "orders", "cs", "connections"]);
type DisplayProduct = {
  id: string;
  sourceId: string;
  name: string;
  sku: string;
  description: string;
  sourceUrl: string | null;
  image: string | null;
  onHand: number;
  reserved: number;
  stock: number;
  costKrw: number;
  sales: number;
  revenueKrw: number;
  revenue: string;
  status: string;
  channels: string[];
  updatedAt: string;
};

type DisplayOrder = {
  sourceId: string;
  id: string;
  channelKey: string;
  channel: string;
  customer: string;
  product: string;
  amount: string;
  status: string;
  time: string;
};

type DisplayTicket = {
  sourceId: string;
  id: string;
  channelKey: string;
  customer: string;
  channel: string;
  subject: string;
  originalMessage: string;
  preview: string;
  replyDraft: string | null;
  time: string;
  status: "긴급" | "답변 대기" | "처리 중" | "처리 완료";
};

type SupportLocale = "ko-KR" | "en-US" | "ja-JP" | "zh-TW" | "th-TH" | "vi-VN" | "id-ID" | "ms-MY" | "pt-BR" | "es-MX";

const supportLocaleLabels: Record<SupportLocale, string> = {
  "ko-KR": "한국어", "en-US": "영어", "ja-JP": "일본어", "zh-TW": "중국어(번체)", "th-TH": "태국어",
  "vi-VN": "베트남어", "id-ID": "인도네시아어", "ms-MY": "말레이어", "pt-BR": "포르투갈어", "es-MX": "스페인어",
};

const supportReplyTemplates = [
  { label: "주문 확인 안내", value: "문의해 주셔서 감사합니다. 주문 내역과 현재 처리 상태를 확인한 뒤 정확한 내용으로 다시 안내드리겠습니다." },
  { label: "배송 확인 안내", value: "배송으로 불편을 드려 죄송합니다. 판매채널에 등록된 배송 상태와 운송장 정보를 확인한 뒤 안내드리겠습니다." },
  { label: "교환·반품 확인", value: "교환·반품 요청 내용을 확인했습니다. 상품 상태와 판매채널 정책을 확인한 뒤 가능한 처리 방법을 안내드리겠습니다." },
];

type UnifiedSearchResult = {
  kind: "product" | "order" | "inquiry";
  id: string;
  title: string;
  subtitle: string;
  meta: string;
  searchable: string;
};

function normalizeSearchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/\s+/g, " ").trim();
}

function matchesSearch(searchable: string, query: string) {
  const tokens = normalizeSearchText(query).split(" ").filter(Boolean);
  const normalized = normalizeSearchText(searchable);
  return tokens.length > 0 && tokens.every((token) => normalized.includes(token));
}

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
  elevenst: "11번가",
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
  return <span className={`channel-mark ${size} ${config.mark.length > 2 ? "wide" : ""}`} title={config.name} aria-label={config.name} style={{ "--channel-color": config.color } as React.CSSProperties}>{config.mark}</span>;
}

function StatusBadge({ status }: { status: string }) {
  const tone = status.includes("완료") || status === "판매중" || status === "정상" ? "success" : status.includes("주의") || status.includes("대기") || status === "처리 중" ? "warning" : status.includes("긴급") || status === "품절" || status.includes("실패") ? "danger" : "neutral";
  return <span className={`status-badge ${tone}`}><i />{status}</span>;
}

function credentialConnectionLabel(status: string | undefined) {
  if (status === "active") return "읽기 진단 정상";
  if (status === "unverified") return "키 등록됨 · 진단 필요";
  return "API 키 등록 필요";
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
        <div className="brand-lockup"><span className="brand-symbol"><Zap size={18} fill="currentColor" /></span><strong>SellerPilot</strong><small>SELLER CONTROL</small></div>
        <div className="login-message">
          <span className="login-section-label">글로벌 셀러 통합 업무 화면</span>
          <h1>주문·상품·문의 업무를<br />하나의 작업대에서.</h1>
          <p>판매 채널을 오가며 확인하던 주문, 상품 등록, 재고, 정산과 고객 문의를<br />업무 우선순위에 맞춰 한 화면에 정리했습니다.</p>
          <div className="login-operations-preview">
            <div className="preview-heading"><b>운영 워크플로</b><span>LIVE DATA ONLY</span></div>
            <div className="preview-task urgent"><span>01</span><div><b>상품 등록 전 검증</b><small>카테고리 · 필수속성 · 이미지 확인</small></div><strong>READY</strong></div>
            <div className="preview-task"><span>02</span><div><b>판매 채널 동기화</b><small>유효한 API 키가 있는 채널만 실행</small></div><strong>API</strong></div>
            <div className="preview-task"><span>03</span><div><b>주문 · 문의 통합</b><small>실제 주문과 고객 문의만 운영 DB 집계</small></div><strong>LIVE</strong></div>
            <div className="preview-settlement"><span>대시보드 집계 기준</span><b>실데이터 전용</b><em>샘플 자동 생성 없음</em></div>
          </div>
          <div className="login-market-row"><span>판매 채널</span><div><ChannelMark code="Q" size="sm" /><ChannelMark code="S" size="sm" /><ChannelMark code="L" size="sm" /><ChannelMark code="C" size="sm" /><ChannelMark code="11" size="sm" /><ChannelMark code="N" size="sm" /><ChannelMark code="E" size="sm" /><ChannelMark code="T" size="sm" /></div><b><i />연동 상태 통합 관리</b></div>
        </div>
        <footer><span>SellerPilot Commerce Control</span><span>상품 · 주문 · CS · 정산 통합 운영</span></footer>
      </section>

      <section className="login-form-panel">
        <div className="mobile-brand"><div className="brand-lockup"><span className="brand-symbol"><Zap size={18} fill="currentColor" /></span><strong>SellerPilot</strong></div></div>
        <form className="login-card" onSubmit={submit}>
          <div className="login-card-heading">
            <span className="secure-mark"><LockKeyhole size={21} /></span>
            <h2>운영센터 로그인</h2>
            <p>관리자 계정으로 통합 대시보드에 접속하세요.</p>
          </div>
          <label className="field-label" htmlFor="email">아이디</label>
          <div className="input-wrap"><UserRound size={17} /><input id="email" type="text" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="관리자 아이디 또는 이메일" /></div>
          <div className="field-row"><label className="field-label" htmlFor="password">비밀번호</label><button type="button" className="text-button" onClick={() => void requestPasswordReset()}>비밀번호 찾기</button></div>
          <div className="input-wrap"><LockKeyhole size={17} /><input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /><button type="button" className="password-toggle" aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"} onClick={() => setShowPassword((current) => !current)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          <div className="remember-row"><span><Check size={12} /></span>이 브라우저에서 로그인 세션 유지</div>
          {error && <p className="login-error"><AlertCircle size={14} />{error}</p>}
          <button className="login-button" type="submit" disabled={loading}>{loading ? <><LoaderCircle className="spin" size={18} />접속 중...</> : <>대시보드 접속<ArrowRight size={18} /></>}</button>
          <div className="demo-account"><ShieldCheck size={15} /><span>Supabase Auth로 인증하며 채널 키 원문은 로그인 후에도 표시하지 않습니다.<br /><b>관리자 초대 메일에서 비밀번호를 설정해 주세요.</b></span></div>
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
      <div className="metric-foot">{delta ? <span className={reverse ? "negative" : "positive"}>{reverse ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{delta}</span> : <span className="neutral"><Activity size={13} />LIVE</span>}<small>{detail}</small></div>
    </article>
  );
}

function formatCompactWon(value: number) {
  return `₩${Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
}

function ProductVisual({ src, size, alt = "상품 이미지" }: { src: string | null; size: string; alt?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return src && failedSrc !== src
    ? <Image src={src} alt={alt} fill sizes={size} unoptimized onError={() => setFailedSrc(src)} />
    : <span className="product-image-missing" role="img" aria-label={`${alt} 없음`}><Package size={17} /><small>이미지 없음</small></span>;
}

function OverviewPage({ onNavigate, onOpenProduct, displayProducts, operationSummary, channelMetrics, pipeline, operationsAvailable }: {
  onNavigate: (view: View) => void;
  onOpenProduct: (product: DisplayProduct) => void;
  displayProducts: DisplayProduct[];
  operationSummary: OperationsSnapshot["summary"] | null;
  channelMetrics: OperationsSnapshot["channelMetrics"];
  pipeline: OperationsSnapshot["pipeline"] | null;
  operationsAvailable: boolean;
}) {
  const [exchangeRates, setExchangeRates] = useState(initialExchangeRates);
  const [rateUpdatedAt, setRateUpdatedAt] = useState("화면 기준값");
  const [rateSource, setRateSource] = useState("실데이터 확인 중");
  const [today] = useState(() => new Date());
  const monthlyTopProducts = useMemo(() => [...displayProducts]
    .filter((product) => product.sales > 0)
    .sort((a, b) => b.sales - a.sales || b.revenueKrw - a.revenueKrw || a.name.localeCompare(b.name, "ko"))
    .slice(0, 10), [displayProducts]);
  const activeMetrics = useMemo(() => channelMetrics
    .filter((channel) => activeChannelKeys.includes(channel.channelKey as (typeof activeChannelKeys)[number]))
    .sort((left, right) => right.revenue30dKrw - left.revenue30dKrw || right.orderCount - left.orderCount || left.name.localeCompare(right.name, "ko")), [channelMetrics]);
  const summary = operationSummary ?? { revenue30dKrw: 0, sold30d: 0, orderCount: 0, paidOrderCount: 0, readyToShipCount: 0, openTicketCount: 0, lowStockCount: 0, productCount: 0, registrationErrorCount: 0, registrationBlockedCount: 0, activeCredentialCount: 0, registeredCredentialCount: 0 };
  const livePipeline = pipeline ?? { aiRunning: 0, listingQueued: 0, listingPublished: 0, listingFailed: 0, listingBlocked: 0 };
  const totalTasks = summary.paidOrderCount + summary.readyToShipCount + summary.openTicketCount + summary.registrationErrorCount;
  const totalListings = livePipeline.listingPublished + livePipeline.listingFailed + livePipeline.listingBlocked;
  const successRate = totalListings > 0 ? (livePipeline.listingPublished / totalListings) * 100 : 0;
  const maxChannelRevenue = Math.max(1, ...activeMetrics.map((channel) => channel.revenue30dKrw));
  const currentDate = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(today);
  const rangeStart = new Date(today.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
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
        <div className="briefing-copy"><span>{currentDate}</span><h2>현재 즉시 처리할 업무가 <b>{operationsAvailable ? `${totalTasks}건` : "확인 중"}</b> 있습니다.</h2><p>결제완료·출고대기·미처리 CS·재시도 가능 등록 오류만 집계합니다. 재고주의와 외부 권한 대기는 별도 표시합니다.</p></div>
        <div className="briefing-tasks">
          <button onClick={() => onNavigate("orders")}><span className="task-tone order" /><small>통합 주문</small><b>{operationsAvailable ? summary.orderCount : "—"}</b><em>실주문 원장</em></button>
          <button onClick={() => onNavigate("orders")}><span className="task-tone shipping" /><small>출고 대기</small><b>{operationsAvailable ? summary.readyToShipCount : "—"}</b><em>채널 상태 동기화</em></button>
          <button onClick={() => onNavigate("cs")}><span className="task-tone claim" /><small>미처리 CS</small><b>{operationsAvailable ? summary.openTicketCount : "—"}</b><em>통합 문의함</em></button>
          <button onClick={() => onNavigate("publishing")}><span className="task-tone error" /><small>재시도 오류</small><b>{operationsAvailable ? summary.registrationErrorCount : "—"}</b><em>권한 대기 {summary.registrationBlockedCount}건</em></button>
        </div>
        <aside className="briefing-settlement"><span>실제 연결 확인</span><strong>{operationsAvailable ? `${summary.activeCredentialCount} / ${enabledSalesChannelCount} 진단 통과` : "확인 중"}</strong><small>운영 키 {summary.registeredCredentialCount} / {enabledSalesChannelCount} · 미등록·미검증 채널을 전체 수에서 숨기지 않습니다.</small><button onClick={() => onNavigate("connections")}>채널 연결 관리<ChevronRight size={14} /></button></aside>
      </section>
      <section className="overview-toolbar">
        <article className="exchange-widget" aria-label="현재 환율">
          <div className="exchange-title"><span><i />기준 환율</span><small>KRW 기준 · {rateUpdatedAt}</small><small>{rateSource}</small></div>
          <div className="exchange-rate-list">{exchangeRates.map((rate) => <div className="exchange-rate" key={rate.code}><small>{rate.code} {rate.unit}</small><strong>₩{rate.value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><em className={rate.change >= 0 ? "up" : "down"}>{rate.change >= 0 ? "▲" : "▼"} {Math.abs(rate.change).toFixed(2)}%</em></div>)}</div>
          <button type="button" className="exchange-refresh" aria-label="환율 새로고침" title="환율 새로고침" onClick={refreshExchangeRates}><RefreshCw size={14} /></button>
        </article>
        <div className="overview-date-actions"><div className="period-control"><CalendarDays size={15} /><time dateTime={rangeStart}>{rangeStart}</time><span>—</span><time dateTime={rangeEnd}>{rangeEnd}</time></div><div className="segmented-control fixed-period" aria-label="집계 기간"><span>최근 30일 실데이터</span></div></div>
      </section>

      <section className="metric-grid">
        <MetricCard label="30일 매출" value={operationsAvailable ? formatCompactWon(summary.revenue30dKrw) : "—"} detail="실제 게시 상품 매출 집계" icon={CircleDollarSign} tone="violet" />
        <MetricCard label="주문" value={operationsAvailable ? summary.orderCount.toLocaleString() : "—"} detail={`결제완료 ${summary.paidOrderCount} · 출고대기 ${summary.readyToShipCount}`} icon={ShoppingBag} tone="blue" />
        <MetricCard label="관리 상품" value={operationsAvailable ? summary.productCount.toLocaleString() : "—"} detail={`최근 30일 ${summary.sold30d.toLocaleString()}개 판매`} icon={PackageCheck} tone="green" />
        <MetricCard label="미처리 CS" value={operationsAvailable ? summary.openTicketCount.toLocaleString() : "—"} detail={`재고주의 ${summary.lowStockCount}건`} icon={MessageCircleMore} tone="orange" />
      </section>

      <section className="dashboard-main-grid">
        <article className="panel revenue-panel">
          <div className="panel-heading"><div><span className="panel-kicker">실매출 분석</span><h3>채널별 최근 30일 매출</h3></div><button className="ghost-button" onClick={() => onNavigate("products")}>상품 원장<ChevronRight size={15} /></button></div>
          <div className="live-channel-bars">{activeMetrics.map((channel) => <button key={channel.channelKey} onClick={() => onNavigate(channel.channelKey as View)}><span><i style={{ background: channel.color }} />{channel.name}</span><b>{formatCompactWon(channel.revenue30dKrw)}</b><em>{channel.orderCount.toLocaleString()}건</em><small><i style={{ width: `${Math.round((channel.revenue30dKrw / maxChannelRevenue) * 100)}%`, background: channel.color }} /></small></button>)}</div>
        </article>

        <article className="panel top-ranking-card">
          <div className="panel-heading"><div><span className="panel-kicker">최근 30일 판매량 기준</span><h3>이번 달 판매 TOP 10</h3></div><span className="rank-crown">1–10</span></div>
          <div className="monthly-ranking-list">
            {monthlyTopProducts.map((product, index) => <button className={`ranking-row ${index < 3 ? "podium" : ""}`} key={product.id} onClick={() => onOpenProduct(product)}>
              <span className="ranking-number">{index + 1}</span>
              <span className="ranking-thumb"><ProductVisual src={product.image} size="38px" /></span>
              <span className="ranking-product"><b>{product.name}</b><small>{product.channels.length}개 채널 판매중</small></span>
              <span className="ranking-channels">{product.channels.slice(0, 3).map((code) => <ChannelMark key={code} code={code} size="sm" />)}{product.channels.length > 3 && <em>+{product.channels.length - 3}</em>}</span>
              <span className="ranking-sales"><b>{product.sales.toLocaleString()}개</b><small>{product.revenue}</small></span>
            </button>)}
            {monthlyTopProducts.length === 0 && <div className="live-empty-state"><PackageSearch size={26} /><b>실판매 상품이 아직 없습니다.</b><small>채널 키 연결 후 상품·주문 동기화를 실행하면 순위가 표시됩니다.</small></div>}
          </div>
          <button className="full-ghost-button" onClick={() => onNavigate("products")}>전체 상품 성과 보기<ArrowRight size={15} /></button>
        </article>
      </section>

      <section className="dashboard-lower-grid">
        <article className="panel channel-performance">
          <div className="panel-heading"><div><span className="panel-kicker">실계정 운영 상태</span><h3>채널별 실데이터</h3></div><span className="live-label"><i />LIVE</span></div>
          <div className="channel-list">
            {activeMetrics.map((channel) => <button className="channel-row" key={channel.channelKey} onClick={() => onNavigate(channel.channelKey as View)}><ChannelMark code={channel.channelCode} /><div className="channel-name"><strong>{channel.name}</strong><span className={channel.credentialStatus === "active" ? "connected" : channel.credentialStatus === "unverified" ? "pending" : ""}><i />{credentialConnectionLabel(channel.credentialStatus)}</span></div><div className="channel-metric"><small>30일 매출</small><b>{formatCompactWon(channel.revenue30dKrw)}</b></div><div className="channel-metric"><small>실주문</small><b>{channel.orderCount.toLocaleString()}</b></div><div className="channel-progress"><span><i style={{ width: `${channel.credentialStatus === "active" ? 100 : channel.credentialStatus === "unverified" ? 55 : 0}%` }} /></span><b>{channel.failedAttemptCount ? `오류 ${channel.failedAttemptCount}` : "정상"}</b></div><ChevronRight size={16} /></button>)}
          </div>
        </article>

        <article className="panel automation-status">
          <div className="panel-heading"><div><span className="panel-kicker">오늘 자동 등록 작업</span><h3>상품 등록 현황</h3></div><button className="ghost-button" onClick={() => onNavigate("publishing")}>전체 보기<ChevronRight size={15} /></button></div>
          <div className="pipeline-summary"><div><strong>{totalListings}</strong><span>실제 등록 처리</span></div><i /><div><strong>{successRate.toFixed(1)}%</strong><span>등록 성공률</span></div></div>
          <div className="pipeline-list">
            {[{ label: "AI 분석 중", value: livePipeline.aiRunning, tone: "violet", icon: WandSparkles }, { label: "채널 등록 대기", value: livePipeline.listingQueued, tone: "blue", icon: Upload }, { label: "등록 완료", value: livePipeline.listingPublished, tone: "green", icon: CheckCircle2 }, { label: "재시도 가능", value: livePipeline.listingFailed, tone: "red", icon: AlertCircle }, { label: "외부 권한 대기", value: livePipeline.listingBlocked, tone: "orange", icon: ShieldCheck }].map((item) => <div key={item.label}><span className={`pipeline-icon ${item.tone}`}><item.icon size={16} /></span><span>{item.label}</span><strong>{item.value}<small>건</small></strong></div>)}
          </div>
        </article>
      </section>

      <section className="dashboard-bottom-grid">
        <article className="panel alert-panel">
          <div className="panel-heading"><div><span className="panel-kicker">운영 참고·조치</span><h3>재고·등록·CS 전체 현황</h3></div><span className="count-chip">{summary.lowStockCount + summary.registrationErrorCount + summary.registrationBlockedCount + summary.openTicketCount}</span></div>
          <div className="alert-list">
            <button onClick={() => onNavigate("products")}><span className="alert-icon danger"><Box size={16} /></span><span><b>재고주의 상품 {summary.lowStockCount}건</b><small>실재고와 재주문 기준으로 집계했습니다.</small></span><em>상품 보기<ChevronRight size={14} /></em></button>
            <button onClick={() => onNavigate("publishing")}><span className="alert-icon warning"><AlertCircle size={16} /></span><span><b>채널 등록 실패 {summary.registrationErrorCount}건</b><small>카테고리·필수 속성·API 응답을 확인하세요.</small></span><em>오류 보기<ChevronRight size={14} /></em></button>
            <button onClick={() => onNavigate("connections")}><span className="alert-icon warning"><ShieldCheck size={16} /></span><span><b>외부 판매 권한 대기 {summary.registrationBlockedCount}건</b><small>같은 요청을 반복하지 않고 판매자센터 권한·인증 보완을 기다립니다.</small></span><em>연결 보기<ChevronRight size={14} /></em></button>
            <button onClick={() => onNavigate("cs")}><span className="alert-icon blue"><MessageCircleMore size={16} /></span><span><b>미처리 CS {summary.openTicketCount}건</b><small>각 채널에서 동기화된 실제 문의입니다.</small></span><em>답변하기<ChevronRight size={14} /></em></button>
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

function ProductsPage({ onNavigate, onOpenProduct, onRefresh, displayProducts }: {
  onNavigate: (view: View) => void;
  onOpenProduct: (product: DisplayProduct) => void;
  onRefresh: () => Promise<void>;
  displayProducts: DisplayProduct[];
}) {
  const [query, setQuery] = useState("");
  const [channelFilter, setChannelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pageSize = 25;
  const availableChannels = useMemo(() => [...new Set(displayProducts.flatMap((product) => product.channels))]
    .sort((left, right) => (channelByCode.get(left)?.name ?? left).localeCompare(channelByCode.get(right)?.name ?? right, "ko")), [displayProducts]);
  const availableStatuses = useMemo(() => [...new Set(displayProducts.map((product) => product.status))].sort((left, right) => left.localeCompare(right, "ko")), [displayProducts]);
  const filtered = displayProducts.filter((product) => {
    const searchable = `${product.name} ${product.sku} ${product.id}`;
    return (!query.trim() || matchesSearch(searchable, query))
      && (channelFilter === "all" || product.channels.includes(channelFilter))
      && (statusFilter === "all" || product.status === statusFilter);
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * pageSize;
  const pagedProducts = filtered.slice(pageStart, pageStart + pageSize);
  const activeCount = displayProducts.filter((product) => product.status === "판매중").length;
  const lowStockCount = displayProducts.filter((product) => product.status === "재고주의").length;
  const outOfStockCount = displayProducts.filter((product) => product.status === "품절").length;
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <div className="page-stack">
      <section className="summary-strip"><div><Package size={18} /><span>전체 상품<strong>{displayProducts.length}</strong></span></div><div><CheckCircle2 size={18} /><span>정상 판매<strong>{activeCount}</strong></span></div><div><AlertCircle size={18} /><span>재고 주의<strong>{lowStockCount}</strong></span></div><div><Box size={18} /><span>품절<strong>{outOfStockCount}</strong></span></div><button className="primary-button" onClick={() => onNavigate("publishing")}><Plus size={16} />새 상품 등록</button></section>
      <section className="panel data-panel">
        <div className="data-toolbar"><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="상품명, SKU 검색" /></div><label className="filter-select"><Filter size={15} /><span className="sr-only">판매 채널 필터</span><select value={channelFilter} onChange={(event) => { setChannelFilter(event.target.value); setPage(1); }}><option value="all">전체 채널</option>{availableChannels.map((code) => <option value={code} key={code}>{channelByCode.get(code)?.mark ?? code}</option>)}</select><ChevronDown size={14} /></label><label className="filter-select"><ListFilter size={15} /><span className="sr-only">상품 상태 필터</span><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option value="all">전체 상태</option>{availableStatuses.map((status) => <option value={status} key={status}>{status}</option>)}</select><ChevronDown size={14} /></label><span className="toolbar-spacer" /><button className="icon-text-button" type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{refreshing ? "새로고침 중" : "목록 새로고침"}</button><div className="toolbar-menu"><button className="icon-only-button" type="button" aria-label="상품 추가 작업" aria-expanded={actionsOpen} onClick={() => setActionsOpen((open) => !open)}><MoreHorizontal size={18} /></button>{actionsOpen && <div className="toolbar-menu-popover" role="menu"><button type="button" role="menuitem" onClick={() => onNavigate("publishing")}>새 상품 등록</button><button type="button" role="menuitem" onClick={() => onNavigate("connections")}>채널 연결 관리</button></div>}</div></div>
        <div className="table-wrap"><table className="data-table product-table"><thead><tr><th>상품</th><th>판매 채널</th><th>재고</th><th>30일 판매</th><th>30일 매출</th><th>상태</th></tr></thead><tbody>{pagedProducts.map((product) => <tr key={product.id}><td><button type="button" className="product-cell product-cell-button" aria-label={`${product.name} 상품 상세정보 보기`} onClick={() => onOpenProduct(product)}><div className="product-thumb"><ProductVisual src={product.image} size="52px" alt={product.name} /></div><span><b>{product.name}</b><small>{product.sku} · {product.id}</small></span></button></td><td><div className="channel-stack">{product.channels.map((code) => <ChannelMark key={code} code={code} size="sm" />)}</div></td><td><strong className={product.stock < 20 ? "stock-low" : ""}>{product.stock}</strong><small> 개</small></td><td><b>{product.sales}</b><small> 개</small></td><td><b>{product.revenue}</b></td><td><StatusBadge status={product.status} /></td></tr>)}</tbody></table></div>
        {displayProducts.length === 0 ? <div className="live-empty-state table-empty"><PackageSearch size={28} /><b>실상품 데이터가 없습니다.</b><small>상품을 등록하거나 채널 동기화를 실행하면 이 목록에 표시됩니다.</small></div> : filtered.length === 0 ? <div className="live-empty-state table-empty"><Search size={28} /><b>검색 조건에 맞는 상품이 없습니다.</b><small>상품명 또는 SKU를 다시 확인해 주세요.</small></div> : null}
        <div className="table-footer"><span>총 {displayProducts.length}개 중 {filtered.length > 0 ? `${pageStart + 1}–${Math.min(pageStart + pageSize, filtered.length)}` : "0"}개 표시</span><div><button type="button" aria-label="이전 페이지" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronRight className="flip" size={15} /></button>{Array.from({ length: totalPages }, (_, index) => index + 1).slice(Math.max(0, currentPage - 3), Math.max(5, currentPage + 2)).map((pageNumber) => <button type="button" className={currentPage === pageNumber ? "active" : ""} onClick={() => setPage(pageNumber)} key={pageNumber}>{pageNumber}</button>)}<button type="button" aria-label="다음 페이지" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}><ChevronRight size={15} /></button></div></div>
      </section>
    </div>
  );
}

function formatProductUpdatedAt(value: string) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "업데이트 시각 없음";
  return date.toLocaleString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

type ProductDetailAsset = {
  id?: string;
  path: string;
  url: string | null;
};

type ProductDetailLocalizedListing = {
  channel: string;
  market: string;
  locale: string;
  title: string;
  shortDescription: string;
  description: string;
};

type ProductDetailContext = {
  manualFields: Record<string, unknown>;
  sourceImages: ProductDetailAsset[];
  generatedImages: ProductDetailAsset[];
  localizedListings: ProductDetailLocalizedListing[];
};

type InventorySyncContext = {
  runId?: string;
  status?: string;
  requestedOnHand?: number;
  availableQuantity?: number;
  totalCount?: number;
  succeededCount?: number;
  failedCount?: number;
  tasks?: Array<{ id: string; channel: string; status: string; safeMessage?: string | null }>;
};

const emptyProductDetailContext: ProductDetailContext = {
  manualFields: {},
  sourceImages: [],
  generatedImages: [],
  localizedListings: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function detailFieldValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString("ko-KR");
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function ProductDetailPage({ product, onBack, authenticatedFetch }: {
  product: DisplayProduct;
  onBack: () => void;
  authenticatedFetch: (input: string, init?: RequestInit) => Promise<Response>;
}) {
  const [remoteListings, setRemoteListings] = useState<RemoteListingReference[]>([]);
  const [detailContext, setDetailContext] = useState<ProductDetailContext>(emptyProductDetailContext);
  const [remoteListingState, setRemoteListingState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [inventoryEditing, setInventoryEditing] = useState(false);
  const [inventoryOnHand, setInventoryOnHand] = useState(product.onHand);
  const [inventorySaving, setInventorySaving] = useState(false);
  const [inventorySync, setInventorySync] = useState<InventorySyncContext | null>(null);
  const [inventoryMessage, setInventoryMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void authenticatedFetch(`/api/admin/products/${product.sourceId}/publish-context`)
      .then(async (response) => {
        if (!response.ok) throw new Error("상품 채널 원격 정보를 불러오지 못했습니다.");
        const payload = await response.json() as Record<string, unknown>;
        const listings = Array.isArray(payload.listings)
          ? payload.listings.filter((item): item is RemoteListingReference => isRecord(item) && typeof item.channel === "string")
          : [];
        const parseAssets = (value: unknown): ProductDetailAsset[] => Array.isArray(value)
          ? value.filter(isRecord).map((item) => ({
            id: typeof item.id === "string" ? item.id : undefined,
            path: typeof item.path === "string" ? item.path : "",
            url: typeof item.url === "string" ? item.url : null,
          })).filter((item) => Boolean(item.path || item.url))
          : [];
        const localizedListings = Array.isArray(payload.localizedListings)
          ? payload.localizedListings.filter(isRecord).map((item) => ({
            channel: typeof item.channel === "string" ? item.channel : "",
            market: typeof item.market === "string" ? item.market : "",
            locale: typeof item.locale === "string" ? item.locale : "",
            title: typeof item.title === "string" ? item.title : "",
            shortDescription: typeof item.shortDescription === "string" ? item.shortDescription : "",
            description: typeof item.description === "string" ? item.description : "",
          })).filter((item) => Boolean(item.channel && item.title))
          : [];
        if (!cancelled) {
          setRemoteListings(listings);
          setDetailContext({
            manualFields: isRecord(payload.manualFields) ? payload.manualFields : {},
            sourceImages: parseAssets(payload.sourceImages),
            generatedImages: parseAssets(payload.generatedImages),
            localizedListings,
          });
          setRemoteListingState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteListings([]);
          setDetailContext(emptyProductDetailContext);
          setRemoteListingState("unavailable");
        }
      });
    return () => { cancelled = true; };
  }, [authenticatedFetch, product.sourceId]);

  useEffect(() => {
    void authenticatedFetch(`/api/admin/products/${product.sourceId}/inventory`)
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json() as { sync?: InventorySyncContext | null };
        setInventorySync(payload.sync ?? null);
      })
      .catch(() => null);
  }, [authenticatedFetch, product.sourceId]);

  const applyInventory = async () => {
    if (inventorySaving || !Number.isInteger(inventoryOnHand) || inventoryOnHand < product.reserved) {
      setInventoryMessage(`실재고는 예약 재고 ${product.reserved.toLocaleString()}개 이상이어야 합니다.`);
      return;
    }
    setInventorySaving(true);
    setInventoryMessage("");
    try {
      const response = await authenticatedFetch(`/api/admin/products/${product.sourceId}/inventory`, {
        method: "POST",
        body: JSON.stringify({ onHand: inventoryOnHand, confirmWrite: true }),
      });
      const payload = await response.json().catch(() => ({ message: "통합 재고 결과를 읽지 못했습니다." })) as { sync?: InventorySyncContext; results?: Array<{ ok: boolean }>; message?: string };
      if (!response.ok && response.status !== 207) throw new Error(payload.message ?? "통합 재고 적용에 실패했습니다.");
      setInventorySync(payload.sync ?? null);
      const failed = payload.results?.filter((item) => !item.ok).length ?? 0;
      setInventoryMessage(failed ? `중앙 재고는 저장됐고 ${failed}개 채널은 확인이 필요합니다.` : "중앙 재고와 게시된 판매채널 재고를 적용했습니다.");
      setInventoryEditing(false);
    } catch (error) {
      setInventoryMessage(error instanceof Error ? error.message : "통합 재고 적용에 실패했습니다.");
    } finally {
      setInventorySaving(false);
    }
  };

  const detailChannelKeys = useMemo(() => {
    const listed = new Set(remoteListings.map((listing) => listing.channel));
    const publishedCodes = new Set(product.channels);
    return activeChannelKeys.filter((key) => listed.has(key) || publishedCodes.has(channels[key].letter));
  }, [product.channels, remoteListings]);
  const manualFieldRows = [
    ["브랜드", detailFieldValue(detailContext.manualFields.brandName)],
    ["제조사·공급처", detailFieldValue(detailContext.manualFields.manufacturer)],
    ["원산지", detailFieldValue(detailContext.manualFields.countryOfOrigin)],
    ["소재·성분", detailFieldValue(detailContext.manualFields.material)],
    ["판매 구성", detailFieldValue(detailContext.manualFields.packageContents)],
    ["카테고리", detailFieldValue(detailContext.manualFields.categoryHint)],
    ["판매가", detailFieldValue(detailContext.manualFields.sellingPrice) && `${detailFieldValue(detailContext.manualFields.sellingPrice)} ${detailFieldValue(detailContext.manualFields.currency) ?? ""}`.trim()],
    ["포장 중량", detailFieldValue(detailContext.manualFields.weightKg) && `${detailFieldValue(detailContext.manualFields.weightKg)} kg`],
    ["포장 크기", [detailFieldValue(detailContext.manualFields.packageLengthCm), detailFieldValue(detailContext.manualFields.packageWidthCm), detailFieldValue(detailContext.manualFields.packageHeightCm)].every(Boolean)
      ? `${detailFieldValue(detailContext.manualFields.packageLengthCm)} × ${detailFieldValue(detailContext.manualFields.packageWidthCm)} × ${detailFieldValue(detailContext.manualFields.packageHeightCm)} cm`
      : null],
  ].filter((row): row is [string, string] => typeof row[1] === "string" && row[1].length > 0);
  const detailAssets = detailContext.generatedImages.length > 0 ? detailContext.generatedImages : detailContext.sourceImages;

  return (
    <div className="page-stack product-detail-page">
      <div className="product-detail-actions">
        <button type="button" className="product-detail-back" onClick={onBack}><ArrowLeft size={16} />상품 목록으로</button>
        <span><Clock3 size={14} />최근 수정 {formatProductUpdatedAt(product.updatedAt)}</span>
      </div>

      <section className="panel product-detail-hero">
        <div className="product-detail-image"><ProductVisual src={product.image} size="(max-width: 760px) 100vw, 420px" alt={product.name} /></div>
        <div className="product-detail-heading">
          <div><StatusBadge status={product.status} /><span className="product-detail-code">{product.id}</span></div>
          <h2>{product.name}</h2>
          <p>{product.description || "등록된 상품 설명이 없습니다."}</p>
          <dl className="product-detail-identifiers">
            <div><dt>SKU</dt><dd>{product.sku}</dd></div>
            <div><dt>상품 원장 ID</dt><dd>{product.sourceId}</dd></div>
          </dl>
        </div>
      </section>

      <section className="product-detail-metrics">
        <article className="panel"><span className="metric-icon blue"><Box size={17} /></span><div><small>실재고</small><strong>{product.onHand.toLocaleString()}개</strong><em>예약 {product.reserved.toLocaleString()}개 · 판매 가능 {product.stock.toLocaleString()}개</em></div></article>
        <article className="panel"><span className="metric-icon violet"><ShoppingBag size={17} /></span><div><small>최근 30일 판매</small><strong>{product.sales.toLocaleString()}개</strong><em>상품 원장 집계</em></div></article>
        <article className="panel"><span className="metric-icon green"><CircleDollarSign size={17} /></span><div><small>최근 30일 매출</small><strong>{product.revenue}</strong><em>원가 {formatCompactWon(product.costKrw)}</em></div></article>
      </section>

      <section className="panel product-inventory-editor">
        <div className="panel-heading"><div><span className="panel-kicker">INTEGRATED INVENTORY</span><h3>통합 재고 관리</h3></div><Box size={18} /></div>
        <div className="inventory-editor-grid">
          <div><small>현재 실재고</small><strong>{inventoryOnHand.toLocaleString()}개</strong><em>예약 {product.reserved.toLocaleString()}개 · 적용 수량 {(inventoryOnHand - product.reserved).toLocaleString()}개</em></div>
          <label><span>수정할 실재고</span><input type="number" min={product.reserved} max={99_999_999} value={inventoryOnHand} disabled={!inventoryEditing || inventorySaving} onChange={(event) => setInventoryOnHand(Math.max(0, Number(event.target.value) || 0))} /></label>
          <div className="inventory-editor-actions">{inventoryEditing ? <><button type="button" className="credential-secondary" disabled={inventorySaving} onClick={() => { setInventoryOnHand(product.onHand); setInventoryEditing(false); setInventoryMessage(""); }}>취소</button><button type="button" className="publish-execute" disabled={inventorySaving || inventoryOnHand < product.reserved} onClick={() => void applyInventory()}>{inventorySaving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{inventorySaving ? "채널 적용 중" : "모든 판매채널에 적용"}</button></> : <button type="button" className="publish-execute" onClick={() => setInventoryEditing(true)}>재고 수정</button>}</div>
        </div>
        <div className="inventory-sync-state"><span>최근 적용</span><b>{inventorySync?.status ? `${inventorySync.status} · 성공 ${inventorySync.succeededCount ?? 0}/${inventorySync.totalCount ?? 0}` : "적용 이력 없음"}</b>{inventorySync?.failedCount ? <em>{inventorySync.failedCount}개 채널 확인 필요</em> : null}</div>
        {inventoryMessage ? <p className="inventory-editor-message">{inventoryMessage}</p> : null}
      </section>

      <section className="product-detail-grid">
        <article className="panel product-detail-section">
          <div className="panel-heading"><div><span className="panel-kicker">REGISTERED CONTENT</span><h3>등록한 상품 정보</h3></div><PackageCheck size={18} /></div>
          <div className="product-detail-description"><h4>상품 설명</h4><p>{product.description || "상품 설명이 아직 등록되지 않았습니다."}</p></div>
          <dl className="product-detail-ledger">
            <div><dt>상품명</dt><dd>{product.name}</dd></div>
            <div><dt>상품 코드</dt><dd>{product.id}</dd></div>
            <div><dt>SKU</dt><dd>{product.sku}</dd></div>
            <div><dt>판매 상태</dt><dd>{product.status}</dd></div>
            {manualFieldRows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
          </dl>
        </article>
        <article className="panel product-detail-section">
          <div className="panel-heading"><div><span className="panel-kicker">SALES CHANNELS</span><h3>판매 채널 상태</h3></div><Store size={18} /></div>
          {detailChannelKeys.length > 0 ? <div className="product-detail-channels">{detailChannelKeys.map((channelKey) => {
            const channel = channels[channelKey];
            const code = channel.letter;
            const listing = remoteListings.filter((item) => item.channel === channelKey).sort((a, b) => Number(Boolean(marketplaceListingUrl(b))) - Number(Boolean(marketplaceListingUrl(a))) || Number(b.status === "published") - Number(a.status === "published") || Number(Boolean(b.remoteId)) - Number(Boolean(a.remoteId)))[0];
            const listingReference = listing ?? { channel: channelKey };
            const destination = marketplaceListingUrl(listingReference);
            const stateCopy = remoteListingState === "loading"
              ? "원격 상품번호 확인 중"
              : listing?.publicPageStatus === "unavailable"
                ? `등록 완료 · 공개 판매페이지 비활성 · 원격 ID ${listing.remoteId ?? "확인 필요"}`
              : listing?.remoteId
                ? `${listing.status === "published" ? "등록 완료" : listing.status ?? "상품 연결"} · 원격 ID ${listing.remoteId}`
                : remoteListingState === "unavailable" ? "연결 정보 조회 실패" : listing?.status ? `${listing.status} · 판매 상품 주소 확인 필요` : "게시 이력 없음";
            return <div key={channelKey}><ChannelMark code={code} /><span><b>{channel.name}</b><small>{stateCopy}</small>{listing?.lastError ? <em>{listing.lastError}</em> : null}</span>{destination ? <a className="product-channel-link" href={destination} target="_blank" rel="noreferrer">{marketplaceListingLinkLabel(listingReference)}<ExternalLink size={13} /></a> : <span className="product-channel-unavailable">판매 상품 주소 확인 필요</span>}</div>;
          })}</div> : remoteListingState === "loading" ? <div className="product-detail-empty"><LoaderCircle className="spin" size={24} /><b>상품 채널 연결을 확인하고 있습니다.</b><small>등록 시도·게시 완료·실패 이력을 함께 불러옵니다.</small></div> : <div className="product-detail-empty"><Store size={24} /><b>연결된 판매 채널이 없습니다.</b><small>현재 상품 정보만 등록되어 있으며 채널 게시 전 상태입니다.</small></div>}
        </article>
      </section>

      <section className="panel product-detail-assets">
        <div className="panel-heading"><div><span className="panel-kicker">GENERATED DETAIL PAGE</span><h3>등록 이미지 · 상세페이지 디자인</h3></div><ImagePlus size={18} /></div>
        {remoteListingState === "loading" ? <div className="product-detail-empty compact"><LoaderCircle className="spin" size={22} /><b>상세페이지 결과를 불러오는 중입니다.</b></div> : detailAssets.length > 0 ? <div className="product-detail-asset-grid">{detailAssets.map((asset, index) => <figure key={`${asset.id ?? asset.path}-${index}`}><div><ProductVisual src={asset.url} size="(max-width: 760px) 88vw, 280px" alt={`${product.name} ${asset.id ?? `상품 이미지 ${index + 1}`}`} /></div><figcaption>{asset.id?.replaceAll("-", " ") ?? `원본 이미지 ${index + 1}`}</figcaption></figure>)}</div> : <div className="product-detail-empty compact"><ImagePlus size={24} /><b>저장된 상세 이미지가 없습니다.</b><small>기존 텍스트 상품이거나 이미지 생성 결과가 상품 원장에 연결되지 않은 상태입니다.</small></div>}
      </section>

    </div>
  );
}

type UploadedPhoto = { name: string; url: string; file: File; role: string; originalWidth: number; originalHeight: number };

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

function PublishingPage({ notify, channelMetrics, pipeline, listingIssues, onOpenIssue, initialProduct }: { notify: (message: string) => void; channelMetrics: OperationsSnapshot["channelMetrics"]; pipeline: OperationsSnapshot["pipeline"] | null; listingIssues: OperationsSnapshot["listingIssues"]; onOpenIssue: (productId: string) => void; initialProduct?: { id: string; name: string } | null }) {
  const [running, setRunning] = useState(false);
  const [mainPhoto, setMainPhoto] = useState<UploadedPhoto | null>(null);
  const [slotPhotos, setSlotPhotos] = useState<Record<string, UploadedPhoto>>({});
  const [extraPhotos, setExtraPhotos] = useState<UploadedPhoto[]>([]);
  const [intake, setIntake] = useState<ProductIntakeDraft>(() => ({ ...emptyProductIntake }));
  const [manualErrors, setManualErrors] = useState<Record<string, string>>({});
  const [uploadError, setUploadError] = useState("");
  const [researchingProduct, setResearchingProduct] = useState(false);
  const [researchResult, setResearchResult] = useState<ProductResearchResult | null>(null);
  const [studioRequestId, setStudioRequestId] = useState(0);
  const [analyzedProductName, setAnalyzedProductName] = useState(initialProduct?.name ?? "");
  const [analyzedProductId, setAnalyzedProductId] = useState<string | null>(initialProduct?.id ?? null);
  const [categoryDraftRef] = useState(() => crypto.randomUUID());
  const [publishRefreshVersion, setPublishRefreshVersion] = useState(0);
  const [channelSelection, setChannelSelection] = useState<Record<string, boolean>>({});
  const connectedChannelKeys = useMemo(() => channelMetrics
    .filter((metric) => metric.credentialStatus === "active" && activeChannelKeys.includes(metric.channelKey as (typeof activeChannelKeys)[number]))
    .map((metric) => metric.channelKey), [channelMetrics]);
  const selectedChannels = useMemo(() => connectedChannelKeys.filter((key) => channelSelection[key] !== false), [channelSelection, connectedChannelKeys]);

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

  const waitForProductResearch = async (jobId: string, accessToken: string) => {
    const deadline = Date.now() + 20 * 60_000;
    while (Date.now() < deadline) {
      const response = await fetch(`/api/ai/jobs/${jobId}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({ message: "CLI 상품정보 상태를 읽지 못했습니다." })) as {
        status?: "queued" | "running" | "succeeded" | "failed" | "cancelled";
        result?: ProductResearchResult | null;
        error?: string | null;
        message?: string;
      };
      if (!response.ok) throw new Error(payload.message ?? "CLI 상품정보 작업 상태를 확인하지 못했습니다.");
      if (payload.status === "succeeded" && payload.result?.mode === "cli-research") return payload.result;
      if (payload.status === "failed" || payload.status === "cancelled") throw new Error(payload.error || "CLI 상품정보 수집이 완료되지 못했습니다.");
      await new Promise((resolve) => window.setTimeout(resolve, 3_000));
    }
    throw new Error("CLI 상품정보 수집 대기시간이 20분을 초과했습니다.");
  };

  const researchProductInformation = async () => {
    const researchInput = intake.researchInput.trim();
    if (researchingProduct || researchInput.length < 2) {
      if (!researchingProduct) notify("상품 판매페이지 링크, 모델명 또는 설명을 입력해 주세요.");
      return;
    }
    setResearchingProduct(true);
    setUploadError("");
    try {
      const { data: sessionData } = await createSupabaseClient().auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("CLI 상품정보 수집을 실행하려면 관리자 로그인이 필요합니다.");
      const jobId = crypto.randomUUID();
      const response = await fetch("/api/ai/product-research", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ jobId, researchInput }),
      });
      const queued = await response.json().catch(() => ({ message: "CLI 상품정보 요청 응답을 읽지 못했습니다." })) as { jobId?: string; message?: string };
      if (!response.ok || !queued.jobId) throw new Error(queued.message || "CLI 상품정보 수집 작업을 등록하지 못했습니다.");
      notify("ChatGPT CLI가 링크 본문과 입력 텍스트에서 상세 상품정보를 조사하고 있습니다.");
      const result = await waitForProductResearch(queued.jobId, accessToken);
      const suggestion = result.suggestedFields;
      const firstReadableSource = result.sources.find((source) => source.status === "read")?.url ?? "";
      setIntake((current) => ({
        ...current,
        productName: current.productName.trim() || suggestion.productName || "",
        categoryHint: current.categoryHint.trim() || suggestion.categoryHint || "",
        brandName: current.brandName.trim() || suggestion.brandName || "",
        manufacturer: current.manufacturer.trim() || suggestion.manufacturer || "",
        countryOfOrigin: current.countryOfOrigin.trim() || suggestion.countryOfOrigin || "",
        material: current.material.trim() || suggestion.material || "",
        packageContents: current.packageContents.trim() || suggestion.packageContents || "",
        description: current.description.trim() || suggestion.description || "",
        productUrl: current.productUrl.trim() || firstReadableSource,
        gtinStatus: current.gtin || !suggestion.gtin ? current.gtinStatus : "HAS_GTIN",
        gtin: current.gtin || suggestion.gtin || "",
      }));
      setResearchResult(result);
      setManualErrors({});
      notify("CLI가 확인한 상품 상세정보를 빈 입력란에 자동 반영했습니다. 불확실한 값은 비워 두었습니다.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "CLI 상품정보 수집 중 오류가 발생했습니다.";
      setUploadError(message);
      notify(message);
    } finally {
      setResearchingProduct(false);
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

  const totalPhotoCount = (mainPhoto ? 1 : 0) + Object.keys(slotPhotos).length + extraPhotos.length;
  const intakeReady = productIntakeSchema.safeParse(intake).success;
  const intakeCompletionItems = [
    intake.researchInput.trim().length >= 2,
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
        <div className="publishing-workflow-copy"><span className="eyebrow dark"><Sparkles size={14} /> 상품 등록 워크플로</span><h2>링크나 설명만 넣고 상품정보부터 불러오세요.</h2><p>ChatGPT CLI가 상품 상세정보를 먼저 조사하고, 대표사진·판매자 확인값과 교차검증한 뒤 한 상품씩 등록합니다.</p></div>
        <ol className="publishing-steps" aria-label="상품 등록 단계">
          <li className="active"><span>1</span><b>정보 불러오기</b><small>{intakeProgress}% 완료</small></li>
          <li><span>2</span><b>AI 분석</b><small>이미지·사실 검증</small></li>
          <li><span>3</span><b>채널 등록</b><small>{selectedChannels.length}개 채널 선택</small></li>
        </ol>
      </section>
      <section className="publishing-layout">
        <article className="panel upload-panel">
          <div className="panel-heading"><div><span className="panel-kicker">NEW PRODUCT</span><h3>새 상품 분석 자료</h3></div><span className="step-chip">STEP 1 / 3</span></div>

          <section className="main-photo-section">
            <div className="upload-section-heading"><div><b>대표사진</b><span className="required-chip">필수</span><small>검색 결과와 채널 목록에서 가장 먼저 보이는 이미지입니다.</small></div><em>{mainPhoto ? "1장 등록됨" : "미등록"}</em></div>
            <label className={`drop-zone main-drop-zone ${mainPhoto ? "has-photo" : ""} ${running ? "running" : ""}`} htmlFor="main-product-photo">
              <input id="main-product-photo" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectMainPhoto} />
              {mainPhoto ? <><span className="main-photo-preview"><Image src={mainPhoto.url} alt="등록한 대표 상품 사진" fill sizes="700px" unoptimized /></span><span className="photo-preview-overlay"><ImagePlus size={17} />대표사진 교체</span><strong className="photo-file-name">{mainPhoto.name} · {mainPhoto.originalWidth}×{mainPhoto.originalHeight} → 1200×1200</strong></> : <><span className="upload-graphic"><CloudUpload size={31} /></span><strong>대표 상품 사진을 넣으세요</strong><p>JPG, PNG, WEBP · 최소 600×600px · 자동 1:1 여백 보정</p><em><ImagePlus size={15} />대표사진 선택</em></>}
              {running && <span className="analysis-overlay"><LoaderCircle className="spin" size={29} /><b>사진·설명·링크 통합 분석 중</b><small>OCR과 상품 정보 교차검증을 진행하고 있습니다.</small><i><span /></i></span>}
            </label>
            <section className={`product-research-panel ${manualErrors.researchInput ? "field-error" : ""}`}>
              <div className="product-research-heading"><span><Bot size={17} /><b>상품 링크 또는 설명</b><em>CLI 자동 조사</em></span><small>판매페이지·제조사 링크, 모델명, 바코드, 카톡으로 받은 상품 설명을 그대로 넣으세요.</small></div>
              <div className="product-research-input"><Link2 size={17} /><textarea value={intake.researchInput} onChange={(event) => setIntakeField("researchInput", event.target.value)} maxLength={12_000} placeholder={"예: https://공급사.example/product/123\n또는 상품명, 모델명, 재질·구성 등 알고 있는 내용을 붙여넣으세요."} aria-label="상품 링크 또는 설명" /><button type="button" onClick={() => void researchProductInformation()} disabled={intake.researchInput.trim().length < 2 || researchingProduct || running}>{researchingProduct ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />}{researchingProduct ? "CLI 조사 중" : "상세정보 불러오기"}</button></div>
              <small className="product-research-help">CLI가 공개 페이지의 본문·상품 구조화 데이터와 입력 텍스트를 읽어 상품명, 브랜드, 제조사, 원산지, 소재, 구성, 특징, 사용법과 주의사항을 정리합니다.</small>
              {manualErrors.researchInput && <small className="product-research-error">{manualErrors.researchInput}</small>}
              {researchResult && <div className="product-research-result">
                <div><CheckCircle2 size={16} /><span><b>CLI 상세정보 반영 완료</b><small>{researchResult.summary}</small></span><em>특징 {researchResult.details.features.length} · 규격 {researchResult.details.specifications.length}</em></div>
                {(researchResult.details.features.length > 0 || researchResult.details.specifications.length > 0) && <section className="product-research-detail-grid">
                  {researchResult.details.features.length > 0 && <article><b>확인된 특징</b><ul>{researchResult.details.features.slice(0, 6).map((feature) => <li key={feature}>{feature}</li>)}</ul></article>}
                  {researchResult.details.specifications.length > 0 && <article><b>상세 규격·근거</b><dl>{researchResult.details.specifications.slice(0, 8).map((specification) => <div key={`${specification.label}-${specification.value}`}><dt>{specification.label}</dt><dd>{specification.value}<small>{specification.evidence}</small></dd></div>)}</dl></article>}
                </section>}
                {researchResult.sources.length > 0 && <nav aria-label="CLI가 확인한 상품 출처">{researchResult.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.url} className={source.status}><ExternalLink size={12} />{source.title}</a>)}</nav>}
                {researchResult.warnings.length > 0 && <p><AlertTriangle size={13} />{researchResult.warnings.join(" · ")}</p>}
              </div>}
            </section>
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
              <label className={manualErrors.sellerSku ? "field-error" : ""}><span>판매자 SKU <i>필수</i></span><input required value={intake.sellerSku} maxLength={100} onChange={(event) => setIntakeField("sellerSku", event.target.value.toUpperCase())} placeholder="COUPLET-MUG-001" />{manualErrors.sellerSku && <small>{manualErrors.sellerSku}</small>}</label>
              <label className={manualErrors.categoryHint ? "field-error" : ""}><span>상품군 힌트 <i>필수</i></span><input required value={intake.categoryHint} maxLength={120} onChange={(event) => setIntakeField("categoryHint", event.target.value)} placeholder="예: 카페 머그컵" />{manualErrors.categoryHint && <small>{manualErrors.categoryHint}</small>}</label>
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
            <div className="intake-confirmations">
              <label htmlFor="image-rights-confirmed" className={manualErrors.imageRightsConfirmed ? "field-error" : ""}><input id="image-rights-confirmed" aria-label="이미지와 상품 자료 사용 권한 확인" type="checkbox" checked={intake.imageRightsConfirmed} onChange={(event) => setIntakeField("imageRightsConfirmed", event.target.checked)} /><span><b>이미지·상품 자료 사용 권한</b><small>본인 촬영, 공급사 승인 또는 오픈라이선스 자료임을 확인합니다.</small></span></label>
              <label htmlFor="product-facts-confirmed" className={manualErrors.productFactsConfirmed ? "field-error" : ""}><input id="product-facts-confirmed" aria-label="상품 사실정보 확인" type="checkbox" checked={intake.productFactsConfirmed} onChange={(event) => setIntakeField("productFactsConfirmed", event.target.checked)} /><span><b>상품 사실정보 확인</b><small>원산지·소재·구성·규격이 실물과 일치합니다.</small></span></label>
            </div>
            <div className="analysis-context-note"><ShieldCheck size={16} /><span><b>이미지·CLI 조사·판매자 확인값 교차검증</b><small>대표사진, 라벨 OCR, 링크 본문과 입력 텍스트를 비교하고 충돌하거나 확인되지 않은 정보는 자동 확정하지 않습니다.</small></span></div>
          </section>

          <div className={`analysis-start-bar ${intakeReady && mainPhoto ? "ready" : "not-ready"}`}><span><b>{totalPhotoCount}장</b> · 1200×1200 JPG 자동보정 · 필수정보 {intakeReady ? "완료" : "미완료"} · 대표사진 {mainPhoto ? "완료" : "미완료"}</span><button type="button" onClick={startAutomation} disabled={running}>{running ? <><LoaderCircle className="spin" size={17} />분석 중</> : <><WandSparkles size={17} />상품 분석 시작</>}</button></div>
        </article>
        <aside className="panel publishing-settings"><div className="panel-heading"><div><span className="panel-kicker">등록 준비 상태</span><h3>입력·채널 사전 점검</h3></div><span className={`completion-ring ${intakeReady && mainPhoto ? "complete" : ""}`} style={{ "--progress": `${intakeProgress * 3.6}deg` } as React.CSSProperties}><b>{intakeProgress}</b><small>%</small></span></div>
          <div className="publishing-readiness-card"><div><span>대표사진</span><b className={mainPhoto ? "done" : ""}>{mainPhoto ? "완료" : "필수"}</b></div><div><span>필수정보</span><b className={intakeReady ? "done" : ""}>{intakeCompletedCount} / {intakeCompletionItems.length}</b></div><div><span>등록 방식</span><b>상품 1개씩</b></div></div>
          <div className="channel-selection-heading"><div><b>등록 채널</b><small>운영 키가 연결된 채널만 선택할 수 있습니다.</small></div><em>{selectedChannels.length}개 선택</em></div>
          <div className="publish-channel-list active-channels">{connectedChannelEntries.map(([key, channel]) => { const selected = selectedChannels.includes(key); return <label key={channel.letter}><ChannelMark code={channel.letter} /><span><b>{channel.name}</b><small>{channel.market} · 공식 API 등록 가능</small></span><input type="checkbox" checked={selected} onChange={(event) => setChannelSelection((current) => ({ ...current, [key]: event.target.checked }))} aria-label={`${channel.name} API 검증 ${selected ? "선택됨" : "선택 가능"}`} /><i><Check size={12} /></i></label>; })}</div>
          <details className="unavailable-channels"><summary><span>연결 대기 채널 {unavailableChannelEntries.length}개</span><ChevronDown size={15} /></summary><div>{unavailableChannelEntries.map(([key, channel]) => { const connected = connectedChannelKeys.includes(key); return <span key={channel.letter}><ChannelMark code={channel.letter} size="sm" /><b>{channel.name}</b><em>{!channel.enabled ? "준비중" : connected ? "연결됨" : "키 필요"}</em></span>; })}</div></details>
          <div className="auto-options"><h4>등록 실행 조건</h4><div className="automation-requirement"><span><b>ChatGPT CLI 분석 완료</b><small>실제 작업 결과가 저장된 상품만 진행</small></span><em>필수</em></div><div className="automation-requirement"><span><b>상품별 단건 처리</b><small>현재 작성 중인 상품 한 개만 분석하고 등록</small></span><em>고정</em></div><div className="automation-requirement"><span><b>공식 카테고리 확정</b><small>말단 카테고리와 필수 속성 저장 필요</small></span><em>필수</em></div><div className="automation-requirement"><span><b>쓰기 전 최종 확인</b><small>가격·재고·배송 정보 검토 뒤 API 실행</small></span><em>필수</em></div></div>
        </aside>
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
      <section className="panel queue-panel"><div className="panel-heading"><div><span className="panel-kicker">LIVE QUEUE</span><h3>실제 등록 작업 현황</h3></div><button className="ghost-button" onClick={() => notify("채널 작업 이력은 API 운영 콘솔에서 확인할 수 있습니다.")}>작업 이력<ChevronRight size={15} /></button></div>
        <div className="queue-live-summary"><div><small>AI 실행 중</small><b>{pipeline?.aiRunning ?? 0}건</b></div><div><small>등록 대기</small><b>{pipeline?.listingQueued ?? 0}건</b></div><div><small>등록 완료</small><b>{pipeline?.listingPublished ?? 0}건</b></div><div><small>재시도 가능</small><b>{pipeline?.listingFailed ?? 0}건</b></div><div><small>외부 권한 대기</small><b>{pipeline?.listingBlocked ?? 0}건</b></div></div>
        {listingIssues.length > 0 ? <div className="listing-issue-list">{listingIssues.map((issue) => {
          const channel = channels[issue.channelKey as ChannelKey];
          return <button type="button" key={issue.id} onClick={() => onOpenIssue(issue.productId)}><ChannelMark code={channel?.letter ?? issue.channelKey.slice(0, 2)} size="sm" /><span><b>{issue.productName}</b><small>{channel?.name ?? issue.channelKey} · {issue.market || "기본 마켓"}</small><em>{issue.message}</em></span><strong className={issue.failureClass === "retryable" ? "retryable" : "external"}>{issue.failureClass === "retryable" ? "재시도 가능" : "권한·인증 보완"}</strong><ChevronRight size={15} /></button>;
        })}</div> : null}
        {!pipeline || pipeline.aiRunning + pipeline.listingQueued + pipeline.listingPublished + pipeline.listingFailed + pipeline.listingBlocked === 0 ? <div className="live-empty-state"><Upload size={26} /><b>실제 등록 작업이 아직 없습니다.</b><small>대표사진 분석과 카테고리 확정 후 채널 등록을 실행하면 여기에 표시됩니다.</small></div> : null}
      </section>
    </div>
  );
}

type ShipmentInput = { id: string; carrierCode: string; trackingNumber: string };
type ShipmentResult = { succeeded: number; failed: number; results: Array<{ id: string; channel: string; ok: boolean; message: string }> };

function OrdersPage({ notify, displayOrders, onFulfill, syncStatus, initialQuery = "", initialOrderId = null }: {
  notify: (message: string) => void;
  displayOrders: DisplayOrder[];
  onFulfill: (shipments: ShipmentInput[]) => Promise<ShipmentResult>;
  syncStatus: OperationsSnapshot["syncStatus"];
  initialQuery?: string;
  initialOrderId?: string | null;
}) {
  const [active, setActive] = useState("전체 주문");
  const [query, setQuery] = useState(initialQuery);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [shipmentDrafts, setShipmentDrafts] = useState<Record<string, { carrierCode: string; trackingNumber: string }>>({});
  const [fulfillmentOpen, setFulfillmentOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<DisplayOrder | null>(() => displayOrders.find((order) => order.id === initialOrderId) ?? null);
  const [fulfilling, setFulfilling] = useState(false);
  const invoiceInputRef = useRef<HTMLInputElement>(null);
  const paidCount = displayOrders.filter((order) => order.status === "결제완료").length;
  const readyCount = displayOrders.filter((order) => order.status === "출고대기").length;
  const shippingCount = displayOrders.filter((order) => order.status === "배송중").length;
  const lastSuccess = syncStatus.filter((item) => item.data_type === "orders" && item.last_succeeded_at).sort((left, right) => Date.parse(right.last_succeeded_at ?? "") - Date.parse(left.last_succeeded_at ?? ""))[0]?.last_succeeded_at ?? null;
  const failedCount = syncStatus.filter((item) => item.data_type === "orders" && item.status === "failed").length;
  const filteredOrders = displayOrders.filter((order) => {
    const matchesTab = active === "전체 주문"
      || active === "완료 · 취소" && ["배송완료", "취소완료", "환불완료"].includes(order.status)
      || order.status === active;
    return matchesTab && (!query.trim() || matchesSearch(`${order.id} ${order.customer} ${order.product} ${order.status}`, query));
  });
  const eligibleOrders = filteredOrders.filter((order) => ["결제완료", "출고대기"].includes(order.status));
  const selectedOrders = displayOrders.filter((order) => selectedIds.has(order.sourceId));
  const allEligibleSelected = eligibleOrders.length > 0 && eligibleOrders.every((order) => selectedIds.has(order.sourceId));
  const toggleAllEligible = () => setSelectedIds((current) => {
    const next = new Set(current);
    if (allEligibleSelected) eligibleOrders.forEach((order) => next.delete(order.sourceId));
    else eligibleOrders.forEach((order) => next.add(order.sourceId));
    return next;
  });
  const toggleOrder = (order: DisplayOrder) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(order.sourceId)) next.delete(order.sourceId);
    else next.add(order.sourceId);
    return next;
  });
  const openFulfillment = () => {
    if (!selectedOrders.length) {
      notify("결제완료 또는 출고대기 주문을 먼저 선택해 주세요.");
      return;
    }
    setShipmentDrafts((current) => Object.fromEntries(selectedOrders.map((order) => [order.sourceId, current[order.sourceId] ?? { carrierCode: "", trackingNumber: "" }])));
    setFulfillmentOpen(true);
  };
  const importInvoices = async (file: File | null) => {
    if (!file) return;
    try {
      const lines = (await file.text()).replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!lines.length) throw new Error("empty");
      const rows = lines.map((line) => line.split(",").map((value) => value.trim().replace(/^"|"$/g, "")));
      const header = rows[0].map((value) => normalizeSearchText(value));
      const hasHeader = header.some((value) => ["orderid", "주문번호", "tracking", "운송장번호"].includes(value.replace(/\s/g, "")));
      const dataRows = hasHeader ? rows.slice(1) : rows;
      const nextDrafts: Record<string, { carrierCode: string; trackingNumber: string }> = {};
      const nextSelected = new Set<string>();
      for (const row of dataRows) {
        const [externalOrderId, carrierCode, trackingNumber] = row;
        const order = displayOrders.find((candidate) => candidate.id === externalOrderId);
        if (!order || !carrierCode || !trackingNumber) continue;
        nextSelected.add(order.sourceId);
        nextDrafts[order.sourceId] = { carrierCode, trackingNumber };
      }
      if (!nextSelected.size) throw new Error("unmatched");
      setSelectedIds(nextSelected);
      setShipmentDrafts(nextDrafts);
      setFulfillmentOpen(true);
      notify(`${nextSelected.size}건의 송장 정보를 불러왔습니다.`);
    } catch {
      notify("CSV를 ‘주문번호,택배사코드,운송장번호’ 순서로 확인해 주세요.");
    } finally {
      if (invoiceInputRef.current) invoiceInputRef.current.value = "";
    }
  };
  const confirmFulfillment = async () => {
    const shipments = selectedOrders.map((order) => ({ id: order.sourceId, ...shipmentDrafts[order.sourceId] }));
    if (shipments.some((shipment) => !shipment.carrierCode?.trim() || !shipment.trackingNumber?.trim())) {
      notify("선택한 모든 주문의 택배사 코드와 운송장번호를 입력해 주세요.");
      return;
    }
    setFulfilling(true);
    try {
      const result = await onFulfill(shipments);
      if (result.succeeded) setSelectedIds((current) => {
        const next = new Set(current);
        result.results.filter((item) => item.ok).forEach((item) => next.delete(item.id));
        return next;
      });
      if (result.failed === 0) setFulfillmentOpen(false);
    } finally {
      setFulfilling(false);
    }
  };
  return (
    <div className="page-stack">
      <section className="order-summary-grid"><article><span className="metric-icon blue"><ShoppingCart size={19} /></span><div><small>통합 주문</small><strong>{displayOrders.length}</strong></div><em>운영 원장</em></article><article><span className="metric-icon orange"><Clock3 size={19} /></span><div><small>출고 대기</small><strong>{readyCount}</strong></div><em className="neutral">결제완료 {paidCount}건</em></article><article><span className="metric-icon violet"><Truck size={19} /></span><div><small>배송 중</small><strong>{shippingCount}</strong></div><em className="neutral">상태 변경 가능</em></article><article><span className={`metric-icon ${failedCount ? "orange" : "green"}`}><RefreshCw size={19} /></span><div><small>최근 동기화</small><strong>{lastSuccess ? relativeTime(lastSuccess) : "대기"}</strong></div><em className={failedCount ? "neutral" : ""}>{failedCount ? `${failedCount}개 채널 확인 필요` : "실제 채널 API"}</em></article></section>
      <section className="panel data-panel"><div className="tab-toolbar"><div>{["전체 주문", "결제완료", "출고대기", "배송중", "완료 · 취소"].map((tab) => <button className={active === tab ? "active" : ""} onClick={() => setActive(tab)} key={tab}>{tab}{tab === "출고대기" && <span>{readyCount}</span>}</button>)}</div><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="주문번호, 구매자, 상품 검색" aria-label="주문 검색" /></div><span className="automatic-sync-label"><RefreshCw size={14} />5분마다 자동 업데이트</span></div>
        <div className="table-wrap"><table className="data-table order-table"><thead><tr><th><input type="checkbox" aria-label="출고 가능 주문 전체 선택" checked={allEligibleSelected} onChange={toggleAllEligible} /></th><th>주문번호</th><th>채널</th><th>구매자</th><th>상품</th><th>결제금액</th><th>주문상태</th><th>주문시간</th><th /></tr></thead><tbody>{filteredOrders.map((order) => { const eligible = ["결제완료", "출고대기"].includes(order.status); return <tr key={order.sourceId} className={`${initialOrderId === order.id ? "search-target-row" : ""} ${selectedIds.has(order.sourceId) ? "selected-row" : ""}`.trim()}><td><input type="checkbox" aria-label={`${order.id} 출고 선택`} checked={selectedIds.has(order.sourceId)} disabled={!eligible} onChange={() => toggleOrder(order)} /></td><td><button type="button" className="order-detail-link mono" onClick={() => setDetailOrder(order)}>{order.id}</button></td><td><ChannelMark code={order.channel} size="sm" /></td><td><b>{order.customer}</b></td><td><button type="button" className="order-product-button truncate-product" onClick={() => setDetailOrder(order)}>{order.product}</button></td><td><b>{order.amount}</b></td><td><StatusBadge status={order.status} /></td><td><span className="muted-cell">{order.time}</span></td><td><button className="table-action" title="주문 상세정보 보기" aria-label={`${order.id} 주문 상세정보 보기`} onClick={() => setDetailOrder(order)}><ChevronRight size={16} /></button></td></tr>; })}</tbody></table></div>
        {displayOrders.length === 0 ? <div className="live-empty-state table-empty"><ShoppingCart size={28} /><b>동기화된 실제 주문이 없습니다.</b><small>채널 API 키 연결 후 주문 조회를 실행하면 표시됩니다.</small></div> : filteredOrders.length === 0 ? <div className="live-empty-state table-empty"><Search size={28} /><b>검색 조건에 맞는 주문이 없습니다.</b><small>주문번호, 구매자명 또는 상품명을 다시 확인해 주세요.</small></div> : null}
        <div className="bulk-order-bar"><span><input type="checkbox" aria-label="출고 가능 주문 전체 선택" checked={allEligibleSelected} onChange={toggleAllEligible} />선택한 주문 <b>{selectedIds.size}</b>건</span><button type="button" disabled={!selectedIds.size || fulfilling} onClick={openFulfillment}><Truck size={15} />일괄 출고 처리</button><button type="button" disabled={fulfilling} onClick={() => invoiceInputRef.current?.click()}><Upload size={15} />송장 CSV 업로드</button><input ref={invoiceInputRef} className="sr-only" type="file" accept=".csv,text/csv" aria-label="송장 CSV 파일 선택" onChange={(event) => void importInvoices(event.target.files?.[0] ?? null)} /><span className="toolbar-spacer" /><small>{syncStatus.length ? "채널별 동기화 상태 기록 중 · 5분 자동 업데이트" : "채널 연결 상태 확인 중"}</small></div>
      </section>
      {detailOrder && <div className="shipment-dialog-overlay" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setDetailOrder(null); }}><section className="shipment-dialog order-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="order-detail-title"><header><div><span className="metric-icon blue"><ShoppingCart size={18} /></span><span><h3 id="order-detail-title">주문 상세정보</h3><small>조회만으로 주문·출고 상태는 변경되지 않습니다.</small></span></div><button className="icon-only-button" aria-label="주문 상세 닫기" onClick={() => setDetailOrder(null)}><X size={17} /></button></header><dl className="order-detail-ledger"><div><dt>주문번호</dt><dd>{detailOrder.id}</dd></div><div><dt>판매 채널</dt><dd><ChannelMark code={detailOrder.channel} size="sm" /></dd></div><div><dt>구매 상품</dt><dd>{detailOrder.product}</dd></div><div><dt>구매자</dt><dd>{detailOrder.customer}</dd></div><div><dt>결제금액</dt><dd>{detailOrder.amount}</dd></div><div><dt>주문상태</dt><dd><StatusBadge status={detailOrder.status} /></dd></div><div><dt>주문시간</dt><dd>{detailOrder.time}</dd></div></dl><footer><button type="button" className="credential-secondary" onClick={() => setDetailOrder(null)}>닫기</button>{["결제완료", "출고대기"].includes(detailOrder.status) ? <button type="button" className="publish-execute" onClick={() => { setSelectedIds(new Set([detailOrder.sourceId])); setShipmentDrafts({ [detailOrder.sourceId]: shipmentDrafts[detailOrder.sourceId] ?? { carrierCode: "", trackingNumber: "" } }); setDetailOrder(null); setFulfillmentOpen(true); }}><Truck size={15} />출고 정보 입력</button> : null}</footer></section></div>}
      {fulfillmentOpen && <div className="shipment-dialog-overlay" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !fulfilling) setFulfillmentOpen(false); }}><section className="shipment-dialog" role="dialog" aria-modal="true" aria-labelledby="shipment-dialog-title"><header><div><span className="metric-icon violet"><Truck size={18} /></span><span><h3 id="shipment-dialog-title">판매채널 발송 처리</h3><small>선택한 {selectedOrders.length}건을 외부 판매채널에 실제 발송 처리합니다.</small></span></div><button className="icon-only-button" aria-label="출고 창 닫기" disabled={fulfilling} onClick={() => setFulfillmentOpen(false)}><X size={17} /></button></header><div className="shipment-warning"><AlertTriangle size={16} /><span><b>실제 판매 상태가 변경됩니다.</b><small>판매채널이 성공 응답한 주문만 SellerPilot에서 배송중으로 변경됩니다.</small></span></div><div className="shipment-draft-list">{selectedOrders.map((order) => <article key={order.sourceId}><div><ChannelMark code={order.channel} size="sm" /><span><b>{order.id}</b><small>{order.product}</small></span></div><label><span>택배사 코드</span><input value={shipmentDrafts[order.sourceId]?.carrierCode ?? ""} onChange={(event) => setShipmentDrafts((current) => ({ ...current, [order.sourceId]: { ...(current[order.sourceId] ?? { trackingNumber: "" }), carrierCode: event.target.value } }))} placeholder="채널 공식 택배사 코드" /></label><label><span>운송장번호</span><input value={shipmentDrafts[order.sourceId]?.trackingNumber ?? ""} onChange={(event) => setShipmentDrafts((current) => ({ ...current, [order.sourceId]: { ...(current[order.sourceId] ?? { carrierCode: "" }), trackingNumber: event.target.value } }))} placeholder="숫자·영문 운송장번호" /></label></article>)}</div><footer><button type="button" className="credential-secondary" disabled={fulfilling} onClick={() => setFulfillmentOpen(false)}>취소</button><button type="button" className="publish-execute" disabled={fulfilling || selectedOrders.some((order) => !shipmentDrafts[order.sourceId]?.carrierCode.trim() || !shipmentDrafts[order.sourceId]?.trackingNumber.trim())} onClick={() => void confirmFulfillment()}>{fulfilling ? <LoaderCircle className="spin" size={15} /> : <Truck size={15} />}{fulfilling ? "판매채널 처리 중" : "확인 후 실제 발송 처리"}</button></footer></section></div>}
    </div>
  );
}

function CsPage({ notify, displayTickets, displayOrders, onSend, onDraft, onStatus, onSync, syncing, syncStatus, initialQuery = "", initialTicketId = null }: {
  notify: (message: string) => void;
  displayTickets: DisplayTicket[];
  displayOrders: DisplayOrder[];
  onSend: (ticket: DisplayTicket, reply: string) => Promise<boolean>;
  onDraft: (ticket: DisplayTicket, targetLocale: SupportLocale) => Promise<string | null>;
  onStatus: (ticket: DisplayTicket, status: "waiting" | "in_progress" | "resolved") => Promise<boolean>;
  onSync: () => Promise<void>;
  syncing: boolean;
  syncStatus: OperationsSnapshot["syncStatus"];
  initialQuery?: string;
  initialTicketId?: string | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(initialTicketId);
  const [query, setQuery] = useState(initialQuery);
  const [ticketTab, setTicketTab] = useState<"미답변" | "처리 중" | "완료">(() => {
    const initialStatus = displayTickets.find((ticket) => ticket.id === initialTicketId)?.status;
    return initialStatus === "처리 완료" ? "완료" : initialStatus === "처리 중" ? "처리 중" : "미답변";
  });
  const [reply, setReply] = useState("");
  const [targetLocale, setTargetLocale] = useState<SupportLocale>("ko-KR");
  const [drafting, setDrafting] = useState(false);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(Boolean(initialTicketId));
  const filteredTickets = displayTickets.filter((ticket) => {
    const matchesTab = ticketTab === "미답변"
      ? ticket.status === "긴급" || ticket.status === "답변 대기"
      : ticketTab === "처리 중"
        ? ticket.status === "처리 중"
        : ticket.status === "처리 완료";
    return matchesTab && (!query.trim() || matchesSearch(`${ticket.id} ${ticket.customer} ${ticket.channel} ${ticket.subject} ${ticket.preview}`, query));
  });
  const selected = filteredTickets.find((ticket) => ticket.id === selectedId)
    ?? filteredTickets[0]
    ?? null;
  const sendReply = async () => {
    if (selected && await onSend(selected, reply)) {
      notify(`${selected.customer} 고객 문의를 처리 완료로 저장했습니다.`);
      setReply("");
    }
  };
  const createDraft = async () => {
    if (!selected || drafting) return;
    setDrafting(true);
    try {
      const draft = await onDraft(selected, targetLocale);
      if (draft) {
        setReply(draft);
        notify(`${supportLocaleLabels[targetLocale]} CLI 답변 초안을 불러왔습니다. 전송 전 내용을 확인해 주세요.`);
      }
    } finally {
      setDrafting(false);
    }
  };
  const updateStatus = async (status: "waiting" | "in_progress" | "resolved") => {
    if (!selected) return;
    if (await onStatus(selected, status)) notify("문의 처리 상태를 저장했습니다.");
  };
  const linkedOrder = selected ? displayOrders.find((order) => order.customer === selected.customer) ?? null : null;
  const unresolvedCount = displayTickets.filter((ticket) => ticket.status !== "처리 완료").length;
  const lastSuccess = syncStatus.filter((item) => item.data_type === "inquiries" && item.last_succeeded_at).sort((left, right) => Date.parse(right.last_succeeded_at ?? "") - Date.parse(left.last_succeeded_at ?? ""))[0]?.last_succeeded_at ?? null;
  const failedCount = syncStatus.filter((item) => item.data_type === "inquiries" && item.status === "failed").length;
  const inquiryChannelStates = activeChannelKeys.map((channelKey) => {
    const rows = syncStatus.filter((item) => item.channel_key === channelKey && item.data_type === "inquiries").sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at));
    const state = rows[0] ?? null;
    return { channelKey, state };
  });
  return (
    <div className="page-stack cs-page">
      <section className="cs-summary"><div><span className="metric-icon violet"><Inbox size={18} /></span><span><small>미처리 문의</small><strong>{unresolvedCount}</strong></span></div><div><span className="metric-icon orange"><Clock3 size={18} /></span><span><small>긴급 문의</small><strong>{displayTickets.filter((ticket) => ticket.status === "긴급").length}</strong></span></div><div><span className="metric-icon green"><BadgeCheck size={18} /></span><span><small>연결 주문</small><strong>{displayOrders.length}</strong></span></div><div><span className="metric-icon blue"><Bot size={18} /></span><span><small>AI 답변</small><strong>CLI</strong></span></div></section>
      <section className="panel-heading table-title"><div><span className="panel-kicker">LIVE INQUIRIES</span><h3>{lastSuccess ? `최근 동기화 ${relativeTime(lastSuccess)}` : "채널 문의 동기화 대기"}{failedCount ? ` · ${failedCount}개 채널 확인 필요` : ""}</h3></div><button className="filter-button" type="button" onClick={() => void onSync()} disabled={syncing}>{syncing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{syncing ? "요청 중" : "문의 새로고침"}</button></section>
      <section className="panel cs-channel-verification"><div className="panel-heading"><div><span className="panel-kicker">CHANNEL VERIFICATION</span><h3>채널별 CS 실제 동작 상태</h3></div><ShieldCheck size={18} /></div><div className="cs-channel-verification-grid">{inquiryChannelStates.map(({ channelKey, state }) => { const supported = state?.status !== "unsupported" && Boolean(state); const passed = state?.status === "passed"; return <article key={channelKey}><ChannelMark code={channels[channelKey].letter} /><span><b>{channels[channelKey].name}</b><small>{passed ? `정상 · ${state?.last_succeeded_at ? relativeTime(state.last_succeeded_at) : "동기화 완료"}` : state?.status === "failed" ? "연결 오류" : state?.status === "unsupported" ? "현재 API 미지원" : "검증 이력 없음"}</small></span><em className={passed ? "passed" : supported ? "failed" : "unsupported"}>{passed ? "동작" : supported ? "오류" : "미지원"}</em></article>; })}</div></section>
      {!selected ? <section className="panel live-empty-state large"><Inbox size={32} /><b>{displayTickets.length === 0 ? "동기화된 실제 문의가 없습니다." : "검색 조건에 맞는 문의가 없습니다."}</b><small>{displayTickets.length === 0 ? "채널 API 연결 후 문의를 동기화하면 고객 정보와 주문 맥락이 표시됩니다." : "고객명, 문의번호 또는 문의 내용을 다시 확인해 주세요."}</small>{displayTickets.length === 0 && <button className="ghost-button" type="button" onClick={() => void onSync()} disabled={syncing}>지금 확인</button>}</section> :
      <section className={`cs-workspace panel ${mobileConversationOpen ? "mobile-conversation-open" : ""}`}>
        <aside className="ticket-list"><div className="ticket-list-header"><div className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="고객명, 문의번호, 내용 검색" aria-label="문의 검색" /></div></div><div className="ticket-tabs">{(["미답변", "처리 중", "완료"] as const).map((tab) => <button key={tab} className={ticketTab === tab ? "active" : ""} onClick={() => { setTicketTab(tab); setSelectedId(null); setMobileConversationOpen(false); }}>{tab}{tab === "미답변" && <span>{displayTickets.filter((ticket) => ticket.status === "긴급" || ticket.status === "답변 대기").length}</span>}</button>)}</div>{filteredTickets.map((ticket) => <button key={ticket.id} className={`ticket-item ${selected.id === ticket.id ? "active" : ""}`} onClick={() => { setSelectedId(ticket.id); setReply(ticket.replyDraft ?? ""); setMobileConversationOpen(true); }}><div className="ticket-avatar">{ticket.customer.charAt(0)}</div><div><div><b>{ticket.customer}</b><small>{ticket.time}</small></div><span><ChannelMark code={ticketChannelCodes[ticket.channel] ?? "Q"} size="sm" />{ticket.subject}</span><p>{ticket.preview}</p><StatusBadge status={ticket.status} /></div></button>)}</aside>
        <article className="conversation"><header><div><button className="mobile-back" type="button" aria-label="문의 목록으로 돌아가기" onClick={() => setMobileConversationOpen(false)}><ArrowLeft size={16} /></button><span className="ticket-avatar large">{selected.customer.charAt(0)}</span><span><b>{selected.customer}</b><small>{selected.channel} · {selected.id}</small></span></div><div><label className="filter-select compact"><span className="sr-only">문의 처리 상태</span><select value={selected.status === "처리 완료" ? "resolved" : selected.status === "처리 중" ? "in_progress" : "waiting"} onChange={(event) => void updateStatus(event.target.value as "waiting" | "in_progress" | "resolved")}><option value="waiting">답변 대기</option><option value="in_progress">처리 중</option><option value="resolved">처리 완료</option></select><ChevronDown size={14} /></label></div></header>
          <div className="conversation-body"><div className="order-context"><Package size={16} /><span><small>문의 주문</small><b>{linkedOrder?.product ?? "연결된 주문 없음"}</b></span><em>{linkedOrder?.id ?? "-"}</em></div><div className="message-date"><span>실제 수신 문의</span></div><div className="customer-message"><div className="ticket-avatar">{selected.customer.charAt(0)}</div><div><small>{selected.customer} · {selected.time}</small><p>{selected.originalMessage}</p><span>채널 동기화 원문</span></div></div></div>
          <footer className="reply-composer"><div className="ai-draft-head"><span><Sparkles size={14} />주문 맥락과 문의 원문을 바탕으로 검토용 초안을 생성합니다.</span><button type="button" disabled={drafting} onClick={() => void createDraft()}>{drafting ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}{drafting ? "CLI 작성 중" : "CLI 초안 생성"}</button></div><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="실제 답변을 입력하거나 CLI 초안을 생성하세요." /><div><span><label className="reply-tool-select"><Languages size={15} /><span className="sr-only">답변 언어</span><select value={targetLocale} onChange={(event) => setTargetLocale(event.target.value as SupportLocale)}>{Object.entries(supportLocaleLabels).map(([locale, label]) => <option key={locale} value={locale}>{label}</option>)}</select><ChevronDown size={13} /></label><label className="reply-tool-select"><FileText size={15} /><span className="sr-only">답변 템플릿</span><select defaultValue="" onChange={(event) => { const template = supportReplyTemplates.find((item) => item.label === event.target.value); if (template) setReply(template.value); event.target.value = ""; }}><option value="">템플릿</option>{supportReplyTemplates.map((template) => <option value={template.label} key={template.label}>{template.label}</option>)}</select><ChevronDown size={13} /></label></span><button className="send-button" disabled={!reply.trim()} onClick={() => void sendReply()}>검토 답변 저장<Send size={15} /></button></div></footer>
        </article>
        <aside className="customer-panel"><div className="customer-profile"><div className="ticket-avatar xl">{selected.customer.charAt(0)}</div><h4>{selected.customer}</h4><span>{selected.channel} 구매자</span></div><div className="customer-facts"><div><small>총 주문</small><b>{displayOrders.filter((order) => order.customer === selected.customer).length}건</b></div><div><small>데이터 출처</small><b>실제 채널 API</b></div></div><div className="detail-section"><h5>현재 주문</h5><div className="mini-order"><span className="tiny-thumb"><Package size={17} /></span><span><b>{linkedOrder?.product ?? "연결된 주문 없음"}</b><small>{linkedOrder?.amount ?? "-"}</small></span></div><dl><div><dt>주문번호</dt><dd>{linkedOrder?.id ?? "-"}</dd></div><div><dt>배송상태</dt><dd><StatusBadge status={linkedOrder?.status ?? "확인 필요"} /></dd></div><div><dt>운송장</dt><dd>배송 API 동기화 값</dd></div></dl></div><div className="detail-section"><h5>응대 원칙</h5><p className="ai-guide"><Bot size={16} />실제 주문·배송 상태를 확인한 뒤 답변을 저장하세요.</p></div></aside>
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
  const credentialRegistered = Boolean(metric && metric.credentialStatus !== "missing");
  const channelProducts = displayProducts.filter((product) => product.channels.includes(channel.letter)).sort((a, b) => b.sales - a.sales);
  const revenue = metric?.revenue30dKrw ?? 0;
  const orderCount = metric?.orderCount ?? 0;
  const averageOrder = orderCount > 0 ? revenue / orderCount : 0;
  return (
    <div className="page-stack">
      <section className="channel-hero" style={{ "--channel-color": channel.color } as React.CSSProperties}><div><ChannelMark code={channel.letter} size="lg" /><span><small>{channel.market} 판매 채널</small><h2>{channel.name}</h2><em className={connected ? "connected" : credentialRegistered ? "pending" : ""}><i />{connected ? "운영 API 키 · 읽기 진단 정상" : credentialRegistered ? "운영 API 키 등록 · 읽기 진단 필요" : "운영 API 키 등록 필요"}</em></span></div><div><button className="filter-button" onClick={() => onNavigate("connections")}><KeyRound size={15} />연결 관리</button><a className="primary-button channel-console-link" href={channel.sellerCenterUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />실제 판매자센터 열기</a></div></section>
      <section className="metric-grid channel-metrics"><MetricCard label="30일 매출" value={formatCompactWon(revenue)} detail="실제 게시 상품 매출" icon={CircleDollarSign} tone="violet" /><MetricCard label="주문" value={orderCount.toLocaleString()} detail={`출고대기 ${metric?.readyToShipCount ?? 0}건`} icon={ShoppingBag} tone="blue" /><MetricCard label="판매 상품" value={(metric?.publishedCount ?? 0).toLocaleString()} detail={`관리 상품 ${metric?.productCount ?? 0}개`} icon={Package} tone="green" /><MetricCard label="미처리 CS" value={(metric?.openTicketCount ?? 0).toLocaleString()} detail="실제 채널 문의" icon={Headphones} tone="orange" /></section>
      <section className="channel-detail-grid"><article className="panel"><div className="panel-heading"><div><span className="panel-kicker">LIVE PERFORMANCE</span><h3>최근 30일 운영 집계</h3></div><span className="live-label"><i />DB</span></div><div className="channel-live-summary"><div><small>판매량</small><b>{(metric?.sold30d ?? 0).toLocaleString()}개</b></div><div><small>평균 주문금액</small><b>{formatCompactWon(averageOrder)}</b></div><div><small>실주문</small><b>{orderCount.toLocaleString()}건</b></div><div><small>최근 API 오류</small><b>{metric?.failedAttemptCount ?? 0}건</b></div></div></article><article className="panel store-health"><div className="panel-heading"><div><span className="panel-kicker">CONNECTION</span><h3>채널 연결 상태</h3></div><span className={`score-grade ${connected ? "connected" : credentialRegistered ? "pending" : ""}`}>{connected ? "ON" : credentialRegistered ? "CHECK" : "OFF"}</span></div>{[{ label: "운영 자격증명", score: credentialRegistered ? "키 등록됨" : "키 필요" }, { label: "읽기 진단", score: connected ? "정상" : credentialRegistered ? "확인 필요" : "미실행" }, { label: "등록 상품", score: `${metric?.publishedCount ?? 0}개` }, { label: "출고 대기", score: `${metric?.readyToShipCount ?? 0}건` }, { label: "실패 작업", score: `${metric?.failedAttemptCount ?? 0}건` }].map((item) => <div className="health-row" key={item.label}><span>{item.label}</span><b>{item.score}</b></div>)}</article></section>
      <section className="panel data-panel"><div className="panel-heading table-title"><div><span className="panel-kicker">LIVE PRODUCTS</span><h3>채널 내 판매 상품</h3></div><button className="ghost-button" onClick={() => onNavigate("products")}>전체 상품<ChevronRight size={15} /></button></div><div className="table-wrap"><table className="data-table"><thead><tr><th>순위</th><th>상품</th><th>30일 판매</th><th>30일 매출</th><th>재고</th><th>상태</th></tr></thead><tbody>{channelProducts.slice(0, 10).map((product, index) => <tr key={product.id}><td><b className="rank-number">{String(index + 1).padStart(2, "0")}</b></td><td><div className="product-cell"><div className="product-thumb"><ProductVisual src={product.image} size="52px" /></div><span><b>{product.name}</b><small>{product.sku}</small></span></div></td><td><b>{product.sales}</b>개</td><td><b>{product.revenue}</b></td><td><b>{product.stock}</b>개</td><td><StatusBadge status={product.status} /></td></tr>)}</tbody></table></div>{channelProducts.length === 0 && <div className="live-empty-state table-empty"><PackageSearch size={28} /><b>이 채널의 실상품이 없습니다.</b><small>API 키 연결 후 상품 동기화 또는 신규 등록을 실행하세요.</small></div>}</section>
    </div>
  );
}

function StoryboardPage({ onNavigate }: { onNavigate: (view: View) => void }) {
  const scenes = [
    { no: "01", title: "관리자 로그인", desc: "ID·PW를 입력해 운영 데이터에 안전하게 접근", view: "overview" as View, icon: LockKeyhole, outcome: "권한별 대시보드 진입" },
    { no: "02", title: "통합 현황 파악", desc: "매출, 주문, 등록, CS와 월간 베스트 상품을 한 화면에서 확인", view: "overview" as View, icon: LayoutDashboard, outcome: "30초 안에 오늘의 우선순위 결정" },
    { no: "03", title: "사진으로 상품 등록", desc: "정면·라벨·바코드 사진을 올려 상품 사실정보 추출", view: "publishing" as View, icon: ImagePlus, outcome: "반복 입력 제거" },
    { no: "04", title: "AI 상세·썸네일 제작", desc: "ChatGPT CLI 분석, codex-image 연출컷, 3종 썸네일과 편집 가능한 상세페이지 생성", view: "publishing" as View, icon: WandSparkles, outcome: "Puck 블록으로 직접 수정 가능한 초안" },
    { no: "05", title: "채널별 마진 검증", desc: "원가·수수료·환율·광고비를 반영해 목표 마진 판매가를 결정", view: "margin" as View, icon: Calculator, outcome: "팔아도 남는 가격 확정" },
    { no: "06", title: "8개 판매채널 등록", desc: "한 상품을 Qoo10·Shopee·Lazada·쿠팡·11번가·스마트스토어·eBay·Temu 규격으로 변환", view: "publishing" as View, icon: Globe2, outcome: "채널별 사전검증과 오류 추적" },
    { no: "07", title: "주문 · 재고 통합", desc: "각 채널 주문을 모으고 중앙 재고를 동기화", view: "orders" as View, icon: PackageCheck, outcome: "중복판매·품절 방지" },
    { no: "08", title: "다국어 CS 응대", desc: "문의 자동번역과 주문정보 기반 AI 답변 초안", view: "cs" as View, icon: Bot, outcome: "응답시간 단축" },
    { no: "09", title: "성과 개선", desc: "채널·상품별 매출, 전환율, CS와 오류 데이터를 비교", view: "qoo10" as View, icon: TrendingUp, outcome: "잘 팔리는 상품에 집중" },
  ];
  return (
    <div className="page-stack storyboard-page">
      <section className="storyboard-intro"><div><span className="eyebrow dark"><FileText size={14} /> PRODUCT STORYBOARD · V1.3</span><h2>운영자가 길을 잃지 않는<br /><em>9개의 핵심 장면</em></h2><p>‘오늘 무엇을 봐야 하는가’에서 시작해 등록, AI 제작, 판매, CS, 개선까지<br />하나의 루프로 연결한 멀티채널 커머스 운영 경험입니다.</p></div><div className="oss-card"><span>OPEN SOURCE FOUNDATION</span><strong>Ant Design</strong><em>MIT · ENTERPRISE PATTERNS</em><p>복잡한 판매 업무를 익숙하고 확실하게 처리하는 관리자 화면 원칙</p><strong>Radix UI</strong><em>MIT · ACCESSIBLE PRIMITIVES</em><p>키보드와 보조기기 사용까지 고려한 상호작용 기반</p><strong>TanStack Table</strong><em>MIT · DATA WORKFLOWS</em><p>상품·주문·CS 데이터의 정렬, 필터, 선택과 밀도 높은 표현</p><strong>Puck</strong><em>MIT · PAGE EDITOR</em><p>React·Next.js용 드래그앤드롭 상세페이지 편집기</p></div></section>
      <section className="story-flow"><div className="flow-line" />{scenes.map((scene, index) => <article className="story-scene" key={scene.no}><div className="scene-number">{scene.no}</div><div className="scene-icon"><scene.icon size={22} /></div><div className="scene-copy"><span>{index < 2 ? "DISCOVER" : index < 5 ? "AUTOMATE" : index < 7 ? "OPERATE" : "GROW"}</span><h3>{scene.title}</h3><p>{scene.desc}</p><em><CheckCircle2 size={14} />{scene.outcome}</em></div><button onClick={() => onNavigate(scene.view)}>화면 열기<ArrowRight size={15} /></button></article>)}</section>
      <section className="panel information-architecture"><div className="panel-heading"><div><span className="panel-kicker">INFORMATION ARCHITECTURE</span><h3>화면 구성과 운영 목적</h3></div></div><div className="ia-grid"><div><span className="ia-icon"><LayoutDashboard size={19} /></span><b>총괄</b><small>핵심 KPI · 베스트 상품 · 채널 건강도 · 긴급 항목</small></div><div><span className="ia-icon"><Package size={19} /></span><b>상품</b><small>상품 원장 · 채널 상태 · 재고 · 판매 성과</small></div><div><span className="ia-icon"><CloudUpload size={19} /></span><b>등록</b><small>촬영 · AI 분석 · 번역 · 가격 · 게시 작업</small></div><div><span className="ia-icon"><Calculator size={19} /></span><b>마진</b><small>원가 · 채널 수수료 · 환율 · 목표 판매가</small></div><div><span className="ia-icon"><ShoppingCart size={19} /></span><b>주문</b><small>통합 주문 · 출고 · 배송 · 중앙 재고</small></div><div><span className="ia-icon"><Headphones size={19} /></span><b>CS</b><small>문의 통합 · 자동 번역 · AI 답변 · SLA</small></div><div><span className="ia-icon"><Store size={19} /></span><b>채널별</b><small>매출 · 주문 · 전환율 · 상품 · 운영 점수</small></div></div></section>
    </div>
  );
}

function DashboardShell({ onLogout, userEmail }: { onLogout: () => Promise<void>; userEmail: string }) {
  const [view, setView] = useState<View>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [credentialChanging, setCredentialChanging] = useState(false);
  const [credentialMessage, setCredentialMessage] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [toast, setToast] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [targetedSearch, setTargetedSearch] = useState<{ kind: "order" | "inquiry"; id: string; query: string } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [selectedProduct, setSelectedProduct] = useState<DisplayProduct | null>(null);
  const [publishingProduct, setPublishingProduct] = useState<{ id: string; name: string } | null>(null);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const operations = useOperationsSnapshot();
  const operationSummary = operations.data?.summary ?? null;
  const channelMetrics = useMemo(() => operations.data?.channelMetrics ?? [], [operations.data]);
  const pipeline = operations.data?.pipeline ?? null;
  const workerLastSeenAt = operations.data?.aiRuntime?.worker?.last_seen_at ?? null;
  const workerConnected = Boolean(workerLastSeenAt && operations.data?.generatedAt
    && Date.parse(operations.data.generatedAt) - Date.parse(workerLastSeenAt) < 10 * 60_000);
  const meta = pageMeta[view];

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3200);
  }, []);

  const changeAdminCredentials = useCallback(async () => {
    if (credentialChanging) return;
    setCredentialChanging(true);
    setCredentialMessage("");
    try {
      const response = await operations.authenticatedFetch("/api/admin/account/credentials", {
        method: "POST",
        body: JSON.stringify({ password: newAdminPassword }),
      });
      const payload = await response.json().catch(() => ({ message: "관리자 계정 변경 응답을 읽지 못했습니다." })) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "관리자 로그인 정보를 변경하지 못했습니다.");
      setCredentialMessage(payload.message ?? "관리자 로그인 정보가 변경되었습니다.");
      window.setTimeout(() => void onLogout(), 1_400);
    } catch (error) {
      setCredentialMessage(error instanceof Error ? error.message : "관리자 로그인 정보를 변경하지 못했습니다.");
    } finally {
      setCredentialChanging(false);
    }
  }, [credentialChanging, newAdminPassword, onLogout, operations]);

  const displayProducts = useMemo<DisplayProduct[]>(() => operations.data?.products.map((product) => ({
    id: product.externalCode,
    sourceId: product.id,
    name: product.name,
    sku: product.sku,
    description: product.description,
    sourceUrl: product.sourceUrl,
    image: product.imageUrl ?? null,
    onHand: product.onHand,
    reserved: product.reserved,
    stock: product.available,
    costKrw: product.costKrw,
    sales: product.sold30d,
    revenueKrw: product.revenue30dKrw,
    revenue: `₩${Math.round(product.revenue30dKrw).toLocaleString("ko-KR")}`,
    status: product.available <= 0
      ? "품절"
      : product.available <= product.reorderPoint
        ? "재고주의"
        : productStatusLabel[product.status],
    channels: product.listingChannels,
    updatedAt: product.updatedAt,
  })) ?? [], [operations.data]);

  const displayOrders = useMemo<DisplayOrder[]>(() => operations.data?.orders.map((order) => ({
    sourceId: order.id,
    id: order.externalOrderId,
    channelKey: order.channelKey,
    channel: order.channelCode,
    customer: order.customerName,
    product: order.productName,
    amount: new Intl.NumberFormat("ko-KR", { style: "currency", currency: order.currency, maximumFractionDigits: order.currency === "KRW" ? 0 : 2 }).format(order.amount),
    status: orderStatusLabel[order.status],
    time: relativeTime(order.orderedAt),
  })) ?? [], [operations.data]);

  const displayTickets = useMemo<DisplayTicket[]>(() => operations.data?.tickets.map((ticket) => ({
    sourceId: ticket.id,
    id: ticket.externalTicketId,
    channelKey: ticket.channelKey,
    customer: ticket.customerName,
    channel: channelNameByKey[ticket.channelKey] ?? ticket.channelKey,
    subject: ticket.subject,
    originalMessage: ticket.message,
    preview: ticket.translatedMessage ?? ticket.message,
    replyDraft: ticket.replyDraft,
    time: relativeTime(ticket.receivedAt),
    status: ticketStatusLabel[ticket.status],
  })) ?? [], [operations.data]);

  const unifiedSearchResults = useMemo(() => {
    const products: UnifiedSearchResult[] = displayProducts.map((product) => ({
      kind: "product",
      id: product.sourceId,
      title: product.name,
      subtitle: `${product.sku} · ${product.id}`,
      meta: `${product.status} · 재고 ${product.stock.toLocaleString()}개`,
      searchable: `${product.name} ${product.sku} ${product.id} ${product.description} ${product.status}`,
    }));
    const orders: UnifiedSearchResult[] = displayOrders.map((order) => ({
      kind: "order",
      id: order.id,
      title: order.id,
      subtitle: `${order.customer} · ${order.product}`,
      meta: `${order.status} · ${order.amount}`,
      searchable: `${order.id} ${order.customer} ${order.product} ${order.status} ${order.amount}`,
    }));
    const inquiries: UnifiedSearchResult[] = displayTickets.map((ticket) => ({
      kind: "inquiry",
      id: ticket.id,
      title: ticket.subject,
      subtitle: `${ticket.customer} · ${ticket.channel}`,
      meta: `${ticket.status} · ${ticket.time}`,
      searchable: `${ticket.id} ${ticket.customer} ${ticket.channel} ${ticket.subject} ${ticket.preview} ${ticket.status}`,
    }));
    return {
      products: products.filter((item) => matchesSearch(item.searchable, searchQuery)).slice(0, 5),
      orders: orders.filter((item) => matchesSearch(item.searchable, searchQuery)).slice(0, 5),
      inquiries: inquiries.filter((item) => matchesSearch(item.searchable, searchQuery)).slice(0, 5),
    };
  }, [displayOrders, displayProducts, displayTickets, searchQuery]);
  const unifiedSearchResultCount = unifiedSearchResults.products.length + unifiedSearchResults.orders.length + unifiedSearchResults.inquiries.length;

  const openSearch = useCallback(() => {
    setSearchQuery("");
    setSearchOpen(true);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, []);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [openSearch]);

  const fulfillOrders = useCallback(async (shipments: ShipmentInput[]): Promise<ShipmentResult> => {
    try {
      const response = await operations.authenticatedFetch("/api/admin/orders/fulfill", {
        method: "POST",
        body: JSON.stringify({ confirmWrite: true, shipments }),
      });
      const payload = await response.json().catch(() => ({ message: "판매채널 발송 처리 응답을 읽지 못했습니다." })) as ShipmentResult & { message?: string };
      if (!response.ok && response.status !== 207) throw new Error(payload.message ?? "판매채널 발송 처리를 완료하지 못했습니다.");
      await operations.reload();
      notify(payload.message ?? `${payload.succeeded}건 발송 완료 · ${payload.failed}건 확인 필요`);
      return {
        succeeded: Number(payload.succeeded ?? 0),
        failed: Number(payload.failed ?? shipments.length),
        results: Array.isArray(payload.results) ? payload.results : [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "판매채널 발송 처리를 완료하지 못했습니다.";
      notify(message);
      return { succeeded: 0, failed: shipments.length, results: shipments.map((shipment) => ({ id: shipment.id, channel: "unknown", ok: false, message })) };
    }
  }, [notify, operations]);

  const saveTicketReply = useCallback(async (ticket: DisplayTicket, reply: string) => {
    const source = operations.data?.tickets.find((item) => item.id === ticket.sourceId);
    if (!source) {
      notify("운영 DB 마이그레이션 적용 후 CS 답변을 저장할 수 있습니다.");
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

  const updateTicketStatus = useCallback(async (ticket: DisplayTicket, status: "waiting" | "in_progress" | "resolved") => {
    const source = operations.data?.tickets.find((item) => item.id === ticket.sourceId);
    if (!source) return false;
    try {
      const response = await operations.authenticatedFetch("/api/operations/snapshot", {
        method: "POST",
        body: JSON.stringify({ action: "ticket_update", id: source.id, status, replyDraft: source.replyDraft ?? undefined }),
      });
      if (!response.ok) throw new Error("문의 처리 상태를 저장하지 못했습니다.");
      await operations.reload();
      return true;
    } catch (error) {
      notify(error instanceof Error ? error.message : "문의 처리 상태를 저장하지 못했습니다.");
      return false;
    }
  }, [notify, operations]);

  const generateSupportReply = useCallback(async (ticket: DisplayTicket, targetLocale: SupportLocale) => {
    const jobId = crypto.randomUUID();
    try {
      const queued = await operations.authenticatedFetch("/api/ai/support-reply", {
        method: "POST",
        body: JSON.stringify({ jobId, ticketId: ticket.sourceId, targetLocale, tone: "polite" }),
      });
      const queuedPayload = await queued.json().catch(() => ({ message: "CLI 작업 응답을 읽지 못했습니다." })) as { message?: string };
      if (!queued.ok) throw new Error(queuedPayload.message ?? "CLI 답변 작업을 시작하지 못했습니다.");
      notify("ChatGPT CLI가 문의와 주문 맥락을 확인하고 있습니다.");

      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolveDelay) => window.setTimeout(resolveDelay, 2_000));
        const response = await operations.authenticatedFetch(`/api/ai/jobs/${jobId}`);
        const payload = await response.json().catch(() => null) as null | {
          status?: string;
          error?: string;
          result?: { mode?: string; draft?: string; targetLocale?: string };
        };
        if (!response.ok || !payload) throw new Error("CLI 답변 작업 상태를 확인하지 못했습니다.");
        if (payload.status === "failed") throw new Error(payload.error || "CLI 답변 초안 생성에 실패했습니다.");
        if (payload.status === "succeeded") {
          if (payload.result?.mode !== "support-reply" || typeof payload.result.draft !== "string") {
            throw new Error("CLI 답변 결과 형식을 확인하지 못했습니다.");
          }
          return payload.result.draft;
        }
      }
      throw new Error("CLI 작업이 대기 중입니다. 작업자 연결 상태를 확인한 뒤 다시 시도해 주세요.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "CLI 답변 초안을 만들지 못했습니다.");
      return null;
    }
  }, [notify, operations]);

  const syncOrders = useCallback(async (silent = false) => {
    if (syncingOrders) return;
    setSyncingOrders(true);
    try {
      const response = await operations.authenticatedFetch("/api/operations/sync", {
        method: "POST",
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({ message: "주문 동기화 응답을 읽지 못했습니다." })) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "판매채널 주문 동기화를 시작하지 못했습니다.");
      if (!silent) notify("연결된 판매채널의 실제 주문·고객 문의 조회를 시작했습니다. 결과는 자동 반영됩니다.");
      window.setTimeout(() => void operations.reload(), 3_000);
      window.setTimeout(() => void operations.reload(), 12_000);
      window.setTimeout(() => void operations.reload(), 30_000);
    } catch (error) {
      if (!silent) notify(error instanceof Error ? error.message : "판매채널 주문·문의 동기화를 시작하지 못했습니다.");
    } finally {
      setSyncingOrders(false);
    }
  }, [notify, operations, syncingOrders]);

  useEffect(() => {
    if (view !== "orders" && view !== "cs") return;
    const key = "sellerpilot-operation-sync-requested-at";
    const previous = Number(window.sessionStorage.getItem(key) ?? 0);
    const run = () => {
      window.sessionStorage.setItem(key, String(Date.now()));
      void syncOrders(true);
    };
    const timer = Date.now() - previous >= 5 * 60_000 ? window.setTimeout(run, 0) : null;
    const interval = window.setInterval(run, 5 * 60_000);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [syncOrders, view]);

  const navigate = useCallback((next: View) => {
    setTargetedSearch(null);
    if (next === "publishing") setPublishingProduct(null);
    setView(next);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get("view") as View | null;
    if (!requestedView || !deepLinkViews.has(requestedView)) return;
    const orderId = params.get("orderId");
    const timer = window.setTimeout(() => {
      setView(requestedView);
      if (requestedView === "orders" && orderId) {
        const order = operations.data?.orders.find((item) => item.id === orderId);
        if (order) setTargetedSearch({ kind: "order", id: order.externalOrderId, query: order.externalOrderId });
      }
      window.history.replaceState(null, "", window.location.pathname);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [operations.data]);

  const openProductDetails = useCallback((product: DisplayProduct) => {
    setSelectedProduct(product);
    setView("product-detail");
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const selectUnifiedSearchResult = useCallback((result: UnifiedSearchResult) => {
    setSearchOpen(false);
    setSearchQuery("");
    if (result.kind === "product") {
      const product = displayProducts.find((item) => item.sourceId === result.id);
      if (product) openProductDetails(product);
      return;
    }
    setTargetedSearch({ kind: result.kind, id: result.id, query: result.id });
    setView(result.kind === "order" ? "orders" : "cs");
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [displayProducts, openProductDetails]);

  const content = (() => {
    if (view === "overview") return <OverviewPage onNavigate={navigate} onOpenProduct={openProductDetails} displayProducts={displayProducts} operationSummary={operationSummary} channelMetrics={channelMetrics} pipeline={pipeline} operationsAvailable={operations.state === "database"} />;
    if (view === "products") return <ProductsPage onNavigate={navigate} onOpenProduct={openProductDetails} onRefresh={operations.reload} displayProducts={displayProducts} />;
    if (view === "product-detail" && selectedProduct) return <ProductDetailPage product={selectedProduct} onBack={() => navigate("products")} authenticatedFetch={operations.authenticatedFetch} />;
    if (view === "publishing") return <PublishingPage key={publishingProduct?.id ?? "new-product"} notify={notify} channelMetrics={channelMetrics} pipeline={pipeline} listingIssues={operations.data?.listingIssues ?? []} onOpenIssue={(productId) => { const product = displayProducts.find((item) => item.sourceId === productId); if (product) openProductDetails(product); }} initialProduct={publishingProduct} />;
    if (view === "style-learning") return <StyleLearningCenter />;
    if (view === "margin") return <MarginCalculatorPage notify={notify} scenarios={Array.isArray(operations.data?.marginScenarios) ? operations.data.marginScenarios : []} onChanged={() => void operations.reload()} />;
    if (view === "orders") return <OrdersPage key={`orders-${targetedSearch?.kind === "order" ? targetedSearch.id : "all"}`} notify={notify} displayOrders={displayOrders} onFulfill={fulfillOrders} syncStatus={operations.data?.syncStatus ?? []} initialQuery={targetedSearch?.kind === "order" ? targetedSearch.query : ""} initialOrderId={targetedSearch?.kind === "order" ? targetedSearch.id : null} />;
    if (view === "cs") return <CsPage key={`cs-${targetedSearch?.kind === "inquiry" ? targetedSearch.id : "all"}`} notify={notify} displayTickets={displayTickets} displayOrders={displayOrders} onSend={saveTicketReply} onDraft={generateSupportReply} onStatus={updateTicketStatus} onSync={syncOrders} syncing={syncingOrders} syncStatus={operations.data?.syncStatus ?? []} initialQuery={targetedSearch?.kind === "inquiry" ? targetedSearch.query : ""} initialTicketId={targetedSearch?.kind === "inquiry" ? targetedSearch.id : null} />;
    if (view === "connections") return <ChannelConnectionsPage notify={notify} channelMetrics={channelMetrics} />;
    if (view === "acceptance") return <AcceptanceChecklistPage />;
    if (view === "storyboard") return <StoryboardPage onNavigate={navigate} />;
    const channelKey = view as ChannelKey;
    return <ChannelPage channelKey={channelKey} onNavigate={navigate} metric={channelMetrics.find((metric) => metric.channelKey === channelKey) ?? null} displayProducts={displayProducts} />;
  })();

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-head"><div className="brand-lockup light"><span className="brand-symbol"><Zap size={17} fill="currentColor" /></span><span className="sidebar-brand-copy"><strong>SellerPilot</strong><small>SELLER CONTROL</small></span></div><button aria-label="메뉴 닫기" onClick={() => setSidebarOpen(false)}><PanelLeftClose size={18} /></button></div>
        <nav>{navGroups.map((group) => <div className="nav-group" key={group.label}><span className="nav-label">{group.label}</span>{group.items.map((item) => {
          const Icon = "icon" in item ? item.icon : null;
          const isActive = view === item.id;
          const isDisabled = "disabled" in item && item.disabled;
          return <button key={item.id} className={`${isActive ? "active" : ""} ${isDisabled ? "channel-disabled" : ""}`.trim()} onClick={() => { if (!isDisabled) navigate(item.id); }} disabled={isDisabled} aria-label={isDisabled ? `${item.label} 연동 준비 중` : item.label}>{Icon ? <Icon size={17} /> : <ChannelMark code={(item as { channel: string }).channel} size="sm" />}<span>{item.label}</span>{isDisabled ? <em>준비중</em> : isActive ? <ChevronRight size={14} /> : null}</button>;
        })}</div>)}</nav>
        <div className="sidebar-insight"><div><Activity size={15} /><span>채널 연결 현황</span><em>LIVE</em></div><p><b>{enabledSalesChannelCount}개 판매채널</b> 인증과 기능 차이를<br />보안 저장소에서 관리합니다.</p><span><i /></span><small>키 만료일·OAuth·갱신 주기 관리</small></div>
        <div className="sidebar-foot"><button onClick={() => void onLogout()}><LogOut size={17} /><span>로그아웃</span></button></div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="메뉴 닫기" onClick={() => setSidebarOpen(false)} />}

      <section className="app-main">
        <div className="app-header-stack">
          <div className="commerce-service-rail" aria-label="채널 운영 상태">
            <strong>통합 판매관리</strong>
            <span><i className={operations.state === "database" ? "rail-ok" : "rail-pending"} />{operations.state === "database" ? "판매 데이터 원장 연결" : "판매 데이터 확인 중"}</span>
            <span><i className={operationSummary?.registeredCredentialCount ? "rail-ok" : "rail-pending"} />운영 키 {operationSummary?.registeredCredentialCount ?? 0} / {enabledSalesChannelCount}</span>
            <span><i className={operationSummary?.activeCredentialCount ? "rail-ok" : "rail-pending"} />읽기 진단 {operationSummary?.activeCredentialCount ?? 0} / {enabledSalesChannelCount}</span>
            <span><i className={workerConnected ? "rail-ok" : "rail-pending"} />자동 동기화 {workerConnected ? "실행 중" : "확인 필요"}</span>
            <span><i className="rail-ok" />인증정보 암호화 보관</span>
            <em>{operations.state === "database" ? "실제 연결 상태 1분 자동 갱신" : operations.state === "loading" ? "연결 상태 확인 중" : "운영 DB 연결 오류"}</em>
          </div>
          <header className="topbar">
          <div className="topbar-title"><button className="mobile-menu-button" aria-label="전체 메뉴 열기" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><div><h1>{meta.title}</h1><p>{meta.description}</p></div></div>
          <div className="topbar-actions"><span className={`demo-data-badge ${operations.state === "database" ? "database" : ""}`} title={operations.message}><Activity size={13} /><b>{operations.state === "database" ? "실데이터" : operations.state === "loading" ? "연결 확인" : "연결 오류"}</b><small>{operations.state === "database" ? "Supabase 운영 원장" : operations.message}</small></span><button className="global-search" aria-label="통합 검색 열기" onClick={openSearch}><Search size={16} /><span>상품, 주문, 문의 검색</span><kbd><Command size={11} />K</kbd></button><div className="notification-wrap"><button className="top-icon-button" aria-label="알림" onClick={() => setNotificationsOpen((current) => !current)}><Bell size={18} />{Boolean((operationSummary?.lowStockCount ?? 0) + (operationSummary?.registrationErrorCount ?? 0)) && <i />}</button>{notificationsOpen && <div className="notification-popover"><div><h4>실시간 알림</h4><button onClick={() => setNotificationsOpen(false)}>닫기</button></div><button onClick={() => navigate("products")}><span className="alert-icon danger"><Box size={15} /></span><span><b>재고주의 상품 {operationSummary?.lowStockCount ?? 0}건</b><small>운영 원장 실재고 기준</small></span></button><button onClick={() => navigate("publishing")}><span className="alert-icon warning"><AlertCircle size={15} /></span><span><b>등록 실패 {operationSummary?.registrationErrorCount ?? 0}건</b><small>채널 API 작업 이력 기준</small></span></button></div>}</div><button className="user-menu" onClick={() => { setCredentialMessage(""); setNewAdminPassword(""); setAccountOpen(true); }} aria-label="관리자 계정 설정 열기"><span className="user-avatar">관</span><span><b>{userEmail.split("@")[0]}</b><small>보안 관리자</small></span><ChevronDown size={14} /></button></div>
          </header>
        </div>
        <div className="app-content">{content}</div>
      </section>

      <MobilePushManager authenticatedFetch={operations.authenticatedFetch} />

      {searchOpen && <div className="command-overlay"><div className="command-dialog" role="dialog" aria-modal="true" aria-label="통합 검색"><div className="command-input"><Search size={18} /><input ref={searchInputRef} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setSearchOpen(false); return; } if (event.key !== "Enter") return; const first = unifiedSearchResults.products[0] ?? unifiedSearchResults.orders[0] ?? unifiedSearchResults.inquiries[0]; if (first) selectUnifiedSearchResult(first); }} placeholder="상품명, 주문번호, 고객명 또는 문의 내용 검색" aria-label="통합 검색어" /><button aria-label="검색창 닫기" onClick={() => setSearchOpen(false)}><X size={17} /></button></div>{searchQuery.trim() ? <div className="command-results" aria-live="polite">{unifiedSearchResultCount > 0 ? <>{([{ label: "상품", items: unifiedSearchResults.products, icon: Package }, { label: "주문", items: unifiedSearchResults.orders, icon: ShoppingCart }, { label: "문의", items: unifiedSearchResults.inquiries, icon: MessageCircleMore }] as const).map((group) => group.items.length > 0 && <section key={group.label}><span className="command-label">{group.label} <b>{group.items.length}</b></span>{group.items.map((result) => <button type="button" className="command-result" key={`${result.kind}-${result.id}`} onClick={() => selectUnifiedSearchResult(result)}><span className={`command-result-icon ${result.kind}`}><group.icon size={16} /></span><span><b>{result.title}</b><small>{result.subtitle}</small></span><em>{result.meta}</em><ArrowRight size={14} /></button>)}</section>)}</> : <div className="command-empty"><Search size={24} /><b>일치하는 상품·주문·문의가 없습니다.</b><small>상품명, SKU, 주문번호, 고객명 또는 문의 내용을 확인해 주세요.</small></div>}</div> : <><span className="command-label">빠른 이동</span>{navGroups[0].items.map((item) => { const Icon = "icon" in item ? item.icon : null; return Icon ? <button key={item.id} onClick={() => { navigate(item.id); setSearchOpen(false); }}><Icon size={17} /><span>{item.label}</span><ArrowRight size={14} /></button> : null; })}</>}</div></div>}
      {accountOpen && <div className="account-security-overlay"><section className="account-security-dialog" role="dialog" aria-modal="true" aria-labelledby="account-security-title"><div className="account-security-head"><span><ShieldCheck size={18} /></span><div><h2 id="account-security-title">관리자 로그인 정보 변경</h2><p>현재 계정의 로그인 아이디를 admin으로 변경합니다.</p></div><button aria-label="계정 설정 닫기" onClick={() => setAccountOpen(false)} disabled={credentialChanging}><X size={17} /></button></div><div className="account-security-values"><div><small>새 아이디</small><strong>admin</strong></div><label><small>새 비밀번호</small><input type="password" value={newAdminPassword} onChange={(event) => setNewAdminPassword(event.target.value)} autoComplete="new-password" placeholder="보안 정책에 맞게 입력" /></label></div><p className="account-security-warning"><AlertTriangle size={16} />Supabase 보안 정책상 10자 이상이며 영문 대·소문자, 숫자, 특수문자를 모두 포함해야 합니다. 변경이 완료되면 현재 세션에서 로그아웃됩니다.</p>{credentialMessage && <p className="account-security-message">{credentialMessage}</p>}<button className="account-security-submit" type="button" onClick={() => void changeAdminCredentials()} disabled={credentialChanging || !newAdminPassword}>{credentialChanging ? <><LoaderCircle className="spin" size={17} />변경 중</> : <><KeyRound size={17} />admin 계정으로 변경</>}</button></section></div>}
      {toast && <div className="toast"><CheckCircle2 size={18} /><span>{toast}</span><button onClick={() => setToast("")}><X size={14} /></button></div>}
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
        const payload = await response.json().catch(() => ({ message: "채널 OAuth 응답을 읽지 못했습니다." })) as { message: string };
        if (!response.ok) throw new Error(payload.message);
        setOauthNotice(payload.message);
      } catch (oauthError) {
        setOauthNotice(oauthError instanceof Error ? oauthError.message : "채널 OAuth 연결을 완료하지 못했습니다.");
      } finally {
        setPendingChannelOAuth(null);
        window.setTimeout(() => setOauthNotice(""), 6_000);
      }
    };
    void completeChannelOAuth();
  }, [accessState, pendingChannelOAuth]);

  const login = async (email: string, password: string) => {
    if (!isSupabaseConfigured) return "운영 인증 서버가 아직 연결되지 않았습니다.";
    const loginId = email.trim().toLowerCase();
    const normalizedEmail = loginId === "admin"
      ? "admin@couplit-official.test"
      : loginId === "sample"
        ? "sample@couplit-official.test"
        : email.trim();
    const { error } = await createSupabaseClient().auth.signInWithPassword({ email: normalizedEmail, password });
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

  if (accessState === "checking") {
    return <main className="login-shell"><section className="login-form-panel"><div className="login-card"><LoaderCircle className="spin" size={24} /><h2>관리자 권한 확인 중</h2><p>로그인 세션과 운영 데이터 접근 권한을 안전하게 확인하고 있습니다.</p></div></section></main>;
  }
  if (accessState === "forbidden") {
    return <main className="login-shell"><section className="login-form-panel"><div className="login-card"><AlertTriangle size={26} /><h2>관리자 권한이 필요합니다.</h2><p>{userEmail || "현재 계정"}은 SellerPilot 관리자 명단에 없습니다. Supabase의 <b>sellerpilot_private.admin_users</b> 승인 후 접근할 수 있습니다.</p><button type="button" className="login-submit" onClick={() => void logout()}><LogOut size={16} />다른 계정으로 로그인</button></div></section></main>;
  }
  return accessState === "admin"
    ? <><DashboardShell onLogout={logout} userEmail={userEmail} />{oauthNotice && <div className="toast"><KeyRound size={18} /><span>{oauthNotice}</span><button onClick={() => setOauthNotice("")}><X size={14} /></button></div>}</>
    : <LoginScreen onLogin={login} onPasswordReset={resetPassword} />;
}
