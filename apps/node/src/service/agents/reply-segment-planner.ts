import {
  ReplyScene,
  routeReplyScene,
  RouteReplySceneOptions,
} from './reply-scene-router';

export type ReplySegmentMode =
  | 'single'
  | 'soft_two'
  | 'fixed_three'
  | 'preserve_long';

export interface ReplySegmentPlan {
  scene?: ReplyScene;
  mode: ReplySegmentMode;
  maxSegments: number;
}

export interface PlanReplySegmentsOptions extends RouteReplySceneOptions {
  candidates: string[];
  sanitize: (value: string) => string;
}

const SHORT_SINGLE_SEGMENT_LIMIT = 24;
const PRESERVE_LONG_MIN_LENGTH = 45;

export function buildReplySegmentPlan(
  options: RouteReplySceneOptions
): ReplySegmentPlan {
  const route = routeReplyScene(options);
  const scene = route.primaryScene?.scene;
  const maxSegments = route.maxSegments ?? 2;

  if (scene === 'grief_crisis') {
    return { scene, mode: 'fixed_three', maxSegments: 3 };
  }

  if (scene === 'smalltalk') {
    return { scene, mode: 'single', maxSegments: 1 };
  }

  if (
    scene === 'memory_recall' ||
    scene === 'keepsake_attachment' ||
    scene === 'guilt_regret' ||
    scene === 'unfinished_promise' ||
    scene === 'comfort_request'
  ) {
    return { scene, mode: 'preserve_long', maxSegments };
  }

  return { scene, mode: 'soft_two', maxSegments };
}

export function planReplySegments(
  options: PlanReplySegmentsOptions
): string[] {
  const plan = buildReplySegmentPlan(options);
  const sanitized = options.candidates
    .map(item => options.sanitize(item))
    .filter(Boolean);

  if (!sanitized.length) {
    return [];
  }

  if (plan.mode === 'single') {
    return [mergeSegments(sanitized)];
  }

  if (plan.mode === 'fixed_three') {
    return compactSegments(sanitized, plan.maxSegments, options.sanitize);
  }

  if (sanitized.length > 1) {
    return compactSegments(sanitized, plan.maxSegments, options.sanitize);
  }

  const merged = mergeSegments(sanitized);

  if (
    plan.mode === 'preserve_long' &&
    merged.length >= PRESERVE_LONG_MIN_LENGTH
  ) {
    return [merged];
  }

  if (merged.length <= SHORT_SINGLE_SEGMENT_LIMIT) {
    return [merged];
  }

  return compactSegments(
    splitIntoSentences(merged),
    plan.maxSegments,
    options.sanitize
  );
}

function compactSegments(
  segments: string[],
  maxSegments: number,
  sanitize: (value: string) => string
): string[] {
  const limit = Math.max(1, maxSegments);
  const cleaned = segments.map(item => sanitize(item)).filter(Boolean);

  if (cleaned.length <= limit) {
    return cleaned;
  }

  if (limit === 1) {
    return [mergeSegments(cleaned)];
  }

  const result = cleaned.slice(0, limit - 1);
  result.push(mergeSegments(cleaned.slice(limit - 1)));

  return result.map(item => sanitize(item)).filter(Boolean);
}

function splitIntoSentences(value: string): string[] {
  const content = value.trim();

  if (!content) {
    return [];
  }

  const matches = content.match(/[^。！？!?]+[。！？!?]?/g) || [content];

  return matches.map(item => item.trim()).filter(Boolean);
}

function mergeSegments(segments: string[]): string {
  return segments
    .map(item => item.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([，。！？、；：])/g, '$1')
    .replace(/([，。！？、；：])\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
