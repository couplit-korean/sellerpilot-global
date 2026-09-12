import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// One-time recovery for the production database inspected through Aside on
// 2026-09-13. This writes SQL only; it never connects to or changes a database.
// The original migration must run against the shared snapshot underneath the
// newer Lazada wrapper. All renames, migration statements, restoration, and
// journal insertion are one transaction; no intermediate name is published.
export const productionPreimages = Object.freeze({
  sellerpilot_get_cs_workspace_snapshot: 'f97268ac8331f0a11fe8e27cc5b7d0fe7084055529e3069f584e5d989e3dc9d8',
  sellerpilot_09090000_get_cs_workspace_snapshot_unsafe: '7946d507bcc79e71b6a73a193092ab6d103b701b5e9e20c7d6765deaf5af74d7',
  sellerpilot_get_inquiry_reply_delivery: '2e985415fa09ec46c9678eae4d4e65b4fdd96d29692e2f1f19be8598c32808b5',
});
const version = '20260907232000';
const sourceHash = 'b1079308ccc2a01fc4985c98e62e3f3437cf8ebda1e9c405b5abe9c778a3acb5';
const signatures = {
  sellerpilot_get_cs_workspace_snapshot: '()',
  sellerpilot_09090000_get_cs_workspace_snapshot_unsafe: '()',
  sellerpilot_get_inquiry_reply_delivery: '(uuid,uuid)',
};

export async function buildReplyObservationRecovery({ preimages = productionPreimages } = {}) {
  const source = await readFile(new URL('../../supabase/migrations/20260907232000_add_cs_reply_remote_observation.sql', import.meta.url), 'utf8');
  if (createHash('sha256').update(source).digest('hex') !== sourceHash) throw new Error('REVIEWED_MIGRATION_SOURCE_CHANGED');
  const guards = Object.entries(signatures).map(([name, args]) => {
    const hash = preimages[name];
    if (!/^[a-f0-9]{64}$/.test(hash ?? '')) throw new Error(`Missing reviewed preimage: ${name}`);
    const auth = name !== 'sellerpilot_09090000_get_cs_workspace_snapshot_unsafe';
    // The inspected legacy delivery reader also grants service_role. The
    // original migration intentionally removes that grant while adding the
    // separate service-only observation writer.
    const service = name === 'sellerpilot_get_inquiry_reply_delivery';
    return `
 if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('public.${name}${args}')
   and encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='${hash}'
   and p.prosecdef and p.proowner='postgres'::regrole and p.proconfig=array['search_path=""']::text[]
   and not has_function_privilege('anon',p.oid,'execute')
   and has_function_privilege('service_role',p.oid,'execute')=${service}
   and has_function_privilege('authenticated',p.oid,'execute')=${auth})
 then raise exception 'CS_REPLY_RECOVERY_PREIMAGE_MISMATCH:${name}'; end if;`;
  }).join('\n');
  const body = source.replace(/^begin;\s*/m, '').replace(/\ncommit;\s*$/, '\n');
  return `-- Generated from the immutable reviewed migration; do not edit in the browser.
begin;
set local statement_timeout='30s';
set local lock_timeout='2s';
do $preflight$ begin
 if not pg_try_advisory_xact_lock(72609313,1) then raise exception 'SELLERPILOT_DB_INTEGRATION_BUSY'; end if;
 if exists(select 1 from supabase_migrations.schema_migrations where version='${version}')
   or to_regprocedure('public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb)') is not null
 then raise exception 'CS_REPLY_OBSERVATION_ALREADY_PRESENT_REVIEW_REQUIRED'; end if;
 if to_regprocedure('public.sellerpilot_cs_snapshot_recovery_hold()') is not null
 then raise exception 'CS_REPLY_RECOVERY_HOLD_NAME_OCCUPIED'; end if;
${guards}
end $preflight$;

alter function public.sellerpilot_get_cs_workspace_snapshot() rename to sellerpilot_cs_snapshot_recovery_hold;
alter function public.sellerpilot_09090000_get_cs_workspace_snapshot_unsafe() rename to sellerpilot_get_cs_workspace_snapshot;

${body}

alter function public.sellerpilot_get_cs_workspace_snapshot() rename to sellerpilot_09090000_get_cs_workspace_snapshot_unsafe;
alter function public.sellerpilot_cs_snapshot_recovery_hold() rename to sellerpilot_get_cs_workspace_snapshot;

do $postflight$ begin
 if encode(sha256(convert_to((select prosrc from pg_proc where oid='public.sellerpilot_get_cs_workspace_snapshot()'::regprocedure),'UTF8')),'hex')
   <> '${preimages.sellerpilot_get_cs_workspace_snapshot}'
   or not has_function_privilege('authenticated','public.sellerpilot_get_cs_workspace_snapshot()','execute')
   or has_function_privilege('authenticated','public.sellerpilot_09090000_get_cs_workspace_snapshot_unsafe()','execute')
   or has_function_privilege('anon','public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb)','execute')
   or has_function_privilege('authenticated','public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb)','execute')
   or not has_function_privilege('service_role','public.sellerpilot_service_observe_inquiry_replies_v1(uuid,text,jsonb)','execute')
 then raise exception 'CS_REPLY_RECOVERY_POSTCONDITION_FAILED'; end if;
end $postflight$;
insert into supabase_migrations.schema_migrations(version,name,statements)
values('${version}','add_cs_reply_remote_observation',array[$original_source$${source}$original_source$]);
notify pgrst,'reload schema';
select version,name,encode(sha256(convert_to(statements[1],'UTF8')),'hex') as original_source_sha256
from supabase_migrations.schema_migrations where version='${version}';
commit;
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [option, output] = process.argv.slice(2);
  if (option !== '--output' || !output || !path.isAbsolute(output)) throw new Error('Usage: --output /absolute/path.sql');
  const sql = await buildReplyObservationRecovery();
  await writeFile(output, sql, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ output, bytes: Buffer.byteLength(sql), sha256: createHash('sha256').update(sql).digest('hex'), executesDatabase: false }));
}
