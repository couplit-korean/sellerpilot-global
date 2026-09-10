import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

// Execute only the actual section-export statement and its copy guard.
// Synthetic roles such as detail-0 are isolated-statement fixtures only:
// they do not assert approval, manifest, receipt, image-role, or DB validity.
// These tests do not invoke DB, provider, storage, or publication operations.
const source = readFileSync(
  new URL("../lib/server-external-detail-channel.ts", import.meta.url),
  "utf8",
);
const start = source.indexOf("const sections=blocks.filter(");
const end = source.indexOf("const images=manifest.images.map(", start);
assert.ok(start >= 0 && end > start, "section source boundaries changed");
const statement = source.slice(start, end);

function extract(blocks) {
  return runInNewContext(
    "(()=>{" + statement + String.fromCharCode(10) + "return sections;})()",
    { blocks },
    { timeout: 1000 },
  );
}

function fixture(body) {
  return Array.from({ length: 8 }, (_, i) => ({
    type: "ImageStoryBlock",
    props: {
      title: "",
      body,
      imageRole: "detail-" + i,
      imageAlt: "Image " + i,
    },
  }));
}

for (const [locale, body] of Object.entries({
  ko: " 승인된 본문 ",
  ja: " 承認済み本文 ",
  en: " Approved body ",
})) {
  test(locale + ": eight headless sections preserve copy and images", () => {
    const blocks = fixture(body);
    const before = structuredClone(blocks);
    const result = extract(blocks);
    assert.equal(result.length, 8);
    result.forEach((section, i) => {
      assert.equal(section.heading, "");
      assert.equal(section.body, body);
      assert.equal(section.imageAsset, blocks[i].props.imageRole);
      assert.equal(section.imageAltText, blocks[i].props.imageAlt);
    });
    assert.deepEqual(blocks, before);
  });
}

for (const body of ["", " ", String.fromCharCode(10, 9), null, undefined]) {
  test("reject blank/missing body: " + JSON.stringify(body), () => {
    const blocks = fixture("Approved");
    if (body === undefined) delete blocks[3].props.body;
    else blocks[3].props.body = body;
    assert.throws(
      () => extract(blocks),
      /EXTERNAL_DETAIL_SECTION_COPY_REQUIRED/,
    );
  });
}

test("existing titled sections remain unchanged", () => {
  const blocks = fixture(" Approved body ");
  blocks.forEach(block => { block.props.title = "Existing heading"; });
  assert.ok(extract(blocks).every(section =>
    section.heading === "Existing heading"
    && section.body === " Approved body "
  ));
});
