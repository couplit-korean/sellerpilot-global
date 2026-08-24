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
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CloudUpload,
  ClipboardCheck,
  Command,
  Download,
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
  PencilRuler,
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
import { useOperationsSnapshot, type OperationsSnapshot, type SalesRange } from "./use-operations-snapshot";
import { createClient as createSupabaseClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";
import type { ProductResearchResult } from "../lib/ai-cli-contract";
import { emptyProductIntake, productConditions, productCurrencies, productIntakeSchema, type ProductIntakeDraft } from "../lib/product-intake";
import { buildPaidOrdersExcelWorkbook, paidOrdersExcelFilename } from "../lib/order-excel";

type View =
  | "overview"
  | "products"
  | "product-detail"
  | "publishing"
  | "registration-activity"
  | "remediation"
  | "style-learning"
  | "margin"
  | "orders"
  | "cs"
  | "connections"
  | "templates"
  | "notifications"
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
      { id: "registration-activity" as View, label: "등록 진행 · 히스토리", icon: Clock3 },
      { id: "margin" as View, label: "마진 계산", icon: Calculator },
      { id: "orders" as View, label: "주문 · 판매", icon: ShoppingCart },
      { id: "cs" as View, label: "CS 통합함", icon: Headphones },
      { id: "connections" as View, label: "채널 연결 · 상태", icon: ShieldCheck },
      { id: "templates" as View, label: "템플릿 설정", icon: FileText },
      { id: "notifications" as View, label: "알림 설정", icon: Bell },
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
      { id: "style-learning" as View, label: "스타일 학습 검증", icon: Sparkles },
    ],
  },
];

