export type AgentEvidenceSource =
  | 'agent_profile'
  | 'system_action'
  | 'current_user'
  | 'confirmed_fact'
  | 'recent_user'
  | 'retrieved_user';

export type AgentEvidenceAssertionPolicy = 'can_assert' | 'context_only';

export const AGENT_EVIDENCE_VERSION = 'evidence_atom_v1' as const;

export type AgentEvidenceUseMode =
  | 'assert'
  | 'uptake'
  | 'recall'
  | 'hypothesis';

export type AgentEvidenceStatus = 'active' | 'superseded' | 'retracted';

export interface AgentEvidenceItem {
  id: string;
  source: AgentEvidenceSource;
  text: string;
  assertionPolicy: AgentEvidenceAssertionPolicy;
  subjectRef?: string;
  factKey?: string;
  useMode?: AgentEvidenceUseMode;
  status?: AgentEvidenceStatus;
  supersedes?: string[];
  confidence?: number;
  sourceMessageId?: string;
}

export type AssistantFactClaimKind =
  | 'memory'
  | 'identity'
  | 'relationship'
  | 'real_world'
  | 'other';

export type AssistantFactClaimMode =
  | 'attributed_to_user'
  | 'conversational_uptake'
  | 'autonomous_fact'
  | 'soft_imagination';

export interface AssistantFactClaim {
  text: string;
  kind: AssistantFactClaimKind;
  mode?: AssistantFactClaimMode;
  subjectRef?: string;
  evidenceIds: string[];
}

const USER_EVIDENCE_SOURCES = new Set<AgentEvidenceSource>([
  'current_user',
  'recent_user',
  'retrieved_user',
]);

const EVIDENCE_SOURCE_SCORE: Record<AgentEvidenceSource, number> = {
  current_user: 100,
  system_action: 95,
  confirmed_fact: 85,
  agent_profile: 80,
  recent_user: 65,
  retrieved_user: 55,
};

const CLAIM_FACT_ROOTS: Record<AssistantFactClaimKind, string[]> = {
  identity: ['identity', 'age', 'occupation', 'visual'],
  relationship: ['relationship', 'family'],
  memory: [
    'memory',
    'keepsake',
    'ritual',
    'promise',
    'event',
    'profile_source.shared_memories',
  ],
  real_world: [
    'age',
    'occupation',
    'family',
    'user',
    'health',
    'preference',
    'keepsake',
    'ritual',
    'promise',
    'event',
  ],
  other: [],
};

const ATTRIBUTION_PATTERN =
  /(?:你(?:刚才|刚|也|之前|以前)?(?:说|讲|提|告诉|记得|觉得|担心|提到)|听你(?:说|讲|提)|按你说的|你这句话|你提起的)/;

export function isUserEvidenceSource(source: AgentEvidenceSource): boolean {
  return USER_EVIDENCE_SOURCES.has(source);
}

export function resolveAgentEvidenceUseMode(
  item: AgentEvidenceItem
): AgentEvidenceUseMode {
  if (item.useMode) {
    return item.useMode;
  }

  if (item.source === 'current_user') {
    return item.assertionPolicy === 'can_assert' ? 'uptake' : 'hypothesis';
  }

  if (item.source === 'recent_user' || item.source === 'retrieved_user') {
    return 'recall';
  }

  return item.assertionPolicy === 'can_assert' ? 'assert' : 'hypothesis';
}

export function selectAgentEvidence(
  items: AgentEvidenceItem[],
  options: { currentQuery?: string; limit?: number } = {}
): AgentEvidenceItem[] {
  const limit = Math.max(1, Math.min(options.limit ?? 10, 16));
  const excludedIds = new Set<string>();

  for (const item of items) {
    if (item.status === 'retracted') {
      excludedIds.add(item.id);
    }
    for (const id of item.supersedes || []) {
      excludedIds.add(id);
    }
  }

  const active = items.filter(
    item =>
      item.status !== 'retracted' &&
      item.status !== 'superseded' &&
      !excludedIds.has(item.id)
  );
  const bySlot = new Map<string, AgentEvidenceItem>();
  const unscoped: AgentEvidenceItem[] = [];

  for (const item of active) {
    const slot = item.factKey
      ? `${item.subjectRef || 'unknown'}:${item.factKey}`
      : '';

    if (!slot || item.factKey?.startsWith('utterance.')) {
      unscoped.push(item);
      continue;
    }

    const existing = bySlot.get(slot);
    if (
      !existing ||
      evidenceScore(item, options.currentQuery) >
        evidenceScore(existing, options.currentQuery)
    ) {
      bySlot.set(slot, item);
    }
  }

  return [...unscoped, ...bySlot.values()]
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        evidenceScore(right.item, options.currentQuery) -
          evidenceScore(left.item, options.currentQuery) ||
        left.index - right.index
    )
    .slice(0, limit)
    .map(({ item }) => item);
}

