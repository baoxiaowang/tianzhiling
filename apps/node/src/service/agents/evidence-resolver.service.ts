import { Provide } from '@midwayjs/core';
import {
  AgentEvidenceItem,
  AgentEvidenceSource,
  resolveAgentEvidenceUseMode,
  selectAgentEvidence,
} from './agent-evidence';

export const EVIDENCE_PACK_VERSION = 'evidence_pack_v1' as const;

export interface EvidencePack {
  version: typeof EVIDENCE_PACK_VERSION;
  items: AgentEvidenceItem[];
  assertableIds: string[];
  contextualIds: string[];
  memoryIds: string[];
  strictGrounding: boolean;
  governance: EvidenceGovernanceSummary;
}

export interface EvidenceGovernanceSummary {
  currentTurnIds: string[];
  sourceCounts: Partial<Record<AgentEvidenceSource, number>>;
  correctionMode?: 'reset' | 'replace';
  priorFactsSuppressed: boolean;
  suppressedPriorSources: AgentEvidenceSource[];
}

@Provide()
export class EvidenceResolverService {
  resolve(options: {
    candidates: AgentEvidenceItem[];
    currentQuery: string;
    strictGrounding: boolean;
    suppressPriorFacts?: boolean;
    correctionMode?: 'reset' | 'replace';
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
    const sourceCounts = items.reduce<
      Partial<Record<AgentEvidenceSource, number>>
    >((counts, item) => {
      counts[item.source] = (counts[item.source] || 0) + 1;
      return counts;
    }, {});

    return {
      version: EVIDENCE_PACK_VERSION,
      items,
      assertableIds,
      contextualIds,
      memoryIds,
      strictGrounding: options.strictGrounding,
      governance: {
        currentTurnIds: items
          .filter(item => item.source === 'current_user')
          .map(item => item.id),
        sourceCounts,
        correctionMode: options.correctionMode,
        priorFactsSuppressed: Boolean(options.suppressPriorFacts),
        suppressedPriorSources: options.suppressPriorFacts
          ? ['agent_profile', 'confirmed_fact', 'recent_user', 'retrieved_user']
          : [],
      },
    };
  }
}

export function buildEvidencePackFallback(options: {
  candidates: AgentEvidenceItem[];
  currentQuery: string;
  strictGrounding: boolean;
  suppressPriorFacts?: boolean;
  correctionMode?: 'reset' | 'replace';
}): EvidencePack {
  return new EvidenceResolverService().resolve(options);
}