const pageMeta: Record<View, { title: string; description: string }> = {
  overview: { title: "통합 대시보드", description: "모든 채널의 오늘을 한눈에 확인하세요." },
  products: { title: "상품 관리", description: "채널별 등록 상태, 재고와 판매 성과를 관리합니다." },
  "product-detail": { title: "상품 상세정보", description: "등록된 상품의 이미지, 기본 정보, 재고와 채널 상태를 확인합니다." },
  publishing: { title: "상품 등록 센터", description: "대표사진과 다양한 각도 사진, 설명과 링크를 함께 분석해 채널 등록을 자동화합니다." },
  "registration-activity": { title: "등록 진행 · 히스토리", description: "상품별 분석·채널 등록 상태와 실제 소요 시간을 한곳에서 확인합니다." },
  remediation: { title: "외부 권한 · 상품수정", description: "판매자센터에서 보완해야 할 상품만 한 건씩 확인하고 바로 수정합니다." },
  "style-learning": { title: "스타일 학습 검증", description: "6개 카테고리 1,200개 상품 범위와 8개 채널의 국가·언어별 제작 규칙을 확인합니다." },
  margin: { title: "마진 계산", description: "원가와 채널 비용을 반영해 순이익과 목표 마진 판매가를 계산합니다." },
  orders: { title: "주문 · 판매", description: "전체 채널의 주문과 배송 흐름을 한곳에서 처리합니다." },
  cs: { title: "CS 통합함", description: "언어와 채널이 달라도 하나의 상담함에서 응대합니다." },
  connections: { title: "채널 연결 · 상태", description: "판매채널 연결 상태, API 인증과 차단 요인을 한곳에서 관리합니다." },
  templates: { title: "템플릿 설정", description: "자주 쓰는 배송비, 포장과 배송 규칙을 저장해 상품 등록에 즉시 적용합니다." },
  notifications: { title: "알림 설정", description: "웹과 가입한 사용자 본인의 카카오톡 알림을 업무 유형별로 설정합니다." },
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
  channelSales: Array<{ channelKey: string; channelCode: string; sold: number; revenueKrw: number }>;
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
  shippedAt: string | null;
  deliveredAt: string | null;
  carrierCode: string | null;
  trackingNumber: string | null;
  settlementStatus: string;
  settlementAmount: number | null;
  settlementCurrency: string | null;
  exchangeLossPercent: number | null;
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

type CommerceTemplate = { id: string; name: string; kind: "shipping_fee" | "packaging_shipping"; values: Record<string, string | number | boolean | null>; is_default: boolean; updated_at: string };

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

function localDateString(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function salesRangeForPreset(preset: SalesRange["preset"]): SalesRange {
  const now = new Date();
  const to = localDateString(now);
  if (preset === "day") return { preset, from: to, to };
  if (preset === "week") return { preset, from: localDateString(new Date(now.getTime() - 6 * 86_400_000)), to };
  if (preset === "year") return { preset, from: localDateString(new Date(now.getFullYear(), 0, 1)), to };
  return { preset: preset === "custom" ? "custom" : "month", from: localDateString(new Date(now.getFullYear(), now.getMonth(), 1)), to };
}

function SalesRangeControl({ range, onChange, compact = false }: { range: SalesRange; onChange: (range: SalesRange) => void; compact?: boolean }) {
  return <div className={`sales-range-control ${compact ? "compact" : ""}`}>
    <div className="segmented-control" aria-label="매출 집계 기간">{(["day", "week", "month", "year", "custom"] as const).map((preset) => <button type="button" className={range.preset === preset ? "active" : ""} onClick={() => onChange(preset === "custom" ? { ...range, preset } : salesRangeForPreset(preset))} key={preset}>{{ day: "일", week: "주", month: "월", year: "연", custom: "맞춤" }[preset]}</button>)}</div>
    {range.preset === "custom" ? <div className="custom-date-range"><label><span className="sr-only">시작일</span><input type="date" value={range.from} max={range.to} onChange={(event) => onChange({ ...range, from: event.target.value })} /></label><span>—</span><label><span className="sr-only">종료일</span><input type="date" value={range.to} min={range.from} onChange={(event) => onChange({ ...range, to: event.target.value })} /></label></div> : <span className="selected-date-range"><CalendarDays size={14} />{range.from} — {range.to}</span>}
  </div>;
}

function ProductVisual({ src, size, alt = "상품 이미지" }: { src: string | null; size: string; alt?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  return src && failedSrc !== src
    ? <Image src={src} alt={alt} fill sizes={size} unoptimized onError={() => setFailedSrc(src)} />
    : <span className="product-image-missing" role="img" aria-label={`${alt} 없음`}><Package size={17} /><small>이미지 없음</small></span>;
}

function OverviewPage({ onNavigate, displayProducts, operationSummary, channelMetrics, pipeline, analytics, salesRange, onSalesRangeChange, resolvedCsCount, operationsAvailable }: {
  onNavigate: (view: View) => void;
  displayProducts: DisplayProduct[];
  operationSummary: OperationsSnapshot["summary"] | null;
  channelMetrics: OperationsSnapshot["channelMetrics"];
  pipeline: OperationsSnapshot["pipeline"] | null;
  analytics: OperationsSnapshot["analytics"] | null;
  salesRange: SalesRange;
  onSalesRangeChange: (range: SalesRange) => void;
  resolvedCsCount: number;
  operationsAvailable: boolean;
}) {
  const [exchangeRates, setExchangeRates] = useState(initialExchangeRates);
  const [rateUpdatedAt, setRateUpdatedAt] = useState("화면 기준값");
  const [rateSource, setRateSource] = useState("실데이터 확인 중");
  const [today] = useState(() => new Date());
  const monthlyTopProducts = useMemo(() => [...displayProducts].sort((a, b) => b.sales - a.sales).slice(0, 10), [displayProducts]);
  const activeMetrics = useMemo(() => {
    const periodByChannel = new Map((analytics?.channels ?? []).map((channel) => [channel.channelKey, channel]));
    return channelMetrics
      .filter((channel) => activeChannelKeys.includes(channel.channelKey as (typeof activeChannelKeys)[number]))
      .map((channel) => {
        const period = periodByChannel.get(channel.channelKey);
        return { ...channel, revenue30dKrw: period?.revenueKrw ?? 0, sold30d: period?.sold ?? 0, orderCount: period?.orderCount ?? 0 };
      })
      .sort((left, right) => right.revenue30dKrw - left.revenue30dKrw || right.orderCount - left.orderCount || left.name.localeCompare(right.name, "ko"));
  }, [analytics, channelMetrics]);
  const summary = operationSummary ?? { revenue30dKrw: 0, sold30d: 0, orderCount: 0, paidOrderCount: 0, readyToShipCount: 0, openTicketCount: 0, lowStockCount: 0, productCount: 0, registrationErrorCount: 0, registrationBlockedCount: 0, activeCredentialCount: 0, registeredCredentialCount: 0, settlementRiskCount: 0 };
  const livePipeline = pipeline ?? { aiRunning: 0, listingQueued: 0, listingPublished: 0, listingFailed: 0, listingBlocked: 0 };
  const totalTasks = summary.paidOrderCount + summary.readyToShipCount + summary.openTicketCount + summary.registrationErrorCount;
  const totalListings = livePipeline.listingPublished + livePipeline.listingFailed + livePipeline.listingBlocked;
  const successRate = totalListings > 0 ? (livePipeline.listingPublished / totalListings) * 100 : 0;
  const maxChannelRevenue = Math.max(1, ...activeMetrics.map((channel) => channel.revenue30dKrw));
  const currentDate = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(today);
  const periodRevenue = analytics?.summary.revenueKrw ?? 0;
  const periodSold = analytics?.summary.sold ?? 0;
  const periodOrders = analytics?.summary.orderCount ?? 0;
  const calendarDays = analytics?.daily ?? [];
  const calendarOffset = calendarDays.length ? new Date(`${calendarDays[0].date.slice(0, 10)}T12:00:00`).getDay() : 0;

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
          <button onClick={() => onNavigate("registration-activity")}><span className="task-tone error" /><small>재시도 오류</small><b>{operationsAvailable ? summary.registrationErrorCount : "—"}</b><em>권한 대기 {summary.registrationBlockedCount}건</em></button>
        </div>
        <aside className="briefing-settlement"><span>실제 연결 확인</span><strong>{operationsAvailable ? `${summary.activeCredentialCount} / ${enabledSalesChannelCount} 진단 통과` : "확인 중"}</strong><small>운영 키 {summary.registeredCredentialCount} / {enabledSalesChannelCount} · 미등록·미검증 채널을 전체 수에서 숨기지 않습니다.</small><button onClick={() => onNavigate("connections")}>채널 연결 관리<ChevronRight size={14} /></button></aside>
      </section>
      <section className="overview-toolbar">
        <article className="exchange-widget" aria-label="현재 환율">
          <div className="exchange-title"><span><i />기준 환율</span><small>KRW 기준 · {rateUpdatedAt}</small><small>{rateSource}</small></div>
          <div className="exchange-rate-list">{exchangeRates.map((rate) => <div className="exchange-rate" key={rate.code}><small>{rate.code} {rate.unit}</small><strong>₩{rate.value.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong><em className={rate.change >= 0 ? "up" : "down"}>{rate.change >= 0 ? "▲" : "▼"} {Math.abs(rate.change).toFixed(2)}%</em></div>)}</div>
          <button type="button" className="exchange-refresh" aria-label="환율 새로고침" title="환율 새로고침" onClick={refreshExchangeRates}><RefreshCw size={14} /></button>
        </article>
        <div className="overview-date-actions"><SalesRangeControl range={salesRange} onChange={onSalesRangeChange} /></div>
      </section>

      <section className="metric-grid">
        <MetricCard label="선택 기간 매출" value={operationsAvailable ? formatCompactWon(periodRevenue) : "—"} detail={`${salesRange.from} — ${salesRange.to}`} icon={CircleDollarSign} tone="violet" />
        <MetricCard label="선택 기간 주문" value={operationsAvailable ? periodOrders.toLocaleString() : "—"} detail={`결제완료 ${summary.paidOrderCount} · 출고대기 ${summary.readyToShipCount}`} icon={ShoppingBag} tone="blue" />
        <MetricCard label="관리 상품" value={operationsAvailable ? summary.productCount.toLocaleString() : "—"} detail={`선택 기간 ${periodSold.toLocaleString()}개 판매`} icon={PackageCheck} tone="green" />
        <MetricCard label="미처리 CS" value={operationsAvailable ? summary.openTicketCount.toLocaleString() : "—"} detail={`재고주의 ${summary.lowStockCount}건`} icon={MessageCircleMore} tone="orange" />
      </section>

      <section className="panel sales-calendar-panel">
        <div className="panel-heading"><div><span className="panel-kicker">국내 · 해외 · 채널 통합</span><h3>날짜별 실매출 달력</h3></div><small>{salesRange.from} — {salesRange.to}</small></div>
        <div className="sales-calendar-weekdays">{["일","월","화","수","목","금","토"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="sales-calendar-grid">{Array.from({ length: calendarOffset }, (_, index) => <span className="calendar-blank" key={`blank-${index}`} />)}{calendarDays.map((day) => <article key={day.date}><time>{Number(day.date.slice(8,10))}</time><b>{formatCompactWon(day.revenueKrw)}</b><small>국내 {formatCompactWon(day.domesticRevenueKrw)}</small><small>해외 {formatCompactWon(day.overseasRevenueKrw)}</small></article>)}</div>
      </section>

      <section className="dashboard-cs-pair" aria-label="CS 처리 현황">
        <button className="panel" onClick={() => onNavigate("cs")}><span className="metric-icon orange"><Inbox size={18} /></span><span><small>미처리 CS</small><strong>{summary.openTicketCount.toLocaleString()}건</strong><em>답변 대기 · 처리 중</em></span><ChevronRight size={16} /></button>
        <button className="panel" onClick={() => onNavigate("cs")}><span className="metric-icon green"><CheckCircle2 size={18} /></span><span><small>완료 CS</small><strong>{resolvedCsCount.toLocaleString()}건</strong><em>처리 완료 원장</em></span><ChevronRight size={16} /></button>
      </section>

      <section className="dashboard-main-grid">
        <article className="panel revenue-panel">
          <div className="panel-heading"><div><span className="panel-kicker">실매출 분석</span><h3>채널별 선택 기간 매출</h3></div><button className="ghost-button" onClick={() => onNavigate("products")}>상품 원장<ChevronRight size={15} /></button></div>
          <div className="live-channel-bars">{activeMetrics.map((channel) => <button key={channel.channelKey} onClick={() => onNavigate(channel.channelKey as View)}><span><i style={{ background: channel.color }} />{channel.name}</span><b>{formatCompactWon(channel.revenue30dKrw)}</b><em>{channel.orderCount.toLocaleString()}건</em><small><i style={{ width: `${Math.round((channel.revenue30dKrw / maxChannelRevenue) * 100)}%`, background: channel.color }} /></small></button>)}</div>
        </article>

        <article className="panel top-ranking-card">
          <div className="panel-heading"><div><span className="panel-kicker">선택 기간 판매량 기준</span><h3>이번 달 판매 TOP 10</h3></div><span className="rank-crown">1–10</span></div>
          <div className="monthly-ranking-list">
            {monthlyTopProducts.map((product, index) => <button className={`ranking-row ${index < 3 ? "podium" : ""}`} key={product.id} onClick={() => onNavigate("products")}>
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
            {activeMetrics.map((channel) => <button className="channel-row" key={channel.channelKey} onClick={() => onNavigate(channel.channelKey as View)}><ChannelMark code={channel.channelCode} /><div className="channel-name"><strong>{channel.name}</strong><span className={channel.credentialStatus === "active" ? "connected" : channel.credentialStatus === "unverified" ? "pending" : ""}><i />{credentialConnectionLabel(channel.credentialStatus)}</span></div><div className="channel-metric"><small>선택 기간 매출</small><b>{formatCompactWon(channel.revenue30dKrw)}</b></div><div className="channel-metric"><small>실주문</small><b>{channel.orderCount.toLocaleString()}</b></div><div className="channel-progress"><span><i style={{ width: `${channel.credentialStatus === "active" ? 100 : channel.credentialStatus === "unverified" ? 55 : 0}%` }} /></span><b>{channel.failedAttemptCount ? `오류 ${channel.failedAttemptCount}` : "정상"}</b></div><ChevronRight size={16} /></button>)}
          </div>
        </article>

        <article className="panel automation-status">
          <div className="panel-heading"><div><span className="panel-kicker">오늘 자동 등록 작업</span><h3>상품 등록 현황</h3></div><button className="ghost-button" onClick={() => onNavigate("registration-activity")}>전체 보기<ChevronRight size={15} /></button></div>
          <div className="pipeline-summary"><div><strong>{totalListings}</strong><span>실제 등록 처리</span></div><i /><div><strong>{successRate.toFixed(1)}%</strong><span>등록 성공률</span></div></div>
          <div className="pipeline-list">
            {[{ label: "AI 분석 중", value: livePipeline.aiRunning, tone: "violet", icon: WandSparkles }, { label: "채널 등록 대기", value: livePipeline.listingQueued, tone: "blue", icon: Upload }, { label: "등록 완료", value: livePipeline.listingPublished, tone: "green", icon: CheckCircle2 }, { label: "재시도 가능", value: livePipeline.listingFailed, tone: "red", icon: AlertCircle }, { label: "외부 권한 대기", value: livePipeline.listingBlocked, tone: "orange", icon: ShieldCheck }].map((item) => <div className="interactive" role="button" tabIndex={0} onClick={() => onNavigate("registration-activity")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onNavigate("registration-activity"); }} key={item.label}><span className={`pipeline-icon ${item.tone}`}><item.icon size={16} /></span><span>{item.label}</span><strong>{item.value}<small>건</small></strong></div>)}
          </div>
        </article>
      </section>

      <section className="dashboard-bottom-grid">
        <article className="panel alert-panel">
          <div className="panel-heading"><div><span className="panel-kicker">운영 참고·조치</span><h3>재고·등록·CS 전체 현황</h3></div><span className="count-chip">{summary.lowStockCount + summary.registrationErrorCount + summary.registrationBlockedCount + summary.openTicketCount}</span></div>
          <div className="alert-list">
            <button onClick={() => onNavigate("products")}><span className="alert-icon danger"><Box size={16} /></span><span><b>재고주의 상품 {summary.lowStockCount}건</b><small>실재고와 재주문 기준으로 집계했습니다.</small></span><em>상품 보기<ChevronRight size={14} /></em></button>
            <button onClick={() => onNavigate("publishing")}><span className="alert-icon warning"><AlertCircle size={16} /></span><span><b>채널 등록 실패 {summary.registrationErrorCount}건</b><small>카테고리·필수 속성·API 응답을 확인하세요.</small></span><em>오류 보기<ChevronRight size={14} /></em></button>
            <button onClick={() => onNavigate("remediation")}><span className="alert-icon warning"><ShieldCheck size={16} /></span><span><b>외부 판매 권한 대기 {summary.registrationBlockedCount}건</b><small>상품수정이 필요한 항목만 한 건씩 바로 처리합니다.</small></span><em>처리하기<ChevronRight size={14} /></em></button>
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

function ProductsPage({ onNavigate, onOpenProduct, onRefresh, displayProducts, salesRange, onSalesRangeChange, operationsState }: {
  onNavigate: (view: View) => void;
  onOpenProduct: (product: DisplayProduct) => void;
  onRefresh: () => Promise<void>;
  displayProducts: DisplayProduct[];
  salesRange: SalesRange;
  onSalesRangeChange: (range: SalesRange) => void;
  operationsState: "loading" | "database" | "unavailable";
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
      <section className="summary-strip"><div><Package size={18} /><span>전체 상품<strong>{operationsState === "database" ? displayProducts.length : "—"}</strong></span></div><div><CheckCircle2 size={18} /><span>정상 판매<strong>{operationsState === "database" ? activeCount : "—"}</strong></span></div><div><AlertCircle size={18} /><span>재고 주의<strong>{operationsState === "database" ? lowStockCount : "—"}</strong></span></div><div><Box size={18} /><span>품절<strong>{operationsState === "database" ? outOfStockCount : "—"}</strong></span></div><button className="primary-button" onClick={() => onNavigate("publishing")}><Plus size={16} />새 상품 등록</button></section>
      <section className="panel data-panel">
        <div className="product-sales-range"><div><span className="panel-kicker">상품별 판매 · 매출</span><b>조회 기간</b></div><SalesRangeControl range={salesRange} onChange={onSalesRangeChange} compact /></div>
        <div className="data-toolbar"><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="상품명, SKU 검색" /></div><label className="filter-select"><Filter size={15} /><span className="sr-only">판매 채널 필터</span><select value={channelFilter} onChange={(event) => { setChannelFilter(event.target.value); setPage(1); }}><option value="all">전체 채널</option>{availableChannels.map((code) => <option value={code} key={code}>{channelByCode.get(code)?.mark ?? code}</option>)}</select><ChevronDown size={14} /></label><label className="filter-select"><ListFilter size={15} /><span className="sr-only">상품 상태 필터</span><select value={statusFilter} onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}><option value="all">전체 상태</option>{availableStatuses.map((status) => <option value={status} key={status}>{status}</option>)}</select><ChevronDown size={14} /></label><span className="toolbar-spacer" /><button className="icon-text-button" type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{refreshing ? "새로고침 중" : "목록 새로고침"}</button><div className="toolbar-menu"><button className="icon-only-button" type="button" aria-label="상품 추가 작업" aria-expanded={actionsOpen} onClick={() => setActionsOpen((open) => !open)}><MoreHorizontal size={18} /></button>{actionsOpen && <div className="toolbar-menu-popover" role="menu"><button type="button" role="menuitem" onClick={() => onNavigate("publishing")}>새 상품 등록</button><button type="button" role="menuitem" onClick={() => onNavigate("connections")}>채널 연결 관리</button></div>}</div></div>
        <div className="table-wrap"><table className="data-table product-table"><thead><tr><th>상품</th><th>판매 채널 · 판매수</th><th>재고</th><th>기간 판매</th><th>기간 매출</th><th>상태</th></tr></thead><tbody>{pagedProducts.map((product) => <tr key={product.id}><td><button type="button" className="product-cell product-cell-button" aria-label={`${product.name} 상품 상세정보 보기`} onClick={() => onOpenProduct(product)}><div className="product-thumb"><ProductVisual src={product.image} size="52px" alt={product.name} /></div><span><b>{product.name}</b><small>{product.sku} · {product.id}</small></span></button></td><td><div className="channel-sales-stack">{product.channels.map((code) => { const sales = product.channelSales.find((item) => item.channelCode === code)?.sold ?? 0; return <span key={code}><ChannelMark code={code} size="sm" /><small>{sales.toLocaleString()}</small></span>; })}</div></td><td><strong className={product.stock < 20 ? "stock-low" : ""}>{product.stock}</strong><small> 개</small></td><td><b>{product.sales}</b><small> 개</small></td><td><b>{product.revenue}</b></td><td><StatusBadge status={product.status} /></td></tr>)}</tbody></table></div>
        {operationsState === "loading" ? <div className="live-empty-state table-empty"><LoaderCircle className="spin" size={28} /><b>실상품 원장을 불러오는 중입니다.</b><small>운영 DB 확인이 끝날 때까지 0개로 확정하지 않습니다.</small></div> : operationsState === "unavailable" ? <div className="live-empty-state table-empty"><AlertCircle size={28} /><b>실상품 원장에 연결하지 못했습니다.</b><small>연결 상태를 확인한 뒤 목록 새로고침을 실행해 주세요.</small></div> : displayProducts.length === 0 ? <div className="live-empty-state table-empty"><PackageSearch size={28} /><b>실상품 데이터가 없습니다.</b><small>상품을 등록하거나 채널 동기화를 실행하면 이 목록에 표시됩니다.</small></div> : filtered.length === 0 ? <div className="live-empty-state table-empty"><Search size={28} /><b>검색 조건에 맞는 상품이 없습니다.</b><small>상품명 또는 SKU를 다시 확인해 주세요.</small></div> : null}
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

type ProductCommerceOperations = {
  aiJobId: string | null;
  supplierName: string;
  comparisonMemo: string;
  competitorQuery: string;
  competitorMonitorEnabled: boolean;
  competitorCheckedAt: string | null;
  listings: Array<{
    id: string; channel: string; channelCode: string; market: string; targetId: string; status: string;
    remoteId: string | null; marketplaceSku: string | null; inventoryQuantity: number | null; inventoryStatus: string;
    inventoryError: string | null; inventorySyncedAt: string | null; categoryId: string | null; categoryPath: string[] | null;
    categoryStatus: string | null; sold30d: number; revenue30dKrw: number;
  }>;
  competitorPrices: Array<{ id: string; marketplace: string; title: string; url: string; imageUrl: string | null; mallName: string; price: number; currency: string; checkedAt: string }>;
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

const emptyProductCommerceOperations: ProductCommerceOperations = {
  aiJobId: null, supplierName: "", comparisonMemo: "", competitorQuery: "", competitorMonitorEnabled: true, competitorCheckedAt: null, listings: [], competitorPrices: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function detailFieldValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString("ko-KR");
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

type CompetitorDisplayItem = { id: string; marketplace?: string; title: string; url: string; imageUrl: string | null; mallName: string; price: number; currency: string };

function CompetitorPriceSlots({ items, state = "ready", compact = false }: { items: CompetitorDisplayItem[]; state?: "loading" | "ready" | "unavailable"; compact?: boolean }) {
  const marketplaceOrder: string[] = [...activeChannelKeys];
  const marketplaceLabels: Record<string, string> = Object.fromEntries(Object.entries(channels).map(([key, channel]) => [key, channel.name]));
  marketplaceLabels.other = "기타 판매처";
  const groups = marketplaceOrder.map((marketplace) => ({ marketplace, items: items.filter((item) => (item.marketplace || "other") === marketplace).slice(0, 3) }));
  const otherItems = items.filter((item) => !marketplaceOrder.includes(item.marketplace || "other")).slice(0, 3);
  if (otherItems.length) groups.push({ marketplace: "other", items: otherItems });
  return <div className={`competitor-market-groups ${compact ? "compact" : ""}`}>
    {state === "loading" && <div className="competitor-loading"><LoaderCircle className="spin" size={17} />동일 상품 가격을 채널별로 찾고 있습니다.</div>}
    {groups.map((group) => <section key={group.marketplace}><header><b>{marketplaceLabels[group.marketplace] ?? group.marketplace}</b><small>최대 3개</small></header><div className="competitor-price-grid">{Array.from({ length: 3 }, (_, index) => {
      const item = group.items[index];
      return item ? <a href={item.url} target="_blank" rel="noreferrer" key={item.id}><span>{item.imageUrl ? <Image src={item.imageUrl} alt="" fill sizes="80px" unoptimized /> : <Package size={18} />}</span><div><small>{item.mallName || marketplaceLabels[group.marketplace] || "판매처"}</small><b>{item.title}</b><strong>{new Intl.NumberFormat("ko-KR", { style: "currency", currency: item.currency || "KRW", maximumFractionDigits: 0 }).format(item.price)}</strong></div><ExternalLink size={14} /></a>
        : <div className="competitor-price-empty" key={`${group.marketplace}-empty-${index}`}><span><Search size={16} /></span><div><small>{marketplaceLabels[group.marketplace] ?? "판매처"}</small><b>동일 상품을 찾지 못함</b><strong>—</strong></div></div>;
    })}</div></section>)}
    {state === "unavailable" && <p className="competitor-unavailable"><AlertCircle size={14} />가격 조회 연결을 확인하지 못했습니다. 상품 등록은 계속할 수 있으며 값은 공란으로 유지됩니다.</p>}
  </div>;
}

function productEditDraft(product: DisplayProduct, fields: Record<string, unknown>): ProductIntakeDraft {
  const text = (key: string, fallback = "") => typeof fields[key] === "string" ? String(fields[key]) : fallback;
  const number = (key: string, fallback = 0) => typeof fields[key] === "number" && Number.isFinite(fields[key]) ? Number(fields[key]) : fallback;
  const condition = text("condition", "NEW") as ProductIntakeDraft["condition"];
  const currency = text("currency", "KRW") as ProductIntakeDraft["currency"];
  const gtinStatus = text("gtinStatus", text("gtin") ? "HAS_GTIN" : "NO_GTIN") as ProductIntakeDraft["gtinStatus"];
  return {
    ...emptyProductIntake,
    researchInput: text("researchInput", product.sourceUrl || product.description || product.name),
    productName: text("productName", product.name), sellerSku: text("sellerSku", product.sku),
    categoryHint: text("categoryHint", "기존 등록 카테고리"), brandName: text("brandName", "No Brand"),
    manufacturer: text("manufacturer", "공급처 확인 필요"), countryOfOrigin: text("countryOfOrigin", "원산지 확인 필요"),
    material: text("material", "소재 확인 필요"), packageContents: /1\s*\+\s*1/.test(text("packageContents")) ? "상품 1+1" : "상품 1개",
    condition: productConditions.includes(condition) ? condition : "NEW", gtinStatus: gtinStatus === "HAS_GTIN" ? "HAS_GTIN" : "NO_GTIN", gtin: text("gtin"),
    sellingPrice: number("sellingPrice", Math.max(1, product.costKrw)), currency: productCurrencies.includes(currency) ? currency : "KRW", stock: number("stock", Math.max(1, product.onHand)),
    weightKg: number("weightKg", 0.5), packageLengthCm: number("packageLengthCm", 20), packageWidthCm: number("packageWidthCm", 20), packageHeightCm: number("packageHeightCm", 10),
    shippingFeeKrw: number("shippingFeeKrw", 0), shippingRule: text("shippingRule", "기본 배송"), packagingRule: text("packagingRule", "파손 방지 포장"),
    description: text("description", product.description || `${product.name} 상품 설명`), productUrl: text("productUrl", product.sourceUrl || ""),
    imageRightsConfirmed: typeof fields.imageRightsConfirmed === "boolean" ? fields.imageRightsConfirmed : true,
    productFactsConfirmed: typeof fields.productFactsConfirmed === "boolean" ? fields.productFactsConfirmed : true,
  };
}

function ProductDetailEditDialog({ draft, errors, saving, onChange, onClose, onSave }: {
  draft: ProductIntakeDraft;
  errors: Record<string, string>;
  saving: boolean;
  onChange: <Key extends keyof ProductIntakeDraft>(key: Key, value: ProductIntakeDraft[Key]) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return <div className="product-edit-overlay"><section className="product-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="product-edit-title">
    <header><div><span className="panel-kicker">FULL PRODUCT EDIT</span><h2 id="product-edit-title">등록 상품 전체 수정</h2><p>상품 등록 시 입력한 사실·가격·재고·포장·배송 정보를 모두 수정합니다.</p></div><button type="button" aria-label="상품 수정 닫기" onClick={onClose} disabled={saving}><X size={18} /></button></header>
    <div className="product-edit-form manual-field-grid">
      <div className="intake-group-heading"><span>01</span><div><b>기본 상품 정보</b><small>상품 식별·카테고리·공급 정보를 수정합니다.</small></div></div>
      <label className={errors.researchInput ? "field-error" : ""}><span>상품 링크 또는 설명</span><textarea value={draft.researchInput} maxLength={12_000} onChange={(event) => onChange("researchInput", event.target.value)} />{errors.researchInput && <small>{errors.researchInput}</small>}</label>
      <label className={errors.productName ? "field-error" : ""}><span>상품명</span><input value={draft.productName} onChange={(event) => onChange("productName", event.target.value)} />{errors.productName && <small>{errors.productName}</small>}</label>
      <label className={errors.sellerSku ? "field-error" : ""}><span>판매자 SKU</span><input value={draft.sellerSku} onChange={(event) => onChange("sellerSku", event.target.value.toUpperCase())} />{errors.sellerSku && <small>{errors.sellerSku}</small>}</label>
      <label><span>상품군 힌트</span><input value={draft.categoryHint} onChange={(event) => onChange("categoryHint", event.target.value)} /></label>
      <label><span>브랜드</span><input value={draft.brandName} onChange={(event) => onChange("brandName", event.target.value)} /></label>
      <label><span>제조사·공급처</span><input value={draft.manufacturer} onChange={(event) => onChange("manufacturer", event.target.value)} /></label>
      <label><span>원산지</span><input value={draft.countryOfOrigin} onChange={(event) => onChange("countryOfOrigin", event.target.value)} /></label>
      <div className="intake-group-heading"><span>02</span><div><b>구성·표시 정보</b><small>실물과 표시사항 기준으로 수정합니다.</small></div></div>
      <label><span>소재·성분</span><input value={draft.material} onChange={(event) => onChange("material", event.target.value)} /></label>
      <label><span>판매 구성</span><select value={draft.packageContents} onChange={(event) => onChange("packageContents", event.target.value)}><option value="상품 1개">1개</option><option value="상품 1+1">1+1</option></select></label>
      <label><span>상품 상태</span><select value={draft.condition} onChange={(event) => onChange("condition", event.target.value as ProductIntakeDraft["condition"])}>{productConditions.map((value) => <option value={value} key={value}>{value === "NEW" ? "신품" : value === "USED" ? "중고" : "리퍼브"}</option>)}</select></label>
      <label><span>바코드 상태</span><select value={draft.gtinStatus} onChange={(event) => onChange("gtinStatus", event.target.value as ProductIntakeDraft["gtinStatus"])}><option value="NO_GTIN">GTIN 없음</option><option value="HAS_GTIN">GTIN 있음</option></select></label>
      {draft.gtinStatus === "HAS_GTIN" && <label className={errors.gtin ? "field-error" : ""}><span>GTIN / EAN / UPC</span><input inputMode="numeric" value={draft.gtin} onChange={(event) => onChange("gtin", event.target.value.replace(/\D/g, ""))} />{errors.gtin && <small>{errors.gtin}</small>}</label>}
      <div className="intake-group-heading"><span>03</span><div><b>가격·재고</b><small>중앙 원장과 게시 채널에 반영할 값입니다.</small></div></div>
      <label><span>판매가</span><input type="number" min="0.01" step="0.01" value={draft.sellingPrice} onChange={(event) => onChange("sellingPrice", Number(event.target.value))} /></label>
      <label><span>통화</span><select value={draft.currency} onChange={(event) => onChange("currency", event.target.value as ProductIntakeDraft["currency"])}>{productCurrencies.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span>실재고</span><input type="number" min="1" step="1" value={draft.stock} onChange={(event) => onChange("stock", Number(event.target.value))} /></label>
      <div className="intake-group-heading"><span>04</span><div><b>포장·배송</b><small>운임과 채널 제한 계산에 사용합니다.</small></div></div>
      <label><span>포장 중량 kg</span><input type="number" min="0.01" step="0.01" value={draft.weightKg} onChange={(event) => onChange("weightKg", Number(event.target.value))} /></label>
      <label><span>포장 가로 cm</span><input type="number" min="0.1" step="0.1" value={draft.packageLengthCm} onChange={(event) => onChange("packageLengthCm", Number(event.target.value))} /></label>
      <label><span>포장 세로 cm</span><input type="number" min="0.1" step="0.1" value={draft.packageWidthCm} onChange={(event) => onChange("packageWidthCm", Number(event.target.value))} /></label>
      <label><span>포장 높이 cm</span><input type="number" min="0.1" step="0.1" value={draft.packageHeightCm} onChange={(event) => onChange("packageHeightCm", Number(event.target.value))} /></label>
      <label><span>기본 배송비 KRW</span><input type="number" min="0" step="100" value={draft.shippingFeeKrw} onChange={(event) => onChange("shippingFeeKrw", Number(event.target.value))} /></label>
      <label><span>배송 규칙</span><input value={draft.shippingRule} onChange={(event) => onChange("shippingRule", event.target.value)} /></label>
      <label><span>포장 규칙</span><input value={draft.packagingRule} onChange={(event) => onChange("packagingRule", event.target.value)} /></label>
      <label><span>원본 상품 URL</span><input type="url" value={draft.productUrl} onChange={(event) => onChange("productUrl", event.target.value)} /></label>
      <label className="product-edit-description"><span>상품 사실 설명</span><textarea value={draft.description} maxLength={4000} onChange={(event) => onChange("description", event.target.value)} />{errors.description && <small>{errors.description}</small>}</label>
    </div>
    <div className="intake-confirmations"><label><input aria-label="이미지·상품 자료 사용 권한 확인" type="checkbox" checked={draft.imageRightsConfirmed} onChange={(event) => onChange("imageRightsConfirmed", event.target.checked)} /><span><b>이미지·상품 자료 사용 권한</b><small>사용 권한이 있는 자료임을 확인합니다.</small></span></label><label><input aria-label="상품 사실정보 확인" type="checkbox" checked={draft.productFactsConfirmed} onChange={(event) => onChange("productFactsConfirmed", event.target.checked)} /><span><b>상품 사실정보 확인</b><small>수정값이 실물과 일치함을 확인합니다.</small></span></label></div>
    {errors.form && <p className="inventory-editor-message">{errors.form}</p>}
    <footer><button type="button" className="credential-secondary" onClick={onClose} disabled={saving}>취소</button><button type="button" className="publish-execute" onClick={onSave} disabled={saving}>{saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{saving ? "전체 정보 저장 중" : "전체 정보 저장"}</button></footer>
  </section></div>;
}

function ProductDetailPage({ product, onBack, authenticatedFetch, notify, onChanged }: {
  product: DisplayProduct;
  onBack: () => void;
  authenticatedFetch: (input: string, init?: RequestInit) => Promise<Response>;
  notify: (message: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [remoteListings, setRemoteListings] = useState<RemoteListingReference[]>([]);
  const [detailContext, setDetailContext] = useState<ProductDetailContext>(emptyProductDetailContext);
  const [remoteListingState, setRemoteListingState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [inventoryEditing, setInventoryEditing] = useState(false);
  const [inventoryOnHand, setInventoryOnHand] = useState(product.onHand);
  const [inventorySaving, setInventorySaving] = useState(false);
  const [inventorySync, setInventorySync] = useState<InventorySyncContext | null>(null);
  const [inventoryMessage, setInventoryMessage] = useState("");
  const [commerceOperations, setCommerceOperations] = useState<ProductCommerceOperations>(emptyProductCommerceOperations);
  const [commerceNotesEditing, setCommerceNotesEditing] = useState(false);
  const [commerceNotesSaving, setCommerceNotesSaving] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [comparisonMemo, setComparisonMemo] = useState("");
  const [competitorQuery, setCompetitorQuery] = useState("");
  const [competitorMonitorEnabled, setCompetitorMonitorEnabled] = useState(true);
  const [regeneratingDetailAsset, setRegeneratingDetailAsset] = useState("");
  const [editDraft, setEditDraft] = useState<ProductIntakeDraft | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [displayOverrides, setDisplayOverrides] = useState({ name: product.name, sku: product.sku, description: product.description, sourceUrl: product.sourceUrl });

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
        const nextCommerceOperations = isRecord(payload.commerceOperations)
          ? payload.commerceOperations as unknown as ProductCommerceOperations
          : emptyProductCommerceOperations;
        if (!cancelled) {
          setRemoteListings(listings);
          setDetailContext({
            manualFields: isRecord(payload.manualFields) ? payload.manualFields : {},
            sourceImages: parseAssets(payload.sourceImages),
            generatedImages: parseAssets(payload.generatedImages),
            localizedListings,
          });
          setEditDraft(productEditDraft(product, isRecord(payload.manualFields) ? payload.manualFields : {}));
          setCommerceOperations({ ...emptyProductCommerceOperations, ...nextCommerceOperations, listings: Array.isArray(nextCommerceOperations.listings) ? nextCommerceOperations.listings : [], competitorPrices: Array.isArray(nextCommerceOperations.competitorPrices) ? nextCommerceOperations.competitorPrices : [] });
          setSupplierName(nextCommerceOperations.supplierName ?? "");
          setComparisonMemo(nextCommerceOperations.comparisonMemo ?? "");
          setCompetitorQuery(nextCommerceOperations.competitorQuery ?? product.name);
          setCompetitorMonitorEnabled(nextCommerceOperations.competitorMonitorEnabled !== false);
          setRemoteListingState("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteListings([]);
          setDetailContext(emptyProductDetailContext);
          setCommerceOperations(emptyProductCommerceOperations);
          setRemoteListingState("unavailable");
        }
      });
    return () => { cancelled = true; };
  }, [authenticatedFetch, product]);

  const setEditField = <Key extends keyof ProductIntakeDraft>(key: Key, value: ProductIntakeDraft[Key]) => {
    setEditDraft((current) => current ? { ...current, [key]: value } : current);
    setEditErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const saveProductDetails = async () => {
    if (!editDraft || editSaving) return;
    const parsed = productIntakeSchema.safeParse(editDraft);
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) nextErrors[String(issue.path[0] ?? "form")] ??= issue.message;
      nextErrors.form = parsed.error.issues[0]?.message ?? "상품 수정값을 확인해 주세요.";
      setEditErrors(nextErrors);
      notify(nextErrors.form);
      return;
    }
    setEditSaving(true);
    setEditErrors({});
    try {
      const response = await authenticatedFetch(`/api/admin/products/${product.sourceId}/publish-context`, { method: "PATCH", body: JSON.stringify(parsed.data) });
      const payload = await response.json().catch(() => ({ message: "상품 수정 응답을 읽지 못했습니다." })) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "상품 전체 정보를 저장하지 못했습니다.");
      if (parsed.data.stock !== product.onHand) {
        const inventoryResponse = await authenticatedFetch(`/api/admin/products/${product.sourceId}/inventory`, { method: "POST", body: JSON.stringify({ onHand: parsed.data.stock, confirmWrite: true }) });
        const inventoryPayload = await inventoryResponse.json().catch(() => ({ message: "재고 적용 응답을 읽지 못했습니다." })) as { message?: string; sync?: InventorySyncContext };
        if (!inventoryResponse.ok && inventoryResponse.status !== 207) throw new Error(inventoryPayload.message ?? "상품 정보는 저장됐지만 채널 재고 적용에 실패했습니다.");
        setInventoryOnHand(parsed.data.stock);
        setInventorySync(inventoryPayload.sync ?? null);
      }
      setDetailContext((current) => ({ ...current, manualFields: parsed.data }));
      setDisplayOverrides({ name: parsed.data.productName, sku: parsed.data.sellerSku, description: parsed.data.description, sourceUrl: parsed.data.productUrl || null });
      setEditDraft(parsed.data);
      setEditOpen(false);
      notify("상품의 전체 등록정보와 변경된 재고를 저장했습니다.");
      await onChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "상품 전체 정보를 저장하지 못했습니다.";
      setEditErrors({ form: message });
      notify(message);
    } finally {
      setEditSaving(false);
    }
  };

  useEffect(() => {
    if (!inventorySaving) return;
    const poll = window.setInterval(() => {
      void authenticatedFetch(`/api/admin/products/${product.sourceId}/inventory`).then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json() as { sync?: InventorySyncContext | null };
        if (payload.sync) setInventorySync(payload.sync);
      }).catch(() => null);
    }, 1_000);
    return () => window.clearInterval(poll);
  }, [authenticatedFetch, inventorySaving, product.sourceId]);

  const saveCommerceNotes = async () => {
    if (commerceNotesSaving) return;
    setCommerceNotesSaving(true);
    try {
      const response = await authenticatedFetch(`/api/admin/products/${product.sourceId}/publish-context`, { method: "POST", body: JSON.stringify({ supplierName, comparisonMemo, competitorQuery, competitorMonitorEnabled }) });
      const payload = await response.json().catch(() => ({ message: "상품 운영 메모 응답을 읽지 못했습니다." })) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "상품 운영 메모를 저장하지 못했습니다.");
      setCommerceOperations((current) => ({ ...current, supplierName, comparisonMemo, competitorQuery, competitorMonitorEnabled }));
      setCommerceNotesEditing(false);
    } catch (error) {
      setInventoryMessage(error instanceof Error ? error.message : "상품 운영 메모를 저장하지 못했습니다.");
    } finally {
      setCommerceNotesSaving(false);
    }
  };

  const regenerateDetailAsset = async (assetId: string) => {
    if (!commerceOperations.aiJobId || regeneratingDetailAsset) return;
    setRegeneratingDetailAsset(assetId);
    setInventoryMessage("");
    try {
      const jobId = crypto.randomUUID();
      const response = await authenticatedFetch("/api/ai/product-studio/regenerate", {
        method: "POST",
        body: JSON.stringify({ jobId, sourceJobId: commerceOperations.aiJobId, sourceProductId: product.sourceId, assetId }),
      });
      const queued = await response.json().catch(() => ({ message: "재제작 작업 응답을 읽지 못했습니다." })) as { jobId?: string; message?: string };
      if (!response.ok || !queued.jobId) throw new Error(queued.message ?? "이미지 재제작 작업을 등록하지 못했습니다.");
      for (let attempt = 0; attempt < 600; attempt += 1) {
        const statusResponse = await authenticatedFetch(`/api/ai/jobs/${queued.jobId}`);
        const statusPayload = await statusResponse.json().catch(() => ({ message: "재제작 상태를 읽지 못했습니다." })) as {
          status?: string; error?: string | null; message?: string;
          result?: { mode?: string; assetId?: string; generatedImages?: Array<{ id: string; url: string | null }> } | null;
        };
        if (!statusResponse.ok) throw new Error(statusPayload.message ?? "재제작 상태를 확인하지 못했습니다.");
        if (statusPayload.status === "succeeded" && statusPayload.result?.mode === "asset-regeneration") {
          const nextUrl = statusPayload.result.generatedImages?.find((asset) => asset.id === assetId)?.url ?? null;
          if (!nextUrl) throw new Error("재제작된 이미지 주소를 확인하지 못했습니다.");
          setDetailContext((current) => ({ ...current, generatedImages: current.generatedImages.map((asset) => asset.id === assetId ? { ...asset, url: nextUrl } : asset) }));
          setInventoryMessage(`${assetId.replaceAll("-", " ")} 이미지 1장만 교체했습니다.`);
          return;
        }
        if (statusPayload.status === "failed" || statusPayload.status === "cancelled") throw new Error(statusPayload.error || "이미지 재제작이 완료되지 못했습니다.");
        await new Promise((resolve) => window.setTimeout(resolve, 3_000));
      }
      throw new Error("이미지 재제작 대기시간이 30분을 초과했습니다.");
    } catch (error) {
      setInventoryMessage(error instanceof Error ? error.message : "이미지 재제작 중 오류가 발생했습니다.");
    } finally {
      setRegeneratingDetailAsset("");
    }
  };

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
        <div><span><Clock3 size={14} />최근 수정 {formatProductUpdatedAt(product.updatedAt)}</span><button type="button" className="publish-execute" onClick={() => { setEditErrors({}); setEditDraft((current) => current ?? productEditDraft(product, detailContext.manualFields)); setEditOpen(true); }}><PencilRuler size={15} />상품 전체 수정</button></div>
      </div>

      <section className="panel product-detail-hero">
        <div className="product-detail-image"><ProductVisual src={product.image} size="(max-width: 760px) 100vw, 420px" alt={product.name} /></div>
        <div className="product-detail-heading">
          <div><StatusBadge status={product.status} /><span className="product-detail-code">{product.id}</span></div>
          <h2>{displayOverrides.name}</h2>
          <p>{displayOverrides.description || "등록된 상품 설명이 없습니다."}</p>
          <dl className="product-detail-identifiers">
            <div><dt>SKU</dt><dd>{displayOverrides.sku}</dd></div>
            <div><dt>상품 원장 ID</dt><dd>{product.sourceId}</dd></div>
          </dl>
        </div>
      </section>

      <section className="product-detail-metrics">
        <article className="panel"><span className="metric-icon blue"><Box size={17} /></span><div><small>실재고</small><strong>{inventoryOnHand.toLocaleString()}개</strong><em>예약 {product.reserved.toLocaleString()}개 · 판매 가능 {Math.max(0, inventoryOnHand - product.reserved).toLocaleString()}개</em></div></article>
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
        {inventorySync?.tasks?.length ? <div className="inventory-channel-progress">{inventorySync.tasks.map((task) => <div className={task.status} key={task.id}><ChannelMark code={channels[task.channel as ChannelKey]?.letter ?? task.channel} size="sm" /><span><b>{channelNameByKey[task.channel] ?? task.channel}</b><small>{task.safeMessage || (task.status === "succeeded" ? "원격 재고 확인 완료" : task.status === "failed" ? "원격 적용 확인 필요" : "원격 채널 적용 중")}</small></span>{task.status === "succeeded" ? <CheckCircle2 size={16} /> : task.status === "failed" ? <AlertCircle size={16} /> : <LoaderCircle className="spin" size={16} />}</div>)}</div> : null}
        {inventoryMessage ? <p className="inventory-editor-message">{inventoryMessage}</p> : null}
      </section>

      <section className="panel product-commerce-notes">
        <div className="panel-heading"><div><span className="panel-kicker">SUPPLIER · COMPARISON</span><h3>공급처 · 비교 메모</h3></div>{commerceNotesEditing ? <div><button type="button" className="credential-secondary" onClick={() => setCommerceNotesEditing(false)} disabled={commerceNotesSaving}>취소</button><button type="button" className="publish-execute" onClick={() => void saveCommerceNotes()} disabled={commerceNotesSaving}>{commerceNotesSaving ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}저장</button></div> : <button type="button" className="ghost-button" onClick={() => setCommerceNotesEditing(true)}>수정</button>}</div>
        <div className="product-commerce-notes-grid"><label><span>공급처</span>{commerceNotesEditing ? <input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} maxLength={240} placeholder="공급처명 또는 공급 링크 설명" /> : <strong>{commerceOperations.supplierName || "미입력"}</strong>}</label><label><span>비교 · 운영 메모</span>{commerceNotesEditing ? <textarea value={comparisonMemo} onChange={(event) => setComparisonMemo(event.target.value)} maxLength={4000} placeholder="가격, 구성, 공급 조건 비교 메모" /> : <p>{commerceOperations.comparisonMemo || "미입력"}</p>}</label></div>
      </section>

      <section className="panel competitor-price-panel">
        <div className="panel-heading"><div><span className="panel-kicker">30분 자동 조회 · 채널별 최대 3개</span><h3>동일 상품 가격 비교</h3></div><span className={`live-label ${competitorMonitorEnabled ? "" : "paused"}`}><i />{competitorMonitorEnabled ? "자동 조회" : "조회 중지"}</span></div>
        <div className="competitor-query-row"><label><span>검색어</span><input value={competitorQuery} disabled={!commerceNotesEditing} onChange={(event) => setCompetitorQuery(event.target.value)} placeholder={product.name} /></label><label className="monitor-toggle"><input type="checkbox" checked={competitorMonitorEnabled} disabled={!commerceNotesEditing} onChange={(event) => setCompetitorMonitorEnabled(event.target.checked)} /><span>상품 판매 중 30분마다 조회</span></label><small>최근 조회 {commerceOperations.competitorCheckedAt ? relativeTime(commerceOperations.competitorCheckedAt) : "대기"}</small></div>
        <CompetitorPriceSlots items={commerceOperations.competitorPrices} state="ready" />
      </section>

      <section className="product-detail-grid">
        <article className="panel product-detail-section">
          <div className="panel-heading"><div><span className="panel-kicker">REGISTERED CONTENT</span><h3>등록한 상품 정보</h3></div><PackageCheck size={18} /></div>
          <div className="product-detail-description"><h4>상품 설명</h4><p>{displayOverrides.description || "상품 설명이 아직 등록되지 않았습니다."}</p></div>
          <dl className="product-detail-ledger">
            <div><dt>상품명</dt><dd>{displayOverrides.name}</dd></div>
            <div><dt>상품 코드</dt><dd>{product.id}</dd></div>
            <div><dt>SKU</dt><dd>{displayOverrides.sku}</dd></div>
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
            const liveListing = commerceOperations.listings.find((item) => item.channel === channelKey && (!listing?.market || item.market === listing.market)) ?? commerceOperations.listings.find((item) => item.channel === channelKey);
            const destination = marketplaceListingUrl(listingReference);
            const stateCopy = remoteListingState === "loading"
              ? "원격 상품번호 확인 중"
              : listing?.remoteId
                ? `${listing.status === "published" ? "등록 완료" : listing.status ?? "상품 연결"} · 원격 ID ${listing.remoteId}`
                : remoteListingState === "unavailable" ? "연결 정보 조회 실패" : listing?.status ? `${listing.status} · 판매 상품 주소 확인 필요` : "게시 이력 없음";
            return <div key={channelKey}><ChannelMark code={code} /><span><b>{channel.name}{liveListing?.market ? ` · ${liveListing.market}` : ""}</b><small>{stateCopy}</small><small className="channel-live-facts">재고 {liveListing?.inventoryQuantity ?? "—"} · 30일 판매 {liveListing?.sold30d ?? 0} · 카테고리 {liveListing?.categoryId ?? "확인 필요"}</small>{liveListing?.categoryPath?.length ? <small>{liveListing.categoryPath.join(" › ")}</small> : null}{listing?.lastError || liveListing?.inventoryError ? <em>{listing?.lastError ?? liveListing?.inventoryError}</em> : null}</span>{destination ? <a className="product-channel-link" href={destination} target="_blank" rel="noreferrer">{marketplaceListingLinkLabel(listingReference)}<ExternalLink size={13} /></a> : <span className="product-channel-unavailable">판매 상품 주소 확인 필요</span>}</div>;
          })}</div> : remoteListingState === "loading" ? <div className="product-detail-empty"><LoaderCircle className="spin" size={24} /><b>상품 채널 연결을 확인하고 있습니다.</b><small>등록 시도·게시 완료·실패 이력을 함께 불러옵니다.</small></div> : <div className="product-detail-empty"><Store size={24} /><b>연결된 판매 채널이 없습니다.</b><small>현재 상품 정보만 등록되어 있으며 채널 게시 전 상태입니다.</small></div>}
        </article>
      </section>

      <section className="panel product-detail-assets">
        <div className="panel-heading"><div><span className="panel-kicker">GENERATED DETAIL PAGE</span><h3>등록 이미지 · 상세페이지 디자인</h3></div><ImagePlus size={18} /></div>
        {remoteListingState === "loading" ? <div className="product-detail-empty compact"><LoaderCircle className="spin" size={22} /><b>상세페이지 결과를 불러오는 중입니다.</b></div> : detailAssets.length > 0 ? <div className="product-detail-asset-grid">{detailAssets.map((asset, index) => <figure key={`${asset.id ?? asset.path}-${index}`}><div><ProductVisual src={asset.url} size="(max-width: 760px) 88vw, 280px" alt={`${product.name} ${asset.id ?? `상품 이미지 ${index + 1}`}`} /></div><figcaption><span>{asset.id?.replaceAll("-", " ") ?? `원본 이미지 ${index + 1}`}</span>{asset.id && commerceOperations.aiJobId ? <button type="button" onClick={() => void regenerateDetailAsset(asset.id!)} disabled={Boolean(regeneratingDetailAsset)}>{regeneratingDetailAsset === asset.id ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}이 이미지만 재제작</button> : null}</figcaption></figure>)}</div> : <div className="product-detail-empty compact"><ImagePlus size={24} /><b>저장된 상세 이미지가 없습니다.</b><small>기존 텍스트 상품이거나 이미지 생성 결과가 상품 원장에 연결되지 않은 상태입니다.</small></div>}
      </section>

      {editOpen && editDraft && <ProductDetailEditDialog draft={editDraft} errors={editErrors} saving={editSaving} onChange={setEditField} onClose={() => { if (!editSaving) setEditOpen(false); }} onSave={() => void saveProductDetails()} />}

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

function ExternalActionsPage({ actions, onEdit, onConnections }: {
  actions: OperationsSnapshot["externalActions"];
  onEdit: (action: OperationsSnapshot["externalActions"][number]) => void;
  onConnections: () => void;
}) {
  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, Math.max(0, actions.length - 1));
  const selected = actions[safeIndex] ?? null;
  const selectedChannel = selected ? channels[selected.channel as ChannelKey] : null;
  const guidance = selected?.message.match(/permission|authority|권한/i)
    ? "판매자센터에서 해당 카테고리 판매 권한·브랜드 승인을 완료한 뒤 다시 등록하세요."
    : selected?.message.match(/certificate|certification|인증/i)
      ? "상품 인증정보와 증빙 파일을 판매자센터 기준에 맞게 보완하세요."
      : "필수 속성·카테고리·현지어 문안을 상품수정 화면에서 확인하세요.";
  return <div className="page-stack remediation-page">
    <section className="panel remediation-summary"><div><span className="metric-icon orange"><ShieldCheck size={18} /></span><span><small>외부 조치 대기</small><strong>{actions.length.toLocaleString()}건</strong><em>재시도에서 제외된 안전 대기 목록</em></span></div><p>실패 상품 전체가 아니라 판매자센터 권한·인증·필수 상품수정이 필요한 항목만 표시합니다. 한 건을 수정한 뒤 다음 건으로 이동하세요.</p></section>
    {selected ? <section className="panel remediation-workspace">
      <header><div><span className="panel-kicker">ACTION {safeIndex + 1} / {actions.length}</span><h3>{selected.productName}</h3><p>{selected.productCode} · {selected.sku}</p></div><div className="remediation-pager"><button type="button" aria-label="이전 항목" disabled={safeIndex === 0} onClick={() => setIndex((current) => Math.max(0, Math.min(current, actions.length - 1) - 1))}><ArrowLeft size={15} />이전</button><button type="button" aria-label="다음 항목" disabled={safeIndex >= actions.length - 1} onClick={() => setIndex((current) => Math.min(actions.length - 1, current + 1))}>다음<ArrowRight size={15} /></button></div></header>
      <div className="remediation-body"><aside><ChannelMark code={selected.channelCode} /><span><b>{selectedChannel?.name ?? selected.channelName}</b><small>{selected.market || "기본 마켓"} · {selected.targetId}</small></span></aside><article><span>판매채널 응답</span><p>{selected.message}</p><div><ShieldCheck size={17} /><span><b>처리 안내</b><small>{guidance}</small></span></div><dl><div><dt>카테고리</dt><dd>{selected.categoryPath?.join(" › ") || selected.categoryId || "다시 선택 필요"}</dd></div><div><dt>최근 확인</dt><dd>{relativeTime(selected.updatedAt)}</dd></div></dl></article></div>
      <footer><button type="button" className="credential-secondary" onClick={onConnections}><KeyRound size={15} />채널 권한 설정</button><button type="button" className="publish-execute" onClick={() => onEdit(selected)}><PencilRuler size={15} />이 상품 수정 시작</button></footer>
    </section> : <section className="panel remediation-empty"><CheckCircle2 size={32} /><h3>외부 조치 대기 상품이 없습니다.</h3><p>권한·인증·필수 상품수정 대기 목록을 모두 처리했습니다.</p></section>}
  </div>;
}

const registrationStatusMeta: Record<OperationsSnapshot["registrationActivities"][number]["status"], { label: string; detail: string }> = {
  analyzing: { label: "AI 분석 중", detail: "사진과 상품 사실정보를 분석하고 있습니다." },
  ready: { label: "채널 등록 준비", detail: "분석이 끝나 카테고리·채널 확인을 기다립니다." },
  publishing: { label: "채널 등록 중", detail: "선택한 채널에 상품을 동시에 전송하고 있습니다." },
  completed: { label: "등록 완료", detail: "선택 채널의 등록 처리가 완료되었습니다." },
  failed: { label: "재시도 필요", detail: "채널 응답을 확인한 뒤 다시 실행할 수 있습니다." },
  blocked: { label: "외부 권한 대기", detail: "판매자센터 권한 또는 필수 보완이 필요합니다." },
};

function formatRegistrationDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  if (safeSeconds < 60) return `${safeSeconds}초`;
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  if (minutes < 60) return `${minutes}분 ${remainingSeconds}초`;
  const hours = Math.floor(minutes / 60);
  return `${hours}시간 ${minutes % 60}분`;
}

function RegistrationActivityPage({ activities, displayProducts, loading, onRefresh, onOpenProduct, onNewProduct, onExternalActions }: {
  activities: OperationsSnapshot["registrationActivities"];
  displayProducts: DisplayProduct[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onOpenProduct: (product: DisplayProduct) => void;
  onNewProduct: () => void;
  onExternalActions: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "active" | "completed" | "attention">("all");
  const [refreshing, setRefreshing] = useState(false);
  const productMap = useMemo(() => new Map(displayProducts.map((product) => [product.sourceId, product])), [displayProducts]);
  const filtered = activities.filter((activity) => filter === "all"
    || (filter === "active" && ["analyzing", "ready", "publishing"].includes(activity.status))
    || (filter === "completed" && activity.status === "completed")
    || (filter === "attention" && ["failed", "blocked"].includes(activity.status)));
  const counts = {
    active: activities.filter((item) => ["analyzing", "ready", "publishing"].includes(item.status)).length,
    completed: activities.filter((item) => item.status === "completed").length,
    attention: activities.filter((item) => ["failed", "blocked"].includes(item.status)).length,
  };

  useEffect(() => {
    const interval = window.setInterval(() => void onRefresh(), 10_000);
    return () => window.clearInterval(interval);
  }, [onRefresh]);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  return <div className="page-stack registration-activity-page">
    <section className="registration-activity-hero">
      <div><span className="eyebrow dark"><Activity size={14} /> LIVE REGISTRATION LEDGER</span><h2>여러 상품의 등록을 동시에 확인하세요.</h2><p>AI 분석 시작부터 채널별 완료·거절까지 운영 원장 기준의 상태와 실제 경과 시간을 표시합니다.</p></div>
      <span><button type="button" className="credential-secondary" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}새로고침</button><button type="button" className="primary-button" onClick={onNewProduct}><Plus size={15} />다른 상품 등록</button></span>
    </section>
    <section className="registration-filter-strip" aria-label="등록 상태 필터">
      {([
        ["all", "전체", activities.length],
        ["active", "현재 등록 중", counts.active],
        ["completed", "완료", counts.completed],
        ["attention", "거절 · 확인 필요", counts.attention],
      ] as const).map(([value, label, count]) => <button type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}><span>{label}</span><b>{count}</b></button>)}
    </section>
    {loading && activities.length === 0 ? <section className="panel registration-empty"><LoaderCircle className="spin" size={28} /><b>등록 이력을 불러오는 중입니다.</b></section>
      : filtered.length > 0 ? <section className="registration-card-grid">{filtered.map((activity) => {
        const status = registrationStatusMeta[activity.status];
        const product = activity.productId ? productMap.get(activity.productId) : undefined;
        const isActive = ["analyzing", "ready", "publishing"].includes(activity.status);
        return <article className={`panel registration-card ${activity.status}`} key={activity.id}>
          <header><span className={`registration-status ${activity.status}`}>{isActive ? <LoaderCircle className="spin" size={14} /> : activity.status === "completed" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{status.label}</span><small>{relativeTime(activity.updatedAt)}</small></header>
          <div className="registration-product"><div>{product ? <ProductVisual src={product.image} size="96px" alt={activity.productName} /> : <Package size={25} />}</div><span><h3>{activity.productName}</h3><p>{activity.sku || activity.productCode || "상품 코드 생성 중"}</p></span></div>
          <div className="registration-progress"><span><i style={{ width: `${activity.channelCount > 0 ? Math.round(((activity.publishedCount + activity.failedCount + activity.blockedCount) / activity.channelCount) * 100) : activity.status === "completed" ? 100 : 18}%` }} /></span><small>{status.detail}</small></div>
          <dl><div><dt>시작</dt><dd>{new Date(activity.startedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</dd></div><div><dt>{activity.completedAt ? "총 등록시간" : "현재 경과시간"}</dt><dd>{formatRegistrationDuration(activity.elapsedSeconds)}</dd></div></dl>
          <div className="registration-channel-summary"><span>채널 {activity.channelCount}</span><b className="success">완료 {activity.publishedCount}</b><b className="danger">오류 {activity.failedCount}</b><b className="warning">권한 {activity.blockedCount}</b></div>
          {activity.channels.length > 0 && <div className="registration-channel-list">{activity.channels.slice(0, 8).map((channel) => <span className={channel.status} key={`${activity.id}-${channel.channel}-${channel.market}`} title={channel.message}><ChannelMark code={channel.channelCode} size="sm" /><i>{channel.status === "published" ? "완료" : channel.status === "failed" ? "오류" : channel.status === "blocked" ? "권한" : "진행"}</i></span>)}</div>}
          {activity.message && <p className="registration-message">{activity.message}</p>}
          <footer>{activity.status === "blocked" && <button type="button" className="credential-secondary" onClick={onExternalActions}>외부 조치 확인</button>}{product ? <button type="button" className="ghost-button" onClick={() => onOpenProduct(product)}>상품 상세<ChevronRight size={14} /></button> : <span />}</footer>
        </article>;
      })}</section> : <section className="panel registration-empty"><PackageCheck size={30} /><b>선택한 상태의 상품이 없습니다.</b><small>새 상품 등록을 시작하면 상품 한 개당 카드 한 개로 표시됩니다.</small><button type="button" className="primary-button" onClick={onNewProduct}><Plus size={15} />첫 상품 등록</button></section>}
  </div>;
}

function PublishingPage({ notify, channelMetrics, pipeline, authenticatedFetch, initialProduct, onStartAnother, onShowHistory }: { notify: (message: string) => void; channelMetrics: OperationsSnapshot["channelMetrics"]; pipeline: OperationsSnapshot["pipeline"] | null; authenticatedFetch: (input: string, init?: RequestInit) => Promise<Response>; initialProduct?: { id: string; name: string } | null; onStartAnother: () => void; onShowHistory: () => void }) {
  const [running, setRunning] = useState(false);
  const [mainPhoto, setMainPhoto] = useState<UploadedPhoto | null>(null);
  const [slotPhotos, setSlotPhotos] = useState<Record<string, UploadedPhoto>>({});
  const [extraPhotos, setExtraPhotos] = useState<UploadedPhoto[]>([]);
  const [intake, setIntake] = useState<ProductIntakeDraft>(() => ({ ...emptyProductIntake }));
  const [manualErrors, setManualErrors] = useState<Record<string, string>>({});
  const [uploadError, setUploadError] = useState("");
  const [researchingProduct, setResearchingProduct] = useState(false);
  const [researchResult, setResearchResult] = useState<ProductResearchResult | null>(null);
  const [researchCompetitors, setResearchCompetitors] = useState<Array<{ id: string; marketplace: string; title: string; url: string; imageUrl: string | null; mallName: string; price: number; currency: string }>>([]);
  const [competitorResearchState, setCompetitorResearchState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [firstDraftGenerated, setFirstDraftGenerated] = useState(false);
  const [queuedJobId, setQueuedJobId] = useState("");
  const [studioRequestId, setStudioRequestId] = useState(0);
  const [analyzedProductName, setAnalyzedProductName] = useState(initialProduct?.name ?? "");
  const [analyzedProductId, setAnalyzedProductId] = useState<string | null>(initialProduct?.id ?? null);
  const resolvedProductId = analyzedProductId ?? initialProduct?.id ?? null;
  const [categoryDraftRef] = useState(() => crypto.randomUUID());
  const [publishRefreshVersion, setPublishRefreshVersion] = useState(0);
  const [channelSelection, setChannelSelection] = useState<Record<string, boolean>>({});
  const [commerceTemplates, setCommerceTemplates] = useState<CommerceTemplate[]>([]);
  const [appliedTemplate, setAppliedTemplate] = useState("");
  const connectedChannelKeys = useMemo(() => channelMetrics
    .filter((metric) => metric.credentialStatus === "active" && activeChannelKeys.includes(metric.channelKey as (typeof activeChannelKeys)[number]))
    .map((metric) => metric.channelKey), [channelMetrics]);
  const selectedChannels = useMemo(() => connectedChannelKeys.filter((key) => channelSelection[key] !== false), [channelSelection, connectedChannelKeys]);

  const preservePublishingCaptureContext = useCallback(() => {
    const historyState = isRecord(window.history.state) ? window.history.state : {};
    const params = new URLSearchParams({ view: "publishing" });
    if (initialProduct?.id) params.set("productId", initialProduct.id);
    window.sessionStorage.setItem("sellerpilot:last-view:v1", "publishing");
    window.history.replaceState(
      { ...historyState, view: "publishing", ...(initialProduct?.id ? { productId: initialProduct.id } : {}) },
      "",
      `${window.location.pathname}?${params.toString()}`,
    );
  }, [initialProduct]);

  useEffect(() => {
    void authenticatedFetch("/api/admin/templates").then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json() as { templates?: CommerceTemplate[] };
      setCommerceTemplates(Array.isArray(payload.templates) ? payload.templates : []);
    }).catch(() => null);
  }, [authenticatedFetch]);

  const applyCommerceTemplate = (template: CommerceTemplate) => {
    const numeric = (key: string, fallback: number) => typeof template.values[key] === "number" ? Number(template.values[key]) : fallback;
    const string = (key: string, fallback: string) => typeof template.values[key] === "string" ? String(template.values[key]) : fallback;
    setIntake((current) => ({
      ...current,
      weightKg: numeric("weightKg", current.weightKg), packageLengthCm: numeric("packageLengthCm", current.packageLengthCm),
      packageWidthCm: numeric("packageWidthCm", current.packageWidthCm), packageHeightCm: numeric("packageHeightCm", current.packageHeightCm),
      shippingFeeKrw: numeric("shippingFeeKrw", current.shippingFeeKrw), shippingRule: string("shippingRule", current.shippingRule), packagingRule: string("packagingRule", current.packagingRule),
    }));
    setAppliedTemplate(template.name);
    notify(`‘${template.name}’ 배송·포장 템플릿을 입력란에 적용했습니다.`);
  };

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
    preservePublishingCaptureContext();
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
    let consecutiveFailures = 0;
    while (Date.now() < deadline) {
      let response: Response;
      try {
        response = await fetch(`/api/ai/jobs/${jobId}`, {
          headers: { authorization: `Bearer ${accessToken}` },
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });
        consecutiveFailures = 0;
      } catch {
        consecutiveFailures += 1;
        if (consecutiveFailures >= 5) throw new Error("모바일 네트워크에서 상품정보 상태를 5회 연속 확인하지 못했습니다. 등록 이력에서 서버 작업 상태를 확인해 주세요.");
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        continue;
      }
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
        sellerSku: current.sellerSku.trim() || `AUTO-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        categoryHint: current.categoryHint.trim() || suggestion.categoryHint || "",
        brandName: current.brandName.trim() || suggestion.brandName || "No Brand · 확인 필요",
        manufacturer: current.manufacturer.trim() || suggestion.manufacturer || "공급처 확인 필요",
        countryOfOrigin: current.countryOfOrigin.trim() || suggestion.countryOfOrigin || "원산지 확인 필요",
        material: current.material.trim() || suggestion.material || "소재 확인 필요",
        packageContents: current.packageContents.trim() || (/1\s*\+\s*1/.test(suggestion.packageContents ?? "") ? "상품 1+1" : "상품 1개"),
        description: current.description.trim() || suggestion.description || `${suggestion.productName || "상품"}의 1차 자동생성 설명입니다. 용도, 소재, 구성품, 규격과 주의사항을 실물 기준으로 확인 후 수정해 주세요.`,
        productUrl: current.productUrl.trim() || firstReadableSource,
        gtinStatus: current.gtin || !suggestion.gtin ? current.gtinStatus : "HAS_GTIN",
        gtin: current.gtin || suggestion.gtin || "",
        sellingPrice: current.sellingPrice > 0 ? current.sellingPrice : 5000,
        stock: current.stock > 0 ? current.stock : 1,
        weightKg: current.weightKg > 0 ? current.weightKg : 0.5,
        packageLengthCm: current.packageLengthCm > 0 ? current.packageLengthCm : 20,
        packageWidthCm: current.packageWidthCm > 0 ? current.packageWidthCm : 20,
        packageHeightCm: current.packageHeightCm > 0 ? current.packageHeightCm : 10,
        shippingFeeKrw: current.shippingFeeKrw,
        shippingRule: current.shippingRule || "기본 배송 · 채널 정책 확인 필요",
        packagingRule: current.packagingRule || "상품 파손 방지 포장 · 확인 필요",
      }));
      setResearchResult(result);
      setCompetitorResearchState("loading");
      const competitorQuery = suggestion.productName || intake.productName || researchInput;
      void authenticatedFetch(`/api/admin/competitor-prices?query=${encodeURIComponent(competitorQuery.slice(0, 500))}`)
        .then(async (competitorResponse) => {
          const competitorPayload = await competitorResponse.json().catch(() => ({})) as { items?: typeof researchCompetitors };
          if (!competitorResponse.ok) throw new Error("비교 상품을 조회하지 못했습니다.");
          setResearchCompetitors(Array.isArray(competitorPayload.items) ? competitorPayload.items : []);
          setCompetitorResearchState("ready");
        })
        .catch(() => { setResearchCompetitors([]); setCompetitorResearchState("unavailable"); });
      setFirstDraftGenerated(true);
      setManualErrors({});
      notify("1차 자동생성 초안을 만들었습니다. ‘확인 필요’ 값과 가격·재고·포장 규격을 검토한 뒤 사실 확인 체크를 완료해 주세요.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "CLI 상품정보 수집 중 오류가 발생했습니다.";
      setUploadError(message);
      notify(message);
    } finally {
      setResearchingProduct(false);
    }
  };

  const selectSlotPhoto = async (slotId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    preservePublishingCaptureContext();
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
    preservePublishingCaptureContext();
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
        <div className="publishing-workflow-copy"><span className="eyebrow dark"><Sparkles size={14} /> 상품 등록 워크플로</span><h2>링크나 설명으로 1차 초안을 자동생성하세요.</h2><p>AI 초안을 사람이 사실 기준으로 확인·수정한 뒤 ‘상품 분석 시작’을 누르면 이미지 제작, 번역, 카테고리 검증과 업로드 준비가 이어집니다.</p></div>
        <ol className="publishing-steps" aria-label="상품 등록 단계">
          <li className="active"><span>1</span><b>1차 자동생성</b><small>{intakeProgress}% 완료</small></li>
          <li><span>2</span><b>사람 확인 · 최종 분석</b><small>이미지·사실 검증</small></li>
          <li><span>3</span><b>번역 · 채널 업로드</b><small>{selectedChannels.length}개 채널 선택</small></li>
        </ol>
      </section>
      {queuedJobId && <section className="panel publishing-parallel-banner"><span><CheckCircle2 size={20} /><span><b>이 상품을 등록 큐에 넣었습니다.</b><small>작업 ID {queuedJobId.slice(0, 8)} · 서버에서 계속 처리되므로 다른 상품을 바로 올릴 수 있습니다.</small></span></span><div><button type="button" className="credential-secondary" onClick={onShowHistory}>진행상황 보기</button><button type="button" className="primary-button" onClick={onStartAnother}><Plus size={15} />다른 상품 등록</button></div></section>}
      <section className="publishing-layout">
        <article className="panel upload-panel">
          <div className="panel-heading"><div><span className="panel-kicker">NEW PRODUCT</span><h3>새 상품 분석 자료</h3></div><span className="step-chip">STEP 1 / 3</span></div>

          <section className="main-photo-section">
            <div className="upload-section-heading"><div><b>대표사진</b><span className="required-chip">필수</span><small>검색 결과와 채널 목록에서 가장 먼저 보이는 이미지입니다.</small></div><em>{mainPhoto ? "1장 등록됨" : "미등록"}</em></div>
            <input id="main-product-photo-camera" className="visually-hidden" type="file" accept="image/*" capture="environment" onClick={preservePublishingCaptureContext} onChange={selectMainPhoto} />
            <label className={`drop-zone main-drop-zone ${mainPhoto ? "has-photo" : ""} ${running ? "running" : ""}`} htmlFor="main-product-photo">
              <input id="main-product-photo" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectMainPhoto} />
              {mainPhoto ? <><span className="main-photo-preview"><Image src={mainPhoto.url} alt="등록한 대표 상품 사진" fill sizes="700px" unoptimized /></span><span className="photo-preview-overlay"><ImagePlus size={17} />대표사진 교체</span><strong className="photo-file-name">{mainPhoto.name} · {mainPhoto.originalWidth}×{mainPhoto.originalHeight} → 1200×1200</strong></> : <><span className="upload-graphic"><CloudUpload size={31} /></span><strong>대표 상품 사진을 넣으세요</strong><p>JPG, PNG, WEBP · 최소 600×600px · 자동 1:1 여백 보정</p><em><ImagePlus size={15} />대표사진 선택</em></>}
              {running && <span className="analysis-overlay"><LoaderCircle className="spin" size={29} /><b>사진·설명·링크 통합 분석 중</b><small>OCR과 상품 정보 교차검증을 진행하고 있습니다.</small><i><span /></i></span>}
            </label>
            <div className="photo-source-actions" aria-label="대표사진 입력 방식">
              <label htmlFor="main-product-photo-camera"><Camera size={18} /><span><b>사진 촬영</b><small>후면 카메라 바로 열기</small></span></label>
              <label htmlFor="main-product-photo"><ImagePlus size={18} /><span><b>앨범에서 선택</b><small>저장된 사진 첨부</small></span></label>
            </div>
            {uploadError && <p className="upload-error"><AlertCircle size={14} />{uploadError}</p>}
          </section>

          <section className="option-photo-section">
            <div className="upload-section-heading"><div><b>옵션 사진</b><span className="optional-chip">선택</span><small>각도와 표시사항이 많을수록 분석 정확도가 높아집니다.</small></div><em>{Object.keys(slotPhotos).length} / {optionalPhotoSlots.length}장</em></div>
            <div className="option-photo-grid">
              {optionalPhotoSlots.map((slot) => {
                const photo = slotPhotos[slot.id];
                return <div className={`option-slot-wrap ${photo ? "has-photo" : ""}`} key={slot.id}><input id={`option-photo-${slot.id}-camera`} className="visually-hidden" type="file" accept="image/*" capture="environment" onClick={preservePublishingCaptureContext} onChange={(event) => void selectSlotPhoto(slot.id, event)} /><label className="option-photo-slot" htmlFor={`option-photo-${slot.id}`}><input id={`option-photo-${slot.id}`} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void selectSlotPhoto(slot.id, event)} />{photo ? <><Image src={photo.url} alt={`${slot.label} 상품 사진`} fill sizes="180px" unoptimized /><span className="slot-photo-label"><b>{slot.label}</b><small>{photo.originalWidth}×{photo.originalHeight} · 교체</small></span></> : <><span><ImagePlus size={18} /></span><b>{slot.label}</b><small>{slot.guide}</small></>}</label><div className="photo-source-actions compact" aria-label={`${slot.label} 사진 입력 방식`}><label htmlFor={`option-photo-${slot.id}-camera`}><Camera size={14} /><span><b>촬영</b></span></label><label htmlFor={`option-photo-${slot.id}`}><ImagePlus size={14} /><span><b>앨범</b></span></label></div>{photo && <button type="button" className="remove-photo-button" aria-label={`${slot.label} 사진 삭제`} onClick={() => removeSlotPhoto(slot.id)}><Trash2 size={13} /></button>}</div>;
              })}
            </div>
          </section>

          <section className="extra-photo-section">
            <div className="upload-section-heading"><div><b>추가 사진</b><span className="optional-chip">여러 장</span><small>상세컷, 구성품, 포장 상태 등 필요한 만큼 한 번에 선택할 수 있습니다.</small></div><em>{extraPhotos.length}장 추가됨</em></div>
            <input id="extra-product-photo-camera" className="visually-hidden" type="file" accept="image/*" capture="environment" onClick={preservePublishingCaptureContext} onChange={(event) => void selectExtraPhotos(event)} />
            <label className="extra-photo-uploader" htmlFor="extra-product-photos"><input id="extra-product-photos" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void selectExtraPhotos(event)} /><Plus size={17} /><span><b>추가 사진 더 넣기</b><small>분석용 최대 100장 · 채널 등록은 앞 8~9장 자동 선별</small></span></label>
            <div className="photo-source-actions" aria-label="추가 사진 입력 방식">
              <label htmlFor="extra-product-photo-camera"><Camera size={18} /><span><b>사진 촬영</b><small>한 장씩 바로 추가</small></span></label>
              <label htmlFor="extra-product-photos"><ImagePlus size={18} /><span><b>앨범에서 선택</b><small>여러 장 한 번에 첨부</small></span></label>
            </div>
            {extraPhotos.length > 0 && <div className="extra-photo-list">{extraPhotos.map((photo, index) => <div key={`${photo.name}-${index}`}><span><Image src={photo.url} alt={`추가 상품 사진 ${index + 1}`} fill sizes="100px" unoptimized /></span><small>{index + 1}</small><button type="button" aria-label={`추가 사진 ${index + 1} 삭제`} onClick={() => removeExtraPhoto(index)}><X size={12} /></button></div>)}</div>}
          </section>

          <section className={`product-research-panel ${manualErrors.researchInput ? "field-error" : ""}`}>
            <div className="product-research-heading"><span><Bot size={17} /><b>상품 링크 또는 설명</b><em>1차 자동생성</em></span><small>판매페이지·제조사 링크, 모델명, 바코드, 카톡으로 받은 상품 설명을 그대로 넣으세요.</small></div>
            <div className="product-research-input"><Link2 size={17} /><textarea value={intake.researchInput} onChange={(event) => setIntakeField("researchInput", event.target.value)} maxLength={12_000} placeholder={"예: https://공급사.example/product/123\n또는 상품명, 모델명, 재질·구성 등 알고 있는 내용을 붙여넣으세요."} aria-label="상품 링크 또는 설명" /><button type="button" onClick={() => void researchProductInformation()} disabled={intake.researchInput.trim().length < 2 || researchingProduct || running}>{researchingProduct ? <LoaderCircle className="spin" size={15} /> : <WandSparkles size={15} />}{researchingProduct ? "1차 생성 중" : "1차 자동생성"}</button></div>
            <small className="product-research-help">공개 근거를 우선 사용하고, 동일 상품 가격은 채널별 최대 3개를 함께 조회해 판매가 검토에 사용합니다.</small>
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
            {competitorResearchState !== "idle" && <CompetitorPriceSlots items={researchCompetitors} state={competitorResearchState} compact />}
          </section>
          {firstDraftGenerated && <div className="first-draft-review"><AlertTriangle size={15} /><span><b>1차 자동생성은 검토용 초안입니다.</b><small>‘확인 필요’ 문구, 가격·재고와 포장 규격 임시값을 실물·공급처 자료 및 위 비교 가격에 맞게 수정한 뒤 사실 확인을 체크하세요.</small></span></div>}

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
              <label className={manualErrors.packageContents ? "field-error" : ""}><span>판매 구성 <i>필수</i></span><select required value={intake.packageContents} onChange={(event) => setIntakeField("packageContents", event.target.value)}><option value="">구성을 선택하세요</option><option value="상품 1개">1개</option><option value="상품 1+1">1+1</option></select>{manualErrors.packageContents && <small>{manualErrors.packageContents}</small>}</label>
              <label><span>상품 상태 <i>필수</i></span><select value={intake.condition} onChange={(event) => setIntakeField("condition", event.target.value as ProductIntakeDraft["condition"])}>{productConditions.map((value) => <option value={value} key={value}>{value === "NEW" ? "신품" : value === "USED" ? "중고" : "리퍼브"}</option>)}</select></label>
              <label><span>바코드 상태 <i>필수</i></span><select value={intake.gtinStatus} onChange={(event) => setIntakeField("gtinStatus", event.target.value as ProductIntakeDraft["gtinStatus"])}><option value="NO_GTIN">GTIN 없음</option><option value="HAS_GTIN">GTIN 있음</option></select></label>
              {intake.gtinStatus === "HAS_GTIN" && <label className={manualErrors.gtin ? "field-error" : ""}><span>GTIN / EAN / UPC <i>필수</i></span><input inputMode="numeric" required value={intake.gtin} maxLength={14} onChange={(event) => setIntakeField("gtin", event.target.value.replace(/\D/g, ""))} placeholder="8~14자리 숫자" />{manualErrors.gtin && <small>{manualErrors.gtin}</small>}</label>}
              <div className="intake-group-heading"><span>03</span><div><b>판매·재고</b><small>기준 통화의 판매가와 실제 가용 재고를 입력합니다.</small></div></div>
              <label className={manualErrors.sellingPrice ? "field-error" : ""}><span>판매가 <i>필수</i></span><input type="number" required min="0.01" step="0.01" value={intake.sellingPrice || ""} onChange={(event) => setIntakeField("sellingPrice", Number(event.target.value))} placeholder="0" />{manualErrors.sellingPrice && <small>{manualErrors.sellingPrice}</small>}</label>
              <label><span>통화 <i>필수</i></span><select value={intake.currency} onChange={(event) => setIntakeField("currency", event.target.value as ProductIntakeDraft["currency"])}>{productCurrencies.map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
              <label className={manualErrors.stock ? "field-error" : ""}><span>재고 <i>필수</i></span><input type="number" required min="1" step="1" value={intake.stock || ""} onChange={(event) => setIntakeField("stock", Number(event.target.value))} placeholder="1" />{manualErrors.stock && <small>{manualErrors.stock}</small>}</label>
              <div className="intake-group-heading"><span>04</span><div><b>포장·배송 규격</b><small>운임 계산과 채널 배송 제한 검증에 사용합니다.</small></div></div>
              {commerceTemplates.length > 0 && <div className="intake-template-picker"><span><FileText size={14} />저장한 템플릿{appliedTemplate ? <em>적용: {appliedTemplate}</em> : null}</span><div>{commerceTemplates.map((template) => <button type="button" key={template.id} onClick={() => applyCommerceTemplate(template)}>{template.name}{template.is_default ? <small>기본</small> : null}</button>)}</div></div>}
              <label className={manualErrors.weightKg ? "field-error" : ""}><span>포장 중량 kg <i>필수</i></span><input type="number" required min="0.01" step="0.01" value={intake.weightKg || ""} onChange={(event) => setIntakeField("weightKg", Number(event.target.value))} placeholder="0.35" />{manualErrors.weightKg && <small>{manualErrors.weightKg}</small>}</label>
              <label className={manualErrors.packageLengthCm ? "field-error" : ""}><span>포장 가로 cm <i>필수</i></span><input type="number" required min="0.1" step="0.1" value={intake.packageLengthCm || ""} onChange={(event) => setIntakeField("packageLengthCm", Number(event.target.value))} placeholder="12" />{manualErrors.packageLengthCm && <small>{manualErrors.packageLengthCm}</small>}</label>
              <label className={manualErrors.packageWidthCm ? "field-error" : ""}><span>포장 세로 cm <i>필수</i></span><input type="number" required min="0.1" step="0.1" value={intake.packageWidthCm || ""} onChange={(event) => setIntakeField("packageWidthCm", Number(event.target.value))} placeholder="12" />{manualErrors.packageWidthCm && <small>{manualErrors.packageWidthCm}</small>}</label>
              <label className={manualErrors.packageHeightCm ? "field-error" : ""}><span>포장 높이 cm <i>필수</i></span><input type="number" required min="0.1" step="0.1" value={intake.packageHeightCm || ""} onChange={(event) => setIntakeField("packageHeightCm", Number(event.target.value))} placeholder="10" />{manualErrors.packageHeightCm && <small>{manualErrors.packageHeightCm}</small>}</label>
              <label><span>기본 배송비 KRW</span><input type="number" min="0" step="100" value={intake.shippingFeeKrw} onChange={(event) => setIntakeField("shippingFeeKrw", Number(event.target.value))} placeholder="0" /></label>
              <label><span>배송 규칙</span><input value={intake.shippingRule} maxLength={1000} onChange={(event) => setIntakeField("shippingRule", event.target.value)} placeholder="예: 결제 후 1–2영업일 내 출고" /></label>
              <label><span>포장 규칙</span><input value={intake.packagingRule} maxLength={1000} onChange={(event) => setIntakeField("packagingRule", event.target.value)} placeholder="예: 완충재 이중 포장" /></label>
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
          <div className="publishing-readiness-card"><div><span>대표사진</span><b className={mainPhoto ? "done" : ""}>{mainPhoto ? "완료" : "필수"}</b></div><div><span>필수정보</span><b className={intakeReady ? "done" : ""}>{intakeCompletedCount} / {intakeCompletionItems.length}</b></div><div><span>등록 방식</span><b>상품별 병렬 큐</b></div></div>
          <div className="channel-selection-heading"><div><b>등록 채널</b><small>운영 키가 연결된 채널만 선택할 수 있습니다.</small></div><em>{selectedChannels.length}개 선택</em></div>
          <div className="publish-channel-list active-channels">{connectedChannelEntries.map(([key, channel]) => { const selected = selectedChannels.includes(key); return <label key={channel.letter}><ChannelMark code={channel.letter} /><span><b>{channel.name}</b><small>{channel.market} · 공식 API 등록 가능</small></span><input type="checkbox" checked={selected} onChange={(event) => setChannelSelection((current) => ({ ...current, [key]: event.target.checked }))} aria-label={`${channel.name} API 검증 ${selected ? "선택됨" : "선택 가능"}`} /><i><Check size={12} /></i></label>; })}</div>
          <details className="unavailable-channels"><summary><span>연결 대기 채널 {unavailableChannelEntries.length}개</span><ChevronDown size={15} /></summary><div>{unavailableChannelEntries.map(([key, channel]) => { const connected = connectedChannelKeys.includes(key); return <span key={channel.letter}><ChannelMark code={channel.letter} size="sm" /><b>{channel.name}</b><em>{!channel.enabled ? "준비중" : connected ? "연결됨" : "키 필요"}</em></span>; })}</div></details>
          <div className="auto-options"><h4>등록 실행 조건</h4><div className="automation-requirement"><span><b>ChatGPT CLI 분석 완료</b><small>실제 작업 결과가 저장된 상품만 진행</small></span><em>필수</em></div><div className="automation-requirement"><span><b>상품별 병렬 처리</b><small>이전 상품 처리 중에도 다음 상품을 큐에 추가</small></span><em>동시</em></div><div className="automation-requirement"><span><b>공식 카테고리 확정</b><small>말단 카테고리와 필수 속성 저장 필요</small></span><em>필수</em></div><div className="automation-requirement"><span><b>쓰기 전 최종 확인</b><small>가격·재고·배송 정보 검토 뒤 API 실행</small></span><em>필수</em></div></div>
        </aside>
      </section>
      <AiProductStudio
        mainPhoto={mainPhoto}
        photos={mainPhoto ? [mainPhoto, ...Object.values(slotPhotos), ...extraPhotos] : []}
        manualFields={intake}
        requestId={studioRequestId}
        onRunningChange={setRunning}
        notify={notify}
        onJobQueued={(jobId) => setQueuedJobId(jobId)}
        onResultReady={(studioResult, productId) => {
          setAnalyzedProductName(studioResult.product.name);
          setAnalyzedProductId(productId);
          const koreanListing = studioResult.localizedListings.find((listing) => listing.channel === "coupang" && listing.market === "KR")
            ?? studioResult.localizedListings.find((listing) => listing.channel === "smartstore" && listing.market === "KR");
          setIntake((current) => ({
            ...current,
            productName: studioResult.product.name,
            categoryHint: studioResult.product.category,
            description: koreanListing?.description ?? studioResult.product.oneLine,
          }));
          setPublishRefreshVersion((current) => current + 1);
        }}
      />
      <CategoryClassificationWorkbench
        productId={resolvedProductId}
        productName={analyzedProductName || `${intake.productName} ${intake.categoryHint}`.trim()}
        description={intake.description}
        sourceRef={resolvedProductId ?? categoryDraftRef}
        enabledChannels={selectedChannels}
        notify={notify}
        onConfirmed={() => setPublishRefreshVersion((current) => current + 1)}
      />
      <ProductPublishWorkbench
        productId={resolvedProductId}
        selectedChannels={selectedChannels}
        refreshVersion={publishRefreshVersion}
        notify={notify}
      />
      <section className="panel queue-panel"><div className="panel-heading"><div><span className="panel-kicker">LIVE QUEUE</span><h3>실제 등록 작업 현황</h3></div><button className="ghost-button" onClick={onShowHistory}>작업 이력<ChevronRight size={15} /></button></div>
        <div className="queue-live-summary"><div><small>AI 실행 중</small><b>{pipeline?.aiRunning ?? 0}건</b></div><div><small>등록 대기</small><b>{pipeline?.listingQueued ?? 0}건</b></div><div><small>등록 완료</small><b>{pipeline?.listingPublished ?? 0}건</b></div><div><small>재시도 가능</small><b>{pipeline?.listingFailed ?? 0}건</b></div><div><small>외부 권한 대기</small><b>{pipeline?.listingBlocked ?? 0}건</b></div></div>
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
  const deliveredCount = displayOrders.filter((order) => order.status === "배송완료").length;
  const settledCount = displayOrders.filter((order) => order.settlementStatus === "정산 완료").length;
  const exchangeRiskCount = displayOrders.filter((order) => (order.exchangeLossPercent ?? 0) >= 2).length;
  const lastSuccess = syncStatus.filter((item) => item.data_type === "orders" && item.last_succeeded_at).sort((left, right) => Date.parse(right.last_succeeded_at ?? "") - Date.parse(left.last_succeeded_at ?? ""))[0]?.last_succeeded_at ?? null;
  const failedCount = syncStatus.filter((item) => item.data_type === "orders" && item.status === "failed").length;
  const downloadPaidOrders = () => {
    const workbook = buildPaidOrdersExcelWorkbook(displayOrders);
    if (workbook.count === 0) {
      notify("내려받을 결제완료 주문이 없습니다.");
      return;
    }
    const url = URL.createObjectURL(new Blob(["\uFEFF", workbook.xml], { type: "application/vnd.ms-excel;charset=utf-8" }));
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
      <section className="order-summary-grid"><article><span className="metric-icon blue"><ShoppingCart size={19} /></span><div><small>통합 주문</small><strong>{displayOrders.length}</strong></div><em>운영 원장</em></article><article><span className="metric-icon orange"><Clock3 size={19} /></span><div><small>출고 대기</small><strong>{readyCount}</strong></div><em className="neutral">결제완료 {paidCount}건</em></article><article><span className="metric-icon violet"><Truck size={19} /></span><div><small>배송 중 · 완료</small><strong>{shippingCount} · {deliveredCount}</strong></div><em className="neutral">운송장 추적</em></article><article><span className={`metric-icon ${exchangeRiskCount ? "orange" : "green"}`}><CircleDollarSign size={19} /></span><div><small>정산 완료</small><strong>{settledCount}</strong></div><em className={exchangeRiskCount ? "negative" : "neutral"}>{exchangeRiskCount ? `환율 손실주의 ${exchangeRiskCount}건` : "환율 손실주의 없음"}</em></article><article><span className={`metric-icon ${failedCount ? "orange" : "green"}`}><RefreshCw size={19} /></span><div><small>최근 동기화</small><strong>{lastSuccess ? relativeTime(lastSuccess) : "대기"}</strong></div><em className={failedCount ? "neutral" : ""}>{failedCount ? `${failedCount}개 채널 확인 필요` : "실제 채널 API"}</em></article></section>
      <section className="panel data-panel"><div className="tab-toolbar"><div>{["전체 주문", "결제완료", "출고대기", "배송중", "완료 · 취소"].map((tab) => <button className={active === tab ? "active" : ""} onClick={() => setActive(tab)} key={tab}>{tab}{tab === "출고대기" && <span>{readyCount}</span>}</button>)}</div><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="주문번호, 구매자, 상품 검색" aria-label="주문 검색" /></div><button type="button" className="icon-text-button paid-orders-export-button" onClick={downloadPaidOrders} title="결제완료 상태의 주문만 Excel 파일로 내려받기"><Download size={15} />결제완료 Excel <b>{paidCount}</b>건</button><span className="automatic-sync-label"><RefreshCw size={14} />5분마다 자동 업데이트</span></div>
        <div className="table-wrap"><table className="data-table order-table"><thead><tr><th><input type="checkbox" aria-label="출고 가능 주문 전체 선택" checked={allEligibleSelected} onChange={toggleAllEligible} /></th><th>주문번호</th><th>채널</th><th>구매자</th><th>상품</th><th>결제금액</th><th>주문 · 배송</th><th>정산</th><th>주문시간</th><th /></tr></thead><tbody>{filteredOrders.map((order) => { const eligible = ["결제완료", "출고대기"].includes(order.status); return <tr key={order.sourceId} className={`${initialOrderId === order.id ? "search-target-row" : ""} ${selectedIds.has(order.sourceId) ? "selected-row" : ""}`.trim()}><td><input type="checkbox" aria-label={`${order.id} 출고 선택`} checked={selectedIds.has(order.sourceId)} disabled={!eligible} onChange={() => toggleOrder(order)} /></td><td><button type="button" className="order-detail-link mono" onClick={() => setDetailOrder(order)}>{order.id}</button></td><td><ChannelMark code={order.channel} size="sm" /></td><td><b>{order.customer}</b></td><td><button type="button" className="order-product-button truncate-product" onClick={() => setDetailOrder(order)}>{order.product}</button></td><td><b>{order.amount}</b></td><td><StatusBadge status={order.status} />{order.trackingNumber ? <small className="tracking-fact">{order.carrierCode} · {order.trackingNumber}</small> : null}</td><td><StatusBadge status={order.settlementStatus} />{(order.exchangeLossPercent ?? 0) >= 2 ? <small className="exchange-loss-warning">환율 -{order.exchangeLossPercent}%</small> : null}</td><td><span className="muted-cell">{order.time}</span></td><td><button className="table-action" title="주문 상세정보 보기" aria-label={`${order.id} 주문 상세정보 보기`} onClick={() => setDetailOrder(order)}><ChevronRight size={16} /></button></td></tr>; })}</tbody></table></div>
        {displayOrders.length === 0 ? <div className="live-empty-state table-empty"><ShoppingCart size={28} /><b>동기화된 실제 주문이 없습니다.</b><small>채널 API 키 연결 후 주문 조회를 실행하면 표시됩니다.</small></div> : filteredOrders.length === 0 ? <div className="live-empty-state table-empty"><Search size={28} /><b>검색 조건에 맞는 주문이 없습니다.</b><small>주문번호, 구매자명 또는 상품명을 다시 확인해 주세요.</small></div> : null}
        <div className="bulk-order-bar"><span><input type="checkbox" aria-label="출고 가능 주문 전체 선택" checked={allEligibleSelected} onChange={toggleAllEligible} />선택한 주문 <b>{selectedIds.size}</b>건</span><button type="button" disabled={!selectedIds.size || fulfilling} onClick={openFulfillment}><Truck size={15} />일괄 출고 처리</button><button type="button" disabled={fulfilling} onClick={() => invoiceInputRef.current?.click()}><Upload size={15} />송장 CSV 업로드</button><input ref={invoiceInputRef} className="sr-only" type="file" accept=".csv,text/csv" aria-label="송장 CSV 파일 선택" onChange={(event) => void importInvoices(event.target.files?.[0] ?? null)} /><span className="toolbar-spacer" /><small>{syncStatus.length ? "채널별 동기화 상태 기록 중 · 5분 자동 업데이트" : "채널 연결 상태 확인 중"}</small></div>
      </section>
      {detailOrder && <div className="shipment-dialog-overlay" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setDetailOrder(null); }}><section className="shipment-dialog order-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="order-detail-title"><header><div><span className="metric-icon blue"><ShoppingCart size={18} /></span><span><h3 id="order-detail-title">주문 상세정보</h3><small>주문 · 배송 · 정산 원장을 한곳에서 확인합니다.</small></span></div><button className="icon-only-button" aria-label="주문 상세 닫기" onClick={() => setDetailOrder(null)}><X size={17} /></button></header><dl className="order-detail-ledger"><div><dt>주문번호</dt><dd>{detailOrder.id}</dd></div><div><dt>판매 채널</dt><dd><ChannelMark code={detailOrder.channel} size="sm" /></dd></div><div><dt>구매 상품</dt><dd>{detailOrder.product}</dd></div><div><dt>구매자</dt><dd>{detailOrder.customer}</dd></div><div><dt>결제금액</dt><dd>{detailOrder.amount}</dd></div><div><dt>주문상태</dt><dd><StatusBadge status={detailOrder.status} /></dd></div><div><dt>배송 추적</dt><dd>{detailOrder.trackingNumber ? `${detailOrder.carrierCode ?? "택배사"} · ${detailOrder.trackingNumber}` : "운송장 등록 전"}</dd></div><div><dt>배송 완료</dt><dd>{detailOrder.deliveredAt ? formatProductUpdatedAt(detailOrder.deliveredAt) : "완료 전"}</dd></div><div><dt>정산 상태</dt><dd><StatusBadge status={detailOrder.settlementStatus} /></dd></div><div><dt>정산 금액</dt><dd>{detailOrder.settlementAmount != null && detailOrder.settlementCurrency ? new Intl.NumberFormat("ko-KR", { style: "currency", currency: detailOrder.settlementCurrency }).format(detailOrder.settlementAmount) : "정산 데이터 대기"}</dd></div><div><dt>환율 손익 참고</dt><dd className={(detailOrder.exchangeLossPercent ?? 0) >= 2 ? "exchange-loss-warning" : ""}>{detailOrder.exchangeLossPercent == null ? "기준환율 데이터 대기" : `${detailOrder.exchangeLossPercent > 0 ? "손실 " : "이익 "}${Math.abs(detailOrder.exchangeLossPercent).toFixed(2)}%`}</dd></div><div><dt>주문시간</dt><dd>{detailOrder.time}</dd></div></dl><footer><button type="button" className="credential-secondary" onClick={() => setDetailOrder(null)}>닫기</button>{["결제완료", "출고대기"].includes(detailOrder.status) ? <button type="button" className="publish-execute" onClick={() => { setSelectedIds(new Set([detailOrder.sourceId])); setShipmentDrafts({ [detailOrder.sourceId]: shipmentDrafts[detailOrder.sourceId] ?? { carrierCode: "", trackingNumber: "" } }); setDetailOrder(null); setFulfillmentOpen(true); }}><Truck size={15} />출고 정보 입력</button> : null}</footer></section></div>}
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

type NotificationPreferences = { kakao_enabled: boolean; order_paid: boolean; shipping_ready: boolean; shipping_completed: boolean; listing_published: boolean; listing_failed: boolean; low_stock: boolean; cs_waiting: boolean; settlement_rate_risk: boolean };
const defaultNotificationPreferences: NotificationPreferences = { kakao_enabled: true, order_paid: true, shipping_ready: true, shipping_completed: true, listing_published: true, listing_failed: true, low_stock: true, cs_waiting: true, settlement_rate_risk: true };

function NotificationsPage({ authenticatedFetch, notify }: { authenticatedFetch: (input: string, init?: RequestInit) => Promise<Response>; notify: (message: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [kakao, setKakao] = useState<{ connected?: boolean; nickname?: string; kakaoUserId?: string; expiresAt?: string }>({ connected: false });
  const [preferences, setPreferences] = useState(defaultNotificationPreferences);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch("/api/integrations/kakao/settings");
      const payload = await response.json().catch(() => ({ message: "알림 설정 응답을 읽지 못했습니다." })) as { kakao?: typeof kakao; preferences?: Partial<NotificationPreferences>; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "알림 설정을 불러오지 못했습니다.");
      setKakao(payload.kakao ?? { connected: false });
      setPreferences({ ...defaultNotificationPreferences, ...(payload.preferences ?? {}) });
    } catch (error) { notify(error instanceof Error ? error.message : "알림 설정을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }, [authenticatedFetch, notify]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const connect = async () => {
    setWorking(true);
    try {
      const response = await authenticatedFetch("/api/integrations/kakao/connect", { method: "POST", body: "{}" });
      const payload = await response.json().catch(() => ({ message: "카카오 연결 응답을 읽지 못했습니다." })) as { authorizationUrl?: string; message?: string };
      if (!response.ok || !payload.authorizationUrl) throw new Error(payload.message ?? "카카오 연결을 시작하지 못했습니다.");
      window.location.assign(payload.authorizationUrl);
    } catch (error) { notify(error instanceof Error ? error.message : "카카오 연결을 시작하지 못했습니다."); setWorking(false); }
  };
  const save = async () => {
    setWorking(true);
    try {
      const response = await authenticatedFetch("/api/integrations/kakao/settings", { method: "POST", body: JSON.stringify({ preferences }) });
      const payload = await response.json().catch(() => ({ message: "알림 저장 응답을 읽지 못했습니다." })) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "알림 설정을 저장하지 못했습니다.");
      notify("웹·카카오 알림 세부 설정을 저장했습니다.");
    } catch (error) { notify(error instanceof Error ? error.message : "알림 설정을 저장하지 못했습니다."); }
    finally { setWorking(false); }
  };
  const test = async () => {
    setWorking(true);
    try {
      const response = await authenticatedFetch("/api/integrations/kakao/settings", { method: "POST", body: JSON.stringify({ action: "test" }) });
      const payload = await response.json().catch(() => ({ message: "테스트 알림 응답을 읽지 못했습니다." })) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "테스트 알림을 보내지 못했습니다.");
      notify("가입한 사용자 본인의 카카오톡 ‘나와의 채팅’으로 테스트 알림을 보냈습니다.");
    } catch (error) { notify(error instanceof Error ? error.message : "테스트 알림을 보내지 못했습니다."); }
    finally { setWorking(false); }
  };
  const options: Array<{ key: keyof NotificationPreferences; title: string; detail: string; icon: React.ComponentType<{ size?: number }> }> = [
    { key: "order_paid", title: "새 주문 · 결제완료", detail: "채널에서 새 결제 주문이 동기화될 때", icon: ShoppingCart },
    { key: "shipping_ready", title: "배송 준비 · 출고대기", detail: "운송장 등록과 발송 처리가 필요할 때", icon: PackageCheck },
    { key: "shipping_completed", title: "배송 완료", detail: "채널 배송이 최종 완료 상태가 될 때", icon: Truck },
    { key: "listing_published", title: "상품 등록 · 승인 완료", detail: "상품이 판매채널에 게시됐을 때", icon: CheckCircle2 },
    { key: "listing_failed", title: "상품 등록 거절 · 보완", detail: "권한·카테고리·속성 수정이 필요할 때", icon: AlertCircle },
    { key: "low_stock", title: "재고 부족", detail: "가용재고가 재주문 기준 이하가 될 때", icon: Box },
    { key: "cs_waiting", title: "고객 문의 · CS", detail: "답변 대기 문의가 있을 때", icon: MessageCircleMore },
    { key: "settlement_rate_risk", title: "환율 정산 손실 주의", detail: "기준환율보다 2% 이상 불리한 정산이 감지될 때", icon: CircleDollarSign },
  ];
  return <div className="page-stack notifications-settings-page">
    <section className="panel kakao-connect-card"><div><span className="kakao-symbol">K</span><span><small>공식 Kakao Login · KakaoTalk Message API</small><h3>{kakao.connected ? `${kakao.nickname || "사용자"} 카카오톡 연결됨` : "가입한 사용자 카카오톡 연결"}</h3><p>이 컴퓨터의 카카오톡이 아니라 로그인한 사용자 본인의 카카오 계정을 OAuth로 연결합니다. 알림은 공식 API가 허용하는 본인 ‘나와의 채팅’으로 전송됩니다.</p></span></div><div>{kakao.connected ? <><span className="status-badge success"><i />연결 정상</span><button type="button" className="credential-secondary" onClick={() => void test()} disabled={working}>테스트 보내기</button></> : <button type="button" className="kakao-connect-button" onClick={() => void connect()} disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : <MessageCircleMore size={16} />}카카오 계정 연결</button>}</div></section>
    <section className="panel notification-preferences"><div className="panel-heading"><div><span className="panel-kicker">DETAILED NOTIFICATIONS</span><h3>업무별 알림 세부 설정</h3></div><label className="master-notification-toggle"><input type="checkbox" aria-label="카카오 알림 전체 사용" checked={preferences.kakao_enabled} onChange={(event) => setPreferences((current) => ({ ...current, kakao_enabled: event.target.checked }))} /><span>카카오 알림 전체</span></label></div>{loading ? <div className="product-detail-empty compact"><LoaderCircle className="spin" size={22} /><b>알림 설정을 불러오는 중입니다.</b></div> : <div className="notification-preference-grid">{options.map((option) => <label key={option.key}><span className="metric-icon blue"><option.icon size={16} /></span><span><b>{option.title}</b><small>{option.detail}</small></span><input type="checkbox" aria-label={`${option.title} 알림`} checked={preferences[option.key]} onChange={(event) => setPreferences((current) => ({ ...current, [option.key]: event.target.checked }))} /></label>)}</div>}<footer><small>웹 종 알림은 개별·전체 닫기를 지원하며, 새로운 상태 변화가 생기면 다시 표시됩니다.</small><button type="button" className="publish-execute" disabled={working || loading} onClick={() => void save()}>{working ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}설정 저장</button></footer></section>
  </div>;
}

function TemplatesPage({ authenticatedFetch, notify }: { authenticatedFetch: (input: string, init?: RequestInit) => Promise<Response>; notify: (message: string) => void }) {
  const [templates, setTemplates] = useState<CommerceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({ name: "", kind: "packaging_shipping" as CommerceTemplate["kind"], shippingFeeKrw: 0, shippingRule: "", packagingRule: "", weightKg: 0.5, packageLengthCm: 20, packageWidthCm: 20, packageHeightCm: 10, isDefault: false });
  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch("/api/admin/templates");
      const payload = await response.json().catch(() => ({ message: "템플릿 응답을 읽지 못했습니다." })) as { templates?: CommerceTemplate[]; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "템플릿을 불러오지 못했습니다.");
      setTemplates(Array.isArray(payload.templates) ? payload.templates : []);
    } catch (error) {
      notify(error instanceof Error ? error.message : "템플릿을 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }, [authenticatedFetch, notify]);
  useEffect(() => { const timer = window.setTimeout(() => void loadTemplates(), 0); return () => window.clearTimeout(timer); }, [loadTemplates]);
  const save = async () => {
    if (!draft.name.trim() || saving) return;
    setSaving(true);
    try {
      const response = await authenticatedFetch("/api/admin/templates", { method: "POST", body: JSON.stringify({ name: draft.name, kind: draft.kind, isDefault: draft.isDefault, values: { shippingFeeKrw: draft.shippingFeeKrw, shippingRule: draft.shippingRule, packagingRule: draft.packagingRule, weightKg: draft.weightKg, packageLengthCm: draft.packageLengthCm, packageWidthCm: draft.packageWidthCm, packageHeightCm: draft.packageHeightCm } }) });
      const payload = await response.json().catch(() => ({ message: "템플릿 저장 응답을 읽지 못했습니다." })) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "템플릿을 저장하지 못했습니다.");
      setDraft((current) => ({ ...current, name: "", isDefault: false }));
      await loadTemplates();
      notify("상품 등록에서 선택할 템플릿을 저장했습니다.");
    } catch (error) { notify(error instanceof Error ? error.message : "템플릿을 저장하지 못했습니다."); }
    finally { setSaving(false); }
  };
  const remove = async (id: string) => {
    const response = await authenticatedFetch(`/api/admin/templates?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) return notify("템플릿을 삭제하지 못했습니다.");
    setTemplates((current) => current.filter((template) => template.id !== id));
    notify("템플릿을 삭제했습니다.");
  };
  return <div className="page-stack templates-page">
    <section className="panel template-editor"><div className="panel-heading"><div><span className="panel-kicker">REUSABLE RULES</span><h3>배송비 · 포장/배송규칙 템플릿</h3></div><FileText size={18} /></div><p>한 번 저장한 값은 상품 등록의 포장·배송 입력란 위에 버튼으로 나타납니다.</p><div className="template-form-grid"><label><span>템플릿 이름</span><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="예: 국내 택배 기본" /></label><label><span>유형</span><select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as CommerceTemplate["kind"] }))}><option value="packaging_shipping">포장 · 배송</option><option value="shipping_fee">배송비</option></select></label><label><span>배송비 KRW</span><input type="number" min="0" value={draft.shippingFeeKrw} onChange={(event) => setDraft((current) => ({ ...current, shippingFeeKrw: Number(event.target.value) }))} /></label><label><span>중량 kg</span><input type="number" min="0.01" step="0.01" value={draft.weightKg} onChange={(event) => setDraft((current) => ({ ...current, weightKg: Number(event.target.value) }))} /></label><label><span>가로 cm</span><input type="number" min="0.1" value={draft.packageLengthCm} onChange={(event) => setDraft((current) => ({ ...current, packageLengthCm: Number(event.target.value) }))} /></label><label><span>세로 cm</span><input type="number" min="0.1" value={draft.packageWidthCm} onChange={(event) => setDraft((current) => ({ ...current, packageWidthCm: Number(event.target.value) }))} /></label><label><span>높이 cm</span><input type="number" min="0.1" value={draft.packageHeightCm} onChange={(event) => setDraft((current) => ({ ...current, packageHeightCm: Number(event.target.value) }))} /></label><label className="template-wide"><span>배송 규칙</span><textarea value={draft.shippingRule} onChange={(event) => setDraft((current) => ({ ...current, shippingRule: event.target.value }))} placeholder="출고일, 배송지역, 반품 배송 안내" /></label><label className="template-wide"><span>포장 규칙</span><textarea value={draft.packagingRule} onChange={(event) => setDraft((current) => ({ ...current, packagingRule: event.target.value }))} placeholder="완충재, 합포장, 파손 방지 규칙" /></label><label className="template-default"><input type="checkbox" checked={draft.isDefault} onChange={(event) => setDraft((current) => ({ ...current, isDefault: event.target.checked }))} /><span>이 유형의 기본 템플릿</span></label></div><button type="button" className="publish-execute" disabled={!draft.name.trim() || saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{saving ? "저장 중" : "템플릿 저장"}</button></section>
    <section className="panel template-list-panel"><div className="panel-heading"><div><span className="panel-kicker">SAVED TEMPLATES</span><h3>저장된 템플릿</h3></div><span className="count-chip">{templates.length}</span></div>{loading ? <div className="product-detail-empty compact"><LoaderCircle className="spin" size={22} /><b>템플릿을 불러오는 중입니다.</b></div> : templates.length ? <div className="template-card-grid">{templates.map((template) => <article key={template.id}><div><FileText size={16} /><span><b>{template.name}</b><small>{template.kind === "shipping_fee" ? "배송비" : "포장 · 배송"}{template.is_default ? " · 기본" : ""}</small></span><button type="button" aria-label={`${template.name} 삭제`} onClick={() => void remove(template.id)}><Trash2 size={14} /></button></div><dl><div><dt>배송비</dt><dd>{Number(template.values.shippingFeeKrw ?? 0).toLocaleString()}원</dd></div><div><dt>포장</dt><dd>{String(template.values.packagingRule ?? "미입력")}</dd></div><div><dt>배송</dt><dd>{String(template.values.shippingRule ?? "미입력")}</dd></div></dl></article>)}</div> : <div className="product-detail-empty compact"><FileText size={24} /><b>저장된 템플릿이 없습니다.</b><small>위에서 자주 쓰는 배송비와 포장·배송 규칙을 먼저 저장하세요.</small></div>}</section>
  </div>;
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
  const [dismissedNotifications, setDismissedNotifications] = useState<Set<string>>(new Set());
  const [accountOpen, setAccountOpen] = useState(false);
  const [credentialChanging, setCredentialChanging] = useState(false);
  const [credentialMessage, setCredentialMessage] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [toast, setToast] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [targetedSearch, setTargetedSearch] = useState<{ kind: "order" | "inquiry"; id: string; query: string } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const toastTimerRef = useRef<number | null>(null);
  const activityStatusRef = useRef<Map<string, string> | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<DisplayProduct | null>(null);
  const [publishingProduct, setPublishingProduct] = useState<{ id: string; name: string } | null>(null);
  const [publishingSession, setPublishingSession] = useState(0);
  const displayProductsRef = useRef<DisplayProduct[]>([]);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const operations = useOperationsSnapshot();
  const refreshOperations = operations.refresh;
  const operationSummary = operations.data?.summary ?? null;
  const channelMetrics = useMemo(() => operations.data?.channelMetrics ?? [], [operations.data]);
  const pipeline = operations.data?.pipeline ?? null;
  const registrationActivities = useMemo(() => operations.data?.registrationActivities ?? [], [operations.data]);
  const workerLastSeenAt = operations.data?.aiRuntime?.worker?.last_seen_at ?? null;
  const workerConnected = Boolean(workerLastSeenAt && operations.data?.generatedAt
    && Date.parse(operations.data.generatedAt) - Date.parse(workerLastSeenAt) < 10 * 60_000);
  const meta = pageMeta[view];

  const notify = useCallback((message: string) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => { setToast(""); toastTimerRef.current = null; }, 2_000);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  useEffect(() => {
    if (!notificationsOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target as Node)) setNotificationsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setNotificationsOpen(false); };
    document.addEventListener("pointerdown", closeOnOutside, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [notificationsOpen]);

  useEffect(() => {
    if (!operations.data) return;
    const nextStatuses = new Map(registrationActivities.map((activity) => [activity.id, activity.status]));
    const previousStatuses = activityStatusRef.current;
    if (previousStatuses) {
      const changed = registrationActivities.find((activity) => previousStatuses.has(activity.id) && previousStatuses.get(activity.id) !== activity.status);
      if (changed) notify(`${changed.productName}: ${registrationStatusMeta[changed.status].label}`);
    }
    activityStatusRef.current = nextStatuses;
  }, [notify, operations.data, registrationActivities]);

  useEffect(() => {
    if (!registrationActivities.some((activity) => ["analyzing", "ready", "publishing"].includes(activity.status))) return;
    const interval = window.setInterval(() => void refreshOperations(), 10_000);
    return () => window.clearInterval(interval);
  }, [refreshOperations, registrationActivities]);

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

  const displayProducts = useMemo<DisplayProduct[]>(() => {
    const periodProducts = new Map((operations.data?.analytics?.products ?? []).map((product) => [product.productId, product]));
    return operations.data?.products.map((product) => {
      const period = periodProducts.get(product.id);
      return ({
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
    sales: period?.sold ?? 0,
    revenueKrw: period?.revenueKrw ?? 0,
    revenue: `₩${Math.round(period?.revenueKrw ?? 0).toLocaleString("ko-KR")}`,
    status: productStatusLabel[product.status],
    channels: product.listingChannels,
    channelSales: period?.channels ?? [],
    updatedAt: product.updatedAt,
  });
    }) ?? [];
  }, [operations.data]);
  useEffect(() => { displayProductsRef.current = displayProducts; }, [displayProducts]);

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
    shippedAt: order.shippedAt,
    deliveredAt: order.deliveredAt,
    carrierCode: order.carrierCode,
    trackingNumber: order.trackingNumber,
    settlementStatus: { pending: "정산 대기", expected: "정산 예정", settled: "정산 완료", held: "정산 보류", disputed: "정산 이의" }[order.settlementStatus] ?? order.settlementStatus,
    settlementAmount: order.settlementAmount,
    settlementCurrency: order.settlementCurrency,
    exchangeLossPercent: order.exchangeLossPercent,
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
      const response = await operations.authenticatedFetch(ticket.channelKey === "lazada" ? "/api/admin/cs/lazada-reply" : "/api/operations/snapshot", {
        method: "POST",
        body: JSON.stringify(ticket.channelKey === "lazada"
          ? { ticketId: source.id, reply }
          : { action: "ticket_update", id: source.id, status: "resolved", replyDraft: reply }),
      });
      const payload = await response.json().catch(() => ({ message: "CS 답변 응답을 읽지 못했습니다." })) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "CS 답변을 저장하지 못했습니다.");
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
        body: JSON.stringify({ includeImBootstrap: !silent }),
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
  }, [syncOrders]);

  const navigate = useCallback((next: View) => {
    setTargetedSearch(null);
    if (next === "publishing") {
      setPublishingProduct(null);
      setPublishingSession((current) => current + 1);
    }
    setView(next);
    window.sessionStorage.setItem("sellerpilot:last-view:v1", next);
    window.history.pushState({ view: next }, "", `${window.location.pathname}?view=${next}`);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const editExternalActionProduct = useCallback((action: OperationsSnapshot["externalActions"][number]) => {
    setPublishingProduct({ id: action.productId, name: action.productName });
    setPublishingSession((current) => current + 1);
    setView("publishing");
    window.sessionStorage.setItem("sellerpilot:last-view:v1", "publishing");
    window.history.pushState({ view: "publishing", productId: action.productId }, "", `${window.location.pathname}?view=publishing&productId=${encodeURIComponent(action.productId)}`);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const initialParams = new URLSearchParams(window.location.search);
    const initialState = isRecord(window.history.state) ? window.history.state : {};
    const initialCandidate = typeof initialState.view === "string"
      ? initialState.view
      : initialParams.get("view") ?? window.sessionStorage.getItem("sellerpilot:last-view:v1") ?? "overview";
    const initialView = initialCandidate in pageMeta ? initialCandidate as View : "overview";
    const initialProductId = typeof initialState.productId === "string" ? initialState.productId : initialParams.get("productId");
    if (!initialParams.has("view")) initialParams.set("view", initialView);
    window.sessionStorage.setItem("sellerpilot:last-view:v1", initialView);
    window.history.replaceState(
      { ...initialState, view: initialView, ...(initialProductId ? { productId: initialProductId } : {}) },
      "",
      `${window.location.pathname}?${initialParams.toString()}`,
    );
    const initialViewTimer = window.setTimeout(() => setView(initialView), 0);
    const onPopState = (event: PopStateEvent) => {
      const state = isRecord(event.state) ? event.state : {};
      const params = new URLSearchParams(window.location.search);
      const candidate = typeof state.view === "string"
        ? state.view
        : params.get("view") ?? window.sessionStorage.getItem("sellerpilot:last-view:v1") ?? "overview";
      const nextView = candidate in pageMeta ? candidate as View : "overview";
      const productId = typeof state.productId === "string" ? state.productId : params.get("productId");
      if (nextView === "product-detail" && productId) {
        const product = displayProductsRef.current.find((item) => item.sourceId === productId);
        if (product) setSelectedProduct(product);
      }
      if (nextView === "publishing" && productId) {
        const product = displayProductsRef.current.find((item) => item.sourceId === productId);
        if (product) setPublishingProduct({ id: product.sourceId, name: product.name });
      }
      window.sessionStorage.setItem("sellerpilot:last-view:v1", nextView);
      setView(nextView);
      setSidebarOpen(false);
      window.scrollTo({ top: 0, behavior: "auto" });
    };
    window.addEventListener("popstate", onPopState);
    return () => {
      window.clearTimeout(initialViewTimer);
      window.removeEventListener("popstate", onPopState);
    };
  // Browser entries are app views; live product data is read through a ref.
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get("view") as View | null;
    if (!requestedView || !(requestedView in pageMeta)) return;
    const orderId = params.get("orderId");
    const productId = params.get("productId");
    const timer = window.setTimeout(() => {
      setView(requestedView);
      window.sessionStorage.setItem("sellerpilot:last-view:v1", requestedView);
      if (requestedView === "orders" && orderId) {
        const order = operations.data?.orders.find((item) => item.id === orderId);
        if (order) setTargetedSearch({ kind: "order", id: order.externalOrderId, query: order.externalOrderId });
      }
      if (requestedView === "product-detail" && productId) {
        const product = displayProductsRef.current.find((item) => item.sourceId === productId);
        if (product) setSelectedProduct(product);
      }
      if (requestedView === "publishing" && productId) {
        const product = displayProductsRef.current.find((item) => item.sourceId === productId);
        if (product) setPublishingProduct({ id: product.sourceId, name: product.name });
      }
      window.history.replaceState(
        { view: requestedView, ...(productId ? { productId } : {}) },
        "",
        `${window.location.pathname}?${params.toString()}`,
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [operations.data]);

  const openProductDetails = useCallback((product: DisplayProduct) => {
    setSelectedProduct(product);
    setView("product-detail");
    window.sessionStorage.setItem("sellerpilot:last-view:v1", "product-detail");
    window.history.pushState({ view: "product-detail", productId: product.sourceId }, "", `${window.location.pathname}?view=product-detail&productId=${encodeURIComponent(product.sourceId)}`);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const notificationItems = useMemo(() => [
    { key: `low-stock:${operationSummary?.lowStockCount ?? 0}`, title: `재고주의 상품 ${operationSummary?.lowStockCount ?? 0}건`, detail: "운영 원장 실재고 기준", view: "products" as View, tone: "danger", icon: Box },
    { key: `listing-errors:${operationSummary?.registrationErrorCount ?? 0}`, title: `등록 재시도 ${operationSummary?.registrationErrorCount ?? 0}건`, detail: "상품별 채널 오류와 소요시간을 확인하세요.", view: "registration-activity" as View, tone: "warning", icon: AlertCircle },
    { key: `external-actions:${operationSummary?.registrationBlockedCount ?? 0}`, title: `외부 권한·상품수정 ${operationSummary?.registrationBlockedCount ?? 0}건`, detail: "판매자센터에서 한 건씩 보완", view: "remediation" as View, tone: "warning", icon: ShieldCheck },
    { key: `open-cs:${operationSummary?.openTicketCount ?? 0}`, title: `미처리 CS ${operationSummary?.openTicketCount ?? 0}건`, detail: "답변 대기와 처리 중 문의", view: "cs" as View, tone: "blue", icon: MessageCircleMore },
  ].filter((item) => !dismissedNotifications.has(item.key) && !item.title.includes(" 0건")), [dismissedNotifications, operationSummary]);

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
    if (view === "overview") return <OverviewPage onNavigate={navigate} displayProducts={displayProducts} operationSummary={operationSummary} channelMetrics={channelMetrics} pipeline={pipeline} analytics={operations.data?.analytics ?? null} salesRange={operations.range} onSalesRangeChange={operations.setRange} resolvedCsCount={operations.data?.tickets.filter((ticket) => ticket.status === "resolved").length ?? 0} operationsAvailable={operations.state === "database"} />;
    if (view === "products") return <ProductsPage onNavigate={navigate} onOpenProduct={openProductDetails} onRefresh={operations.reload} displayProducts={displayProducts} salesRange={operations.range} onSalesRangeChange={operations.setRange} operationsState={operations.state} />;
    if (view === "registration-activity") return <RegistrationActivityPage activities={registrationActivities} displayProducts={displayProducts} loading={operations.state === "loading"} onRefresh={operations.refresh} onOpenProduct={openProductDetails} onNewProduct={() => navigate("publishing")} onExternalActions={() => navigate("remediation")} />;
    if (view === "product-detail" && selectedProduct) return <ProductDetailPage product={selectedProduct} onBack={() => window.history.back()} authenticatedFetch={operations.authenticatedFetch} notify={notify} onChanged={operations.refresh} />;
    if (view === "remediation") return <ExternalActionsPage actions={operations.data?.externalActions ?? []} onEdit={editExternalActionProduct} onConnections={() => navigate("connections")} />;
    if (view === "publishing") return <PublishingPage key={`${publishingProduct?.id ?? "new-product"}-${publishingSession}`} notify={notify} channelMetrics={channelMetrics} pipeline={pipeline} authenticatedFetch={operations.authenticatedFetch} initialProduct={publishingProduct} onStartAnother={() => navigate("publishing")} onShowHistory={() => navigate("registration-activity")} />;
    if (view === "style-learning") return <StyleLearningCenter />;
    if (view === "margin") return <MarginCalculatorPage notify={notify} scenarios={Array.isArray(operations.data?.marginScenarios) ? operations.data.marginScenarios : []} onChanged={() => void operations.reload()} />;
    if (view === "orders") return <OrdersPage key={`orders-${targetedSearch?.kind === "order" ? targetedSearch.id : "all"}`} notify={notify} displayOrders={displayOrders} onFulfill={fulfillOrders} syncStatus={operations.data?.syncStatus ?? []} initialQuery={targetedSearch?.kind === "order" ? targetedSearch.query : ""} initialOrderId={targetedSearch?.kind === "order" ? targetedSearch.id : null} />;
    if (view === "cs") return <CsPage key={`cs-${targetedSearch?.kind === "inquiry" ? targetedSearch.id : "all"}`} notify={notify} displayTickets={displayTickets} displayOrders={displayOrders} onSend={saveTicketReply} onDraft={generateSupportReply} onStatus={updateTicketStatus} onSync={syncOrders} syncing={syncingOrders} syncStatus={operations.data?.syncStatus ?? []} initialQuery={targetedSearch?.kind === "inquiry" ? targetedSearch.query : ""} initialTicketId={targetedSearch?.kind === "inquiry" ? targetedSearch.id : null} />;
    if (view === "connections") return <ChannelConnectionsPage notify={notify} channelMetrics={channelMetrics} />;
    if (view === "templates") return <TemplatesPage authenticatedFetch={operations.authenticatedFetch} notify={notify} />;
    if (view === "notifications") return <NotificationsPage authenticatedFetch={operations.authenticatedFetch} notify={notify} />;
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
            <span><i className={operations.state === "database" && operationSummary?.registeredCredentialCount ? "rail-ok" : "rail-pending"} />{operations.state === "database" ? `운영 키 ${operationSummary?.registeredCredentialCount ?? 0} / ${enabledSalesChannelCount}` : operations.state === "loading" ? "운영 키 확인 중" : "운영 키 확인 실패"}</span>
            <span><i className={operations.state === "database" && operationSummary?.activeCredentialCount ? "rail-ok" : "rail-pending"} />{operations.state === "database" ? `읽기 진단 ${operationSummary?.activeCredentialCount ?? 0} / ${enabledSalesChannelCount}` : operations.state === "loading" ? "읽기 진단 확인 중" : "읽기 진단 확인 실패"}</span>
            <span><i className={workerConnected ? "rail-ok" : "rail-pending"} />자동 동기화 {workerConnected ? "실행 중" : "확인 필요"}</span>
            <span><i className="rail-ok" />인증정보 암호화 보관</span>
            <em>{operations.state === "database" ? "실제 연결 상태 1분 자동 갱신" : operations.state === "loading" ? "연결 상태 확인 중" : "운영 DB 연결 오류"}</em>
          </div>
          <header className="topbar">
          <div className="topbar-title"><button className="mobile-menu-button" aria-label="전체 메뉴 열기" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button><div><h1>{meta.title}</h1><p>{meta.description}</p></div></div>
          <div className="topbar-actions"><span className={`demo-data-badge ${operations.state === "database" ? "database" : ""}`} title={operations.message}><Activity size={13} /><b>{operations.state === "database" ? "실데이터" : operations.state === "loading" ? "연결 확인" : "연결 오류"}</b><small>{operations.state === "database" ? "Supabase 운영 원장" : operations.message}</small></span><button className="global-search" aria-label="통합 검색 열기" onClick={openSearch}><Search size={16} /><span>상품, 주문, 문의 검색</span><kbd><Command size={11} />K</kbd></button><div className="notification-wrap" ref={notificationRef}><button className="top-icon-button" aria-label="알림" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((current) => !current)}><Bell size={18} />{notificationItems.length > 0 && <i />}</button>{notificationsOpen && <div className="notification-popover"><div><h4>실시간 알림 <small>{notificationItems.length}</small></h4><span><button type="button" onClick={() => setDismissedNotifications(new Set(notificationItems.map((item) => item.key)))}>전체 닫기</button><button type="button" aria-label="알림창 닫기" onClick={() => setNotificationsOpen(false)}><X size={14} /></button></span></div>{notificationItems.map((item) => <div className="notification-item" role="button" tabIndex={0} key={item.key} onClick={() => { navigate(item.view); setNotificationsOpen(false); }} onKeyDown={(event) => { if (event.key === "Enter") { navigate(item.view); setNotificationsOpen(false); } }}><span className={`alert-icon ${item.tone}`}><item.icon size={15} /></span><span><b>{item.title}</b><small>{item.detail}</small></span><button type="button" aria-label={`${item.title} 알림 닫기`} onClick={(event) => { event.stopPropagation(); setDismissedNotifications((current) => new Set([...current, item.key])); }}><X size={13} /></button></div>)}{notificationItems.length === 0 && <div className="notification-empty"><CheckCircle2 size={20} /><span><b>확인할 새 알림이 없습니다.</b><small>새 상태 변화가 생기면 다시 표시됩니다.</small></span></div>}</div>}</div><button className="user-menu" onClick={() => { setCredentialMessage(""); setNewAdminPassword(""); setAccountOpen(true); }} aria-label="관리자 계정 설정 열기"><span className="user-avatar">관</span><span><b>{userEmail.split("@")[0]}</b><small>보안 관리자</small></span><ChevronDown size={14} /></button></div>
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
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        setUserEmail("");
        setAccessState("signed_out");
        return;
      }
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") setAccessState("checking");
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
