import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_REF = "sqaoqucxakebqkiygdxb";
// Catalogs only: never query Vault payloads, customer rows, or execute a recovery RPC.
// Hashes attest the present catalog. They do NOT prove a historical migration ran.
export const BASELINE_QUERY = `select jsonb_build_object(
  'checkedAt', clock_timestamp(),
  'functions', (select coalesce(jsonb_agg(x order by x.identity), '[]'::jsonb) from (
    select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as identity,
      encode(extensions.digest(pg_get_functiondef(p.oid), 'sha256'), 'hex') as definition_sha256,
      p.prosecdef as security_definer,
      encode(extensions.digest(coalesce(p.proconfig::text,''),'sha256'),'hex') as settings_sha256,
      coalesce(p.proacl::text, '<default>') as acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','sellerpilot_private') and p.prokind in ('f','p')
  ) x),
  'relations', (select coalesce(jsonb_agg(x order by x.identity), '[]'::jsonb) from (
    select n.nspname || '.' || c.relname as identity, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
      coalesce(c.relacl::text, '<default>') as acl,
      (select encode(extensions.digest(coalesce(jsonb_agg(jsonb_build_array(a.attname,
        format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
        pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)::text,'[]'),'sha256'),'hex')
       from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
       where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns_sha256,
      (select encode(extensions.digest(coalesce(string_agg(pg_get_constraintdef(k.oid,true),'\n' order by k.conname),''),'sha256'),'hex')
       from pg_constraint k where k.conrelid=c.oid) as constraints_sha256,
      (select encode(extensions.digest(coalesce(string_agg(pg_get_indexdef(i.indexrelid),'\n' order by i.indexrelid::regclass::text),''),'sha256'),'hex')
       from pg_index i where i.indrelid=c.oid) as indexes_sha256,
      (select encode(extensions.digest(coalesce(string_agg(pg_get_triggerdef(t.oid,true),'\n' order by t.tgname),''),'sha256'),'hex')
       from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal) as triggers_sha256,
      (select encode(extensions.digest(coalesce(jsonb_agg(jsonb_build_array(p.polname,p.polcmd,p.polpermissive,
        (select array_agg(case when role_id=0 then 'public' else pg_get_userbyid(role_id) end order by role_id)
          from unnest(p.polroles) as role_id),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname)::text,'[]'),'sha256'),'hex')
       from pg_policy p where p.polrelid=c.oid) as policies_sha256
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','sellerpilot_private') and c.relkind in ('r','p','v','m','S')
  ) x),
  'migrationHistory', (select coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,
      'statement_count',coalesce(cardinality(statements),0),
      'statements_sha256',encode(extensions.digest(coalesce(statements::text,''),'sha256'),'hex')) order by version),'[]'::jsonb)
    from supabase_migrations.schema_migrations)
) as baseline`;

export function baselineReadTransaction() {
  return `begin read only;\n${BASELINE_QUERY};\ncommit;`;
}

function catalogRows(value, name) {
  if (!Array.isArray(value)) throw new Error(`invalid baseline ${name}`);
  const identities = value.map((row) => name === "migrationHistory" ? row.version : row.identity);
  if (identities.some((id) => typeof id !== "string" || !id) || new Set(identities).size !== identities.length) {
    throw new Error(`invalid or duplicate baseline ${name} identity`);
  }
  return [...value].sort((a, b) => String(a.identity ?? a.version).localeCompare(String(b.identity ?? b.version)));
}

export function normalizeBaseline(value) {
  if (value?.projectRef !== PROJECT_REF) throw new Error("baseline project mismatch");
  return {
    projectRef: PROJECT_REF,
    functions: catalogRows(value.functions, "functions"),
    relations: catalogRows(value.relations, "relations"),
    migrationHistory: catalogRows(value.migrationHistory, "migrationHistory"),
  };
}

export function summarizeBaseline(value) {
  const normalized = normalizeBaseline(value);
  return {
    projectRef: PROJECT_REF,
    checkedAt: value.checkedAt,
    functions: normalized.functions.length,
    relations: normalized.relations.length,
    migrationHistory: normalized.migrationHistory.length,
    lastMigration: normalized.migrationHistory.at(-1)?.version ?? null,
    catalogSha256: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
    historicalReplayProven: false,
    productionMutationPerformed: false,
  };
}

export function compareBaselines(before, after) {
  const left = normalizeBaseline(before);
  const right = normalizeBaseline(after);
  const changes = [];
  for (const kind of ["functions", "relations", "migrationHistory"]) {
    const key = (row) => row.identity ?? row.version;
    const old = new Map(left[kind].map((row) => [key(row), row]));
    const current = new Map(right[kind].map((row) => [key(row), row]));
    for (const identity of new Set([...old.keys(), ...current.keys()])) {
      if (JSON.stringify(old.get(identity)) !== JSON.stringify(current.get(identity))) {
        changes.push({kind, identity, change: !old.has(identity) ? "added" : !current.has(identity) ? "removed" : "changed"});
      }
    }
  }
  return changes;
}

async function main(args) {
  if (args.length === 3 && args[0] === "--compare") {
    const before = JSON.parse(await readFile(args[1], "utf8"));
    const after = JSON.parse(await readFile(args[2], "utf8"));
    const changes = compareBaselines(before, after);
    console.log(JSON.stringify({changes, matches: changes.length === 0}));
    return;
  }
  if (args.length !== 2 || args[0] !== "--out") throw new Error("usage: --out <new-json-path> | --compare <before> <after>");
  const token = execFileSync("security", ["find-generic-password", "-s", "Supabase CLI", "-a", "supabase", "-w"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST", headers: {authorization: `Bearer ${token}`, "content-type": "application/json"},
    body: JSON.stringify({query: baselineReadTransaction()}), signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`catalog read failed: HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.baseline) throw new Error("invalid catalog response");
  const baseline = {...rows[0].baseline, projectRef: PROJECT_REF};
  const summary = summarizeBaseline(baseline);
  await writeFile(args[1], `${JSON.stringify(baseline, null, 2)}\n`, {flag: "wx", mode: 0o600});
  console.log(JSON.stringify(summary));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    // Never dump HTTP bodies, Keychain stderr, or authentication data.
    console.error(error instanceof Error && !error.stderr ? error.message : "baseline audit failed");
    process.exitCode = 1;
  });
}
