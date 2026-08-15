import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

const webPort = process.env.SELLERPILOT_WEB_PORT || "3100";

const children = [
  spawn(process.execPath, ["scripts/local-analyzer-server.mjs"], {
    stdio: "inherit",
  }),
  spawn(process.execPath, [resolve("node_modules/vinext/dist/cli.js"), "dev", "--port", webPort], {
    stdio: "inherit",
    env: {
      ...process.env,
      WRANGLER_LOG_PATH: ".wrangler/wrangler.log",
    },
  }),
];

let stopping = false;
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 200).unref();
}

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      process.stderr.write(`로컬 데모 프로세스가 중단됐습니다 (${signal || code}).\n`);
      stop(code || 1);
    }
  });
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
