export type AdminAccessState = "checking" | "signed_out" | "admin" | "forbidden" | "error";
export type AdminVerificationState = Extract<AdminAccessState, "admin" | "forbidden" | "error">;
export type AccountSwitchCleanupState = "idle" | "clearing" | "failed";

type LocalAccountAuth = {
  signOut(options: { scope: "local" }): PromiseLike<{ error: unknown | null }>;
  getSession(): PromiseLike<{ data: { session: unknown | null }; error: unknown | null }>;
};

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

export async function clearLocalAccountSession(auth: LocalAccountAuth) {
  const { error: remoteError } = await auth.signOut({ scope: "local" });
  const { data, error: sessionError } = await auth.getSession();
  if (sessionError || data.session) throw new Error("local Supabase session was not cleared");
  return { remoteRevoked: !remoteError };
}

export async function switchAccountWithLocalSessionCleanup(
  auth: LocalAccountAuth,
  showSignedOutImmediately: () => void,
) {
  showSignedOutImmediately();
  return await clearLocalAccountSession(auth);
}
