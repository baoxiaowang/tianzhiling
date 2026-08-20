import { Rule, RuleType } from '@midwayjs/validate';
import { VOICE_TIMBRE_DIALECT_OPTIONS } from '@tzl/shared';

const providerRule = RuleType.string().valid(
  'minimax',
  'cosyvoice',
  'qwen',
  'doubao'
);
const statusRule = RuleType.string().valid(
  'creating',
  'active',
  'failed',
  'disabled'
);
const editableStatusRule = RuleType.string().valid('active', 'disabled');
const speechSpeedRule = RuleType.number().min(0.5).max(2);
const speechVolumeRule = RuleType.number().min(0).max(10);
const speechPitchRule = RuleType.number().min(-12).max(12);
const speechDialectRule = RuleType.string().valid(
  ...VOICE_TIMBRE_DIALECT_OPTIONS.map(option => option.value)
);

export class ListAdminVoiceTimbresQueryDTO {
  @Rule(RuleType.string().allow('').optional())
  keyword?: string;

  @Rule(providerRule.allow('').optional())
  provider?: string;

  @Rule(statusRule.allow('').optional())
  status?: string;

  @Rule(RuleType.alternatives(RuleType.boolean(), RuleType.string()).optional())
  all?: boolean | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  page?: number | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  pageSize?: number | string;
}

export class CreateAdminVoiceTimbreDTO {
  @Rule(RuleType.string().trim().min(1).max(60).required())
  name: string;

  @Rule(providerRule.required())
  provider: string;

  @Rule(RuleType.string().allow('').max(1000).optional())
  audioObjectKey?: string;

  @Rule(RuleType.string().allow('').max(2000).optional())
  audioUrl?: string;

  @Rule(RuleType.string().allow('').max(60).optional())
  cloneLanguage?: string;

  @Rule(speechDialectRule.optional())
  speechDialect?: string;

  @Rule(RuleType.string().allow('').max(256).optional())
  providerVoiceId?: string;

  @Rule(RuleType.string().allow('').max(1000).optional())
  previewText?: string;

  @Rule(RuleType.string().allow('').max(60).optional())
  previewModel?: string;

  @Rule(speechSpeedRule.optional())
  speechSpeed?: number;

  @Rule(speechVolumeRule.optional())
  speechVolume?: number;

  @Rule(speechPitchRule.optional())
  speechPitch?: number;

  @Rule(RuleType.string().allow('').max(1000).optional())
  remark?: string;
}

export class UpdateAdminVoiceTimbreDTO {
  @Rule(RuleType.string().trim().min(1).max(60).optional())
  name?: string;

  @Rule(editableStatusRule.optional())
  status?: string;

  @Rule(RuleType.string().allow('').max(1000).optional())
  previewText?: string;

  @Rule(speechDialectRule.optional())
  speechDialect?: string;

  @Rule(speechSpeedRule.optional())
  speechSpeed?: number;

  @Rule(speechVolumeRule.optional())
  speechVolume?: number;

  @Rule(speechPitchRule.optional())
  speechPitch?: number;

  @Rule(RuleType.string().allow('').max(1000).optional())
  remark?: string;
}
