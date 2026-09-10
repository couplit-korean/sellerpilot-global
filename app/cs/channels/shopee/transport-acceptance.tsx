import type { ShopeeTransportAcceptance } from
  "../../../../lib/cs/channels/shopee/transport-acceptance";

const buyerChatReason = {
  live_push_unverified: "승인된 live push와 실제 callback 수신 readback이 없어 운영 수신으로 인정하지 않습니다.",
  document_permission_denied: "현재 앱은 SellerChat 이력 문서 권한이 없어 endpoint를 추측하지 않습니다.",
  reply_contract_unavailable: "현재 앱에서 공식 답변 계약을 확인할 수 없어 전송 기능을 열지 않습니다.",
} as const;

export function ShopeeTransportAcceptanceStatus({ transport }: {
  transport: ShopeeTransportAcceptance;
}) {
  return <section aria-label="Shopee transport 수락 범위">
    <h3>Shopee transport 수락 범위</h3>
    <p>상품 후기·댓글과 Returns는 공식 조회 경로를 통해 저장합니다. Buyer Chat은 push, 이력, 답변을 각각 fail-closed로 유지합니다.</p>
    <div>
      {transport.supported.map(surface => <article key={surface.key} data-surface={surface.key}>
        <strong>{surface.label}</strong>
        <p>수신 가능 · 이력 가능 · 답변 {surface.reply ? "가능" : "미지원"}</p>
        <code>{surface.providerReadPaths.join(" · ")}</code>
      </article>)}
      {transport.buyerChat.map(surface => <article key={surface.key} data-surface={surface.key}>
        <strong>{surface.label}</strong>
        <p>운영 미수락 · {buyerChatReason[surface.reason]}</p>
      </article>)}
    </div>
  </section>;
}
