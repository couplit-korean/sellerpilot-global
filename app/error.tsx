"use client";

import { Home, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import "./error-state.css";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("SellerPilot page error", { message: error.message, digest: error.digest });
  }, [error]);

  return <main className="error-page">
    <section className="error-card" role="alert" aria-labelledby="page-error-title">
      <header className="error-brand"><span>S</span><b>SellerPilot</b></header>
      <div className="error-symbol" aria-hidden="true"><TriangleAlert size={28} /></div>
      <p className="error-eyebrow">잠시 문제가 생겼어요</p>
      <h1 id="page-error-title">화면을 불러오지 못했습니다</h1>
      <p className="error-description">일시적인 연결 문제일 수 있습니다. 다시 시도하면 작성하던 화면으로 돌아갑니다.</p>
      <div className="error-assurance"><ShieldCheck size={18} /><span><b>저장된 정보는 그대로 유지됩니다</b><small>이미 저장한 상품과 판매 채널 연결 정보는 영향을 받지 않습니다.</small></span></div>
      <div className="error-actions">
        <button type="button" className="error-primary" onClick={reset}><RefreshCw size={17} />다시 시도</button>
        <Link className="error-secondary" href="/"><Home size={17} />홈으로 이동</Link>
      </div>
      <small className="error-help">같은 문제가 반복되면 잠시 후 다시 접속해 주세요.</small>
    </section>
  </main>;
}
