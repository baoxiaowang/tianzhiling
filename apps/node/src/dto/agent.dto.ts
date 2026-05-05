import { Rule, RuleType } from '@midwayjs/validate';

const requiredStringRule = RuleType.string().required();

export class CreateAgentDTO {
  @Rule(requiredStringRule.max(30))
  name: string;

  @Rule(RuleType.number().required())
  sex: number;

  @Rule(requiredStringRule.max(20))
  iCallAgent: string;

  @Rule(requiredStringRule.max(20))
  agentCallMe: string;
}

export class UpdateAgentAvatarDTO {
  @Rule(requiredStringRule.max(1000))
  avatar: string;
}

export class UpdateAgentProfileDTO {
  @Rule(RuleType.string().max(30))
  name?: string;

  @Rule(RuleType.number())
  sex?: number;

  @Rule(RuleType.string().max(20))
  iCallAgent?: string;

  @Rule(RuleType.string().max(20))
  agentCallMe?: string;

  @Rule(RuleType.string().max(40))
  birthday?: string;

  @Rule(RuleType.string().max(40))
  deathDate?: string;

  @Rule(RuleType.string().max(1000))
  description?: string;

  @Rule(RuleType.string().max(1000))
  lifeExperience?: string;

  @Rule(RuleType.string().max(1000))
  personalityTraits?: string;

  @Rule(RuleType.string().max(1000))
  languageHabits?: string;

  @Rule(RuleType.string().max(1000))
  hobbies?: string;

  @Rule(RuleType.string().max(1000))
  sharedMemories?: string;
}
