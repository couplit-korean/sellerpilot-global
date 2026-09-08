import type { CsExecuteInput as ExecuteInput } from "../../operations/contracts";
import { executeSmartstoreInquiry } from "../../../channels/smartstore-inquiries";
import {
  fetchNaverAccessToken,
  readStoredNaverAccessToken,
  naverRequest,
  textValue,
} from "../../../channels/protocols";
export async function executeChannelInquiries(input: ExecuteInput) {
  if (input.channel !== "smartstore")
    throw new Error("CS_CHANNEL_MISMATCH:smartstore");
  const storedAccessToken = readStoredNaverAccessToken(input.payload);
  let token = storedAccessToken
    ? { accessToken: storedAccessToken }
    : await fetchNaverAccessToken(input.payload);
  const request = async (
    requestInput: Omit<Parameters<typeof naverRequest>[0], "accessToken">,
  ) => {
    let remote = await naverRequest({
      ...requestInput,
      accessToken: token.accessToken,
    });
    if (
      remote.response.status === 401 &&
      textValue(remote.data, "code") === "GW.AUTHN"
    ) {
      token = await fetchNaverAccessToken(input.payload);
      remote = await naverRequest({
        ...requestInput,
        accessToken: token.accessToken,
      });
    }
    return remote;
  };
  return executeSmartstoreInquiry(input, request);
}
