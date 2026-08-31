import {
  AGENT_CREATE_AVATAR_QUESTION,
  getAgentCreateMessengerGreeting,
  AGENT_CREATE_NAME_QUESTION,
  AGENT_CREATE_USER_CALL_QUESTION,
} from "@tzl/shared";
import Taro from "@tarojs/taro";
import { brand } from '../config/brand';
import { createAgentCreationMessengerSpeech } from "../apis/agent";

const preparedSources = new Map<string, string>();
const preparationTasks = new Map<string, Promise<string>>();
const reusablePrompts = [
  getAgentCreateMessengerGreeting(brand.name),
  AGENT_CREATE_NAME_QUESTION,
  AGENT_CREATE_USER_CALL_QUESTION,
  AGENT_CREATE_AVATAR_QUESTION,
];

async function prepareSpeech(text: string) {
  const prepared = preparedSources.get(text);

  if (prepared) {
    return prepared;
  }

  const activeTask = preparationTasks.get(text);

  if (activeTask) {
    return activeTask;
  }

  const task = (async () => {
    const result = await createAgentCreationMessengerSpeech(text);
    const remoteSource = result.url.trim();

    if (!remoteSource) {
      return "";
    }

    let playbackSource = remoteSource;

    try {
      const downloaded = await Taro.downloadFile({
        url: remoteSource,
        timeout: 8000,
      });

      if (
        downloaded.statusCode >= 200 &&
        downloaded.statusCode < 300 &&
        downloaded.tempFilePath?.trim()
      ) {
        playbackSource = downloaded.tempFilePath.trim();
      }
    } catch {}

    preparedSources.set(text, playbackSource);
    return playbackSource;
  })().finally(() => {
    preparationTasks.delete(text);
  });

  preparationTasks.set(text, task);
  return task;
}

export async function prewarmAgentCreateMessengerSpeech() {
  await prepareSpeech(getAgentCreateMessengerGreeting(brand.name)).catch(() => "");
  void Promise.allSettled(
    reusablePrompts
      .filter((prompt) => prompt !== getAgentCreateMessengerGreeting(brand.name))
      .map((prompt) => prepareSpeech(prompt))
  );
}

export function getAgentCreateMessengerSpeech(text: string) {
  return prepareSpeech(text);
}
