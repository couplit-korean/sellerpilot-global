import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  applyNativeImagesToArguments,
  assertMigrateImageUrl,
  buildLazadaMigrateImageRequest,
  buildLazadaUploadImageRequest,
  buildShopeeMediaSpaceUploadRequest,
  imageFormatFromBytes,
  lazadaImageLimits,
  lazadaMaxImageBytes,
  parseLazadaImageResult,
  parseShopeeMediaSpaceUploadResult,
  shopeeMaxImagesPerRequest,
  shopeeMaxProductImages,
  uploadChannelNativeImages,
  validateNativeImageBytes,
  type NativeFetch,
} from "../lib/channels/native-image-upload";

const jpegBytes = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const pngBytes = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 2)]);

const shopeePayload = { partner_id: "2031489", partner_key: "partner-secret", shop_id: "1001", access_token: "shop-token" };
const lazadaPayload = { app_key: "app-123", app_secret: "app-secret", access_token: "laz-token", country: "my" };

function remote(status: number, data: Record<string, unknown>) {
  const text = JSON.stringify(data);
  return {
    response: new Response(text, { status, headers: { "content-type": "application/json" } }),
    data,
    text,
  };
}

function json(status: number, data: Record<string, unknown>) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

type Route = { match: (url: string) => boolean; handler: (url: string, init?: RequestInit) => Response };

function routedFetch(routes: Route[], log: string[] = []): NativeFetch {
  const fn = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    log.push(url);
    const route = routes.find((candidate) => candidate.match(url));
    if (!route) return new Response("not found", { status: 404 });
    return route.handler(url, init);
  };
  return fn as NativeFetch;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function shopeeImageInfo(id: number, imageId: string, imageUrl: string) {
  return {
    id,
    error: "",
    message: "",
    image_info: { image_id: imageId, image_url_list: [{ image_url_region: "SG", image_url: imageUrl }] },
  };
}

