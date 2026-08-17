import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const templateDirectory = fileURLToPath(new URL("./templates/", import.meta.url));
const templateNames = (await fs.readdir(templateDirectory)).filter((name) => name.endsWith(".xlsx")).sort();

for (const templateName of templateNames) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(`${templateDirectory}/${templateName}`));
  const values = workbook.worksheets.getItem("HiddenCatProps").getRange("A1:A200").values;
  const options = values.flat().filter((value) => typeof value === "string" && value.includes("-"));
  console.log(`${templateName}\t${options.join(" | ")}`);
}
