import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const publicImageImportLimit = 20 * 1024 * 1024;

export function preferLargerPublicImageUrl(input: string) {
  const url = new URL(input);
  if (
    url.hostname.toLowerCase() === "cdn.daisomall.co.kr"
    && /^\/file\/resize\/PD\/[^/]+\/thumb\/\d+\//i.test(url.pathname)
  ) {
    url.pathname = url.pathname.replace(/\/thumb\/\d+\//i, "/thumbnail/850/");
  }
  return url.toString();
}

export function isPrivateNetworkAddress(address: string) {
  const normalized = address.toLowerCase();
  if (
    normalized === "::1"
    || normalized === "0.0.0.0"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || normalized.startsWith("fe8")
    || normalized.startsWith("fe9")
    || normalized.startsWith("fea")
    || normalized.startsWith("feb")
  ) return true;
  if (normalized.startsWith("::ffff:")) return isPrivateNetworkAddress(normalized.slice(7));
  if (isIP(normalized) !== 4) return false;
  const parts = normalized.split(".").map(Number);
  return parts[0] === 10
    || parts[0] === 127
    || parts[0] === 0
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] >= 224;
}

export async function assertPublicImageUrl(url: URL) {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("http/https 공개 이미지 링크만 지원합니다.");
  }
  const records = await lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => isPrivateNetworkAddress(record.address))) {
    throw new Error("내부 네트워크 주소의 이미지는 가져올 수 없습니다.");
  }
}

async function readLimitedBody(response: Response) {
  if (!response.body) throw new Error("이미지 응답 본문이 없습니다.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > publicImageImportLimit) {
      await reader.cancel();
      throw new Error("원본 이미지는 20MB 이하로 등록해 주세요.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function downloadPublicImage(input: string, fetcher: typeof fetch = fetch) {
  let url = new URL(preferLargerPublicImageUrl(input));
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    await assertPublicImageUrl(url);
    const response = await fetcher(url, {
      cache: "no-store",
      redirect: "manual",
      headers: { accept: "image/jpeg,image/png,image/webp", "user-agent": "SellerPilot-Image-Import/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirectCount === 5) throw new Error("이미지 리디렉션을 안전하게 확인하지 못했습니다.");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) throw new Error(`이미지를 가져오지 못했습니다. HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";")[0].toLowerCase() ?? "";
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
      throw new Error("URL이 JPG, PNG, WEBP 이미지를 가리키는지 확인해 주세요.");
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > publicImageImportLimit) throw new Error("원본 이미지는 20MB 이하로 등록해 주세요.");
    const bytes = await readLimitedBody(response);
    if (!bytes.length) throw new Error("빈 이미지 파일은 등록할 수 없습니다.");
    return { bytes, contentType, finalUrl: url.toString() };
  }
  throw new Error("이미지 리디렉션을 안전하게 확인하지 못했습니다.");
}
