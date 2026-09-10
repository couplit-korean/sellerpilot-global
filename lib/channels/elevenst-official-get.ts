import {
  elevenstSellerXmlTransport,
  elevenstXmlTransportEvidence,
  type RemoteResponse,
  type SecretPayload,
} from "./protocols";

export type ElevenstGetTransportEvidence = {
  method: "GET";
  requestBytesSha256: string;
  responseBodySha256: string;
  responseBodyBytes: number;
};

export type ElevenstOfficialGetResult = {
  remote: RemoteResponse;
  xml: string;
  evidence: ElevenstGetTransportEvidence;
};

function xmlRoot(xml: string) {
  return /^(?:\s*<\?xml[^>]*>\s*)?<([A-Za-z_][\w.:-]*)\b/u.exec(xml)?.[1] ?? "";
}

function xmlValue(xml: string, tag: string) {
  const match = new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z_][\\w.-]*:)?${tag}>`,
    "iu",
  ).exec(xml);
  return match
    ? match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1").trim()
    : "";
}

function xmlNodes(xml: string, tag: string) {
  return [...xml.matchAll(new RegExp(
    `<(?:[A-Za-z_][\\w.-]*:)?${tag}\\b[\\s\\S]*?</(?:[A-Za-z_][\\w.-]*:)?${tag}>`,
    "giu",
  ))].map((match) => match[0]);
}

const productScalarFields = [
  "prdNo", "sellerPrdCd", "selMthdCd", "dispCtgrNo", "prdTypCd", "prdNm", "brand",
  "rmaterialTypCd", "orgnTypCd", "orgnNmVal", "suplDtyfrPrdClfCd", "forAbrdBuyClf",
  "prdStatCd", "minorSelCnYn", "selStatCd", "selStatNm", "prdImage01", "prdImage02",
  "prdImage03", "prdImage04", "htmlDetail", "selPrdClfCd", "aplBgnDy", "aplEndDy",
  "selPrc", "prdSelQty", "dlvCnAreaCd", "dlvWyCd", "dlvCstInstBasiCd", "bndlDlvCnYn",
  "dlvCstPayTypCd", "dlvCst1", "addrSeqOut", "addrSeqIn", "rtngdDlvCst", "exchDlvCst",
  "asDetail", "rtngExchDetail",
] as const;

export function elevenstOfficialGetEvidence(
  path: string,
  bytes: ArrayBuffer,
): ElevenstGetTransportEvidence {
  const evidence = elevenstXmlTransportEvidence({
    method: "GET",
    path,
    bytes,
  });
  return {
    method: "GET",
    requestBytesSha256: evidence.requestBytesSha256,
    responseBodySha256: evidence.responseBodySha256,
    responseBodyBytes: evidence.responseBodyBytes,
  };
}

export async function elevenstOfficialXmlGet(input: {
  payload: SecretPayload;
  path: string;
}): Promise<ElevenstOfficialGetResult> {
  const transport = await elevenstSellerXmlTransport({
    payload: input.payload,
    method: "GET",
    path: input.path,
  });
  const xml = transport.xml;
  const documentRoot = xmlRoot(xml);
  const resultCode = xmlValue(xml, "resultCode")
    || xmlValue(xml, "ResultCode")
    || xmlValue(xml, "result_code")
    || xmlValue(xml, "ErrorCode");
  const resultMessage = xmlValue(xml, "resultMessage")
    || xmlValue(xml, "ResultMessage")
    || xmlValue(xml, "message");
  const productNo = xmlValue(xml, "productNo") || xmlValue(xml, "prdNo");
  const productNode = xmlNodes(xml, "Product")[0] ?? "";
  const product = Object.fromEntries(productScalarFields.flatMap((field) => {
    const value = productNode ? xmlValue(productNode, field) : "";
    return value ? [[field, value]] : [];
  }));
  const products = xmlNodes(xml, "product").slice(0, 500).map((node) => ({
    productNo: xmlValue(node, "prdNo"),
    sellerProductCode: xmlValue(node, "sellerPrdCd"),
    statusCode: xmlValue(node, "selStatCd"),
  }));
  const acceptedCode = !resultCode || ["0", "200", "210"].includes(resultCode);
  const remote: RemoteResponse = {
    response: transport.response,
    text: "",
    data: {
      accepted: transport.response.ok && acceptedCode,
      ...(resultCode ? { resultCode: resultCode.slice(0, 80) } : {}),
      ...(resultMessage ? { resultMessage: resultMessage.slice(0, 300) } : {}),
      ...(productNo ? { productNo: productNo.slice(0, 80) } : {}),
      ...(Object.keys(product).length ? { product } : {}),
      ...(input.path.startsWith("/rest/prodmarketservice/sellerprodcode/")
        ? {
          lookupDocumentRoot: documentRoot.slice(0, 80),
          lookupBodyBytes: transport.bytes.byteLength,
        }
        : {}),
      products,
      ...(input.path.startsWith("/rest/prodmarketservice/prodmarket/stck/")
        ? {
          stockDocumentRoot: documentRoot,
          stocks: xmlNodes(xml, "ProductStock").map((node) => Object.fromEntries(
            ["prdNo", "prdStckNo", "stckQty", "optWght", "sellerStockCd", "prdStckStatCd"].map(
              (field) => [field, xmlValue(node, field)],
            ),
          )),
        }
        : {}),
    },
  };
  return {
    remote,
    xml,
    evidence: elevenstOfficialGetEvidence(input.path, transport.bytes),
  };
}
