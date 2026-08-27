export function collectResearchAppliedValues<T extends object>(
  before: T,
  after: T,
  fields: readonly (keyof T)[],
  previous: Partial<T> = {},
) {
  const collected: Partial<T> = {};
  for (const key of Object.keys(previous) as Array<keyof T>) {
    if (Object.is(after[key], previous[key])) collected[key] = previous[key];
  }
  for (const key of fields) {
    if (!Object.is(before[key], after[key])) collected[key] = after[key];
  }
  return collected;
}

export function clearUnchangedResearchAppliedValues<T extends object>(
  draft: T,
  defaults: T,
  applied: Partial<T>,
) {
  const cleared = { ...draft };
  for (const key of Object.keys(applied) as Array<keyof T>) {
    if (Object.is(cleared[key], applied[key])) cleared[key] = defaults[key];
  }
  return cleared;
}
