import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { testCatalogSources } from "../../scripts/test-catalog-sources.mjs";

const root = fileURLToPath(new URL("./", import.meta.url));
const templateDirectory = path.join(root, "templates");
const publicImageBase = "https://sellerpilot-global.vercel.app/test-catalog";

const sources = new Map(testCatalogSources.map((source) => [source.sku, source]));

const batches = [
  {
    template: "01-beauty-skincare.xlsx",
    products: [
      ["100893", "[API TEST · NOT FOR SALE] Moisturizing Face Cream Visual Sample", "TEST-COS-001"],
      ["100891", "[API TEST · NOT FOR SALE] Facial Cleansing Soap Visual Sample", "TEST-COS-002"],
      ["101676", "[API TEST · NOT FOR SALE] Red Lip Care Visual Sample", "TEST-COS-003"],
    ],
  },
  {
    template: "02-beauty-tools.xlsx",
    products: [
      ["101653", "[API TEST · NOT FOR SALE] Makeup Brush Set Visual Sample", "TEST-BTL-001"],
      ["101654", "[API TEST · NOT FOR SALE] Beauty Makeup Sponge Visual Sample", "TEST-BTL-002"],
      ["101655", "[API TEST · NOT FOR SALE] Eyelash Curler Visual Sample", "TEST-BTL-003"],
    ],
  },
  {
    template: "03-food-staples.xlsx",
    products: [
      ["100798", "[API TEST · NOT FOR SALE] White Rice Visual Sample", "TEST-FOD-001"],
      ["100799", "[API TEST · NOT FOR SALE] Dry Penne Pasta Visual Sample", "TEST-FOD-002"],
      ["100800", "[API TEST · NOT FOR SALE] Wheat Flour Visual Sample", "TEST-FOD-003"],
    ],
  },
  {
    template: "04-men-tops.xlsx",
    products: [
      ["100244", "[API TEST · NOT FOR SALE] White T-Shirt Front Visual Sample", "TEST-CLT-001"],
      ["100244", "[API TEST · NOT FOR SALE] White T-Shirt Back Visual Sample", "TEST-CLT-002"],
      ["100246", "[API TEST · NOT FOR SALE] Quilted Hoodie Visual Sample", "TEST-CLT-003"],
    ],
  },
  {
    template: "05-toys-games.xlsx",
    products: [
      ["101409", "[API TEST · NOT FOR SALE] Teddy Bear Toy Visual Sample", "TEST-TOY-001"],
      ["101409", "[API TEST · NOT FOR SALE] Yellow Toy Car Visual Sample", "TEST-TOY-002"],
      ["101409", "[API TEST · NOT FOR SALE] Soft Plastic Toy Car Visual Sample", "TEST-TOY-003"],
    ],
  },
  {
    template: "06-food-supplement.xlsx",
    products: [
      ["100007", "[API TEST · NOT FOR SALE] Fish Oil Capsule Visual Sample", "TEST-HLT-001"],
      ["100007", "[API TEST · NOT FOR SALE] Omega 3 Softgel Visual Sample", "TEST-HLT-002"],
      ["100007", "[API TEST · NOT FOR SALE] Vitamin Supplement Visual Sample", "TEST-HLT-003"],
    ],
  },
  {
    template: "07-home-organizers.xlsx",
    products: [
      ["101254", "[API TEST · NOT FOR SALE] Canvas Storage Bag Visual Sample", "TEST-MSC-001"],
      ["101254", "[API TEST · NOT FOR SALE] Storage Box Visual Sample", "TEST-MSC-002"],
      ["101253", "[API TEST · NOT FOR SALE] Clothes Hanger Set Visual Sample", "TEST-MSC-003"],
    ],
  },
];

function makeRow(categoryId, title, sku) {
  const source = sources.get(sku);
  if (!source) throw new Error(`Missing image source for ${sku}`);
  const row = Array(30).fill(null);
  row[0] = categoryId;
  row[1] = title;
  row[2] = [
    "API TEST · NOT FOR SALE. Stock is intentionally set to 0 for channel validation.",
    "This is a non-purchasable interface and API test record, not a product offer.",
    "Product specifications, origin, manufacturer, ingredients, claims, and regulatory status are not verified.",
    `Licensed thumbnail: ${source.source} (${source.license}; ${source.creator}).`,
  ].join(" ");
  row[3] = `P-${sku}`;
  row[10] = 0.1;
  row[11] = 0;
  row[12] = sku;
  row[13] = `${publicImageBase}/${source.file}`;
  row[24] = 0.1;
  row[28] = 1;
  return row;
}

