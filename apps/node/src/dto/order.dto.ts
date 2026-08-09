import { Rule, RuleType } from '@midwayjs/validate';
import type {
  CreateVipPlanOrderDTO,
  CreateVoicePackageOrderDTO,
} from '@tzl/shared';

export class CreateVipPlanOrderBodyDTO implements CreateVipPlanOrderDTO {
  @Rule(RuleType.string().required())
  vipPlanId: string;

  @Rule(RuleType.string().required())
  jsCode: string;

  @Rule(RuleType.boolean().optional())
  supportsZeroAmountOrder?: boolean;
}

export class CreateVoicePackageOrderBodyDTO
  implements CreateVoicePackageOrderDTO
{
  @Rule(RuleType.string().required())
  voicePackageId: string;

  @Rule(RuleType.string().required())
  agentId: string;

  @Rule(RuleType.string().required())
  jsCode: string;

  @Rule(RuleType.array().items(RuleType.string().max(1024)).max(12).optional())
  materialObjectKeys?: string[];

  @Rule(RuleType.number().min(0).max(3600).optional())
  materialDurationSeconds?: number;
}
