// A channel's DB lease permits only one active job. Refill after a completed
// wave so that a busy channel does not wait for the next five-minute wakeup.
export const SERVERLESS_DRAIN_MAX_WAVES = 10;
export const SERVERLESS_DRAIN_REFILL_BUDGET_MS = 60_000;

type DrainSummary = {
  httpStatus: number;
  status: string;
  claimed: number;
  processed: number;
};

export async function collectDrainWaves<T extends DrainSummary>(
  runWave: () => Promise<T[]>,
  monotonicNow: () => number = () => performance.now(),
): Promise<T[]> {
  const startedAt = monotonicNow();
  const workers: T[] = [];
  for (let wave = 0; wave < SERVERLESS_DRAIN_MAX_WAVES; wave += 1) {
    // The final wave may still use the existing 180-second execution timeout.
    // Stop starting new work after 60 seconds, within the route's 300s limit.
    if (wave > 0 && monotonicNow() - startedAt >= SERVERLESS_DRAIN_REFILL_BUDGET_MS) break;
    const results = await runWave();
    workers.push(...results);
    if (!results.some((worker) => worker.claimed > 0)
      || results.some((worker) => worker.httpStatus >= 400
        || worker.claimed !== worker.processed
        || (worker.claimed > 0 && worker.status !== "succeeded"))) break;
  }
  return workers;
}
