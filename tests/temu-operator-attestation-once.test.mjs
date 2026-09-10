import assert from "node:assert/strict";
import { createHash, createPublicKey, generateKeyPairSync, sign } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  collectAndSubmitTemuAttestation,
  initializeCollectorKeychain,
  signCollectorEnvelope,
  temuCollectorUiContractV1,
  validateCollectorConfig,
  validateLoopbackCdpUrl,
  verifyChromeProfileBinding,
} from "../lib/product-registration/temu/temu-operator-attestation-once.mjs";
import { verifyTemuCollectorAttestation } from
  "../lib/product-registration/temu/operator-app-observation.ts";

const ownerId = "10000000-0000-4000-8000-000000000001";
const productId = "20000000-0000-4000-8000-000000000002";
const credentialId = "30000000-0000-4000-8000-000000000003";
const attestationId = "40000000-0000-4000-8000-000000000004";
const challengeId = "50000000-0000-4000-8000-000000000005";

function keyIdentity(privateKey) {
  const publicKey = createPublicKey(privateKey);
  const der = publicKey.export({ type: "spki", format: "der" });
  return {
    keyId: `temu-ed25519-${createHash("sha256").update(der).digest("hex").slice(0, 20)}`,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

const config = structuredClone(temuCollectorUiContractV1);
const chromeRoot = `${process.env.HOME}/Library/Application Support/Google/Chrome`;

function page(url, values = {}, evaluate) {
  return {
    url: () => url,
    locator: (selector) => ({
      count: async () => Object.hasOwn(values, selector) ? 1 : 0,
      innerText: async () => values[selector],
    }),
    evaluate: evaluate ?? (async () => { throw new Error("unexpected evaluate"); }),
  };
}

function browserFixture(privateKey, expectedAppId = "temu-app-931103") {
  const { keyId, publicKeyPem } = keyIdentity(privateKey);
  let challengeCalls = 0;
  let postCalls = 0;
  let postedEnvelope = null;
  const sellerpilot = page(`${config.sellerpilotOrigin}/admin`, {}, async (_fn, input) => {
    if (!input.initValue.method) {
      challengeCalls += 1;
      return { status: 200, body: { contract: "temu_collector_challenge_v1",
      challengeId, nonce: "N".repeat(43), ownerId, keyId, expectedAppId,
        receiptKeyId: "receipt-key-1", credentialVersion: 3,
        credentialFingerprint: "f".repeat(64),
        credentialVaultSecretId: "70000000-0000-4000-8000-000000000007",
        productRevisionFingerprint: "a".repeat(64) } };
    }
    postCalls += 1;
    postedEnvelope = JSON.parse(input.initValue.body);
    assert.equal(verifyTemuCollectorAttestation({
      ...postedEnvelope, publicKeyPem, expectedKeyId: keyId,
    }), true);
    return { status: 200, body: { ok: true,
      source: "service_verified_signed_local_collector_v1", attestationId,
      status: "allowed", appState: "active", complianceState: "approved",
      verifiedSourceReadback: true } };
  });
  const app = page(config.pages.app.urlPrefix, {
    [config.pages.app.appNameSelector]: "SellerPilot",
    [config.pages.app.appIdSelector]: "temu-app-931103",
    [config.pages.app.appStateSelector]: "Active",
    [config.pages.app.complianceStateSelector]: "Approved",
    [config.pages.app.rejectionReasonSelector]: "",
    [config.pages.app.accountSubjectSelector]: "raw-account-never-posted",
    [config.pages.app.mallIdSelector]: "11", [config.pages.app.regionIdSelector]: "22",
  });
  const shipping = page(config.pages.shipping.urlPrefix, {
    [config.pages.shipping.defaultTemplateIdSelector]: "shipping-template-1",
    [config.pages.shipping.warehouseVerifiedSelector]: "Verified",
    [config.pages.shipping.feeRuleVerifiedSelector]: "Verified",
    [config.pages.shipping.returnPolicyVerifiedSelector]: "Verified",
  });
  const egress = page(config.pages.egress.urlPrefix, {
    [config.pages.egress.stateSelector]: "static_ip_verified",
    [config.pages.egress.verificationMethodSelector]: "temu_allowlist_readback",
  });
  const pages = [sellerpilot, app, shipping, egress];
  const context = {
    pages: () => pages,
    newCDPSession: async () => ({ send: async (method) => method === "Browser.getVersion"
      ? { product: "Chrome/140.0.0.0" }
      : { arguments: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "--profile-directory=Profile 7", `--user-data-dir=${chromeRoot}`] } }),
  };
  return {
    browser: { contexts: () => [context] },
    keyId,
    publicKeyPem,
    counters: () => ({ challengeCalls, postCalls, postedEnvelope }),
  };
}

test("Security.framework helper keeps private key bytes out of Node argv, output, and files", async () => {
  const calls = [];
  const { privateKey } = generateKeyPairSync("ed25519");
  const identity = keyIdentity(privateKey);
  const helperIdentity = { ...identity,
    keyId: identity.keyId.replace("temu-ed25519-", "temu-p256-") };
  const result = initializeCollectorKeychain({
    command: (program, args, options) => {
      calls.push({ program, args, options });
      return JSON.stringify({ ...helperIdentity, previousKeyId: null, graceUntil: null });
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].program, "/usr/bin/xcrun");
  assert.deepEqual(calls[0].args.slice(0, 4), ["--sdk", "macosx", "swift",
    calls[0].args[3]]);
  assert.equal(calls[0].args.at(-1), "initialize");
  assert.equal(calls[0].args.join(" ").includes("private"), false);
  assert.equal(calls[0].options?.input, undefined);
  assert.equal(Object.hasOwn(result, "privateKey"), false);
  assert.match(result.publicKeyPem, /BEGIN PUBLIC KEY/u);
  assert.match(result.keyId, /^temu-p256-[a-f0-9]{20}$/u);
  const nodeSource = await readFile(new URL(
    "../lib/product-registration/temu/temu-operator-attestation-once.mjs", import.meta.url), "utf8");
  const helperSource = await readFile(new URL(
    "../lib/product-registration/temu/temu-operator-seckey-helper.swift", import.meta.url), "utf8");
  assert.equal(nodeSource.includes("find-generic-password"), false);
  assert.equal(nodeSource.includes("createPrivateKey"), false);
  assert.equal(nodeSource.includes("privateKey.export"), false);
  assert.match(helperSource, /kSecAttrIsExtractable as String: false/u);
  assert.match(helperSource, /SecKeyCreateSignature/u);
  assert.equal(helperSource.includes("SecKeyCopyExternalRepresentation(key"), false);
});

test("SecKey signing subprocess receives canonical bytes but never private key material", () => {
  const calls = [];
  const keyId = `temu-p256-${"a".repeat(20)}`;
  const expectedSignature = Buffer.alloc(64, 7).toString("base64");
  const signature = signCollectorEnvelope(keyId, "{\"contract\":\"test\"}", {
    command: (program, args, options) => {
      calls.push({ program, args, options });
      return JSON.stringify({ keyId, signature: expectedSignature });
    },
  });
  assert.equal(signature, expectedSignature);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].program, "/usr/bin/xcrun");
  assert.deepEqual(calls[0].args.slice(-2), ["sign", keyId]);
  assert.equal(calls[0].options.input, "{\"contract\":\"test\"}");
  assert.equal(calls[0].args.join(" ").includes("BEGIN PRIVATE KEY"), false);
  assert.equal(calls[0].options.input.includes("PRIVATE KEY"), false);
});

