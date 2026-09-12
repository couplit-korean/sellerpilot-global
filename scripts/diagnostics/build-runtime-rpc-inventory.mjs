import ts from 'typescript';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Inspect executable call sites, not string searches through SQL/docs/tests.
// Unresolvable dynamic arguments are listed explicitly; an empty missing-RPC
// query is not proof that those dynamic paths or provider permissions work.
async function sourceFiles(directory) {
  let entries;
  try { entries=await readdir(directory,{withFileTypes:true}); }
  catch(error) { if(error.code==='ENOENT')return [];throw error; }
  const nested=await Promise.all(entries.map(async entry=>{
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())return sourceFiles(file);
    return /\.(?:tsx?|mjs|js)$/.test(entry.name)&&!entry.name.endsWith('.d.ts')?[file]:[];
  }));
  return nested.flat();
}

export async function collectRuntimeRpcInventory(root) {
  const files=(await Promise.all(['app','lib'].map(d=>sourceFiles(path.join(root,d))))).flat().sort();
  const program=ts.createProgram(files,{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
    allowJs:true,noEmit:true,skipLibCheck:true,
  });
  const checker=program.getTypeChecker();
  function strings(node,seen=new Set()) {
    if(!node||seen.has(node))return null;
    const next=new Set(seen);next.add(node);
    if(ts.isStringLiteralLike(node))return [node.text];
    if(ts.isAsExpression(node)||ts.isParenthesizedExpression(node)||ts.isSatisfiesExpression(node))return strings(node.expression,next);
    if(ts.isConditionalExpression(node)) {
      const a=strings(node.whenTrue,next),b=strings(node.whenFalse,next);
      return a&&b?[...new Set([...a,...b])]:null;
    }
    if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.PlusToken) {
      const a=strings(node.left,next),b=strings(node.right,next);
      return a&&b&&a.length*b.length<=64?a.flatMap(x=>b.map(y=>x+y)):null;
    }
    let symbol=checker.getSymbolAtLocation(node);
    if(symbol?.flags&ts.SymbolFlags.Alias)symbol=checker.getAliasedSymbol(symbol);
    const declaration=symbol?.valueDeclaration;
    if(declaration&&ts.isVariableDeclaration(declaration)&&declaration.initializer) {
      // Mutable runtime names are not statically proven by their initial value.
      if(ts.isVariableDeclarationList(declaration.parent)&&(declaration.parent.flags&ts.NodeFlags.Const)) {
        const result=strings(declaration.initializer,next);if(result)return result;
      }
    }
    const type=checker.getTypeAtLocation(node);
    const members=type.isUnion()?type.types:[type];
    return members.length&&members.every(t=>t.flags&ts.TypeFlags.StringLiteral)?members.map(t=>t.value):null;
  }
  const entries=new Map();const unresolved=[];let callCount=0;
  for(const file of files) {
    const source=program.getSourceFile(file);if(!source)continue;
    function visit(node) {
      if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='rpc') {
        callCount++;
        const location={file:path.relative(root,file).split(path.sep).join('/'),line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1};
        const names=strings(node.arguments[0]);
        if(!names)unresolved.push({...location,argument:node.arguments[0]?.getText(source).slice(0,200)??'<missing>'});
        else for(const name of new Set(names)) {
          if(!/^sellerpilot_[a-z0-9_]+$/.test(name))continue;
          if(!entries.has(name))entries.set(name,[]);entries.get(name).push(location);
        }
      }
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
  return {sourceFileCount:files.length,callCount,functions:[...entries].sort(([a],[b])=>a.localeCompare(b)).map(([name,callSites])=>({name,callSites})),unresolved};
}

export function missingRuntimeRpcSql(inventory) {
  if(!inventory.functions.length)throw new Error('No runtime RPCs resolved');
  const names=inventory.functions.map(({name})=>{
    if(!/^sellerpilot_[a-z0-9_]+$/.test(name))throw new Error('Invalid RPC identifier');
    return `('${name}')`;
  });
  return `-- Read only. Verify Aside target sqaoqucxakebqkiygdxb before running.\n-- Dynamic unresolved call sites require separate review. No application RPC is invoked.\nbegin read only;\nset local statement_timeout='5s';\nwith required(name) as (values\n${names.join(',\n')}\n)\nselect r.name as missing_runtime_rpc from required r\nwhere not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=r.name)\norder by r.name;\nrollback;\n`;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [prefix]=process.argv.slice(2);
  if(!prefix||!path.isAbsolute(prefix))throw new Error('Usage: /absolute/output-prefix');
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const inventory=await collectRuntimeRpcInventory(root);
  await writeFile(prefix+'.json',JSON.stringify(inventory,null,2)+'\n',{flag:'wx',mode:0o600});
  await writeFile(prefix+'.sql',missingRuntimeRpcSql(inventory),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({sourceFileCount:inventory.sourceFileCount,callCount:inventory.callCount,functions:inventory.functions.length,unresolved:inventory.unresolved.length,outputPrefix:prefix,executesDatabase:false}));
}
