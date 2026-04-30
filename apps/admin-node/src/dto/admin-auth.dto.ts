import { Rule, RuleType } from '@midwayjs/validate';

export class AdminPasswordLoginDTO {
  @Rule(RuleType.string().required())
  account: string;

  @Rule(RuleType.string().required())
  password: string;
}

export class AdminBootstrapRegisterDTO {
  @Rule(RuleType.string().required().max(50))
  name: string;

  @Rule(RuleType.string().required().min(3).max(50))
  account: string;

  @Rule(RuleType.string().required().min(6).max(128))
  password: string;
}
