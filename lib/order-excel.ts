export type PaidOrderExcelRecord = {
  id: string;
  channel: string;
  customer: string;
  product: string;
  amount: string;
  status: string;
  time: string;
  carrierCode: string | null;
  trackingNumber: string | null;
  settlementStatus: string;
  settlementAmount: number | null;
  settlementCurrency: string | null;
  exchangeLossPercent: number | null;
};

type ExcelCell = { value: string | number; type: "String" | "Number" };

const paidOrderHeaders = [
  "주문번호",
  "채널",
  "구매자",
  "상품",
  "결제금액",
  "주문상태",
  "택배사 코드",
  "운송장번호",
  "정산상태",
  "정산금액",
  "정산통화",
  "환율손익(%)",
  "주문시간",
] as const;

function escapeXml(value: string | number) {
  return String(value)
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || code >= 32;
    })
    .join("")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cellXml(cell: ExcelCell, styleId?: string) {
  return `<Cell${styleId ? ` ss:StyleID="${styleId}"` : ""}><Data ss:Type="${cell.type}">${escapeXml(cell.value)}</Data></Cell>`;
}

export function buildPaidOrdersExcelWorkbook(orders: PaidOrderExcelRecord[], generatedAt = new Date()) {
  const paidOrders = orders.filter((order) => order.status === "결제완료");
  const rows: ExcelCell[][] = paidOrders.map((order) => [
    { value: order.id, type: "String" },
    { value: order.channel, type: "String" },
    { value: order.customer, type: "String" },
    { value: order.product, type: "String" },
    { value: order.amount, type: "String" },
    { value: order.status, type: "String" },
    { value: order.carrierCode ?? "", type: "String" },
    { value: order.trackingNumber ?? "", type: "String" },
    { value: order.settlementStatus, type: "String" },
    order.settlementAmount == null
      ? { value: "", type: "String" }
      : { value: order.settlementAmount, type: "Number" },
    { value: order.settlementCurrency ?? "", type: "String" },
    order.exchangeLossPercent == null
      ? { value: "", type: "String" }
      : { value: order.exchangeLossPercent, type: "Number" },
    { value: order.time, type: "String" },
  ]);
  const headerXml = paidOrderHeaders
    .map((header) => cellXml({ value: header, type: "String" }, "Header"))
    .join("");
  const bodyXml = rows.map((row) => `<Row>${row.map((cell) => cellXml(cell)).join("")}</Row>`).join("");

  return {
    count: paidOrders.length,
    xml: `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Author>SellerPilot</Author>
  <Created>${generatedAt.toISOString()}</Created>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="10"/></Style>
  <Style ss:ID="Header"><Alignment ss:Horizontal="Center" ss:Vertical="Center"/><Font ss:FontName="Arial" ss:Size="10" ss:Bold="1"/><Interior ss:Color="#EAF3F1" ss:Pattern="Solid"/></Style>
 </Styles>
 <Worksheet ss:Name="결제완료 주문">
  <Table ss:ExpandedColumnCount="${paidOrderHeaders.length}" ss:ExpandedRowCount="${rows.length + 1}" x:FullColumns="1" x:FullRows="1">
   <Column ss:Width="125"/><Column ss:Width="85"/><Column ss:Width="90"/><Column ss:Width="240"/><Column ss:Width="90"/><Column ss:Width="75"/><Column ss:Width="90"/><Column ss:Width="120"/><Column ss:Width="90"/><Column ss:Width="90"/><Column ss:Width="70"/><Column ss:Width="80"/><Column ss:Width="125"/>
   <Row ss:Height="24">${headerXml}</Row>${bodyXml}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane><ActivePane>2</ActivePane><ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios></WorksheetOptions>
 </Worksheet>
</Workbook>`,
  };
}

export function paidOrdersExcelFilename(generatedAt = new Date()) {
  return `sellerpilot-paid-orders-${generatedAt.toISOString().slice(0, 10)}.xls`;
}
