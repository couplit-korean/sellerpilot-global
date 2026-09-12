import { readFileSync } from "node:fs";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const policy = JSON.parse(readFileSync(path.join(root, "docs/parallel-tasks/ownership.json"), "utf8"));

export function workspaceOwner(file) {
  if (typeof file !== "string" || !file.trim() || file.includes("\\")) throw new Error("Invalid workspace file");
  const absolute = path.resolve(root, file);
  const relative = path.relative(root, absolute).split(path.sep).join("/");
  if (!relative || relative === ".." || relative.startsWith("../")) throw new Error("File is outside workspace");
  const owners = Object.entries(policy.lanes)
    .filter(([, lane]) => lane.patterns.some(pattern => new RegExp(pattern, "u").test(relative)))
    .map(([id]) => id);
  if (owners.length > 1) throw new Error(`Overlapping owners for ${relative}: ${owners.join(", ")}`);
  return owners[0] ?? policy.defaultOwner;
}

export function checkOwnership(lane, files) {
  if (!(lane in policy.lanes)) throw new Error(`Unknown task lane: ${lane}`);
  if (!files.length) throw new Error("Provide explicit file paths to check");
  return files.map(file => ({ file, owner: workspaceOwner(file), allowed: workspaceOwner(file) === lane }));
}

// Lock directories stay inside the existing checkout; no project copies/worktrees.
// An abandoned lock is deliberately not stolen: the integration owner must first
// confirm that no child build/deploy/runtime process remains active.
export async function acquireWorkspaceLock(resource, lane, directory = path.join(root, ".local/parallel-locks")) {
  if (!policy.resources[resource]?.includes(lane)) throw new Error(`${lane} cannot own resource ${resource}`);
  await mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, `${resource}.json`);
  let handle;
  try { handle = await open(lockPath, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(`Resource ${resource} is locked. Inspect ${lockPath}; do not start a competing command.`);
  }
  const record = { resource, lane, pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() };
  try { await handle.writeFile(JSON.stringify(record, null, 2) + "\n"); }
  finally { await handle.close(); }
  return async () => {
    const current = JSON.parse(await readFile(lockPath, "utf8"));
    if (current.token !== record.token) throw new Error("Workspace lock ownership changed; refusing to remove it");
    await unlink(lockPath);
  };
}

async function runLocked(resource, lane, command) {
  if (!command.length) throw new Error("Provide a command after --");
  const release = await acquireWorkspaceLock(resource, lane);
  try {
    const child = spawn(command[0], command.slice(1), { cwd: root, stdio: "inherit", detached: process.platform !== "win32" });
    const forward = signal => {
      try { process.kill(process.platform === "win32" ? child.pid : -child.pid, signal); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    };
    const interrupt = () => forward("SIGINT");
    const terminate = () => forward("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    try {
      process.exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve(code ?? (signal === "SIGINT" ? 130 : 143)));
      });
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    }
  } finally { await release(); }
}

async function main(args) {
  const [action, lane, ...rest] = args;
  if (action === "check") {
    const rows = checkOwnership(lane, rest);
    console.log(JSON.stringify(rows, null, 2));
    if (rows.some(row => !row.allowed)) process.exitCode = 1;
  } else if (action === "run") {
    const [resource, separator, ...command] = rest;
    if (separator !== "--") throw new Error("Usage: run LANE RESOURCE -- COMMAND [ARGS]");
    await runLocked(resource, lane, command);
  } else throw new Error("Usage: check LANE FILE... | run LANE RESOURCE -- COMMAND [ARGS]");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
