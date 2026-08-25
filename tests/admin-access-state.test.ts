import assert from "node:assert/strict";
import test from "node:test";
import {
  adminVerificationState,
  clearLocalAccountSession,
  nextAdminAccessState,
  switchAccountWithLocalSessionCleanup,
} from "../app/_auth/admin-access-state";
import {
  ACCOUNT_SWITCH_LOGOUT_TIMEOUT_MS,
  createBrowserSupabaseFetch,
} from "../lib/supabase/client";

test("keeps the mounted admin workspace during token refresh sign-in events", () => {
  assert.equal(nextAdminAccessState("admin", "SIGNED_IN", true), "admin");
  assert.equal(nextAdminAccessState("admin", "INITIAL_SESSION", true), "admin");
});

test("uses checking for unresolved sessions and signs out explicitly", () => {
  assert.equal(nextAdminAccessState("signed_out", "SIGNED_IN"), "checking");
  assert.equal(nextAdminAccessState("forbidden", "INITIAL_SESSION"), "checking");
  assert.equal(nextAdminAccessState("error", "SIGNED_IN"), "checking");
  assert.equal(nextAdminAccessState("admin", "SIGNED_OUT"), "signed_out");
  assert.equal(nextAdminAccessState("admin", "SIGNED_IN", false), "checking");
});

test("keeps a bounded verification error until a new sign-in event or explicit retry", () => {
  assert.equal(nextAdminAccessState("error", "TOKEN_REFRESHED"), "error");
  assert.equal(nextAdminAccessState("error", "INITIAL_SESSION"), "checking");
});

test("distinguishes an admin denial from a retryable RPC failure", () => {
  assert.equal(adminVerificationState(true, null), "admin");
  assert.equal(adminVerificationState(false, null), "forbidden");
  assert.equal(adminVerificationState(false, new Error("network unavailable")), "error");
  assert.equal(adminVerificationState(null, null), "error");
  assert.equal(adminVerificationState(undefined, null), "error");
});

test("account switching becomes visible before awaiting local Supabase cleanup", async () => {
  const order: string[] = [];
  let finishSignOut!: (value: { error: unknown | null }) => void;
  const signOutResult = new Promise<{ error: unknown | null }>((resolve) => {
    finishSignOut = resolve;
  });
  const auth = {
    signOut(options: { scope: "local" }) {
      order.push(`signOut:${options.scope}`);
      return signOutResult;
    },
    async getSession() {
      order.push("getSession");
      return { data: { session: null }, error: null };
    },
  };

  let settled = false;
  const switching = switchAccountWithLocalSessionCleanup(auth, () => order.push("visible"))
    .then((result) => {
      settled = true;
      return result;
    });
  assert.deepEqual(order, ["visible", "signOut:local"]);
  assert.equal(settled, false);

  finishSignOut({ error: new Error("logout endpoint timed out") });
  assert.deepEqual(await switching, { remoteRevoked: false });
  assert.deepEqual(order, ["visible", "signOut:local", "getSession"]);
});

test("account switching refuses to unlock when the local session remains", async () => {
  await assert.rejects(
    clearLocalAccountSession({
      async signOut(options) {
        assert.deepEqual(options, { scope: "local" });
        return { error: null };
      },
      async getSession() {
        return { data: { session: { access_token: "test-only" } }, error: null };
      },
    }),
    /local Supabase session was not cleared/,
  );
});

test("only the Supabase logout endpoint receives the bounded browser signal", async () => {
  assert.equal(ACCOUNT_SWITCH_LOGOUT_TIMEOUT_MS, 5_000);
  let logoutSignal: AbortSignal | null = null;
  const hangingFetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    logoutSignal = init?.signal ?? null;
    logoutSignal?.addEventListener("abort", () => reject(logoutSignal?.reason), { once: true });
  })) as typeof fetch;
  const boundedFetch = createBrowserSupabaseFetch(15, hangingFetch);
  const startedAt = Date.now();
  const keepEventLoopAlive = setTimeout(() => undefined, 1_000);
  try {
    await assert.rejects(boundedFetch("https://example.supabase.co/auth/v1/logout?scope=local"));
  } finally {
    clearTimeout(keepEventLoopAlive);
  }
  const elapsedMs = Date.now() - startedAt;
  assert.equal(logoutSignal?.aborted, true);
  assert.equal(elapsedMs >= 5, true);
  assert.equal(elapsedMs < 1_000, true);

  const init = { method: "GET" } satisfies RequestInit;
  let receivedInit: RequestInit | undefined;
  const immediateFetch = ((_input: RequestInfo | URL, requestInit?: RequestInit) => {
    receivedInit = requestInit;
    return Promise.resolve(new Response(null, { status: 204 }));
  }) as typeof fetch;
  await createBrowserSupabaseFetch(15, immediateFetch)("https://example.supabase.co/rest/v1/products", init);
  assert.equal(receivedInit, init);
});
