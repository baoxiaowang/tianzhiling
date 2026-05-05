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
  @Rule(RuleType.string().max(30).optional())
  name?: string;

  @Rule(RuleType.number().optional())
  sex?: number;

  @Rule(RuleType.string().max(20).optional())
  iCallAgent?: string;

  @Rule(RuleType.string().max(20).optional())
  agentCallMe?: string;

  @Rule(RuleType.string().allow('').max(40).optional())
  birthday?: string;

  @Rule(RuleType.string().allow('').max(40).optional())
  deathDate?: string;

  @Rule(RuleType.string().allow('').max(1000).optional())
  description?: string;

  @Rule(RuleType.string().allow('').max(1000).optional())
  lifeExperience?: string;

  @Rule(RuleType.string().allow('').max(1000).optional())
  personalityTraits?: string;

  @Rule(RuleType.string().allow('').max(1000).optional())
  languageHabits?: string;

  @Rule(RuleType.string().allow('').max(1000).optional())
  hobbies?: string;

  @Rule(RuleType.string().allow('').max(1000).optional())
  sharedMemories?: string;
}
