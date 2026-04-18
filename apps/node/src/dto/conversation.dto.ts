import { Rule, RuleType } from '@midwayjs/validate';

export class SendConversationMessageDTO {
  @Rule(RuleType.string().max(2000))
  content?: string;

  @Rule(RuleType.string().max(20))
  type?: string;

  @Rule(RuleType.string().max(2048))
  mediaUrl?: string;

  @Rule(RuleType.string().max(1024))
  objectKey?: string;

  @Rule(RuleType.string().max(128))
  mimeType?: string;

  @Rule(RuleType.number().min(0).max(60 * 60 * 1000))
  durationMs?: number;
}

export class TranscribeConversationVoiceDTO {
  @Rule(RuleType.string().max(2048))
  mediaUrl?: string;

  @Rule(RuleType.string().max(1024))
  objectKey?: string;

  @Rule(RuleType.string().max(128))
  mimeType?: string;
}
