import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileFunction } from 'node:vm';
import { dirname, resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { runChannelDiagnostic } from '../lib/channel-diagnostics.ts';
import { runWithChannelRequestSignal } from '../lib/channels/protocols.ts';

const PROJECT = 'sqaoqucxakebqkiygdxb';
const SITE = 'https://sellerpilot-global.vercel.app';
const DB = `https://${PROJECT}.supabase.co`;
const IP_URL = 'https://api.ipify.org/?format=json';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
let running = false;
class SafeFailure extends Error { constructor(code) { super(code); this.code = code; } }
const fail = code => { throw new SafeFailure(code); };

// PostgreSQL jsonb::text: UTF-8 byte-length/key ordering, comma/colon spaces.
// Non-integer numbers fail closed rather than guessing PostgreSQL numeric scale.
export function credentialFingerprint(value) {
  const jsonb = v => {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number' && Number.isSafeInteger(v)) return String(v);
    if (Array.isArray(v)) return `[${v.map(jsonb).join(', ')}]`;
    if (v && typeof v === 'object') {
      const keys = Object.keys(v).sort((a, b) => Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b)));
      return `{${keys.map(k => `${JSON.stringify(k)}: ${jsonb(v[k])}`).join(', ')}}`;
    }
    fail('FINGERPRINT_UNREPRESENTABLE');
  };
  return createHash('sha256').update(jsonb(value)).digest('hex').slice(0, 12).toUpperCase();
}

// The legacy CLI has an unconditional main(). Do not import/execute that module.
// Compile its existing declaration-only prefix, without changing/copying its auth
// implementation. Refuse a changed module boundary/import contract.
export async function loadExistingAuthorization() {
  const source = await fs.readFile(new URL('./live-channel-operation.mjs', import.meta.url), 'utf8');
  const marker = '\nasync function main() {';
  if (source.split(marker).length !== 2) fail('AUTH_HELPER_LAYOUT_CHANGED');
  let prefix = source.slice(0, source.indexOf(marker));
  for (const line of [
    'import { createClient } from "@supabase/supabase-js";\n',
    'import { shopeeMerchantRequest, shopeeRequest } from "../lib/channels/protocols.ts";\n',
  ]) {
    if (!prefix.includes(line)) fail('AUTH_HELPER_LAYOUT_CHANGED');
    prefix = prefix.replace(line, '');
  }
  prefix = prefix.replace('export async function authorizeLiveChannelOwner', 'async function authorizeLiveChannelOwner');
  if (/\bimport\b|\bexport\b/.test(prefix.replace(/\/\/[^\n]*/g, ''))) fail('AUTH_HELPER_LAYOUT_CHANGED');
  return compileFunction(`${prefix}\nreturn authorizeLiveChannelOwner;`, ['createClient'])(createClient);
}

function validateInput(x) {
  const keys = ['accessToken','actorId','allowSmartstoreTokenRequest','allowedIp','channel','contractVersion','credentialFingerprint','credentialId','credentialOwnerId','credentialVersion','expiresAt','projectRef','publishableKey','serviceKey','siteOrigin'];
  if (!x || typeof x !== 'object' || Array.isArray(x) || JSON.stringify(Object.keys(x).sort()) !== JSON.stringify(keys)) fail('AUTH_FILE_SHAPE_INVALID');
  if (x.contractVersion !== 1 || !['coupang','smartstore'].includes(x.channel) || x.projectRef !== PROJECT || x.siteOrigin !== SITE) fail('SCOPE_INVALID');
  if (![x.actorId,x.credentialId,x.credentialOwnerId].every(v => typeof v === 'string' && UUID.test(v)) || !Number.isSafeInteger(x.credentialVersion) || x.credentialVersion < 1) fail('IDENTITY_INPUT_INVALID');
  if (!/^[A-F0-9]{12}$/.test(x.credentialFingerprint) || !/^(\d{1,3}\.){3}\d{1,3}$/.test(x.allowedIp) || x.allowedIp.split('.').some(v => Number(v) > 255)) fail('METADATA_INPUT_INVALID');
  if (x.expiresAt !== null && (typeof x.expiresAt !== 'string' || !Number.isFinite(Date.parse(x.expiresAt)) || Date.parse(x.expiresAt) <= Date.now())) fail('EXPIRY_INVALID');
  if (![x.accessToken,x.publishableKey,x.serviceKey].every(v => typeof v === 'string' && v.trim())) fail('AUTH_INPUT_MISSING');
  if (x.allowSmartstoreTokenRequest !== (x.channel === 'smartstore')) fail('TOKEN_REQUEST_APPROVAL_REQUIRED');
}

