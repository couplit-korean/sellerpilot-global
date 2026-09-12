import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { shortCircuit: true, url: "data:text/javascript,export default {}" };
    }
    return nextResolve(specifier, context);
  },
});

const { executeCompetitorSearchViaChannelGateway } = await import("../lib/channels/gateway");

const input = {
  credentialId: "10000000-0000-4000-8000-000000000001",
  primary: "켈로그 첵스초코 570g",
  aliases: ["Kellogg Choco Chex 570g"],
  displayPerQuery: 30,
};

test("11st competitor search enqueues to the Mac worker without a serverless static-IP gate", async () => {
  const calls: string[] = [];
  const serviceClient = {
    rpc: async (functionName: string) => {
      calls.push(functionName);
      if (functionName === "sellerpilot_enqueue_competitor_search_job") {
        return { data: "20000000-0000-4000-8000-000000000002", error: null };
      }
      if (functionName === "sellerpilot_get_channel_gateway_job") {
        return {
          data: {
            status: "succeeded",
            response: {
              ok: true,
              channel: "elevenst",
              operation: "competitor.search",
              items: [],
            },
          },
          error: null,
        };
      }
      throw new Error("unexpected RPC");
    },
  };

  assert.deepEqual(await executeCompetitorSearchViaChannelGateway({
    ...input,
    serviceClient: serviceClient as never,
  }), []);
  assert.deepEqual(calls, [
    "sellerpilot_enqueue_competitor_search_job",
    "sellerpilot_get_channel_gateway_job",
  ]);
});
