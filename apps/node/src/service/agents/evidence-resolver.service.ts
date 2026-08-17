import { Provide } from '@midwayjs/core';
import {
  AgentEvidenceItem,
  resolveAgentEvidenceUseMode,
  selectAgentEvidence,
} from './agent-evidence';
import type { TurnDecision } from './turn-decision';

export const EVIDENCE_PACK_VERSION = 'evidence_pack_v1' as const;

export interface EvidencePack {
  version: typeof EVIDENCE_PACK_VERSION;
  items: AgentEvidenceItem[];
  assertableIds: string[];
  contextualIds: string[];
  memoryIds: string[];
  strictGrounding: boolean;
}

@Provide()
export class EvidenceResolverService {
  resolve(options: {
    candidates: AgentEvidenceItem[];
    currentQuery: string;
    turnDecision: TurnDecision;
    suppressPriorFacts?: boolean;
    limit?: number;
  }): EvidencePack {
    const candidates = options.suppressPriorFacts
      ? options.candidates.filter(item =>
          ['current_user', 'system_action'].includes(item.source)
        )
      : options.candidates;
    const items = selectAgentEvidence(candidates, {
      currentQuery: options.currentQuery,
      limit: options.limit || 12,
    });
    const assertableIds = items
      .filter(item => resolveAgentEvidenceUseMode(item) === 'assert')
      .map(item => item.id);
    const contextualIds = items
      .filter(item => resolveAgentEvidenceUseMode(item) !== 'assert')
      .map(item => item.id);
    const memoryIds = items
      .filter(item =>
        ['confirmed_fact', 'recent_user', 'retrieved_user'].includes(
          item.source
        )
      )
      .map(item => item.id);

    return {
      version: EVIDENCE_PACK_VERSION,
      items,
      assertableIds,
      contextualIds,
      memoryIds,
      strictGrounding: options.turnDecision.strictGrounding,
    };
  }
}

export function buildEvidencePackFallback(options: {
  candidates: AgentEvidenceItem[];
  currentQuery: string;
  turnDecision: TurnDecision;
  suppressPriorFacts?: boolean;
}): EvidencePack {
  return new EvidenceResolverService().resolve(options);
}
