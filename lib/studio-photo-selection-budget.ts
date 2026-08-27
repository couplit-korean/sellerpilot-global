import {
  assertStudioSourceByteBudget,
  maximumStudioJobSourceBytes,
} from "./studio-source-photo-policy";

export type StudioPhotoBudgetEntry = Readonly<{
  key: string;
  size: number;
}>;

export type StudioPhotoBudgetReservation = Readonly<{
  id: number;
}>;

type InternalReservation = {
  id: number;
  entries: StudioPhotoBudgetEntry[];
};

function validatedEntries(entries: readonly StudioPhotoBudgetEntry[]) {
  const keys = new Set<string>();
  return entries.map((entry) => {
    if (!entry.key || keys.has(entry.key)) throw new Error("사진 선택 예약 키가 올바르지 않습니다.");
    if (!Number.isSafeInteger(entry.size) || entry.size < 1) throw new Error("사진 선택 예약 용량이 올바르지 않습니다.");
    keys.add(entry.key);
    return { key: entry.key, size: entry.size };
  });
}

export function createStudioPhotoSelectionBudget(
  maximumBytes = maximumStudioJobSourceBytes,
  maximumPhotos = 100,
) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new Error("사진 합계 제한이 올바르지 않습니다.");
  if (!Number.isSafeInteger(maximumPhotos) || maximumPhotos < 1) throw new Error("사진 개수 제한이 올바르지 않습니다.");
  let nextReservationId = 1;
  let committed = new Map<string, number>();
  const reservations = new Map<number, InternalReservation>();
  const reservationByKey = new Map<string, number>();

  const assertProjectedBudget = (
    committedEntries: ReadonlyMap<string, number>,
    pendingReservations: readonly InternalReservation[],
  ) => {
    const projected = new Map(committedEntries);
    for (const reservation of pendingReservations) {
      for (const entry of reservation.entries) projected.set(entry.key, entry.size);
    }
    if (projected.size > maximumPhotos) {
      throw new Error(`한 상품은 분석용 사진을 최대 ${maximumPhotos}장까지 등록할 수 있습니다.`);
    }
    assertStudioSourceByteBudget([...projected.values()].map((size) => ({ size })), maximumBytes);
    return [...projected.values()].reduce((total, size) => total + size, 0);
  };

  const dropReservation = (id: number) => {
    const reservation = reservations.get(id);
    if (!reservation) return;
    reservations.delete(id);
    for (const entry of reservation.entries) {
      if (reservationByKey.get(entry.key) === id) reservationByKey.delete(entry.key);
    }
  };

  const reserve = (entries: readonly StudioPhotoBudgetEntry[]): StudioPhotoBudgetReservation => {
    const nextEntries = validatedEntries(entries);
    const supersededIds = new Set(nextEntries.flatMap((entry) => {
      const id = reservationByKey.get(entry.key);
      return id === undefined ? [] : [id];
    }));
    const remaining = [...reservations.values()].filter((reservation) => !supersededIds.has(reservation.id));
    const reservation: InternalReservation = { id: nextReservationId, entries: nextEntries };
    assertProjectedBudget(committed, [...remaining, reservation]);
    for (const id of supersededIds) dropReservation(id);
    nextReservationId += 1;
    reservations.set(reservation.id, reservation);
    for (const entry of nextEntries) reservationByKey.set(entry.key, reservation.id);
    return { id: reservation.id };
  };

  const isCurrent = (reservation: StudioPhotoBudgetReservation) => reservations.has(reservation.id);

  const cancel = (reservation: StudioPhotoBudgetReservation) => {
    if (!isCurrent(reservation)) return false;
    dropReservation(reservation.id);
    return true;
  };

  const commit = (
    token: StudioPhotoBudgetReservation,
    acceptedEntries: readonly StudioPhotoBudgetEntry[],
  ) => {
    const reservation = reservations.get(token.id);
    if (!reservation) return false;
    const accepted = validatedEntries(acceptedEntries);
    const reserved = new Map(reservation.entries.map((entry) => [entry.key, entry.size]));
    if (accepted.some((entry) => reserved.get(entry.key) !== entry.size)) {
      dropReservation(token.id);
      throw new Error("사진 선택 예약과 완료 결과가 일치하지 않습니다.");
    }
    const nextCommitted = new Map(committed);
    for (const entry of accepted) nextCommitted.set(entry.key, entry.size);
    const remaining = [...reservations.values()].filter((candidate) => candidate.id !== token.id);
    try {
      assertProjectedBudget(nextCommitted, remaining);
    } catch (error) {
      dropReservation(token.id);
      throw error;
    }
    dropReservation(token.id);
    committed = nextCommitted;
    return true;
  };

  const remove = (key: string) => {
    const pendingId = reservationByKey.get(key);
    if (pendingId !== undefined) dropReservation(pendingId);
    return committed.delete(key);
  };

  const reset = () => {
    committed.clear();
    reservations.clear();
    reservationByKey.clear();
  };

  return {
    reserve,
    isCurrent,
    cancel,
    commit,
    remove,
    reset,
    hasPending: () => reservations.size > 0,
    committedBytes: () => [...committed.values()].reduce((total, size) => total + size, 0),
    projectedBytes: () => assertProjectedBudget(committed, [...reservations.values()]),
  };
}
