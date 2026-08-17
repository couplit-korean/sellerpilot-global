import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

for (const input of process.argv.slice(2)) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(input));
  const values = workbook.worksheets.getItem("Template").getRange("A1:DZ9").values;
  const reasonColumn = values[2].findIndex((value) => value === "Fail Reason");
  if (reasonColumn < 0) throw new Error(`Fail Reason column missing: ${input}`);
  for (let row = 6; row <= 8; row += 1) {
    console.log(`${path.basename(input)}\trow=${row + 1}\tcategory=${values[row][0]}\ttitle=${values[row][1]}\treason=${values[row][reasonColumn]}`);
  }
}
