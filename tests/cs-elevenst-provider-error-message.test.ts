import assert from "node:assert/strict";
import test from "node:test";
import { executeCsOperation } from "../lib/cs/operations/execute";

for (const tag of ["result_message", "resultMessage"]) {
  test(`11st ${tag} business error remains a failed read with its diagnostic`, async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      `<?xml version="1.0"?><ns2:productQnas xmlns:ns2="urn:test"><ns2:result_code>500</ns2:result_code><ns2:${tag}>provider diagnostic fixture</ns2:${tag}></ns2:productQnas>`,
      { status: 200, headers: { "content-type": "application/xml;charset=UTF-8" } },
    );
    try {
      const result = await executeCsOperation({ channel: "elevenst", operation: "inquiries.list", payload: { api_key: "fixture" }, environment: "production", arguments: { kind: "product_qna", startDate: "20260907", endDate: "20260913", answerStatus: "00" } });
      assert.equal(result.ok, false);
      assert.equal(result.steps[0]?.data.resultCode, "500");
      assert.equal(result.steps[0]?.data.resultMessage, "provider diagnostic fixture");
      assert.match(result.safeMessage, /provider diagnostic fixture/);
      assert.deepEqual(result.steps[0]?.data.productQnas, []);
    } finally { globalThis.fetch = original; }
  });
}

test("11st only accepts the observed exact empty-search envelope, preserving raw code 500", async () => {
  const original = globalThis.fetch;
  const message = "검색된 대상이 없습니다.";
  const envelope = (root: string, body: string) => `<${root}><result_code>500</result_code><result_message>${message}</result_message>${body}</${root}>`;
  const cases = [
    { xml: envelope("productQnas", ""), status: 200, accepted: true },
    { xml: envelope("productQnas", ""), status: 503, accepted: false },
    { xml: envelope("productQnas", "<productQna/>"), status: 200, accepted: false },
    { xml: envelope("error", ""), status: 200, accepted: false },
    { xml: envelope("productQnas", "").replace(message, "권한이 없습니다."), status: 200, accepted: false },
    { xml: envelope("productQnas", "").replace(message, ""), status: 200, accepted: false },
    { xml: envelope("productQnas", "").replace("</productQnas>", ""), status: 200, accepted: false },
  ];
  try {
    for (const value of cases) {
      globalThis.fetch = async () => new Response(value.xml, { status: value.status, headers: { "content-type": "application/xml;charset=UTF-8" } });
      const result = await executeCsOperation({ channel: "elevenst", operation: "inquiries.list", payload: { api_key: "fixture" }, environment: "production", arguments: { kind: "product_qna", startDate: "20260907", endDate: "20260913", answerStatus: "00" } });
      assert.equal(result.ok, value.accepted);
      if (value.accepted) {
        assert.equal(result.steps[0]?.data.resultCode, "500");
        assert.equal(result.steps[0]?.data.sellerpilotEmptyEvidence, "elevenst_product_qna_no_matching_records_v1");
        assert.deepEqual(result.steps[0]?.data.productQnas, []);
      }
    }
  } finally { globalThis.fetch = original; }
});
