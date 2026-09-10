export function temuResultRecords(data: Record<string, unknown>, ...keys: string[]) {
  const direct = data.result;
  if (Array.isArray(direct)) {
    return direct.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  }
  const root = direct && typeof direct === "object" && !Array.isArray(direct)
    ? direct as Record<string, unknown>
    : {};
  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
    }
  }
  return [];
}
