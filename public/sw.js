/* SellerPilot Android/PWA push service worker. No authenticated pages are cached. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "주문 또는 배송 상태가 변경되었습니다." };
  }
  const title = typeof data.title === "string" ? data.title : "SellerPilot 주문·배송 알림";
  const body = typeof data.body === "string" ? data.body : "새로운 판매 업무를 확인해 주세요.";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/?view=orders";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: typeof data.icon === "string" ? data.icon : "/icon-192.png",
    badge: typeof data.badge === "string" ? data.badge : "/badge-96.png",
    tag: typeof data.tag === "string" ? data.tag : undefined,
    renotify: true,
    vibrate: [180, 80, 180],
    data: { url, type: data.type || "purchase", receivedAt: Date.now() },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/?view=orders", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("navigate" in client) await client.navigate(target);
      if ("focus" in client) return client.focus();
    }
    return self.clients.openWindow(target);
  })());
});
