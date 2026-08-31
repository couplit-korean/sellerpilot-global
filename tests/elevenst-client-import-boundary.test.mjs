import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const listingUpdateUrl = new URL("../lib/channels/listing-update.ts", import.meta.url);
const identityUrl = new URL("../lib/channels/elevenst-exact-existing-identity.ts", import.meta.url);

test("11st client candidate stays outside the server-only image dependency graph", async () => {
  const [listingUpdate, identity] = await Promise.all([
    readFile(listingUpdateUrl, "utf8"),
    readFile(identityUrl, "utf8"),
  ]);

  assert.match(
    listingUpdate,
    /from "\.\/elevenst-exact-existing-identity"/u,
  );
  assert.doesNotMatch(
    listingUpdate,
    /from "\.\/elevenst-exact-existing-publication"/u,
  );
  assert.doesNotMatch(identity, /marketplace-images|node:|sharp/u);
});
