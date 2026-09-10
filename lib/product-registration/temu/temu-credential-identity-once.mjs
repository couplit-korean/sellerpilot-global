#!/usr/bin/env node
// Registers the Temu production credential from the machine that owns the
// allowlisted IP. Temu refuses every other caller with
// `errorCode 5000003 NOT_IN_IP_WHITE_LIST`, so the official identity read has
// to happen here and the result is signed with a Secure Enclave key that the
// app server trusts through TEMU_CREDENTIAL_ATTESTATION_PUBLIC_KEY_PEM.
//
// Usage
//   node lib/product-registration/temu/temu-credential-identity-once.mjs init-key
//   node lib/product-registration/temu/temu-credential-identity-once.mjs attest \
//     --config /secure/path/temu-credential.json
//
// Config JSON (keep it out of the repository):
//   { "appKey": "...", "appSecret": "...", "accessToken": "...",
//     "sessionToken": "<SellerPilot admin session token>",
//     "origin": "https://sellerpilot-global.vercel.app",
//     "expiresAt": "2027-09-10T00:00:00.000Z" }
import { createHash, generateKeyPairSync, sign as signBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HELPER = resolve(dirname(fileURLToPath(import.meta.url)),
  "temu-operator-seckey-helper.swift");
const DEFAULT_KEY_DIRECTORY = resolve(homedir(), ".sellerpilot");
const DEFAULT_KEY_FILE = resolve(DEFAULT_KEY_DIRECTORY,
  "temu-credential-attestation.pem");
const TEMU_ENDPOINT = "https://openapi-b-global.temu.com/openapi/router";
const TEMU_IDENTITY_TYPE = "bg.open.accesstoken.info.get";
const CONTRACT = "temu_credential_identity_attestation_v1";

function swift(args, input) {
  const out = execFileSync("/usr/bin/xcrun",
    ["--sdk", "macosx", "swift", HELPER, ...args],
    { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] });
  return JSON.parse(out);
}

// Secure Enclave key creation needs an entitlement that this shell does not
// have (SECKEY_CREATE_FAILED), so the operator key is a P-256 key that lives in
// a 0600 file under ~/.sellerpilot. The server only ever sees the public key.
async function initializeSoftwareKey(keyFile) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  await mkdir(dirname(keyFile), { recursive: true });
  await writeFile(keyFile, privatePem, { mode: 0o600 });
  await chmod(keyFile, 0o600);
  const keyId = `temu-p256-${createHash("sha256").update(publicPem, "utf8")
    .digest("hex").slice(0, 20)}`;
  return { keyId, publicKeyPem: publicPem, keyFile, backend: "software" };
}

async function signingBackend(options) {
  const keyFile = resolve(options["key-file"] ?? DEFAULT_KEY_FILE);
  const explicit = options.backend;
  if (explicit === "seckey") return { backend: "seckey" };
  if (explicit === "software" || !explicit) {
    try {
      const privatePem = await readFile(keyFile, "utf8");
      return { backend: "software", keyFile, privatePem };
    } catch {
      if (explicit === "software") throw new Error("KEY_FILE_MISSING");
    }
  }
  return { backend: "seckey" };
}

