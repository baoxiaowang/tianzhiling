import { Rule, RuleType } from '@midwayjs/validate';
import type { CreateVipPlanOrderDTO } from '@tzl/shared';

export class CreateVipPlanOrderBodyDTO implements CreateVipPlanOrderDTO {
  @Rule(RuleType.string().required())
  vipPlanId: string;

  @Rule(RuleType.string().required())
  jsCode: string;
}
