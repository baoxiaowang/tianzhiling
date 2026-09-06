import { splitReplyContentForDelivery } from './reply-bubble-plan';

export const MESSENGER_REPLY_MAX_BUBBLES = 2;

/**
 * Adapt a completed messenger reply for display without changing its text.
 * Short replies stay in one bubble; longer replies split only at an existing
 * punctuation boundary and never exceed two bubbles.
 */
export function buildMessengerReplyDeliverySegments(
  finalReply: string
): string[] {
  const reply = finalReply || '';
  return reply
    ? splitReplyContentForDelivery([reply], MESSENGER_REPLY_MAX_BUBBLES)
    : [];
}
