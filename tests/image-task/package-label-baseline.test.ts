import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { aiGeneratedAssetSpecs } from "../../lib/ai-generated-assets";
import { renderIdentityEvidencePanel, renderIdentityEvidenceBoard } from "../../lib/product-identity-protection";
import { assertSourcePixelLabelBaseline, buildImageLabelFidelitySwiftArguments, evaluateImageLabelFidelityReport, imageLabelPixelDigest } from "../../lib/image-label-fidelity";

async function source(label: string) {
    const buffer = await sharp(Buffer.from(`<svg width="640" height="960" xmlns="http://www.w3.org/2000/svg"><rect width="640" height="960" fill="white"/><text x="40" y="210" font-size="76" fill="black">Narangd</text><text x="40" y="340" font-size="76" fill="black">CIDER</text><text x="40" y="480" font-size="64" fill="black">${label}</text></svg>`)).png().toBuffer();
    return { buffer, width: 640, height: 960, sourceDigest: imageLabelPixelDigest(buffer), retainedPixelRatio: 1 };
}

test("selected package sources render a reproducible target-scale baseline and reject changed source pixels", async () => {
    const asset = aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-package")!;
    const original = await source("500ml");
    const alternate = await source("LOT12345");
    const altered = await source("900ml");
    for (const render of [
        (selected: typeof original) => renderIdentityEvidencePanel(selected, asset, 1),
        (selected: typeof original) => renderIdentityEvidenceBoard([selected, alternate], asset, 1),
    ]) {
        const baseline = await render(original);
        const candidate = await render(original);
        const expectedDigest = imageLabelPixelDigest(baseline);
        assert.equal(assertSourcePixelLabelBaseline({ assetId: asset.id, expectedDigest, baseline, candidate }), expectedDigest);
        assert.throws(() => assertSourcePixelLabelBaseline({ assetId: asset.id, expectedDigest, baseline, candidate: altered.buffer }), /원본 픽셀/);
        const changedCandidate = await render(altered);
        assert.throws(() => assertSourcePixelLabelBaseline({ assetId: asset.id, expectedDigest, baseline, candidate: changedCandidate }), /원본 픽셀/);
    }
});

test("macOS strict OCR accepts an unchanged package panel at its actual output scale", { skip: process.platform !== "darwin" }, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "sellerpilot-package-label-test-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const asset = aiGeneratedAssetSpecs.find((asset) => asset.id === "detail-package")!;
    const selected = await source("500ml");
    const baseline = await renderIdentityEvidencePanel(selected, asset, 1);
    const baselinePath = join(dir, "trusted-rendered-baseline.png");
    const candidatePath = join(dir, "candidate.png");
    const selectedPath = join(dir, "selected-package-source.png");
    await Promise.all([writeFile(baselinePath, baseline), writeFile(candidatePath, baseline), writeFile(selectedPath, selected.buffer)]);
    assertSourcePixelLabelBaseline({ assetId: asset.id, expectedDigest: imageLabelPixelDigest(baseline), baseline, candidate: baseline });
    const result = spawnSync("/usr/bin/swift", [
        new URL("../../scripts/image-label-fidelity.swift", import.meta.url).pathname,
        ...buildImageLabelFidelitySwiftArguments({ candidatePath, requiredReferencePath: baselinePath, referencePaths: [selectedPath] }),
    ], { encoding: "utf8", timeout: 30_000, maxBuffer: 1_000_000 });
    assert.equal(result.status, 0, result.stderr);
    const report = evaluateImageLabelFidelityReport(JSON.parse(result.stdout.trim().split("\n").at(-1)!));
    assert.equal(report.passed, true, JSON.stringify(report.failureReasons));
    assert.ok(report.requiredTokens.includes("500ml"), "the actual resized quantity is still read and strictly checked");
    assert.ok(report.requiredTokens.includes("Narangd"), "brand is still mandatory at output scale");
});
