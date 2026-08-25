export type AdminAccessState = "checking" | "signed_out" | "admin" | "forbidden" | "error";
export type AdminVerificationState = Extract<AdminAccessState, "admin" | "forbidden" | "error">;

type RelevantAuthEvent = "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | string;

export function nextAdminAccessState(current: AdminAccessState, event: RelevantAuthEvent, sameVerifiedUser = false): AdminAccessState {
  if (event === "SIGNED_OUT") return "signed_out";
  if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
    return current === "admin" && sameVerifiedUser ? "admin" : "checking";
  }
  return current;
}

export function adminVerificationState(isAdmin: unknown, rpcError: unknown): AdminVerificationState {
  if (rpcError) return "error";
  if (isAdmin === true) return "admin";
  if (isAdmin === false) return "forbidden";
  return "error";
}
