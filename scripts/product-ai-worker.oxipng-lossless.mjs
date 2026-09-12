import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { optimizePngWithSharp, pngContainsOptimizerFragileProvenance, verifyLosslessPngCandidate } from "../lib/image-lossless-png-optimizer.ts";
import { createConcurrencyGate } from "./worker-concurrency-gate.mjs";

export const defaultOxipngBinaryPath = join(
  homedir(),
  "Library",
  "Application Support",
  "SellerPilot",
  "tools",
  "oxipng",
  "v10.2.1",
  "oxipng",
);

const oxipngGate = createConcurrencyGate(1);
const maximumOxipngDiagnosticBytes = 4 * 1024;

function runOxipng(binaryPath, inputPath, outputPath, timeoutMs, signal) {
  if (signal?.aborted) return Promise.resolve({ ok: false, aborted: true, timedOut: false });
  const args = [
    "-o", "max",
    "--fast",
    "--zopfli",
    "--zi", "8",
    "--ziwi", "2",
    "--nx",
    "--threads", "1",
    "--timeout", String(Math.max(1, Math.ceil(timeoutMs / 1000))),
    "--max-raw-size", "80MB",
    "--quiet",
    "--out", outputPath,
    inputPath,
  ];
  return new Promise((resolve) => {
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let killTimer;
    const child = spawn(binaryPath, args, {
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
      windowsHide: true,
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    const terminate = () => {
      child.kill("SIGTERM");
      if (!killTimer) {
        killTimer = setTimeout(() => { if (!settled) child.kill("SIGKILL"); }, 500);
        killTimer.unref();
      }
    };
    const abort = () => {
      aborted = true;
      terminate();
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    timer.unref();
    signal?.addEventListener("abort", abort, { once: true });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length >= maximumOxipngDiagnosticBytes) return;
      stderr += String(chunk).slice(0, maximumOxipngDiagnosticBytes - stderr.length);
    });
    child.once("error", (error) => finish({ ok: false, timedOut, aborted, error }));
    child.once("close", (code, terminationSignal) => finish({
      ok: !timedOut && code === 0,
      timedOut,
      aborted,
      code,
      signal: terminationSignal,
      stderr: stderr.trim(),
    }));
  });
}

/**
 * Local-only PNG optimization. Sharp is the portable baseline; the optional
 * MIT-licensed OxiPNG binary is a stronger bounded pass. No alpha rewriting,
 * metadata stripping, palette conversion, or other pixel transformations are
 * enabled. Missing/slow/invalid native output fails back to the verified Sharp
 * result and therefore never blocks the Vercel path.
 */
export async function optimizePngLocally(value, {
  binaryPath = process.env.SELLERPILOT_OXIPNG_BIN?.trim() || defaultOxipngBinaryPath,
  maximumPixels = 16_000_000,
  timeoutMs = 30_000,
  signal,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new RangeError("PNG native timeout must be between 1 and 30000 ms");
  }
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("PNG 압축 작업이 취소됐습니다.");
  }
  return oxipngGate.run(async () => {
    const baseline = await optimizePngWithSharp(value, maximumPixels);
    if (signal?.aborted) {
      throw signal.reason instanceof Error ? signal.reason : new Error("PNG 압축 작업이 취소됐습니다.");
    }
    if (pngContainsOptimizerFragileProvenance(value)) {
      return { ...baseline, nativeAttempt: "protected-provenance" };
    }
    if (baseline.candidateFailures.some((reason) => reason.startsWith("unsupported-"))) {
      return { ...baseline, nativeAttempt: "unsupported-format" };
    }
    if (!binaryPath) {
      return { ...baseline, nativeAttempt: "unavailable" };
    }
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "sellerpilot-oxipng-"));
    const inputPath = join(temporaryDirectory, "input.png");
    const outputPath = join(temporaryDirectory, "output.png");
    try {
      await writeFile(inputPath, baseline.bytes, { flag: "wx", mode: 0o600 });
      const execution = await runOxipng(binaryPath, inputPath, outputPath, timeoutMs, signal);
      if (execution.aborted) {
        throw signal?.reason instanceof Error ? signal.reason : new Error("PNG 압축 작업이 취소됐습니다.");
      }
      if (!execution.ok) {
        return {
          ...baseline,
          nativeAttempt: execution.timedOut ? "timeout" : "error",
          nativeDiagnostic: execution.error instanceof Error
            ? execution.error.code || execution.error.name
            : execution.stderr || `exit-${execution.code ?? "unknown"}`,
        };
      }
      const candidateStat = await stat(outputPath);
      if (!candidateStat.isFile() || candidateStat.size >= baseline.bytes.length) {
        return { ...baseline, nativeAttempt: "not-smaller" };
      }
      const candidate = await readFile(outputPath);
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error("PNG 압축 작업이 취소됐습니다.");
      }
      if (candidate.length >= baseline.bytes.length) return { ...baseline, nativeAttempt: "not-smaller" };
      try {
        await verifyLosslessPngCandidate(value, candidate, maximumPixels);
      } catch (error) {
        return {
          ...baseline,
          nativeAttempt: "verification-failed",
          nativeDiagnostic: error instanceof Error ? error.message : "verification failed",
        };
      }
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error("PNG 압축 작업이 취소됐습니다.");
      }
      const beforeBytes = Buffer.byteLength(value);
      const savedBytes = beforeBytes - candidate.length;
      return {
        bytes: candidate,
        encoder: "oxipng-max-zopfli",
        beforeBytes,
        afterBytes: candidate.length,
        savedBytes,
        savedPercent: beforeBytes ? (savedBytes / beforeBytes) * 100 : 0,
        candidateFailures: baseline.candidateFailures,
        nativeAttempt: "accepted",
      };
    } catch (error) {
      if (signal?.aborted) throw error;
      return {
        ...baseline,
        nativeAttempt: "error",
        nativeDiagnostic: error instanceof Error ? error.code || error.name : "unknown",
      };
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }, { signal });
}
