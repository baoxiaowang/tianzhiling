import type { MessageEntity } from '@tzl/entities';
import {
  buildEmptyRelationshipOpenLoopStore,
  expireRelationshipOpenLoops,
  reconcileRelationshipOpenLoopContextualUpdate,
  RelationshipOpenLoopStore,
  resolveRelationshipOpenLoopFromUserText,
  upsertRelationshipOpenLoopDraft,
} from './relationship-open-loop';
import { extractRelationshipOpenLoop } from './relationship-open-loop-extractor';

export interface RelationshipOpenLoopRevalidationInput {
  message: Pick<MessageEntity, 'id' | 'createdAt' | 'sourceOccurredAt'>;
  text: string;
}

export interface RelationshipOpenLoopRevalidationResult {
  store: RelationshipOpenLoopStore;
  generatedTaskCount: number;
  revalidatedTaskCount: number;
  removedTaskCount: number;
}

/**
 * Rebuilds derived task state only from sources that still pass the current
 * high-confidence extractor. Old broad cards are evidence inputs, never
 * grandfathered tasks. Delivery tracking is restored only for a task that
 * survives revalidation by semantic key or source identity.
 */
export function revalidateRelationshipOpenLoopStore(options: {
  previousStore: RelationshipOpenLoopStore;
  inputs: RelationshipOpenLoopRevalidationInput[];
  now?: Date;
}): RelationshipOpenLoopRevalidationResult {
  const now = options.now ?? new Date();
  const scannedSourceMessageIds = new Set(
    options.inputs
      .map(item => stringifyObjectId(item.message.id))
      .filter(Boolean)
  );
  let store = buildEmptyRelationshipOpenLoopStore(now);
  store.legacyContinuityMigratedAt = now;
  let generatedTaskCount = 0;

  for (const item of options.inputs) {
    const sourceMessageId = stringifyObjectId(item.message.id);
    const extraction = extractRelationshipOpenLoop({
      message: item.message,
      text: item.text,
      now,
    });
    const mutation =
      extraction.decision === 'lifecycle_only'
        ? resolveRelationshipOpenLoopFromUserText({
            store,
            text: item.text,
            sourceMessageId,
            occurredAt: extraction.sourceOccurredAt,
            now,
          })
        : extraction.decision === 'not_eligible' &&
          /(?:挺严重|很严重|比较严重|病危|进了?ICU|要手术|需要手术)/u.test(
            item.text
          )
        ? reconcileRelationshipOpenLoopContextualUpdate({
            store,
            text: item.text,
            sourceMessageId,
            occurredAt: extraction.sourceOccurredAt,
            now,
          })
        : extraction.draft
        ? upsertRelationshipOpenLoopDraft({
            store,
            draft: extraction.draft,
            sourceMessageId,
            sourceOccurredAt: extraction.sourceOccurredAt,
            now,
          })
        : undefined;
    if (!mutation || mutation.action === 'noop') continue;
    store = mutation.store;
    if (
      mutation.action === 'created_root' ||
      mutation.action === 'created_child'
    ) {
      generatedTaskCount += 1;
    }
  }

  store = expireRelationshipOpenLoops(
    preserveUnscannedPreviousTasks(
      options.previousStore,
      restoreValidatedTaskTracking(options.previousStore, store, now),
      scannedSourceMessageIds
    ),
    now
  );
  const retainedPreviousTaskCount = options.previousStore.tasks.filter(task =>
    store.tasks.some(candidate => tasksRepresentSameSource(task, candidate))
  ).length;
  return {
    store,
    generatedTaskCount,
    revalidatedTaskCount: store.tasks.length,
    removedTaskCount: Math.max(
      0,
      options.previousStore.tasks.length - retainedPreviousTaskCount
    ),
  };
}

/**
 * A rolling revalidation window may judge only sources it actually loaded.
 * Long-lived commitments and unresolved matters whose evidence is outside the
 * window remain intact until their source is deliberately re-read.
 */
function preserveUnscannedPreviousTasks(
  previous: RelationshipOpenLoopStore,
  rebuilt: RelationshipOpenLoopStore,
  scannedSourceMessageIds: Set<string>
): RelationshipOpenLoopStore {
  const preserved = previous.tasks.filter(task => {
    if (!task.sourceMessageIds.some(id => !scannedSourceMessageIds.has(id))) {
      return false;
    }
    return !rebuilt.tasks.some(candidate =>
      tasksRepresentSameSource(task, candidate)
    );
  });
  if (!preserved.length) return rebuilt;
  return {
    ...rebuilt,
    tasks: [...rebuilt.tasks, ...preserved],
  };
}

function tasksRepresentSameSource(
  left: RelationshipOpenLoopStore['tasks'][number],
  right: RelationshipOpenLoopStore['tasks'][number]
): boolean {
  return (
    left.id === right.id ||
    left.semanticKey === right.semanticKey ||
    left.sourceMessageIds.some(id => right.sourceMessageIds.includes(id))
  );
}

function restoreValidatedTaskTracking(
  previous: RelationshipOpenLoopStore,
  rebuilt: RelationshipOpenLoopStore,
  now: Date
): RelationshipOpenLoopStore {
  return {
    ...rebuilt,
    tasks: rebuilt.tasks.map(task => {
      const previousTask = previous.tasks.find(item =>
        tasksRepresentSameSource(item, task)
      );
      if (!previousTask) return task;
      return {
        ...task,
        createdAt: previousTask.createdAt,
        lastPresentedAt: previousTask.lastPresentedAt,
        lastMentionedAt: previousTask.lastMentionedAt,
        lastNotObservedAt: previousTask.lastNotObservedAt,
        lastObservationUnknownAt: previousTask.lastObservationUnknownAt,
        presentedCount: previousTask.presentedCount,
        mentionedCount: previousTask.mentionedCount,
        proactiveSuppressedUntil: previousTask.proactiveSuppressedUntil,
        proactiveDisabled: previousTask.proactiveDisabled,
        updatedAt: now,
      };
    }),
    legacyContinuityMigratedAt: now,
    updatedAt: now,
  };
}

function stringifyObjectId(value: unknown): string {
  if (!value) return '';
  return typeof (value as { toHexString?: () => string }).toHexString ===
    'function'
    ? (value as { toHexString: () => string }).toHexString()
    : String(value);
}
