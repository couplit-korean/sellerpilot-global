import assert from "node:assert/strict";
import test from "node:test";
import { isPrivateNetworkAddress, preferLargerPublicImageUrl } from "../lib/public-image-import";

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

test("Daiso search thumbnails automatically use the larger product image", () => {
  const thumbnail = "https://cdn.daisomall.co.kr/file/resize/PD/20260807/thumb/300/product.jpg";
  assert.equal(
    preferLargerPublicImageUrl(thumbnail),
    "https://cdn.daisomall.co.kr/file/resize/PD/20260807/thumbnail/850/product.jpg",
  );
  assert.equal(
    preferLargerPublicImageUrl("https://image.oliveyoung.co.kr/products/sample.jpg"),
    "https://image.oliveyoung.co.kr/products/sample.jpg",
  );
});