export function guardedTransport(nativeFetch, input, signal, counts = {}) {
  return async (request, init = {}) => {
    if (signal.aborted) fail('TIMEOUT');
    const url = new URL(typeof request === 'string' || request instanceof URL ? request : request.url);
    const method = (init.method ?? request.method ?? 'GET').toUpperCase();
    const name = `${method} ${url.href}`;
    let max = 0;
    if (url.href === IP_URL && method === 'GET') max = 1;
    if (url.origin === DB && !url.search && !url.hash) {
      if (url.pathname === '/auth/v1/user' && method === 'GET') max = 3;
      if (method === 'POST' && ['/rest/v1/rpc/sellerpilot_is_admin','/rest/v1/rpc/sellerpilot_list_credentials','/rest/v1/rpc/sellerpilot_verify_channel_credential_owner_v1'].includes(url.pathname)) max = 3;
      if (method === 'POST' && ['/rest/v1/rpc/sellerpilot_decrypt_credential','/rest/v1/rpc/sellerpilot_record_credential_test'].includes(url.pathname)) max = 1;
    }
    if (input.channel === 'coupang' && method === 'GET' && url.href === `https://api-gateway.coupang.com/v2/providers/seller_api/apis/api/v1/marketplace/seller-products?vendorId=${encodeURIComponent(input.vendorId ?? '')}&maxPerPage=1`) max = 1;
    if (input.channel === 'smartstore' && method === 'GET' && url.href === 'https://api.commerce.naver.com/external/v1/seller/account') max = 1;
    if (input.channel === 'smartstore' && input.allowSmartstoreTokenRequest === true && method === 'POST' && url.href === 'https://api.commerce.naver.com/external/v1/oauth2/token') max = 1;
    if (url.username || url.password || !max || (counts[name] = (counts[name] ?? 0) + 1) > max) fail('OUT_OF_SCOPE_OR_REPLAY');
    const response = await nativeFetch(request, { ...init, redirect: 'error', signal: init.signal ? AbortSignal.any([signal,init.signal]) : signal });
    if (response.status >= 300 && response.status < 400) fail('REDIRECT_REJECTED');
    return response;
  };
}

