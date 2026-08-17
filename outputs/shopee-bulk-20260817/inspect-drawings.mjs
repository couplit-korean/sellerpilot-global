import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const templateDirectory = fileURLToPath(new URL("./templates/", import.meta.url));
for (const templateName of (await fs.readdir(templateDirectory)).filter((name) => name.endsWith(".xlsx")).sort()) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(`${templateDirectory}/${templateName}`));
  console.log(templateName, workbook.worksheets.items.map((sheet) => ({
    sheet: sheet.name,
    drawings: sheet.drawings?.items?.length ?? null,
    images: sheet.images?.items?.length ?? null,
    shapes: sheet.shapes?.items?.length ?? null,
    charts: sheet.charts?.items?.length ?? null,
  })));
}
