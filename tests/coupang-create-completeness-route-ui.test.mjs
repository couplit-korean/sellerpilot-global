import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(
  new URL("../app/api/admin/channel-operations/route.ts", import.meta.url),
  "utf8",
);
const ui = await readFile(
  new URL("../app/product-publish-workbench.tsx", import.meta.url),
  "utf8",
);

test("Coupang CREATE readiness precedes revision binding, fingerprint and claim", () => {
  const readiness = route.indexOf("buildCoupangCreateReadinessSource({");
  const durableSnapshot = route.indexOf(
    "sellerpilot_service_record_coupang_create_official_snapshot",
    readiness,
  );
  const bind = route.indexOf("bindCoupangCreateSourceRevision({", readiness);
  const fingerprint = route.indexOf('const requestFingerprint = createHash("sha256")', bind);
  const claim = route.indexOf('sellerpilot_claim_channel_operation', fingerprint);
  assert.ok(readiness > 0 && durableSnapshot > readiness && bind > durableSnapshot
    && fingerprint > bind && claim > fingerprint);
  const gate = route.indexOf('mode: "coupang_create_completeness_required"', readiness);
  assert.ok(gate > readiness && gate < bind);
  assert.match(route.slice(readiness, bind), /providerWritePerformed: false/);
  assert.match(route.slice(readiness, bind), /jobCreated: false/);
  assert.match(route.slice(durableSnapshot, bind), /officialReadSnapshotDigestSha256/u);
  assert.match(route.slice(fingerprint, claim), /\.update\(canonicalJson\(requestIdentity\)\)/u);
});

test("Coupang CREATE provider preparation is GET-only before claim", () => {
  const readiness = route.lastIndexOf("runWithProviderReadOnlyTransport", route.indexOf("buildCoupangCreateReadinessSource({"));
  const bind = route.indexOf("bindCoupangCreateSourceRevision({", readiness);
  const block = route.slice(readiness, bind);
  assert.equal((block.match(/method: "GET"/gu) ?? []).length, 4);
  assert.doesNotMatch(block, /method: "(?:POST|PUT|PATCH|DELETE)"/u);
  assert.match(block, /runWithProviderReadOnlyTransport/u);
  assert.match(block, /placeCodes:/u);
  assert.match(block, /return\/shipping-places\/center-code/u);
  assert.match(block, /returnCenterCodes:/u);
  assert.doesNotMatch(block, /pageNum: "1"|pageSize: "50"/u);
});

test("workbench renders the 19-row gate and blocks direct and bulk execution", () => {
  assert.match(ui, /<CoupangCreateCompletenessFields/u);
  assert.match(ui, /setCoupangCreateValidation/u);
  assert.match(ui, /const coupangSnapshotCurrent = coupangCreateValidation\.canBindCreateSourceRevision/u);
  assert.match(ui, /coupangValidatedDraft === \(drafts\.coupang \?\? ""\)/u);
  assert.match(ui, /const coupangCreateReady =/u);
  assert.match(ui, /&& coupangCreateReady/u);
  assert.match(ui, /\|\| coupangCompletenessBlocked \|\|/u);
  assert.match(ui, /coupangCompletenessBlocked \? "쿠팡 공식 등록 조건 확인 후 등록"/u);
  assert.match(ui, /credentialVersion=\{credential\?\.version\}/u);
  assert.match(ui, /observedTuple\.credentialVersion === credential\?\.version/u);
  // All mutations now carry the common, validated current credential version;
  // Coupang retains its additional observed-readiness/version equality gate.
  const version = ui.indexOf("const requestCredentialVersion = Number.isSafeInteger(credential.version)");
  const contract = ui.indexOf("const mutationContract =", version);
  assert.ok(version > 0 && contract > version);
  assert.match(ui.slice(version, contract), /if \(requestCredentialVersion === undefined\)/u);
  assert.match(ui.slice(contract, ui.indexOf("const payload", contract)), /credentialVersion: requestCredentialVersion/u);
});

test("Coupang official refresh saves and reads back the current source before requesting readiness", async () => {
  const component = await readFile(
    new URL("../app/_publishing/coupang/create-completeness-fields.tsx", import.meta.url),
    "utf8",
  );
  const prepare = ui.indexOf("const prepareCoupangCreateReadiness");
  const initialSave = ui.indexOf("await saveRegistrationDraft()", prepare);
  const contextRead = ui.indexOf("/publish-context?mode=draft", initialSave);
  const fingerprint = ui.indexOf("productRegistrationSourceFingerprint(refreshedContext)", contextRead);
  const reboundSave = ui.indexOf("putProductRegistrationDraft", fingerprint);
  const readback = ui.indexOf("getProductRegistrationDraft<PublishRegistrationData>", reboundSave);
  const preparedTuple = ui.indexOf("sourceFingerprint,", readback);
  assert.ok(prepare > 0 && initialSave > prepare && contextRead > initialSave
    && fingerprint > contextRead && reboundSave > fingerprint && readback > reboundSave
    && preparedTuple > readback);
  assert.match(ui.slice(readback, preparedTuple), /JSON\.stringify\(readback\.data\) !== reboundSignature/u);
  assert.match(ui, /onPrepareRefresh=\{prepareCoupangCreateReadiness\}/u);

  const refresh = component.indexOf("const refresh = async");
  const prepared = component.indexOf("await onPrepareRefresh(controller.signal)", refresh);
  const identity = component.indexOf("coupangCreateReadinessRequestIdentity(prepared)", prepared);
  const request = component.indexOf('fetch("/api/admin/coupang-create-readiness"', identity);
  assert.ok(refresh > 0 && prepared > refresh && identity > prepared && request > identity);
  assert.match(component.slice(request), /sourceFingerprint: prepared\.tuple\.sourceFingerprint/u);
  assert.match(component.slice(request), /draft: prepared\.draft/u);
});

