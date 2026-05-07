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
}
