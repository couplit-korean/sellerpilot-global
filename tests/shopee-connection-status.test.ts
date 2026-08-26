import assert from "node:assert/strict";
import test from "node:test";
import { resolveShopeeConnectionStatus } from "../lib/channels/shopee-connection-status";

test("Shopee connection status fails closed when its verification RPC fails", () => {
  assert.equal(resolveShopeeConnectionStatus({ rpcFailed: true, previous: "provider_verified" }), "status_unavailable");
  assert.equal(resolveShopeeConnectionStatus({ rpcFailed: true, previous: "oauth_reconnect_required" }), "oauth_reconnect_required");
  assert.equal(resolveShopeeConnectionStatus({ rpcFailed: true }), "status_unavailable");
});

test("Shopee connection status uses only provider-returned states after a successful RPC", () => {
  assert.equal(resolveShopeeConnectionStatus({ rpcFailed: false, current: "provider_verified" }), "provider_verified");
  assert.equal(resolveShopeeConnectionStatus({ rpcFailed: false, current: "oauth_reconnect_required" }), "oauth_reconnect_required");
  assert.equal(resolveShopeeConnectionStatus({ rpcFailed: false }), "status_unavailable");
});
