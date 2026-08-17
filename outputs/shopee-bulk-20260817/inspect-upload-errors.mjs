import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

function columnName(index) {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

const input = process.argv[2];
if (!input) throw new Error("Pass an xlsx path");
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange();
  if (used) console.log(`${sheet.name}\t${used.address}`);
}
const sheet = workbook.worksheets.getItem("Template");
const values = sheet.getRange("A1:DZ12").values;
for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
  const cells = values[rowIndex].flatMap((value, columnIndex) => {
    if (value === null || value === "") return [];
    return [`${columnName(columnIndex)}${rowIndex + 1}=${String(value).slice(0, 500)}`];
  });
  if (cells.length) console.log(cells.join("\t"));
}
