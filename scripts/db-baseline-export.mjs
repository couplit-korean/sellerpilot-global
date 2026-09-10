import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readCatalog,PROJECT_REF} from './db-baseline-read.mjs';
export const sha256 = s => createHash('sha256').update(s).digest('hex');
export function inspectPackage(p) {
 if (!Array.isArray(p.objects)||!p.objects.length||p.objects.some(x=>!x.ddl||!x.identity)) throw Error('invalid catalog DDL');
 const sql=p.objects.map(x=>x.ddl).join('\n');
 // Never print matching literals. Detection is defense in depth, not proof of absence.
 const risks=[...sql.matchAll(/(?:Bearer\s+[A-Za-z0-9._-]{16,}|(?:sb_secret_|sbp_)[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:access_token|refresh_token|client_secret|password|token_hash)\s*(?::=|=|=>)\s*'[A-Za-z0-9_./+=-]{16,}')/gi)].length;
 return {format:'sellerpilot-explicit-ddl-baseline-v1',projectRef:PROJECT_REF,capturedAt:p.capturedAt,serverVersion:p.serverVersion,objects:p.objects.length,ddlBytes:Buffer.byteLength(sql),ddlSha256:sha256(sql),historyCount:p.history?.length,lastHistory:p.history?.at(-1)?.version,unsupported:p.unsupported??[],externalDependencies:p.externalDependencies??[],literalRiskMatches:risks,secretScanProvesAbsence:false,encryptedAtRest:true,dataRowsExported:0,historicalReplayProven:false,nativeRestoreVerified:false,dependencyClosureVerified:false};
}
export function seal(value,key,iv=randomBytes(12)) {
 const c=createCipheriv('aes-256-gcm',key,iv); const body=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);
 return JSON.stringify({format:'aes-256-gcm-v1',iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),body:body.toString('base64')});
}
export function unseal(text,key) {
 const e=JSON.parse(text); if(e.format!=='aes-256-gcm-v1')throw Error('invalid envelope');
 const d=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'base64'));d.setAuthTag(Buffer.from(e.tag,'base64'));
 return JSON.parse(Buffer.concat([d.update(Buffer.from(e.body,'base64')),d.final()]).toString());
}
export function renderDDL(p) {
 const s=inspectPackage(p); if(s.unsupported.length||s.externalDependencies.length)throw Error('restore blocked: unsupported objects or unresolved external dependencies');
 // Functions may refer forward to other functions. Validation happens in native round-trip, never by replacing bodies.
 return 'BEGIN;\nSET LOCAL check_function_bodies = off;\nSET LOCAL search_path = pg_catalog;\n'+p.objects.map(x=>x.ddl).join('\n')+'\nCOMMIT;\n';
}
async function main(args){
 if(args.length!==4||args[0]!=='--out'||args[2]!=='--key-file')throw Error('usage: --out <new-encrypted-bundle> --key-file <new-private-key-outside-repo>');
 const out=resolve(args[1]),keyPath=resolve(args[3]);
 const repo=resolve(fileURLToPath(new URL('../',import.meta.url)));
 if(keyPath.startsWith(repo+'/'))throw Error('key must remain outside repository');
 const rows=await readCatalog(await readFile(new URL('./db-baseline-catalog.sql',import.meta.url),'utf8'));
 const p=rows?.[0]?.package; const summary=inspectPackage(p);const key=randomBytes(32);
 await mkdir(dirname(out),{recursive:true,mode:0o700});await mkdir(dirname(keyPath),{recursive:true,mode:0o700});
 await writeFile(keyPath,key,{flag:'wx',mode:0o600});
 await writeFile(out,seal(p,key),{flag:'wx',mode:0o600});
 await writeFile(out+'.manifest.json',JSON.stringify(summary,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(summary));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(()=>{console.error('baseline export failed; credentials and server response suppressed');process.exitCode=1;});
