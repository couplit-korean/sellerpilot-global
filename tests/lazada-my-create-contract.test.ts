import assert from "node:assert/strict";
import test from "node:test";
import {
  assertLazadaMyCreateMetadata,
  type LazadaMyCreateMode,
} from "../lib/product-registration/lazada/my-create-contract";
import { assertLazadaKrwMyrPricePolicy } from "../lib/channels/lazada-price-policy";

const SOURCE_IMAGES = Array.from(
  { length: 8 },
  (_, index) => `https://assets.example.test/detail-${index + 1}.jpg`,
);
const PROVIDER_IMAGES = Array.from(
  { length: 8 },
  (_, index) => `https://my-live.slatic.net/p/detail-${index + 1}.jpg`,
);

const CATEGORY_ATTRIBUTES = {
  code: "0",
  data: [
    { name: "name", input_type: "text", is_mandatory: 1, attribute_type: "normal" },
    { name: "description", input_type: "richText", is_mandatory: 1, attribute_type: "normal" },
    { name: "brand", input_type: "text", is_mandatory: 1, attribute_type: "normal" },
    { name: "color_family", input_type: "singleselect", is_mandatory: 1, attribute_type: "sku", options: [{ en_name: "White" }, { en_name: "Blue" }] },
    { name: "price", input_type: "numeric", is_mandatory: 1, attribute_type: "sku" },
    { name: "quantity", input_type: "numeric", is_mandatory: 1, attribute_type: "sku" },
  ],
};

function createArguments(
  mode: LazadaMyCreateMode,
  images = PROVIDER_IMAGES,
) {
  return {
    request: {
      Request: {
        Product: {
          PrimaryCategory: "10100205",
          Images: { Image: images },
          Attributes: {
            name: "Biskut susu 315g, 6 pek",
            description: `<section>${images.map((url) => `<img src="${url}">`).join("")}</section>`,
            brand: "No Brand",
          },
          Skus: {
            Sku: ["WHITE", "BLUE"].map((suffix, index) => ({
              SellerSku: `MILK-315G-${suffix}`,
              quantity: String(index + 1),
              ...(mode === "standard" ? { price: "19.90" } : { supply_price: "19.900" }),
              package_content: "6 packs",
              package_weight: mode === "standard" ? "0.32" : "0.315",
              package_length: "30",
              package_width: "20",
              package_height: "10",
              saleProp: { color_family: index ? "Blue" : "White" },
              Images: { Image: images.slice(0, 2) },
            })),
          },
        },
      },
    },
  };
}

for (const mode of ["standard", "marketplace_ease"] as const) {
  test(`Lazada MY ${mode} create validates official metadata for every SKU`, () => {
    const verified = assertLazadaMyCreateMetadata({
      argumentsValue: createArguments(mode),
      categoryAttributes: CATEGORY_ATTRIBUTES,
      mode,
    });
    assert.equal(verified.mode, mode);
    assert.equal(verified.skuCount, 2);
    assert.equal(verified.productImageCount, 8);
    assert.deepEqual(verified.mandatoryNormalAttributes, ["name", "description", "brand"]);
    assert.deepEqual(verified.mandatorySkuAttributes, ["color_family", "price", "quantity"]);
  });
}

test("Lazada MY create uses metadata name, not seller-center display label", () => {
  const invalid = structuredClone(CATEGORY_ATTRIBUTES);
  invalid.data.push({
    name: "material_code",
    label: "Material",
    input_type: "singleselect",
    is_mandatory: 1,
    attribute_type: "normal",
    options: [{ en_name: "Paper" }],
  });
  const argumentsValue = createArguments("standard");
  const attributes = argumentsValue.request.Request.Product.Attributes as Record<string, unknown>;
  attributes.Material = "Paper";
  assert.throws(() => assertLazadaMyCreateMetadata({
    argumentsValue,
    categoryAttributes: invalid,
    mode: "standard",
  }), /LAZADA_REQUIRED_ATTRIBUTE_MISSING:material_code/u);
});

test("Lazada MY create accepts official brand_id instead of the deprecated brand name", () => {
  const argumentsValue = createArguments("standard");
  const attributes = argumentsValue.request.Request.Product.Attributes as Record<string, unknown>;
  delete attributes.brand;
  attributes.brand_id = "30768";
  assert.doesNotThrow(() => assertLazadaMyCreateMetadata({
    argumentsValue,
    categoryAttributes: CATEGORY_ATTRIBUTES,
    mode: "standard",
  }));
});

