import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const listingUpdateUrl = new URL("../lib/channels/listing-update.ts", import.meta.url);
const identityUrl = new URL("../lib/channels/qoo10-exact-localization-identity.ts", import.meta.url);
const workbenchUrl = new URL("../app/product-publish-workbench.tsx", import.meta.url);

test("Qoo10 exact identity stays client-safe while provider recovery remains server-only", async () => {
  const [listingUpdate, identity, workbench] = await Promise.all([
    readFile(listingUpdateUrl, "utf8"),
    readFile(identityUrl, "utf8"),
    readFile(workbenchUrl, "utf8"),
  ]);

  assert.match(
    listingUpdate,
    /from "\.\/qoo10-exact-localization-identity"/u,
  );
  assert.doesNotMatch(
    listingUpdate,
    /from "\.\/qoo10-exact-localization-recovery"/u,
  );
  assert.match(
    workbench,
    /from "\.\.\/lib\/channels\/qoo10-exact-localization-identity"/u,
  );
  assert.doesNotMatch(
    workbench,
    /from "\.\.\/lib\/channels\/qoo10-exact-localization-recovery"/u,
  );
  assert.doesNotMatch(
    identity,
    /(?:node:|sharp|marketplace-images|listing-publication-content|qoo10-listing-create-preflight)/u,
  );
});
