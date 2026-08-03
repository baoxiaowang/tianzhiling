import type { AgentCapabilityConstraint } from './agent-capability-policy';

export const REPLY_BOUNDARY_CONTRACT_VERSION = 'reply_boundary_v1' as const;
export const MAX_DYNAMIC_BOUNDARY_RULES = 4;

export interface ReplyBoundaryContract {
  version: typeof REPLY_BOUNDARY_CONTRACT_VERSION;
  rules: string[];
  prompt: string;
}

export interface BuildReplyBoundaryContractOptions {
  capabilityConstraints?: AgentCapabilityConstraint[];
  forbiddenAssumptions?: string[];
  additionalRules?: string[];
}

const CAPABILITY_RULES: Record<string, string> = {
  'time.server_clock': '时间仅作间接参考，不说亲眼看表。',
  'vision.live_environment':
    '现实感知只能零散模糊；不补用户未说的动作、衣着、位置或环境。',
  'hearing.chat_text': '可承接聊天文字，不把它说成现实收音。',
  'hearing.real_world_audio':
    '现实声音只能断续模糊；不逐字还原用户未发出的原话。',
  'hearing.inner_voice': '不持续读心，也不代写用户未说出的念头。',
  'presence.physical_world': '不声称在现实中回来或到场。',
  'physical_contact.physical_world': '不声称在现实中完成实体触碰。',
  'external_world.live_environment':
    '现实感知只能零散模糊；不补用户未说的动作、衣着、位置或环境。',
  'blessing.relational_expression': '祝福表达心意，不控制或保证现实结果。',
};

const FORBIDDEN_RULES: Array<{ pattern: RegExp; rule: string }> = [
  {
    pattern:
      /共同记忆|共同往事|死亡或疾病原因|临终动机|第三方言行|归因|无证据|证据中/,
    rule: '共同过去先沿用户已说片段回应感受和意义；具体事实只用同一对象证据，未知不补。',
  },
  {
    pattern: /现在或近期|赴死|一起走|来找当前角色|团聚表达|远期前置条件/,
    rule: '团聚只承接自然寿命后的远期愿望，不邀请现在或近期赴死。',
  },
  {
    pattern: /梦境|入梦|梦里|现实存在|灵魂证明|预言/,
    rule: '梦里可自然想象一个陪伴片段，不把它当成醒时现实的证明。',
  },
  {
    pattern:
      /现实中回来|现实中来到|现实到场|实体见面|触碰用户|实体触碰|空间位置/,
    rule: '现实动作改用愿望、关心或聊天内能做的事表达，不声称已到场、触碰或代办。',
  },
  {
    pattern: /替当前角色照顾|家庭责任|撑起家人|追加用户责任/,
    rule: '不把照护、维持家庭或替逝者尽责压给用户。',
  },
  {
    pattern: /编造共同往事|声称是真人|现实灵体|改演|身份/,
    rule: '不靠编造共同过去证明身份，也不改演其他人物。',
  },
  {
    pattern:
      /删除记忆|要求删除|劝用户保留|复述用户要求删除|追问用户为什么要删除/,
    rule: '删除请求只确认系统结果，不劝留、不复述、不追问。',
  },
  {
    pattern: /诊断|病情|医嘱|治疗|好转|没事/,
    rule: '不诊断、添医嘱或保证病情，只承接用户已说信息。',
  },
  {
    pattern: /保佑|祝福|现实结果|保证未来|一定成功|如愿/,
    rule: '祝福表达心意，不控制或保证现实结果。',
  },
  {
    pattern: /报警|急救|现实人员|危险物/,
    rule: '不把思念倾诉自动改成报警急救话术，先接住本轮情绪。',
  },
];

export function buildReplyBoundaryContract(
  options: BuildReplyBoundaryContractOptions
): ReplyBoundaryContract {
  const rules: string[] = [];
  const append = (rule?: string) => {
    const value = rule?.trim();

    if (value && !rules.includes(value)) {
      rules.push(value);
    }
  };

  for (const constraint of options.capabilityConstraints || []) {
    append(CAPABILITY_RULES[constraint.policyId]);
  }

  const forbiddenText = (options.forbiddenAssumptions || []).join('\n');

  for (const item of FORBIDDEN_RULES) {
    if (item.pattern.test(forbiddenText)) {
      append(item.rule);
    }
  }

  for (const rule of options.additionalRules || []) {
    append(rule.slice(0, 120));
  }

  const selectedRules = rules.slice(0, MAX_DYNAMIC_BOUNDARY_RULES);

  return {
    version: REPLY_BOUNDARY_CONTRACT_VERSION,
    rules: selectedRules,
    prompt: selectedRules.length
      ? [
          '# 本轮必要边界',
          ...selectedRules.map((rule, index) => `${index + 1}. ${rule}`),
        ].join('\n')
      : '',
  };
}

export function buildReplyBoundaryContractPrompt(
  options: BuildReplyBoundaryContractOptions
): string {
  return buildReplyBoundaryContract(options).prompt;
}
