import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

export function assertLocalWorkspace(root = process.cwd()) {
  const home = homedir();
  const blocked = ["Documents", "Desktop", "Library/Mobile Documents", "Library/CloudStorage"]
    .map(part => join(home, part));
  const checked = new Set();
  function check(path) {
    const actual = realpathSync(path);
    if (blocked.some(parent => actual === parent || actual.startsWith(parent + sep))) {
      throw new Error(`SELLERPILOT_CLOUD_PATH_REJECTED: ${actual}. Use ~/dev/sellerpilot-app.`);
    }
    checked.add(actual);
    return actual;
  }
  check(root);
  for (const entry of ["lib", "scripts", "prompts", "node_modules"]) {
    if (existsSync(join(root, entry))) check(join(root, entry));
  }
  if (existsSync(join(root, ".git"))) {
    for (const flag of ["--git-dir", "--git-common-dir"]) {
      const value = execFileSync("git", ["rev-parse", "--path-format=absolute", flag], {
        cwd: root, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      check(resolve(root, value));
    }
  }
  return [...checked];
}
