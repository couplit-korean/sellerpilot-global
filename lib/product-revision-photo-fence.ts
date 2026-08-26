export type RevisionPhotoSelectionToken = Readonly<{
  epoch: number;
  generation: number;
  scope: "main" | "extras" | `role:${string}`;
}>;

export function createRevisionPhotoSelectionFence() {
  let mounted = true;
  let epoch = 0;
  let mainGeneration = 0;
  let extrasGeneration = 0;
  const roleGenerations = new Map<string, number>();

  const next = (scope: RevisionPhotoSelectionToken["scope"]): RevisionPhotoSelectionToken => {
    let generation: number;
    if (scope === "main") generation = ++mainGeneration;
    else if (scope === "extras") generation = ++extrasGeneration;
    else {
      const role = scope.slice("role:".length);
      generation = (roleGenerations.get(role) ?? 0) + 1;
      roleGenerations.set(role, generation);
    }
    return { epoch, generation, scope };
  };

  const isCurrent = (token: RevisionPhotoSelectionToken) => {
    if (!mounted || token.epoch !== epoch) return false;
    if (token.scope === "main") return token.generation === mainGeneration;
    if (token.scope === "extras") return token.generation === extrasGeneration;
    return token.generation === (roleGenerations.get(token.scope.slice("role:".length)) ?? 0);
  };

  const invalidateRole = (role: string) => {
    roleGenerations.set(role, (roleGenerations.get(role) ?? 0) + 1);
  };

  return {
    mount: () => { mounted = true; epoch += 1; },
    nextMain: () => next("main"),
    nextExtras: () => next("extras"),
    nextRole: (role: string) => next(`role:${role}`),
    isCurrent,
    invalidateRole,
    invalidateExtras: () => { extrasGeneration += 1; },
    invalidateAll: () => { epoch += 1; },
    unmount: () => { mounted = false; epoch += 1; },
  };
}

export function releaseStaleRevisionPhoto(
  isCurrent: boolean,
  photoUrl: string,
  release: (url: string) => void,
) {
  if (isCurrent) return false;
  release(photoUrl);
  return true;
}
