export const lazadaImBootstrapWindowMs = 24 * 60 * 60 * 1_000;

// Lazada documents session/message list calls as a one-time history bootstrap
// after seller authorization; ongoing conversations arrive through IM push.
// A failed attempt is still consumed. Retrying requires a new credential
// version and that version must be bootstrapped within this bounded window.

type LazadaImBootstrapInput = {
  requested: boolean;
  now?: Date;
  credentialChangedAt?: string | null;
  lastAttemptedAt?: string | null;
  lastSucceededAt?: string | null;
};

function timestamp(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function shouldBootstrapLazadaIm(input: LazadaImBootstrapInput) {
  if (!input.requested) return false;

  const credentialChangedAt = timestamp(input.credentialChangedAt);
  if (credentialChangedAt <= 0) return false;

  const now = (input.now ?? new Date()).getTime();
  if (now < credentialChangedAt || now - credentialChangedAt > lazadaImBootstrapWindowMs) return false;

  const lastAttemptedAt = timestamp(input.lastAttemptedAt);
  if (lastAttemptedAt > 0 && lastAttemptedAt >= credentialChangedAt) return false;

  const lastSucceededAt = timestamp(input.lastSucceededAt);
  if (lastSucceededAt > 0 && lastSucceededAt >= credentialChangedAt) return false;
  return true;
}
