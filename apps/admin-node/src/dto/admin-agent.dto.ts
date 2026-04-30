import { Rule, RuleType } from '@midwayjs/validate';

export class ListAdminAgentsQueryDTO {
  @Rule(RuleType.string().allow('').optional())
  keyword?: string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  sex?: number | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  status?: number | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  page?: number | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  pageSize?: number | string;
}

export class ListAdminAgentConversationsQueryDTO {
  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  page?: number | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  pageSize?: number | string;
}

export class ListAdminAgentConversationMessagesQueryDTO {
  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  page?: number | string;

  @Rule(RuleType.alternatives(RuleType.number(), RuleType.string()).optional())
  pageSize?: number | string;
}

export class UpdateAdminAgentDTO {
  @Rule(RuleType.string().trim().min(1).max(30).optional())
  name?: string;

  @Rule(RuleType.string().allow('').max(1000).optional())
  avatar?: string;

  @Rule(RuleType.number().valid(0, 1).optional())
  sex?: number;

  @Rule(RuleType.string().trim().min(1).max(20).optional())
  agentCallMe?: string;

  @Rule(RuleType.string().trim().min(1).max(20).optional())
  iCallAgent?: string;

  @Rule(RuleType.string().allow('').max(40).optional())
  birthday?: string;

  @Rule(RuleType.string().allow('').max(40).optional())
  deathDate?: string;

  @Rule(RuleType.string().allow('').max(1000).optional())
  description?: string;

  @Rule(RuleType.number().valid(0, 1).optional())
  status?: number;
}
