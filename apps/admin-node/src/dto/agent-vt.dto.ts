import { Rule, RuleType } from '@midwayjs/validate';

export class AgentVtCreateTrainingBodyDTO {
  @Rule(RuleType.string().trim().allow('').max(512).optional())
  audioObjectKey?: string;

  @Rule(RuleType.array().items(RuleType.string().trim().min(1).max(512)).max(20).optional())
  audioObjectKeys?: string[];

  @Rule(RuleType.string().trim().allow('').max(80).optional())
  name?: string;

  @Rule(RuleType.string().trim().allow('').max(30).optional())
  provider?: string;

  @Rule(RuleType.string().trim().allow('').max(60).optional())
  speechDialect?: string;

  @Rule(RuleType.string().trim().allow('').max(200).optional())
  speechInstruction?: string;

  @Rule(RuleType.string().trim().allow('').max(200).optional())
  previewText?: string;

  @Rule(RuleType.number().min(0.5).max(2).optional())
  speechSpeed?: number;

  @Rule(RuleType.number().min(0.5).max(2).optional())
  speechVolume?: number;
}

export class AgentVtMaterialBodyDTO {
  @Rule(RuleType.string().trim().allow('').max(80).optional())
  name?: string;

  @Rule(RuleType.string().trim().min(1).max(512).required())
  objectKey!: string;

  @Rule(RuleType.string().trim().allow('').max(512).optional())
  publicUrl?: string;
}

export class AgentVtClipBodyDTO {
  @Rule(RuleType.array().items(RuleType.object().required()).min(1).max(20).required())
  materials!: Array<{
    name?: string;
    objectKey: string;
    publicUrl?: string;
  }>;
}

export class AgentVtChatMessageDTO {
  @Rule(RuleType.string().valid('user', 'assistant').required())
  role!: 'user' | 'assistant';

  @Rule(RuleType.string().trim().max(4000).required())
  content!: string;
}

export class AgentVtChatAttachmentDTO {
  @Rule(RuleType.string().trim().min(1).max(512).required())
  objectKey!: string;

  @Rule(RuleType.string().trim().allow('').max(200).optional())
  name?: string;
}

export class AgentVtChatBodyDTO {
  @Rule(RuleType.array().items(RuleType.object().required()).max(60).required())
  messages!: AgentVtChatMessageDTO[];

  @Rule(RuleType.array().items(RuleType.object().required()).max(10).optional())
  attachments?: AgentVtChatAttachmentDTO[];
}

export class AgentVtUploadSignBodyDTO {
  @Rule(RuleType.string().trim().min(1).max(200).required())
  fileName!: string;

  @Rule(RuleType.string().trim().allow('').max(100).optional())
  contentType?: string;

  @Rule(RuleType.number().optional())
  expiresInSeconds?: number;
}
