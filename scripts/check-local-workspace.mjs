import { assertLocalWorkspace } from "./workspace-paths.mjs";

try {
  console.log(JSON.stringify({ ok: true, paths: assertLocalWorkspace() }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
