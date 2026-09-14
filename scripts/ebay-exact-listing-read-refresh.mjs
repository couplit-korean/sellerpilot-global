// Incident-only operator command. Default: read-only, no token request.
// Execute only after reviewing/applying the companion migration:
// node --import tsx scripts/ebay-exact-listing-read-refresh.mjs --execute
// After a failed/uncertain STORE, use --resume-store: it never requests a token.
// SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) uses the existing secure runtime.
// Never print credentials, SQL containing credentials, HTTP bodies or GetUser PII.
import { execFileSync } from "node:child_process";
import {createHash,createHmac,randomUUID,timingSafeEqual} from "node:crypto";
import {constants} from "node:fs";
import {lstat,mkdir,open,realpath,link,unlink} from "node:fs/promises";
import {homedir} from "node:os";
import {join,resolve,parse,sep} from "node:path";
import { pathToFileURL } from "node:url";

export const sourceCredentialId = "8e43e9e0-2674-41a2-8a62-905afad415c0";
const project = "sqaoqucxakebqkiygdxb";
const evidenceDirectory=join(homedir(),"Library/Application Support/SellerPilot/private-evidence");
const evidenceName="ebay-v209-confirmed-refresh.json";
const maxEvidenceBytes=64*1024;
const evidenceFailure=()=>{throw new Error("EBAY_EXACT_READ_REFRESH_EVIDENCE_INVALID");};
const hash=value=>createHash("sha256").update(value).digest("hex");
const canonical=value=>JSON.stringify(value,(_key,item)=>item && typeof item==="object" && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const mac=(key,body,digest)=>createHmac("sha256",key).update(`sellerpilot/ebay-v209-confirmed-refresh/v1\n${digest}\n${body}`).digest("hex");
const sameInode=(a,b)=>a.dev===b.dev && a.ino===b.ino;
const owned=stat=>typeof process.getuid!=="function" || stat.uid===process.getuid();
const privateFile=stat=>stat.isFile() && stat.nlink===1 && owned(stat) && (stat.mode&0o777)===0o600 && stat.size<=maxEvidenceBytes;
function evidenceKey(serviceKey) {
  if(typeof serviceKey!=="string" || serviceKey.length<16)return evidenceFailure();
  return createHash("sha256").update(`sellerpilot/ebay-v209/evidence-key\n${serviceKey}`).digest();
}
async function privateDirectory(directory,create) {
  const absolute=resolve(directory);
  if(absolute!==directory || /(?:^|\/)(?:Documents|Desktop|Mobile Documents|CloudStorage|iCloud Drive|Dropbox|OneDrive)(?:\/|$)/i.test(absolute))return evidenceFailure();
  let current=parse(absolute).root;
  for(const part of absolute.slice(current.length).split(sep).filter(Boolean)) {
    current=join(current,part);
    let stat=await lstat(current).catch(error=>{if(error.code==="ENOENT")return null;throw error;});
    if(!stat && create){await mkdir(current,{mode:0o700}).catch(error=>{if(error.code!=="EEXIST")throw error;});stat=await lstat(current);}
    if(!stat && !create)return null;
    if(!stat?.isDirectory() || stat.isSymbolicLink())return evidenceFailure();
  }
  const stat=await lstat(absolute);
  if(!owned(stat) || (stat.mode&0o777)!==0o700 || await realpath(absolute)!==absolute)return evidenceFailure();
  return stat;
}
export function validateConfirmedRefresh(source,record,now=Date.now()) {
  const oldPayload=validateSource(source,now);
  const next=record?.payload;
  const immutable=payload=>Object.fromEntries(Object.entries(payload).filter(([key])=>!["access_token","access_token_expires_at","ebay_user_id"].includes(key)));
  if(record?.version!==1 || record.sourceCredentialId!==sourceCredentialId || record.sourceVersion!==209
      || record.sourcePayloadDigest!==hash(canonical(oldPayload)) || !next || typeof next!=="object" || Array.isArray(next)
      || canonical(immutable(next))!==canonical(immutable(oldPayload))
      || typeof next.access_token!=="string" || next.access_token.length<8 || next.access_token===oldPayload.access_token
      || !Number.isFinite(Date.parse(next.access_token_expires_at)) || Date.parse(next.access_token_expires_at)<=now+120000
      || Date.parse(next.access_token_expires_at)>now+3*3600000
      || !Number.isFinite(Date.parse(record.verifiedAt)) || Date.parse(record.verifiedAt)>now+30000) return evidenceFailure();
  // Respect the current DB proof lifetime; never replace verifiedAt with now.
  if(Date.parse(record.verifiedAt)<now-600000)throw new Error("EBAY_EXACT_READ_REFRESH_EVIDENCE_PROOF_EXPIRED");
  return record;
}
export async function writeConfirmedRefreshEvidence({source,payload,verifiedAt,serviceKey,directory=evidenceDirectory}) {
  const record=validateConfirmedRefresh(source,{version:1,sourceCredentialId,sourceVersion:209,sourcePayloadDigest:hash(canonical(source.payload)),payload,verifiedAt});
  const body=JSON.stringify(record),digest=hash(body);
  const bytes=Buffer.from(JSON.stringify({body,digest,mac:mac(evidenceKey(serviceKey),body,digest)}));
  if(bytes.length>maxEvidenceBytes)return evidenceFailure();
  const dirStat=await privateDirectory(directory,true),path=join(directory,evidenceName),temporary=join(directory,`.ebay-v209-${randomUUID()}.tmp`);
  let file;
  try {
    file=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
    if(!privateFile(await file.stat()))return evidenceFailure();
    await file.writeFile(bytes);await file.sync();await file.close();file=undefined;
    if(!sameInode(dirStat,await privateDirectory(directory,false)))return evidenceFailure();
    // link publishes atomically and refuses an existing evidence file. Never
    // overwrite a prior confirmed response, even with another valid refresh.
    await link(temporary,path).catch(error=>{if(error.code==="EEXIST")throw new Error("EBAY_EXACT_READ_REFRESH_EVIDENCE_EXISTS_USE_RESUME_STORE");throw error;});
    await unlink(temporary);
    const dir=await open(directory,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
    try{await dir.sync();}finally{await dir.close();}
    return {path,digest};
  }finally{await file?.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}
export async function readConfirmedRefreshEvidence({source,serviceKey,directory=evidenceDirectory}) {
  const dirStat=await privateDirectory(directory,false);
  if(!dirStat)return null;
  const path=join(directory,evidenceName);
  const before=await lstat(path).catch(error=>{if(error.code==="ENOENT")return null;throw error;});
  if(!before)return null;
  if(!privateFile(before) || before.size===0)return evidenceFailure();
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const opened=await file.stat();
    if(!privateFile(opened) || !sameInode(before,opened))return evidenceFailure();
    const bytes=Buffer.alloc(opened.size+1);let offset=0;
    while(offset<bytes.length){const read=await file.read(bytes,offset,bytes.length-offset,offset);if(!read.bytesRead)break;offset+=read.bytesRead;}
    const after=await file.stat();
    if(offset!==opened.size || !sameInode(after,await lstat(path)) || after.size!==opened.size || !privateFile(after)
        || !sameInode(dirStat,await privateDirectory(directory,false)))return evidenceFailure();
    let envelope;try{envelope=JSON.parse(bytes.subarray(0,offset).toString("utf8"));}catch{return evidenceFailure();}
    if(typeof envelope?.body!=="string" || !/^[a-f0-9]{64}$/.test(envelope?.digest??"")
        || !/^[a-f0-9]{64}$/.test(envelope?.mac??"") || hash(envelope.body)!==envelope.digest
        || !timingSafeEqual(Buffer.from(envelope.mac,"hex"),Buffer.from(mac(evidenceKey(serviceKey),envelope.body,envelope.digest),"hex")))return evidenceFailure();
    let record;try{record=JSON.parse(envelope.body);}catch{return evidenceFailure();}
    return validateConfirmedRefresh(source,record);
  }finally{await file.close();}
}
export function safeStoreError(status,data) {
  const labels={"42702":"AMBIGUOUS_COLUMN","42703":"UNDEFINED_COLUMN","42P01":"UNDEFINED_TABLE","42883":"UNDEFINED_FUNCTION","42501":"INSUFFICIENT_PRIVILEGE","23503":"FOREIGN_KEY","23514":"CHECK_CONSTRAINT","54001":"STACK_DEPTH","57014":"STATEMENT_TIMEOUT","PGRST202":"RPC_SCHEMA_CACHE","PGRST203":"RPC_OVERLOAD","P0001":"DATABASE_EXCEPTION"};
  const code=Object.hasOwn(labels,data?.code??"")?data.code:"UNKNOWN";
  const exact=/^EBAY_EXACT_[A-Z0-9_]{1,100}$/.test(data?.message??"")?data.message:null;
  return `EBAY_EXACT_READ_REFRESH_STORE_HTTP_${Number.isInteger(status)?status:0}_${code}_${exact??labels[code]??"UNCLASSIFIED"}_CHECK_LEDGER_BEFORE_RETRY`;
}
async function boundedStoreError(response) {
  const reader=response.body?.getReader();if(!reader)return safeStoreError(response.status,null);
  let size=0;const chunks=[];
  try{for(;;){const read=await reader.read();if(read.done)break;size+=read.value.length;if(size>16384){await reader.cancel();return safeStoreError(response.status,null);}chunks.push(read.value);}
    let data;try{data=JSON.parse(Buffer.concat(chunks).toString("utf8"));}catch{data=null;}return safeStoreError(response.status,data);
  }finally{reader.releaseLock();}
}
const sourceSql = `select c.id,c.version,c.status,c.created_by,c.channel,c.environment,
 c.seller_account_key_source,c.seller_account_verified_at is not null as identity_verified,
 d.decrypted_secret::jsonb as payload
 from sellerpilot_private.channel_credentials c join vault.decrypted_secrets d on d.id=c.vault_secret_id
 where c.id='${sourceCredentialId}'`;

export function validateSource(source, now = Date.now()) {
  if (!source || source.id !== sourceCredentialId || source.version !== 209 || source.status !== "active"
      || source.created_by !== "21eb1892-0894-4f9f-b414-4c9464182dd6"
      || source.channel !== "ebay" || source.environment !== "production"
      || source.seller_account_key_source !== "provider_certified_v1" || source.identity_verified !== true) {
    throw new Error("EBAY_EXACT_READ_REFRESH_SOURCE_DRIFT");
  }
  const p = source.payload;
  if (!p || !["access_token", "refresh_token", "client_id", "client_secret", "ru_name", "scopes"].every(k => typeof p[k] === "string" && p[k].trim())
      || p.provider_account_identity_version !== "v1" || !p.provider_account_subject?.startsWith("ebay:eias:")
      || !Number.isFinite(Date.parse(p.refresh_token_expires_at)) || Date.parse(p.refresh_token_expires_at) <= now
      || !Number.isFinite(Date.parse(p.access_token_expires_at)) || Date.parse(p.access_token_expires_at) > now) {
    throw new Error("EBAY_EXACT_READ_REFRESH_SOURCE_TOKEN_STATE_INVALID");
  }
  return p;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.some(a => !["--execute","--resume-store","--resume-store-management"].includes(a)) || argv.length > 1) throw new Error("EBAY_EXACT_READ_REFRESH_ARGUMENTS_INVALID");
  const managementStore=argv.includes("--resume-store-management");
  const resumeStore=argv.includes("--resume-store") || managementStore;
  const execute = argv.includes("--execute") || resumeStore;
  let managementToken = execFileSync("security", ["find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"], {encoding:"utf8", stdio:["ignore","pipe","pipe"]}).trim();
  if (managementToken.startsWith("go-keyring-base64:")) managementToken = Buffer.from(managementToken.slice(18), "base64").toString("utf8");
  const query = async sql => {
    const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
      method:"POST", headers:{authorization:`Bearer ${managementToken}`,"content-type":"application/json"},
      body:JSON.stringify({query:sql}), signal:AbortSignal.timeout(30_000),
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`EBAY_EXACT_MANAGEMENT_HTTP_${response.status}`); }
    return response.json();
  };
  const preflight = (await query(`select
    exists(select 1 from sellerpilot_private.channel_credentials where id='${sourceCredentialId}' and version=209 and status='active') as source_current,
    to_regprocedure('public.sellerpilot_service_store_ebay_exact_listing_refresh(uuid,jsonb,timestamptz)') is not null as rpc_installed,
    (select count(*) from sellerpilot_private.channel_gateway_jobs where channel='ebay' and environment='production' and status='running') as running,
    (select count(*) from sellerpilot_private.channel_gateway_jobs where id in ('d49fcf37-32b6-41f5-a822-0f9bc99b51de','1654d17e-2ef7-421d-b90f-6bf0e536e626') and status='queued' and attempt_count=0 and credential_id='${sourceCredentialId}') as exact_queued`))[0];
  if (preflight?.source_current !== true || Number(preflight.running) !== 0 || Number(preflight.exact_queued) !== 2) throw new Error("EBAY_EXACT_READ_REFRESH_PREFLIGHT_DRIFT");
  if (!execute) { console.log(JSON.stringify({mode:"read-only",...preflight})); return; }
  if (preflight.rpc_installed !== true) throw new Error("EBAY_EXACT_READ_REFRESH_RPC_NOT_INSTALLED");
  const serviceKey = process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey?.trim()) throw new Error("EBAY_EXACT_READ_REFRESH_SERVICE_KEY_REQUIRED");
  const source = (await query(sourceSql))[0];
  const payload = validateSource(source);
  let evidence=await readConfirmedRefreshEvidence({source,serviceKey});
  if(resumeStore && !evidence)throw new Error("EBAY_EXACT_READ_REFRESH_EVIDENCE_MISSING");
  if(!resumeStore && evidence)throw new Error("EBAY_EXACT_READ_REFRESH_EVIDENCE_EXISTS_USE_RESUME_STORE");
  if(!resumeStore) {
  const {ensureEbayAccessToken} = await import("../lib/channels/protocols.ts");
  const {ebayOAuthScopes} = await import("../lib/channels/ebay-oauth-scopes.ts");
  const granted = new Set(payload.scopes.trim().split(/\s+/));
  if (ebayOAuthScopes(payload).some(scope => !granted.has(scope))) throw new Error("EBAY_EXACT_READ_REFRESH_SCOPE_EXPANSION_BLOCKED");
  // Official eBay refresh tokens remain reusable. This is NOT a new consent or
  // authorization-code exchange. ensure requires GetUser to match stored EIAS.
  const refreshed = await ensureEbayAccessToken(payload,"production",undefined,undefined,undefined,true);
  if (!refreshed.refreshed || refreshed.payload.refresh_token !== payload.refresh_token
      || refreshed.payload.provider_account_subject !== payload.provider_account_subject) throw new Error("EBAY_EXACT_READ_REFRESH_PROVIDER_PROOF_INVALID");
  const verifiedAt = new Date().toISOString();
  await writeConfirmedRefreshEvidence({source,payload:refreshed.payload,verifiedAt,serviceKey});
  // Verify the durable evidence before sending STORE. A later --resume-store
  // enters below without importing/calling the eBay refresh/GetUser helpers.
  evidence=await readConfirmedRefreshEvidence({source,serviceKey});
  }
  if(!evidence)throw new Error("EBAY_EXACT_READ_REFRESH_EVIDENCE_MISSING");
  if (managementStore) {
    // Same checked RPC and durable provider proof; transaction-local budget only.
    // Serialize SQL literals without logging the query or credential payload.
    const literal = value => "'" + value.replace(/'/g, "''") + "'";
    const resultRows = await query("begin; set local statement_timeout='20s'; set local lock_timeout='3s'; select public.sellerpilot_service_store_ebay_exact_listing_refresh(" + literal(sourceCredentialId) + "::uuid," + literal(JSON.stringify(evidence.payload)) + "::jsonb," + literal(evidence.verifiedAt) + "::timestamptz) as result; commit;");
    const result = resultRows.find(row => row.result)?.result;
    if (result?.version !== 210 || result?.forcedProviderJobsStarted !== 0 || !Number.isInteger(result?.automaticQueuedCredentialRebinds) || !/^[0-9a-f-]{36}$/.test(result?.credentialId ?? "")) throw new Error("EBAY_EXACT_READ_REFRESH_STORE_READBACK_INVALID");
    console.log(JSON.stringify({mode:"store-resumed-management",...result}));
    return;
  }
  const response = await fetch(`https://${project}.supabase.co/rest/v1/rpc/sellerpilot_service_store_ebay_exact_listing_refresh`, {
    method:"POST", headers:{apikey:serviceKey,authorization:`Bearer ${serviceKey}`,"content-type":"application/json"},
    body:JSON.stringify({p_source_credential_id:sourceCredentialId,p_secret_payload:evidence.payload,p_provider_verified_at:evidence.verifiedAt}),
    signal:AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(await boundedStoreError(response));
  const result = await response.json();
  if (result?.version !== 210 || result?.forcedProviderJobsStarted !== 0
      || !Number.isInteger(result?.automaticQueuedCredentialRebinds)
      || !/^[0-9a-f-]{36}$/.test(result?.credentialId ?? "")) throw new Error("EBAY_EXACT_READ_REFRESH_STORE_READBACK_INVALID");
  console.log(JSON.stringify({mode:resumeStore?"store-resumed":"executed",...result}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    // Provider helpers can include response details. Only our static codes leave
    // the process; all other errors are classified without exposing raw bodies.
    const message = error instanceof Error ? error.message : "";
    console.error(/^EBAY_EXACT_[A-Z0-9_]+$/.test(message) ? message : "EBAY_EXACT_READ_REFRESH_FAILED_NO_SECRET_OUTPUT");
    process.exitCode=1;
  });
}
