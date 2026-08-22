const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

export function nextWorkerIdlePollMs(currentMs: number, minimumMs: number, maximumMs: number) {
  const minimum = Math.max(1, Math.trunc(finite(minimumMs, 1)));
  const maximum = Math.max(minimum, Math.trunc(finite(maximumMs, minimum)));
  const current = Math.min(maximum, Math.max(minimum, Math.trunc(finite(currentMs, minimum))));
  return Math.min(maximum, Math.max(minimum, Math.ceil(current * 1.6)));
}

export function jitterWorkerPollMs(baseMs: number, sample = Math.random()) {
  const base = Math.max(1, Math.trunc(finite(baseMs, 1)));
  const normalizedSample = Math.min(1, Math.max(0, finite(sample, 0.5)));
  const spread = Math.min(1_000, Math.floor(base * 0.1));
  return Math.max(1, base - spread + Math.floor((spread * 2 + 1) * normalizedSample));
}
