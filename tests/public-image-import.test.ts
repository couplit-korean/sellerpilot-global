import assert from "node:assert/strict";
import test from "node:test";
import { isPrivateNetworkAddress } from "../lib/public-image-import";

test("public image import rejects private and metadata network ranges", () => {
  for (const address of ["127.0.0.1", "10.0.0.2", "172.16.0.1", "192.168.1.2", "169.254.169.254", "::1", "fc00::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateNetworkAddress(address), true, address);
  }
});

test("public image import permits ordinary public addresses", () => {
  for (const address of ["1.1.1.1", "8.8.8.8", "2001:4860:4860::8888"]) {
    assert.equal(isPrivateNetworkAddress(address), false, address);
  }
});
