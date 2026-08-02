import {
  createAgentProfileMessengerSpeech,
  type AgentSummary,
} from "../apis/agent";
import Taro from "@tarojs/taro";
import { buildAgentProfileInitialGreeting } from "./agent-profile-messenger";

const preparedGreetingSources = new Map<string, string>();
const greetingPreparationTasks = new Map<string, Promise<string>>();

async function prepareGreetingSpeech(agentId: string, text: string) {
  const preparedSource = preparedGreetingSources.get(text);

  if (preparedSource) {
    return preparedSource;
  }

  const activeTask = greetingPreparationTasks.get(text);

  if (activeTask) {
    return activeTask;
  }

  const task = (async () => {
    const result = await createAgentProfileMessengerSpeech(agentId, text);
    const remoteSource = result.url.trim();

    if (!remoteSource) {
      return "";
    }

    let playbackSource = remoteSource;

    try {
      const downloaded = await Taro.downloadFile({ url: remoteSource });

      if (
        downloaded.statusCode >= 200 &&
        downloaded.statusCode < 300 &&
        downloaded.tempFilePath?.trim()
      ) {
        playbackSource = downloaded.tempFilePath.trim();
      }
    } catch {}

    preparedGreetingSources.set(text, playbackSource);
    return playbackSource;
  })().finally(() => {
    greetingPreparationTasks.delete(text);
  });

  greetingPreparationTasks.set(text, task);
  return task;
}

export function getPrewarmedAgentProfileGreetingSpeech(text: string) {
  const preparedSource = preparedGreetingSources.get(text);

  if (preparedSource) {
    return Promise.resolve(preparedSource);
  }

  return greetingPreparationTasks.get(text);
}

export async function prewarmAgentProfileInitialGreeting(detail: AgentSummary) {
  if (!detail.id.trim()) {
    return;
  }

  try {
    await prepareGreetingSpeech(
      detail.id,
      buildAgentProfileInitialGreeting(detail)
    );
  } catch {}
}
