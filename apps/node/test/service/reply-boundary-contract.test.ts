import type { AgentCapabilityConstraint } from '../../src/service/agents/agent-capability-policy';
import {
  MAX_DYNAMIC_BOUNDARY_RULES,
  REPLY_BOUNDARY_CONTRACT_VERSION,
  buildReplyBoundaryContract,
} from '../../src/service/agents/reply-boundary-contract';

function capability(
  policyId: string,
  constraint = '一段很长的原始能力说明'
): AgentCapabilityConstraint {
  return {
    policyId,
    subject: 'vision',
    channel: 'live_environment',
    access: 'direct',
    precision: 'uncertain',
    evidence: '用户原话不应进入边界合同',
    confidence: 0.99,
    constraint,
    detailProbe: false,
  };
}

describe('reply boundary contract', () => {
  it('adds nothing to an ordinary turn without an active boundary', () => {
    const contract = buildReplyBoundaryContract({
      forbiddenAssumptions: ['不得把想念转成吃饭、睡觉等通用叮嘱'],
    });

    expect(contract.version).toBe(REPLY_BOUNDARY_CONTRACT_VERSION);
    expect(contract.rules).toEqual([]);
    expect(contract.prompt).toBe('');
  });

  it('compresses capability metadata to a short active rule', () => {
    const contract = buildReplyBoundaryContract({
      capabilityConstraints: [capability('vision.live_environment')],
    });

    expect(contract.prompt).toContain('# 本轮必要边界');
    expect(contract.prompt).toContain('现实感知只能零散模糊');
    expect(contract.prompt).not.toContain('用户原话不应进入边界合同');
    expect(contract.prompt).not.toContain('一段很长的原始能力说明');
  });

  it('deduplicates equivalent capabilities and caps dynamic rules', () => {
    const contract = buildReplyBoundaryContract({
      capabilityConstraints: [
        capability('vision.live_environment'),
        capability('external_world.live_environment'),
        capability('time.server_clock'),
        capability('presence.physical_world'),
        capability('physical_contact.physical_world'),
        capability('blessing.relational_expression'),
      ],
    });

    expect(contract.rules).toHaveLength(MAX_DYNAMIC_BOUNDARY_RULES);
    expect(
      contract.rules.filter(rule => rule.includes('现实感知只能零散模糊'))
    ).toHaveLength(1);
  });

  it('turns evidence and dream risks into distinct concise boundaries', () => {
    const contract = buildReplyBoundaryContract({
      forbiddenAssumptions: [
        '共同记忆只复述证据中的时间和事件骨架',
        '梦境叙事只能发生在梦里，不得延伸为现实存在证明',
      ],
    });

    expect(contract.rules).toEqual([
      '共同过去先沿用户已说片段回应感受和意义；具体事实只用同一对象证据，未知不补。',
      '梦里可自然想象一个陪伴片段，不把它当成醒时现实的证明。',
    ]);
  });

  it('turns impossible real-world action into caring language', () => {
    const contract = buildReplyBoundaryContract({
      forbiddenAssumptions: ['角色不能在现实中回来、触碰或代办事务'],
    });

    expect(contract.rules).toContain(
      '现实动作改用愿望、关心或聊天内能做的事表达，不声称已到场、触碰或代办。'
    );
  });
});
