import { Rule, RuleType } from '@midwayjs/validate';

const providerRule = RuleType.string().valid('minimax', 'qwen', 'doubao');
const statusRule = RuleType.string().valid(
  'creating',
  'active',
  'failed',
  'disabled'
);
const editableStatusRule = RuleType.string().valid('active', 'disabled');

export class ListAdminVoiceTimbresQueryDTO {
  @Rule(RuleType.string().allow('').optional())
  keyword?: string;

  @Rule(providerRule.allow('').optional())
  provider?: string;

  @Rule(statusRule.allow('').optional())
  status?: string;

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

  @Rule(RuleType.string().allow('').max(256).optional())
  providerVoiceId?: string;

  @Rule(RuleType.string().allow('').max(1000).optional())
  previewText?: string;

  @Rule(RuleType.string().allow('').max(60).optional())
  previewModel?: string;

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

  @Rule(RuleType.string().allow('').max(1000).optional())
  remark?: string;
}
