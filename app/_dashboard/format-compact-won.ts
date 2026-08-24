export function formatCompactWon(value: number) {
  return `₩${Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(value)}`;
}