test("Coupang CREATE re-reads source, manifest and credential immediately before claim", () => {
  const preclaim = route.indexOf('mode: "coupang_create_source_changed_before_claim"');
  const claim = route.indexOf('sellerpilot_claim_channel_operation', preclaim);
  assert.ok(preclaim > 0 && claim > preclaim);
  const blockStart = route.lastIndexOf('if (channel === "coupang" && operation === "listing.create")', preclaim);
  const block = route.slice(blockStart, claim);
  assert.match(block, /sellerpilot_get_product_publish_context/u);
  assert.match(block, /approvedProductDetailManifestFromPublishContext/u);
  assert.match(block, /sellerpilot_list_credentials/u);
  assert.match(block, /sellerpilot_decrypt_credential/u);
  assert.match(block, /bindCoupangCreateSourceRevision/u);
  assert.match(block, /officialReadSnapshotId/u);
  assert.match(block, /officialReadSnapshotDigestSha256/u);
  assert.match(block, /canonicalJson\(rebound\[coupangCreateSourceRevisionArgument\]\)/u);
});

test("actual component keeps preparation through equivalent renders and posts the newly prepared tuple; target switches cancel", async () => {
  const [{ default: ts }, React, { createRoot }, { Window }, { tsImport }] = await Promise.all([
    import("typescript"), import("react"), import("react-dom/client"),
    import("../node_modules/.pnpm/happy-dom@20.11.2/node_modules/happy-dom/lib/index.js"),
    import("tsx/esm/api"),
  ]);
  const view = await tsImport("../lib/product-registration/coupang/create-completeness-view.ts", import.meta.url);
  const jsx = await import("react/jsx-runtime");
  const componentSource = await readFile(new URL("../app/_publishing/coupang/create-completeness-fields.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("component.tsx", componentSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const implementation = ast.statements.filter(node => !ts.isImportDeclaration(node)
    && !ts.isExportDeclaration(node)).map(node => node.getText(ast)).join("\n").replace(/^export /gmu, "");
  const output = ts.transpileModule(implementation, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const dependencies = {
    require: name => { assert.equal(name, "react/jsx-runtime"); return jsx; }, exports: {},
    useEffect: React.useEffect, useMemo: React.useMemo, useRef: React.useRef, useState: React.useState,
    coupangCreateReadinessRequestIdentity: view.coupangCreateReadinessRequestIdentity,
    coupangCreateReadinessResponseIsCurrent: view.coupangCreateReadinessResponseIsCurrent,
    emptyCoupangCreateCompletenessValidation: view.emptyCoupangCreateCompletenessValidation,
    mapCoupangCreateCompletenessView: view.mapCoupangCreateCompletenessView,
    createClient: () => ({ auth: { getSession: async () => ({ data: { session: { access_token: "fixture-only" } } }) } }),
  };
  const Component = new Function(...Object.keys(dependencies), `${output}\nreturn CoupangCreateCompletenessFields;`)(...Object.values(dependencies));
  const window = new Window({ url: "https://fixture.invalid" });
  const globals = { window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, Node: window.Node, Event: window.Event,
    IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key,value] of Object.entries(globals)) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const originalFetch = globalThis.fetch;
  const posts=[];
  globalThis.fetch=async(url,init)=>{ assert.equal(url,"/api/admin/coupang-create-readiness");posts.push(JSON.parse(init.body));return Response.json({message:"fixture blocked; no provider action"},{status:409}); };
  let root;
  try {
    for (const switchTarget of [false,true]) {
      const container=window.document.createElement("div");window.document.body.append(container);root=createRoot(container);
      let resolvePreparation, signal;
      const pending=new Promise(resolve=>{resolvePreparation=resolve;});
      const tuple={productId:"10000000-0000-4000-8000-000000000001",credentialId:"20000000-0000-4000-8000-000000000001",credentialVersion:2,categoryId:"1948",sourceFingerprint:"a".repeat(64)};
      const prepared={tuple:{...tuple,sourceFingerprint:"b".repeat(64)},draft:{product:{name:"saved current draft"}}};
      const callbacks={onChange:()=>{},onValidationChange:()=>{},onPrepareRefresh:async(value)=>{
        signal=value;await pending;
        if(!value.aborted)root.render(React.createElement(Component,{...prepared.tuple,draft:prepared.draft,...callbacks}));
        return prepared;
      }};
      await React.act(async()=>root.render(React.createElement(Component,{...tuple,draft:{product:{name:"original"}},...callbacks})));
      await React.act(async()=>container.querySelector("button").click());
      assert.ok(signal);assert.equal(signal.aborted,false);
      await React.act(async()=>root.render(React.createElement(Component,{...tuple,
        ...(switchTarget?{productId:"10000000-0000-4000-8000-000000000002"}:{}),draft:{product:{name:"original"}},...callbacks})));
      assert.equal(signal.aborted,switchTarget);
      const count=posts.length;
      await React.act(async()=>{resolvePreparation();await pending;});
      assert.equal(posts.length,count+(switchTarget?0:1));
      if(!switchTarget){assert.deepEqual(posts.at(-1),{...prepared.tuple,draft:prepared.draft});assert.equal(signal.aborted,false);}
      await React.act(async()=>root.unmount());root=null;container.remove();
    }
  } finally {
    if(root)await React.act(async()=>root.unmount());
    globalThis.fetch=originalFetch;
    for(const[key,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
    await window.happyDOM.close();
  }
});
