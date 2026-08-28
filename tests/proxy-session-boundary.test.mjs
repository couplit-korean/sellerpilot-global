import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("internal scheduler routes bypass only the end-user session refresh", async () => {
  const source = await readFile(new URL("proxy.ts", root), "utf8");
  const handlerStart = source.indexOf("export async function proxy");
  const configStart = source.indexOf("export const config", handlerStart);
  assert.ok(handlerStart >= 0 && configStart > handlerStart, "proxy handler boundary is missing");
  const handler = source.slice(handlerStart, configStart);

  const internalBoundary = handler.indexOf('request.nextUrl.pathname.startsWith("/api/internal/")');
  const bypass = handler.indexOf("return NextResponse.next()", internalBoundary);
  const sessionRefresh = handler.indexOf("return updateSession(request)");

  assert.ok(internalBoundary >= 0, "internal routes must have an explicit path boundary");
  assert.ok(bypass > internalBoundary, "internal routes must continue without a user session refresh");
  assert.ok(sessionRefresh > bypass, "ordinary routes must retain the existing user session refresh");
  assert.equal((handler.match(/updateSession\(request\)/g) ?? []).length, 1);
  assert.doesNotMatch(handler, /catch\s*\{/);
});

test("the proxy matcher still sends internal and ordinary application routes through the boundary", async () => {
  const source = await readFile(new URL("proxy.ts", root), "utf8");

  assert.match(source, /import \{ NextResponse, type NextRequest \} from "next\/server"/);
  assert.match(source, /matcher: \["\/\(\(\?!_next\/static\|_next\/image\|favicon\.ico\|/);
  assert.doesNotMatch(source, /\(\?![^\n]*api\/internal/);
});
