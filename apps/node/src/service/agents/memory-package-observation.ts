import { BSON } from 'mongodb';
import {
  ReplyMemoryObservation,
  ReplyMemoryPackageDetail,
  ReplyMemorySkipReason,
} from '@tzl/entities';
import { MemoryModuleSelection } from '../memory/memory-module.service';

export const MEMORY_OBSERVATION_MAX_BYTES = 1024;
export const MEMORY_DETAIL_MAX_BYTES = 256;
export const MEMORY_DETAIL_MAX_COUNT = 4;

export function beginMemoryObservation(
  selection?: MemoryModuleSelection,
  otherwise: ReplyMemorySkipReason = 'gate_suppressed'
): ReplyMemoryObservation {
  return {
    ...(selection
      ? {
          replyMemoryModuleConfiguredMode:
            selection.configuredMode ?? selection.mode,
          replyMemoryModuleMode: selection.mode,
          ...(selection.scopeMatched === undefined
            ? {}
            : { replyMemoryScopeMatched: selection.scopeMatched }),
        }
      : {}),
    replyMemoryExecutionStatus: 'not_run',
    replyMemorySkipReason: !selection
      ? 'service_unavailable'
      : selection.configuredMode &&
        selection.configuredMode !== 'off' &&
        selection.scopeMatched === false
      ? 'scope_missed'
      : selection.mode === 'off'
      ? 'module_off'
      : otherwise,
    replyMemoryPackageInjected: false,
    replyMemoryLegacyFallback: false,
    replyMemoryPackageDetails: [],
    replyMemoryPackageDetailsTruncated: false,
  };
}

/** Only cap already-computed metadata. Never recall, select, render or read config here. */
export function boundMemoryObservation(
  snapshot: ReplyMemoryObservation
): ReplyMemoryObservation {
  const result = {
    ...snapshot,
    replyMemoryPackageDetails: [] as ReplyMemoryPackageDetail[],
  };
  // Actual injections are retained ahead of unselected candidates when the envelope is full.
  const ordered = [...snapshot.replyMemoryPackageDetails].sort(
    (a, b) => Number(b.stage === 'injected') - Number(a.stage === 'injected')
  );
  for (const detail of ordered) {
    if (
      result.replyMemoryPackageDetails.length >= MEMORY_DETAIL_MAX_COUNT ||
      BSON.calculateObjectSize(detail) > MEMORY_DETAIL_MAX_BYTES
    ) {
      result.replyMemoryPackageDetailsTruncated = true;
      continue;
    }
    result.replyMemoryPackageDetails.push(detail);
    if (BSON.calculateObjectSize(result) > MEMORY_OBSERVATION_MAX_BYTES) {
      result.replyMemoryPackageDetails.pop();
      result.replyMemoryPackageDetailsTruncated = true;
    }
  }
  return result;
}
