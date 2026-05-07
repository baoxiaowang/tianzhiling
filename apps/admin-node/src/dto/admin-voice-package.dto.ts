import { Rule, RuleType } from '@midwayjs/validate';

const packageStatusRule = RuleType.string().valid('active', 'disabled');

const deliverableRule = RuleType.object({
  title: RuleType.string().trim().min(1).max(80).required(),
  description: RuleType.string().allow('').max(300).optional(),
});

const taskStatusRule = RuleType.string().valid(
  'paid',
  'awaiting_material',
  'processing',
  'training',
  'failed',
  'refunded'
);

export class ListAdminVoicePackagesQueryDTO {
  @Rule(RuleType.string().allow('').optional())
  keyword?: string;

  @Rule(packageStatusRule.allow('').optional())
  status?: string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  page?: number | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  pageSize?: number | string;
}

export class SaveAdminVoicePackageDTO {
  @Rule(
    RuleType.string()
      .trim()
      .pattern(/^[a-zA-Z][a-zA-Z0-9_]{1,49}$/)
      .required()
  )
  code: string;

  @Rule(RuleType.string().trim().min(1).max(50).required())
  name: string;

  @Rule(RuleType.string().allow('').max(500).optional())
  description?: string;

  @Rule(RuleType.number().integer().min(0).max(99999999).required())
  priceAmount: number;

  @Rule(RuleType.number().integer().min(0).max(99999999).optional())
  originalPriceAmount?: number;

  @Rule(RuleType.string().trim().valid('CNY').optional())
  currency?: string;

  @Rule(RuleType.array().items(deliverableRule).max(20).optional())
  deliverables?: Array<{ title: string; description?: string }>;

  @Rule(RuleType.string().allow('').max(1000).optional())
  materialRequirement?: string;

  @Rule(RuleType.number().integer().min(1).max(365).optional())
  estimatedServiceDays?: number;

  @Rule(packageStatusRule.optional())
  status?: string;

  @Rule(RuleType.number().min(0).optional())
  sort?: number;
}

export class ListAdminVoiceTrainingTasksQueryDTO {
  @Rule(RuleType.string().allow('').optional())
  keyword?: string;

  @Rule(RuleType.string().allow('').optional())
  status?: string;

  @Rule(RuleType.string().allow('').optional())
  agentId?: string;

  @Rule(RuleType.string().allow('').optional())
  userId?: string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  page?: number | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  pageSize?: number | string;
}

export class UpdateAdminVoiceTrainingTaskDTO {
  @Rule(taskStatusRule.optional())
  status?: string;

  @Rule(RuleType.string().allow('').max(50).optional())
  assigneeName?: string;

  @Rule(RuleType.array().items(RuleType.string()).optional())
  materialObjectKeys?: string[];

  @Rule(RuleType.string().allow('').optional())
  voiceTimbreId?: string;

  @Rule(RuleType.string().allow('').max(1000).optional())
  remark?: string;
}

export class CompleteAdminVoiceTrainingTaskDTO {
  @Rule(RuleType.string().required())
  voiceTimbreId: string;

  @Rule(RuleType.string().allow('').max(1000).optional())
  remark?: string;
}
