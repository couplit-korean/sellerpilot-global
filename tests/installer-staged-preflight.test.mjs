import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import vm from "node:vm";
import test from "node:test";

const source = await readFile(new URL("../scripts/install-ai-worker-launch-agent.mjs", import.meta.url), "utf8");
const start = source.indexOf("function stagedPreflightCommand(");
const end = source.indexOf("async function activateStagedRuntime(", start);
assert.ok(start >= 0 && end > start);
const isolatedSource = source.slice(start, end);
function harness({ missing, failedStep, failure = { code: "ETIMEDOUT" } } = {}) {
  const calls = [], checked = [], copied = [], removed = [];
  const context = vm.createContext({
    process: { execPath: "/fixture/node22", env: {} }, dirname, join,
    sourceRoot: "/fixture/source", runtimeRoot: "/fixture/runtime/current",
    findPnpm: async () => "/fixture/pnpm",
    mkdir: async () => {}, mkdtemp: async () => "/fixture/stage",
    cp: async (from, to) => { copied.push({ from, to }); },
    rm: async (path) => { removed.push(path); },
    access: async (path) => { checked.push(path); if (path.endsWith(missing ?? "never-missing")) throw new Error("fixture missing"); },
    command: (program, args, options) => {
      calls.push({ program, args: [...args], options });
      const step = args.includes("--check") ? "syntax" : args.includes("-typecheck") ? "swift"
        : args.some((value) => value === "await import('sharp');") ? "sharp"
          : args.includes("--import") ? "marketplace-images" : "install";
      if (step === failedStep) throw { ...failure, stderr: "private child output", message: "private child output" };
      return "";
    },
  });
  vm.runInContext(isolatedSource, context);
  return { calls, checked, copied, removed,
    validate: () => vm.runInContext('validateStagedRuntime("/fixture/stage")', context),
    stage: () => vm.runInContext("stageRuntime()", context) };
}

test("staging copies only approved runtime directories plus dependency manifests, including prompts", async () => {
  const h = harness();
  assert.equal(await h.stage(), "/fixture/stage");
  assert.deepEqual(h.copied.map(({ from }) => from.replace("/fixture/source/", "")),
    ["lib", "scripts", "prompts", "package.json", "pnpm-lock.yaml", "tsconfig.json"]);
  assert.equal(h.removed.length, 0);
  assert.ok(h.checked.includes("/fixture/stage/prompts/detail-pages/category-prompts.json"));
});

test("every worker-relative startup file is checked before subprocess preflight", async () => {
  const worker = await readFile(new URL("../scripts/ai-cli-worker.mjs", import.meta.url), "utf8");
  const runtimePaths = [...worker.matchAll(/const \w+Path = resolve\("((?:scripts|prompts)\/[^"]+)"\)/g)].map((match) => match[1]);
  assert.equal(runtimePaths.length, 6);
  const h = harness();
  await h.validate();
  for (const path of runtimePaths) assert.ok(h.checked.includes(`/fixture/stage/${path}`), path);
  assert.equal(h.calls.length, 4);
  for (const call of h.calls) {
    assert.equal(call.options.cwd, "/fixture/stage");
    assert.equal(call.options.timeout, 60_000);
    assert.equal(call.options.killSignal, "SIGKILL");
    assert.equal(call.options.maxBuffer, 1024 * 1024);
  }
});

test("missing prompt fails before any subprocess; failed staging cleans only its own directory", async () => {
  const h = harness({ missing: "prompts/detail-pages/category-prompts.json" });
  await assert.rejects(h.validate(), /required file missing: prompts\/detail-pages\/category-prompts.json/);
  assert.equal(h.calls.length, 0);
  await assert.rejects(h.stage(), /required file missing/);
  assert.deepEqual(h.removed, ["/fixture/stage"]);
});

test("timeout, OS signal and exit failure are distinguished without child output disclosure", async () => {
  for (const [failure, reason] of [[{ code: "ETIMEDOUT", signal: "SIGKILL" }, "timeout"],
    [{ signal: "SIGKILL" }, "signal SIGKILL"], [{ status: 1 }, "exit 1"]]) {
    const h = harness({ failedStep: "sharp", failure });
    await assert.rejects(h.validate(), (error) => {
      assert.equal(error.message, `Staged runtime preflight sharp: ${reason}`);
      assert.ok(!error.message.includes("private"));
      return true;
    });
    assert.equal(h.calls.length, 3, "later module check must not run after failure");
  }
});

test("all subprocess failure points reject before a staged runtime can be returned", async () => {
  for (const failedStep of ["syntax", "swift", "sharp", "marketplace-images"]) {
    const h = harness({ failedStep });
    await assert.rejects(h.stage(), new RegExp(`preflight ${failedStep}: timeout`));
    assert.deepEqual(h.removed, ["/fixture/stage"]);
  }
});
