import { Provide } from '@midwayjs/core';
import {
  compactReplyBubblesPreservingContent,
  inspectReplyBubbleStructure,
  ReplyBubbleStructureIssue,
} from './reply-bubble-plan';
import type { ReplyBrief } from './reply-brief.service';

@Provide()
export class ReplyPostprocessorService {
  prepareForValidation(options: {
    segments: string[];
    brief: ReplyBrief;
  }): string[] {
    const segments = compactReplyBubblesPreservingContent(options.segments);
    const closesCorrection =
      options.brief.conversationPlan?.turnClosure === 'close' &&
      (options.brief.primaryScene === 'correction' ||
        options.brief.intents.some(
          item => item.intent === 'correct_assistant'
        ));

    if (!closesCorrection || !segments.length) {
      return segments;
    }

    const result = [...segments];
    while (result.length && /[?？]\s*$/u.test(result[result.length - 1])) {
      if (result.length > 1) {
        result.pop();
        continue;
      }

      const statementEnd = Math.max(
        result[0].lastIndexOf('。'),
        result[0].lastIndexOf('！'),
        result[0].lastIndexOf('!')
      );
      if (statementEnd < 0) {
        break;
      }
      result[0] = result[0].slice(0, statementEnd + 1).trim();
    }
    return result.filter(Boolean);
  }

  renderForDelivery(segments: string[]): {
    segments: string[];
    issues: ReplyBubbleStructureIssue[];
  } {
    const inspection = inspectReplyBubbleStructure(segments);
    return {
      // FinalValidator 通过后正文不可变；这里只记录结构观测。
      segments,
      issues: inspection.issues,
    };
  }
}
