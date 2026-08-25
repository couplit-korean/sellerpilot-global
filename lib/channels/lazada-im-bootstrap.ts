export const lazadaImBootstrapCooldownMs = 15 * 60 * 1_000;

// Lazada documents session/message list calls as a one-time history bootstrap
// after seller authorization; ongoing conversations arrive through IM push.
// Repeated polling can cause the application permission to be reclaimed.

type LazadaImBootstrapInput = {
  requested: boolean;
  now?: Date;
  credentialChangedAt?: string | null;
  lastStartedAt?: string | null;
  lastSucceededAt?: string | null;
};

function timestamp(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function shouldBootstrapLazadaIm(input: LazadaImBootstrapInput) {
  if (!input.requested) return false;

  const credentialChangedAt = timestamp(input.credentialChangedAt);
  const lastSucceededAt = timestamp(input.lastSucceededAt);
  if (lastSucceededAt > 0 && lastSucceededAt >= credentialChangedAt) return false;

  const lastStartedAt = timestamp(input.lastStartedAt);
  const now = (input.now ?? new Date()).getTime();
  return lastStartedAt <= 0 || now - lastStartedAt >= lazadaImBootstrapCooldownMs;
}
