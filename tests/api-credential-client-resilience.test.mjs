import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const credentialCenterUrl = new URL("../app/api-credential-center.tsx", import.meta.url);

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

test("credential metadata loading always releases its loading state after transport failures", async () => {
  const source = await readFile(credentialCenterUrl, "utf8");
  const load = section(source, "const load = useCallback", "useEffect(() =>");

  assert.match(load, /try \{/);
  assert.match(load, /catch \{/);
  assert.match(load, /finally \{\s*setLoading\(false\);\s*\}/);
});

test("credential connection tests always unlock their button after network exceptions", async () => {
  const source = await readFile(credentialCenterUrl, "utf8");
  const connectionTest = section(source, "const testConnection = async", "const startOAuth = async");

  assert.match(connectionTest, /try \{/);
  assert.match(connectionTest, /catch \{/);
  assert.match(connectionTest, /finally \{\s*setTestingId\(""\);\s*\}/);
});

test("credential saves always release their pending state after session or fetch exceptions", async () => {
  const source = await readFile(credentialCenterUrl, "utf8");
  const submit = section(source, "const submit = async", "return <div className=\"credential-modal-backdrop\"");

  assert.match(submit, /setSaving\(true\);[\s\S]*?try \{/);
  assert.match(submit, /catch \{/);
  assert.match(submit, /finally \{\s*setSaving\(false\);\s*\}/);
});
