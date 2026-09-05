import{execFileSync}from'node:child_process';
import{readFile}from'node:fs/promises';
import{resolve}from'node:path';
import{fileURLToPath}from'node:url';
import{unseal,renderDDL,sha256}from'./db-baseline-export.mjs';
export function assertIsolatedTarget(env){
 if(!['127.0.0.1','::1','localhost'].includes(env.PGHOST)||!/^sellerpilot_baseline_[a-z0-9_]+$/.test(env.PGDATABASE??'')||!env.PGUSER||env.PGSERVICE)throw Error('restore requires explicit loopback PGHOST, PGUSER, sellerpilot_baseline_* database, no PGSERVICE');
}
const ident=s=>'"'+s.replaceAll('"','""')+'"';
const lit=s=>"'"+s.replaceAll("'","''")+"'";
export function prerequisites(p){
 return p.roles.map(r=>`DO $baseline$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname=${lit(r.name)}) THEN CREATE ROLE ${ident(r.name)} NOLOGIN ${r.inherit?'INHERIT':'NOINHERIT'} ${r.bypassRls?'BYPASSRLS':'NOBYPASSRLS'} ${r.superuser?'SUPERUSER':'NOSUPERUSER'} ${r.createDb?'CREATEDB':'NOCREATEDB'} ${r.createRole?'CREATEROLE':'NOCREATEROLE'} ${r.replication?'REPLICATION':'NOREPLICATION'}; ELSE IF EXISTS(SELECT FROM pg_roles WHERE rolname=${lit(r.name)} AND (rolinherit IS DISTINCT FROM ${Boolean(r.inherit)} OR rolbypassrls IS DISTINCT FROM ${Boolean(r.bypassRls)} OR rolsuper IS DISTINCT FROM ${Boolean(r.superuser)} OR rolcreatedb IS DISTINCT FROM ${Boolean(r.createDb)} OR rolcreaterole IS DISTINCT FROM ${Boolean(r.createRole)} OR rolreplication IS DISTINCT FROM ${Boolean(r.replication)})) THEN RAISE EXCEPTION 'existing role security attribute mismatch'; END IF; END IF; END $baseline$;`).join('\n')+'\n'+[...new Set(p.extensions.map(e=>e.schema))].filter(s=>s!=='pg_catalog').map(s=>`CREATE SCHEMA IF NOT EXISTS ${ident(s)};`).join('\n')+'\n'+p.extensions.filter(e=>e.name!=='plpgsql').map(e=>`CREATE EXTENSION IF NOT EXISTS ${ident(e.name)} WITH SCHEMA ${ident(e.schema)} VERSION ${lit(e.version)};`).join('\n');
}
export function compareDDL(a,b){
 const normalize=p=>p.objects.map(o=>`${o.kind}\0${o.identity}\0${o.ddl}`).sort();
 const left=normalize(a),right=normalize(b);const roles=p=>[...(p.roles??[])].sort((x,y)=>x.name.localeCompare(y.name));return{matches:JSON.stringify(left)===JSON.stringify(right)&&JSON.stringify(roles(a))===JSON.stringify(roles(b)),expected:sha256(JSON.stringify(left)),actual:sha256(JSON.stringify(right))};
}
async function main(args){
 if(args.length!==3||args[0]!=='--ack-isolated-baseline')throw Error('usage: --ack-isolated-baseline <encrypted-bundle> <private-key>');
 assertIsolatedTarget(process.env);
 // Never accept an arbitrary remote URL, invoke a shell, print SQL, or pass keys in argv.
 const run=sql=>execFileSync('psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8',stdio:['pipe','pipe','pipe'],maxBuffer:64*1024*1024,env:process.env});
 const p=unseal(await readFile(args[1],'utf8'),await readFile(args[2]));const ddl=renderDDL(p);
 const check=JSON.parse(run(`SELECT json_build_object('major',current_setting('server_version_num')::int/10000,'empty',NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','sellerpilot_private','auth','storage') AND c.relkind IN ('r','p','v','m','S')));`));
 if(check.major!==Number(p.serverVersion.split('.')[0])||!check.empty)throw Error('target must be an empty matching-major disposable database');
 // Installation may require pg_net/pg_cron preload configuration. Failure is fatal.
 run(prerequisites(p));
 const versions=JSON.parse(run(`SELECT json_agg(json_build_object('name',extname,'version',extversion)) FROM pg_extension;`));
 if(p.extensions.some(e=>!versions.some(v=>v.name===e.name&&v.version===e.version)))throw Error('extension version mismatch');
 run(ddl);
 let query=await readFile(new URL('./db-baseline-catalog.sql',import.meta.url),'utf8');
 query=query.replace("(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name) ORDER BY version) FROM supabase_migrations.schema_migrations)","'[]'::jsonb");
 const actual=JSON.parse(run('BEGIN READ ONLY; SET LOCAL search_path=pg_catalog; '+query+' COMMIT;'));
 const result=compareDDL(p,actual);console.log(JSON.stringify({...result,nativeRestoreVerified:result.matches,historicalReplayProven:false,dataRowsRestored:0}));
 if(!result.matches)process.exitCode=1;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(()=>{console.error('baseline restore failed; no SQL or credential output; disposable target may need recreation');process.exitCode=1;});
