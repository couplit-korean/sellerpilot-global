import {readdir} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export function checkMigrationVersion(candidate,existingNames){
  const name=basename(candidate);
  const match=/^(\d{14})_[a-z0-9_]+\.sql$/u.exec(name);
  if(!match) throw new Error('Use YYYYMMDDHHMMSS_name.sql for the new migration.');
  const version=match[1];
  const parts=[version.slice(0,4),version.slice(4,6),version.slice(6,8),version.slice(8,10),version.slice(10,12),version.slice(12,14)].map(Number);
  const stamp=new Date(Date.UTC(parts[0],parts[1]-1,parts[2],parts[3],parts[4],parts[5]));
  const actual=[stamp.getUTCFullYear(),stamp.getUTCMonth()+1,stamp.getUTCDate(),stamp.getUTCHours(),stamp.getUTCMinutes(),stamp.getUTCSeconds()];
  if(actual.some((value,index)=>value!==parts[index])) throw new Error(`Invalid calendar timestamp: ${version}`);
  const conflicts=existingNames.filter((item)=>item!==name&&item.startsWith(`${version}_`));
  if(conflicts.length) throw new Error(`Migration version ${version} already belongs to: ${conflicts.join(', ')}`);
  return {version,name};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==3) throw new Error('Usage: node scripts/check-migration-version.mjs YYYYMMDDHHMMSS_name.sql');
    // Read filenames only. Never load or execute migration bodies here.
    const names=await readdir(new URL('../supabase/migrations/',import.meta.url));
    const result=checkMigrationVersion(process.argv[2],names);
    console.log(`No local filename collision: ${result.version} (${result.name}). Also compare production history by version, name and source hash before applying.`);
  }catch(error){
    console.error(error instanceof Error?error.message:'Migration version check failed.');
    process.exitCode=1;
  }
}
