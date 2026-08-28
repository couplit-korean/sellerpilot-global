"use client";

import { BellRing, CheckCircle2, Download, LoaderCircle, Smartphone, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useModalInteraction } from "./use-modal-interaction";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;
type PushState = "checking" | "available" | "subscribed" | "denied" | "unsupported" | "unconfigured" | "error";
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const mobilePushDismissedKey = "sellerpilot:mobile-push-dismissed:session";

function subscribeToClientMount() {
  return () => undefined;
}

function getClientMountSnapshot() {
  return true;
}

function getServerMountSnapshot() {
  return false;
}

function mobilePushDismissedForSession() {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(mobilePushDismissedKey) === "1";
  } catch {
    return false;
  }
}

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function serializeSubscription(subscription: PushSubscription) {
  const value = subscription.toJSON();
  const p256dh = value.keys?.p256dh ?? "";
  const auth = value.keys?.auth ?? "";
  if (!value.endpoint || !p256dh || !auth) throw new Error("Android 알림 구독 정보를 읽지 못했습니다.");
  return { endpoint: value.endpoint, keys: { p256dh, auth }, deviceLabel: "SellerPilot Android" };
}

export function MobilePushManager({ authenticatedFetch }: { authenticatedFetch: AuthenticatedFetch }) {
  const [state, setState] = useState<PushState>("checking");
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isAndroid] = useState(() => typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent));
  const [isStandalone, setIsStandalone] = useState(() => typeof window !== "undefined" && window.matchMedia("(display-mode: standalone)").matches);
  const mounted = useSyncExternalStore(subscribeToClientMount, getClientMountSnapshot, getServerMountSnapshot);
  const [dismissed, setDismissed] = useState(mobilePushDismissedForSession);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const standaloneGateRef = useRef<HTMLElement>(null);
  const standaloneGateDismissRef = useRef<HTMLButtonElement>(null);

  const loadConfiguration = useCallback(async () => {
    const response = await authenticatedFetch("/api/admin/push-subscriptions");
    const payload = await response.json().catch(() => ({ configured: false, publicKey: "" })) as { configured?: boolean; publicKey?: string; message?: string };
    if (!response.ok) throw new Error(payload.message ?? "푸시 알림 설정을 읽지 못했습니다.");
    return { configured: payload.configured === true, publicKey: payload.publicKey ?? "" };
  }, [authenticatedFetch]);

  useEffect(() => {
    if (!mounted || dismissed || (!isAndroid && !isStandalone)) return;
    const onInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
      setMessage("SellerPilot이 Android 홈 화면에 설치됐습니다.");
    };
    window.addEventListener("beforeinstallprompt", onInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    const initialize = async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState("unsupported");
        return;
      }
      const config = await loadConfiguration();
      if (!config.configured || !config.publicKey) {
        setState("unconfigured");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      const current = await registration.pushManager.getSubscription();
      setSubscription(current);
      if (Notification.permission === "denied") setState("denied");
      else if (current && Notification.permission === "granted") setState("subscribed");
      else setState("available");
    };
    void initialize().catch(() => setState("error"));
    return () => {
      window.removeEventListener("beforeinstallprompt", onInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [dismissed, isAndroid, isStandalone, loadConfiguration, mounted]);

  const dismissForSession = useCallback(() => {
    try {
      window.sessionStorage.setItem(mobilePushDismissedKey, "1");
    } catch {
      // The in-memory state still closes the gate when storage is unavailable.
    }
    setDismissed(true);
  }, []);

  const standaloneGateOpen = mounted
    && isStandalone
    && !dismissed
    && state !== "checking"
    && state !== "subscribed";
  useModalInteraction(standaloneGateOpen, standaloneGateRef, dismissForSession, {
    dismissible: !busy,
    initialFocusRef: standaloneGateDismissRef,
  });

  useEffect(() => {
    if (dismissed || state !== "subscribed") return;
    const timer = window.setTimeout(dismissForSession, 2_000);
    return () => window.clearTimeout(timer);
  }, [dismissForSession, dismissed, state]);

  const sendTest = useCallback(async (current: PushSubscription) => {
    const response = await authenticatedFetch("/api/admin/push-notifications/test", {
      method: "POST",
      body: JSON.stringify({ endpoint: current.endpoint }),
    });
    const payload = await response.json().catch(() => ({ message: "테스트 알림 응답을 읽지 못했습니다." })) as { message?: string };
    if (!response.ok) throw new Error(payload.message ?? "테스트 알림을 전송하지 못했습니다.");
    setMessage(payload.message ?? "테스트 알림을 전송했습니다.");
  }, [authenticatedFetch]);

  const enableNotifications = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState("denied");
        setMessage("Android 설정에서 SellerPilot 알림 권한을 허용해 주세요.");
        return;
      }
      const config = await loadConfiguration();
      if (!config.configured || !config.publicKey) {
        setState("unconfigured");
        throw new Error("운영 푸시 알림 키가 아직 설정되지 않았습니다.");
      }
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.publicKey),
      });
      const response = await authenticatedFetch("/api/admin/push-subscriptions", {
        method: "POST",
        body: JSON.stringify(serializeSubscription(current)),
      });
      const payload = await response.json().catch(() => ({ message: "알림 구독 응답을 읽지 못했습니다." })) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? "알림 구독을 저장하지 못했습니다.");
      setSubscription(current);
      setState("subscribed");
      setMessage(payload.message ?? "주문·배송 알림이 연결됐습니다.");
      await sendTest(current);
    } catch (error) {
      setState((current) => current === "unconfigured" ? current : "error");
      setMessage(error instanceof Error ? error.message : "Android 알림을 연결하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }, [authenticatedFetch, busy, loadConfiguration, sendTest]);

  const installApp = useCallback(async () => {
    if (!installPrompt) {
      setMessage("Chrome 메뉴에서 ‘홈 화면에 추가’ 또는 ‘앱 설치’를 선택해 주세요.");
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setMessage("Android 앱 설치를 진행합니다.");
    setInstallPrompt(null);
  }, [installPrompt]);

  if (!mounted || dismissed || (!isAndroid && !isStandalone)) return null;
  if (state === "checking") return <div className="mobile-push-chip checking" role="status"><LoaderCircle className="spin" size={15} /><span><b>앱 알림 확인 중</b></span><button type="button" className="mobile-push-chip-dismiss" onClick={dismissForSession} aria-label="앱 알림 상태 닫기"><X size={14} /></button></div>;
  if (state === "subscribed") {
    return <div className="mobile-push-chip ready" role="status"><CheckCircle2 size={16} /><span><b>주문·배송 알림 사용 중</b><small>{message || "새 주문과 배송 상태를 즉시 알려드립니다."}</small></span>{subscription && <button type="button" onClick={() => void sendTest(subscription)} disabled={busy}>테스트</button>}<button type="button" className="mobile-push-chip-dismiss" onClick={dismissForSession} aria-label="주문 배송 알림 상태 닫기"><X size={14} /></button></div>;
  }

  return <section ref={standaloneGateRef} tabIndex={-1} className={`mobile-push-gate ${isStandalone ? "standalone" : "browser"}`} role="dialog" aria-label="Android 주문 배송 알림 설정" aria-modal={isStandalone || undefined}>
      <button ref={standaloneGateDismissRef} type="button" className="mobile-push-gate-dismiss" onClick={dismissForSession} aria-label="알림 설정 나중에 하기" disabled={busy}><X size={15} />나중에</button>
      <div className="mobile-push-gate-icon">{state === "denied" || state === "error" ? <TriangleAlert size={23} /> : <BellRing size={23} />}</div>
      <div className="mobile-push-gate-copy">
        <span>ANDROID APP · REQUIRED ALERTS</span>
        <h2>주문·배송 알림을 켜 주세요.</h2>
        <p>{state === "unsupported" ? "현재 브라우저는 앱 푸시 알림을 지원하지 않습니다. Android Chrome 최신 버전을 사용해 주세요." : state === "unconfigured" ? "운영 푸시 키 설정이 완료될 때까지 잠시 기다려 주세요." : state === "denied" ? "알림 권한이 차단됐습니다. Android 설정 → 앱 → Chrome 또는 SellerPilot → 알림에서 허용해 주세요." : "새 주문, 출고 준비, 배송 시작과 배송 완료를 놓치지 않도록 이 기기를 연결합니다."}</p>
        {message && <small>{message}</small>}
      </div>
      <div className="mobile-push-gate-actions">
        {!isStandalone && <button type="button" className="secondary" onClick={() => void installApp()}><Download size={16} />앱 설치</button>}
        {!(["unsupported", "unconfigured"] as PushState[]).includes(state) && <button type="button" className="primary" onClick={() => void enableNotifications()} disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Smartphone size={16} />}알림 허용</button>}
      </div>
  </section>;
}
