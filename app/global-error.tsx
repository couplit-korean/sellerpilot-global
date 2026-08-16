"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="ko"><body><main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "system-ui, sans-serif", background: "#f5f3ee" }}>
    <section style={{ maxWidth: 520, padding: 32, border: "1px solid #dedbd2", borderRadius: 8, background: "white" }}>
      <h1 style={{ marginTop: 0 }}>SellerPilot을 다시 시작해 주세요.</h1>
      <p>앱의 공통 화면에서 오류가 발생했습니다. 저장된 운영 데이터와 자격증명은 영향을 받지 않습니다.</p>
      <button type="button" onClick={reset} style={{ padding: "10px 16px", border: 0, borderRadius: 5, background: "#222", color: "white", fontWeight: 700 }}>다시 시도</button>
    </section>
  </main></body></html>;
}