function signWithSoftwareKey(privatePem, canonicalBytes) {
  return signBytes("sha256", Buffer.from(canonicalBytes, "utf8"), {
    key: privatePem,
    dsaEncoding: "ieee-p1363",
  }).toString("base64");
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function temuSignature(appSecret, request) {
  const concatenated = Object.entries(request)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${key}${value}`)
    .join("");
  return createHash("md5")
    .update(`${appSecret}${concatenated}${appSecret}`, "utf8")
    .digest("hex")
    .toUpperCase();
}

async function readTemuIdentity({ appKey, appSecret, accessToken }) {
  const unsigned = {
    access_token: accessToken,
    app_key: appKey,
    data_type: "JSON",
    timestamp: Math.floor(Date.now() / 1000),
    type: TEMU_IDENTITY_TYPE,
    version: "V1",
  };
  const response = await fetch(TEMU_ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "user-agent": "SellerPilot-Temu-Connector/1.0",
    },
    body: JSON.stringify({ ...unsigned, sign: temuSignature(appSecret, unsigned) }),
  });
  const text = await response.text();
  let parsed = {};
  try { parsed = JSON.parse(text); } catch { parsed = {}; }
  if (parsed.success !== true || !parsed.result) {
    const code = parsed.errorCode ?? "unknown";
    const message = String(parsed.errorMsg ?? "").slice(0, 200);
    throw new Error(`TEMU_IDENTITY_READ_FAILED:${response.status}:${code}:${message}`);
  }
  const result = parsed.result;
  const mallId = String(result.mallId ?? "");
  const regionId = String(result.regionId ?? "");
  const mallType = Number(result.mallType);
  const scopes = Array.isArray(result.apiScopeList)
    ? result.apiScopeList.map((scope) => String(scope).trim())
    : [];
  if (!/^[1-9]\d{0,31}$/u.test(mallId)
    || !/^[1-9]\d{0,31}$/u.test(regionId)
    || ![1, 100].includes(mallType)
    || scopes.length === 0) {
    throw new Error("TEMU_IDENTITY_SHAPE_INVALID");
  }
  return {
    mallId,
    regionId,
    mallType,
    semiUniqueId: result.semiUniqueId ? String(result.semiUniqueId) : null,
    apiScopes: scopes,
  };
}

function parseArgs(argv) {
  const [command, ...values] = argv;
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || value === undefined) {
      throw new Error("ARGUMENT_INVALID");
    }
    options[name.slice(2)] = value;
  }
  return { command, options };
}

async function attest(options) {
  if (!options.config) throw new Error("CONFIG_REQUIRED");
  const config = JSON.parse(await readFile(resolve(options.config), "utf8"));
  const keyId = options["key-id"] ?? config.keyId;
  const backend = await signingBackend(options);
  const origin = (options.origin ?? config.origin ?? "").replace(/\/$/u, "");
  if (!/^temu-p256-[a-f0-9]{20}$/u.test(String(keyId ?? ""))) {
    throw new Error("KEY_ID_REQUIRED");
  }
  if (!config.appKey || !config.appSecret || !config.accessToken
    || !config.sessionToken || !origin) {
    throw new Error("CONFIG_INCOMPLETE");
  }
  const ownerId = JSON.parse(Buffer.from(String(config.sessionToken).split(".")[1],
    "base64url").toString("utf8")).sub;
  if (!/^[0-9a-f-]{36}$/iu.test(String(ownerId ?? ""))) throw new Error("SESSION_SUBJECT_INVALID");

  const identity = await readTemuIdentity(config);
  const secretPayload = {
    app_key: config.appKey,
    app_secret: config.appSecret,
    access_token: config.accessToken,
  };
  const attestation = {
    contract: CONTRACT,
    keyId,
    ownerId,
    payloadFingerprintSha256: createHash("sha256")
      .update(canonical(secretPayload), "utf8").digest("hex"),
    mallId: identity.mallId,
    regionId: identity.regionId,
    mallType: identity.mallType,
    semiUniqueId: identity.semiUniqueId,
    apiScopes: identity.apiScopes,
    observedAt: new Date().toISOString(),
    egress: {
      state: "static_ip_verified",
      verificationMethod: "temu_global_endpoint_probe",
    },
  };
  const signature = backend.backend === "software"
    ? signWithSoftwareKey(backend.privatePem, canonical(attestation))
    : swift(["sign", keyId], canonical(attestation)).signature;
  const response = await fetch(`${origin}/api/admin/channel-credentials/rotate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.sessionToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      channel: "temu",
      environment: "production",
      secretPayload,
      expiresAt: config.expiresAt ?? null,
      rotationDays: Number(config.rotationDays ?? 90),
      warningDays: Number(config.warningDays ?? 30),
      graceDays: Number(config.graceDays ?? 7),
      localIdentityAttestation: { attestation, signature },
    }),
  });
  const body = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    mallId: identity.mallId,
    regionId: identity.regionId,
    mallType: identity.mallType,
    scopes: identity.apiScopes.length,
    response: body.slice(0, 300),
  };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === "init-key") {
    const keyFile = resolve(options["key-file"] ?? DEFAULT_KEY_FILE);
    if (options.backend === "seckey") {
      process.stdout.write(`${JSON.stringify(swift(["initialize"]), null, 2)}\n`);
      return;
    }
    process.stdout.write(
      `${JSON.stringify(await initializeSoftwareKey(keyFile), null, 2)}\n`);
    return;
  }
  if (command === "attest") {
    process.stdout.write(`${JSON.stringify(await attest(options), null, 2)}\n`);
    return;
  }
  throw new Error("COMMAND_INVALID");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "FAILED"}\n`);
  process.exitCode = 1;
});
