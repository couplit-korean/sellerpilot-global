const safeReturnOrigin = "https://sellerpilot.invalid";

export function safeRelativeReturnPath(value: string, reservedPaths: ReadonlySet<string> = new Set()) {
  const candidate = value.trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) return "/";

  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    return "/";
  }
  if (decoded.startsWith("//") || decoded.startsWith("/\\") || decoded.includes("\\")) return "/";

  let url: URL;
  try {
    url = new URL(candidate, safeReturnOrigin);
  } catch {
    return "/";
  }
  if (url.origin !== safeReturnOrigin || reservedPaths.has(url.pathname)) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