// One channel per invocation. New/queued jobs are NEVER created or completed.
// A durable sibling receipt is claimed before network and retained after cleanup.
// If recording response is lost, inspect persisted state: do NOT rerun this file.
export async function runVerifiedConnection(authFile, services = {}) {
  if (running) return { status: 'unverified', code: 'CONCURRENT_RUN_REJECTED', phase: 'input' };
  running = true;
  const io = services.io ?? fs;
  const factory = services.createClientImpl ?? createClient;
  const diagnostic = services.diagnosticImpl ?? runChannelDiagnostic;
  const nativeFetch = services.fetchImpl ?? globalThis.fetch;
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const budgetMs = Number.isFinite(services.timeoutMs) ? Math.max(1, Math.min(30_000, services.timeoutMs)) : 30_000;
  const deadline = Date.now() + budgetMs;
  let timer, input, claimed = false, fileConsumed = false;
  const summary = { status: 'unverified', code: 'NOT_STARTED', phase: 'input', diagnosticStatus: null, recordingStatus: 'not_attempted', retryAllowed: false };
  const receipt = typeof authFile === 'string' ? `${authFile}.receipt.json` : '';
  const check = () => { if (controller.signal.aborted || Date.now() >= deadline) fail('TIMEOUT'); };
  const persist = async () => { if (claimed) await io.writeFile(receipt, `${JSON.stringify(summary)}\n`, { mode: 0o600 }); };
  const work = async () => {
    if (typeof authFile !== 'string' || !isAbsolute(authFile) || resolve(authFile) !== authFile || !authFile.endsWith('.json')) fail('AUTH_FILE_PATH_INVALID');
    summary.phase = 'auth_file';
    const dir = await io.lstat(dirname(authFile));
    const stat = await io.lstat(authFile);
    const uid = process.getuid();
    if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o7777) !== 0o700 || dir.uid !== uid || await io.realpath(dirname(authFile)) !== dirname(authFile)
      || !stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o7777) !== 0o600 || stat.uid !== uid || stat.nlink !== 1) fail('PRIVATE_AUTH_FILE_REQUIRED');
    const fd = await io.open(authFile, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const current = await fd.stat();
      if (!current.isFile() || (current.mode & 0o7777) !== 0o600 || current.uid !== uid || current.nlink !== 1 || current.ino !== stat.ino || current.dev !== stat.dev || current.size > 131072) fail('AUTH_FILE_CHANGED');
      await io.unlink(authFile); fileConsumed = true;
      input = JSON.parse(await fd.readFile('utf8'));
    } finally { await fd.close(); }
    validateInput(input); check();
    await io.writeFile(receipt, `${JSON.stringify(summary)}\n`, { mode: 0o600, flag: 'wx' }); claimed = true;
    const authorize = await loadExistingAuthorization();
    const transportInput = { channel: input.channel, allowSmartstoreTokenRequest: input.allowSmartstoreTokenRequest };
    const transportCounts = {};
    const boundedFetch = guardedTransport(nativeFetch, transportInput, controller.signal, transportCounts);
    globalThis.fetch = boundedFetch;
    const makeClient = (url,key,options = {}) => factory(url,key,{...options,global:{...options.global,fetch:boundedFetch}});
    const env = { LIVE_ADMIN_ACCESS_TOKEN: input.accessToken, LIVE_ADMIN_USER_ID: input.actorId, LIVE_CHANNEL: input.channel, LIVE_OPERATION: 'diagnostic.test', LIVE_CREDENTIAL_ID: input.credentialId, LIVE_ENVIRONMENT: 'production', SUPABASE_PROJECT_REF: PROJECT, SELLERPILOT_URL: SITE, SUPABASE_KEYS_JSON: JSON.stringify([{type:'publishable',api_key:input.publishableKey}]) };
    const proof = async () => {
      check();
      const verified = await authorize({ env, createClientImpl: makeClient, timeoutMs: deadline - Date.now() });
      check();
      const c = verified.credential, p = verified.proof;
      if (c.id !== input.credentialId || c.version !== input.credentialVersion || c.fingerprint !== input.credentialFingerprint || c.expires_at !== input.expiresAt
          || p.actorId !== input.actorId || p.credentialOwnerId !== input.credentialOwnerId || p.credentialVersion !== input.credentialVersion) fail('CURRENT_PROOF_OR_FINGERPRINT_CHANGED');
      return verified;
    };
    summary.phase = 'proof_before_decrypt'; await proof();
    const service = makeClient(DB,input.serviceKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    summary.phase = 'decrypt'; check();
    const decrypted = await service.rpc('sellerpilot_decrypt_credential',{p_credential_id:input.credentialId});
    check(); if (decrypted.error || !decrypted.data || typeof decrypted.data !== 'object' || Array.isArray(decrypted.data)) fail('DECRYPT_UNVERIFIED');
    const payload = decrypted.data;
    if (credentialFingerprint(payload) !== input.credentialFingerprint) fail('DECRYPTED_FINGERPRINT_MISMATCH');
    summary.phase = 'proof_after_decrypt'; await proof();
    summary.phase = 'egress'; check();
    const ip = await boundedFetch(IP_URL); if (!ip.ok || (await ip.json()).ip !== input.allowedIp) fail('EGRESS_UNVERIFIED');
    check();
    if (input.channel === 'coupang') {
      if (typeof payload.vendor_id !== 'string' || !payload.vendor_id.trim()) fail('VENDOR_MISSING');
      transportInput.vendorId = payload.vendor_id.trim();
    }
    summary.phase = 'fresh_diagnostic';
    const result = await runWithChannelRequestSignal(controller.signal, () => diagnostic(input.channel,payload,'production'));
    check();
    summary.diagnosticStatus = ['passed','failed','manual'].includes(result?.status) ? result.status : 'unverified';
    if (result?.status !== 'passed') fail('DIAGNOSTIC_NOT_PASSED');
    const expectedRead = input.channel === 'coupang'
      ? `GET https://api-gateway.coupang.com/v2/providers/seller_api/apis/api/v1/marketplace/seller-products?vendorId=${encodeURIComponent(transportInput.vendorId)}&maxPerPage=1`
      : 'GET https://api.commerce.naver.com/external/v1/seller/account';
    if (transportCounts[expectedRead] !== 1 || (input.channel === 'smartstore'
        && transportCounts['POST https://api.commerce.naver.com/external/v1/oauth2/token'] !== 1)) fail('FRESH_READ_UNVERIFIED');
    // Reject raw message aliases even on passed synthetic/malformed results.
    const safeMessage = input.channel === 'coupang'
      ? '쿠팡 HTTP·SUCCESS·상품 목록 1건과 요청 판매자 ID의 일치를 확인했습니다.'
      : '네이버 Commerce API 판매자 계정 읽기 API가 정상 응답했습니다.';
    summary.phase = 'proof_before_record'; await proof();
    check(); summary.phase = 'record'; summary.recordingStatus = 'unverified'; await persist(); check();
    const recorded = await service.rpc('sellerpilot_record_credential_test',{p_credential_id:input.credentialId,p_status:'passed',p_safe_message:safeMessage});
    check(); if (!recorded || recorded.error !== null) fail('RECORD_UNVERIFIED');
    summary.recordingStatus = 'recorded'; summary.status = 'passed'; summary.code = 'RECORDED_FRESH_DIAGNOSTIC'; summary.phase = 'complete';
  };
  try {
    await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new SafeFailure('TIMEOUT'));},budgetMs);})]);
  } catch (error) {
    summary.code = controller.signal.aborted ? 'TIMEOUT' : error instanceof SafeFailure ? error.code : 'VERIFICATION_UNAVAILABLE';
    if (summary.phase === 'record') summary.recordingStatus = 'unverified';
  } finally {
    clearTimeout(timer); controller.abort(); globalThis.fetch = originalFetch;
    if (input) for (const key of Object.keys(input)) input[key] = null;
    try { await persist(); } catch { summary.status = 'unverified'; summary.code = 'RECEIPT_UNVERIFIED'; }
    summary.authFileConsumed = fileConsumed;
    running = false;
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runVerifiedConnection(process.argv.length === 3 ? process.argv[2] : null);
    process.stdout.write(`${JSON.stringify(result)}\n`); process.exitCode = result.status === 'passed' ? 0 : 1;
  } catch {
    process.stdout.write('{"status":"unverified","code":"RUNNER_FAILED","retryAllowed":false}\n'); process.exitCode = 1;
  }
}
