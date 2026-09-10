/** Shared browser/server/SQL contract. UTF-8 byte ordering equals PostgreSQL COLLATE C.
 * No blob/signed URL normalization occurs here: map exact bound roles before hashing.
 */
export function externalDetailCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(externalDetailCanonical).join(",")}]`;
  if (value && typeof value === "object") {
    const encoder = new TextEncoder();
    const compare = (a: string, b: string) => {
      const left = encoder.encode(a), right = encoder.encode(b);
      for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i];
      return left.length - right.length;
    };
    return `{${Object.entries(value).sort(([a],[b])=>compare(a,b)).map(([key,item])=>`${JSON.stringify(key)}:${externalDetailCanonical(item)}`).join(",")}}`;
  }
  if (typeof value === "number" && value !== 0 && (Math.abs(value) < 0.000001 || Math.abs(value) >= 1e21)) throw Error("EXTERNAL_DETAIL_CANONICAL_NUMBER_RANGE");
  return JSON.stringify(value);
}
