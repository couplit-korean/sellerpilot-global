export type ConversationMediaLink = {
  url: string;
  label: string;
  kind: "image" | "video" | "file" | "unknown";
  availability: "available" | "expired" | "expiry_unknown";
  expiresAt: string | null;
  retention: "provider_url_only";
  recovery: "refresh_channel_history" | "provider_url_unrecoverable";
};

function kindFrom(key: string, pathname: string): ConversationMediaLink["kind"] {
  const material = `${key} ${pathname}`.toLowerCase();
  if (/image|photo|\.jpe?g$|\.png$|\.webp$|\.gif$/.test(material)) return "image";
  if (/video|\.mp4$|\.mov$|\.webm$/.test(material)) return "video";
  if (/file|attachment|\.pdf$|\.docx?$|\.txt$/.test(material)) return "file";
  return "unknown";
}

function signedUrlExpiry(url: URL) {
  const unixValue = url.searchParams.get("expires")
    ?? url.searchParams.get("Expires")
    ?? url.searchParams.get("expiry")
    ?? url.searchParams.get("x-oss-expires");
  if (unixValue && /^\d{10,13}$/.test(unixValue)) {
    const value = Number(unixValue) * (unixValue.length === 13 ? 1 : 1_000);
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  const amazonDate = url.searchParams.get("X-Amz-Date") ?? url.searchParams.get("x-amz-date");
  const amazonSeconds = url.searchParams.get("X-Amz-Expires") ?? url.searchParams.get("x-amz-expires");
  if (amazonDate && /^\d{8}T\d{6}Z$/.test(amazonDate) && amazonSeconds && /^\d{1,7}$/.test(amazonSeconds)) {
    const base = Date.parse(`${amazonDate.slice(0,4)}-${amazonDate.slice(4,6)}-${amazonDate.slice(6,8)}T${amazonDate.slice(9,11)}:${amazonDate.slice(11,13)}:${amazonDate.slice(13,15)}Z`);
    const seconds = Number(amazonSeconds);
    if (Number.isFinite(base) && seconds >= 0 && seconds <= 604_800) return new Date(base + seconds * 1_000).toISOString();
  }
  return null;
}

export function conversationMediaLinks(
  nativeMedia: Record<string, unknown> | null,
  now: Date = new Date(),
): ConversationMediaLink[] {
  if (!nativeMedia) return [];
  const links = new Map<string, ConversationMediaLink>();
  let visited = 0;
  const visit = (value: unknown, key: string, depth: number) => {
    if (depth > 5 || visited++ > 200 || links.size >= 20) return;
    if (typeof value === "string") {
      if (value.length > 8000 || value !== value.trim()) return;
      try {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password) return;
        const expiresAt = signedUrlExpiry(url);
        const expired = Boolean(expiresAt && Date.parse(expiresAt) <= now.getTime());
        links.set(url.href, {
          url: url.href,
          label: key.replaceAll("_", " ").slice(0,120) || "첨부",
          kind: kindFrom(key,url.pathname),
          availability: expired ? "expired" : expiresAt ? "available" : "expiry_unknown",
          expiresAt,
          retention: "provider_url_only",
          recovery: expired ? "refresh_channel_history" : "provider_url_unrecoverable",
        });
      } catch { return; }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item,index)=>visit(item,`${key} ${index+1}`,depth+1));
      return;
    }
    if (value && typeof value === "object") {
      Object.entries(value as Record<string,unknown>).forEach(([childKey,item])=>visit(item,childKey,depth+1));
    }
  };
  visit(nativeMedia,"첨부",0);
  return [...links.values()];
}