function lazadaSignature(path: string, params: Record<string, string>, secret: string) {
  return createHmac("sha256", secret)
    .update(path + Object.keys(params).sort().map((key) => `${key}${params[key]}`).join(""))
    .digest("hex")
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

test("image format detection recognizes jpeg and png magic bytes", () => {
  assert.equal(imageFormatFromBytes(jpegBytes()), "image/jpeg");
  assert.equal(imageFormatFromBytes(pngBytes()), "image/png");
  assert.equal(imageFormatFromBytes(Buffer.from("GIF89a-not-supported")), null);
  assert.equal(imageFormatFromBytes(Buffer.alloc(0)), null);
});

test("image byte validation rejects unsupported formats and oversized files", () => {
  assert.deepEqual(validateNativeImageBytes(jpegBytes(), lazadaImageLimits), {
    format: "image/jpeg",
    size: 68,
  });
  assert.throws(() => validateNativeImageBytes(Buffer.from("RIFFxxxxWEBPfake"), lazadaImageLimits), /NATIVE_IMAGE_FORMAT_INVALID/);
  assert.throws(() => validateNativeImageBytes(Buffer.alloc(0), lazadaImageLimits), /NATIVE_IMAGE_SIZE_INVALID/);
  assert.throws(() => validateNativeImageBytes(Buffer.alloc(lazadaMaxImageBytes + 1), lazadaImageLimits), /NATIVE_IMAGE_SIZE_INVALID/);
});

// ---------------------------------------------------------------------------
// Shopee media_space/upload_image
// ---------------------------------------------------------------------------

test("Shopee media space request signs the query and serializes a multipart upload", () => {
  const nowMs = 1_786_848_245_000;
  const request = buildShopeeMediaSpaceUploadRequest({
    payload: shopeePayload,
    environment: "sandbox",
    images: [{ name: "photo.jpg", bytes: jpegBytes() }],
    scene: "normal",
    nowMs,
  });
  const url = new URL(request.url);
  assert.equal(url.hostname, "openplatform.sandbox.test-stable.shopee.sg");
  assert.equal(url.pathname, "/api/v2/media_space/upload_image");
  assert.equal(url.searchParams.get("partner_id"), "2031489");
  assert.equal(url.searchParams.get("timestamp"), "1786848245");
  assert.equal(url.searchParams.get("access_token"), "shop-token");
  assert.equal(url.searchParams.get("shop_id"), "1001");
  const expectedSign = createHmac("sha256", "partner-secret")
    .update("2031489/api/v2/media_space/upload_image1786848245shop-token1001")
    .digest("hex");
  assert.equal(url.searchParams.get("sign"), expectedSign);
  assert.equal(request.method, "POST");
  assert.match(request.headers["content-type"] ?? "", /^multipart\/form-data; boundary=/);
  const body = Buffer.from(request.body).toString("latin1");
  assert.ok(body.includes('name="image"'));
  assert.ok(body.includes('filename="photo.jpg"'));
  assert.ok(body.includes("Content-Type: image/jpeg"));
  assert.ok(body.includes('name="scene"'));
  assert.ok(body.includes("normal"));
  assert.ok(body.includes(Buffer.alloc(64, 1).toString("latin1")));
});

test("Shopee media space request validates credentials, scene, count, and image bytes", () => {
  assert.throws(
    () => buildShopeeMediaSpaceUploadRequest({
      payload: { partner_id: "2031489", partner_key: "k", shop_id: "1001" },
      environment: "sandbox",
      images: [{ name: "a.jpg", bytes: jpegBytes() }],
    }),
    /SHOPEE_CREDENTIALS_MISSING/,
  );
  assert.throws(
    () => buildShopeeMediaSpaceUploadRequest({
      payload: { ...shopeePayload, partner_id: "not-numeric" },
      environment: "sandbox",
      images: [{ name: "a.jpg", bytes: jpegBytes() }],
    }),
    /SHOPEE_CREDENTIALS_MISSING:partner_id/,
  );
  assert.throws(
    () => buildShopeeMediaSpaceUploadRequest({
      payload: shopeePayload,
      environment: "sandbox",
      images: [],
    }),
    /NATIVE_IMAGE_COUNT_INVALID/,
  );
  assert.throws(
    () => buildShopeeMediaSpaceUploadRequest({
      payload: shopeePayload,
      environment: "sandbox",
      images: Array.from({ length: shopeeMaxImagesPerRequest + 1 }, (_, index) => ({ name: `a-${index}.jpg`, bytes: jpegBytes() })),
    }),
    /NATIVE_IMAGE_COUNT_INVALID/,
  );
  assert.throws(
    () => buildShopeeMediaSpaceUploadRequest({
      payload: shopeePayload,
      environment: "sandbox",
      images: [{ name: "a.jpg", bytes: Buffer.alloc(10 * 1024 * 1024 + 1, 0xff) }],
    }),
    /NATIVE_IMAGE_SIZE_INVALID/,
  );
  assert.throws(
    () => buildShopeeMediaSpaceUploadRequest({
      payload: shopeePayload,
      environment: "sandbox",
      images: [{ name: "a.jpg", bytes: Buffer.from("RIFFxxxxWEBPfake") }],
    }),
    /NATIVE_IMAGE_FORMAT_INVALID/,
  );
  assert.throws(
    () => buildShopeeMediaSpaceUploadRequest({
      payload: shopeePayload,
      environment: "sandbox",
      images: [{ name: "a.jpg", bytes: jpegBytes() }],
      scene: "video" as "normal",
    }),
    /NATIVE_IMAGE_ARGUMENT_INVALID:scene/,
  );
});

test("Shopee media space result parses image ids and regional urls", () => {
  const outcome = parseShopeeMediaSpaceUploadResult(remote(200, {
    error: "",
    message: "",
    request_id: "req-1",
    response: {
      image_info_list: [
        shopeeImageInfo(0, "img_1", "https://cf.shopee.sg/file/1.jpg"),
        shopeeImageInfo(1, "img_2", "https://cf.shopee.sg/file/2.jpg"),
      ],
    },
  }), 2);
  assert.equal(outcome.failure, null);
  assert.equal(outcome.requestId, "req-1");
  assert.deepEqual(outcome.images.map((image) => image.imageId), ["img_1", "img_2"]);
  assert.deepEqual(outcome.images.map((image) => image.imageUrl), [
    "https://cf.shopee.sg/file/1.jpg",
    "https://cf.shopee.sg/file/2.jpg",
  ]);
  assert.equal(outcome.images.every((image) => image.ok), true);
});

test("Shopee media space result classifies per-image rejections as non-retryable validation failures", () => {
  const outcome = parseShopeeMediaSpaceUploadResult(remote(200, {
    error: "",
    message: "",
    request_id: "req-2",
    response: {
      image_info_list: [
        { id: 0, error: "error_img", message: "unsupported image format", image_info: {} },
      ],
    },
  }), 1);
  assert.equal(outcome.images[0].ok, false);
  assert.equal(outcome.failure?.kind, "validation");
  assert.equal(outcome.failure?.retryable, false);
  assert.match(outcome.failure?.message ?? "", /error_img/);
});

test("Shopee media space result classifies server and auth errors by retryability", () => {
  const networkFailure = parseShopeeMediaSpaceUploadResult(remote(200, {
    error: "error_network",
    message: "Inner http call failed",
    request_id: "req-3",
  }), 1).failure;
  assert.equal(networkFailure?.kind, "upload");
  assert.equal(networkFailure?.retryable, true);

  const httpFailure = parseShopeeMediaSpaceUploadResult(remote(500, {}), 1).failure;
  assert.equal(httpFailure?.kind, "upload");
  assert.equal(httpFailure?.retryable, true);

  const authFailure = parseShopeeMediaSpaceUploadResult(remote(200, {
    error: "error_auth",
    message: "Invalid access_token.",
    request_id: "req-4",
  }), 1).failure;
  assert.equal(authFailure?.kind, "upload");
  assert.equal(authFailure?.retryable, false);

  const clientFailure = parseShopeeMediaSpaceUploadResult(remote(403, {}), 1).failure;
  assert.equal(clientFailure?.retryable, false);

  const incomplete = parseShopeeMediaSpaceUploadResult(remote(200, { response: {} }), 2).failure;
  assert.equal(incomplete?.kind, "upload");
  assert.equal(incomplete?.retryable, true);
});

// ---------------------------------------------------------------------------
// Lazada UploadImage / MigrateImage
// ---------------------------------------------------------------------------

test("Lazada UploadImage builds a signed multipart request and validates inputs", () => {
  const nowMs = 1_786_848_245_123;
  const request = buildLazadaUploadImageRequest({
    payload: lazadaPayload,
    image: { name: "photo.png", bytes: pngBytes() },
    nowMs,
  });
  const url = new URL(request.url);
  assert.equal(url.origin + url.pathname, "https://api.lazada.com.my/rest/image/upload");
  assert.equal(request.method, "POST");
  assert.match(request.headers["content-type"] ?? "", /^multipart\/form-data; boundary=/);
  const expectedSign = lazadaSignature("/image/upload", {
    access_token: "laz-token",
    app_key: "app-123",
    sign_method: "sha256",
    timestamp: String(nowMs),
  }, "app-secret");
  const body = Buffer.from(request.body).toString("latin1");
  assert.ok(body.includes(`name="sign"`));
  assert.ok(body.includes(expectedSign));
  assert.ok(body.includes(`name="image"; filename="photo.png"`));
  assert.ok(body.includes("Content-Type: image/png"));
  assert.ok(body.includes(Buffer.alloc(64, 2).toString("latin1")));

  assert.throws(
    () => buildLazadaUploadImageRequest({
      payload: { app_key: "a", app_secret: "s", access_token: "t", country: "xx" },
      image: { name: "x.jpg", bytes: jpegBytes() },
    }),
    /LAZADA_CREDENTIALS_MISSING/,
  );
  assert.throws(
    () => buildLazadaUploadImageRequest({
      payload: lazadaPayload,
      image: { name: "big.jpg", bytes: Buffer.alloc(lazadaMaxImageBytes + 1, 0xff) },
    }),
    /NATIVE_IMAGE_SIZE_INVALID/,
  );
  assert.throws(
    () => buildLazadaUploadImageRequest({
      payload: lazadaPayload,
      image: { name: "fake.jpg", bytes: Buffer.from("not-an-image") },
    }),
    /NATIVE_IMAGE_FORMAT_INVALID/,
  );
});

test("Lazada MigrateImage signs the url parameter and applies the URL policy", () => {
  const nowMs = 1_786_848_245_123;
  const sourceUrl = "https://cdn.example.com/a.jpg?x=1";
  const request = buildLazadaMigrateImageRequest({ payload: lazadaPayload, url: sourceUrl, nowMs });
  const url = new URL(request.url);
  assert.equal(url.origin + url.pathname, "https://api.lazada.com.my/rest/image/migrate");
  assert.equal(request.method, "POST");
  assert.equal(request.headers["content-type"], "application/x-www-form-urlencoded;charset=UTF-8");
  const params = new URLSearchParams(request.body.toString());
  assert.equal(params.get("url"), sourceUrl);
  assert.equal(params.get("sign_method"), "sha256");
  const expectedSign = lazadaSignature("/image/migrate", {
    access_token: "laz-token",
    app_key: "app-123",
    sign_method: "sha256",
    timestamp: String(nowMs),
    url: sourceUrl,
  }, "app-secret");
  assert.equal(params.get("sign"), expectedSign);

  assert.equal(assertMigrateImageUrl("https://cdn.example.com/a.jpg"), "https://cdn.example.com/a.jpg");
  assert.equal(assertMigrateImageUrl("http://cdn.example.com/a.jpg"), "http://cdn.example.com/a.jpg");
  for (const invalid of [
    "http://10.0.0.8/a.jpg",
    "http://192.168.1.1/a.jpg",
    "https://169.254.1.1/a.jpg",
    "https://user:pass@cdn.example.com/a.jpg",
    "http://cdn.example.com:8080/a.jpg",
    "https://localhost/a.jpg",
    "http://x.sg94/a.jpg",
    "https://x.id35/a.jpg",
    "ftp://cdn.example.com/a.jpg",
    "not-a-url",
    "",
  ]) {
    assert.throws(() => assertMigrateImageUrl(invalid), /NATIVE_IMAGE_URL_INVALID/, invalid);
  }
});

test("Lazada image result parses code 0 into the native slatic.net url", () => {
  const outcome = parseLazadaImageResult(remote(200, {
    code: "0",
    request_id: "rid-1",
    data: { image: { url: "https://my-live-01.slatic.net/p/abc.jpg", hash_code: "hash-1" } },
  }), "https://cdn.example.com/a.jpg");
  assert.equal(outcome.failure, null);
  assert.equal(outcome.imageUrl, "https://my-live-01.slatic.net/p/abc.jpg");
  assert.equal(outcome.hashCode, "hash-1");
  assert.equal(outcome.requestId, "rid-1");
});

test("Lazada image result classifies rejections and transient failures", () => {
  const tooLarge = parseLazadaImageResult(remote(200, { code: "303", type: "ISP", message: "E303: The image is too large" }), "https://cdn.example.com/a.jpg").failure;
  assert.equal(tooLarge?.kind, "validation");
  assert.equal(tooLarge?.retryable, false);

  const notSupported = parseLazadaImageResult(remote(200, { code: "302", type: "ISP", message: "Not supported URL" }), "https://cdn.example.com/a.jpg").failure;
  assert.equal(notSupported?.kind, "validation");
  assert.equal(notSupported?.retryable, false);

  const uploadFailed = parseLazadaImageResult(remote(200, { code: "300", type: "ISP", message: "E300: Upload Image Failed" }), "https://cdn.example.com/a.jpg").failure;
  assert.equal(uploadFailed?.kind, "upload");
  assert.equal(uploadFailed?.retryable, true);

  const internalError = parseLazadaImageResult(remote(200, { code: "1000", type: "SYSTEM", message: "Internal Application Error" }), "https://cdn.example.com/a.jpg").failure;
  assert.equal(internalError?.kind, "upload");
  assert.equal(internalError?.retryable, true);

  const rateLimited = parseLazadaImageResult(remote(200, {
    code: "0",
    type: "ISP",
    message: "api access frequency exceeds the limit, ban will last 1 seconds",
  }), "https://cdn.example.com/a.jpg").failure;
  assert.equal(rateLimited?.kind, "upload");
  assert.equal(rateLimited?.retryable, true);

  const httpFailure = parseLazadaImageResult(remote(500, {}), "https://cdn.example.com/a.jpg").failure;
  assert.equal(httpFailure?.retryable, true);

  const missingUrl = parseLazadaImageResult(remote(200, { code: "0", request_id: "rid-2", data: { image: {} } }), "https://cdn.example.com/a.jpg").failure;
  assert.equal(missingUrl?.kind, "upload");
  assert.equal(missingUrl?.retryable, true);

  const authFailure = parseLazadaImageResult(remote(200, { code: "401", type: "ISP", message: "Invalid session" }), "https://cdn.example.com/a.jpg").failure;
  assert.equal(authFailure?.kind, "upload");
  assert.equal(authFailure?.retryable, false);
});

// ---------------------------------------------------------------------------
// Orchestrated uploads with injected fake fetch
// ---------------------------------------------------------------------------

test("Shopee native upload downloads, uploads, and injects image ids into the payload", async () => {
  const argumentsValue = {
    name: "Test Product",
    body: { name: "Test Product", image: {} },
    imageUrls: ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg"],
  };
  const calls: string[] = [];
  const routes: Route[] = [
    {
      match: (url) => url.startsWith("https://cdn.example.com/"),
      handler: () => new Response(Buffer.from(jpegBytes()), { status: 200, headers: { "content-type": "image/jpeg" } }),
    },
    {
      match: (url) => url.startsWith("https://openplatform.sandbox.test-stable.shopee.sg"),
      handler: () => json(200, {
        error: "",
        message: "",
        request_id: "req-1",
        response: {
          image_info_list: [
            shopeeImageInfo(0, "img_1", "https://cf.shopee.sg/file/1.jpg"),
            shopeeImageInfo(1, "img_2", "https://cf.shopee.sg/file/2.jpg"),
          ],
        },
      }),
    },
  ];
  const result = await uploadChannelNativeImages({
    channel: "shopee",
    payload: shopeePayload,
    environment: "sandbox",
    argumentsValue,
    fetchImpl: routedFetch(routes, calls),
  });

  assert.equal(result.ok, true);
  assert.equal(result.retryable, true);
  assert.deepEqual(result.imageIds, ["img_1", "img_2"]);
  assert.deepEqual(result.imageUrls, ["https://cf.shopee.sg/file/1.jpg", "https://cf.shopee.sg/file/2.jpg"]);
  const body = record(result.argumentsValue.body);
  assert.deepEqual(record(body.image).image_id_list, ["img_1", "img_2"]);
  assert.deepEqual(result.argumentsValue.imageIds, ["img_1", "img_2"]);
  assert.deepEqual(result.argumentsValue.imageUrls, ["https://cf.shopee.sg/file/1.jpg", "https://cf.shopee.sg/file/2.jpg"]);
  assert.ok(result.steps.some((item) => item.name === "image-download:1" && item.ok));
  assert.ok(result.steps.some((item) => item.name === "shopee-media-space-upload:1" && item.ok && item.requestId === "req-1"));
  assert.equal(calls.filter((url) => url.includes("media_space")).length, 1);
});

test("Shopee native upload splits nine images into two media space requests", async () => {
  const imageUrls = Array.from({ length: 9 }, (_, index) => `https://cdn.example.com/${index}.jpg`);
  const counts: number[] = [];
  const routes: Route[] = [
    {
      match: (url) => url.startsWith("https://cdn.example.com/"),
      handler: () => new Response(Buffer.from(jpegBytes()), { status: 200, headers: { "content-type": "image/jpeg" } }),
    },
    {
      match: (url) => url.startsWith("https://openplatform.sandbox.test-stable.shopee.sg"),
      handler: (_url, init) => {
        const body = Buffer.from((init?.body ?? new Uint8Array()) as Uint8Array).toString("latin1");
        const count = (body.match(/name="image"/g) ?? []).length;
        counts.push(count);
        return json(200, {
          error: "",
          message: "",
          request_id: `req-${counts.length}`,
          response: {
            image_info_list: Array.from({ length: count }, (_, index) => shopeeImageInfo(
              index,
              `img_${counts.length}_${index}`,
              `https://cf.shopee.sg/file/${counts.length}_${index}.jpg`,
            )),
          },
        });
      },
    },
  ];
  const result = await uploadChannelNativeImages({
    channel: "shopee",
    payload: shopeePayload,
    environment: "sandbox",
    argumentsValue: { imageUrls },
    fetchImpl: routedFetch(routes),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(counts, [8, 1]);
  assert.equal(result.imageIds.length, 9);
  assert.deepEqual(result.imageIds, ["img_1_0", "img_1_1", "img_1_2", "img_1_3", "img_1_4", "img_1_5", "img_1_6", "img_1_7", "img_2_0"]);
  assert.ok(result.steps.some((item) => item.name === "shopee-media-space-upload:1" && item.ok));
  assert.ok(result.steps.some((item) => item.name === "shopee-media-space-upload:2" && item.ok));
});

test("Shopee native upload classifies download and upload failures", async () => {
  const invalidFormat = await uploadChannelNativeImages({
    channel: "shopee",
    payload: shopeePayload,
    environment: "sandbox",
    argumentsValue: { imageUrls: ["https://cdn.example.com/bad.jpg"] },
    fetchImpl: routedFetch([{
      match: (url) => url.startsWith("https://cdn.example.com/"),
      handler: () => new Response("not really an image", { status: 200, headers: { "content-type": "image/jpeg" } }),
    }]),
  });
  assert.equal(invalidFormat.ok, false);
  assert.equal(invalidFormat.retryable, false);
  assert.equal(invalidFormat.failures[0].kind, "validation");

  const downloadFailure = await uploadChannelNativeImages({
    channel: "shopee",
    payload: shopeePayload,
    environment: "sandbox",
    argumentsValue: { imageUrls: ["https://cdn.example.com/gone.jpg"] },
    fetchImpl: routedFetch([{
      match: (url) => url.startsWith("https://cdn.example.com/"),
      handler: () => new Response("gone", { status: 404 }),
    }]),
  });
  assert.equal(downloadFailure.ok, false);
  assert.equal(downloadFailure.failures[0].kind, "upload");
  assert.equal(downloadFailure.failures[0].retryable, true);

  const uploadFailure = await uploadChannelNativeImages({
    channel: "shopee",
    payload: shopeePayload,
    environment: "sandbox",
    argumentsValue: { imageUrls: ["https://cdn.example.com/1.jpg"] },
    fetchImpl: routedFetch([
      {
        match: (url) => url.startsWith("https://cdn.example.com/"),
        handler: () => new Response(Buffer.from(jpegBytes()), { status: 200, headers: { "content-type": "image/jpeg" } }),
      },
      {
        match: (url) => url.startsWith("https://openplatform.sandbox.test-stable.shopee.sg"),
        handler: () => json(200, { error: "error_network", message: "Inner http call failed", request_id: "req-x" }),
      },
    ]),
  });
  assert.equal(uploadFailure.ok, false);
  assert.equal(uploadFailure.retryable, true);
  assert.equal(uploadFailure.failures[0].kind, "upload");
  assert.equal(uploadFailure.argumentsValue.imageUrls[0], "https://cdn.example.com/1.jpg");

  await assert.rejects(
    uploadChannelNativeImages({
      channel: "shopee",
      payload: shopeePayload,
      environment: "sandbox",
      argumentsValue: { imageUrls: Array.from({ length: shopeeMaxProductImages + 1 }, (_, index) => `https://cdn.example.com/${index}.jpg`) },
      fetchImpl: routedFetch([]),
    }),
    /NATIVE_IMAGE_COUNT_INVALID/,
  );
  await assert.rejects(
    uploadChannelNativeImages({
      channel: "shopee",
      payload: shopeePayload,
      environment: "sandbox",
      argumentsValue: {},
      fetchImpl: routedFetch([]),
    }),
    /NATIVE_IMAGE_REQUIRED/,
  );
});

test("Lazada native upload migrates urls and rewrites gallery, sku, and description images", async () => {
  const galleryUrl = "https://cdn.example.com/g1.jpg";
  const detailUrl = "https://cdn.example.com/d1.jpg";
  const argumentsValue = {
    imageUrls: [galleryUrl, detailUrl],
    request: {
      Request: {
        Product: {
          Attributes: { description: `<p>overview</p><img src="${detailUrl}" alt="detail 1">` },
          Images: { Image: [galleryUrl] },
          Skus: { Sku: [{ Images: { Image: [galleryUrl] } }] },
        },
      },
    },
  };
  let migrateCount = 0;
  const calls: string[] = [];
  const result = await uploadChannelNativeImages({
    channel: "lazada",
    payload: lazadaPayload,
    environment: "production",
    argumentsValue,
    fetchImpl: routedFetch([{
      match: (url) => url.includes("/image/migrate"),
      handler: () => {
        migrateCount += 1;
        return json(200, {
          code: "0",
          request_id: `rid-${migrateCount}`,
          data: { image: { url: `https://my-live-01.slatic.net/p/native-${migrateCount}.jpg`, hash_code: `hash-${migrateCount}` } },
        });
      },
    }], calls),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.imageUrls, [
    "https://my-live-01.slatic.net/p/native-1.jpg",
    "https://my-live-01.slatic.net/p/native-2.jpg",
  ]);
  const product = record(record(record(result.argumentsValue.request).Request).Product);
  assert.deepEqual(record(product.Images).Image, ["https://my-live-01.slatic.net/p/native-1.jpg"]);
  const sku = record((record(product.Skus).Sku as Array<Record<string, unknown>>)[0]);
  assert.deepEqual(record(sku.Images).Image, ["https://my-live-01.slatic.net/p/native-1.jpg"]);
  const description = String(record(product.Attributes).description);
  assert.ok(description.includes('src="https://my-live-01.slatic.net/p/native-2.jpg"'));
  assert.ok(!description.includes("cdn.example.com"));
  assert.deepEqual(result.argumentsValue.imageUrls, [
    "https://my-live-01.slatic.net/p/native-1.jpg",
    "https://my-live-01.slatic.net/p/native-2.jpg",
  ]);
  assert.equal(result.steps.filter((item) => item.name.startsWith("lazada-image-migrate:")).length, 2);
  assert.equal(result.steps.every((item) => item.ok), true);
  assert.equal(calls.filter((url) => url.includes("/image/migrate")).length, 2);
});

test("Lazada native upload falls back to UploadImage when migration is rejected", async () => {
  const sourceUrl = "https://cdn.example.com/g1.jpg";
  const routes: Route[] = [
    {
      match: (url) => url.includes("/image/migrate"),
      handler: () => json(200, { code: "303", type: "ISP", message: "E303: The image is too large" }),
    },
    {
      match: (url) => url.startsWith("https://cdn.example.com/"),
      handler: () => new Response(Buffer.from(jpegBytes()), { status: 200, headers: { "content-type": "image/jpeg" } }),
    },
    {
      match: (url) => url.includes("/image/upload"),
      handler: () => json(200, {
        code: "0",
        request_id: "rid-upload",
        data: { image: { url: "https://my-live-01.slatic.net/p/native-upload.jpg", hash_code: "hash-upload" } },
      }),
    },
  ];
  const result = await uploadChannelNativeImages({
    channel: "lazada",
    payload: lazadaPayload,
    environment: "production",
    argumentsValue: { imageUrls: [sourceUrl] },
    fetchImpl: routedFetch(routes),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.imageUrls, ["https://my-live-01.slatic.net/p/native-upload.jpg"]);
  assert.ok(result.steps.some((item) => item.name === "lazada-image-migrate:1" && !item.ok));
  assert.ok(result.steps.some((item) => item.name === "image-download:1" && item.ok));
  assert.ok(result.steps.some((item) => item.name === "lazada-image-upload:1" && item.ok && item.requestId === "rid-upload"));
});

test("Lazada native upload marks a retryable failure when both migrate and upload fail", async () => {
  const sourceUrl = "https://cdn.example.com/g1.jpg";
  const result = await uploadChannelNativeImages({
    channel: "lazada",
    payload: lazadaPayload,
    environment: "production",
    argumentsValue: { imageUrls: [sourceUrl] },
    fetchImpl: routedFetch([
      {
        match: (url) => url.includes("/image/migrate"),
        handler: () => json(200, { code: "303", type: "ISP", message: "E303: The image is too large" }),
      },
      {
        match: (url) => url.startsWith("https://cdn.example.com/"),
        handler: () => new Response(Buffer.from(jpegBytes()), { status: 200, headers: { "content-type": "image/jpeg" } }),
      },
      {
        match: (url) => url.includes("/image/upload"),
        handler: () => json(200, { code: "300", type: "ISP", message: "E300: Upload Image Failed" }),
      },
    ]),
  });

  assert.equal(result.ok, false);
  assert.equal(result.retryable, true);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].kind, "upload");
  assert.equal(result.failures[0].retryable, true);
  assert.match(result.safeMessage, /LAZADA_IMAGE_UPLOAD_FAILED:300/);
  assert.deepEqual(result.imageUrls, [""]);
  // The original arguments are preserved untouched on failure.
  assert.deepEqual(result.argumentsValue.imageUrls, [sourceUrl]);
});

test("Lazada native upload rejects invalid source urls without any network call", async () => {
  const calls: string[] = [];
  const result = await uploadChannelNativeImages({
    channel: "lazada",
    payload: lazadaPayload,
    environment: "production",
    argumentsValue: { imageUrls: ["https://10.0.0.8/private.jpg"] },
    fetchImpl: routedFetch([], calls),
  });

  assert.equal(result.ok, false);
  assert.equal(result.retryable, false);
  assert.equal(result.failures[0].kind, "validation");
  assert.equal(result.failures[0].retryable, false);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Payload application guards
// ---------------------------------------------------------------------------

test("applyNativeImagesToArguments refuses incomplete maps and missing targets", () => {
  assert.throws(
    () => applyNativeImagesToArguments({
      channel: "lazada",
      argumentsValue: { request: {}, imageUrls: ["https://cdn.example.com/a.jpg"] },
      sourceUrls: ["https://cdn.example.com/a.jpg"],
      imageUrls: ["https://my-live-01.slatic.net/p/a.jpg"],
    }),
    /NATIVE_IMAGE_APPLY_TARGET_MISSING/,
  );

  assert.throws(
    () => applyNativeImagesToArguments({
      channel: "lazada",
      argumentsValue: {
        request: {
          Request: {
            Product: {
              Attributes: { description: "" },
              Images: { Image: ["https://cdn.example.com/a.jpg"] },
              Skus: { Sku: [{ Images: { Image: ["https://cdn.example.com/unmapped.jpg"] } }] },
            },
          },
        },
      },
      sourceUrls: ["https://cdn.example.com/a.jpg"],
      imageUrls: ["https://my-live-01.slatic.net/p/a.jpg"],
    }),
    /NATIVE_IMAGE_APPLY_MAP_MISSING/,
  );

  assert.throws(
    () => applyNativeImagesToArguments({
      channel: "lazada",
      argumentsValue: {
        request: {
          Request: {
            Product: {
              Attributes: { description: '<img src="https://cdn.example.com/other.jpg">' },
              Images: { Image: ["https://cdn.example.com/a.jpg"] },
            },
          },
        },
      },
      sourceUrls: ["https://cdn.example.com/a.jpg"],
      imageUrls: ["https://my-live-01.slatic.net/p/a.jpg"],
    }),
    /NATIVE_IMAGE_APPLY_MAP_MISSING/,
  );

  assert.throws(
    () => applyNativeImagesToArguments({
      channel: "shopee",
      argumentsValue: { body: { image: {} } },
      sourceUrls: ["https://cdn.example.com/a.jpg"],
      imageUrls: ["https://cf.shopee.sg/file/1.jpg"],
      imageIds: [],
    }),
    /NATIVE_IMAGE_APPLY_MISSING_IMAGE_IDS/,
  );

  assert.throws(
    () => applyNativeImagesToArguments({
      channel: "shopee",
      argumentsValue: { body: { image: {} } },
      sourceUrls: ["https://cdn.example.com/a.jpg"],
      imageUrls: ["https://cf.shopee.sg/file/1.jpg"],
      imageIds: ["img_1", "img_2"],
    }),
    /NATIVE_IMAGE_APPLY_MISSING_IMAGE_IDS/,
  );
});

test("shopee and lazada count limits are enforced before uploads", async () => {
  await assert.rejects(
    uploadChannelNativeImages({
      channel: "lazada",
      payload: lazadaPayload,
      environment: "production",
      argumentsValue: { imageUrls: Array.from({ length: 25 }, (_, index) => `https://cdn.example.com/${index}.jpg`) },
      fetchImpl: routedFetch([]),
    }),
    /NATIVE_IMAGE_COUNT_INVALID/,
  );
});
