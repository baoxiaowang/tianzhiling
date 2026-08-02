import {
  AgentEntity,
  AgentProfileFactAssertionPolicy,
  AgentProfileFactType,
  AgentSex,
} from '@tzl/entities';
import { stripPromptLeakageContent } from '../../common/message-content-safety';
import type { AgentProfileFactSummary } from './agent-profile-fact.service';
import type { ConversationKnownObject } from './reply-intent';
import { getSharedFamilyMemberNameFromFactKey } from './shared-family-member';

export type AgentIdentityRelationshipGeneration =
  | 'elder'
  | 'younger'
  | 'peer'
  | 'spouse'
  | 'unknown';

export type AgentCanonicalRelationship =
  | 'parent'
  | 'grandparent'
  | 'child'
  | 'sibling'
  | 'spouse'
  | 'friend'
  | 'relative'
  | 'unknown';

export interface AgentIdentityContract {
  version: 'agent_identity_v1';
  agent: {
    objectId: 'agent';
    displayName: string;
    realName?: string;
    sex: '男性' | '女性' | '未知';
  };
  user: {
    objectId: 'user';
    addressedAs: string;
  };
  relationship: {
    label: string;
    canonical: AgentCanonicalRelationship;
    generation: AgentIdentityRelationshipGeneration;
    source: 'agent_profile' | 'persona_profile' | 'fallback';
  };
  addresses: {
    userCallsAgent: string;
    agentCallsUser: string;
  };
}

export function buildAgentIdentityContract(options: {
  agent: AgentEntity | null;
}): AgentIdentityContract {
  const agent = options.agent;
  const explicitRelationship = clean(agent?.iCallAgent, 24);
  const profileRelationship = clean(
    agent?.personaProfile?.demographics?.relationshipType,
    24
  );
  const relationshipLabel =
    explicitRelationship || profileRelationship || '亲人';
  const displayName =
    clean(agent?.name, 24) || clean(agent?.realName, 24) || relationshipLabel;
  const realName = clean(agent?.realName, 24);
  const agentCallsUser = clean(agent?.agentCallMe, 24) || '你';

  return {
    version: 'agent_identity_v1',
    agent: {
      objectId: 'agent',
      displayName,
      ...(realName && realName !== displayName ? { realName } : {}),
      sex: resolveSex(agent?.sex),
    },
    user: {
      objectId: 'user',
      addressedAs: agentCallsUser,
    },
    relationship: {
      label: relationshipLabel,
      canonical: resolveCanonicalRelationship(relationshipLabel),
      generation: resolveRelationshipGeneration(relationshipLabel),
      source: explicitRelationship
        ? 'agent_profile'
        : profileRelationship
        ? 'persona_profile'
        : 'fallback',
    },
    addresses: {
      userCallsAgent: explicitRelationship || relationshipLabel,
      agentCallsUser,
    },
  };
}

export function buildKnownConversationObjects(options: {
  identity: AgentIdentityContract;
  profileFacts?: AgentProfileFactSummary[];
}): ConversationKnownObject[] {
  const { identity } = options;
  const objects: ConversationKnownObject[] = [
    {
      id: 'agent',
      kind: 'agent',
      label: identity.agent.displayName,
      aliases: unique([
        identity.agent.displayName,
        identity.agent.realName,
        identity.addresses.userCallsAgent,
        '你',
        '您',
      ]),
      relationToUser: identity.relationship.label,
      assertionPolicy: 'can_assert',
    },
    {
      id: 'user',
      kind: 'user',
      label: identity.user.addressedAs,
      aliases: unique([identity.user.addressedAs, '我', '我们', '咱们']),
      relationToAgent: identity.user.addressedAs,
      assertionPolicy: 'can_assert',
    },
  ];

  for (const fact of options.profileFacts || []) {
    const familyObject = buildFamilyObject(fact);

    if (
      familyObject &&
      !objects.some(object => object.id === familyObject.id)
    ) {
      objects.push(familyObject);
    }
  }

  return objects;
}

