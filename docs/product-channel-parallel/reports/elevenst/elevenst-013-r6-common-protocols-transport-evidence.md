# elevenst-013-r6 common patch — protocols transportEvidence

- requestId: `elevenst-013-r6-common-protocols-transport-evidence`
- frozen: no
- applied locally in this worktree: yes
- reason: shared `elevenstSellerXmlRequest` now returns `transportEvidence`. Serverless drain claims/finishes only through owned `recovery_v2` plus official GET raw hashes. Existing SellerPrdCd 409 cannot complete as a fresh CREATE.

## Target

- file: `lib/channels/protocols.ts`
- local before SHA-256: `274e64a9ddfe28859710be38e40cd73ff7abe25984ac15f24b7e862700e09e1d`

## Minimal unified patch

```diff
--- a/lib/channels/protocols.ts
+++ b/lib/channels/protocols.ts
@@
   const { response, xml, bytes } = await elevenstSellerXmlTransport(input);
+  const transportEvidence = {
+    method: input.method,
+    requestBytesSha256: createHash("sha256")
+      .update(`${input.method}\n${input.path}\n${input.body ?? ""}`, "utf8")
+      .digest("hex"),
+    responseBodySha256: createHash("sha256")
+      .update(Buffer.from(bytes))
+      .digest("hex"),
+    responseBodyBytes: bytes.byteLength,
+  };
   const documentRoot = /^(?:\s*<\?xml[^>]*>\s*)?<([A-Za-z_][\w.:-]*)\b/u.exec(xml)?.[1] ?? "";
@@
     data: {
       accepted: response.ok && acceptedCode,
+      transportEvidence,
       ...(resultCode ? { resultCode: resultCode.slice(0, 80) } : {}),
```

## Contract

- GET request identity is `GET\\n{path}\\n`.
- Recovery finish RPC hashes the same GET identity for sellerprodcode / prodmarket / product / stock.
- This patch does not enqueue jobs or mutate the provider.

## Not in this proposal

- `lib/channels/serverless-gateway.ts` GET-only recovery drain. Common file. r6 finish/claim RPCs exist; a serverless drain still needs central wiring.
