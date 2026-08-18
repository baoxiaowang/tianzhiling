import { Provide } from '@midwayjs/core';
import {
  compactReplyBubblesPreservingContent,
  inspectReplyBubbleStructure,
  ReplyBubbleStructureIssue,
  splitReplyContentForDelivery,
} from './reply-bubble-plan';
import type { ReplyBrief } from './reply-brief.service';

@Provide()
export class ReplyPostprocessorService {
  prepareForValidation(options: {
    segments: string[];
    brief: ReplyBrief;
  }): string[] {
    // 进入治理前只做结构清理，不根据程序推断的“纠正/收尾”删除模型正文。
    // 是否提问属于内容策略；普通质量问题只记录，不在发送前静默改写语义。
    void options.brief;
    return compactReplyBubblesPreservingContent(options.segments);
  }

  renderForDelivery(segments: string[]): {
    segments: string[];
    issues: ReplyBubbleStructureIssue[];
  } {
    const deliverySegments = splitReplyContentForDelivery(segments);
    const inspection = inspectReplyBubbleStructure(deliverySegments);
    return {
      // FinalValidator 通过后正文不可变；这里只移动自然语义边界以适配展示。
      segments: deliverySegments,
      issues: inspection.issues,
    };
  }
}
