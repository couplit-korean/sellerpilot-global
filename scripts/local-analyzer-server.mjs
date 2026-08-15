import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(projectRoot, "scripts", "local-image-analyzer.swift");
const buildDirectory = join(projectRoot, ".local");
const binaryPath = join(buildDirectory, "local-image-analyzer");
const port = Number(process.env.SELLERPILOT_ANALYZER_PORT || 3210);
const maximumBodyBytes = 18 * 1024 * 1024;

function run(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else rejectPromise(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function ensureAnalyzerBinary() {
  await mkdir(buildDirectory, { recursive: true });
  let shouldCompile = false;
  try {
    const [source, binary] = await Promise.all([stat(sourcePath), stat(binaryPath)]);
    shouldCompile = source.mtimeMs > binary.mtimeMs;
  } catch {
    shouldCompile = true;
  }

  if (!shouldCompile) return;
  process.stdout.write("[셀러파일럿] 로컬 이미지 분석기를 준비합니다…\n");
  await run("xcrun", ["swiftc", "-O", sourcePath, "-o", binaryPath]);
}

function responseHeaders(origin) {
  const allowedOrigins = new Set([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3100",
    "http://127.0.0.1:3100",
  ]);
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "http://localhost:3000",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function sendJson(response, status, body, origin = "") {
  response.writeHead(status, {
    ...responseHeaders(origin),
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maximumBodyBytes) throw new Error("사진 파일이 너무 큽니다. 12MB 이하 이미지를 사용해 주세요.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseImageDataUrl(value) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(value || "");
  if (!match) throw new Error("PNG, JPG 또는 WebP 사진만 분석할 수 있습니다.");
  const mimeType = match[1].toLowerCase().replace("jpg", "jpeg");
  const extension = mimeType === "image/png" ? ".png" : mimeType === "image/webp" ? ".webp" : ".jpg";
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length === 0 || bytes.length > 12 * 1024 * 1024) {
    throw new Error("사진 파일은 12MB 이하여야 합니다.");
  }
  return { bytes, extension, mimeType };
}

function buildLocalizedDrafts(result) {
  const count = /([0-9]+)\s*정/.exec(result.packageSize)?.[1] || "30";
  const weight = /([0-9,]+)\s*mg/i.exec(result.packageSize)?.[1] || "1,100";
  const detail = /\(([^)]+)\)/.exec(result.packageSize)?.[1]?.replace(/\s*\/\s*/g, " / ") || "33g / 120kcal";
  const isWhiteTomato = result.productName.includes("화이트토마토");
  const isGlutathione = result.productName.includes("글루타치온");
  const englishName = [
    isWhiteTomato ? "White Tomato" : result.productName,
    isGlutathione ? "Glutathione" : "",
    `${count} Tablets`,
  ].filter(Boolean).join(" ");

  return [
    {
      market: "한국어 기본 상세",
      language: "한국어",
      title: `${result.productName} ${count}정`,
      description: `상품 포장 표시를 기준으로 작성한 한국어 상세페이지 초안입니다. 분류는 ${result.category || "식품"}이며, 내용량은 ${weight}mg × ${count}정(${detail})입니다. 의학적 효능이나 효과를 단정하는 표현은 포함하지 않았습니다.`,
    },
    {
      market: "Qoo10 Japan",
      language: "日本語",
      title: isWhiteTomato && isGlutathione
        ? `ホワイトトマト グルタチオン ${count}粒`
        : `${result.productName} ${count}個`,
      description: `パッケージ表示では糖類加工品です。内容量は${weight}mg × ${count}粒（${detail}）。効能を断定せず、原材料表示を基準に作成した確認用の下書きです。`,
    },
    {
      market: "Shopee Singapore",
      language: "English",
      title: englishName,
      description: `A listing draft based on the package label. Category: processed sugar product. Pack size: ${weight}mg × ${count} tablets (${detail}). No medical or guaranteed-effect claims are included.`,
    },
    {
      market: "Lazada Malaysia",
      language: "Bahasa Melayu",
      title: isWhiteTomato && isGlutathione
        ? `White Tomato Glutathione ${count} Tablet`
        : `${result.productName} ${count} Unit`,
      description: `Draf berdasarkan maklumat pada label bungkusan. Kategori: produk gula diproses. Saiz pek: ${weight}mg × ${count} tablet (${detail}). Tiada tuntutan perubatan atau kesan yang dijamin.`,
    },
  ];
}

function buildSettingShots(result) {
  const isWhiteTomatoDemo = result.productName.includes("화이트토마토") && result.productName.includes("글루타치온");
  const demoImages = isWhiteTomatoDemo
    ? [
        "/demo/setting-shots/premium-studio.png",
        "/demo/setting-shots/morning-routine.png",
        "/demo/setting-shots/ingredient-flatlay.png",
        "/demo/setting-shots/daily-carry.png",
      ]
    : [null, null, null, null];

  return [
    {
      id: "studio",
      scene: "premium-studio",
      title: "프리미엄 스튜디오",
      description: "포장 색상과 형태를 살린 판매용 메인 설정샷",
      imageUrl: demoImages[0],
      generationMode: isWhiteTomatoDemo ? "AI_REFERENCE_GENERATED" : "LOCAL_SCENE_COMPOSITOR",
    },
    {
      id: "routine",
      scene: "morning-routine",
      title: "모닝 웰니스 루틴",
      description: "상품 유형에 맞춰 물과 자연광을 구성한 생활 장면",
      imageUrl: demoImages[1],
      generationMode: isWhiteTomatoDemo ? "AI_REFERENCE_GENERATED" : "LOCAL_SCENE_COMPOSITOR",
    },
    {
      id: "ingredient",
      scene: "ingredient-flatlay",
      title: "핵심 원료 플랫레이",
      description: "사진에서 확인된 원료 단서만 반영한 탑뷰 장면",
      imageUrl: demoImages[2],
      generationMode: isWhiteTomatoDemo ? "AI_REFERENCE_GENERATED" : "LOCAL_SCENE_COMPOSITOR",
    },
    {
      id: "carry",
      scene: "daily-carry",
      title: "데일리 휴대 장면",
      description: "제품 크기와 일상 사용 맥락을 보여주는 라이프스타일 장면",
      imageUrl: demoImages[3],
      generationMode: isWhiteTomatoDemo ? "AI_REFERENCE_GENERATED" : "LOCAL_SCENE_COMPOSITOR",
    },
  ];
}

async function analyzeImage(imageDataUrl, fileName) {
  const { bytes, extension } = parseImageDataUrl(imageDataUrl);
  const workingDirectory = await mkdtemp(join(tmpdir(), "sellerpilot-analysis-"));
  const inputPath = join(workingDirectory, `input${extension || extname(fileName || "") || ".png"}`);
  const thumbnailPath = join(workingDirectory, "thumbnail.png");

  try {
    await writeFile(inputPath, bytes);
    const { stdout } = await run(binaryPath, [inputPath, thumbnailPath]);
    const result = JSON.parse(stdout);
    const thumbnail = await readFile(thumbnailPath);
    return {
      ...result,
      thumbnailDataUrl: `data:image/png;base64,${thumbnail.toString("base64")}`,
      localizedDrafts: buildLocalizedDrafts(result),
      settingShots: buildSettingShots(result),
      analyzedAt: new Date().toISOString(),
      sourceFileName: fileName || "업로드 이미지",
      priceSearch: {
        status: "not_connected",
        message: "판매채널 상품검색 API 미연동 — 가짜 최저가는 표시하지 않습니다.",
        candidates: [],
      },
    };
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

await ensureAnalyzerBinary();

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || "";
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);

  if (request.method === "OPTIONS") {
    response.writeHead(204, responseHeaders(origin));
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: "sellerpilot-local-image-analyzer",
      engine: "Apple Vision",
    }, origin);
    return;
  }

  if (request.method !== "POST" || url.pathname !== "/analyze") {
    sendJson(response, 404, { ok: false, error: "Not found" }, origin);
    return;
  }

  try {
    const body = await readJsonBody(request);
    const result = await analyzeImage(body.imageDataUrl, body.fileName);
    sendJson(response, 200, { ok: true, result }, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "이미지 분석에 실패했습니다.";
    process.stderr.write(`[셀러파일럿] 분석 오류: ${message}\n`);
    sendJson(response, 400, { ok: false, error: message }, origin);
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`[셀러파일럿] 실제 이미지 분석 서버: http://127.0.0.1:${port}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
