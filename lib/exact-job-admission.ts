export type ExactJobAdmission = "accepted" | "ambiguous" | "rejected";

export function classifyExactJobAdmission({
  status,
  ok,
  requestedJobId,
  returnedJobId,
}: {
  status: number;
  ok: boolean;
  requestedJobId: string;
  returnedJobId?: string;
}): ExactJobAdmission {
  if (status === 202 && ok && returnedJobId === requestedJobId) return "accepted";
  if (status === 408 || status === 425 || status === 429 || status >= 500 || ok) return "ambiguous";
  return "rejected";
}
