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

export class ConversationComposerActivityDTO {
  @Rule(RuleType.boolean().required())
  active: boolean;
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

export class CreateConversationChatImportDTO {
  @Rule(RuleType.string().max(64))
  clientRequestId?: string;

  @Rule(RuleType.number().min(-840).max(840))
  timezoneOffsetMinutes?: number;

  @Rule(RuleType.boolean())
  deleteAssetsAfterImport?: boolean;
}

export class AddConversationChatImportAssetDTO {
  @Rule(RuleType.string().max(1024).required())
  objectKey: string;

  @Rule(RuleType.string().max(2048))
  publicUrl?: string;

  @Rule(RuleType.string().max(255))
  fileName?: string;

  @Rule(RuleType.string().max(128))
  mimeType?: string;

  @Rule(RuleType.number().min(0).max(29).required())
  screenshotSequence: number;
}

export class RecognizeConversationChatImportDTO {
  @Rule(RuleType.string().valid('user', 'agent', 'unknown'))
  leftSpeaker?: string;

  @Rule(RuleType.string().valid('user', 'agent', 'unknown'))
  rightSpeaker?: string;
}

export class UpdateConversationChatImportIdentityDTO {
  @Rule(RuleType.string().valid('user', 'agent', 'unknown').required())
  leftSpeaker: string;

  @Rule(RuleType.string().valid('user', 'agent', 'unknown').required())
  rightSpeaker: string;
}

export class UpdateConversationChatImportItemDTO {
  @Rule(RuleType.string().max(2000).allow(''))
  content?: string;

  @Rule(RuleType.string().valid('user', 'agent', 'unknown'))
  speaker?: string;

  @Rule(RuleType.string().max(64).allow(''))
  rawTimeText?: string;

  @Rule(RuleType.string().isoDate().allow(''))
  occurredAt?: string;

  @Rule(RuleType.string().valid('minute', 'day', 'month', 'unknown'))
  timePrecision?: string;

  @Rule(RuleType.string().valid('high', 'medium', 'low'))
  timeConfidence?: string;

  @Rule(RuleType.boolean())
  isDeleted?: boolean;
}

export class UpdateConversationChatImportMemoryDTO {
  @Rule(RuleType.string().max(500))
  value?: string;

  @Rule(RuleType.boolean())
  isDeleted?: boolean;
}
