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
import { AiProductStudio, cleanupUnenqueuedStudioPhotos, optimizeAndUploadStudioPhotos, type StudioCompetitorContext, type StudioPhoto } from "./ai-product-studio";
import { AcceptanceChecklistPage } from "./acceptance-checklist";
import { ChannelConnectionsPage } from "./channel-connections";
import { CategoryClassificationWorkbench } from "./category-classification-workbench";
import { ProductPublishWorkbench } from "./product-publish-workbench";
import { ProductRevisionImagePicker } from "./product-revision-image-picker";
import {
  parseProductDetailPageEnvelope,
  parseProductDetailSource,
  SavedProductDetailPage,
  type ProductDetailPageEnvelope,
} from "./saved-product-detail-page";
import { StyleLearningCenter } from "./style-learning-center";
import { MarginCalculatorPage } from "./margin-calculator";
import { MobilePushManager } from "./mobile-push-manager";
import { marketplaceListingLinkLabel, marketplaceListingUrl, type RemoteListingReference } from "./channel-links";
import { channels, type ChannelKey } from "./channel-config";
import { activeChannelKeys, isActiveChannelKey } from "../lib/channels/catalog";
import { shipmentVerificationSummary, shipmentWriteAvailability } from "../lib/channels/shipment-release";
import { useOperationsSnapshot, type OperationsSnapshot, type OperationTicket, type SalesRange } from "./use-operations-snapshot";
import { createClient as createSupabaseClient } from "../lib/supabase/client";
import { isSupabaseConfigured } from "../lib/supabase/config";
import type { ProductResearchResult } from "../lib/ai-cli-contract";
import { canonicalizeStudioCompetitorUrl } from "../lib/studio-competitor-evidence";
import { emptyProductIntake, productConditions, productCurrencies, productEditSchema, productIntakeSchema, type ProductIntakeDraft } from "../lib/product-intake";
import { normalizeProductSaleConfiguration, productSaleConfigurations } from "../lib/product-sale-configuration";
import { recoverAmbiguousProductRevision } from "../lib/product-revision-recovery";
import { createRevisionPhotoSelectionFence, releaseStaleRevisionPhoto } from "../lib/product-revision-photo-fence";
import { settleWithConcurrency } from "../lib/promise-pool";
import { assertStudioPhotoBatch } from "../lib/studio-photo-upload";
import { withPromiseTimeout } from "../lib/promise-timeout";
import { fetchJsonWithDeadline } from "../lib/bounded-json-request";
import { classifyExactJobAdmission } from "../lib/exact-job-admission";
import { assertStudioSourceDimensions, assertStudioSourceFile } from "../lib/studio-source-photo-policy";
import { deadlineAfter, deadlineIsActive, deadlineRemaining } from "../lib/time-deadline";
import { buildPaidOrdersExcelWorkbook, paidOrdersExcelFilename } from "../lib/order-excel";
import {
  adminVerificationState,
  nextAdminAccessState,
  switchAccountWithLocalSessionCleanup,
  type AccountSwitchCleanupState,
  type AdminAccessState,
} from "./_auth/admin-access-state";
import { formatCompactWon } from "./_dashboard/format-compact-won";
import { waitForAbortablePromise } from "./operations-snapshot-request-coordinator";
import { RevenueCalendar } from "./_dashboard/revenue-calendar";
import { SalesRangeControl } from "./_dashboard/sales-range-control";
import { pollCompetitorResearch } from "./_publishing/competitor-research-polling";
import {
  confirmedProductResearchValue,
  ProductResearchNotFoundError,
  ProductResearchTerminalError,
  shouldClearPendingProductResearch,
} from "./_publishing/product-research-lifecycle";
import { csChannelVerification, csReplyDraftValue, csReplySavePlan, selectedCsTicket, withCsReplyDraft, type CsReplyDrafts } from "./cs-release-state";
import { operationEventNotifications, operationEventState, type OperationEventState } from "./_notifications/operation-event-notifications";
import { toastDurationMs, toastToneForMessage, useToastQueue } from "./_notifications/use-toast-queue";
import {
  isRegistrationActivityRunning,
  recoverableRegistrationActivityJobId,
  registrationActivityDisplayElapsedSeconds,
  registrationActivityMatchesFilter,
  registrationActivityNotificationTransition,
  registrationActivityProgress,
  registrationChannelStatusLabel,
  registrationStatusMeta,
  type RegistrationActivity,
  type RegistrationActivityEventState,
  type RegistrationActivityFilter,
} from "./_registration/registration-status";
import {
  activeStudioJobStorageKey,
  studioJobRecoveryStorageValue,
} from "./_registration/studio-job-session";

const PRODUCT_RESEARCH_PENDING_KEY = "sellerpilot:product-research-pending:v1";
const PRODUCT_RESEARCH_JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PendingProductResearch = { jobId: string; researchInput: string };

