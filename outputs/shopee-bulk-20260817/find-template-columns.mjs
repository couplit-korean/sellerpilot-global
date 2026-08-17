import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

function columnName(index) {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

const files = process.argv.slice(2);
const wanted = new Set([
  "Dietary Needs", "Expiry Date", "shelf lifes", "Pork Origin Region",
  "Material", "Pattern", "Sleeve Length", "Plus Size",
  "Region of Origin", "Country of Origin", "country of origins", "Storage Type",
]);

for (const input of files) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
  const sheet = workbook.worksheets.getItem("Template");
  const values = sheet.getRange("A1:DZ6").values;
  for (let index = 0; index < values[2].length; index += 1) {
    const label = values[2][index];
    if (!wanted.has(label)) continue;
    console.log(`${path.basename(input)}\t${columnName(index)}\t${label}\t${values[0][index]}\t${String(values[5][index]).replaceAll("\n", " ").slice(0, 500)}`);
  }
}
