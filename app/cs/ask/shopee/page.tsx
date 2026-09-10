"use client";

import { FormEvent, useMemo, useState } from "react";

export default function ShopeeAskPage() {
  const formUrl = useMemo(() => {
    if (typeof window === "undefined") return "https://sellerpilot-global.vercel.app/cs/ask/shopee";
    return `${window.location.origin}/cs/ask/shopee`;
  }, []);
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = {
      customerName: String(new FormData(form).get("customerName") ?? "").trim(),
      orderSn: String(new FormData(form).get("orderSn") ?? "").trim(),
      itemId: String(new FormData(form).get("itemId") ?? "").trim(),
      inquiry: String(new FormData(form).get("inquiry") ?? "").trim(),
    };
    if (!body.customerName || !body.inquiry) {
      setStatus("error");
      setMessage("이름과 문의 내용을 입력해 주세요.");
      return;
    }
    setStatus("sending");
    setMessage("");
    const response = await fetch("/api/cs/public/shopee-ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus("error");
      setMessage(typeof result.message === "string" ? result.message : "접수가 저장되지 않았습니다.");
      return;
    }
    setStatus("ok");
    setMessage("문의가 SellerPilot 쇼피 CS에 접수됐습니다.");
    form.reset();
  }

  return (
    <main style={{ maxWidth: 640, margin: "40px auto", padding: "0 20px", fontFamily: "sans-serif" }}>
      <p style={{ letterSpacing: "0.08em", fontSize: 12, color: "#666" }}>SHOPEE INQUIRY</p>
      <h1>쇼피 상품 문의</h1>
      <p>채팅 공개 API가 없어 상품 상세에는 이 페이지 링크만 넣습니다. 접수는 SellerPilot 쇼피 CS 함에 들어갑니다.</p>
      <p style={{ background: "#f4f4f4", padding: 12, wordBreak: "break-all" }}>{formUrl}</p>
      <form onSubmit={(event) => void onSubmit(event)} style={{ display: "grid", gap: 12, marginTop: 24 }}>
        <label>이름<input name="customerName" required maxLength={80} /></label>
        <label>주문번호<input name="orderSn" maxLength={64} /></label>
        <label>상품번호<input name="itemId" maxLength={32} /></label>
        <label>문의 내용<textarea name="inquiry" required maxLength={4000} rows={6} /></label>
        <button type="submit" disabled={status === "sending"}>{status === "sending" ? "접수 중" : "문의 보내기"}</button>
      </form>
      {message ? <p>{message}</p> : null}
    </main>
  );
}
