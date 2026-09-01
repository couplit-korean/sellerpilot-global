const unresolvedProductFactPattern = /(?:확인\s*필요|미확인|알\s*수\s*없(?:음)?|unknown|tbd|not\s+provided|n\/?a)/i;

export function isResolvedProductFact(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 && !unresolvedProductFactPattern.test(normalized);
}
