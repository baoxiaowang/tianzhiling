export const AGENT_CREATE_INTRO_DATE_STORAGE_KEY = "agent_create_intro_date";

import { brand } from "../../config/brand";

export const AGENT_CREATE_INTRO_LINES = [
  `你好，我是${brand.name}小使者`,
  "你的每句话，都在唤醒他",
  "准备好后，我们就开始",
] as const;

export const AGENT_CREATE_INTRO_SPEECH_TEXT = `${AGENT_CREATE_INTRO_LINES.join(
  "。"
)}。`;

export function createLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function shouldAnimateAgentCreateIntro(
  lastCompletedDate: unknown,
  now: Date
) {
  return lastCompletedDate !== createLocalDateKey(now);
}
