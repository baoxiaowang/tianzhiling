export const CONVERSATION_RETURN_CONTEXT_VERSION =
  'conversation_return_context_v1' as const;

export const CONVERSATION_RETURN_MIN_GAP_MS = 36 * 60 * 60 * 1000;

export interface ConversationReturnContext {
  version: typeof CONVERSATION_RETURN_CONTEXT_VERSION;
  currentTurnAt: string;
  previousContactAt: string;
  previousUserContactAt: string;
  previousAssistantContactAt?: string;
  elapsedHours: number;
  elapsedDays: number;
}

export function resolveConversationReturnContext(options: {
  currentTurnAt?: Date;
  previousUserContactAt?: Date;
  previousAssistantContactAt?: Date;
  minimumGapMs?: number;
}): ConversationReturnContext | undefined {
  const currentTurnAt = normalizeDate(options.currentTurnAt);
  const previousUserContactAt = normalizeDate(options.previousUserContactAt);
  const previousAssistantContactAt = normalizeDate(
    options.previousAssistantContactAt
  );

  if (!currentTurnAt || !previousUserContactAt) {
    return undefined;
  }

  const previousContactAt = [previousUserContactAt, previousAssistantContactAt]
    .filter((value): value is Date => Boolean(value))
    .sort((left, right) => right.getTime() - left.getTime())[0];
  const elapsedMs = currentTurnAt.getTime() - previousContactAt.getTime();
  const minimumGapMs = Math.max(
    0,
    options.minimumGapMs ?? CONVERSATION_RETURN_MIN_GAP_MS
  );

  if (!Number.isFinite(elapsedMs) || elapsedMs < minimumGapMs) {
    return undefined;
  }

  return {
    version: CONVERSATION_RETURN_CONTEXT_VERSION,
    currentTurnAt: currentTurnAt.toISOString(),
    previousContactAt: previousContactAt.toISOString(),
    previousUserContactAt: previousUserContactAt.toISOString(),
    ...(previousAssistantContactAt
      ? { previousAssistantContactAt: previousAssistantContactAt.toISOString() }
      : {}),
    elapsedHours: round(elapsedMs / (60 * 60 * 1000), 1),
    elapsedDays: round(elapsedMs / (24 * 60 * 60 * 1000), 2),
  };
}

function normalizeDate(value?: Date): Date | undefined {
  return value instanceof Date && Number.isFinite(value.getTime())
    ? value
    : undefined;
}

function round(value: number, fractionDigits: number): number {
  const factor = 10 ** fractionDigits;
  return Math.round(value * factor) / factor;
}
