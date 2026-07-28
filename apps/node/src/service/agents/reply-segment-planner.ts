import {
  ReplySceneRoute,
  ReplyScene,
  routeReplyScene,
  RouteReplySceneOptions,
} from './reply-scene-router';
import type { ReplyBrief } from './reply-brief.service';

export type ReplySegmentMode =
  | 'single'
  | 'soft_two'
  | 'natural_turns'
  | 'fixed_three'
  | 'preserve_long';

export interface ReplySegmentPlan {
  scene?: ReplyScene;
  mode: ReplySegmentMode;
  minSegments: number;
  preferredSegments: number;
  maxSegments: number;
}

export interface PlanReplySegmentsOptions extends RouteReplySceneOptions {
  candidates: string[];
  sanitize: (value: string) => string;
  route?: ReplySceneRoute;
  brief?: ReplyBrief;
}

const SHORT_SINGLE_SEGMENT_LIMIT = 24;
const PRESERVE_LONG_MIN_LENGTH = 45;
const COMPLETE_SHORT_REPLY_ACT_PATTERN =
  /^(?:是的|是啊|对|对的|可以|行|好|好啊|记得|记得啊|会的|不会|有|没有|能|不能|愿意|不愿意|知道了|明白了)[，,。！？!?]?$/;

export function buildReplySegmentPlan(
  options: RouteReplySceneOptions
): ReplySegmentPlan {
  return buildReplySegmentPlanFromRoute(routeReplyScene(options));
}

export function planReplySegments(options: PlanReplySegmentsOptions): string[] {
  const plan = options.brief
    ? buildReplySegmentPlanFromBrief(options.brief, options.route)
    : buildReplySegmentPlanFromRoute(options.route ?? routeReplyScene(options));
  const sanitized = options.candidates
    .map(item => options.sanitize(item))
    .filter(Boolean);

  if (!sanitized.length) {
    return [];
  }

  if (plan.mode === 'single') {
    return [mergeSegments(sanitized)];
  }

  const compacted = compactSegments(
    sanitized,
    plan.maxSegments,
    options.sanitize
  );

  if (compacted.length >= plan.minSegments) {
    return compacted;
  }

  const merged = mergeSegments(sanitized);

  if (
    plan.mode === 'preserve_long' &&
    merged.length >= PRESERVE_LONG_MIN_LENGTH
  ) {
    return [merged];
  }

  const naturalTurns = splitIntoNaturalTurns(merged, plan.minSegments);

  if (naturalTurns.length >= plan.minSegments) {
    return compactSegments(
      naturalTurns,
      plan.preferredSegments,
      options.sanitize
    );
  }

  if (merged.length <= SHORT_SINGLE_SEGMENT_LIMIT) {
    return compacted;
  }

  return compacted;
}

function buildReplySegmentPlanFromBrief(
  brief: ReplyBrief,
  route?: ReplySceneRoute
): ReplySegmentPlan {
  const bubblePlan = brief.bubblePlan;

  return {
    scene: route?.primaryScene?.scene,
    mode:
      bubblePlan.maxSegments === 1
        ? 'single'
        : brief.mode === 'safety'
        ? 'fixed_three'
        : 'natural_turns',
    minSegments: bubblePlan.minSegments,
    preferredSegments: bubblePlan.preferredSegments,
    maxSegments: bubblePlan.maxSegments,
  };
}

function buildReplySegmentPlanFromRoute(
  route: ReplySceneRoute
): ReplySegmentPlan {
  const scene = route.primaryScene?.scene;
  const maxSegments = route.maxSegments ?? 2;
  const bubblePlan = route.bubblePlan;

  if (bubblePlan) {
    return {
      scene,
      mode:
        bubblePlan.maxSegments === 1
          ? 'single'
          : scene === 'grief_crisis'
          ? 'fixed_three'
          : 'natural_turns',
      minSegments: bubblePlan.minSegments,
      preferredSegments: bubblePlan.preferredSegments,
      maxSegments: bubblePlan.maxSegments,
    };
  }

  if (scene === 'grief_crisis') {
    return {
      scene,
      mode: 'fixed_three',
      minSegments: 3,
      preferredSegments: 3,
      maxSegments: 3,
    };
  }

  const responseIntentCount = route.responseIntents?.length ?? 0;

  if (responseIntentCount > 0) {
    const count = Math.min(responseIntentCount, 3);

    return {
      scene,
      mode: 'natural_turns',
      minSegments: count,
      preferredSegments: count,
      maxSegments: count,
    };
  }

  if (scene === 'smalltalk') {
    return {
      scene,
      mode: 'single',
      minSegments: 1,
      preferredSegments: 1,
      maxSegments: 1,
    };
  }

  if (
    scene === 'memory_recall' ||
    scene === 'keepsake_attachment' ||
    scene === 'guilt_regret' ||
    scene === 'unfinished_promise' ||
    scene === 'comfort_request'
  ) {
    return {
      scene,
      mode: 'preserve_long',
      minSegments: 1,
      preferredSegments: maxSegments,
      maxSegments,
    };
  }

  return {
    scene,
    mode: 'soft_two',
    minSegments: 1,
    preferredSegments: maxSegments,
    maxSegments,
  };
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

function splitIntoNaturalTurns(value: string, minSegments: number): string[] {
  const sentences = splitIntoSentences(value);

  if (sentences.length >= minSegments) {
    return sentences;
  }

  const clauses = value
    .split(/(?<=[，,；;])\s*/)
    .map(item => item.trim())
    .filter(Boolean);

  if (
    clauses.length >= minSegments &&
    clauses.every(item => {
      const clause = item.replace(/[，,；;]$/, '').trim();

      return (
        clause.length >= 6 || COMPLETE_SHORT_REPLY_ACT_PATTERN.test(clause)
      );
    })
  ) {
    return clauses.map(item => item.replace(/[，,；;]$/, '').trim());
  }

  return sentences;
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