function abortableBrowserDelay(ms: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException("요청이 취소되었습니다.", "AbortError"));
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(signal.reason ?? new DOMException("요청이 취소되었습니다.", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

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
  "style-learning": { title: "스타일 학습 검증", description: "6개 문안 카테고리, 9개 설정샷 상품군, 8개 채널의 국가·언어별 제작 규칙을 확인합니다." },
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
  replyDeliveryStatus: OperationTicket["replyDeliveryStatus"];
  replyDeliveryError: string | null;
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

function LoginScreen({
  onLogin,
  onPasswordReset,
  sessionCleanupState,
  onRetrySessionCleanup,
}: {
  onLogin: (email: string, password: string) => Promise<string | null>;
  onPasswordReset: (email: string) => Promise<string | null>;
  sessionCleanupState: AccountSwitchCleanupState;
  onRetrySessionCleanup: () => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const sessionCleanupPending = sessionCleanupState !== "idle";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sessionCleanupPending) return;
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
    if (sessionCleanupPending) return;
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
          <div className="input-wrap"><UserRound size={17} /><input id="email" type="text" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="관리자 아이디 또는 이메일" disabled={sessionCleanupPending} /></div>
          <div className="field-row"><label className="field-label" htmlFor="password">비밀번호</label><button type="button" className="text-button" onClick={() => void requestPasswordReset()} disabled={sessionCleanupPending}>비밀번호 찾기</button></div>
          <div className="input-wrap"><LockKeyhole size={17} /><input id="password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" disabled={sessionCleanupPending} /><button type="button" className="password-toggle" aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"} onClick={() => setShowPassword((current) => !current)} disabled={sessionCleanupPending}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          <div className="remember-row"><span><Check size={12} /></span>이 브라우저에서 로그인 세션 유지</div>
          {sessionCleanupState === "clearing" && <p className="login-error" role="status" aria-live="polite"><LoaderCircle className="spin" size={14} />이전 계정의 로컬 세션을 안전하게 정리하고 있습니다.</p>}
          {sessionCleanupState === "failed" && <p className="login-error" role="alert"><AlertCircle size={14} />이전 계정 세션을 정리하지 못했습니다. 다시 시도해 주세요.</p>}
          {error && <p className="login-error"><AlertCircle size={14} />{error}</p>}
          {sessionCleanupState === "failed"
            ? <button className="login-button" type="button" onClick={onRetrySessionCleanup}><RefreshCw size={18} />세션 정리 다시 시도</button>
            : <button className="login-button" type="submit" disabled={loading || sessionCleanupPending}>{sessionCleanupState === "clearing" ? <><LoaderCircle className="spin" size={18} />이전 계정 정리 중...</> : loading ? <><LoaderCircle className="spin" size={18} />접속 중...</> : <>대시보드 접속<ArrowRight size={18} /></>}</button>}
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

      <RevenueCalendar days={analytics?.daily ?? []} range={salesRange} />

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
            {activeMetrics.map((channel) => <button className="channel-row" key={channel.channelKey} onClick={() => onNavigate(channel.channelKey as View)}><ChannelMark code={channel.channelCode} /><div className="channel-name"><strong>{channel.name}</strong><span className={channel.credentialStatus === "active" ? "connected" : channel.credentialStatus === "unverified" ? "pending" : ""}><i />{credentialConnectionLabel(channel.credentialStatus)}</span></div><div className="channel-metric channel-revenue"><small>선택 기간 매출</small><b>{formatCompactWon(channel.revenue30dKrw)}</b></div><div className="channel-metric channel-orders"><small>실주문</small><b>{channel.orderCount.toLocaleString()}</b></div><div className="channel-progress"><span><i style={{ width: `${channel.credentialStatus === "active" ? 100 : channel.credentialStatus === "unverified" ? 55 : 0}%` }} /></span><b>{channel.failedAttemptCount ? `오류 ${channel.failedAttemptCount}` : "정상"}</b></div><ChevronRight size={16} /></button>)}
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
            <button onClick={() => onNavigate("registration-activity")}><span className="alert-icon warning"><AlertCircle size={16} /></span><span><b>채널 등록 실패 {summary.registrationErrorCount}건</b><small>카테고리·필수 속성·API 응답을 확인하세요.</small></span><em>오류 보기<ChevronRight size={14} /></em></button>
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

type ProductRevisionState = {
  jobId: string;
  productId: string;
  status: "pending" | "applied" | "failed" | "cancelled" | "confirmation_required" | "monitoring_deferred";
  jobStatus: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  error: string | null;
  createdAt: string;
  appliedAt: string | null;
  autoPublish: false;
  remoteSkuOrOptionMutation: false;
  confirmationPending?: boolean;
};

const productRevisionMonitorMaximumAgeMs = 30 * 60 * 1_000;

function parseProductRevisionState(value: unknown): ProductRevisionState | null {
  if (!isRecord(value)
      || typeof value.jobId !== "string"
      || typeof value.productId !== "string"
      || !["pending", "applied", "failed", "cancelled"].includes(String(value.status))
      || !["queued", "running", "succeeded", "failed", "cancelled"].includes(String(value.jobStatus))
      || typeof value.createdAt !== "string") return null;
  return {
    jobId: value.jobId,
    productId: value.productId,
    status: value.status as ProductRevisionState["status"],
    jobStatus: value.jobStatus as ProductRevisionState["jobStatus"],
    error: typeof value.error === "string" ? value.error : null,
    createdAt: value.createdAt,
    appliedAt: typeof value.appliedAt === "string" ? value.appliedAt : null,
    autoPublish: false,
    remoteSkuOrOptionMutation: false,
    confirmationPending: false,
  };
}

function waitForProductRevisionRecovery(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("상품 수정 상태 확인을 중단했습니다.", "AbortError"));
      return;
    }
    let timer = 0;
    const abort = () => {
      window.clearTimeout(timer);
      reject(signal.reason ?? new DOMException("상품 수정 상태 확인을 중단했습니다.", "AbortError"));
    };
    timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function authenticatedJsonWithDeadline<Payload>(
  authenticatedFetch: (input: string, init?: RequestInit) => Promise<Response>,
  input: string,
  init: RequestInit,
  parentSignal: AbortSignal,
  timeoutMs: number,
  fallbackPayload: Payload,
) {
  return fetchJsonWithDeadline({
    fetcher: authenticatedFetch,
    input,
    init,
    parentSignal,
    timeoutMs,
    fallbackPayload,
  });
}

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
type CompetitorMarketplace = "smartstore" | "coupang" | "elevenst" | "qoo10" | "shopee" | "lazada" | "ebay" | "temu" | "other";
type CompetitorProvider = "naver_shopping" | "elevenst_product_search" | "ebay_browse";
type CompetitorResearchItem = CompetitorDisplayItem & { provider: CompetitorProvider; marketplace: CompetitorMarketplace; externalId: string; verifiedSameProduct: true };
type CompetitorProviderDisplayStatus = { provider: CompetitorProvider; status: "searched" | "unavailable" | "failed" | "pending"; count: number; marketplaces: CompetitorMarketplace[] };

function CompetitorPriceSlots({ items, providers = [], state = "ready", compact = false, retryAvailable = false, onRetry }: { items: CompetitorDisplayItem[]; providers?: CompetitorProviderDisplayStatus[]; state?: "loading" | "ready" | "pending" | "unavailable"; compact?: boolean; retryAvailable?: boolean; onRetry?: () => void }) {
  const marketplaceOrder: string[] = [...activeChannelKeys];
  const marketplaceLabels: Record<string, string> = Object.fromEntries(Object.entries(channels).map(([key, channel]) => [key, channel.name]));
  const providerLabels: Record<CompetitorProviderDisplayStatus["provider"], string> = { naver_shopping: "네이버 쇼핑 검색", elevenst_product_search: "11번가 상품검색", ebay_browse: "eBay Browse" };
  marketplaceLabels.other = "기타 판매처";
  const groups = marketplaceOrder.map((marketplace) => ({ marketplace, items: items.filter((item) => (item.marketplace || "other") === marketplace).slice(0, 3) }));
  const otherItems = items.filter((item) => !marketplaceOrder.includes(item.marketplace || "other")).slice(0, 3);
  if (otherItems.length) groups.push({ marketplace: "other", items: otherItems });
  return <div className={`competitor-market-groups ${compact ? "compact" : ""}`}>
    {state === "loading" && <div className="competitor-loading"><LoaderCircle className="spin" size={17} />동일 상품 가격을 채널별로 찾고 있습니다.</div>}
    {state === "pending" && !retryAvailable && <div className="competitor-loading pending"><Clock3 size={17} />공식 채널 조회가 계속 진행 중입니다. 확인된 결과부터 표시합니다.</div>}
    {retryAvailable && onRetry && <div className="competitor-retry" role="status"><span><Clock3 size={17} /><span><b>자동 확인을 마쳤습니다.</b><small>서버 작업이 늦게 끝날 수 있습니다. 같은 검색 조건으로 다시 확인해 주세요.</small></span></span><button type="button" onClick={onRetry}><RefreshCw size={15} />가격 다시 확인</button></div>}
    {providers.length > 0 && <div className="competitor-provider-summary" aria-label="가격 검색 공급자 상태">{providers.map((provider) => <span className={provider.status} key={provider.provider}><b>{providerLabels[provider.provider]}</b>{provider.status === "searched" ? `조회 완료 · 일치 ${provider.count}건` : provider.status === "pending" ? "조회 진행 중" : provider.status === "failed" ? "응답 실패" : "미연결"}</span>)}</div>}
    {groups.map((group) => <section key={group.marketplace}><header><b>{marketplaceLabels[group.marketplace] ?? group.marketplace}</b><small>최대 3개</small></header><div className="competitor-price-grid">{Array.from({ length: 3 }, (_, index) => {
      const item = group.items[index];
      return item ? <a href={item.url} target="_blank" rel="noreferrer" key={item.id}><span>{item.imageUrl ? <Image src={item.imageUrl} alt="" fill sizes="80px" unoptimized /> : <Package size={18} />}</span><div><small>{item.mallName || marketplaceLabels[group.marketplace] || "판매처"}</small><b>{item.title}</b><strong>{new Intl.NumberFormat("ko-KR", { style: "currency", currency: item.currency || "KRW", maximumFractionDigits: 0 }).format(item.price)}</strong></div><ExternalLink size={14} /></a>
        : <div className="competitor-price-empty" key={`${group.marketplace}-empty-${index}`}><span><Search size={16} /></span><div><small>{marketplaceLabels[group.marketplace] ?? "판매처"}</small><b>동일 상품을 찾지 못함</b><strong>—</strong></div></div>;
    })}</div></section>)}
    {state === "unavailable" && <p className="competitor-unavailable"><AlertCircle size={14} />{items.length > 0 ? "새 응답을 확인하지 못해 이전에 확인된 가격을 유지했습니다." : "가격 조회 연결을 확인하지 못했습니다. 상품 등록은 계속할 수 있으며 값은 공란으로 유지됩니다."}</p>}
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
    categoryHint: text("categoryHint", product.name), brandName: text("brandName"),
    manufacturer: text("manufacturer"), countryOfOrigin: text("countryOfOrigin"),
    material: text("material"), packageContents: normalizeProductSaleConfiguration(text("packageContents")),
    condition: productConditions.includes(condition) ? condition : "NEW", gtinStatus: gtinStatus === "HAS_GTIN" ? "HAS_GTIN" : "NO_GTIN", gtin: text("gtin"),
    sellingPrice: number("sellingPrice", 0), currency: productCurrencies.includes(currency) ? currency : "KRW", stock: product.onHand,
    weightKg: number("weightKg"), packageLengthCm: number("packageLengthCm"), packageWidthCm: number("packageWidthCm"), packageHeightCm: number("packageHeightCm"),
    shippingFeeKrw: number("shippingFeeKrw"), shippingRule: text("shippingRule"), packagingRule: text("packagingRule"),
    description: text("description", product.description), productUrl: text("productUrl", product.sourceUrl || ""),
    imageRightsConfirmed: typeof fields.imageRightsConfirmed === "boolean" ? fields.imageRightsConfirmed : false,
    productFactsConfirmed: typeof fields.productFactsConfirmed === "boolean" ? fields.productFactsConfirmed : false,
  };
}

function ProductDetailEditDialog({ draft, errors, saving, revisionPhotoCount, onRevisionPhotosChange, onPhotoError, onChange, onClose, onSave }: {
  draft: ProductIntakeDraft;
  errors: Record<string, string>;
  saving: boolean;
  revisionPhotoCount: number;
  onRevisionPhotosChange: (photos: StudioPhoto[]) => void;
  onPhotoError: (message: string) => void;
  onChange: <Key extends keyof ProductIntakeDraft>(key: Key, value: ProductIntakeDraft[Key]) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return <div className="product-edit-overlay"><section className="product-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="product-edit-title">
    <header><div><span className="panel-kicker">FULL PRODUCT EDIT</span><h2 id="product-edit-title">등록 상품 전체 수정</h2><p>텍스트·가격·재고뿐 아니라 원본·대표·역할별 사진을 교체할 수 있습니다. 사진 수정은 같은 상품 원장에서 AI 상세를 다시 만들며 외부 채널에는 자동 게시하지 않습니다.</p></div><button type="button" aria-label="상품 수정 닫기" onClick={onClose} disabled={saving}><X size={18} /></button></header>
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
      <label><span>판매 구성</span><select value={draft.packageContents} onChange={(event) => onChange("packageContents", event.target.value)}><option value="">구성을 선택하세요</option>{productSaleConfigurations.map((configuration) => <option value={configuration.value} key={configuration.value}>{configuration.label}</option>)}</select></label>
      <label><span>상품 상태</span><select value={draft.condition} onChange={(event) => onChange("condition", event.target.value as ProductIntakeDraft["condition"])}>{productConditions.map((value) => <option value={value} key={value}>{value === "NEW" ? "신품" : value === "USED" ? "중고" : "리퍼브"}</option>)}</select></label>
      <label><span>바코드 상태</span><select value={draft.gtinStatus} onChange={(event) => onChange("gtinStatus", event.target.value as ProductIntakeDraft["gtinStatus"])}><option value="NO_GTIN">GTIN 없음</option><option value="HAS_GTIN">GTIN 있음</option></select></label>
      {draft.gtinStatus === "HAS_GTIN" && <label className={errors.gtin ? "field-error" : ""}><span>GTIN / EAN / UPC</span><input inputMode="numeric" value={draft.gtin} onChange={(event) => onChange("gtin", event.target.value.replace(/\D/g, ""))} />{errors.gtin && <small>{errors.gtin}</small>}</label>}
      <div className="intake-group-heading"><span>03</span><div><b>가격·재고</b><small>가격은 중앙 원장에, 변경된 실재고는 연결 채널에도 반영합니다.</small></div></div>
      <label><span>판매가</span><input type="number" min="0.01" step="0.01" value={draft.sellingPrice} onChange={(event) => onChange("sellingPrice", Number(event.target.value))} /></label>
      <label><span>통화</span><select value={draft.currency} onChange={(event) => onChange("currency", event.target.value as ProductIntakeDraft["currency"])}>{productCurrencies.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label><span>실재고</span><input type="number" min="0" step="1" value={draft.stock} onChange={(event) => onChange("stock", Number(event.target.value))} /></label>
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
      <ProductRevisionImagePicker disabled={saving} onChange={onRevisionPhotosChange} onError={onPhotoError} />
    </div>
    <div className="intake-confirmations"><label><input aria-label="이미지·상품 자료 사용 권한 확인" type="checkbox" checked={draft.imageRightsConfirmed} onChange={(event) => onChange("imageRightsConfirmed", event.target.checked)} /><span><b>이미지·상품 자료 사용 권한</b><small>사용 권한이 있는 자료임을 확인합니다.</small></span></label><label><input aria-label="상품 사실정보 확인" type="checkbox" checked={draft.productFactsConfirmed} onChange={(event) => onChange("productFactsConfirmed", event.target.checked)} /><span><b>상품 사실정보 확인</b><small>수정값이 실물과 일치함을 확인합니다.</small></span></label></div>
    {errors.form && <p className="inventory-editor-message">{errors.form}</p>}
    <footer><button type="button" className="credential-secondary" onClick={onClose} disabled={saving}>취소</button><button type="button" className="publish-execute" onClick={onSave} disabled={saving}>{saving ? <LoaderCircle className="spin" size={15} /> : revisionPhotoCount ? <WandSparkles size={15} /> : <Check size={15} />}{saving ? revisionPhotoCount ? "사진 보정·접수 중" : "등록정보 저장 중" : revisionPhotoCount ? `사진 ${revisionPhotoCount}장으로 리비전 시작` : "등록정보 저장"}</button></footer>
  </section></div>;
}

function ProductDetailPage({ product, onBack, onEditChannels, onOpenActivity, authenticatedFetch, notify, onChanged }: {
  product: DisplayProduct;
  onBack: () => void;
  onEditChannels: () => void;
  onOpenActivity: () => void;
  authenticatedFetch: (input: string, init?: RequestInit) => Promise<Response>;
  notify: (message: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [remoteListings, setRemoteListings] = useState<RemoteListingReference[]>([]);
  const [detailContext, setDetailContext] = useState<ProductDetailContext>(emptyProductDetailContext);
  const [savedDetailPage, setSavedDetailPage] = useState<ProductDetailPageEnvelope | null>(null);
  const [detailPageSource, setDetailPageSource] = useState<ReturnType<typeof parseProductDetailSource>>(null);
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
  const [revisionPhotos, setRevisionPhotos] = useState<StudioPhoto[]>([]);
  const [productRevision, setProductRevision] = useState<ProductRevisionState | null>(null);
  const [displayOverrides, setDisplayOverrides] = useState({ name: product.name, sku: product.sku, description: product.description, sourceUrl: product.sourceUrl });
  const detailRegenerationControllerRef = useRef<AbortController | null>(null);
  const revisionSubmissionControllerRef = useRef<AbortController | null>(null);
  const revisionCompletionAnnouncedRef = useRef(new Set<string>());
  const productDetailLifecycleControllerRef = useRef<AbortController | null>(null);
  const getProductDetailSignal = useCallback(() => {
    const signal = productDetailLifecycleControllerRef.current?.signal;
    if (!signal || signal.aborted) throw new DOMException("상품 상세 화면이 닫혔습니다.", "AbortError");
    return signal;
  }, []);

  useEffect(() => {
    const lifecycleController = new AbortController();
    productDetailLifecycleControllerRef.current = lifecycleController;
    return () => {
      detailRegenerationControllerRef.current?.abort(new DOMException("상품 상세 화면이 닫혔습니다.", "AbortError"));
      detailRegenerationControllerRef.current = null;
      revisionSubmissionControllerRef.current?.abort(new DOMException("상품 상세 화면이 닫혔습니다.", "AbortError"));
      revisionSubmissionControllerRef.current = null;
      lifecycleController.abort(new DOMException("상품 상세 화면이 닫혔습니다.", "AbortError"));
      if (productDetailLifecycleControllerRef.current === lifecycleController) {
        productDetailLifecycleControllerRef.current = null;
      }
    };
  }, [product.sourceId]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void authenticatedJsonWithDeadline<{ revision?: unknown }>(
      authenticatedFetch,
      `/api/admin/products/${product.sourceId}/revision`,
      { cache: "no-store" },
      controller.signal,
      15_000,
      {},
    )
      .then(({ response, payload }) => {
        if (!response.ok) return;
        const revision = parseProductRevisionState(payload.revision);
        if (!cancelled) setProductRevision(revision);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
      controller.abort(new DOMException("상품 리비전 초기 조회를 종료합니다.", "AbortError"));
    };
  }, [authenticatedFetch, product.sourceId]);

  useEffect(() => {
    if (productRevision?.status !== "pending") return;
    const controller = new AbortController();
    const createdAt = Date.parse(productRevision.createdAt);
    const deadline = Number.isFinite(createdAt)
      ? createdAt + productRevisionMonitorMaximumAgeMs
      : Date.now() + productRevisionMonitorMaximumAgeMs;
    let timer = 0;
    let cancelled = false;
    const deferMonitoring = () => {
      if (cancelled) return;
      setProductRevision((current) => current?.jobId === productRevision.jobId && current.status === "pending" ? {
        ...current,
        status: "monitoring_deferred",
        error: "30분 자동 확인 상한에 도달했습니다. 작업은 취소하거나 다시 만들지 않았으며 ‘등록 진행 중·히스토리’에서 같은 작업 ID 상태를 계속 확인할 수 있습니다.",
        confirmationPending: false,
      } : current);
      notify(`작업 ${productRevision.jobId.slice(0, 8)}은 장기 실행 상태라 자동 확인을 종료했습니다. 등록 진행 중·히스토리에서 이어서 확인해 주세요.`);
    };
    const poll = async () => {
      if (Date.now() >= deadline) {
        deferMonitoring();
        return;
      }
      try {
        const { response, payload } = await authenticatedJsonWithDeadline<{ revision?: unknown }>(
          authenticatedFetch,
          `/api/admin/products/${product.sourceId}/revision?jobId=${encodeURIComponent(productRevision.jobId)}`,
          { cache: "no-store" },
          controller.signal,
          15_000,
          {},
        );
        if (!response.ok) throw new Error("상품 리비전 상태를 확인하지 못했습니다.");
        const revision = parseProductRevisionState(payload.revision);
        if (!cancelled && revision?.jobId === productRevision.jobId) {
          setProductRevision(revision);
          if (revision.status === "applied" && !revisionCompletionAnnouncedRef.current.has(revision.jobId)) {
            revisionCompletionAnnouncedRef.current.add(revision.jobId);
            notify("같은 상품 원장에 새 사진과 AI 상세페이지를 적용했습니다. 기존 판매채널 상품은 자동 변경하지 않았습니다.");
            await onChanged();
            return;
          }
          if ((revision.status === "failed" || revision.status === "cancelled") && !revisionCompletionAnnouncedRef.current.has(revision.jobId)) {
            revisionCompletionAnnouncedRef.current.add(revision.jobId);
            notify(revision.error || "사진 수정 작업을 적용하지 못해 기존 상품과 판매채널 연결을 그대로 유지했습니다.");
            return;
          }
        }
      } catch {
        if (controller.signal.aborted) return;
      }
      if (!cancelled) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) deferMonitoring();
        else timer = window.setTimeout(() => void poll(), Math.min(3_000, remainingMs));
      }
    };
    timer = window.setTimeout(() => void poll(), 1_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [authenticatedFetch, notify, onChanged, product.sourceId, productRevision?.createdAt, productRevision?.jobId, productRevision?.status]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const signal = AbortSignal.any([getProductDetailSignal(), controller.signal]);
    void authenticatedJsonWithDeadline<Record<string, unknown>>(
      authenticatedFetch,
      `/api/admin/products/${product.sourceId}/publish-context`,
      { cache: "no-store" },
      signal,
      30_000,
      {},
    )
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error("상품 채널 원격 정보를 불러오지 못했습니다.");
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
          setSavedDetailPage(parseProductDetailPageEnvelope(payload.detailPage));
          setDetailPageSource(parseProductDetailSource(payload.studioResult));
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
          setSavedDetailPage(null);
          setDetailPageSource(null);
          setCommerceOperations(emptyProductCommerceOperations);
          setRemoteListingState("unavailable");
        }
      });
    return () => {
      cancelled = true;
      controller.abort(new DOMException("다른 상품 상세를 불러옵니다.", "AbortError"));
    };
  }, [authenticatedFetch, getProductDetailSignal, product]);

  const setEditField = <Key extends keyof ProductIntakeDraft>(key: Key, value: ProductIntakeDraft[Key]) => {
    setEditDraft((current) => current ? { ...current, [key]: value } : current);
    setEditErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const applyInventoryAcrossSafeBatches = async (onHand: number, stableIdempotencyKey?: string) => {
    const idempotencyKey = stableIdempotencyKey ?? `inventory-ui-${crypto.randomUUID()}`;
    let latestSync: InventorySyncContext | null = null;
    const combinedResults: Array<{ ok: boolean }> = [];
    let latestMessage = "";
    for (let batchIndex = 0; batchIndex < 16; batchIndex += 1) {
      const { response, payload } = await authenticatedJsonWithDeadline<{
        sync?: InventorySyncContext;
        results?: Array<{ ok: boolean }>;
        continuationRequired?: boolean;
        remainingPendingCount?: number;
        message?: string;
      }>(
        authenticatedFetch,
        `/api/admin/products/${product.sourceId}/inventory`,
        {
          method: "POST",
          headers: { "idempotency-key": idempotencyKey },
          body: JSON.stringify({ onHand, confirmWrite: true }),
        },
        getProductDetailSignal(),
        30_000,
        { message: "재고 적용 응답을 읽지 못했습니다." },
      );
      if (!response.ok && response.status !== 207) {
        throw new Error(payload.message ?? "채널 재고 적용에 실패했습니다.");
      }
      if (payload.sync) latestSync = payload.sync;
      if (Array.isArray(payload.results)) combinedResults.push(...payload.results);
      latestMessage = payload.message ?? latestMessage;
      if (!payload.continuationRequired) {
        return { sync: latestSync, results: combinedResults, message: latestMessage };
      }
    }
    throw new Error("안전 배치 한도를 초과해 남은 채널 재고를 자동 재전송하지 않았습니다. 등록 진행 화면에서 기존 작업을 확인해 주세요.");
  };

  const saveProductDetails = async () => {
    if (!editDraft || editSaving) return;
    const parsed = productEditSchema.safeParse(editDraft);
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
      if (revisionPhotos.length > 0) {
        if (revisionPhotos[0]?.role !== "main") throw new Error("새 대표사진을 먼저 선택해 주세요.");
        const controller = new AbortController();
        revisionSubmissionControllerRef.current = controller;
        const sessionSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
        const { data: sessionData } = await waitForAbortablePromise(createSupabaseClient().auth.getSession(), sessionSignal);
        const accessToken = sessionData.session?.access_token;
        const userId = sessionData.session?.user.id;
        if (!accessToken || !userId) throw new Error("상품 사진을 수정하려면 관리자 로그인이 필요합니다.");
        const jobId = crypto.randomUUID();
        const { uploadedPaths: imagePaths, imageSpecs, allUploadedPaths } = await optimizeAndUploadStudioPhotos(
          revisionPhotos,
          userId,
          jobId,
          accessToken,
          controller.signal,
        );
        if (controller.signal.aborted) {
          await cleanupUnenqueuedStudioPhotos(allUploadedPaths).catch(() => undefined);
          throw controller.signal.reason ?? new DOMException("상품 수정 화면이 닫혔습니다.", "AbortError");
        }
        const readExactRevision = async (candidateJobId: string, signal: AbortSignal) => {
          try {
            const { response, payload } = await authenticatedJsonWithDeadline<{ revision?: unknown }>(
              authenticatedFetch,
              `/api/admin/products/${product.sourceId}/revision?jobId=${encodeURIComponent(candidateJobId)}`,
              { cache: "no-store" },
              signal,
              8_000,
              {},
            );
            if (!response.ok) return null;
            return parseProductRevisionState(payload.revision);
          } catch (error) {
            if (signal.aborted) throw error;
            return null;
          }
        };
        let acceptedRevision: ProductRevisionState | null = null;
        let ambiguousSubmission = false;
        let definitiveFailure = "상품 사진 수정 작업을 등록하지 못했습니다.";
        try {
          const { response, payload } = await authenticatedJsonWithDeadline<{
            jobId?: string;
            productId?: string;
            status?: string;
            autoPublish?: boolean;
            message?: string;
          } | null>(
            authenticatedFetch,
            `/api/admin/products/${product.sourceId}/revision`,
            {
              method: "POST",
              cache: "no-store",
              body: JSON.stringify({ jobId, manualFields: parsed.data, imagePaths, imageSpecs }),
            },
            controller.signal,
            90_000,
            null,
          );
          if (response.status === 202 && payload?.jobId === jobId && payload.productId === product.sourceId && payload.autoPublish === false) {
            acceptedRevision = {
              jobId,
              productId: product.sourceId,
              status: "pending",
              jobStatus: "queued",
              error: null,
              createdAt: new Date().toISOString(),
              appliedAt: null,
              autoPublish: false,
              remoteSkuOrOptionMutation: false,
              confirmationPending: false,
            };
          } else if ([408, 425, 429].includes(response.status) || response.status >= 500 || response.ok) {
            ambiguousSubmission = true;
          } else {
            definitiveFailure = payload?.message ?? definitiveFailure;
          }
        } catch (error) {
          if (controller.signal.aborted) throw error;
          ambiguousSubmission = true;
        }

        if (!acceptedRevision && ambiguousSubmission) {
          acceptedRevision = await recoverAmbiguousProductRevision<ProductRevisionState>({
            jobId,
            signal: controller.signal,
            wait: waitForProductRevisionRecovery,
            readState: readExactRevision,
          });
          if (!acceptedRevision) {
            try {
              const { response: cleanupResponse, payload: cleanupPayload } = await authenticatedJsonWithDeadline<{
                abandoned?: boolean;
                message?: string;
              } | null>(
                authenticatedFetch,
                `/api/admin/products/${product.sourceId}/revision`,
                {
                  method: "DELETE",
                  cache: "no-store",
                  body: JSON.stringify({ jobId, imagePaths }),
                },
                controller.signal,
                20_000,
                null,
              );
              if ((cleanupResponse.ok || cleanupResponse.status === 202) && cleanupPayload?.abandoned) {
                const message = `${cleanupPayload.message ?? "서버 미접수를 확정하고 임시 업로드를 정리했습니다."} 같은 사진으로 다시 저장할 수 있습니다. 재고와 판매채널에는 아무 변경도 시작하지 않았습니다.`;
                setEditErrors({ form: message });
                notify(message);
                return;
              }
              if (cleanupResponse.status === 409) acceptedRevision = await readExactRevision(jobId, controller.signal);
            } catch (error) {
              if (controller.signal.aborted) throw error;
            }
            if (!acceptedRevision) {
              setProductRevision({
                jobId,
                productId: product.sourceId,
                status: "confirmation_required",
                jobStatus: "queued",
                error: "서버 응답과 정리 확인이 모두 끊겼습니다. 새 작업을 만들지 말고 화면을 새로고침해 같은 작업 ID 상태를 확인해 주세요.",
                createdAt: new Date().toISOString(),
                appliedAt: null,
                autoPublish: false,
                remoteSkuOrOptionMutation: false,
                confirmationPending: true,
              });
              setEditDraft(parsed.data);
              setEditOpen(false);
              setRevisionPhotos([]);
              notify(`작업 ${jobId.slice(0, 8)}의 접수 여부를 자동 확정하지 못했습니다. 새 작업을 만들지 않도록 중지했으며 새로고침 후 같은 ID를 확인합니다.`);
              return;
            }
          }
        }
        if (!acceptedRevision) throw new Error(definitiveFailure);
        setProductRevision(acceptedRevision);
        if (acceptedRevision.status === "failed" || acceptedRevision.status === "cancelled") {
          setEditOpen(false);
          setRevisionPhotos([]);
          notify(acceptedRevision.error || "사진 수정 작업이 종료되어 기존 상품과 판매채널 연결을 유지했습니다.");
          return;
        }
        let inventoryOutcome = " 재고 수량은 변경하지 않았습니다.";
        let displayedRevisionStock = inventoryOnHand;
        if (parsed.data.stock !== inventoryOnHand) {
          try {
            const inventoryPayload = await applyInventoryAcrossSafeBatches(
              parsed.data.stock,
              `inventory-revision-${jobId}`,
            );
            displayedRevisionStock = parsed.data.stock;
            setInventoryOnHand(parsed.data.stock);
            setInventorySync(inventoryPayload.sync ?? null);
            const failed = inventoryPayload.results.filter((item) => !item.ok).length;
            inventoryOutcome = failed > 0
              ? ` 중앙 재고는 ${parsed.data.stock.toLocaleString()}개로 저장됐고 ${failed}개 채널은 재고 동기화 이력에서 확인이 필요합니다.`
              : ` 중앙 재고 ${parsed.data.stock.toLocaleString()}개와 연결된 판매채널 재고 적용 요청을 확인했습니다.`;
            setInventoryMessage(inventoryOutcome.trim());
          } catch {
            inventoryOutcome = " 사진 리비전 접수는 완료됐지만 재고 적용 응답은 확정하지 못했습니다. 새 재고 쓰기를 추측해 반복하지 말고 아래 재고 동기화 이력을 확인한 뒤 재시도해 주세요.";
            setInventoryMessage(inventoryOutcome.trim());
          }
        }
        setEditDraft({ ...parsed.data, stock: displayedRevisionStock });
        setEditOpen(false);
        setRevisionPhotos([]);
        notify(`${acceptedRevision.status === "applied" ? "같은 상품 ID로 사진·상세페이지 수정을 적용했습니다." : "같은 상품 ID로 사진·상세페이지 수정을 시작했습니다."} 외부 채널 이미지·옵션·SKU는 자동 변경하지 않습니다.${inventoryOutcome}`);
        if (acceptedRevision.status === "applied") await onChanged().catch(() => null);
        return;
      }
      const { response, payload } = await authenticatedJsonWithDeadline<{ message?: string }>(
        authenticatedFetch,
        `/api/admin/products/${product.sourceId}/publish-context`,
        { method: "PATCH", body: JSON.stringify(parsed.data) },
        getProductDetailSignal(),
        30_000,
        { message: "상품 수정 응답을 읽지 못했습니다." },
      );
      if (!response.ok) throw new Error(payload.message ?? "상품 전체 정보를 저장하지 못했습니다.");
      let completionMessage = "상품 등록정보를 중앙 원장에 저장했습니다. ‘채널 상품 수정’에서 지원 채널의 실제 상품에도 적용할 수 있습니다.";
      let displayedStock = inventoryOnHand;
      if (parsed.data.stock !== inventoryOnHand) {
        try {
          const inventoryPayload = await applyInventoryAcrossSafeBatches(parsed.data.stock);
          displayedStock = parsed.data.stock;
          setInventoryOnHand(parsed.data.stock);
          setInventorySync(inventoryPayload.sync ?? null);
          const failed = inventoryPayload.results.filter((item) => !item.ok).length;
          completionMessage = failed > 0
            ? `상품 등록정보와 중앙 재고는 저장됐지만 ${failed}개 채널 재고는 동기화 이력에서 추가 확인이 필요합니다.`
            : "상품 등록정보와 중앙 재고를 저장했고 연결된 판매채널 재고 적용 요청도 확인했습니다. 나머지 변경은 ‘채널 상품 수정’에서 최종 확인 후 적용하세요.";
          setInventoryMessage(completionMessage);
        } catch {
          completionMessage = "상품 등록정보는 중앙 원장에 저장했습니다. 재고 적용 응답은 확정하지 못했으므로 새 쓰기를 추측해 반복하지 말고 아래 재고 동기화 이력을 확인한 뒤 재시도해 주세요.";
          setInventoryMessage(completionMessage);
        }
      }
      setDetailContext((current) => ({ ...current, manualFields: { ...parsed.data, stock: displayedStock } }));
      setDisplayOverrides({ name: parsed.data.productName, sku: parsed.data.sellerSku, description: parsed.data.description, sourceUrl: parsed.data.productUrl || null });
      setEditDraft(parsed.data);
      setEditOpen(false);
      notify(completionMessage);
      await onChanged().catch(() => null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "상품 전체 정보를 저장하지 못했습니다.";
      setEditErrors({ form: message });
      notify(message);
    } finally {
      revisionSubmissionControllerRef.current = null;
      setEditSaving(false);
    }
  };

  useEffect(() => {
    if (!inventorySaving) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([getProductDetailSignal(), controller.signal]);
    let timer = 0;
    const poll = async () => {
      try {
        const { response, payload } = await authenticatedJsonWithDeadline<{ sync?: InventorySyncContext | null }>(
          authenticatedFetch,
          `/api/admin/products/${product.sourceId}/inventory`,
          { cache: "no-store" },
          signal,
          15_000,
          {},
        );
        if (response.ok && payload.sync && !signal.aborted) setInventorySync(payload.sync);
      } catch {
        // The active POST owns the final user-facing outcome. Poll failures are
        // bounded and retried one at a time without spawning concurrent GETs.
      } finally {
        if (!signal.aborted) timer = window.setTimeout(() => void poll(), 1_000);
      }
    };
    timer = window.setTimeout(() => void poll(), 1_000);
    return () => {
      window.clearTimeout(timer);
      controller.abort(new DOMException("재고 저장 확인을 종료합니다.", "AbortError"));
    };
  }, [authenticatedFetch, getProductDetailSignal, inventorySaving, product.sourceId]);

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
    detailRegenerationControllerRef.current?.abort(new DOMException("새 이미지 재제작 요청으로 교체됐습니다.", "AbortError"));
    const controller = new AbortController();
    detailRegenerationControllerRef.current = controller;
    setRegeneratingDetailAsset(assetId);
    setInventoryMessage("");
    let exactRegenerationJobId = "";
    let regenerationMayExist = false;
    try {
      const jobId = crypto.randomUUID();
      exactRegenerationJobId = jobId;
      const regenerationSignal = AbortSignal.any([controller.signal, getProductDetailSignal()]);
      regenerationMayExist = true;
      const { response, payload: queued } = await authenticatedJsonWithDeadline<{ jobId?: string; deduplicated?: boolean; message?: string }>(
        authenticatedFetch,
        "/api/ai/product-studio/regenerate",
        {
          method: "POST",
          body: JSON.stringify({ jobId, sourceJobId: commerceOperations.aiJobId, sourceProductId: product.sourceId, assetId }),
        },
        regenerationSignal,
        30_000,
        { message: "재제작 작업 응답을 읽지 못했습니다." },
      );
      const deduplicatedExistingJob = response.status === 202
        && response.ok
        && queued.deduplicated === true
        && typeof queued.jobId === "string";
      const admission = deduplicatedExistingJob ? "accepted" : classifyExactJobAdmission({
        status: response.status,
        ok: response.ok,
        requestedJobId: jobId,
        returnedJobId: queued.jobId,
      });
      if (admission !== "accepted") {
        if (admission === "rejected") regenerationMayExist = false;
        throw new Error(queued.message ?? "이미지 재제작 작업을 등록하지 못했습니다.");
      }
      const monitoredJobId = deduplicatedExistingJob ? queued.jobId! : jobId;
      exactRegenerationJobId = monitoredJobId;
      const regenerationDeadline = deadlineAfter(30 * 60_000);
      while (deadlineIsActive(regenerationDeadline)) {
        const requestBudgetMs = Math.max(1, Math.min(15_000, deadlineRemaining(regenerationDeadline)));
        const { response: statusResponse, payload: statusPayload } = await authenticatedJsonWithDeadline<{
          status?: string; error?: string | null; message?: string;
          result?: { mode?: string; assetId?: string; generatedImages?: Array<{ id: string; url: string | null }> } | null;
        }>(
          authenticatedFetch,
          `/api/ai/jobs/${monitoredJobId}`,
          { cache: "no-store" },
          regenerationSignal,
          requestBudgetMs,
          { message: "재제작 상태를 읽지 못했습니다." },
        );
        if (!statusResponse.ok) throw new Error(statusPayload.message ?? "재제작 상태를 확인하지 못했습니다.");
        if (statusPayload.status === "succeeded" && statusPayload.result?.mode === "asset-regeneration") {
          const nextUrl = statusPayload.result.generatedImages?.find((asset) => asset.id === assetId)?.url ?? null;
          if (!nextUrl) throw new Error("재제작된 이미지 주소를 확인하지 못했습니다.");
          if (controller.signal.aborted) return;
          setDetailContext((current) => ({ ...current, generatedImages: current.generatedImages.map((asset) => asset.id === assetId ? { ...asset, url: nextUrl } : asset) }));
          setInventoryMessage(`${assetId.replaceAll("-", " ")} 이미지 1장만 교체했습니다.`);
          return;
        }
        if (statusPayload.status === "failed" || statusPayload.status === "cancelled") {
          regenerationMayExist = false;
          throw new Error(statusPayload.error || "이미지 재제작이 완료되지 못했습니다.");
        }
        const delayMs = Math.min(3_000, deadlineRemaining(regenerationDeadline));
        if (delayMs > 0) await abortableBrowserDelay(delayMs, regenerationSignal);
      }
      throw new Error(`이미지 재제작 작업 ${monitoredJobId.slice(0, 8)}이 30분 자동 확인 상한을 넘었습니다. 새 작업을 만들지 말고 등록 진행 중·히스토리에서 기존 작업 상태를 확인해 주세요.`);
    } catch (error) {
      if (!controller.signal.aborted) {
        setInventoryMessage(regenerationMayExist && exactRegenerationJobId
          ? `이미지 재제작 작업 ${exactRegenerationJobId.slice(0, 8)}의 접수·진행 응답을 확정하지 못했습니다. 새 작업을 만들지 말고 등록 진행 중·히스토리에서 같은 작업 ID를 확인해 주세요.`
          : error instanceof Error ? error.message : "이미지 재제작 중 오류가 발생했습니다.");
      }
    } finally {
      if (detailRegenerationControllerRef.current === controller) {
        detailRegenerationControllerRef.current = null;
        if (!controller.signal.aborted) setRegeneratingDetailAsset("");
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const signal = AbortSignal.any([getProductDetailSignal(), controller.signal]);
    void authenticatedJsonWithDeadline<{ sync?: InventorySyncContext | null }>(
      authenticatedFetch,
      `/api/admin/products/${product.sourceId}/inventory`,
      { cache: "no-store" },
      signal,
      15_000,
      {},
    )
      .then(({ response, payload }) => {
        if (!response.ok) return;
        if (!signal.aborted) setInventorySync(payload.sync ?? null);
      })
      .catch(() => null);
    return () => controller.abort(new DOMException("재고 이력 조회를 종료합니다.", "AbortError"));
  }, [authenticatedFetch, getProductDetailSignal, product.sourceId]);

  const applyInventory = async () => {
    if (inventorySaving || !Number.isInteger(inventoryOnHand) || inventoryOnHand < product.reserved) {
      setInventoryMessage(`실재고는 예약 재고 ${product.reserved.toLocaleString()}개 이상이어야 합니다.`);
      return;
    }
    setInventorySaving(true);
    setInventoryMessage("");
    try {
      const payload = await applyInventoryAcrossSafeBatches(inventoryOnHand);
      setInventorySync(payload.sync ?? null);
      const failed = payload.results.filter((item) => !item.ok).length;
      setInventoryMessage(failed ? `중앙 재고는 저장됐고 ${failed}개 채널은 확인이 필요합니다.` : "중앙 재고와 게시된 판매채널 재고를 적용했습니다.");
      setInventoryEditing(false);
    } catch (error) {
      setInventoryMessage(`재고 적용 응답을 확정하지 못했습니다. 새 쓰기를 반복하기 전에 재고 동기화 이력을 확인해 주세요.${error instanceof Error ? ` (${error.message})` : ""}`);
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
  const savedDetailAssetUrls = useMemo(() => {
    const generated = Object.fromEntries(detailContext.generatedImages
      .filter((asset): asset is ProductDetailAsset & { id: string; url: string } => Boolean(asset.id && asset.url))
      .map((asset) => [asset.id, asset.url]));
    const firstSource = detailContext.sourceImages.find((asset) => asset.url)?.url ?? "";
    return {
      ...(firstSource ? { "source-primary": firstSource } : {}),
      ...generated,
      ...(!generated.hero && firstSource ? { hero: firstSource } : {}),
    };
  }, [detailContext.generatedImages, detailContext.sourceImages]);

  return (
    <div className="page-stack product-detail-page">
      <div className="product-detail-actions">
        <button type="button" className="product-detail-back" onClick={onBack}><ArrowLeft size={16} />상품 목록으로</button>
        <div><span><Clock3 size={14} />최근 수정 {formatProductUpdatedAt(product.updatedAt)}</span><button type="button" className="credential-secondary" onClick={onEditChannels}><RefreshCw size={15} />채널 상품 수정</button><button type="button" className="publish-execute" disabled={productRevision?.status === "pending" || productRevision?.status === "confirmation_required"} onClick={() => { setEditErrors({}); setRevisionPhotos([]); setEditDraft((current) => current ?? productEditDraft(product, detailContext.manualFields)); setEditOpen(true); }}>{productRevision?.status === "pending" ? <LoaderCircle className="spin" size={15} /> : <PencilRuler size={15} />}{productRevision?.status === "pending" ? "사진 수정 진행 중" : productRevision?.status === "confirmation_required" ? "접수 확인 필요" : "상품 전체 수정"}</button></div>
      </div>

      {productRevision ? <section className={`product-revision-status ${productRevision.status}`} role="status">
        <span>{productRevision.status === "pending" ? <LoaderCircle className="spin" size={18} /> : productRevision.status === "applied" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}</span>
        <div><b>{productRevision.status === "confirmation_required" ? "상품 수정 접수 확인이 필요합니다" : productRevision.status === "monitoring_deferred" ? "장기 작업 확인을 등록 진행 화면으로 넘겼습니다" : productRevision.status === "pending" ? "새 사진·AI 상세페이지를 만드는 중입니다" : productRevision.status === "applied" ? "상품 사진 리비전을 적용했습니다" : "상품 사진 리비전을 적용하지 못했습니다"}</b><small>{productRevision.status === "confirmation_required" || productRevision.status === "monitoring_deferred" ? productRevision.error : productRevision.status === "pending" ? "같은 상품 ID와 판매채널 연결을 유지한 채 완료 시 원자적으로 교체합니다." : productRevision.status === "applied" ? "중앙 상품만 교체했으며 판매채널 이미지·옵션·원격 SKU는 변경하지 않았습니다." : productRevision.error || "기존 상품 사진과 판매채널 연결을 그대로 유지했습니다."}</small><em>작업 {productRevision.jobId.slice(0, 8)} · 외부 자동 게시 없음</em></div>
        {(productRevision.status === "monitoring_deferred" || productRevision.status === "confirmation_required") ? <button type="button" className="credential-secondary" onClick={onOpenActivity}>등록 진행에서 확인</button> : null}
      </section> : null}

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
        {remoteListingState === "loading" ? <div className="product-detail-empty compact"><LoaderCircle className="spin" size={22} /><b>상세페이지 결과를 불러오는 중입니다.</b></div> : detailAssets.length > 0 ? <div className="product-detail-asset-grid">{detailAssets.map((asset, index) => <figure key={`${asset.id ?? asset.path}-${index}`}><div><ProductVisual src={asset.url} size="(max-width: 720px) 44vw, 280px" alt={`${product.name} ${asset.id ?? `상품 이미지 ${index + 1}`}`} /></div><figcaption><span>{asset.id?.replaceAll("-", " ") ?? `원본 이미지 ${index + 1}`}</span>{asset.id && commerceOperations.aiJobId ? <button type="button" onClick={() => void regenerateDetailAsset(asset.id!)} disabled={Boolean(regeneratingDetailAsset)}>{regeneratingDetailAsset === asset.id ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}이 이미지만 재제작</button> : null}</figcaption></figure>)}</div> : <div className="product-detail-empty compact"><ImagePlus size={24} /><b>저장된 상세 이미지가 없습니다.</b><small>기존 텍스트 상품이거나 이미지 생성 결과가 상품 원장에 연결되지 않은 상태입니다.</small></div>}
      </section>

      {remoteListingState === "ready" ? <SavedProductDetailPage key={product.sourceId} productId={product.sourceId} source={detailPageSource} initialDetailPage={savedDetailPage} assetUrls={savedDetailAssetUrls} authenticatedFetch={authenticatedFetch} notify={notify} /> : null}

      {editOpen && editDraft && <ProductDetailEditDialog draft={editDraft} errors={editErrors} saving={editSaving} revisionPhotoCount={revisionPhotos.length} onRevisionPhotosChange={setRevisionPhotos} onPhotoError={(message) => { setEditErrors((current) => ({ ...current, form: message })); notify(message); }} onChange={setEditField} onClose={() => { if (!editSaving) { setEditOpen(false); setRevisionPhotos([]); } }} onSave={() => void saveProductDetails()} />}

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

function formatRegistrationDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  if (safeSeconds < 60) return `${safeSeconds}초`;
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  if (minutes < 60) return `${minutes}분 ${remainingSeconds}초`;
  const hours = Math.floor(minutes / 60);
  return `${hours}시간 ${minutes % 60}분`;
}

function RegistrationActivityPage({ activities, activityState, displayProducts, loading, onRefresh, onOpenProduct, onRetryProduct, onRecoverAnalysis, onNewProduct, onExternalActions }: {
  activities: OperationsSnapshot["registrationActivities"];
  activityState: NonNullable<OperationsSnapshot["registrationActivityState"]>;
  displayProducts: DisplayProduct[];
  loading: boolean;
  onRefresh: () => Promise<void>;
  onOpenProduct: (product: DisplayProduct) => void;
  onRetryProduct: (product: DisplayProduct) => void;
  onRecoverAnalysis: (activity: RegistrationActivity) => Promise<void>;
  onNewProduct: () => void;
  onExternalActions: () => void;
}) {
  const [filter, setFilter] = useState<RegistrationActivityFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [recoveringActivityId, setRecoveringActivityId] = useState("");
  const productMap = useMemo(() => new Map(displayProducts.map((product) => [product.sourceId, product])), [displayProducts]);
  const filtered = activities.filter((activity) => registrationActivityMatchesFilter(activity, filter));
  const counts = {
    active: activities.filter((item) => isRegistrationActivityRunning(item.status)).length,
    ready: activities.filter((item) => item.status === "ready").length,
    completed: activities.filter((item) => item.status === "completed").length,
    attention: activities.filter((item) => ["failed", "blocked"].includes(item.status)).length,
  };

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await onRefresh(); } finally { setRefreshing(false); }
  };

  const recoverAnalysis = async (activity: RegistrationActivity) => {
    if (recoveringActivityId) return;
    setRecoveringActivityId(activity.id);
    try { await onRecoverAnalysis(activity); } finally { setRecoveringActivityId(""); }
  };

  return <div className="page-stack registration-activity-page">
    <section className="registration-activity-hero">
      <div><span className="eyebrow dark"><Activity size={14} /> LIVE REGISTRATION LEDGER</span><h2>여러 상품의 등록을 동시에 확인하세요.</h2><p>AI 분석 시작부터 채널별 완료·거절까지 운영 원장 기준의 상태와 실제 경과 시간을 표시합니다.</p></div>
      <span><button type="button" className="credential-secondary" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}새로고침</button><button type="button" className="primary-button" onClick={onNewProduct}><Plus size={15} />다른 상품 등록</button></span>
    </section>
    <section className="registration-filter-strip" aria-label="등록 상태 필터">
      {([
        ["all", "전체", activities.length],
        ["active", "현재 처리 중", counts.active],
        ["ready", "등록 준비", counts.ready],
        ["completed", "완료", counts.completed],
        ["attention", "거절 · 확인 필요", counts.attention],
      ] as const).map(([value, label, count]) => <button type="button" className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}><span>{label}</span><b>{count}</b></button>)}
    </section>
    {activityState === "unavailable" ? <section className="panel registration-empty" role="alert"><AlertCircle size={28} /><b>등록 진행 이력을 불러오지 못했습니다.</b><small>다른 운영 데이터와 기존 알림 기준은 유지했습니다. 잠시 후 다시 확인하거나 직접 재시도해 주세요.</small><button type="button" className="credential-secondary" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{refreshing ? "다시 확인 중" : "등록 이력 다시 확인"}</button></section>
      : loading && activities.length === 0 ? <section className="panel registration-empty"><LoaderCircle className="spin" size={28} /><b>등록 이력을 불러오는 중입니다.</b></section>
      : filtered.length > 0 ? <section className="registration-card-grid">{filtered.map((activity) => {
        const status = registrationStatusMeta[activity.status];
        const product = activity.productId ? productMap.get(activity.productId) : undefined;
        const recoveryJobId = recoverableRegistrationActivityJobId(activity);
        const isActive = isRegistrationActivityRunning(activity.status);
        const isImageOperation = activity.id.startsWith("revision:") || activity.id.startsWith("asset:");
        const elapsedLabel = isActive ? "현재 경과시간" : isImageOperation ? "총 처리시간" : activity.status === "ready" ? "총 분석시간" : "총 등록시간";
        const progress = registrationActivityProgress(activity);
        const statusDetail = isImageOperation
          ? activity.status === "completed" ? "중앙 상품 이미지 작업이 완료되었습니다."
            : activity.status === "failed" ? "기존 상품과 판매채널 연결을 유지했습니다."
              : "AI 이미지 작업을 처리 중입니다."
          : status.detail;
        return <article className={`panel registration-card ${activity.status}`} key={activity.id}>
          <header><span className={`registration-status ${activity.status}`}>{isActive ? <LoaderCircle className="spin" size={14} /> : activity.status === "ready" ? <Clock3 size={14} /> : activity.status === "completed" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}{status.label}</span><small>{relativeTime(activity.updatedAt)}</small></header>
          <div className="registration-product"><div>{product ? <ProductVisual src={product.image} size="(max-width: 720px) 44vw, 96px" alt={activity.productName} /> : <Package size={25} />}</div><span><h3>{activity.productName}</h3><p>{activity.sku || activity.productCode || "상품 코드 생성 중"}</p></span></div>
          <div className={`registration-progress ${progress.percent === null ? "indeterminate" : ""}`}><span role="progressbar" aria-label={`${activity.productName} 등록 진행률`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent ?? undefined} aria-busy={progress.percent === null}><i style={progress.percent === null ? undefined : { width: `${progress.percent}%` }} /></span><small>{recoveryJobId ? "저장된 사진·입력으로 동일한 AI 분석을 다시 시작할 수 있습니다." : statusDetail} {progress.label}</small></div>
          <dl><div><dt>시작</dt><dd>{new Date(activity.startedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}</dd></div><div><dt>{elapsedLabel}</dt><dd>{formatRegistrationDuration(registrationActivityDisplayElapsedSeconds(activity))}</dd></div></dl>
          <div className="registration-channel-summary"><span>채널 {activity.channelCount}</span><b className="success">완료 {activity.publishedCount}</b><b className="danger">오류 {activity.failedCount}</b><b className="warning">권한 {activity.blockedCount}</b></div>
          {activity.channels.length > 0 && <div className="registration-channel-list">{activity.channels.slice(0, 8).map((channel) => <span className={channel.status} key={`${activity.id}-${channel.channel}-${channel.market}`} title={channel.message}><ChannelMark code={channel.channelCode} size="sm" /><i>{registrationChannelStatusLabel(channel.status)}</i></span>)}</div>}
          {activity.message && <p className="registration-message">{activity.message}</p>}
          <footer>{activity.status === "blocked" && <button type="button" className="credential-secondary" onClick={onExternalActions}>외부 조치 확인</button>}{activity.status === "failed" && product && activity.id.startsWith("product:") && <button type="button" className="credential-secondary" onClick={() => onRetryProduct(product)}><RefreshCw size={14} />등록 재시도</button>}{recoveryJobId && <button type="button" className="credential-secondary" onClick={() => void recoverAnalysis(activity)} disabled={Boolean(recoveringActivityId)}>{recoveringActivityId === activity.id ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />}{recoveringActivityId === activity.id ? "기존 작업 재개 중" : "기존 입력으로 AI 분석 재개"}</button>}{product ? <button type="button" className="ghost-button" onClick={() => onOpenProduct(product)}>상품 상세<ChevronRight size={14} /></button> : !recoveryJobId ? <span /> : null}</footer>
        </article>;
      })}</section> : <section className="panel registration-empty"><PackageCheck size={30} /><b>선택한 상태의 상품이 없습니다.</b><small>새 상품 등록을 시작하면 상품 한 개당 카드 한 개로 표시됩니다.</small><button type="button" className="primary-button" onClick={onNewProduct}><Plus size={15} />첫 상품 등록</button></section>}
  </div>;
}

function PublishingPage({ notify, channelMetrics, pipeline, authenticatedFetch, initialProduct, onStartAnother, onShowHistory }: { notify: (message: string) => void; channelMetrics: OperationsSnapshot["channelMetrics"]; pipeline: OperationsSnapshot["pipeline"] | null; authenticatedFetch: (input: string, init?: RequestInit) => Promise<Response>; initialProduct?: { id: string; name: string } | null; onStartAnother: () => void; onShowHistory: () => void }) {
  const [running, setRunning] = useState(false);
  const automationStartInFlightRef = useRef(false);
  const [mainPhoto, setMainPhoto] = useState<UploadedPhoto | null>(null);
  const [slotPhotos, setSlotPhotos] = useState<Record<string, UploadedPhoto>>({});
  const [extraPhotos, setExtraPhotos] = useState<UploadedPhoto[]>([]);
  const [extraPhotosProcessing, setExtraPhotosProcessing] = useState(false);
  const photoObjectUrlsRef = useRef(new Set<string>());
  const publishingMountedRef = useRef(true);
  const extraPhotoBatchRef = useRef(false);
  const pendingNewSlotPhotoRef = useRef(new Set<string>());
  const [photoSelectionFence] = useState(createRevisionPhotoSelectionFence);
  const competitorResearchControllerRef = useRef<AbortController | null>(null);
  const productResearchControllerRef = useRef<AbortController | null>(null);
  const productResearchGenerationRef = useRef(0);
  const [intake, setIntake] = useState<ProductIntakeDraft>(() => ({ ...emptyProductIntake }));
  const [manualErrors, setManualErrors] = useState<Record<string, string>>({});
  const [uploadError, setUploadError] = useState("");
  const [researchingProduct, setResearchingProduct] = useState(false);
  const [researchResult, setResearchResult] = useState<ProductResearchResult | null>(null);
  const [researchCompetitors, setResearchCompetitors] = useState<CompetitorResearchItem[]>([]);
  const [competitorProviders, setCompetitorProviders] = useState<CompetitorProviderDisplayStatus[]>([]);
  const [competitorResearchState, setCompetitorResearchState] = useState<"idle" | "loading" | "ready" | "pending" | "unavailable">("idle");
  const [competitorResearchRetryInput, setCompetitorResearchRetryInput] = useState("");
  const [competitorResearchRetryAvailable, setCompetitorResearchRetryAvailable] = useState(false);
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
  const studioCompetitorContext = useMemo<StudioCompetitorContext>(() => ({
    query: (competitorResearchRetryInput || intake.productName || intake.researchInput).trim().slice(0, 160),
    providerStatuses: competitorProviders.slice(0, 3).map((provider) => ({
      provider: provider.provider,
      status: provider.status,
      count: provider.count,
      marketplaces: provider.marketplaces,
    })),
    candidates: researchCompetitors.filter((item) => item.verifiedSameProduct).slice(0, 24).flatMap((item) => {
      const url = canonicalizeStudioCompetitorUrl(item);
      if (!url) return [];
      return [{
        provider: item.provider,
        marketplace: item.marketplace,
        externalId: item.externalId,
        title: item.title,
        url,
        mallName: item.mallName,
        price: item.price,
        currency: item.currency,
        verifiedSameProduct: true as const,
      }];
    }),
  }), [competitorProviders, competitorResearchRetryInput, intake.productName, intake.researchInput, researchCompetitors]);

  const releasePhotoUrl = useCallback((url: string) => {
    if (!photoObjectUrlsRef.current.delete(url)) return;
    URL.revokeObjectURL(url);
  }, []);

  useEffect(() => {
    publishingMountedRef.current = true;
    photoSelectionFence.mount();
    const objectUrls = photoObjectUrlsRef.current;
    return () => {
      publishingMountedRef.current = false;
      competitorResearchControllerRef.current?.abort();
      productResearchControllerRef.current?.abort();
      productResearchGenerationRef.current += 1;
      photoSelectionFence.unmount();
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls.clear();
    };
  }, [photoSelectionFence]);

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
    assertStudioSourceFile(file);
    const url = URL.createObjectURL(file);
    photoObjectUrlsRef.current.add(url);
    try {
      const image = new window.Image();
      const dimensions = await withPromiseTimeout(new Promise<{ width: number; height: number }>((resolve, reject) => {
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
        image.src = url;
      }), 15_000, "모바일에서 이미지를 읽는 시간이 너무 오래 걸렸습니다. 사진을 다시 선택해 주세요.").finally(() => {
        image.onload = null;
        image.onerror = null;
      });
      assertStudioSourceDimensions(dimensions.width, dimensions.height);
      if (!publishingMountedRef.current) throw new Error("상품 등록 화면이 닫혀 이미지 처리를 중단했습니다.");
      return { name: file.name, url, file, role, originalWidth: dimensions.width, originalHeight: dimensions.height };
    } catch (error) {
      releasePhotoUrl(url);
      throw error;
    }
  };

  const selectMainPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    preservePublishingCaptureContext();
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    const token = photoSelectionFence.nextMain();
    try {
      const photo = await toPhoto(file, "main");
      if (releaseStaleRevisionPhoto(photoSelectionFence.isCurrent(token), photo.url, releasePhotoUrl)) return;
      setMainPhoto((current) => {
        if (current) releasePhotoUrl(current.url);
        return photo;
      });
      setUploadError("");
    } catch (error) {
      if (!photoSelectionFence.isCurrent(token)) return;
      const message = error instanceof Error ? error.message : "대표사진을 확인해 주세요.";
      setUploadError(message);
      notify(message);
    }
  };

  const waitForProductResearch = async (jobId: string, accessToken: string, signal: AbortSignal) => {
    const deadline = Date.now() + 20 * 60_000;
    let consecutiveFailures = 0;
    while (Date.now() < deadline) {
      if (signal.aborted) throw signal.reason ?? new DOMException("상품정보 확인이 취소되었습니다.", "AbortError");
      let response: Response;
      try {
        response = await fetch(`/api/ai/jobs/${jobId}`, {
          headers: { authorization: `Bearer ${accessToken}` },
          cache: "no-store",
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        });
        consecutiveFailures = 0;
      } catch {
        if (signal.aborted) throw signal.reason ?? new DOMException("상품정보 확인이 취소되었습니다.", "AbortError");
        consecutiveFailures += 1;
        if (consecutiveFailures >= 5) throw new Error("모바일 네트워크에서 상품정보 상태를 5회 연속 확인하지 못했습니다. 같은 입력으로 ‘1차 자동생성’을 다시 눌러 기존 작업을 확인해 주세요.");
        await abortableBrowserDelay(2_000, signal);
        continue;
      }
      const payload = await response.json().catch(() => ({ message: "CLI 상품정보 상태를 읽지 못했습니다." })) as {
        status?: "queued" | "running" | "succeeded" | "failed" | "cancelled";
        result?: ProductResearchResult | null;
        error?: string | null;
        message?: string;
      };
      if (response.status === 404) throw new ProductResearchNotFoundError();
      if (!response.ok) throw new Error(payload.message ?? "CLI 상품정보 작업 상태를 확인하지 못했습니다.");
      if (payload.status === "succeeded") {
        if (payload.result?.mode === "cli-research") return payload.result;
        throw new ProductResearchTerminalError("완료된 상품정보 작업의 결과 형식을 확인하지 못했습니다. 새 작업으로 다시 시도해 주세요.");
      }
      if (payload.status === "failed" || payload.status === "cancelled") {
        throw new ProductResearchTerminalError(payload.error);
      }
      await abortableBrowserDelay(3_000, signal);
    }
    throw new Error("CLI 상품정보 수집 대기시간이 20분을 초과했습니다.");
  };

  const runCompetitorResearchPolling = (
    input: string,
    initialSnapshot: { items: typeof researchCompetitors; providers: CompetitorProviderDisplayStatus[] },
  ) => {
    if (!publishingMountedRef.current) return;
    competitorResearchControllerRef.current?.abort();
    const competitorController = new AbortController();
    competitorResearchControllerRef.current = competitorController;
    setCompetitorResearchRetryInput(input);
    setCompetitorResearchRetryAvailable(false);
    setCompetitorResearchState("loading");
    void pollCompetitorResearch<(typeof researchCompetitors)[number], CompetitorProviderDisplayStatus>({
      fetcher: authenticatedFetch,
      input,
      signal: competitorController.signal,
      initialSnapshot,
      maxAttempts: 3,
      delayMs: 1_500,
      onSnapshot: (snapshot) => {
        if (!publishingMountedRef.current
            || competitorController.signal.aborted
            || competitorResearchControllerRef.current !== competitorController) return;
        setResearchCompetitors(snapshot.items);
        setCompetitorProviders(snapshot.providers);
        setCompetitorResearchState(snapshot.state);
        setCompetitorResearchRetryAvailable(snapshot.retryAvailable);
      },
    }).catch((error) => {
      if (competitorController.signal.aborted
          || !publishingMountedRef.current
          || competitorResearchControllerRef.current !== competitorController
          || (error instanceof Error && error.name === "AbortError")) return;
      setCompetitorResearchState("unavailable");
      setCompetitorResearchRetryAvailable(true);
    }).finally(() => {
      if (competitorResearchControllerRef.current === competitorController) competitorResearchControllerRef.current = null;
    });
  };

  const retryCompetitorResearch = () => {
    if (!competitorResearchRetryInput) return;
    notify("같은 검색 조건으로 동일 상품 가격을 다시 확인합니다.");
    runCompetitorResearchPolling(competitorResearchRetryInput, {
      items: researchCompetitors,
      providers: competitorProviders,
    });
  };

  const cancelProductResearch = () => {
    if (!productResearchControllerRef.current) return;
    productResearchGenerationRef.current += 1;
    productResearchControllerRef.current.abort(new DOMException("사용자가 상품정보 확인을 중단했습니다.", "AbortError"));
    productResearchControllerRef.current = null;
    setResearchingProduct(false);
    notify("화면의 상품정보 확인을 중단했습니다. 서버 작업은 유지되며 같은 입력으로 다시 확인할 수 있습니다.");
  };

  const researchProductInformation = async () => {
    const researchInput = intake.researchInput.trim();
    if (researchingProduct || researchInput.length < 2) {
      if (!researchingProduct) notify("상품 판매페이지 링크, 모델명 또는 설명을 입력해 주세요.");
      return;
    }
    productResearchControllerRef.current?.abort();
    const productResearchController = new AbortController();
    const productResearchGeneration = productResearchGenerationRef.current + 1;
    productResearchGenerationRef.current = productResearchGeneration;
    productResearchControllerRef.current = productResearchController;
    competitorResearchControllerRef.current?.abort();
    competitorResearchControllerRef.current = null;
    setResearchCompetitors([]);
    setCompetitorProviders([]);
    setCompetitorResearchState("idle");
    setCompetitorResearchRetryInput("");
    setCompetitorResearchRetryAvailable(false);
    setResearchingProduct(true);
    setUploadError("");
    try {
      const sessionSignal = AbortSignal.any([productResearchController.signal, AbortSignal.timeout(15_000)]);
      const { data: sessionData } = await waitForAbortablePromise(createSupabaseClient().auth.getSession(), sessionSignal);
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("CLI 상품정보 수집을 실행하려면 관리자 로그인이 필요합니다.");
      if (productResearchController.signal.aborted) throw productResearchController.signal.reason;
      let pendingResearch: PendingProductResearch | null = null;
      try {
        const stored = JSON.parse(window.sessionStorage.getItem(PRODUCT_RESEARCH_PENDING_KEY) ?? "null") as unknown;
        if (isRecord(stored)
            && typeof stored.jobId === "string"
            && PRODUCT_RESEARCH_JOB_ID_PATTERN.test(stored.jobId)
            && stored.researchInput === researchInput) {
          pendingResearch = { jobId: stored.jobId, researchInput };
        }
      } catch {
        window.sessionStorage.removeItem(PRODUCT_RESEARCH_PENDING_KEY);
      }
      const jobId = pendingResearch?.jobId ?? crypto.randomUUID();
      window.sessionStorage.setItem(PRODUCT_RESEARCH_PENDING_KEY, JSON.stringify({ jobId, researchInput } satisfies PendingProductResearch));
      if (pendingResearch) {
        notify("이전에 접수한 상품정보 작업 상태를 다시 확인합니다.");
      } else {
        let response: Response | null = null;
        try {
          response = await fetch("/api/ai/product-research", {
            method: "POST",
            cache: "no-store",
            signal: AbortSignal.any([productResearchController.signal, AbortSignal.timeout(30_000)]),
            headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({ jobId, researchInput }),
          });
        } catch {
          if (productResearchController.signal.aborted) throw productResearchController.signal.reason;
        }
        if (response) {
          const queued = await response.json().catch(() => ({ message: "CLI 상품정보 요청 응답을 읽지 못했습니다." })) as { jobId?: string; message?: string };
          if (response.status < 500 && (!response.ok || queued.jobId !== jobId)) {
            window.sessionStorage.removeItem(PRODUCT_RESEARCH_PENDING_KEY);
            throw new Error(queued.message || "CLI 상품정보 수집 작업을 등록하지 못했습니다.");
          }
        }
        notify("ChatGPT CLI가 링크 본문과 입력 텍스트에서 상세 상품정보를 조사하고 있습니다.");
      }
      const result = await waitForProductResearch(jobId, accessToken, productResearchController.signal);
      window.sessionStorage.removeItem(PRODUCT_RESEARCH_PENDING_KEY);
      if (!publishingMountedRef.current
          || productResearchController.signal.aborted
          || productResearchGenerationRef.current !== productResearchGeneration) return;
      const suggestion = result.suggestedFields;
      const firstReadableSource = result.sources.find((source) => source.status === "read")?.url ?? "";
      setIntake((current) => ({
        ...current,
        productName: current.productName.trim() || suggestion.productName || "",
        sellerSku: current.sellerSku.trim() || `AUTO-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        categoryHint: current.categoryHint.trim() || suggestion.categoryHint || "",
        brandName: current.brandName.trim() || confirmedProductResearchValue(suggestion.brandName),
        manufacturer: current.manufacturer.trim() || confirmedProductResearchValue(suggestion.manufacturer),
        countryOfOrigin: current.countryOfOrigin.trim() || confirmedProductResearchValue(suggestion.countryOfOrigin),
        material: current.material.trim() || confirmedProductResearchValue(suggestion.material),
        packageContents: current.packageContents.trim() || normalizeProductSaleConfiguration(suggestion.packageContents),
        description: current.description.trim() || confirmedProductResearchValue(suggestion.description),
        productUrl: current.productUrl.trim() || firstReadableSource,
        gtinStatus: current.gtin || !suggestion.gtin ? current.gtinStatus : "HAS_GTIN",
        gtin: current.gtin || suggestion.gtin || "",
        sellingPrice: current.sellingPrice,
        stock: current.stock,
        weightKg: current.weightKg,
        packageLengthCm: current.packageLengthCm,
        packageWidthCm: current.packageWidthCm,
        packageHeightCm: current.packageHeightCm,
        shippingFeeKrw: current.shippingFeeKrw,
        shippingRule: current.shippingRule,
        packagingRule: current.packagingRule,
      }));
      setResearchResult(result);
      const competitorQuery = suggestion.productName || intake.productName || researchInput;
      const competitorParams = new URLSearchParams({ query: competitorQuery.slice(0, 500) });
      for (const searchQuery of result.searchQueries) competitorParams.append("alias", searchQuery.query.slice(0, 160));
      runCompetitorResearchPolling(
        `/api/admin/competitor-prices?${competitorParams.toString()}`,
        { items: [], providers: [] },
      );
      setFirstDraftGenerated(true);
      setManualErrors({});
      notify("1차 자동생성 초안을 만들었습니다. 확인되지 않은 값은 공란으로 유지했습니다. 실물 기준 필수값을 입력해 주세요.");
    } catch (error) {
      if (shouldClearPendingProductResearch(error)) {
        window.sessionStorage.removeItem(PRODUCT_RESEARCH_PENDING_KEY);
      }
      if (productResearchController.signal.aborted
          || productResearchGenerationRef.current !== productResearchGeneration
          || !publishingMountedRef.current) return;
      const message = error instanceof Error ? error.message : "CLI 상품정보 수집 중 오류가 발생했습니다.";
      setUploadError(message);
      notify(message);
    } finally {
      if (productResearchControllerRef.current === productResearchController) {
        productResearchControllerRef.current = null;
      }
      if (publishingMountedRef.current && productResearchGenerationRef.current === productResearchGeneration) {
        setResearchingProduct(false);
      }
    }
  };

  const selectSlotPhoto = async (slotId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    preservePublishingCaptureContext();
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    if (extraPhotoBatchRef.current) {
      notify("추가 사진 확인이 끝난 뒤 역할별 사진을 선택해 주세요.");
      return;
    }
    const reservesNewSlot = !slotPhotos[slotId];
    const currentPhotoCount = (mainPhoto ? 1 : 0) + Object.keys(slotPhotos).length + extraPhotos.length;
    if (reservesNewSlot && currentPhotoCount + pendingNewSlotPhotoRef.current.size >= 100) {
      notify("한 상품은 분석용 사진을 최대 100장까지 등록할 수 있습니다.");
      return;
    }
    if (reservesNewSlot) pendingNewSlotPhotoRef.current.add(slotId);
    const token = photoSelectionFence.nextRole(slotId);
    try {
      const photo = await toPhoto(file, slotId);
      if (releaseStaleRevisionPhoto(photoSelectionFence.isCurrent(token), photo.url, releasePhotoUrl)) return;
      setSlotPhotos((current) => {
        if (current[slotId]) releasePhotoUrl(current[slotId].url);
        return { ...current, [slotId]: photo };
      });
      setUploadError("");
    } catch (error) {
      if (!photoSelectionFence.isCurrent(token)) return;
      const message = error instanceof Error ? error.message : "옵션 사진을 확인해 주세요.";
      setUploadError(message);
      notify(message);
    } finally {
      if (reservesNewSlot) pendingNewSlotPhotoRef.current.delete(slotId);
    }
  };

  const selectExtraPhotos = async (event: React.ChangeEvent<HTMLInputElement>) => {
    preservePublishingCaptureContext();
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    event.target.value = "";
    if (extraPhotoBatchRef.current) {
      notify("선택한 사진을 확인하고 있습니다. 완료된 뒤 다음 사진을 추가해 주세요.");
      return;
    }
    if (pendingNewSlotPhotoRef.current.size) {
      notify("역할별 사진 확인이 끝난 뒤 추가 사진을 선택해 주세요.");
      return;
    }
    const remaining = Math.max(0, 100 - ((mainPhoto ? 1 : 0) + Object.keys(slotPhotos).length + extraPhotos.length));
    if (!remaining) return notify("한 상품은 분석용 사진을 최대 100장까지 등록할 수 있습니다.");
    const selected = files.slice(0, remaining);
    const token = photoSelectionFence.nextExtras();
    extraPhotoBatchRef.current = true;
    setExtraPhotosProcessing(true);
    try {
      const settled = await settleWithConcurrency(selected, 3, (file, index) => {
        if (!photoSelectionFence.isCurrent(token)) throw new DOMException("이전 추가 사진 선택을 중단했습니다.", "AbortError");
        return toPhoto(file, `extra-${extraPhotos.length + index + 1}`);
      });
      const accepted = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      const firstFailure = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (!photoSelectionFence.isCurrent(token)) {
        for (const photo of accepted) releasePhotoUrl(photo.url);
        return;
      }
      if (accepted.length) setExtraPhotos((current) => {
        const next = [...current, ...accepted];
        const capacity = Math.max(0, 100 - (mainPhoto ? 1 : 0) - Object.keys(slotPhotos).length);
        const kept = next.slice(0, capacity);
        const keptUrls = new Set(kept.map((photo) => photo.url));
        for (const photo of accepted) if (!keptUrls.has(photo.url)) releasePhotoUrl(photo.url);
        return kept;
      });
      if (firstFailure) {
        const message = firstFailure.reason instanceof Error ? firstFailure.reason.message : "일부 추가 사진을 확인해 주세요.";
        setUploadError(message);
        notify(`${accepted.length}장 등록 · ${message}`);
      }
    } finally {
      if (photoSelectionFence.isCurrent(token)) {
        extraPhotoBatchRef.current = false;
        setExtraPhotosProcessing(false);
      }
    }
  };

  const removeSlotPhoto = (slotId: string) => {
    photoSelectionFence.invalidateRole(slotId);
    setSlotPhotos((current) => {
      const next = { ...current };
      if (next[slotId]) releasePhotoUrl(next[slotId].url);
      delete next[slotId];
      return next;
    });
  };

  const removeExtraPhoto = (index: number) => {
    photoSelectionFence.invalidateExtras();
    extraPhotoBatchRef.current = false;
    setExtraPhotosProcessing(false);
    setExtraPhotos((current) => {
      if (current[index]) releasePhotoUrl(current[index].url);
      return current.filter((_, photoIndex) => photoIndex !== index);
    });
  };

  const startAutomation = () => {
    if (running || automationStartInFlightRef.current) return;
    if (researchingProduct) {
      notify("1차 상품정보 확인을 마치거나 중단한 뒤 최종 상품 분석을 시작해 주세요.");
      return;
    }
    if (queuedJobId) {
      notify("이 상품은 이미 등록 큐에 있습니다. 진행상황을 확인하거나 ‘다른 상품 등록’을 눌러 새 작업을 시작해 주세요.");
      return;
    }
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
    try {
      assertStudioPhotoBatch([mainPhoto, ...Object.values(slotPhotos), ...extraPhotos].map((photo) => photo.file));
    } catch (error) {
      const message = error instanceof Error ? error.message : "상품 사진 수와 원본 용량을 확인해 주세요.";
      setUploadError(message);
      notify(message);
      return;
    }
    const photoCount = 1 + Object.keys(slotPhotos).length + extraPhotos.length;
    automationStartInFlightRef.current = true;
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
            <input id="main-product-photo-camera" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onClick={preservePublishingCaptureContext} onChange={selectMainPhoto} />
            <label className={`drop-zone main-drop-zone ${mainPhoto ? "has-photo" : ""} ${running ? "running" : ""}`} htmlFor="main-product-photo">
              <input id="main-product-photo" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={selectMainPhoto} />
              {mainPhoto ? <><span className="main-photo-preview"><Image src={mainPhoto.url} alt="등록한 대표 상품 사진" fill sizes="700px" unoptimized /></span><span className="photo-preview-overlay"><ImagePlus size={17} />대표사진 교체</span><strong className="photo-file-name">{mainPhoto.name} · {mainPhoto.originalWidth}×{mainPhoto.originalHeight} 원본 보존 · 분석용 1200×1200</strong></> : <><span className="upload-graphic"><CloudUpload size={31} /></span><strong>대표 상품 사진을 넣으세요</strong><p>JPG, PNG, WEBP · 최소 600×600px · 자동 1:1 여백 보정</p><em><ImagePlus size={15} />대표사진 선택</em></>}
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
                const slotDisabled = extraPhotosProcessing || (!photo && totalPhotoCount >= 100);
                return <div className={`option-slot-wrap ${photo ? "has-photo" : ""}`} key={slot.id}><input id={`option-photo-${slot.id}-camera`} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={slotDisabled} onClick={preservePublishingCaptureContext} onChange={(event) => void selectSlotPhoto(slot.id, event)} /><label className="option-photo-slot" htmlFor={`option-photo-${slot.id}`} aria-disabled={slotDisabled}><input id={`option-photo-${slot.id}`} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" disabled={slotDisabled} onChange={(event) => void selectSlotPhoto(slot.id, event)} />{photo ? <><Image src={photo.url} alt={`${slot.label} 상품 사진`} fill sizes="180px" unoptimized /><span className="slot-photo-label"><b>{slot.label}</b><small>{photo.originalWidth}×{photo.originalHeight} · 교체</small></span></> : <><span><ImagePlus size={18} /></span><b>{slot.label}</b><small>{slot.guide}</small></>}</label><div className="photo-source-actions compact" aria-label={`${slot.label} 사진 입력 방식`}><label htmlFor={`option-photo-${slot.id}-camera`}><Camera size={14} /><span><b>촬영</b></span></label><label htmlFor={`option-photo-${slot.id}`}><ImagePlus size={14} /><span><b>앨범</b></span></label></div>{photo && <button type="button" className="remove-photo-button" aria-label={`${slot.label} 사진 삭제`} onClick={() => removeSlotPhoto(slot.id)}><Trash2 size={13} /></button>}</div>;
              })}
            </div>
          </section>

          <section className="extra-photo-section">
            <div className="upload-section-heading"><div><b>추가 사진</b><span className="optional-chip">여러 장</span><small>상세컷, 구성품, 포장 상태 등 필요한 만큼 한 번에 선택할 수 있습니다.</small></div><em>{extraPhotos.length}장 추가됨</em></div>
            <input id="extra-product-photo-camera" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={extraPhotosProcessing || totalPhotoCount >= 100} onClick={preservePublishingCaptureContext} onChange={(event) => void selectExtraPhotos(event)} />
            <label className={`extra-photo-uploader ${extraPhotosProcessing ? "processing" : ""}`.trim()} htmlFor="extra-product-photos" aria-disabled={extraPhotosProcessing || totalPhotoCount >= 100}><input id="extra-product-photos" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={extraPhotosProcessing || totalPhotoCount >= 100} onChange={(event) => void selectExtraPhotos(event)} />{extraPhotosProcessing ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}<span><b>{extraPhotosProcessing ? "선택한 사진 확인 중" : totalPhotoCount >= 100 ? "최대 100장 등록됨" : "추가 사진 더 넣기"}</b><small>{extraPhotosProcessing ? "모바일 메모리를 보호하며 3장씩 처리하고 있습니다." : "분석용 최대 100장 · 채널 등록은 앞 8~9장 자동 선별"}</small></span></label>
            <div className="photo-source-actions" aria-label="추가 사진 입력 방식">
              <label htmlFor="extra-product-photo-camera"><Camera size={18} /><span><b>사진 촬영</b><small>한 장씩 바로 추가</small></span></label>
              <label htmlFor="extra-product-photos"><ImagePlus size={18} /><span><b>앨범에서 선택</b><small>여러 장 한 번에 첨부</small></span></label>
            </div>
            {extraPhotos.length > 0 && <div className="extra-photo-list">{extraPhotos.map((photo, index) => <div key={`${photo.name}-${index}`}><span><Image src={photo.url} alt={`추가 상품 사진 ${index + 1}`} fill sizes="100px" unoptimized /></span><small>{index + 1}</small><button type="button" aria-label={`추가 사진 ${index + 1} 삭제`} onClick={() => removeExtraPhoto(index)}><X size={12} /></button></div>)}</div>}
          </section>

          <section className={`product-research-panel ${manualErrors.researchInput ? "field-error" : ""}`}>
            <div className="product-research-heading"><span><Bot size={17} /><b>상품 링크 또는 설명</b><em>1차 자동생성</em></span><small>판매페이지·제조사 링크, 모델명, 바코드, 카톡으로 받은 상품 설명을 그대로 넣으세요.</small></div>
            <div className="product-research-input"><Link2 size={17} /><textarea value={intake.researchInput} onChange={(event) => setIntakeField("researchInput", event.target.value)} maxLength={12_000} placeholder={"예: https://공급사.example/product/123\n또는 상품명, 모델명, 재질·구성 등 알고 있는 내용을 붙여넣으세요."} aria-label="상품 링크 또는 설명" /><button type="button" onClick={() => researchingProduct ? cancelProductResearch() : void researchProductInformation()} disabled={researchingProduct ? false : intake.researchInput.trim().length < 2 || running}>{researchingProduct ? <X size={15} /> : <WandSparkles size={15} />}{researchingProduct ? "확인 중단" : "1차 자동생성"}</button></div>
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
            {competitorResearchState !== "idle" && <CompetitorPriceSlots items={researchCompetitors} providers={competitorProviders} state={competitorResearchState} retryAvailable={competitorResearchRetryAvailable} onRetry={retryCompetitorResearch} compact />}
          </section>
          {firstDraftGenerated && <div className="first-draft-review"><AlertTriangle size={15} /><span><b>1차 자동생성은 검토용 초안입니다.</b><small>확인되지 않은 항목은 공란으로 남습니다. 가격·재고와 포장 규격을 실물·공급처 자료 및 위 비교 가격에 맞게 입력한 뒤 사실 확인을 체크하세요.</small></span></div>}

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
              <label className={manualErrors.packageContents ? "field-error" : ""}><span>판매 구성 <i>필수</i></span><select required value={intake.packageContents} onChange={(event) => setIntakeField("packageContents", event.target.value)}><option value="">구성을 선택하세요</option>{productSaleConfigurations.map((configuration) => <option value={configuration.value} key={configuration.value}>{configuration.label}</option>)}</select>{manualErrors.packageContents && <small>{manualErrors.packageContents}</small>}</label>
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

          <div className={`analysis-start-bar ${intakeReady && mainPhoto && !researchingProduct ? "ready" : "not-ready"}`}><span><b>{totalPhotoCount}장</b> · 원본 별도 보존 · 분석용 1200×1200 JPG · 필수정보 {intakeReady ? "완료" : "미완료"} · 대표사진 {mainPhoto ? "완료" : "미완료"}</span><button type="button" onClick={startAutomation} disabled={running || researchingProduct || Boolean(queuedJobId)}>{running ? <><LoaderCircle className="spin" size={17} />분석 중</> : researchingProduct ? <><LoaderCircle className="spin" size={17} />1차 확인 중</> : queuedJobId ? <><CheckCircle2 size={17} />등록 큐 접수됨</> : <><WandSparkles size={17} />상품 분석 시작</>}</button></div>
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
        competitorContext={studioCompetitorContext}
        requestId={studioRequestId}
        onRunningChange={(nextRunning) => {
          automationStartInFlightRef.current = nextRunning;
          setRunning(nextRunning);
        }}
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

type ShipmentInput = {
  id: string;
  carrierCode: string;
  trackingNumber: string;
  tracxReferenceKind?: "packing_no" | "reference_order_no";
  tracxReference?: string;
};
type ShipmentDraftInput = Omit<ShipmentInput, "id">;
type ShipmentResult = {
  succeeded: number;
  failed: number;
  reconciliationRequired: number;
  results: Array<{ id: string; channel: string; ok: boolean; message: string; reconciliationRequired?: boolean }>;
};

const fulfillmentRequestBatchSize = 3;

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
  const [shipmentDrafts, setShipmentDrafts] = useState<Record<string, ShipmentDraftInput>>({});
  const [fulfillmentOpen, setFulfillmentOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<DisplayOrder | null>(() => displayOrders.find((order) => order.id === initialOrderId) ?? null);
  const [fulfilling, setFulfilling] = useState(false);
  const invoiceInputRef = useRef<HTMLInputElement>(null);
  const paidCount = displayOrders.filter((order) => order.status === "결제완료").length;
  const readyCount = displayOrders.filter((order) => order.status === "출고대기").length;
  const fulfillmentCandidateCount = displayOrders.filter((order) => ["결제완료", "출고대기"].includes(order.status)
    && isActiveChannelKey(order.channelKey)
    && shipmentWriteAvailability(order.channelKey).available).length;
  const shipmentVerification = shipmentVerificationSummary(fulfillmentCandidateCount);
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
  const eligibleOrders = filteredOrders.filter((order) => ["결제완료", "출고대기"].includes(order.status)
    && isActiveChannelKey(order.channelKey)
    && shipmentWriteAvailability(order.channelKey).available);
  const selectedOrders = displayOrders.filter((order) => selectedIds.has(order.sourceId)
    && isActiveChannelKey(order.channelKey)
    && shipmentWriteAvailability(order.channelKey).available);
  const allEligibleSelected = eligibleOrders.length > 0 && eligibleOrders.every((order) => selectedIds.has(order.sourceId));
  const toggleAllEligible = () => setSelectedIds((current) => {
    const next = new Set(current);
    if (allEligibleSelected) eligibleOrders.forEach((order) => next.delete(order.sourceId));
    else eligibleOrders.forEach((order) => next.add(order.sourceId));
    return next;
  });
  const toggleOrder = (order: DisplayOrder) => {
    if (!isActiveChannelKey(order.channelKey) || !shipmentWriteAvailability(order.channelKey).available) {
      notify("이 채널은 자동 발송 API 범위가 검증되지 않아 선택할 수 없습니다. 판매자센터에서 처리해 주세요.");
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
      const nextDrafts: Record<string, ShipmentDraftInput> = {};
      const nextSelected = new Set<string>();
      for (const row of dataRows) {
        const [externalOrderId, carrierCode, trackingNumber, tracxReference = "", rawTracxReferenceKind = "packing_no"] = row;
        const matchingOrders = displayOrders.filter((candidate) => candidate.id === externalOrderId);
        const order = matchingOrders.length === 1 ? matchingOrders[0] : null;
        if (!order || !carrierCode || !trackingNumber || !isActiveChannelKey(order.channelKey) || !shipmentWriteAvailability(order.channelKey).available) continue;
        nextSelected.add(order.sourceId);
        nextDrafts[order.sourceId] = {
          carrierCode,
          trackingNumber,
          tracxReference,
          tracxReferenceKind: rawTracxReferenceKind === "reference_order_no" ? "reference_order_no" : "packing_no",
        };
      }
      if (!nextSelected.size) throw new Error("unmatched");
      setSelectedIds(nextSelected);
      setShipmentDrafts(nextDrafts);
      setFulfillmentOpen(true);
      notify(`${nextSelected.size}건의 송장 정보를 불러왔습니다.`);
    } catch {
      notify("CSV를 ‘주문번호,택배사코드,운송장번호[,TracX참조번호,참조종류]’ 순서로 확인해 주세요.");
    } finally {
      if (invoiceInputRef.current) invoiceInputRef.current.value = "";
    }
  };
  const confirmFulfillment = async () => {
    const shipments = selectedOrders.map((order) => ({ id: order.sourceId, ...shipmentDrafts[order.sourceId] }));
    if (shipments.some((shipment) => {
      const order = selectedOrders.find((candidate) => candidate.sourceId === shipment.id);
      return !shipment.carrierCode?.trim() || order?.channelKey !== "lazada" && !shipment.trackingNumber?.trim();
    })) {
      notify("택배사 코드와 Lazada 외 채널의 실제 운송장번호를 입력해 주세요.");
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
      if (result.failed === 0 && result.reconciliationRequired === 0) setFulfillmentOpen(false);
    } finally {
      setFulfilling(false);
    }
  };
  return (
    <div className="page-stack">
      <section className="order-summary-grid"><article><span className="metric-icon blue"><ShoppingCart size={19} /></span><div><small>통합 주문</small><strong>{displayOrders.length}</strong></div><em>운영 원장</em></article><article><span className="metric-icon orange"><Clock3 size={19} /></span><div><small>출고 대기</small><strong>{readyCount}</strong></div><em className="neutral">결제완료 {paidCount}건</em></article><article><span className="metric-icon violet"><Truck size={19} /></span><div><small>배송 중 · 완료</small><strong>{shippingCount} · {deliveredCount}</strong></div><em className="neutral">운송장 추적</em></article><article><span className={`metric-icon ${exchangeRiskCount ? "orange" : "green"}`}><CircleDollarSign size={19} /></span><div><small>정산 완료</small><strong>{settledCount}</strong></div><em className={exchangeRiskCount ? "negative" : "neutral"}>{exchangeRiskCount ? `환율 손실주의 ${exchangeRiskCount}건` : "환율 손실주의 없음"}</em></article><article><span className={`metric-icon ${failedCount ? "orange" : "green"}`}><RefreshCw size={19} /></span><div><small>최근 동기화</small><strong>{lastSuccess ? relativeTime(lastSuccess) : "대기"}</strong></div><em className={failedCount ? "neutral" : ""}>{failedCount ? `${failedCount}개 채널 확인 필요` : "실제 채널 API"}</em></article></section>
      <section className="shipment-warning shipment-release-status" role="status"><AlertTriangle size={16} /><span><b>{shipmentVerification.title}</b><small>{shipmentVerification.detail}</small></span></section>
      <section className="panel data-panel"><div className="tab-toolbar"><div>{["전체 주문", "결제완료", "출고대기", "배송중", "완료 · 취소"].map((tab) => <button className={active === tab ? "active" : ""} onClick={() => setActive(tab)} key={tab}>{tab}{tab === "출고대기" && <span>{readyCount}</span>}</button>)}</div><div className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="주문번호, 구매자, 상품 검색" aria-label="주문 검색" /></div><button type="button" className="icon-text-button paid-orders-export-button" onClick={downloadPaidOrders} title="결제완료 상태의 주문만 Excel 파일로 내려받기"><Download size={15} />결제완료 Excel <b>{paidCount}</b>건</button><span className="automatic-sync-label"><RefreshCw size={14} />5분마다 자동 업데이트</span></div>
        <div className="table-wrap"><table className="data-table order-table"><thead><tr><th><input type="checkbox" aria-label="출고 가능 주문 전체 선택" checked={allEligibleSelected} onChange={toggleAllEligible} /></th><th>주문번호</th><th>채널</th><th>구매자</th><th>상품</th><th>결제금액</th><th>주문 · 배송</th><th>정산</th><th>주문시간</th><th /></tr></thead><tbody>{filteredOrders.map((order) => { const supported = isActiveChannelKey(order.channelKey) && shipmentWriteAvailability(order.channelKey).available; const eligible = ["결제완료", "출고대기"].includes(order.status) && supported; return <tr key={order.sourceId} className={`${initialOrderId === order.id ? "search-target-row" : ""} ${selectedIds.has(order.sourceId) ? "selected-row" : ""}`.trim()}><td><input type="checkbox" aria-label={`${order.id} 출고 선택`} checked={selectedIds.has(order.sourceId)} disabled={!eligible} title={!supported ? "자동 발송 API 검증 전" : undefined} onChange={() => toggleOrder(order)} /></td><td><button type="button" className="order-detail-link mono" onClick={() => setDetailOrder(order)}>{order.id}</button></td><td><ChannelMark code={order.channel} size="sm" /></td><td><b>{order.customer}</b></td><td><button type="button" className="order-product-button truncate-product" onClick={() => setDetailOrder(order)}>{order.product}</button></td><td><b>{order.amount}</b></td><td><StatusBadge status={order.status} />{order.trackingNumber ? <small className="tracking-fact">{order.carrierCode} · {order.trackingNumber}</small> : !supported && ["결제완료", "출고대기"].includes(order.status) ? <small className="tracking-fact">자동 발송 미검증 · 판매자센터 처리</small> : null}</td><td><StatusBadge status={order.settlementStatus} />{(order.exchangeLossPercent ?? 0) >= 2 ? <small className="exchange-loss-warning">환율 -{order.exchangeLossPercent}%</small> : null}</td><td><span className="muted-cell">{order.time}</span></td><td><button className="table-action" title="주문 상세정보 보기" aria-label={`${order.id} 주문 상세정보 보기`} onClick={() => setDetailOrder(order)}><ChevronRight size={16} /></button></td></tr>; })}</tbody></table></div>
        {displayOrders.length === 0 ? <div className="live-empty-state table-empty"><ShoppingCart size={28} /><b>동기화된 실제 주문이 없습니다.</b><small>채널 API 키 연결 후 주문 조회를 실행하면 표시됩니다.</small></div> : filteredOrders.length === 0 ? <div className="live-empty-state table-empty"><Search size={28} /><b>검색 조건에 맞는 주문이 없습니다.</b><small>주문번호, 구매자명 또는 상품명을 다시 확인해 주세요.</small></div> : null}
        <div className="bulk-order-bar"><span><input type="checkbox" aria-label="출고 가능 주문 전체 선택" checked={allEligibleSelected} onChange={toggleAllEligible} />선택한 주문 <b>{selectedIds.size}</b>건</span><button type="button" disabled={!selectedIds.size || fulfilling} onClick={openFulfillment}><Truck size={15} />일괄 출고 처리</button><button type="button" disabled={fulfilling} onClick={() => invoiceInputRef.current?.click()}><Upload size={15} />송장 CSV 업로드</button><input ref={invoiceInputRef} className="sr-only" type="file" accept=".csv,text/csv" aria-label="송장 CSV 파일 선택" onChange={(event) => void importInvoices(event.target.files?.[0] ?? null)} /><span className="toolbar-spacer" /><small>{syncStatus.length ? "채널별 동기화 상태 기록 중 · 5분 자동 업데이트" : "채널 연결 상태 확인 중"}</small></div>
      </section>
      {detailOrder && <div className="shipment-dialog-overlay" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setDetailOrder(null); }}><section className="shipment-dialog order-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="order-detail-title"><header><div><span className="metric-icon blue"><ShoppingCart size={18} /></span><span><h3 id="order-detail-title">주문 상세정보</h3><small>주문 · 배송 · 정산 원장을 한곳에서 확인합니다.</small></span></div><button className="icon-only-button" aria-label="주문 상세 닫기" onClick={() => setDetailOrder(null)}><X size={17} /></button></header><dl className="order-detail-ledger"><div><dt>주문번호</dt><dd>{detailOrder.id}</dd></div><div><dt>판매 채널</dt><dd><ChannelMark code={detailOrder.channel} size="sm" /></dd></div><div><dt>구매 상품</dt><dd>{detailOrder.product}</dd></div><div><dt>구매자</dt><dd>{detailOrder.customer}</dd></div><div><dt>결제금액</dt><dd>{detailOrder.amount}</dd></div><div><dt>주문상태</dt><dd><StatusBadge status={detailOrder.status} /></dd></div><div><dt>배송 추적</dt><dd>{detailOrder.trackingNumber ? `${detailOrder.carrierCode ?? "택배사"} · ${detailOrder.trackingNumber}` : "운송장 등록 전"}</dd></div><div><dt>배송 완료</dt><dd>{detailOrder.deliveredAt ? formatProductUpdatedAt(detailOrder.deliveredAt) : "완료 전"}</dd></div><div><dt>정산 상태</dt><dd><StatusBadge status={detailOrder.settlementStatus} /></dd></div><div><dt>정산 금액</dt><dd>{detailOrder.settlementAmount != null && detailOrder.settlementCurrency ? new Intl.NumberFormat("ko-KR", { style: "currency", currency: detailOrder.settlementCurrency }).format(detailOrder.settlementAmount) : "정산 데이터 대기"}</dd></div><div><dt>환율 손익 참고</dt><dd className={(detailOrder.exchangeLossPercent ?? 0) >= 2 ? "exchange-loss-warning" : ""}>{detailOrder.exchangeLossPercent == null ? "기준환율 데이터 대기" : `${detailOrder.exchangeLossPercent > 0 ? "손실 " : "이익 "}${Math.abs(detailOrder.exchangeLossPercent).toFixed(2)}%`}</dd></div><div><dt>주문시간</dt><dd>{detailOrder.time}</dd></div></dl><footer><button type="button" className="credential-secondary" onClick={() => setDetailOrder(null)}>닫기</button>{["결제완료", "출고대기"].includes(detailOrder.status) && isActiveChannelKey(detailOrder.channelKey) && shipmentWriteAvailability(detailOrder.channelKey).available ? <button type="button" className="publish-execute" onClick={() => { setSelectedIds(new Set([detailOrder.sourceId])); setShipmentDrafts({ [detailOrder.sourceId]: shipmentDrafts[detailOrder.sourceId] ?? { carrierCode: "", trackingNumber: "" } }); setDetailOrder(null); setFulfillmentOpen(true); }}><Truck size={15} />출고 정보 입력</button> : null}</footer></section></div>}
      {fulfillmentOpen && <div className="shipment-dialog-overlay" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !fulfilling) setFulfillmentOpen(false); }}>
        <section className="shipment-dialog" role="dialog" aria-modal="true" aria-labelledby="shipment-dialog-title">
          <header><div><span className="metric-icon violet"><Truck size={18} /></span><span><h3 id="shipment-dialog-title">판매채널 발송 처리</h3><small>선택한 {selectedOrders.length}건을 외부 판매채널에 실제 발송 처리합니다.</small></span></div><button className="icon-only-button" aria-label="출고 창 닫기" disabled={fulfilling} onClick={() => setFulfillmentOpen(false)}><X size={17} /></button></header>
          <div className="shipment-warning"><AlertTriangle size={16} /><span><b>실제 판매 상태가 변경됩니다.</b><small>판매채널이 성공 응답한 주문만 SellerPilot에서 배송중으로 변경됩니다. TracX 참조번호는 운송장이나 마켓 주문번호 대신 SmartShip 원문 값을 입력해야 합니다.</small></span></div>
          <div className="shipment-draft-list">{selectedOrders.map((order) => <article key={order.sourceId}>
            <div><ChannelMark code={order.channel} size="sm" /><span><b>{order.id}</b><small>{order.product}</small></span></div>
            <label><span>택배사 코드</span><input value={shipmentDrafts[order.sourceId]?.carrierCode ?? ""} onChange={(event) => setShipmentDrafts((current) => ({ ...current, [order.sourceId]: { ...(current[order.sourceId] ?? { trackingNumber: "" }), carrierCode: event.target.value } }))} placeholder="채널 공식 택배사 코드" /></label>
            <label><span>{order.channelKey === "lazada" ? "운송장번호 · 자동 발급" : "운송장번호"}</span><input disabled={order.channelKey === "lazada"} value={order.channelKey === "lazada" ? "Pack 완료 후 Lazada 발급" : shipmentDrafts[order.sourceId]?.trackingNumber ?? ""} onChange={(event) => setShipmentDrafts((current) => ({ ...current, [order.sourceId]: { ...(current[order.sourceId] ?? { carrierCode: "" }), trackingNumber: event.target.value } }))} placeholder="숫자·영문 운송장번호" /></label>
            <label><span>TracX 참조 종류 · 선택</span><select value={shipmentDrafts[order.sourceId]?.tracxReferenceKind ?? "packing_no"} onChange={(event) => setShipmentDrafts((current) => ({ ...current, [order.sourceId]: { ...(current[order.sourceId] ?? { carrierCode: "", trackingNumber: "" }), tracxReferenceKind: event.target.value as "packing_no" | "reference_order_no" } }))}><option value="packing_no">PackingNo</option><option value="reference_order_no">RefOrderNo</option></select></label>
            <label><span>TracX 정확한 참조번호 · 선택</span><input value={shipmentDrafts[order.sourceId]?.tracxReference ?? ""} onChange={(event) => setShipmentDrafts((current) => ({ ...current, [order.sourceId]: { ...(current[order.sourceId] ?? { carrierCode: "", trackingNumber: "" }), tracxReference: event.target.value } }))} placeholder="SmartShip 원문 그대로 입력" /></label>
          </article>)}</div>
          <footer><button type="button" className="credential-secondary" disabled={fulfilling} onClick={() => setFulfillmentOpen(false)}>취소</button><button type="button" className="publish-execute" disabled={fulfilling || selectedOrders.some((order) => !shipmentDrafts[order.sourceId]?.carrierCode.trim() || order.channelKey !== "lazada" && !shipmentDrafts[order.sourceId]?.trackingNumber.trim())} onClick={() => void confirmFulfillment()}>{fulfilling ? <LoaderCircle className="spin" size={15} /> : <Truck size={15} />}{fulfilling ? "판매채널 처리 중" : "확인 후 실제 발송 처리"}</button></footer>
        </section>
      </div>}
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
  const initialTicket = displayTickets.find((ticket) => ticket.id === initialTicketId) ?? null;
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(initialTicket?.sourceId ?? null);
  const [query, setQuery] = useState(initialQuery);
  const [ticketTab, setTicketTab] = useState<"미답변" | "처리 중" | "완료">(() => {
    const initialStatus = initialTicket?.status;
    return initialStatus === "처리 완료" ? "완료" : initialStatus === "처리 중" ? "처리 중" : "미답변";
  });
  const [replyDrafts, setReplyDrafts] = useState<CsReplyDrafts>({});
  const [targetLocale, setTargetLocale] = useState<SupportLocale>("ko-KR");
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(Boolean(initialTicketId));
  const filteredTickets = displayTickets.filter((ticket) => {
    const matchesTab = ticketTab === "미답변"
      ? ticket.status === "긴급" || ticket.status === "답변 대기"
      : ticketTab === "처리 중"
        ? ticket.status === "처리 중"
        : ticket.status === "처리 완료";
    return matchesTab && (!query.trim() || matchesSearch(`${ticket.id} ${ticket.customer} ${ticket.channel} ${ticket.subject} ${ticket.preview}`, query));
  });
  const selected = selectedCsTicket(filteredTickets, selectedSourceId);
  const reply = csReplyDraftValue(replyDrafts, selected);
  const remoteReplyChannel = Boolean(selected && ["qoo10", "lazada", "coupang", "smartstore"].includes(selected.channelKey));
  const setSelectedReply = (value: string) => {
    if (!selected) return;
    setReplyDrafts((current) => withCsReplyDraft(current, selected, value));
  };
  const sendReply = async () => {
    if (!selected || sending) return;
    setSending(true);
    try {
      if (await onSend(selected, reply)) {
        setReplyDrafts((current) => withCsReplyDraft(current, selected, ""));
      }
    } finally {
      setSending(false);
    }
  };
  const createDraft = async () => {
    if (!selected || drafting) return;
    setDrafting(true);
    try {
      const draft = await onDraft(selected, targetLocale);
      if (draft) {
        setReplyDrafts((current) => withCsReplyDraft(current, selected, draft));
        notify(`${supportLocaleLabels[targetLocale]} CLI 답변 초안을 불러왔습니다. 외부 전송 여부를 확인해 주세요.`);
      }
    } finally {
      setDrafting(false);
    }
  };
  const updateStatus = async (status: "waiting" | "in_progress" | "resolved") => {
    if (!selected) return;
    await onStatus(selected, status);
  };
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
      <section className="cs-summary"><div><span className="metric-icon violet"><Inbox size={18} /></span><span><small>미처리 문의</small><strong>{unresolvedCount}</strong></span></div><div><span className="metric-icon orange"><Clock3 size={18} /></span><span><small>긴급 문의</small><strong>{displayTickets.filter((ticket) => ticket.status === "긴급").length}</strong></span></div><div><span className="metric-icon green"><BadgeCheck size={18} /></span><span><small>동기화 주문</small><strong>{displayOrders.length}</strong></span></div><div><span className="metric-icon blue"><Bot size={18} /></span><span><small>원장 확인 필요</small><strong>{displayTickets.filter((ticket) => ticket.replyDeliveryStatus === "reconciliation_required").length}</strong></span></div></section>
      <section className="panel-heading table-title"><div><span className="panel-kicker">LIVE INQUIRIES</span><h3>{lastSuccess ? `최근 동기화 ${relativeTime(lastSuccess)}` : "채널 문의 동기화 대기"}{failedCount ? ` · ${failedCount}개 채널 확인 필요` : ""}</h3></div><button className="filter-button" type="button" onClick={() => void onSync()} disabled={syncing}>{syncing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}{syncing ? "요청 중" : "문의 새로고침"}</button></section>
      <section className="panel cs-channel-verification"><div className="panel-heading"><div><span className="panel-kicker">CHANNEL VERIFICATION</span><h3>채널별 문의 조회 · 답변 범위</h3></div><ShieldCheck size={18} /></div><div className="cs-channel-verification-grid">{inquiryChannelStates.map(({ channelKey, state }) => { const verification = csChannelVerification(channelKey, state?.status, state?.imported_count ?? 0, state?.last_error ?? null); return <article key={channelKey}><ChannelMark code={channels[channelKey].letter} /><span><b>{channels[channelKey].name}</b><small>{verification.readLabel}{state?.status === "passed" && state.last_succeeded_at ? ` · ${relativeTime(state.last_succeeded_at)}` : ""}</small><small>{verification.replyLabel}</small></span><em className={verification.tone}>{verification.badge}</em></article>; })}</div></section>
      {!selected ? <section className="panel live-empty-state large"><Inbox size={32} /><b>{displayTickets.length === 0 ? "운영 원장에 실제 문의가 0건입니다." : "검색 조건에 맞는 문의가 없습니다."}</b><small>{displayTickets.length === 0 ? "지원·승인된 채널의 문의 조회가 성공하고 실제 문의가 있으면 고객 정보와 원문이 표시됩니다." : "고객명, 문의번호 또는 문의 내용을 다시 확인해 주세요."}</small>{displayTickets.length === 0 && <button className="ghost-button" type="button" onClick={() => void onSync()} disabled={syncing}>지금 확인</button>}</section> :
      <section className={`cs-workspace panel ${mobileConversationOpen ? "mobile-conversation-open" : ""}`}>
        <aside className="ticket-list"><div className="ticket-list-header"><div className="search-field"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="고객명, 문의번호, 내용 검색" aria-label="문의 검색" /></div></div><div className="ticket-tabs">{(["미답변", "처리 중", "완료"] as const).map((tab) => <button key={tab} className={ticketTab === tab ? "active" : ""} onClick={() => { setTicketTab(tab); setSelectedSourceId(null); setMobileConversationOpen(false); }}>{tab}{tab === "미답변" && <span>{displayTickets.filter((ticket) => ticket.status === "긴급" || ticket.status === "답변 대기").length}</span>}</button>)}</div>{filteredTickets.map((ticket) => <button key={ticket.sourceId} className={`ticket-item ${selected.sourceId === ticket.sourceId ? "active" : ""}`} onClick={() => { setSelectedSourceId(ticket.sourceId); setMobileConversationOpen(true); }}><div className="ticket-avatar">{ticket.customer.charAt(0)}</div><div><div><b>{ticket.customer}</b><small>{ticket.time}</small></div><span><ChannelMark code={ticketChannelCodes[ticket.channel] ?? "Q"} size="sm" />{ticket.subject}</span><p>{ticket.preview}</p><StatusBadge status={ticket.replyDeliveryStatus === "reconciliation_required" ? "원장 확인 필요" : ticket.status} /></div></button>)}</aside>
        <article className="conversation"><header><div><button className="mobile-back" type="button" aria-label="문의 목록으로 돌아가기" onClick={() => setMobileConversationOpen(false)}><ArrowLeft size={16} /></button><span className="ticket-avatar large">{selected.customer.charAt(0)}</span><span><b>{selected.customer}</b><small>{selected.channel} · {selected.id}</small></span></div><div><label className="filter-select compact"><span className="sr-only">문의 처리 상태</span><select value={selected.status === "처리 완료" ? "resolved" : selected.status === "처리 중" ? "in_progress" : "waiting"} onChange={(event) => void updateStatus(event.target.value as "waiting" | "in_progress" | "resolved")}><option value="waiting">답변 대기</option><option value="in_progress">처리 중</option><option value="resolved">처리 완료</option></select><ChevronDown size={14} /></label></div></header>
          <div className="conversation-body"><div className="order-context"><Package size={16} /><span><small>문의 주문</small><b>안정된 주문 연결 정보 없음</b></span><div className="order-context-meta"><em>-</em><StatusBadge status="확인 필요" /><small>고객명만으로 주문을 추정하지 않습니다.</small></div></div><div className="message-date"><span>실제 수신 문의</span></div><div className="customer-message"><div className="ticket-avatar">{selected.customer.charAt(0)}</div><div><small>{selected.customer} · {selected.time}</small><p>{selected.originalMessage}</p><span>채널 동기화 원문</span></div></div></div>
          <footer className="reply-composer"><div className="ai-draft-head"><span><Sparkles size={14} />문의 원문을 바탕으로 검토용 초안을 생성합니다.</span><button type="button" disabled={drafting || sending} onClick={() => void createDraft()}>{drafting ? <LoaderCircle className="spin" size={13} /> : <RefreshCw size={13} />}{drafting ? "CLI 작성 중" : "CLI 초안 생성"}</button></div><textarea value={reply} disabled={sending} onChange={(event) => setSelectedReply(event.target.value)} placeholder={remoteReplyChannel ? "판매채널로 전송할 실제 답변을 입력하세요." : "판매자센터 전송 전 검토할 내부 초안을 입력하세요."} /><div><span><label className="reply-tool-select"><Languages size={15} /><span className="sr-only">답변 언어</span><select value={targetLocale} disabled={sending} onChange={(event) => setTargetLocale(event.target.value as SupportLocale)}>{Object.entries(supportLocaleLabels).map(([locale, label]) => <option key={locale} value={locale}>{label}</option>)}</select><ChevronDown size={13} /></label><label className="reply-tool-select"><FileText size={15} /><span className="sr-only">답변 템플릿</span><select defaultValue="" disabled={sending} onChange={(event) => { const template = supportReplyTemplates.find((item) => item.label === event.target.value); if (template) setSelectedReply(template.value); event.target.value = ""; }}><option value="">템플릿</option>{supportReplyTemplates.map((template) => <option value={template.label} key={template.label}>{template.label}</option>)}</select><ChevronDown size={13} /></label></span><button className="send-button" disabled={!reply.trim() || sending} onClick={() => void sendReply()}>{sending ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}{sending ? "처리 중" : remoteReplyChannel ? "판매채널 답변 전송" : "내부 초안 저장"}</button></div></footer>
        </article>
        <aside className="customer-panel"><div className="customer-profile"><div className="ticket-avatar xl">{selected.customer.charAt(0)}</div><h4>{selected.customer}</h4><span>{selected.channel} 구매자</span></div><div className="customer-facts"><div><small>문의 연결 주문</small><b>미연결</b></div><div><small>데이터 출처</small><b>실제 채널 API</b></div></div><div className="detail-section"><h5>연결 주문</h5><div className="mini-order"><span className="tiny-thumb"><Package size={17} /></span><span><b>안정된 주문 식별자 없음</b><small>-</small></span></div><dl><div><dt>주문번호</dt><dd>-</dd></div><div><dt>배송상태</dt><dd><StatusBadge status="확인 필요" /></dd></div><div><dt>운송장</dt><dd>-</dd></div></dl></div><div className="detail-section"><h5>응대 원칙</h5><p className="ai-guide"><Bot size={16} />판매자센터에서 주문·배송 상태를 확인한 뒤 처리하세요. 고객명만으로 주문을 자동 연결하지 않습니다.</p></div></aside>
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
  const kakaoTestRequestIdRef = useRef<string | null>(null);
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
    const requestId = kakaoTestRequestIdRef.current ?? crypto.randomUUID();
    kakaoTestRequestIdRef.current = requestId;
    try {
      const response = await authenticatedFetch("/api/integrations/kakao/settings", { method: "POST", body: JSON.stringify({ action: "test", requestId }) });
      const payload = await response.json().catch(() => ({ message: "테스트 알림 응답을 읽지 못했습니다." })) as { message?: string; outcome?: string; terminal?: boolean };
      if (!response.ok) {
        if (payload.terminal && payload.outcome === "failed") kakaoTestRequestIdRef.current = null;
        throw new Error(payload.message ?? "테스트 알림을 보내지 못했습니다.");
      }
      kakaoTestRequestIdRef.current = null;
      notify("가입한 사용자 본인의 카카오톡 ‘나와의 채팅’으로 테스트 알림을 보냈습니다.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "테스트 알림을 보내지 못했습니다.");
    }
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
  const { toast, notify, dismissToast } = useToastQueue();
  const toastTone = toastToneForMessage(toast);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [targetedSearch, setTargetedSearch] = useState<{ kind: "order" | "inquiry"; id: string; query: string } | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const notificationRef = useRef<HTMLDivElement>(null);
  const activityStatusRef = useRef<RegistrationActivityEventState | null>(null);
  const operationEventRef = useRef<OperationEventState | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<DisplayProduct | null>(null);
  const [publishingProduct, setPublishingProduct] = useState<{ id: string; name: string } | null>(null);
  const [publishingSession, setPublishingSession] = useState(0);
  const displayProductsRef = useRef<DisplayProduct[]>([]);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const operations = useOperationsSnapshot();
  const refreshOperations = operations.refresh;
  const authenticatedOperationsFetch = operations.authenticatedFetch;
  const reloadOperations = operations.reload;
  const syncingOrdersRef = useRef(false);
  const operationSummary = operations.data?.summary ?? null;
  const channelMetrics = useMemo(() => operations.data?.channelMetrics ?? [], [operations.data]);
  const pipeline = operations.data?.pipeline ?? null;
  const registrationActivities = useMemo(() => operations.data?.registrationActivities ?? [], [operations.data]);
  const workerLastSeenAt = operations.data?.aiRuntime?.worker?.last_seen_at ?? null;
  const workerConnected = Boolean(workerLastSeenAt && operations.data?.generatedAt
    && Date.parse(operations.data.generatedAt) - Date.parse(workerLastSeenAt) < 10 * 60_000);
  const meta = pageMeta[view];

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
    const transition = registrationActivityNotificationTransition(
      activityStatusRef.current,
      registrationActivities,
      operations.data.registrationActivityState,
    );
    activityStatusRef.current = transition.statuses;
    for (const message of transition.messages) notify(message);
  }, [notify, operations.data, registrationActivities]);

  useEffect(() => {
    if (!operations.data) return;
    const messages = operationEventNotifications(operationEventRef.current, operations.data);
    operationEventRef.current = operationEventState(operations.data);
    for (const message of messages) notify(message);
  }, [notify, operations.data]);

  useEffect(() => {
    if (view !== "registration-activity") return;
    if (!registrationActivities.some((activity) => isRegistrationActivityRunning(activity.status))) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshOperations();
    };
    const interval = window.setInterval(refreshWhenVisible, 10_000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshOperations, registrationActivities, view]);

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
  const activeSelectedProduct = selectedProduct
    ? displayProducts.find((product) => product.sourceId === selectedProduct.sourceId) ?? selectedProduct
    : null;

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
    replyDeliveryStatus: ticket.replyDeliveryStatus,
    replyDeliveryError: ticket.replyDeliveryError,
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
    const aggregate: ShipmentResult = { succeeded: 0, failed: 0, reconciliationRequired: 0, results: [] };
    for (let offset = 0; offset < shipments.length; offset += fulfillmentRequestBatchSize) {
      const batch = shipments.slice(offset, offset + fulfillmentRequestBatchSize);
      try {
        const response = await operations.authenticatedFetch("/api/admin/orders/fulfill", {
          method: "POST",
          body: JSON.stringify({ confirmWrite: true, shipments: batch }),
        });
        const payload = await response.json().catch(() => ({ message: "판매채널 발송 처리 응답을 읽지 못했습니다." })) as ShipmentResult & { message?: string };
        if (!response.ok && response.status !== 207) throw new Error(payload.message ?? "판매채널 발송 처리를 완료하지 못했습니다.");
        aggregate.succeeded += Number(payload.succeeded ?? 0);
        aggregate.failed += Number(payload.failed ?? batch.length);
        aggregate.reconciliationRequired += Number(payload.reconciliationRequired ?? 0);
        aggregate.results.push(...(Array.isArray(payload.results) ? payload.results : []));
      } catch (error) {
        const message = error instanceof Error ? error.message : "판매채널 발송 처리 응답을 확인하지 못했습니다.";
        aggregate.failed += batch.length;
        aggregate.reconciliationRequired += batch.length;
        aggregate.results.push(...batch.map((shipment) => ({
          id: shipment.id,
          channel: "unknown",
          ok: false,
          reconciliationRequired: true,
          message: `${message} 서버 접수 여부를 확인하기 전에는 같은 출고를 다시 보내지 마세요.`,
        })));
      }
    }
    await operations.reload();
    notify(`${shipments.length}건 중 ${aggregate.succeeded}건 발송 완료 · ${aggregate.failed}건 확인 필요 · ${aggregate.reconciliationRequired}건 원장 조정 필요`);
    return aggregate;
  }, [notify, operations]);

  const saveTicketReply = useCallback(async (ticket: DisplayTicket, reply: string) => {
    const source = operations.data?.tickets.find((item) => item.id === ticket.sourceId);
    if (!source) {
      notify("운영 DB 마이그레이션 적용 후 CS 답변을 저장할 수 있습니다.");
      return false;
    }
    try {
      const plan = csReplySavePlan(source.id, ticket.channelKey, reply);
      const response = await operations.authenticatedFetch(plan.endpoint, {
        method: "POST",
        body: JSON.stringify(plan.body),
      });
      const payload = await response.json().catch(() => ({ message: "CS 답변 응답을 읽지 못했습니다." })) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "CS 답변을 저장하지 못했습니다.");
      await operations.reload();
      notify(plan.completionMessage);
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
      notify("ChatGPT CLI가 문의 원문과 연결된 원장 정보가 있는지 확인하고 있습니다.");

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
    if (syncingOrdersRef.current) return;
    syncingOrdersRef.current = true;
    setSyncingOrders(true);
    try {
      const response = await authenticatedOperationsFetch("/api/operations/sync", {
        method: "POST",
        body: JSON.stringify({ includeImBootstrap: !silent }),
      });
      const payload = await response.json().catch(() => ({ message: "주문 동기화 응답을 읽지 못했습니다." })) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "판매채널 주문 동기화를 시작하지 못했습니다.");
      if (!silent) notify(payload.message ?? "연결된 판매채널의 실제 주문·고객 문의 조회를 시작했습니다. 결과는 자동 반영됩니다.");
      window.setTimeout(() => void reloadOperations(), 3_000);
      window.setTimeout(() => void reloadOperations(), 12_000);
      window.setTimeout(() => void reloadOperations(), 30_000);
    } catch (error) {
      if (!silent) notify(error instanceof Error ? error.message : "판매채널 주문·문의 동기화를 시작하지 못했습니다.");
    } finally {
      syncingOrdersRef.current = false;
      setSyncingOrders(false);
    }
  }, [authenticatedOperationsFetch, notify, reloadOperations]);

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

  const recoverFailedProductAnalysis = useCallback(async (activity: RegistrationActivity) => {
    const jobId = recoverableRegistrationActivityJobId(activity);
    if (!jobId) {
      notify("기존 입력으로 복구할 수 있는 AI 상품 분석 작업이 아닙니다.");
      return;
    }
    let previousStorageValue: string | null = null;
    try {
      previousStorageValue = window.sessionStorage.getItem(activeStudioJobStorageKey);
      const recoveryStorageValue = studioJobRecoveryStorageValue(previousStorageValue, jobId, Date.now());
      if (!recoveryStorageValue) {
        notify("AI 상품 분석 작업 ID를 확인하지 못해 재시도를 시작하지 않았습니다.");
        return;
      }
      window.sessionStorage.setItem(activeStudioJobStorageKey, recoveryStorageValue);
    } catch {
      notify("모바일 브라우저에 기존 작업 복구 상태를 저장하지 못해 재시도를 시작하지 않았습니다.");
      return;
    }

    let response: Response;
    try {
      response = await authenticatedOperationsFetch("/api/admin/ai-jobs", {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ jobId, action: "retry" }),
      });
    } catch {
      notify("AI 분석 재시도 응답을 확인하지 못했습니다. 새 작업을 만들지 않고 기존 작업 ID 상태를 상품 등록 화면에서 확인합니다.");
      navigate("publishing");
      return;
    }
    const payload = await response.json().catch(() => ({ message: "AI 분석 재시도 응답을 읽지 못했습니다." })) as { message?: string };
    if ([408, 425, 429].includes(response.status) || response.status >= 500) {
      notify(`AI 분석 재시도 응답이 불명확합니다. 새 작업을 만들지 않고 기존 작업 ${jobId.slice(0, 8)} 상태만 확인합니다.`);
      navigate("publishing");
      return;
    }
    if (!response.ok && response.status !== 409) {
      try {
        if (previousStorageValue === null) window.sessionStorage.removeItem(activeStudioJobStorageKey);
        else window.sessionStorage.setItem(activeStudioJobStorageKey, previousStorageValue);
      } catch {
        notify("AI 상품 분석 재시도에 실패했고 모바일 브라우저의 복구 상태도 되돌리지 못했습니다. 새 작업이나 외부 채널 등록은 실행하지 않았습니다.");
        return;
      }
      notify(payload.message ?? "AI 상품 분석을 다시 시작하지 못했습니다.");
      return;
    }
    notify(response.ok
      ? "저장된 기존 사진·입력으로 동일한 AI 분석만 다시 시작했습니다. 외부 판매채널 등록은 실행하지 않습니다."
      : "기존 AI 작업이 이미 실행 중이거나 완료되어 새 작업을 만들지 않고 동일 작업 상태를 확인합니다.");
    navigate("publishing");
  }, [authenticatedOperationsFetch, navigate, notify]);

  const editExternalActionProduct = useCallback((action: OperationsSnapshot["externalActions"][number]) => {
    setPublishingProduct({ id: action.productId, name: action.productName });
    setPublishingSession((current) => current + 1);
    setView("publishing");
    window.sessionStorage.setItem("sellerpilot:last-view:v1", "publishing");
    window.history.pushState({ view: "publishing", productId: action.productId }, "", `${window.location.pathname}?view=publishing&productId=${encodeURIComponent(action.productId)}`);
    setSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const retryProductPublishing = useCallback((product: DisplayProduct) => {
    setPublishingProduct({ id: product.sourceId, name: product.name });
    setPublishingSession((current) => current + 1);
    setView("publishing");
    window.sessionStorage.setItem("sellerpilot:last-view:v1", "publishing");
    window.history.pushState({ view: "publishing", productId: product.sourceId }, "", `${window.location.pathname}?view=publishing&productId=${encodeURIComponent(product.sourceId)}`);
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
    if (view === "registration-activity") return <RegistrationActivityPage activities={registrationActivities} activityState={operations.state === "unavailable" ? "unavailable" : operations.data?.registrationActivityState ?? "ready"} displayProducts={displayProducts} loading={operations.state === "loading"} onRefresh={operations.refresh} onOpenProduct={openProductDetails} onRetryProduct={retryProductPublishing} onRecoverAnalysis={recoverFailedProductAnalysis} onNewProduct={() => navigate("publishing")} onExternalActions={() => navigate("remediation")} />;
    if (view === "product-detail") return activeSelectedProduct
      ? <ProductDetailPage key={`${activeSelectedProduct.sourceId}:${activeSelectedProduct.updatedAt}`} product={activeSelectedProduct} onBack={() => window.history.back()} onEditChannels={() => retryProductPublishing(activeSelectedProduct)} onOpenActivity={() => navigate("registration-activity")} authenticatedFetch={operations.authenticatedFetch} notify={notify} onChanged={operations.refresh} />
      : <div className="product-detail-empty"><LoaderCircle className="spin" size={24} /><b>{operations.state === "loading" ? "상품 상세정보를 불러오는 중입니다." : "상품을 찾지 못했습니다."}</b><small>{operations.state === "loading" ? "운영 상품 원장을 확인하고 있습니다." : "상품 목록에서 다시 선택해 주세요."}</small>{operations.state !== "loading" ? <button type="button" className="ghost-button" onClick={() => navigate("products")}>상품 목록으로</button> : null}</div>;
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
      {toast && <div className={`toast notice-${toastTone}`} role="status" aria-live="polite"><span className="toast-icon">{toastTone === "error" ? <AlertCircle size={18} /> : toastTone === "warning" ? <AlertTriangle size={18} /> : toastTone === "info" ? <Activity size={18} /> : <CheckCircle2 size={18} />}</span><span className="toast-copy"><b>{toastTone === "error" ? "처리 오류" : toastTone === "warning" ? "확인 필요" : toastTone === "info" ? "진행 알림" : "처리 완료"}</b><span>{toast}</span></span><button type="button" aria-label="알림 닫기" onClick={dismissToast}><X size={14} /></button></div>}
    </main>
  );
}

export default function Home() {
  const [accessState, setAccessState] = useState<AdminAccessState>(isSupabaseConfigured ? "checking" : "signed_out");
  const [userEmail, setUserEmail] = useState("");
  const [accessErrorMessage, setAccessErrorMessage] = useState("");
  const [accessRetryKey, setAccessRetryKey] = useState(0);
  const [accountSwitchCleanup, setAccountSwitchCleanup] = useState<AccountSwitchCleanupState>("idle");
  const [pendingChannelOAuth, setPendingChannelOAuth] = useState<{ channel: "shopee" | "lazada" | "ebay"; code: string; state: string; shopId?: string; mainAccountId?: string } | null>(null);
  const [oauthNotice, setOauthNotice] = useState("");
  const oauthHandled = useRef(false);
  const accountSwitchingRef = useRef(false);

  useEffect(() => {
    if (!oauthNotice) return;
    const timer = window.setTimeout(() => setOauthNotice(""), toastDurationMs);
    return () => window.clearTimeout(timer);
  }, [oauthNotice]);

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
    let active = true;
    let verificationGeneration = 0;
    let verifiedAdminUserId = "";
    const failVerification = (generation: number) => {
      if (!active || accountSwitchingRef.current || generation !== verificationGeneration) return;
      verifiedAdminUserId = "";
      setAccessErrorMessage("인증 서버 응답이 지연되고 있습니다. 로그인 상태는 변경하지 않았습니다.");
      setAccessState("error");
    };
    const verifyAdmin = async (session: Session, generation: number) => {
      try {
        const [{ data: isAdmin, error }, { data: latestSession, error: sessionError }] = await withPromiseTimeout(Promise.all([
          supabase.rpc("sellerpilot_is_admin"),
          supabase.auth.getSession(),
        ]), 12_000, "관리자 권한 확인 시간이 초과되었습니다.");
        if (!active || accountSwitchingRef.current || generation !== verificationGeneration) return;
        if (sessionError) {
          failVerification(generation);
          return;
        }
        if (!latestSession.session) {
          verifiedAdminUserId = "";
          setUserEmail("");
          setAccessErrorMessage("");
          setAccessState("signed_out");
          return;
        }
        if (latestSession.session.user.id !== session.user.id) {
          startVerification(latestSession.session);
          return;
        }
        const verificationState = adminVerificationState(isAdmin, error);
        if (verificationState === "error") {
          failVerification(generation);
          return;
        }
        setUserEmail(session.user.email ?? "");
        setAccessErrorMessage("");
        if (verificationState === "admin") {
          verifiedAdminUserId = session.user.id;
          setAccessState("admin");
        } else {
          verifiedAdminUserId = "";
          setAccessState("forbidden");
        }
      } catch {
        failVerification(generation);
      }
    };
    const startVerification = (session: Session | null) => {
      if (!active || accountSwitchingRef.current) return;
      const generation = ++verificationGeneration;
      if (!session) {
        verifiedAdminUserId = "";
        setUserEmail("");
        setAccessErrorMessage("");
        setAccessState("signed_out");
        return;
      }
      void verifyAdmin(session, generation);
    };
    const initialGeneration = ++verificationGeneration;
    void withPromiseTimeout(supabase.auth.getSession(), 12_000, "로그인 세션 확인 시간이 초과되었습니다.")
      .then(({ data, error }) => {
        if (!active || initialGeneration !== verificationGeneration) return;
        if (error) {
          failVerification(initialGeneration);
          return;
        }
        startVerification(data.session);
      })
      .catch(() => failVerification(initialGeneration));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "SIGNED_OUT") {
        verificationGeneration += 1;
        verifiedAdminUserId = "";
        setUserEmail("");
        setAccessErrorMessage("");
        setAccessState("signed_out");
        return;
      }
      if (accountSwitchingRef.current) return;
      setAccessState((current) => nextAdminAccessState(current, event, Boolean(session && session.user.id === verifiedAdminUserId)));
      window.setTimeout(() => startVerification(session), 0);
    });
    return () => {
      active = false;
      verificationGeneration += 1;
      data.subscription.unsubscribe();
    };
  }, [accessRetryKey]);

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
      }
    };
    void completeChannelOAuth();
  }, [accessState, pendingChannelOAuth]);

  const login = async (email: string, password: string) => {
    if (!isSupabaseConfigured) return "운영 인증 서버가 아직 연결되지 않았습니다.";
    if (accountSwitchingRef.current) return "이전 계정 세션을 정리한 뒤 로그인해 주세요.";
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
    if (accountSwitchingRef.current) return "이전 계정 세션을 정리한 뒤 다시 시도해 주세요.";
    const redirectTo = `${window.location.origin}/auth/callback?next=/update-password`;
    const { error } = await createSupabaseClient().auth.resetPasswordForEmail(email, { redirectTo });
    return error ? "재설정 메일을 보내지 못했습니다. 관리자에게 문의해 주세요." : null;
  };

  const logout = async () => {
    if (accountSwitchingRef.current) return;
    accountSwitchingRef.current = true;
    setAccountSwitchCleanup("clearing");
    const showSignedOutImmediately = () => {
      setAccessErrorMessage("");
      setAccessState("signed_out");
      setUserEmail("");
    };
    if (!isSupabaseConfigured) {
      showSignedOutImmediately();
      accountSwitchingRef.current = false;
      setAccountSwitchCleanup("idle");
      return;
    }
    try {
      // Await the singleton client's cleanup before enabling login. A detached
      // signOut could otherwise finish later and erase the newly signed-in account.
      await switchAccountWithLocalSessionCleanup(createSupabaseClient().auth, showSignedOutImmediately);
      accountSwitchingRef.current = false;
      setAccountSwitchCleanup("idle");
    } catch {
      setAccountSwitchCleanup("failed");
    }
  };

  const retryAccountSwitchCleanup = () => {
    accountSwitchingRef.current = false;
    void logout();
  };

  if (accessState === "checking") {
    return <main className="login-shell"><section className="login-form-panel"><div className="login-card"><LoaderCircle className="spin" size={24} /><h2>관리자 권한 확인 중</h2><p>로그인 세션과 운영 데이터 접근 권한을 안전하게 확인하고 있습니다.</p></div></section></main>;
  }
  if (accessState === "error") {
    return <main className="login-shell"><section className="login-form-panel"><div className="login-card"><AlertTriangle size={26} /><h2>관리자 권한 확인이 지연되고 있습니다.</h2><p>{accessErrorMessage || "인증 서버 응답을 받지 못했습니다."} 잠시 후 현재 세션으로 다시 확인해 주세요.</p><button type="button" className="login-submit" onClick={() => { setAccessErrorMessage(""); setAccessState("checking"); setAccessRetryKey((current) => current + 1); }}><RefreshCw size={16} />현재 세션 다시 확인</button></div></section></main>;
  }
  if (accessState === "forbidden") {
    return <main className="login-shell"><section className="login-form-panel"><div className="login-card"><AlertTriangle size={26} /><h2>관리자 권한이 필요합니다.</h2><p>{userEmail || "현재 계정"}은 SellerPilot 관리자 명단에 없습니다. Supabase의 <b>sellerpilot_private.admin_users</b> 승인 후 접근할 수 있습니다.</p><button type="button" className="login-submit" onClick={() => void logout()}><LogOut size={16} />다른 계정으로 로그인</button></div></section></main>;
  }
  return accessState === "admin"
    ? <><DashboardShell onLogout={logout} userEmail={userEmail} />{oauthNotice && <div className="toast"><KeyRound size={18} /><span>{oauthNotice}</span><button onClick={() => setOauthNotice("")}><X size={14} /></button></div>}</>
    : <LoginScreen onLogin={login} onPasswordReset={resetPassword} sessionCleanupState={accountSwitchCleanup} onRetrySessionCleanup={retryAccountSwitchCleanup} />;
}
