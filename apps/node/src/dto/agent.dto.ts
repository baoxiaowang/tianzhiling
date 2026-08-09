import { Rule, RuleType } from '@midwayjs/validate';
import type {
  AcceptAgentShareInviteRequestDTO,
  AgentShareQRCodeRequestDTO,
  AgentCreateGuideDraftDTO,
  AgentCreateGuideField,
  AgentProfileInterviewDraftDTO,
  AgentProfileMemoryField,
  UpdateAgentShareContextDTO as UpdateAgentShareContextRequestDTO,
} from '@tzl/shared';

const requiredStringRule = RuleType.string().required();

export class CreateAgentDTO {
  @Rule(requiredStringRule.max(30))
  name: string;

  @Rule(RuleType.string().allow('').max(30).optional())
  realName?: string;

  @Rule(RuleType.number().required())
  sex: number;

  @Rule(requiredStringRule.max(20))
  iCallAgent: string;

  @Rule(requiredStringRule.max(20))
  agentCallMe: string;
}

export class AgentCreateGuideDTO {
  @Rule(requiredStringRule.max(300))
  input: string;

  @Rule(RuleType.object().optional())
  draft?: Partial<AgentCreateGuideDraftDTO>;

  @Rule(RuleType.string().allow('').max(32).optional())
  focusField?: AgentCreateGuideField | '';

  @Rule(RuleType.number().min(0).max(10).optional())
  turnCount?: number;
}

export class UpdateAgentAvatarDTO {
  @Rule(requiredStringRule.max(1000))
  avatar: string;
}

export class UpdateAgentDefaultDTO {
  @Rule(RuleType.boolean().required())
  isDefault: boolean;
}

export class AgentProfileInterviewDTO {
  @Rule(requiredStringRule.max(1200))
  input: string;

  @Rule(RuleType.object().optional())
  draft?: Partial<AgentProfileInterviewDraftDTO>;

  @Rule(RuleType.string().allow('').max(32).optional())
  focusField?: AgentProfileMemoryField | '';

  @Rule(RuleType.number().min(0).max(20).optional())
  turnCount?: number;
}

export class AgentProfileMessengerSpeechDTO {
  @Rule(requiredStringRule.max(160))
  text: string;
}

export class AcceptAgentShareInviteDTO
  implements AcceptAgentShareInviteRequestDTO
{
  @Rule(requiredStringRule.max(128))
  token: string;
}

export class AgentShareQRCodeDTO implements AgentShareQRCodeRequestDTO {
  @Rule(requiredStringRule.max(128))
  token: string;
}

export class UpdateAgentShareContextDTO
  implements UpdateAgentShareContextRequestDTO
{
  @Rule(RuleType.string().allow('').max(20).optional())
  agentCallsUser?: string;

  @Rule(RuleType.string().allow('').max(20).optional())
  userCallsAgent?: string;
}

export class UpdateAgentProfileDTO {
  @Rule(RuleType.string().max(30).optional())
  name?: string;

  @Rule(RuleType.string().allow('').max(30).optional())
  realName?: string;

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
