import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateWorkspaceIdleState,
  clampWorkspaceIdleTimeoutMs,
  createUserWorkspaceRecord,
  defaultWorkspaceIdleTimeoutMs,
  maximumWorkspaceIdleTimeoutMs,
  minimumWorkspaceIdleTimeoutMs,
  parseSellerPilotWorkspaceView,
  parseUserWorkspaceRecord,
  readUserWorkspaceStorage,
  recordUserWorkspaceActivity,
  sanitizeUserWorkspaceRoute,
  selectWorkspaceInitialRouteSource,
  serializeUserWorkspaceRecord,
  userWorkspaceStorageKey,
} from "../lib/user-workspace-session.ts";

test("selects only account-scoped history while preserving intentional direct links", () => {
  const currentWorkspaceScope = userWorkspaceStorageKey("admin-a")!;
  const otherWorkspaceScope = userWorkspaceStorageKey("admin-b")!;

  assert.equal(selectWorkspaceInitialRouteSource({
    freshLogin: true,
    currentWorkspaceScope,
    historyWorkspaceScope: otherWorkspaceScope,
    hasStoredRoute: true,
  }), "stored");
  assert.equal(selectWorkspaceInitialRouteSource({
    freshLogin: true,
    currentWorkspaceScope,
    historyWorkspaceScope: otherWorkspaceScope,
    hasStoredRoute: false,
  }), "default");
  assert.equal(selectWorkspaceInitialRouteSource({
    freshLogin: true,
    currentWorkspaceScope,
    historyWorkspaceScope: undefined,
    hasStoredRoute: false,
  }), "default");
  assert.equal(selectWorkspaceInitialRouteSource({
    freshLogin: false,
    currentWorkspaceScope,
    historyWorkspaceScope: undefined,
    hasStoredRoute: false,
  }), "direct");
  assert.equal(selectWorkspaceInitialRouteSource({
    freshLogin: false,
    currentWorkspaceScope,
    historyWorkspaceScope: currentWorkspaceScope,
    hasStoredRoute: false,
  }), "scoped-current");
  assert.equal(selectWorkspaceInitialRouteSource({
    freshLogin: false,
    currentWorkspaceScope,
    historyWorkspaceScope: otherWorkspaceScope,
    hasStoredRoute: false,
  }), "default");
});

test("parses only exact SellerPilot views", () => {
  assert.equal(parseSellerPilotWorkspaceView("publishing"), "publishing");
  assert.equal(parseSellerPilotWorkspaceView("product-detail"), "product-detail");
  assert.equal(parseSellerPilotWorkspaceView(" publishing "), null);
  assert.equal(parseSellerPilotWorkspaceView("toString"), null);
  assert.equal(parseSellerPilotWorkspaceView({ view: "overview" }), null);
});

test("creates distinct encoded storage keys for each user", () => {
  const first = userWorkspaceStorageKey("user/a@example.com");
  const second = userWorkspaceStorageKey("user:b@example.com");

  assert.ok(first?.startsWith("sellerpilot:last-workspace:v1:"));
  assert.notEqual(first, second);
  assert.match(first ?? "", /user%2Fa%40example\.com$/);
  assert.equal(userWorkspaceStorageKey("   "), null);
  assert.equal(userWorkspaceStorageKey("bad\u0000user"), null);
  assert.equal(userWorkspaceStorageKey("\ud800"), null);
});

test("defaults and clamps configurable idle timeouts", () => {
  assert.equal(clampWorkspaceIdleTimeoutMs(undefined), defaultWorkspaceIdleTimeoutMs);
  assert.equal(clampWorkspaceIdleTimeoutMs(Number.NaN), defaultWorkspaceIdleTimeoutMs);
  assert.equal(clampWorkspaceIdleTimeoutMs(1), minimumWorkspaceIdleTimeoutMs);
  assert.equal(clampWorkspaceIdleTimeoutMs(10 * 60_000 + 0.9), 10 * 60_000);
  assert.equal(clampWorkspaceIdleTimeoutMs(Number.MAX_SAFE_INTEGER), maximumWorkspaceIdleTimeoutMs);
});

test("calculates activity expiry at the default thirty-minute boundary", () => {
  const active = calculateWorkspaceIdleState(1_000, 1_000 + 29 * 60_000);
  const expired = calculateWorkspaceIdleState(1_000, 1_000 + 30 * 60_000);

  assert.deepEqual(active, {
    idleTimeoutMs: defaultWorkspaceIdleTimeoutMs,
    expiresAt: 1_000 + 30 * 60_000,
    remainingMs: 60_000,
    expired: false,
  });
  assert.equal(expired?.remainingMs, 0);
  assert.equal(expired?.expired, true);
  assert.equal(calculateWorkspaceIdleState(2_000, 1_000), null);
});

