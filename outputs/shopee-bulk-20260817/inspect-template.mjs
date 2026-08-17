import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = new URL("./templates/01-beauty-skincare.xlsx", import.meta.url);
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(fileURLToPath(inputPath)));
const summary = await workbook.inspect({
  kind: "workbook,sheet,table",
  maxChars: 12000,
  tableMaxRows: 12,
  tableMaxCols: 30,
  tableMaxCellChars: 140,
});
console.log(summary.ndjson);

for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange();
  if (!used) continue;
  console.log(JSON.stringify({ sheet: sheet.name, address: used.address }));
}

const firstSheet = workbook.worksheets.getItemAt(0);
const preview = await workbook.render({ sheetName: firstSheet.name, range: "A1:Z18", scale: 1, format: "png" });
await fs.writeFile(fileURLToPath(new URL("./previews/01-beauty-skincare-template.png", import.meta.url)), new Uint8Array(await preview.arrayBuffer()));
