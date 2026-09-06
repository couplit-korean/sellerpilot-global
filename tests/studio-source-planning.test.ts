import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { aiGeneratedAssetSpecs } from "../lib/ai-generated-assets";
import { analyzeServerStudioSources, createStudioSourceCutoutResolver, loadStudioSources, type ServerStudioSource } from "../lib/server-product-studio";
import { planStudioSourceAssignments, studioSourceCoverage, studioSourceFacts, type StudioSourceObservation } from "../lib/studio-source-planning";

function observation(role: StudioSourceObservation["role"], wholeProduct = true): StudioSourceObservation {
  return { role, confidence: 0.99, sameProduct: "yes", wholeProduct, readableText: "", facts: [], warnings: [] };
}
function source(role: string, resolved: StudioSourceObservation["role"], whole = true): ServerStudioSource {
  return { path: role, role, name: role, mediaType: "image/png", bytes: new Uint8Array(), observation: observation(resolved, whole) };
}
const photos = () => [source("main", "front"), source("extra-1", "left"), source("extra-2", "label", false), source("extra-3", "back")];

test("four uploaded photos including numbered extras are covered by the eight displayed detail slots", () => {
  const sources = photos();
  const plan = planStudioSourceAssignments(sources);
  assert.equal(plan.get("hero")?.path, "main");
  assert.equal(plan.get("detail-feature")?.path, "extra-2");
  for (const entry of studioSourceCoverage(sources, plan)) assert.ok(entry.detailAssets.length > 0, entry.inputRole);
  const sceneSources = new Set(aiGeneratedAssetSpecs.filter(asset => asset.identityPolicy.mode === "source-composite").map(asset => plan.get(asset.id)?.path));
  assert.ok(sceneSources.has("extra-1"));
  assert.ok(sceneSources.has("extra-3"));
  assert.ok(!sceneSources.has("extra-2"), "an ingredients panel must never become a staged product");
});

test("uncertain or unrelated extras are not guessed into label or package slots", () => {
  const sources = photos();
  sources[1].observation!.confidence = 0.4;
  sources[2].observation!.sameProduct = "uncertain";
  const plan = planStudioSourceAssignments(sources);
  assert.ok(![...plan.values()].some(value => value === sources[1] || value === sources[2]));
});

test("actual contents get the contents slot while a label remains an evidence panel", () => {
  const sources = [...photos(), source("extra-4", "contents", false)];
  assert.equal(planStudioSourceAssignments(sources).get("detail-contents")?.path, "extra-4");
});

test("only high-confidence facts backed by an exact OCR quote enter copy planning", () => {
  const label = source("extra-2", "label", false);
  label.observation!.readableText = "사과초모식초 5% / 210 g 전체 350 kcal";
  label.observation!.facts = [
    { kind: "ingredients", value: "사과초모식초 5%", quote: "사과초모식초 5%", confidence: 0.99 },
    { kind: "nutrition", value: "1포당 350 kcal", quote: "1포당 350 kcal", confidence: 0.99 },
    { kind: "allergens", value: "우유", quote: "사과초모식초", confidence: 0.4 },
  ];
  assert.deepEqual(studioSourceFacts(label).map(fact => fact.value), ["사과초모식초 5%"]);
});

test("vision inspects every photo against the same main anchor with bounded concurrency", async () => {
  const inputs = photos().map(photo => ({ ...photo, observation: undefined }));
  let active = 0; let peak = 0; const seen: string[] = [];
  const result = await analyzeServerStudioSources(inputs, { generateStructured: async input => {
    active++; peak = Math.max(peak, active);
    assert.equal(input.images.at(-1)?.role, "main");
    assert.match(input.prompt, /Analyze ONLY IMAGE 1/);
    const photo = input.images[0];
    if (photo.role === "main") assert.match(input.prompt, /target is the identity anchor itself/);
    else assert.match(input.prompt, /Do not copy IMAGE 2 text/);
    seen.push(photo.path);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    const index = inputs.indexOf(photo);
    return input.schema.parse(photos()[index].observation);
  } }, AbortSignal.timeout(5000));
  assert.equal(peak, 3);
  assert.deepEqual(seen, inputs.map(photo => photo.path));
  assert.ok(studioSourceCoverage(result, planStudioSourceAssignments(result)).every(item => item.detailAssets.length > 0));
});

test("a confident different-product photo blocks the set instead of mixing identities", async () => {
  await assert.rejects(analyzeServerStudioSources(photos(), { generateStructured: async input => input.schema.parse({
    ...observation("left"), sameProduct: "no",
  }) }, AbortSignal.timeout(5000)), /source_product_identity_mismatch/);
});

test("cutout cache segments each selected physical source once and never segments a label", async () => {
  const sources = photos();
  const bytes = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: "red" } }).png().toBuffer();
  const calls: string[] = [];
  const resolve = createStudioSourceCutoutResolver({ segmentSource: async photo => {
    calls.push(photo.path);
    return { segmentationSource: bytes, segmentation: {
      containsSingleProduct: true, touchesFrame: false, foregroundConfidence: 0.99, edgeConfidence: 0.99,
      polygons: [{ points: Array.from({ length: 12 }, (_, index) => ({ x: 0.5 + Math.cos(index / 12 * 2 * Math.PI) * 0.3, y: 0.5 + Math.sin(index / 12 * 2 * Math.PI) * 0.3 })) }],
    } };
  } }, AbortSignal.timeout(5000));
  const [a,b] = await Promise.all([resolve(sources[1]), resolve(sources[1])]);
  assert.equal(a, b);
  await resolve(sources[3]);
  assert.deepEqual(calls, ["extra-1", "extra-3"]);
  assert.throws(() => resolve(sources[2]), /source_view_not_compositable/);
});

test("source loader keeps multiple label photos and input order without silently dropping the second panel", async () => {
  const bytes = await sharp({ create: { width: 600, height: 600, channels: 3, background: "white" } }).png().toBuffer();
  const request = { image_paths: ["a", "b", "c"], image_specs: ["main", "label", "label"].map(role => ({
    role, originalWidth: 600, originalHeight: 600, originalName: role, originalMediaType: "image/png", originalBytes: bytes.length,
  })) };
  const loaded = await loadStudioSources(request as Parameters<typeof loadStudioSources>[0], async () => bytes, AbortSignal.timeout(5000));
  assert.deepEqual(loaded.map(photo => photo.path), ["a", "b", "c"]);
  await assert.rejects(loadStudioSources({ image_paths: Array(11).fill("a"), image_specs: Array(11).fill(request.image_specs[0]) } as Parameters<typeof loadStudioSources>[0], async () => bytes, AbortSignal.timeout(5000)), /source_photo_analysis_limit/);
});
