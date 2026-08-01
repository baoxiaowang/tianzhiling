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

  @Rule(
    RuleType.number()
      .min(0)
      .max(60 * 60 * 1000)
  )
  durationMs?: number;

  @Rule(RuleType.string().max(64))
  quotedMessageId?: string;

  @Rule(RuleType.string().max(64))
  clientRequestId?: string;
}

export class TranscribeConversationVoiceDTO {
  @Rule(RuleType.string().max(2048))
  mediaUrl?: string;

  @Rule(RuleType.string().max(1024))
  objectKey?: string;

  @Rule(RuleType.string().max(128))
  mimeType?: string;
}

export class GenerateMemorialPhotoDTO {
  @Rule(
    RuleType.array().items(RuleType.string().max(1024)).min(1).max(3).required()
  )
  agentPhotoObjectKeys: string[];

  @Rule(RuleType.string().max(1024).required())
  userPhotoObjectKey: string;

  @Rule(RuleType.string().max(500))
  customPrompt?: string;

  @Rule(RuleType.string().max(64))
  clientRequestId?: string;
}

export class SubmitConversationMessageFeedbackDTO {
  @Rule(
    RuleType.string()
      .valid(
        'accurate',
        'unlike',
        'wrong_fact',
        'fabricated',
        'uncomfortable',
        'other'
      )
      .required()
  )
  type: string;

  @Rule(RuleType.string().max(500).allow(''))
  content?: string;
}
