import {
  parseLazadaSupplementalReadResponse,
  type LazadaSupplementalReadResponse,
  type LazadaSupplementalStoredEvent,
} from "./supplemental-contract";

type AuthenticatedFetch = (input: string, init?: RequestInit) => Promise<Response>;
type LazadaSupplementalCursor = NonNullable<LazadaSupplementalReadResponse["nextCursor"]>;

export function lazadaSupplementalEventIdentity(event: LazadaSupplementalStoredEvent) {
  return [event.credentialId, event.country, event.surface, event.sourcePath,
    event.resourceKey, event.eventKey].join("\u001f");
}

export function mergeLazadaSupplementalRead(
  current: LazadaSupplementalReadResponse,
  next: LazadaSupplementalReadResponse,
) {
  const events = new Map(current.events.map((event) => [lazadaSupplementalEventIdentity(event), event]));
  for (const event of next.events) events.set(lazadaSupplementalEventIdentity(event), event);
  return { ...next, events: [...events.values()] };
}

export function lazadaSupplementalReadUrl(cursor?: LazadaSupplementalCursor | null) {
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) {
    params.set("beforeAt", cursor.occurredAt);
    params.set("beforeKey", cursor.eventKey);
    params.set("beforeCredentialId", cursor.credentialId);
    params.set("beforeCountry", cursor.country);
  }
  return `/api/admin/cs/channels/lazada/supplemental?${params}`;
}

export async function fetchLazadaSupplementalRead(
  authenticatedFetch: AuthenticatedFetch,
  cursor?: LazadaSupplementalCursor | null,
  signal?: AbortSignal,
) {
  const response = await authenticatedFetch(lazadaSupplementalReadUrl(cursor), {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`LAZADA_SUPPLEMENTAL_READ_HTTP_${response.status}`);
  return parseLazadaSupplementalReadResponse(await response.json());
}

export function createLazadaSupplementalReadLoader(authenticatedFetch: AuthenticatedFetch) {
  let generation = 0;
  let controller: AbortController | null = null;
  const cancel = () => {
    generation += 1;
    controller?.abort();
    controller = null;
  };
  return {
    cancel,
    async load(current: LazadaSupplementalReadResponse | null, more = false) {
      controller?.abort();
      const abort = new AbortController();
      controller = abort;
      const run = ++generation;
      try {
        const next = await fetchLazadaSupplementalRead(
          authenticatedFetch,
          more ? current?.nextCursor : null,
          abort.signal,
        );
        if (abort.signal.aborted || run !== generation) return { status: "stale" as const };
        return {
          status: "applied" as const,
          state: more && current ? mergeLazadaSupplementalRead(current, next) : next,
        };
      } catch (error) {
        if (abort.signal.aborted || run !== generation) return { status: "stale" as const };
        throw error;
      }
    },
  };
}
