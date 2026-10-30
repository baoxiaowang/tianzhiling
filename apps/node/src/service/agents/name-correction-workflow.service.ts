import { Inject, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { MongoRepository } from 'typeorm';
import {
  MessageEntity,
  MessageRole,
  MongoObjectId,
  UserKnownPersonEntity,
  UserKnownPersonStatus,
} from '@tzl/entities';
import { OpenAIService } from './openai';
import { PersonAddressService } from './person-address.service';

export interface NameCorrectionWorkflowResult {
  applied: boolean;
  skipped?: string;
  personId?: string;
  wrongNames?: string[];
  correctNames?: string[];
  confidence?: number;
  needsClarification?: boolean;
}

interface NameCorrectionProposal {
  highAlert?: boolean;
  needsClarification?: boolean;
  personId?: string;
  wrongNames?: string[];
  correctNames?: string[];
  allowedNames?: string[];
  confidence?: number;
  reason?: string;
}

/**
 * 只在“用户高警戒地纠正称呼”时启动的窄工作流。
 * 候选门只是省调用，不负责理解；是否纠正、纠正谁、哪个名字，全部由 LLM 提案。
 */
const CANDIDATE_GATE =
  /(?:叫错|记错|不是.*(?:叫|是)|说(?:了)?.*次|又.*叫|名字.*(?:错|不对)|称呼.*(?:错|不对)|记不住|不是这个名字|你叫的?)/u;

const SYSTEM_PROMPT = [
  '你是“称呼纠正工作流”，只判断用户是否在高警戒地纠正 AI 对某人的称呼，并输出结构化结果。',
  '不要生成聊天回复，不要输出解释，只输出 JSON。',
  '只有用户明确表达“AI 叫错了/不是这个名字/我说过多少次”时 highAlert 才为 true；普通提及、玩笑、疑问不算。',
  'wrongNames 是 AI 用错的叫法；correctNames 是用户明确要求的正确叫法；allowedNames 是用户说“也可以叫”的有效别名。',
  '人物可以有多个名字：不要把用户确认的有效别名放进 wrongNames。',
  '用户只说“叫错了”但没给正确名字时 needsClarification=true，不要猜。',
  'personId 只能从候选人物里选；不确定就留空。',
  '输出 JSON：{"highAlert":false,"needsClarification":false,"personId":"","wrongNames":[],"correctNames":[],"allowedNames":[],"confidence":0,"reason":""}',
].join('\n');

export function isNameCorrectionCandidate(text: string): boolean {
  return CANDIDATE_GATE.test((text || '').trim());
}

@Provide()
export class NameCorrectionWorkflowService {
  @Logger()
  logger: ILogger;

  @Inject()
  openAIService: OpenAIService;

  @Inject()
  personAddressService: PersonAddressService;

  @InjectEntityModel(UserKnownPersonEntity)
  knownPersonModel: MongoRepository<UserKnownPersonEntity>;

  @InjectEntityModel(MessageEntity)
  messageModel: MongoRepository<MessageEntity>;

  async maybeApply(options: {
    userId: MongoObjectId;
    conversationId: MongoObjectId;
    currentText: string;
    currentMessageId?: MongoObjectId;
  }): Promise<NameCorrectionWorkflowResult> {
    const text = (options.currentText || '').trim();
    if (!text || !isNameCorrectionCandidate(text)) {
      return { applied: false, skipped: 'candidate_gate' };
    }
    if (!this.openAIService?.isEnabled?.()) {
      return { applied: false, skipped: 'openai_disabled' };
    }

    try {
      const [people, recentMessages] = await Promise.all([
        this.knownPersonModel.find({
          where: {
            userId: options.userId,
            status: UserKnownPersonStatus.active,
          } as never,
          take: 20,
        }),
        this.messageModel.find({
          where: {
            conversationId: options.conversationId,
          } as never,
          order: { createdAt: 'DESC' },
          take: 12,
        }),
      ]);
      if (!people.length) return { applied: false, skipped: 'no_people' };

      const peoplePayload = people.map(person => ({
        id: `person:${String(person.id)}`,
        relationToUser: person.relationToUser || '',
        preferredName: person.preferredName || '',
        realName: person.realName || '',
        aliases: person.aliases || [],
      }));
      const history = [...recentMessages]
        .reverse()
        .filter(message => (message.content || '').trim())
        .map(message => ({
          role: message.role === MessageRole.user ? '用户' : '助手',
          content: (message.content || '').slice(0, 280),
        }));

      const result = await this.openAIService.generateText({
        systemPrompt: SYSTEM_PROMPT,
        prompt: [
          `候选人物：${JSON.stringify(peoplePayload)}`,
          `最近对话：${JSON.stringify(history)}`,
          `用户刚刚说：${text.slice(0, 500)}`,
        ].join('\n'),
        temperature: 0,
        topP: 0.1,
        maxTokens: 500,
        reasoningSplit: false,
      });
      const proposal = this.parseProposal(result?.content || '');
      if (!proposal) return { applied: false, skipped: 'invalid_json' };

      const wrongNames = this.cleanNames(proposal.wrongNames);
      const correctNames = this.cleanNames(proposal.correctNames);
      const allowedNames = this.cleanNames(proposal.allowedNames);
      const confidence = Number(proposal.confidence) || 0;
      if (
        !proposal.highAlert ||
        proposal.needsClarification ||
        confidence < 0.7 ||
        !correctNames.length
      ) {
        this.logger?.info?.(
          '[name-correction] skipped, userId=%s highAlert=%s clarify=%s confidence=%s correct=%s reason=%s',
          String(options.userId),
          Boolean(proposal.highAlert),
          Boolean(proposal.needsClarification),
          confidence,
          correctNames.join('|') || '-',
          proposal.reason || '-'
        );
        return {
          applied: false,
          skipped: proposal.needsClarification
            ? 'needs_clarification'
            : 'low_confidence',
          correctNames,
          confidence,
          needsClarification: Boolean(proposal.needsClarification),
        };
      }

      const target = this.resolveTarget(people, proposal, wrongNames, correctNames);
      if (!target) {
        this.logger?.info?.(
          '[name-correction] target ambiguous, userId=%s personId=%s wrong=%s correct=%s',
          String(options.userId),
          proposal.personId || '-',
          wrongNames.join('|') || '-',
          correctNames.join('|') || '-'
        );
        return { applied: false, skipped: 'target_ambiguous' };
      }

      const applied = await this.personAddressService.applyStructuredNameCorrection({
        userId: options.userId,
        personId: target.id,
        preferredName: correctNames[0],
        allowedNames: Array.from(new Set([...allowedNames, ...correctNames.slice(1)])),
        rejectedNames: wrongNames,
      });
      this.logger?.info?.(
        '[name-correction] applied, userId=%s personId=%s preferred=%s allowed=%s rejected=%s confidence=%s',
        String(options.userId),
        String(target.id),
        correctNames[0],
        allowedNames.join('|') || '-',
        wrongNames.join('|') || '-',
        confidence
      );
      return {
        applied,
        skipped: applied ? undefined : 'write_failed',
        personId: String(target.id),
        wrongNames,
        correctNames,
        confidence,
        needsClarification: false,
      };
    } catch (error) {
      this.logger?.warn?.(
        '[name-correction] workflow failed, userId=%s reason=%s',
        String(options.userId),
        error instanceof Error ? error.message : String(error)
      );
      return { applied: false, skipped: 'workflow_error' };
    }
  }

  private resolveTarget(
    people: UserKnownPersonEntity[],
    proposal: NameCorrectionProposal,
    wrongNames: string[],
    correctNames: string[]
  ): UserKnownPersonEntity | undefined {
    const rawPersonId = (proposal.personId || '').replace(/^person:/, '');
    const byId = rawPersonId
      ? people.find(person => String(person.id) === rawPersonId)
      : undefined;
    if (byId) return byId;

    const names = new Set([...wrongNames, ...correctNames].map(name => normalizeName(name)));
    const matches = people.filter(person =>
      [person.preferredName, person.realName, ...(person.aliases || [])]
        .filter(Boolean)
        .some(name => names.has(normalizeName(name as string)))
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  private cleanNames(value?: string[]): string[] {
    if (!Array.isArray(value)) return [];
    return Array.from(
      new Set(
        value
          .map(name => normalizeName(name))
          .filter(name => name.length >= 1 && name.length <= 24)
      )
    );
  }

  private parseProposal(raw: string): NameCorrectionProposal | null {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1)) as NameCorrectionProposal;
    } catch {
      return null;
    }
  }
}

function normalizeName(value: string): string {
  return (value || '').replace(/[，,。！？!?；;：:、\s"'“”‘’]/g, '').trim();
}
