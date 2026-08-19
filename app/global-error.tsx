"use client";

import { RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import "./error-state.css";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="ko"><body><main className="error-page">
    <section className="error-card" role="alert" aria-labelledby="global-error-title">
      <header className="error-brand"><span>S</span><b>SellerPilot</b></header>
      <div className="error-symbol" aria-hidden="true"><TriangleAlert size={28} /></div>
      <p className="error-eyebrow">서비스를 잠시 불러오지 못했어요</p>
      <h1 id="global-error-title">잠시 후 다시 시도해 주세요</h1>
      <p className="error-description">일시적인 문제로 화면을 열지 못했습니다. 아래 버튼을 누르면 안전하게 다시 시작합니다.</p>
      <div className="error-assurance"><ShieldCheck size={18} /><span><b>저장된 정보는 그대로 유지됩니다</b><small>이미 저장한 상품과 판매 채널 연결 정보는 영향을 받지 않습니다.</small></span></div>
      <div className="error-actions single"><button type="button" className="error-primary" onClick={reset}><RefreshCw size={17} />다시 시작</button></div>
      <small className="error-help">같은 문제가 반복되면 브라우저를 새로고침해 주세요.</small>
    </section>
  </main></body></html>;
}
