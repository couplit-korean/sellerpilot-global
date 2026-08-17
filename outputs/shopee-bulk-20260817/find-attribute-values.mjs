import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

function columnName(index) {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

const [input, ...terms] = process.argv.slice(2);
if (!input || terms.length === 0) throw new Error("Pass an xlsx path and search terms");
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
for (const sheetName of ["Attribute value mapping", "HiddenAttr"] ) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const used = sheet.getUsedRange();
  const values = used.values;
  for (let row = 0; row < values.length; row += 1) {
    for (let column = 0; column < values[row].length; column += 1) {
      const value = values[row][column];
      if (!terms.some((term) => String(value).toLowerCase().includes(term.toLowerCase()))) continue;
      const start = Math.max(0, column - 2);
      const end = Math.min(values[row].length, column + 5);
      const context = values[row].slice(start, end).map((item, offset) => `${columnName(start + offset)}${row + 1}=${item}`).join("\t");
      console.log(`${sheetName}\t${context}`);
      if (sheetName === "Attribute value mapping") {
        const vertical = values.slice(0, 35).map((items, index) => `${columnName(column)}${index + 1}=${items[column]}`).join("\t");
        console.log(`${sheetName} vertical\t${vertical}`);
      }
    }
  }
}
