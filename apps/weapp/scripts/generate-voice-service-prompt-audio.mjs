import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const manifestPath = resolve(
  appDir,
  "src/pages/voice-package/voice-service-prompts.json"
);
const outputDir = resolve(appDir, "src/pages/voice-package/assets/prompts");
const lockPath = resolve(
  appDir,
  "src/pages/voice-package/voice-service-prompt-audio.lock.json"
);
const apiBaseUrl = (
  process.env.VOICE_PROMPT_API_BASE_URL || "http://127.0.0.1:7001"
).replace(/\/+$/, "");

function unwrapApiResponse(value) {
  if (!value || value.success !== true || !value.data) {
    throw new Error(value?.message || "API request failed");
  }

  return value.data;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function post(path, body, authorization = "") {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify(body),
  });
  const value = await response.json();

  if (!response.ok) {
    throw new Error(value?.message || `HTTP ${response.status}`);
  }

  return unwrapApiResponse(value);
}

async function getAuthorization() {
  const configuredToken = process.env.VOICE_PROMPT_API_TOKEN?.trim();
  if (configuredToken) {
    return `${
      process.env.VOICE_PROMPT_API_TOKEN_TYPE || "Bearer"
    } ${configuredToken}`;
  }

  const session = await post("/api/user/dev-login", {
    account: process.env.VOICE_PROMPT_DEV_ACCOUNT || "dev-test",
    openid: process.env.VOICE_PROMPT_DEV_OPENID || "dev-openid",
  });
  if (!session.accessToken) {
    throw new Error("Dev login response did not include an access token");
  }

  return `${session.tokenType || "Bearer"} ${session.accessToken}`;
}

async function generatePromptAudio(prompt, authorization) {
  const speech = await post(
    "/api/agent/create-messenger-speech",
    { text: prompt.text },
    authorization
  );
  if (!speech.url) {
    throw new Error(`Speech URL missing for ${prompt.id}`);
  }

  const response = await fetch(speech.url);
  if (!response.ok) {
    throw new Error(`Audio download failed for ${prompt.id}`);
  }

  const tempPath = resolve(
    tmpdir(),
    `tzl-${prompt.id}-${Date.now()}-source.mp3`
  );
  const outputPath = resolve(outputDir, prompt.file);

  await writeFile(tempPath, Buffer.from(await response.arrayBuffer()));
  const ffmpeg = spawnSync(
    process.env.FFMPEG_BINARY_PATH || "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      tempPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "24000",
      "-b:a",
      "48k",
      "-map_metadata",
      "-1",
      outputPath,
    ],
    { encoding: "utf8" }
  );
  await rm(tempPath, { force: true });

  if (ffmpeg.status !== 0) {
    throw new Error(ffmpeg.stderr || `FFmpeg failed for ${prompt.id}`);
  }

  process.stdout.write(`generated ${basename(outputPath)}\n`);
  return outputPath;
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const authorization = await getAuthorization();
await mkdir(outputDir, { recursive: true });
const promptLocks = [];

for (const prompt of manifest) {
  const outputPath = await generatePromptAudio(prompt, authorization);
  promptLocks.push({
    id: prompt.id,
    file: prompt.file,
    textSha256: sha256(prompt.text.trim()),
    audioSha256: sha256(await readFile(outputPath)),
  });
}

await writeFile(
  lockPath,
  `${JSON.stringify({ version: 1, prompts: promptLocks }, null, 2)}\n`
);
