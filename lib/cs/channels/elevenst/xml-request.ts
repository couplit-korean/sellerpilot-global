import { elevenstSellerXmlTransport, type SecretPayload, type RemoteResponse } from "../../../channels/protocols";
import { elevenstNamespacedXmlValue, elevenstXmlNodes } from "../../../channels/elevenst-xml";

function xmlTagEnd(xml: string, start: number) {
  let quote = "";
  for (let index = start + 1; index < xml.length; index += 1) {
    const character = xml[index] ?? "";
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === "\"" || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    } else if (character === "<") {
      return -1;
    }
  }
  return -1;
}

function escapedXmlText(value: string) {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

function hasEmbeddedProductQnaMarkup(value: string) {
  return /<\/?(?:[\w.-]+:)?productQna(?:\s|\/?>)/iu.test(value);
}

function validatedXmlDocument(xml: string, expectedRoot: string) {
  const document = xml.replace(/^\uFEFF/u, "").trim();
  const stack: string[] = [];
  let cursor = 0;
  let rootSeen = false;
  let safeXml = "";
  while (cursor < document.length) {
    if (document.startsWith("<!--", cursor)) {
      const end = document.indexOf("-->", cursor + 4);
      if (end < 0) return null;
      const comment = document.slice(cursor + 4, end);
      if (comment.includes("--") || hasEmbeddedProductQnaMarkup(comment)) return null;
      cursor = end + 3;
      continue;
    }
    if (document.startsWith("<![CDATA[", cursor)) {
      const end = document.indexOf("]]>", cursor + 9);
      if (end < 0) return null;
      const cdata = document.slice(cursor + 9, end);
      if (stack.length === 0 && cdata.trim()) return null;
      if (hasEmbeddedProductQnaMarkup(cdata)) return null;
      safeXml += escapedXmlText(cdata);
      cursor = end + 3;
      continue;
    }
    if (document.startsWith("<?", cursor)) {
      const end = document.indexOf("?>", cursor + 2);
      if (end < 0) return null;
      const instruction = document.slice(cursor + 2, end).trim();
      if (/^xml(?:\s|$)/iu.test(instruction) && (rootSeen || safeXml.trim())) return null;
      cursor = end + 2;
      continue;
    }
    if (document[cursor] !== "<") {
      const next = document.indexOf("<", cursor);
      const end = next < 0 ? document.length : next;
      const text = document.slice(cursor, end);
      if (stack.length === 0 && text.trim()) return null;
      safeXml += text;
      cursor = end;
      continue;
    }
    if (document.startsWith("<!", cursor)) return null;
    const end = xmlTagEnd(document, cursor);
    if (end < 0) return null;
    const tag = document.slice(cursor + 1, end).trim();
    const closing = tag.match(/^\/\s*([A-Za-z_][\w.:-]*)\s*$/u);
    if (closing) {
      const name = closing[1] ?? "";
      if (stack.pop() !== name) return null;
    } else {
      const selfClosing = /\/\s*$/u.test(tag);
      const opening = tag.match(/^([A-Za-z_][\w.:-]*)(?:\s[\s\S]*?)?\/?\s*$/u);
      if (!opening) return null;
      const name = opening[1] ?? "";
      if (stack.length === 0) {
        if (rootSeen || name.split(":").at(-1)?.toLowerCase() !== expectedRoot.toLowerCase()) {
          return null;
        }
        rootSeen = true;
      }
      if (!selfClosing) stack.push(name);
    }
    safeXml += document.slice(cursor, end + 1);
    cursor = end + 1;
  }
  return rootSeen && stack.length === 0 ? safeXml : null;
}

export async function elevenstCsXmlRequest(input: {
  payload: SecretPayload;
  method: "GET" | "POST" | "PUT";
  path: string;
  body?: string;
}) {
  if (!input.path.startsWith("/rest/prodqnaservices/") && !input.path.startsWith("/rest/alimi/getalimilist/")) throw new Error("ELEVENST_CS_PATH_INVALID");
  const { response, xml } = await elevenstSellerXmlTransport(input);
  const isProductQnaList = input.method === "GET"
    && input.path.startsWith("/rest/prodqnaservices/prodqnalist/");
  const validatedProductQnaXml = isProductQnaList
    ? validatedXmlDocument(xml, "productQnas")
    : xml;
  const productQnaDocumentReady = validatedProductQnaXml !== null;
  const parsedXml = validatedProductQnaXml ?? "";
  const resultCode = elevenstNamespacedXmlValue(parsedXml, "resultCode")
    || elevenstNamespacedXmlValue(parsedXml, "ResultCode")
    || elevenstNamespacedXmlValue(parsedXml, "result_code")
    || elevenstNamespacedXmlValue(parsedXml, "ErrorCode");
  const resultMessage = elevenstNamespacedXmlValue(parsedXml, "resultMessage")
    || elevenstNamespacedXmlValue(parsedXml, "ResultMessage")
    || elevenstNamespacedXmlValue(parsedXml, "result_text")
    || elevenstNamespacedXmlValue(parsedXml, "ErrorMessage")
    || elevenstNamespacedXmlValue(parsedXml, "message")
    || elevenstNamespacedXmlValue(parsedXml, "AuthMessage");
  const productNo = elevenstNamespacedXmlValue(parsedXml, "productNo")
    || elevenstNamespacedXmlValue(parsedXml, "prdNo");
  // Product Q&A responses contain customer identifiers and names. Keep only
  // the fields required to render the CS conversation and bind a reply. The
  // provider customer ID (memID) is deliberately excluded from gateway data.
  const productQnaNodes = productQnaDocumentReady
    ? elevenstXmlNodes(parsedXml, "productQna")
    : [];
  const productQnaObservedRows = productQnaNodes.length;
  const productQnaParserLimitExceeded = productQnaObservedRows > 5_000;
  const productQnaBatchLimitExceeded = productQnaObservedRows > 500;
  const productQnaParseIncomplete = productQnaParserLimitExceeded || productQnaBatchLimitExceeded;
  const productQnas = (productQnaParseIncomplete ? [] : productQnaNodes).map((node) => ({
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
  const alimiNodes = isAlimiList ? elevenstXmlNodes(parsedXml, "alimListInfo") : [];
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
  const replyBoardInfoNo = elevenstNamespacedXmlValue(parsedXml, "brdInfoNo");
  const acceptedCode = isAlimiList
    ? !alimiParseIncomplete && (resultCode === "0" || (!resultCode && alimListInfos.length > 0))
    : (!isProductQnaList || (productQnaDocumentReady && !productQnaParseIncomplete))
      && (!resultCode || ["0", "200", "210"].includes(resultCode));
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
      ...(isProductQnaList ? {
        sellerpilotElevenstProductQnaParseContract: "sellerpilot-elevenst-product-qna-parser/1",
        sellerpilotElevenstProductQnaDocumentReady: productQnaDocumentReady,
        sellerpilotElevenstProductQnaObservedRows: productQnaObservedRows,
        sellerpilotElevenstProductQnaParseIncomplete: productQnaParseIncomplete,
        ...(!productQnaDocumentReady ? {
          sellerpilotElevenstProductQnaParseError: "ELEVENST_PRODUCT_QNA_DOCUMENT_INVALID",
        } : productQnaParserLimitExceeded ? {
          sellerpilotElevenstProductQnaParseError: "ELEVENST_PRODUCT_QNA_PARSER_ROW_LIMIT_EXCEEDED",
        } : productQnaBatchLimitExceeded ? {
          sellerpilotElevenstProductQnaParseError: "ELEVENST_PRODUCT_QNA_DB_BATCH_LIMIT_EXCEEDED",
        } : {}),
      } : {}),
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
