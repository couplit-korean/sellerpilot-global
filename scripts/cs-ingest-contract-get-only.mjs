import { execFileSync } from "node:child_process";

const PROJECT_REF = "sqaoqucxakebqkiygdxb";

function keychainToken() {
  try {
    return execFileSync("security", ["find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

const token = keychainToken();
if (!token) {
  console.log(JSON.stringify({ contract: "sellerpilot_cs_ingest_contract_read_v1", status: "unverified", reason: "management_session_unavailable" }));
  process.exit(2);
}

const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    accept: "application/json",
    "content-type": "application/json",
  },
  body: JSON.stringify({
    query: `select
      p.oid::regprocedure::text as signature,
      p.prosecdef,
      p.proowner='postgres'::regrole as owner_is_postgres,
      p.proconfig=array['search_path=""']::text[] as empty_search_path,
      not has_function_privilege('anon',p.oid,'EXECUTE') as anon_blocked,
      not has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_blocked,
      not has_function_privilege('service_role',p.oid,'EXECUTE') as service_blocked,
      p.prosrc like '%v_sender_role%' as reads_sender_role,
      position('system' in p.prosrc)>0 as mentions_system_role,
      position('senderRole' in p.prosrc)>0 as reads_sender_role_input,
      regexp_replace(p.prosrc,'[[:space:]]','','g') like '%v_inquiry->>''senderRole''in(''seller'',''system'')%' as permits_exact_system_role,
      (select encode(sha256(convert_to(service.prosrc,'UTF8')),'hex') from pg_proc service where service.oid='public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)'::regprocedure) as service_ingest_sha256,
      (select service.prosecdef and service.proowner='postgres'::regrole and service.proconfig=array['search_path=""']::text[] from pg_proc service where service.oid='public.sellerpilot_service_ingest_inquiries(uuid,text,jsonb)'::regprocedure) as service_ingest_hardened
    from pg_proc p
    where p.oid='public.sellerpilot_202609051400_ingest_inquiries(uuid,text,jsonb)'::regprocedure`,
  }),
  signal: AbortSignal.timeout(20_000),
  cache: "no-store",
});
const body = await response.json().catch(() => null);
const rows = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : [];
const row = rows[0];
if (!response.ok || rows.length !== 1 || !row || typeof row !== "object") {
  console.log(JSON.stringify({ contract: "sellerpilot_cs_ingest_contract_read_v1", status: "unverified", reason: `management_query_${response.status}` }));
  process.exit(2);
}
console.log(JSON.stringify({
  contract: "sellerpilot_cs_ingest_contract_read_v1",
  checkedAt: new Date().toISOString(),
  signaturePresent: typeof row.signature === "string",
  securityDefiner: row.prosecdef === true,
  ownerIsPostgres: row.owner_is_postgres === true,
  emptySearchPath: row.empty_search_path === true,
  publicRolesBlocked: row.anon_blocked === true && row.authenticated_blocked === true,
  serviceDirectExecutionBlocked: row.service_blocked === true,
  readsSenderRole: row.reads_sender_role === true,
  mentionsSystemRole: row.mentions_system_role === true,
  readsSenderRoleInput: row.reads_sender_role_input === true,
  permitsExactSystemRole: row.permits_exact_system_role === true,
  serviceIngestSha256: row.service_ingest_sha256,
  serviceIngestHardened: row.service_ingest_hardened === true,
}));