export function agentEvidenceSupportsClaim(
  evidence: AgentEvidenceItem[] | undefined,
  claim: AssistantFactClaim
): boolean {
  const evidenceById = new Map((evidence || []).map(item => [item.id, item]));
  const linkedEvidence = claim.evidenceIds
    .map(id => evidenceById.get(id))
    .filter((item): item is AgentEvidenceItem => Boolean(item))
    .filter(item => item.status !== 'retracted' && item.status !== 'superseded')
    .filter(item => evidenceSubjectMatchesClaim(item, claim));
  const mode = claim.mode || 'autonomous_fact';

  if (mode === 'conversational_uptake') {
    return linkedEvidence.some(
      item =>
        item.source === 'current_user' &&
        resolveAgentEvidenceUseMode(item) === 'uptake' &&
        evidenceTextSupportsClaim(item.text, claim.text)
    );
  }

  if (mode === 'attributed_to_user') {
    return (
      ATTRIBUTION_PATTERN.test(claim.text) &&
      linkedEvidence.some(
        item =>
          isUserEvidenceSource(item.source) &&
          evidenceTextSupportsClaim(item.text, claim.text)
      )
    );
  }

  return linkedEvidence.some(
    item =>
      !isUserEvidenceSource(item.source) &&
      item.assertionPolicy === 'can_assert' &&
      resolveAgentEvidenceUseMode(item) === 'assert' &&
      evidenceKindMatchesClaim(item, claim) &&
      evidenceTextSupportsClaim(item.text, claim.text)
  );
}

export function evidenceTextSupportsClaim(
  evidenceText: string,
  claimText: string
): boolean {
  const evidence = normalizeEvidenceText(evidenceText);
  const claim = normalizeEvidenceText(claimText);

  if (!evidence || !claim) {
    return false;
  }

  if (evidence.includes(claim) || claim.includes(evidence)) {
    return true;
  }

  const evidenceTerms = buildEvidenceTerms(evidence);
  return [...buildEvidenceTerms(claim)].some(term => evidenceTerms.has(term));
}

function evidenceSubjectMatchesClaim(
  item: AgentEvidenceItem,
  claim: AssistantFactClaim
): boolean {
  if (!claim.subjectRef || !item.subjectRef) {
    return true;
  }

  return (
    item.subjectRef === claim.subjectRef ||
    ['mixed', 'unknown', 'conversation'].includes(item.subjectRef)
  );
}

function evidenceKindMatchesClaim(
  item: AgentEvidenceItem,
  claim: AssistantFactClaim
): boolean {
  if (!item.factKey || claim.kind === 'other') {
    return true;
  }

  const roots = CLAIM_FACT_ROOTS[claim.kind];
  return roots.some(
    root => item.factKey === root || item.factKey.startsWith(`${root}.`)
  );
}

function evidenceScore(item: AgentEvidenceItem, currentQuery = ''): number {
  const queryBonus = evidenceTextSupportsClaim(item.text, currentQuery)
    ? 12
    : 0;
  const confidenceBonus = Math.round((item.confidence || 0) * 10);
  const modePenalty =
    resolveAgentEvidenceUseMode(item) === 'hypothesis' ? -8 : 0;

  return (
    EVIDENCE_SOURCE_SCORE[item.source] +
    queryBonus +
    confidenceBonus +
    modePenalty
  );
}

function normalizeEvidenceText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s，。！？、,.!?；;：:'"“”‘’（）()[\]【】]/g, '')
    .replace(/(?:当前角色|角色|用户|你|我|他|她|它|咱们|我们)/g, '');
}

function buildEvidenceTerms(value: string): Set<string> {
  const terms = new Set<string>();
  const chunks = value.match(/[\u3400-\u9fff]{2,}|[a-z0-9]{2,}/g) || [];

  for (const chunk of chunks) {
    if (/^[a-z0-9]+$/.test(chunk)) {
      terms.add(chunk);
      continue;
    }

    for (let index = 0; index < chunk.length - 1; index += 1) {
      terms.add(chunk.slice(index, index + 2));
    }
  }

  return terms;
}
