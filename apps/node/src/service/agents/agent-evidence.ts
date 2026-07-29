export type AgentEvidenceSource =
  | 'agent_profile'
  | 'system_action'
  | 'current_user'
  | 'confirmed_fact'
  | 'recent_user'
  | 'retrieved_user';

export type AgentEvidenceAssertionPolicy = 'can_assert' | 'context_only';

export interface AgentEvidenceItem {
  id: string;
  source: AgentEvidenceSource;
  text: string;
  assertionPolicy: AgentEvidenceAssertionPolicy;
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
  | 'autonomous_fact'
  | 'soft_imagination';

export interface AssistantFactClaim {
  text: string;
  kind: AssistantFactClaimKind;
  mode?: AssistantFactClaimMode;
  evidenceIds: string[];
}
