import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

const localizedListingSchema = z.object({
  channel: z.enum(["shopee", "lazada"]),
  market: z.enum(["SG", "MY", "PH", "VN", "TH", "TW", "BR", "MX", "ID"]),
  locale: z.enum(["en-SG", "ms-MY", "en-PH", "vi-VN", "th-TH", "zh-TW", "pt-BR", "es-MX", "id-ID"]),
  title: z.string().min(1).max(120),
  shortDescription: z.string().min(1).max(500),
  description: z.string().min(1).max(2_000),
  keywords: z.array(z.string().min(1).max(80)).min(3).max(10),
});

export const studioCoreSchema = z.object({
  product: z.object({
    name: z.string().min(1).max(160),
    category: z.string().min(1).max(120),
    oneLine: z.string().min(1).max(240),
    targetCustomer: z.string().min(1).max(240),
    features: z.array(z.string().min(1).max(240)).min(3).max(5),
    cautions: z.array(z.string().min(1).max(320)).min(1).max(4),
  }),
  design: z.object({
    themeName: z.string().min(1).max(100),
    palette: z.object({ primary: hex, accent: hex, surface: hex, text: hex }),
    heroCopy: z.string().min(1).max(160),
    heroSubcopy: z.string().min(1).max(240),
    cta: z.string().min(1).max(80),
    sections: z.array(z.object({
      type: z.enum(["benefit", "story", "howto", "proof", "spec", "caution"]),
      eyebrow: z.string().min(1).max(80),
      title: z.string().min(1).max(160),
      body: z.string().min(1).max(800),
      points: z.array(z.string().min(1).max(240)).min(2).max(4),
    })).min(5).max(7),
  }),
  thumbnail: z.object({
    headline: z.string().min(1).max(120),
    subline: z.string().min(1).max(120),
    badge: z.string().min(1).max(60),
  }),
  localizedListings: z.array(localizedListingSchema).length(14),
  warnings: z.array(z.string().min(1).max(400)).max(5),
});

const requiredLocalizedMarkets = {
  "shopee:SG": "en-SG",
  "shopee:MY": "ms-MY",
  "shopee:PH": "en-PH",
  "shopee:VN": "vi-VN",
  "shopee:TH": "th-TH",
  "shopee:TW": "zh-TW",
  "shopee:BR": "pt-BR",
  "shopee:MX": "es-MX",
  "lazada:MY": "ms-MY",
  "lazada:SG": "en-SG",
  "lazada:PH": "en-PH",
  "lazada:TH": "th-TH",
  "lazada:VN": "vi-VN",
  "lazada:ID": "id-ID",
} as const;

function localizedText(listing: z.infer<typeof localizedListingSchema>) {
  return [listing.title, listing.shortDescription, listing.description, ...listing.keywords].join(" ");
}

function hasExpectedScript(locale: string, value: string) {
  if (locale === "th-TH") return /\p{Script=Thai}/u.test(value);
  if (locale === "zh-TW") return /\p{Script=Han}/u.test(value);
  if (locale === "vi-VN") return /[\u0102\u0103\u00C2\u00E2\u0110\u0111\u00CA\u00EA\u00D4\u00F4\u01A0\u01A1\u01AF\u01B0\u1EA0-\u1EFF]/u.test(value);
  if (locale === "pt-BR") return /[\u00C0-\u00FF]/u.test(value);
  if (locale === "es-MX") return /[\u00E1\u00E9\u00ED\u00F3\u00FA\u00F1\u00FC\u00BF\u00A1]/iu.test(value);
  return /[A-Za-z]/u.test(value);
}

export const cliStudioResultSchema = studioCoreSchema.extend({ mode: z.literal("cli") }).superRefine((value, context) => {
  const received = new Set(value.localizedListings.map((listing) => `${listing.channel}:${listing.market}`));
  for (const required of Object.keys(requiredLocalizedMarkets)) {
    if (!received.has(required)) context.addIssue({ code: "custom", path: ["localizedListings"], message: `${required} 번역이 필요합니다.` });
  }
  if (received.size !== Object.keys(requiredLocalizedMarkets).length) context.addIssue({ code: "custom", path: ["localizedListings"], message: "채널·국가 번역은 중복될 수 없습니다." });
  value.localizedListings.forEach((listing, index) => {
    const key = `${listing.channel}:${listing.market}` as keyof typeof requiredLocalizedMarkets;
    const expectedLocale = requiredLocalizedMarkets[key];
    if (expectedLocale && listing.locale !== expectedLocale) {
      context.addIssue({ code: "custom", path: ["localizedListings", index, "locale"], message: `${key}의 locale은 ${expectedLocale}여야 합니다.` });
    }
    const combined = localizedText(listing);
    if (/\p{Script=Hangul}/u.test(combined)) {
      context.addIssue({ code: "custom", path: ["localizedListings", index], message: `${key} 현지화 문안에 한국어가 남아 있습니다.` });
    }
    if (!hasExpectedScript(expectedLocale ?? listing.locale, combined)) {
      context.addIssue({ code: "custom", path: ["localizedListings", index], message: `${key} 문안에 ${expectedLocale ?? listing.locale} 언어 문자가 확인되지 않습니다.` });
    }
  });
});

export const studioJobRequestSchema = z.object({
  jobId: z.string().uuid(),
  description: z.string().max(4_000).optional().default(""),
  productUrl: z.string().max(1_000).optional().default(""),
  imagePaths: z.array(z.string().min(1).max(400)).min(1).max(100),
});

export const workerCompletionSchema = z.discriminatedUnion("status", [
  z.object({
    jobId: z.string().uuid(),
    status: z.literal("succeeded"),
    result: cliStudioResultSchema,
    assetStoragePaths: z.record(
      z.enum(["hero", "square", "portrait", "wide"]),
      z.string().min(1).max(400),
    ),
  }),
  z.object({
    jobId: z.string().uuid(),
    status: z.literal("failed"),
    error: z.string().min(1).max(500),
  }),
]);

export type CliStudioResult = z.infer<typeof cliStudioResultSchema>;
