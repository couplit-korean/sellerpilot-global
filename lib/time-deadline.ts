export function deadlineAfter(durationMs: number) {
  return Date.now() + durationMs;
}

export function deadlineRemaining(deadlineMs: number) {
  return deadlineMs - Date.now();
}

export function deadlineIsActive(deadlineMs: number) {
  return deadlineRemaining(deadlineMs) > 0;
}