test("Lazada MY create blocks missing and invalid attributes on later SKUs", () => {
  for (const value of [undefined, "Red"]) {
    const argumentsValue = createArguments("standard");
    const sku = argumentsValue.request.Request.Product.Skus.Sku[1] as Record<string, unknown>;
    const saleProp = sku.saleProp as Record<string, unknown>;
    if (value === undefined) delete saleProp.color_family;
    else saleProp.color_family = value;
    assert.throws(() => assertLazadaMyCreateMetadata({
      argumentsValue,
      categoryAttributes: CATEGORY_ATTRIBUTES,
      mode: "standard",
    }), value === undefined
      ? /LAZADA_REQUIRED_SKU_ATTRIBUTE_MISSING:color_family:1/u
      : /LAZADA_ATTRIBUTE_ENUM_VALUE_INVALID:color_family/u);
  }
});

test("Lazada MY seller modes never mix price and supply_price", () => {
  const standard = createArguments("standard");
  Object.assign(standard.request.Request.Product.Skus.Sku[0], { supply_price: "19.900" });
  assert.throws(() => assertLazadaMyCreateMetadata({
    argumentsValue: standard,
    categoryAttributes: CATEGORY_ATTRIBUTES,
    mode: "standard",
  }), /LAZADA_MY_CREATE_SUPPLY_PRICE_FORBIDDEN:0/u);

  const ease = createArguments("marketplace_ease");
  Object.assign(ease.request.Request.Product.Skus.Sku[0], { price: "19.90" });
  assert.throws(() => assertLazadaMyCreateMetadata({
    argumentsValue: ease,
    categoryAttributes: CATEGORY_ATTRIBUTES,
    mode: "marketplace_ease",
  }), /LAZADA_MY_CREATE_MARKETPLACE_EASE_PRICE_FORBIDDEN:0/u);
});

test("Lazada MY price evidence binds every standard or Marketplace Ease SKU", () => {
  const rate = {
    krwPerMyr: 250,
    fetchedAt: "2026-09-09T00:00:00.000Z",
    asOf: "2026-09-09T00:00:00.000Z",
    source: "fixture reference",
    sourceUrl: "https://example.test/rates",
    frequency: "minute-market" as const,
  };
  for (const mode of ["standard", "marketplace_ease"] as const) {
    const argumentsValue = createArguments(mode);
    Object.assign(argumentsValue, {
      sellerpilotLazadaPricePolicy: {
        contract: "lazada_krw_myr_reference_price_v1",
        sourceCurrency: "KRW",
        sourcePriceKrw: 4_975,
        targetCurrency: "MYR",
        targetPriceMyr: 19.9,
        rate,
      },
    });
    assert.doesNotThrow(() => assertLazadaKrwMyrPricePolicy({
      argumentsValue,
      authoritativeRate: rate,
      priceField: mode === "standard" ? "price" : "supply_price",
      now: new Date("2026-09-09T00:01:00.000Z"),
    }));
    const secondSku = argumentsValue.request.Request.Product.Skus.Sku[1] as Record<string, unknown>;
    secondSku[mode === "standard" ? "price" : "supply_price"] = "20.00";
    assert.throws(() => assertLazadaKrwMyrPricePolicy({
      argumentsValue,
      authoritativeRate: rate,
      priceField: mode === "standard" ? "price" : "supply_price",
      now: new Date("2026-09-09T00:01:00.000Z"),
    }), /LAZADA_KRW_MYR_TARGET_PRICE_MISMATCH/u);
  }
});

test("Lazada MY source images may be HTTPS but provider-bound images must be Lazada inlinks", () => {
  assert.doesNotThrow(() => assertLazadaMyCreateMetadata({
    argumentsValue: createArguments("standard", SOURCE_IMAGES),
    categoryAttributes: CATEGORY_ATTRIBUTES,
    mode: "standard",
    imageStage: "source",
  }));
  assert.throws(() => assertLazadaMyCreateMetadata({
    argumentsValue: createArguments("standard", SOURCE_IMAGES),
    categoryAttributes: CATEGORY_ATTRIBUTES,
    mode: "standard",
    imageStage: "provider",
  }), /LAZADA_MY_CREATE_IMAGE_URL_INVALID/u);
});

test("Lazada MY create rejects image overflow, duplicates and malformed description img src", () => {
  const duplicate = createArguments("standard", [PROVIDER_IMAGES[0], PROVIDER_IMAGES[0]]);
  assert.throws(() => assertLazadaMyCreateMetadata({
    argumentsValue: duplicate,
    categoryAttributes: CATEGORY_ATTRIBUTES,
    mode: "standard",
  }), /LAZADA_MY_CREATE_IMAGES_CARDINALITY_INVALID/u);

  const malformed = createArguments("standard");
  malformed.request.Request.Product.Attributes.description = "<section><img alt='missing'></section>";
  assert.throws(() => assertLazadaMyCreateMetadata({
    argumentsValue: malformed,
    categoryAttributes: CATEGORY_ATTRIBUTES,
    mode: "standard",
  }), /LAZADA_MY_CREATE_DESCRIPTION_IMAGE_SRC_INVALID/u);
});

