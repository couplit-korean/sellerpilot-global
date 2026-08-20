"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("SellerPilot page error", { message: error.message, digest: error.digest });
  }, [error]);

  return <main className="login-shell"><section className="login-form-panel"><div className="login-card">
    <AlertTriangle size={28} />
    <h2>화면을 불러오지 못했습니다.</h2>
    <p>입력 중인 비밀값은 서버에 전송되지 않았습니다. 잠시 후 다시 시도하고, 반복되면 배포 로그의 오류 식별자를 확인해 주세요.</p>
    {error.digest && <code>{error.digest}</code>}
    <button type="button" className="login-submit" onClick={reset}><RefreshCw size={16} />다시 시도</button>
  </div></section></main>;
}