function columnName(index) {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  }
  return name;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function rowXml(rowNumber, values) {
  const cells = values.flatMap((value, index) => {
    if (value === null) return [];
    const reference = `${columnName(index)}${rowNumber}`;
    if (typeof value === "number") return [`<c r="${reference}"><v>${value}</v></c>`];
    return [`<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`];
  });
  return `<row r="${rowNumber}">${cells.join("")}</row>`;
}

for (const batch of batches) {
  const input = path.join(templateDirectory, batch.template);
  const rows = batch.products.map((product) => makeRow(...product));
  if (batch.template === "01-beauty-skincare.xlsx") {
    for (const row of rows) row[30] = "1 Month";
    rows[0][38] = "Cream";
  }
  if (batch.template === "03-food-staples.xlsx") {
    for (const row of rows) {
      row[32] = "1 Month";
      row[39] = "2099/12/31";
      row[44] = "Not Applicable";
    }
    rows[1][60] = "Not Applicable";
    rows[2][60] = "Not Applicable";
  }
  if (batch.template === "04-men-tops.xlsx") {
    for (const row of rows) {
      row[33] = "Other";
      row[36] = "Plain";
    }
    for (const row of rows.slice(0, 2)) {
      row[38] = "Short Sleeve";
      row[51] = "No";
    }
  }
  if (batch.template === "06-food-supplement.xlsx") {
    for (const row of rows) {
      row[31] = "1 Month";
      row[34] = "Unknown";
      row[37] = "2099/12/31";
    }
  }
  if (batch.template === "07-home-organizers.xlsx") {
    rows[0][32] = "Storage Bags";
    rows[1][32] = "Storage Boxes";
  }
  const stem = batch.template.replace(/\.xlsx$/, "");
  const outputPath = path.join(root, `${stem}-upload.xlsx`);

  // Preserve Shopee's workbook package byte-for-byte except for the Template
  // sheet XML. artifact-tool can inspect these vendor templates reliably, but
  // exporting them expands their vendor validation metadata until memory is
  // exhausted. A surgical OOXML insertion keeps every hidden sheet, validation,
  // style, relationship, and vendor extension intact.
  const zip = await JSZip.loadAsync(await fs.readFile(input));
  const workbookXml = await zip.file("xl/workbook.xml").async("string");
  const relationXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const relationId = workbookXml.match(/<sheet\b[^>]*name="Template"[^>]*r:id="([^"]+)"/)?.[1];
  if (!relationId) throw new Error(`Template relationship not found: ${batch.template}`);
  const target = relationXml.match(new RegExp(`<Relationship\\b[^>]*Id="${relationId}"[^>]*Target="([^"]+)"`))?.[1];
  if (!target) throw new Error(`Template worksheet target not found: ${batch.template}`);
  const worksheetPath = `xl/${target}`;
  const worksheetXml = await zip.file(worksheetPath).async("string");
  if (/<row\b[^>]*r="(?:7|8|9)"/.test(worksheetXml)) throw new Error(`Template already contains product rows: ${batch.template}`);
  const insertion = rows.map((row, index) => rowXml(index + 7, row)).join("");
  zip.file(worksheetPath, worksheetXml.replace("</sheetData>", `${insertion}</sheetData>`));
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  await fs.writeFile(outputPath, bytes);

  const savedZip = await JSZip.loadAsync(await fs.readFile(outputPath));
  const savedWorksheetXml = await savedZip.file(worksheetPath).async("string");
  for (const row of rows) {
    for (const value of row.filter((item) => item !== null)) {
      const serialized = typeof value === "number" ? `>${value}<` : escapeXml(value);
      if (!savedWorksheetXml.includes(serialized)) throw new Error(`Round-trip value mismatch: ${batch.template}`);
    }
  }
  for (const [name, file] of Object.entries(savedZip.files)) {
    if (!/^xl\/(?:worksheets\/|sharedStrings\.xml$)/.test(name) || file.dir) continue;
    const xml = await file.async("string");
    if (/#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!)/.test(xml)) {
      throw new Error(`Formula error token in ${batch.template}/${name}`);
    }
  }
  console.log(`${path.basename(outputPath)}\t${rows.length}\tverified`);
}
