import { createHash } from "crypto";
import { existsSync, readFileSync, statSync } from "fs";
import { resolve } from "path";
import promptAudioLock from "../src/pages/voice-package/voice-service-prompt-audio.lock.json";
import promptManifest from "../src/pages/voice-package/voice-service-prompts.json";
import { VOICE_SERVICE_PROMPTS } from "../src/pages/voice-package/voice-service-progress";

describe("voice service fixed prompt audio", () => {
  const promptDirectory = resolve(
    __dirname,
    "../src/pages/voice-package/assets/prompts"
  );
  const speechMappingSource = readFileSync(
    resolve(
      __dirname,
      "../src/pages/voice-package/voice-service-prompt-speech.ts"
    ),
    "utf8"
  );
  const promptLocks = new Map(
    promptAudioLock.prompts.map((prompt) => [prompt.id, prompt])
  );

  function sha256(value: string | Buffer) {
    return createHash("sha256").update(value).digest("hex");
  }

  it("keeps every fixed stage prompt in the shared manifest", () => {
    expect(promptManifest).toHaveLength(20);
    expect(new Set(promptManifest.map((item) => item.id)).size).toBe(
      promptManifest.length
    );
    expect(new Set(promptManifest.map((item) => item.text)).size).toBe(
      promptManifest.length
    );

    const manifestTexts = new Set(promptManifest.map((item) => item.text));
    Object.values(VOICE_SERVICE_PROMPTS).forEach((text) => {
      expect(manifestTexts.has(text)).toBe(true);
    });
  });

  it("ships a non-empty local MP3 and mapping for every fixed prompt", () => {
    promptManifest.forEach((prompt) => {
      const audioPath = resolve(promptDirectory, prompt.file);

      expect(existsSync(audioPath)).toBe(true);
      expect(statSync(audioPath).size).toBeGreaterThan(4096);
      expect(speechMappingSource).toContain(`${prompt.id}:`);
      expect(speechMappingSource).toContain(`./assets/prompts/${prompt.file}`);
      expect(promptLocks.get(prompt.id)).toEqual({
        id: prompt.id,
        file: prompt.file,
        textSha256: sha256(prompt.text.trim()),
        audioSha256: sha256(readFileSync(audioPath)),
      });
    });
  });
});
