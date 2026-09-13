import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { executeLazadaInquiry } from "../lib/channels/lazada-inquiries";
import {
  lazadaImHistoryRawPages,
  normalizeLazadaImHistory,
  parseLazadaImPush,
} from "../lib/channels/lazada-im";
import { boundLazadaImCredentialId, selectLazadaImWebhookRoute } from "../lib/channels/lazada-im-webhook";
import { withLazadaProviderAccountIdentity } from "../lib/channels/provider-account-identity";

const countries = ["MY", "PH", "SG", "TH", "VN"] as const;
const sellerIds = {
  MY: "300872000183",
  PH: "501846640243",
  SG: "1754224042",
  TH: "101407248667",
  VN: "201095728264",
} as const;
const countryRows = countries.map((country, index) => ({
  country: country.toLowerCase(),
  seller_id: sellerIds[country],
  user_id: String(9_001 + index),
}));
const secret = withLazadaProviderAccountIdentity({
  app_key: "commerce-app",
  app_secret: "commerce-secret",
  access_token: "commerce-token",
  country: "my",
  im_app_key: "im-app",
  im_app_secret: "im-secret",
  im_access_token: "im-access",
  im_refresh_token: "im-refresh",
  im_account_platform: "seller_center",
  im_country_user_info: countryRows,
  im_identity_source: "lazada.oauth_token",
}, { account_platform: "seller_center", country_user_info: countryRows }).payload;
const credential = { credential_id: "fixture-credential", secret_payload: secret };

function messageStep(country?: string) {
  return {
    name: `inquiries-message:session-${country ?? "legacy"}:1`,
    data: {
      ...(country ? { sellerpilotRequestCountry: country } : {}),
      sellerpilotSession: { session_id: `session-${country ?? "legacy"}` },
      data: { message_list: [{
        message_id: `message-${country ?? "legacy"}`,
        from_account_type: 1,
        type: 1,
        template_id: 1,
        status: 0,
        send_time: 1_788_200_000_000,
        content: { txt: "fixture" },
      }] },
    },
  };
}

function push(country: typeof countries[number], sellerId: string = sellerIds[country]) {
  return {
    seller_id: sellerId,
    message_type: 2,
    data: {
      site_id: country,
      session_id: `session-${country}`,
      message_id: `message-${country}`,
      from_account_type: 1,
      type: 1,
      template_id: 1,
      status: 0,
      send_time: 1_788_200_000_000,
      content: { txt: "fixture" },
    },
  };
}

test("five-country history rows retain the request country while legacy pages stay absent", () => {
  const normalized = normalizeLazadaImHistory(countries.map((country) => messageStep(country)));
  assert.deepEqual(normalized.map((row) => row.providerContext?.country).sort(), [...countries].sort());
  const [legacy] = normalizeLazadaImHistory([messageStep()]);
  assert.equal(legacy.providerContext?.country, undefined);
  assert.equal(normalizeLazadaImHistory([messageStep("ID")])[0]?.providerContext?.country, "ID");
});

test("history transport binds the selected country into raw pages and raw reprocessing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    return path.endsWith("/im/session/list")
      ? Response.json({ code: "0", data: { has_more: false, session_list: [{ session_id: "session-SG" }] } })
      : Response.json({ code: "0", data: { ...messageStep("SG").data.data, has_more: false } });
  };
  try {
    for (const country of ["SG", "ID"] as const) {
      const result = await executeLazadaInquiry({
        operation: "inquiries.list",
        payload: { ...secret, country: country.toLowerCase() },
        arguments: { bootstrap: true, country, startTime: 1_788_200_100_000 },
      });
      const message = result.steps.find((item) => item.name.startsWith("inquiries-message:"));
      assert.equal(message?.data.sellerpilotRequestCountry, country);
      const [rawPage] = lazadaImHistoryRawPages(result.steps);
      const reprocessed = normalizeLazadaImHistory([{
        name: message!.name,
        data: JSON.parse(rawPage.rawBody) as Record<string, unknown>,
      }]);
      assert.equal(reprocessed[0]?.providerContext?.country, country);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("history country conflicts reject before a provider request", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return Response.json({}); };
  try {
    await assert.rejects(executeLazadaInquiry({
      operation: "inquiries.list",
      payload: { ...secret, country: "my" },
      arguments: { bootstrap: true, country: "SG" },
    }), /LAZADA_HISTORY_REQUEST_COUNTRY_INVALID/u);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("signed push country and seller bind through exact IM membership for all five countries", () => {
  for (const country of countries) {
    const payload = push(country);
    assert.equal(parseLazadaImPush(payload)?.providerContext?.country, country);
    assert.equal(boundLazadaImCredentialId(credential, payload), "fixture-credential");
  }
});

test("missing, contradictory, or wrong IM country lineage is rejected", () => {
  const missing = push("MY");
  delete (missing.data as Partial<typeof missing.data>).site_id;
  assert.equal(parseLazadaImPush(missing)?.providerContext?.country, undefined);
  assert.equal(boundLazadaImCredentialId(credential, missing), "");
  const missingRaw = JSON.stringify(missing);
  const missingSignature = createHmac("sha256", "im-secret").update(`im-app${missingRaw}`).digest("hex");
  assert.deepEqual(selectLazadaImWebhookRoute(missingRaw, missingSignature, {
    contract: "lazada_im_webhook_candidates_v1",
    limit: 32,
    overflow: false,
    candidates: [credential],
  }), { ok: false, status: 503 });

  const contradictory = { ...push("MY"), site: "lazada_sg" };
  assert.equal(parseLazadaImPush(contradictory), null);
  assert.equal(boundLazadaImCredentialId(credential, contradictory), "");

  assert.equal(boundLazadaImCredentialId(credential, push("SG", "999999999")), "");
  const wrongImSeller = {
    ...credential,
    secret_payload: {
      ...secret,
      im_country_user_info: countryRows.map((row) => row.country === "sg"
        ? { ...row, seller_id: "999999999" }
        : row),
    },
  };
  assert.equal(boundLazadaImCredentialId(wrongImSeller, push("SG")), "");

  const id = { ...push("MY"), data: { ...push("MY").data, site_id: "ID" } };
  assert.equal(parseLazadaImPush(id)?.providerContext?.country, "ID");
  assert.equal(boundLazadaImCredentialId(credential, id), "");
});
