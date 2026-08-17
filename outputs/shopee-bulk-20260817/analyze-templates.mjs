import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

function columnName(index) {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

const templateDirectory = fileURLToPath(new URL("./templates/", import.meta.url));
const templateNames = (await fs.readdir(templateDirectory)).filter((name) => name.endsWith(".xlsx")).sort();
for (const templateName of templateNames) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(`${templateDirectory}/${templateName}`));
  const template = workbook.worksheets.getItem("Template");
  const rows = template.getRange("A1:CX6").values;
  const required = [];
  const categoryAttributes = [];
  for (let index = 0; index < rows[2].length; index += 1) {
    const label = rows[2][index];
    const requirement = rows[3][index];
    if (label && requirement === "Mandatory") {
      required.push({ column: columnName(index), label });
    }
    if (label && index >= 30 && (requirement === "Mandatory" || requirement === "Conditional Mandatory")) {
      categoryAttributes.push({
        column: columnName(index),
        label,
        requirement,
        internal: rows[0][index],
        sample: rows[5][index]?.match(/\[Input Sample\]([^\n]+)/)?.[1]?.trim() ?? null,
      });
    }
  }
  const hiddenCategoryProps = workbook.worksheets.getItem("HiddenCatProps").getRange("A1:J20").values;
  const nonEmptyCategoryProps = hiddenCategoryProps.filter((row) => row.some((value) => value !== null && value !== ""));
  console.log(JSON.stringify({
    templateName,
    metadata: rows[1].slice(0, 4),
    required,
    categoryAttributes,
    hiddenCategoryProps: nonEmptyCategoryProps,
  }));
}