test("collector configuration and Chrome profile binding are exact", () => {
  assert.deepEqual(validateCollectorConfig(config), config);
  assert.throws(() => validateCollectorConfig({ ...config, pages: { ...config.pages,
    app: { ...config.pages.app, urlPrefix: "https://www.temu.com/user-content/fake" } } }),
  /COLLECTOR_UI_CONTRACT_NOT_PINNED/u);
  assert.equal(validateLoopbackCdpUrl("http://127.0.0.1:9222"), "http://127.0.0.1:9222");
  assert.throws(() => validateLoopbackCdpUrl("https://attacker.invalid:9222"),
    /COLLECTOR_CDP_NOT_LOOPBACK/u);
  assert.deepEqual(verifyChromeProfileBinding({
    commandLineArguments: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "--profile-directory=Profile 7", `--user-data-dir=${chromeRoot}`],
    trustedUserDataDirectory: chromeRoot,
    localState: { profile: { info_cache: { "Profile 7": {
      name: "CHANGHEE", user_name: "k931103@gmail.com",
    } } } },
  }), { profileDirectory: "Profile 7", userDataDirectory: chromeRoot });
  assert.throws(() => verifyChromeProfileBinding({
    commandLineArguments: ["/tmp/fake-chrome", "--profile-directory=Profile 7",
      `--user-data-dir=${chromeRoot}`], trustedUserDataDirectory: chromeRoot,
    localState: { profile: { info_cache: { Default: {
      name: "JEONGHUN", user_name: "couplit.official@gmail.com",
    } } } },
  }), /CHROME_PROFILE_BINDING_MISMATCH/u);
});