test("keeps idle expiry enforceable when local storage reads throw", () => {
  const raw = readUserWorkspaceStorage(() => {
    throw new DOMException("Storage access is blocked", "SecurityError");
  });
  const localLastActivityAt = 1_000;
  const now = localLastActivityAt + defaultWorkspaceIdleTimeoutMs;

  assert.equal(raw, null);
  assert.equal(calculateWorkspaceIdleState(localLastActivityAt, now)?.expired, true);
});

test("round-trips a user-scoped last workspace without cross-user restoration", () => {
  const record = createUserWorkspaceRecord({
    userId: "admin-a",
    view: "registration-activity",
    route: "/?view=registration-activity&status=failed&code=oauth-secret",
    now: 10_000,
  });
  assert.ok(record);
  const raw = serializeUserWorkspaceRecord(record!);
  const sameUser = parseUserWorkspaceRecord({ raw, userId: "admin-a", now: 20_000 });
  const otherUser = parseUserWorkspaceRecord({ raw, userId: "admin-b", now: 20_000 });

  assert.equal(sameUser.status, "ready");
  assert.equal(sameUser.record?.view, "registration-activity");
  assert.equal(sameUser.record?.route, "/?view=registration-activity&status=failed");
  assert.equal(sameUser.record?.route.includes("oauth-secret"), false);
  assert.equal(otherUser.status, "invalid");
  assert.equal(otherUser.record, null);
});

test("keeps only bounded query state supported by the selected workspace view", () => {
  assert.equal(
    sanitizeUserWorkspaceRoute("/?view=product-detail&productId=product-123&status=failed&ticketId=secret", "product-detail"),
    "/?view=product-detail&productId=product-123",
  );
  assert.equal(
    sanitizeUserWorkspaceRoute("/?view=registration-activity&status=blocked&productId=ignored", "registration-activity"),
    "/?view=registration-activity&status=blocked",
  );
  assert.equal(
    sanitizeUserWorkspaceRoute("/?view=cs&channel=coupang&status=reconciliation&ticketId=ticket-9&code=secret", "cs"),
    "/?view=cs&channel=coupang&status=reconciliation&ticketId=ticket-9",
  );
  assert.equal(
    sanitizeUserWorkspaceRoute("/?view=orders&orderId=order-42&productId=ignored", "orders"),
    "/?view=orders&orderId=order-42",
  );
});

test("rejects cross-origin and path escape attempts from persisted workspace routes", () => {
  for (const route of [
    "https://evil.example/?view=products",
    "//evil.example/?view=products",
    "/\\evil.example/?view=products",
    "/%2f%2fevil.example/?view=products",
    "/another-page?view=products",
  ]) {
    assert.equal(sanitizeUserWorkspaceRoute(route, "products"), "/?view=products");
  }
});

test("legacy records without a route restore only their validated view", () => {
  const raw = JSON.stringify({
    version: 1,
    userScope: "admin-a",
    view: "margin",
    lastActivityAt: 10_000,
  });
  const restored = parseUserWorkspaceRecord({ raw, userId: "admin-a", now: 20_000 });

  assert.equal(restored.status, "ready");
  assert.equal(restored.record?.route, "/?view=margin");
});

test("reports malformed, future, and expired stored sessions without side effects", () => {
  assert.equal(parseUserWorkspaceRecord({ raw: null, userId: "admin-a", now: 1 }).status, "missing");
  assert.equal(parseUserWorkspaceRecord({ raw: "{", userId: "admin-a", now: 1 }).status, "invalid");

  const future = createUserWorkspaceRecord({ userId: "admin-a", view: "overview", now: 2_000 });
  assert.equal(parseUserWorkspaceRecord({
    raw: serializeUserWorkspaceRecord(future!),
    userId: "admin-a",
    now: 1_000,
  }).status, "invalid");

  const expired = createUserWorkspaceRecord({ userId: "admin-a", view: "products", now: 1_000 });
  const restored = parseUserWorkspaceRecord({
    raw: serializeUserWorkspaceRecord(expired!),
    userId: "admin-a",
    now: 1_000 + defaultWorkspaceIdleTimeoutMs,
  });
  assert.equal(restored.status, "expired");
  assert.equal(restored.record?.view, "products");
});

test("records activity before expiry and refuses to revive an expired session", () => {
  const record = createUserWorkspaceRecord({ userId: "admin-a", view: "publishing", now: 1_000 });
  assert.ok(record);
  const touched = recordUserWorkspaceActivity(record!, 1_000 + 10 * 60_000);
  assert.equal(touched?.lastActivityAt, 1_000 + 10 * 60_000);

  const touchedIdle = calculateWorkspaceIdleState(
    touched!.lastActivityAt,
    1_000 + 35 * 60_000,
  );
  assert.equal(touchedIdle?.expired, false);
  assert.equal(recordUserWorkspaceActivity(record!, 1_000 + defaultWorkspaceIdleTimeoutMs), null);
});