test("Lazada MY create rejects malformed category metadata", () => {
  assert.throws(() => assertLazadaMyCreateMetadata({
    argumentsValue: createArguments("standard"),
    categoryAttributes: [{ label: "Name", input_type: "text", is_mandatory: 1, attribute_type: "normal" }],
    mode: "standard",
  }), /LAZADA_CATEGORY_ATTRIBUTE_SCHEMA_INVALID/u);
});

test("Lazada MY create never filters malformed metadata, options, values or images", () => {
  const malformedMetadata = structuredClone(CATEGORY_ATTRIBUTES);
  malformedMetadata.data.push(null as unknown as (typeof malformedMetadata.data)[number]);
  assert.throws(() => assertLazadaMyCreateMetadata({
    argumentsValue: createArguments("standard"),
    categoryAttributes: malformedMetadata,
    mode: "standard",
  }), /LAZADA_CATEGORY_ATTRIBUTE_SCHEMA_INVALID/u);

  const malformedOptions = structuredClone(CATEGORY_ATTRIBUTES);
  malformedOptions.data[3].options?.push(null as unknown as { en_name: string });
  assert.throws(() => assertLazadaMyCreateMetadata({
    argumentsValue: createArguments("standard"),
    categoryAttributes: malformedOptions,
    mode: "standard",
  }), /LAZADA_CATEGORY_ATTRIBUTE_SCHEMA_INVALID/u);

  const malformedValue = createArguments("standard");
  malformedValue.request.Request.Product.Skus.Sku[0].saleProp.color_family = ["White", null] as unknown as string;
  assert.throws(() => assertLazadaMyCreateMetadata({
    argumentsValue: malformedValue,
    categoryAttributes: CATEGORY_ATTRIBUTES,
    mode: "standard",
  }), /LAZADA_ATTRIBUTE_VALUE_INVALID:color_family/u);

  const malformedImages = createArguments("standard");
  malformedImages.request.Request.Product.Images.Image = [PROVIDER_IMAGES[0], null] as unknown as string[];
  assert.throws(() => assertLazadaMyCreateMetadata({
    argumentsValue: malformedImages,
    categoryAttributes: CATEGORY_ATTRIBUTES,
    mode: "standard",
  }), /LAZADA_MY_CREATE_IMAGE_URL_INVALID/u);
});

test("Lazada MY date attributes require a real YYYY-MM-DD calendar date", () => {
  const attributes = structuredClone(CATEGORY_ATTRIBUTES);
  attributes.data.push({
    name: "warranty_start",
    input_type: "date",
    is_mandatory: 1,
    attribute_type: "normal",
  });
  const argumentsValue = createArguments("standard");
  Object.assign(argumentsValue.request.Request.Product.Attributes, {
    warranty_start: "2026-02-28",
  });
  assert.doesNotThrow(() => assertLazadaMyCreateMetadata({
    argumentsValue,
    categoryAttributes: attributes,
    mode: "standard",
  }));
  argumentsValue.request.Request.Product.Attributes.warranty_start = "2026-02-30";
  assert.throws(() => assertLazadaMyCreateMetadata({
    argumentsValue,
    categoryAttributes: attributes,
    mode: "standard",
  }), /LAZADA_ATTRIBUTE_DATE_VALUE_INVALID:warranty_start/u);
});

test("Lazada MY image attributes expose source URLs for migration and require inlinks at provider stage", () => {
  const attributes = structuredClone(CATEGORY_ATTRIBUTES);
  attributes.data.push({
    name: "size_chart_image",
    input_type: "img",
    is_mandatory: 1,
    attribute_type: "normal",
  });
  const argumentsValue = createArguments("standard", PROVIDER_IMAGES);
  Object.assign(argumentsValue.request.Request.Product.Attributes, {
    size_chart_image: "https://assets.example.test/size-chart.jpg",
  });
  const source = assertLazadaMyCreateMetadata({
    argumentsValue,
    categoryAttributes: attributes,
    mode: "standard",
    imageStage: "source",
  });
  assert.deepEqual(source.attributeImageUrls, ["https://assets.example.test/size-chart.jpg"]);
  assert.throws(() => assertLazadaMyCreateMetadata({
    argumentsValue,
    categoryAttributes: attributes,
    mode: "standard",
    imageStage: "provider",
  }), /LAZADA_ATTRIBUTE_IMAGE_VALUE_INVALID:size_chart_image/u);
  const providerArguments = createArguments("standard");
  Object.assign(providerArguments.request.Request.Product.Attributes, {
    size_chart_image: "https://my-live.slatic.net/p/size-chart.jpg",
  });
  assert.deepEqual(assertLazadaMyCreateMetadata({
    argumentsValue: providerArguments,
    categoryAttributes: attributes,
    mode: "standard",
  }).attributeImageUrls, ["https://my-live.slatic.net/p/size-chart.jpg"]);
});