test("one-shot collector observes CHANGHEE, signs canonical envelope, POSTs once, and verifies readback", async () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const fixture = browserFixture(privateKey);
  const key = keyIdentity(privateKey);
  const result = await collectAndSubmitTemuAttestation({ productId, credentialId, config,
    keyId: key.keyId,
    cdpUrl: "http://127.0.0.1:9222" }, {
    browser: fixture.browser,
    signEnvelope: async (_keyId, canonical) => sign(null,
      Buffer.from(canonical, "utf8"), privateKey).toString("base64"),
    realpath: async () => chromeRoot,
    readFile: async () => JSON.stringify({ profile: { info_cache: { "Profile 7": {
      name: "CHANGHEE", user_name: "k931103@gmail.com",
    } } } }),
  });
  assert.equal(result.attestationId, attestationId);
  assert.equal(result.verifiedSourceReadback, true);
  const calls = fixture.counters();
  assert.equal(calls.challengeCalls, 1);
  assert.equal(calls.postCalls, 1);
  assert.equal(calls.postedEnvelope.attestation.appId, "temu-app-931103");
  assert.equal(JSON.stringify(calls.postedEnvelope).includes("raw-account-never-posted"), false);
  assert.match(calls.postedEnvelope.attestation.partnerAccountSubject,
    /^temu-account:sha256:[a-f0-9]{64}$/u);
});

test("collector refuses a challenge pinned to a different credential app ID before POST", async () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  const fixture = browserFixture(privateKey, "different-app-id");
  const key = keyIdentity(privateKey);
  await assert.rejects(collectAndSubmitTemuAttestation({ productId, credentialId, config,
    keyId: key.keyId,
    cdpUrl: "http://127.0.0.1:9222" }, {
    browser: fixture.browser,
    signEnvelope: async (_keyId, canonical) => sign(null,
      Buffer.from(canonical, "utf8"), privateKey).toString("base64"),
    realpath: async () => chromeRoot,
    readFile: async () => JSON.stringify({ profile: { info_cache: { "Profile 7": {
      name: "CHANGHEE", user_name: "k931103@gmail.com",
    } } } }),
  }), /COLLECTOR_CHALLENGE_INVALID/u);
  assert.deepEqual(fixture.counters(), { challengeCalls: 1, postCalls: 0, postedEnvelope: null });
});

test("attacker Temu DOM, fake profile state, and remote CDP produce zero challenge, signature, or POST", async () => {
  const { privateKey } = generateKeyPairSync("ed25519");
  let browserTouched = 0;
  const attackerConfig = structuredClone(config);
  attackerConfig.pages.app.urlPrefix = "https://www.temu.com/user-content/attacker";
  attackerConfig.pages.app.appIdSelector = "#attacker-app-id";
  await assert.rejects(collectAndSubmitTemuAttestation({ productId, credentialId,
    config: attackerConfig, cdpUrl: "https://attacker-cdp.invalid" }, {
    readPrivateKey: () => privateKey,
    browser: { contexts: () => { browserTouched += 1; return []; } },
    readFile: async () => JSON.stringify({ profile: { info_cache: { "Profile 7": {
      name: "CHANGHEE", user_name: "k931103@gmail.com",
    } } } }),
  }), /COLLECTOR_UI_CONTRACT_NOT_PINNED/u);
  assert.equal(browserTouched, 0);
});

test("service-role collector RPC callgraph is confined to the signature-verifying route", async () => {
  const { readFile } = await import("node:fs/promises");
  const { glob } = await import("node:fs/promises");
  const files = [];
  for await (const name of glob(["app/**/*.{ts,tsx,mjs}", "lib/**/*.{ts,tsx,mjs}",
    "scripts/**/*.{ts,tsx,mjs}"], { exclude: ["**/node_modules/**"] })) files.push(name);
  const consumeCallers = [];
  const verifierCallers = [];
  for (const name of files) {
    const source = await readFile(name, "utf8");
    if (source.includes("sellerpilot_service_consume_temu_collector_attestation_v2")) {
      consumeCallers.push(name);
    }
    if (source.includes("sellerpilot_verifier_record_temu_collector_receipt_v1")) {
      verifierCallers.push(name);
    }
  }
  const observationRoute = "app/api/admin/temu/operator-app-observation/route.ts";
  assert.deepEqual(consumeCallers, [observationRoute]);
  assert.deepEqual(verifierCallers, [observationRoute]);
  const route = await readFile(new URL(`../${observationRoute}`, import.meta.url), "utf8");
  const verifyAt = route.indexOf("verifyTemuCollectorAttestation({");
  const receiptAt = route.indexOf(
    "sellerpilot_verifier_record_temu_collector_receipt_v1", verifyAt,
  );
  const consumeAt = route.indexOf(
    "sellerpilot_service_consume_temu_collector_attestation_v2", receiptAt,
  );
  assert.ok(verifyAt >= 0 && receiptAt > verifyAt && consumeAt > receiptAt);
  assert.equal(route.includes("sellerpilot_service_consume_temu_collector_attestation_v1"), false);
});
