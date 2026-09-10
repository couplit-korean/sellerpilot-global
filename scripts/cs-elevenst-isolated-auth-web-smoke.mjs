import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import { PGlite } from "@electric-sql/pglite";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith(".css")) {
      return { format: "module", source: "export default {}", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const { ElevenstReadStateSummary } = await import("../app/cs/channels/elevenst/read-state.tsx");

if (process.env.NODE_ENV !== "test") throw new Error("ELEVENST_WEB_SMOKE_TEST_RUNTIME_REQUIRED");

const host = "127.0.0.1";
const portArgument = process.argv.find((value) => value.startsWith("--port="))?.slice(7) ?? "3214";
if (!/^\d{1,5}$/u.test(portArgument)) throw new Error("ELEVENST_WEB_SMOKE_PORT_INVALID");
const requestedPort = Number(portArgument);
if (!Number.isSafeInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
  throw new Error("ELEVENST_WEB_SMOKE_PORT_INVALID");
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function availablePort() {
  const reservation = createServer();
  const address = await listen(reservation, 0);
  assert.ok(address && typeof address === "object");
  await close(reservation);
  return address.port;
}

function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.once("exit", () => {
      clearTimeout(force);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

const db = new PGlite();
const token = randomBytes(32).toString("base64url");
const validAuthorization = `Bearer ${token}`;
const counters = { auth: 0, admin: 0, read: 0 };
let authServer;
let webProcess;

try {
  await db.exec(`
    create table elevenst_read_state (
      seller_id text primary key,
      payload jsonb not null
    );
  `);
  await db.query("insert into elevenst_read_state(seller_id, payload) values ($1, $2::jsonb)", [
    "couplit",
    JSON.stringify({
      sellerId: "couplit",
      sellerName: "커플릿",
      productQna: {
        checkedAt: "2026-09-08T07:30:00.000Z",
        httpStatus: 200,
        accepted: false,
        resultCode: "500",
        providerRows: 0,
        storedRowCount: 4,
        latestStoredReceivedAt: "2026-08-31T01:00:00.000Z",
      },
      urgentAlimi: {
        checkedAt: "2026-09-08T07:31:00.000Z",
        httpStatus: 200,
        accepted: true,
        resultCode: "0",
        providerRows: 0,
        storedRowCount: 0,
        latestStoredReceivedAt: null,
      },
    }),
  ]);

  authServer = createServer(async (request, response) => {
    const authorized = request.headers.authorization === validAuthorization;
    if (request.url === "/auth/v1/user") {
      counters.auth += 1;
      if (!authorized) return json(response, 401, { code: "bad_jwt", message: "invalid" });
      return json(response, 200, {
        id: "00000000-0000-4000-8000-000000000011",
        aud: "authenticated",
        role: "authenticated",
        email: "isolated@example.test",
        app_metadata: {},
        user_metadata: {},
        created_at: "2026-09-08T00:00:00.000Z",
      });
    }
    if (request.url === "/rest/v1/rpc/sellerpilot_is_admin") {
      counters.admin += 1;
      if (!authorized) return json(response, 401, { code: "bad_jwt", message: "invalid" });
      return json(response, 200, true);
    }
    if (request.url === "/rest/v1/rpc/sellerpilot_read_elevenst_cs_read_state_v1") {
      counters.read += 1;
      if (!authorized) return json(response, 401, { code: "bad_jwt", message: "invalid" });
      let requestBody = "";
      for await (const chunk of request) requestBody += chunk;
      const parsed = JSON.parse(requestBody || "{}");
      if (parsed.p_seller_id !== "couplit") return json(response, 400, { code: "scope_mismatch" });
      const result = await db.query("select payload from elevenst_read_state where seller_id = $1", ["couplit"]);
      return json(response, 200, result.rows[0]?.payload ?? null);
    }
    return json(response, 404, { code: "not_found" });
  });
  const authAddress = await listen(authServer, 0);
  assert.ok(authAddress && typeof authAddress === "object");
  const webPort = requestedPort || await availablePort();
  let stdout = "";
  let stderr = "";
  webProcess = spawn(process.execPath, [
    "node_modules/next/dist/bin/next", "dev", "--webpack", "--port", String(webPort), "--hostname", host,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: `http://${host}:${authAddress.port}`,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: randomBytes(24).toString("base64url"),
      SUPABASE_SECRET_KEY: randomBytes(24).toString("base64url"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  webProcess.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-20_000); });
  webProcess.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
  const endpoint = `http://${host}:${webPort}/api/admin/cs/channels/elevenst/read-state`;
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (webProcess.exitCode !== null) break;
    try {
      const response = await fetch(endpoint);
      if (response.status === 401) {
        ready = true;
        break;
      }
    } catch {
      // The dev server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error(`ELEVENST_WEB_SMOKE_START_FAILED:${stderr.slice(-1_000)}:${stdout.slice(-1_000)}`);

  const unauthorized = await fetch(endpoint);
  assert.equal(unauthorized.status, 401);
  assert.deepEqual(counters, { auth: 0, admin: 0, read: 0 });

  const invalid = await fetch(endpoint, { headers: { authorization: "Bearer invalid" } });
  assert.equal(invalid.status, 401);
  assert.equal(counters.read, 0);

  const authorized = await fetch(endpoint, { headers: { authorization: validAuthorization } });
  assert.equal(authorized.status, 200);
  const body = await authorized.json();
  assert.equal(body.contractVersion, "sellerpilot-elevenst-authenticated-read-state/3");
  assert.equal(body.productQna.providerState, "business_error");
  assert.equal(body.productQna.remoteCount, null);
  assert.equal(body.productQna.emptyConfirmed, false);
  assert.equal(body.urgentAlimi.providerState, "empty");
  assert.equal(body.urgentAlimi.remoteCount, 0);
  assert.equal(body.urgentAlimi.emptyConfirmed, true);
  assert.equal(body.sellerTalk.accessMode, "seller_office_session_only");
  assert.deepEqual(body.sellerTalk.retention, { maximum: 3, unit: "month", exactDays: null });
  assert.equal("retentionDays" in body.sellerTalk, false);
  assert.equal(body.sellerTalk.remoteCount, null);
  assert.equal(body.review.accessMode, "seller_office_export_only");
  assert.equal(body.review.remoteCount, null);
  assert.equal(body.review.automaticReplyAvailable, false);
  assert.equal(body.readOnly, true);
  assert.equal(counters.read, 1);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(token, "u"));
  const ui = renderToStaticMarkup(React.createElement(ElevenstReadStateSummary, { state: body }));
  assert.match(ui, /상품 Q&amp;A/u);
  assert.match(ui, /원격 건수<\/dt><dd>미확정/u);
  assert.match(ui, /통합 CS 원장<\/dt><dd>4건/u);
  assert.match(ui, /긴급알리미/u);
  assert.match(ui, /통합 CS 원장<\/dt><dd>0건/u);
  assert.match(ui, /셀러톡/u);
  assert.match(ui, /최대 3개월 · 정확한 일수 미확정/u);
  assert.match(ui, /리뷰·댓글/u);
  assert.match(ui, /Seller Office 내보내기 전용/u);
  assert.doesNotMatch(ui, new RegExp(token, "u"));

  process.stdout.write(`${JSON.stringify({
    contractVersion: body.contractVersion,
    database: "PGlite-memory",
    webRuntime: "next-dev",
    webHost: host,
    webPort,
    unauthorizedStatus: unauthorized.status,
    invalidTokenStatus: invalid.status,
    authorizedStatus: authorized.status,
    productQna: {
      providerState: body.productQna.providerState,
      remoteCount: body.productQna.remoteCount,
      emptyConfirmed: body.productQna.emptyConfirmed,
    },
    urgentAlimi: {
      providerState: body.urgentAlimi.providerState,
      remoteCount: body.urgentAlimi.remoteCount,
      emptyConfirmed: body.urgentAlimi.emptyConfirmed,
    },
    sellerTalk: {
      accessMode: body.sellerTalk.accessMode,
      remoteCount: body.sellerTalk.remoteCount,
      retention: body.sellerTalk.retention,
      automaticReadAvailable: body.sellerTalk.automaticReadAvailable,
    },
    review: {
      accessMode: body.review.accessMode,
      remoteCount: body.review.remoteCount,
      retention: body.review.retention,
      automaticReadAvailable: body.review.automaticReadAvailable,
    },
    uiRendered: true,
    uiStoredCounts: {
      productQna: body.productQna.storedCount,
      urgentAlimi: body.urgentAlimi.storedCount,
    },
    databaseReadCount: counters.read,
    providerWrites: 0,
    productionDatabaseWrites: 0,
  })}\n`);
} finally {
  await stopProcess(webProcess);
  if (authServer?.listening) await close(authServer);
  await db.close();
}
