import type {
  ContinuityInformationCard,
  ContinuityInformationCardStore,
} from './continuity-information-card';
import {
  RelationshipOpenLoopAuthorityType,
  RelationshipOpenLoopContentDomain,
  RelationshipOpenLoopDraft,
  RelationshipOpenLoopState,
  RelationshipOpenLoopStore,
  upsertRelationshipOpenLoopDraft,
} from './relationship-open-loop';

export interface LegacyContinuityMigrationResult {
  store: RelationshipOpenLoopStore;
  migratedCount: number;
  skippedCount: number;
}

export function migrateLegacyContinuityStore(options: {
  store: RelationshipOpenLoopStore;
  legacyStore?: ContinuityInformationCardStore;
  now?: Date;
}): LegacyContinuityMigrationResult {
  const now = options.now ?? new Date();
  let store = options.store;
  let migratedCount = 0;
  let skippedCount = 0;
  for (const card of options.legacyStore?.cards || []) {
    const sourceIds = [
      card.sourceMessageId,
      card.latestEvidenceMessageId,
    ].filter((value): value is string => Boolean(value));
    if (
      !sourceIds.length ||
      store.tasks.some(task =>
        task.sourceMessageIds.some(sourceId => sourceIds.includes(sourceId))
      )
    ) {
      skippedCount += 1;
      continue;
    }
    const draft = legacyCardToDraft(card);
    const result = upsertRelationshipOpenLoopDraft({
      store,
      draft,
      sourceMessageId: card.sourceMessageId,
      sourceOccurredAt: card.sourceOccurredAt,
      now,
    });
    if (!result.task || result.action === 'noop') {
      skippedCount += 1;
      continue;
    }
    const state = legacyStatusToState(card);
    store = {
      ...result.store,
      tasks: result.store.tasks.map(task =>
        task.id === result.task?.id
          ? {
              ...task,
              state,
              sourceMessageIds: Array.from(
                new Set(task.sourceMessageIds.concat(sourceIds))
              ),
              latestSourceOccurredAt:
                card.latestEvidenceAt || card.sourceOccurredAt,
              ...(card.lastOfferedAt
                ? { lastPresentedAt: card.lastOfferedAt }
                : {}),
              presentedCount: Math.max(task.presentedCount, card.offerCount),
              ...(state === 'dismissed' ? { proactiveDisabled: true } : {}),
              updatedAt: now,
            }
          : task
      ),
      updatedAt: now,
    };
    migratedCount += 1;
  }
  return { store, migratedCount, skippedCount };
}

function legacyCardToDraft(
  card: ContinuityInformationCard
): RelationshipOpenLoopDraft {
  const classification = classifyLegacyCard(card);
  return {
    summary: card.summary,
    subject: card.subject,
    contentDomain: classification.domain,
    authorityType: classification.authorityType,
    state: classification.state,
    importance: card.importance,
    ...(card.eventAt ? { dueAt: card.eventAt, relation: 'checkpoint' } : {}),
    ...(card.expiresAt ? { expiresAt: card.expiresAt } : {}),
  };
}

function classifyLegacyCard(card: ContinuityInformationCard): {
  domain: RelationshipOpenLoopContentDomain;
  authorityType: RelationshipOpenLoopAuthorityType;
  state: RelationshipOpenLoopState;
} {
  if (card.eventKind === 'health' || card.eventKind === 'family_health') {
    return {
      domain: 'health',
      authorityType: 'professional_high_stakes',
      state: card.eventAt ? 'scheduled_checkpoint' : 'reported',
    };
  }
  if (card.eventKind === 'result_pending') {
    return {
      domain: inferDomain(card.summary),
      authorityType: inferAuthority(card.summary),
      state: 'awaiting_result',
    };
  }
  if (card.eventKind === 'life_change') {
    return {
      domain: inferDomain(card.summary),
      authorityType: inferAuthority(card.summary),
      state: card.eventAt ? 'scheduled_checkpoint' : 'reported',
    };
  }
  return {
    domain:
      card.eventKind === 'future_event'
        ? 'future_event'
        : inferDomain(card.summary),
    authorityType: inferAuthority(card.summary),
    state: card.eventAt ? 'scheduled_checkpoint' : 'reported',
  };
}

function inferDomain(summary: string): RelationshipOpenLoopContentDomain {
  if (/房子|房产|财产|遗产|产权|过户|卖房|法院|律师|官司/u.test(summary)) {
    return 'property_or_legal';
  }
  if (/安葬|下葬|迁坟|墓地|骨灰|五七|百日|周年|祭扫/u.test(summary)) {
    return 'funeral_or_memorial';
  }
  if (/孩子|上学|转学|学校|幼儿园|监护/u.test(summary)) {
    return 'child_or_education';
  }
  if (/离婚|分居|复婚|家暴|断绝关系/u.test(summary)) {
    return 'relationship_conflict';
  }
  return 'other';
}

function inferAuthority(summary: string): RelationshipOpenLoopAuthorityType {
  if (
    /房子|房产|财产|遗产|产权|过户|卖房|安葬|下葬|迁坟|墓地|监护/u.test(summary)
  ) {
    return 'family_joint';
  }
  if (/法院|律师|官司/u.test(summary)) return 'professional_high_stakes';
  if (/离婚|分居|复婚|家暴|断绝关系/u.test(summary)) {
    return 'relationship_or_moral';
  }
  return 'ordinary_practical';
}

function legacyStatusToState(
  card: ContinuityInformationCard
): RelationshipOpenLoopState {
  switch (card.status) {
    case 'resolved':
      return 'resolved';
    case 'dismissed':
      return 'dismissed';
    case 'expired':
    case 'superseded':
      return 'superseded';
    default:
      return card.eventAt
        ? 'scheduled_checkpoint'
        : legacyCardToDraft(card).state;
  }
}
