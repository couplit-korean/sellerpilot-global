// Compatibility entry point. Each runtime owns its process state and imports.
if (process.argv.includes("--gateway-only")) {
  if (process.argv.includes("--ai-only") || process.argv.includes("--product-only")) {
    throw new Error("--gateway-only cannot be combined with --ai-only or --product-only.");
  }
  await import("./channel-gateway-worker.mjs");
} else {
  if (process.argv.includes("--local-recovery-only")) throw new Error("--local-recovery-only requires --gateway-only.");
  await import("./product-ai-worker.mjs");
}