export function buildAgentIdentityPrompt(
  identity: AgentIdentityContract
): string {
  const agent = {
    id: identity.agent.objectId,
    name: identity.agent.displayName,
    ...(identity.agent.realName ? { realName: identity.agent.realName } : {}),
    sex: identity.agent.sex,
    relationToUser: identity.relationship.label,
    userCallsAgent: identity.addresses.userCallsAgent,
  };
  const user = {
    id: identity.user.objectId,
    agentCallsUser: identity.addresses.agentCallsUser,
  };

  return [
    '# 当前角色与关系',
    `身份：${JSON.stringify({ agent, user })}`,
    'agent 始终是正在回复的当前角色，user 始终是聊天用户；其他人物、地点和物品必须另建对象，不得互换说话者、经历或关系。',
    '称呼只用于确定关系位置，不证明用户现实、其他家人或共同过去。',
  ].join('\n');
}

export function buildAgentIdentityClassifierContext(
  identity: AgentIdentityContract
): string {
  return `agent=${identity.agent.displayName}（用户称${identity.addresses.userCallsAgent}，${identity.relationship.generation}）；user=当前用户（agent称${identity.addresses.agentCallsUser}）`;
}

function buildFamilyObject(
  fact: AgentProfileFactSummary
): ConversationKnownObject | undefined {
  if (fact.type !== AgentProfileFactType.family) {
    return undefined;
  }

  const sharedName = getSharedFamilyMemberNameFromFactKey(fact.key);
  const relationship = readFamilyRelationship(fact.value);
  const isSharedUnnamedFamily =
    /^family\.(?:son|daughter|child|儿子|女儿|孩子)$/.test(fact.key) &&
    /用户和当前角色|用户与当前角色/.test(fact.value);

  if (!sharedName && !isSharedUnnamedFamily) {
    return undefined;
  }

  const statedName = readFamilyName(fact.value);
  const label = sharedName || statedName || relationship;

  if (!label) {
    return undefined;
  }

  return {
    id: fact.key,
    kind: 'family',
    label,
    aliases: unique([sharedName, statedName, relationship]),
    ...(relationship ? { relationToUser: relationship } : {}),
    ...(relationship ? { relationToAgent: relationship } : {}),
    assertionPolicy:
      fact.assertionPolicy === AgentProfileFactAssertionPolicy.contextOnly
        ? 'context_only'
        : 'can_assert',
  };
}

function readFamilyRelationship(value: string): string {
  const match = value.match(
    /(?:共同的|当前角色的|角色的|的|有)(儿子|女儿|孩子|家人)/
  );
  return match?.[1] || '';
}

function readFamilyName(value: string): string {
  const match = value.match(/(?:名字叫|名叫|叫)([\u4e00-\u9fa5A-Za-z·]{1,12})/);
  return clean(match?.[1], 12);
}

function resolveCanonicalRelationship(
  value: string
): AgentCanonicalRelationship {
  if (/爷爷|奶奶|姥姥|姥爷|外公|外婆|祖父|祖母|grand/.test(value)) {
    return 'grandparent';
  }
  if (/父亲|爸爸|爸|母亲|妈妈|妈|father|mother|parent/i.test(value)) {
    return 'parent';
  }
  if (/儿子|女儿|孩子|child|son|daughter/i.test(value)) {
    return 'child';
  }
  if (/老公|老婆|丈夫|妻子|爱人|伴侣|husband|wife|spouse/i.test(value)) {
    return 'spouse';
  }
  if (/哥哥|姐姐|弟弟|妹妹|兄弟|姐妹|sibling/i.test(value)) {
    return 'sibling';
  }
  if (/朋友|同学|friend/i.test(value)) {
    return 'friend';
  }
  if (/亲人|家人|亲戚|叔|伯|舅|姑|姨/.test(value)) {
    return 'relative';
  }
  return 'unknown';
}

function resolveRelationshipGeneration(
  value: string
): AgentIdentityRelationshipGeneration {
  const canonical = resolveCanonicalRelationship(value);

  if (canonical === 'parent' || canonical === 'grandparent') {
    return 'elder';
  }
  if (canonical === 'child') {
    return 'younger';
  }
  if (canonical === 'spouse') {
    return 'spouse';
  }
  if (canonical === 'sibling' || canonical === 'friend') {
    return 'peer';
  }
  return 'unknown';
}

function resolveSex(value?: AgentSex): AgentIdentityContract['agent']['sex'] {
  if (value === AgentSex.man) {
    return '男性';
  }
  if (value === AgentSex.woman) {
    return '女性';
  }
  return '未知';
}

function unique(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.map(value => clean(value, 24)).filter(Boolean))
  );
}

function clean(value: unknown, maxLength: number): string {
  return stripPromptLeakageContent(typeof value === 'string' ? value : '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
