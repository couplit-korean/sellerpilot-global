// Pure transport validation shared by the HTTP completion boundary. Provider
// cursor monotonicity and durable parent/credential ownership are still checked
// by the executing reader and database completion transaction.
export function validLazadaInquiryContinuation(next: Record<string, unknown>): boolean {
  const object = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const integer = (value: unknown, min: number, max: number) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
  const text = (value: unknown, max = 500) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
  const start = next.startTime;
  if (next.bootstrap !== true || !integer(start, 1, Number.MAX_SAFE_INTEGER)
      || !integer(next.sessionLimit ?? 100, 1, 100)
      || !integer(next.pageSize ?? 20, 1, 20)
      || !integer(next.messageLimit ?? 100, 20, 100)
      || !integer(next.sellerpilotLazadaSessionCount, 1, Number(next.sessionLimit ?? 100))) return false;
  const cursor = (time: unknown, id: unknown) => typeof time === "string" && /^[1-9][0-9]{0,15}$/.test(time)
    && Number.isSafeInteger(Number(time)) && Number(time) <= Number(start) && text(id);
  const sessionCursorPresent = next.sellerpilotLazadaSessionStartTime !== undefined || next.sellerpilotLazadaLastSessionId !== undefined;
  if (sessionCursorPresent && !cursor(next.sellerpilotLazadaSessionStartTime, next.sellerpilotLazadaLastSessionId)) return false;
  const session = object(next.sellerpilotLazadaSession);
  if (session) {
    if (!text(session.session_id) || new TextEncoder().encode(JSON.stringify(session)).length > 8_000
        || !cursor(next.sellerpilotLazadaMessageStartTime, next.sellerpilotLazadaLastMessageId)) return false;
    const nextSession = next.sellerpilotLazadaNextSessionCursor;
    if (nextSession !== undefined) {
      const pair = object(nextSession);
      if (!pair || !cursor(pair.nextStart, pair.last)) return false;
    }
    return true;
  }
  return next.sellerpilotLazadaSession === undefined && sessionCursorPresent
    && next.sellerpilotLazadaMessageStartTime === undefined
    && next.sellerpilotLazadaLastMessageId === undefined
    && next.sellerpilotLazadaNextSessionCursor === undefined;
}
