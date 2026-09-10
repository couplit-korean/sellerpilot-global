import { execFileSync } from 'node:child_process';
export const PROJECT_REF = 'sqaoqucxakebqkiygdxb';
export async function readCatalog(sql) {
  // Callers supply static catalog SELECTs only. No payload logging.
  const token = execFileSync('security', ['find-generic-password','-s','Supabase CLI','-a','supabase','-w'], {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query:`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL search_path = pg_catalog; ${sql}; COMMIT;`}),signal:AbortSignal.timeout(90000)});
  if (!r.ok) throw new Error(`catalog read HTTP ${r.status}`);
  return r.json();
}
