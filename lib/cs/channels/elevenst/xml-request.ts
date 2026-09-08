import { elevenstSellerXmlTransport, type SecretPayload, type RemoteResponse } from "../../../channels/protocols";
import { elevenstNamespacedXmlValue, elevenstXmlNodes } from "../../../channels/elevenst-xml";

export async function elevenstCsXmlRequest(input: {
  payload: SecretPayload;
  method: "GET" | "POST" | "PUT";
  path: string;
  body?: string;
}) {
  if (!input.path.startsWith("/rest/prodqnaservices/") && !input.path.startsWith("/rest/alimi/getalimilist/")) throw new Error("ELEVENST_CS_PATH_INVALID");
  const { response, xml } = await elevenstSellerXmlTransport(input);
  const resultCode = elevenstNamespacedXmlValue(xml, "resultCode")
    || elevenstNamespacedXmlValue(xml, "ResultCode")
    || elevenstNamespacedXmlValue(xml, "result_code")
    || elevenstNamespacedXmlValue(xml, "ErrorCode");
  const resultMessage = elevenstNamespacedXmlValue(xml, "resultMessage")
    || elevenstNamespacedXmlValue(xml, "ResultMessage")
    || elevenstNamespacedXmlValue(xml, "result_text")
    || elevenstNamespacedXmlValue(xml, "ErrorMessage")
    || elevenstNamespacedXmlValue(xml, "message")
    || elevenstNamespacedXmlValue(xml, "AuthMessage");
  const productNo = elevenstNamespacedXmlValue(xml, "productNo")
    || elevenstNamespacedXmlValue(xml, "prdNo");
  // Product Q&A responses contain customer identifiers and names. Keep only
  // the fields required to render the CS conversation and bind a reply. The
  // provider customer ID (memID) is deliberately excluded from gateway data.
  const productQnas = elevenstXmlNodes(xml, "productQna").slice(0, 5_000).map((node) => ({
    answerCont: elevenstNamespacedXmlValue(node, "answerCont"),
    answerDt: elevenstNamespacedXmlValue(node, "answerDt"),
    answerYn: elevenstNamespacedXmlValue(node, "answerYn"),
    brdInfoClfNo: elevenstNamespacedXmlValue(node, "brdInfoClfNo"),
    brdInfoCont: elevenstNamespacedXmlValue(node, "brdInfoCont"),
    brdInfoNo: elevenstNamespacedXmlValue(node, "brdInfoNo"),
    brdInfoSbjct: elevenstNamespacedXmlValue(node, "brdInfoSbjct"),
    buyYn: elevenstNamespacedXmlValue(node, "buyYn"),
    createDt: elevenstNamespacedXmlValue(node, "createDt"),
    dispYn: elevenstNamespacedXmlValue(node, "dispYn"),
    customerName: elevenstNamespacedXmlValue(node, "memNM"),
    prdNm: elevenstNamespacedXmlValue(node, "prdNm"),
    qnaDtlsCd: elevenstNamespacedXmlValue(node, "qnaDtlsCd"),
    qnaDtlsCdNm: elevenstNamespacedXmlValue(node, "qnaDtlsCdNm"),
    ordNoDe: elevenstNamespacedXmlValue(node, "ordNoDe"),
    ordStlEndDt: elevenstNamespacedXmlValue(node, "ordStlEndDt"),
  }));
  const isAlimiList = input.method === "GET"
    && input.path.startsWith("/rest/alimi/getalimilist/");
  const alimiNodes = isAlimiList ? elevenstXmlNodes(xml, "alimListInfo") : [];
  const alimiParseIncomplete = alimiNodes.length > 5_000;
  const alimListInfos = isAlimiList && !alimiParseIncomplete
    ? alimiNodes.map((node) => {
        const replyNodes = elevenstXmlNodes(node, "emerReplyList");
        return {
          emerNtceSeq: elevenstNamespacedXmlValue(node, "emerNtceSeq"),
          emerCtntSeq: elevenstNamespacedXmlValue(node, "emerCtntSeq"),
          emerTypeCd: elevenstNamespacedXmlValue(node, "emerTypeCd"),
          emerNtceCrntCd: elevenstNamespacedXmlValue(node, "emerNtceCrntCd"),
          emerNtceClfNo1: elevenstNamespacedXmlValue(node, "emerNtceClfNo1"),
          emerNtceSubject: elevenstNamespacedXmlValue(node, "emerNtceSubject"),
          emerCtnt: elevenstNamespacedXmlValue(node, "emerCtnt"),
          createDt: elevenstNamespacedXmlValue(node, "createDt"),
          createTm: elevenstNamespacedXmlValue(node, "createTm"),
          emerReplyDt: elevenstNamespacedXmlValue(node, "emerReplyDt"),
          ordNo: elevenstNamespacedXmlValue(node, "ordNo"),
          ordPrdSeq: elevenstNamespacedXmlValue(node, "ordPrdSeq"),
          emerReplyList: replyNodes.flatMap((replyNode) => {
            const emerReplyCtnt = elevenstNamespacedXmlValue(replyNode, "emerReplyCtnt");
            return emerReplyCtnt ? [{ emerReplyCtnt }] : [];
          }),
        };
      })
    : [];
  const replyBoardInfoNo = elevenstNamespacedXmlValue(xml, "brdInfoNo");
  const acceptedCode = isAlimiList
    ? !alimiParseIncomplete && (resultCode === "0" || (!resultCode && alimListInfos.length > 0))
    : !resultCode || ["0", "200", "210"].includes(resultCode);
  return {
    response,
    text: "",
    data: {
      accepted: response.ok && acceptedCode,
      ...(resultCode ? { resultCode: resultCode.slice(0, 80) } : {}),
      ...(resultMessage ? { resultMessage: resultMessage.slice(0, 300) } : {}),
      ...(productNo ? { productNo: productNo.slice(0, 80) } : {}),
      ...(replyBoardInfoNo ? { brdInfoNo: replyBoardInfoNo.slice(0, 80) } : {}),
      productQnas,
      ...(isAlimiList ? {
        alimListInfos,
        sellerpilotElevenstAlimiParseContract: "sellerpilot-elevenst-alimi-parser/1",
        sellerpilotElevenstAlimiObservedRows: alimiNodes.length,
        sellerpilotElevenstAlimiParseIncomplete: alimiParseIncomplete,
        ...(alimiParseIncomplete ? {
          sellerpilotElevenstAlimiParseError: "ELEVENST_ALIMI_ROW_LIMIT_EXCEEDED",
        } : {}),
      } : {}),
    },
  } satisfies RemoteResponse;
}
