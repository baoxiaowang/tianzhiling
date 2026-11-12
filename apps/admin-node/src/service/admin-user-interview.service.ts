import { Inject, Logger, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { ILogger } from '@midwayjs/logger';
import { ObjectId } from 'mongodb';
import { MongoRepository } from 'typeorm';
import { UserInterviewAnswer, UserInterviewEntity } from '@tzl/entities';
import { AppError } from '@tzl/shared';
import {
  CreateUserInterviewDTO,
  ExtractInterviewDocxDTO,
  UpdateUserInterviewDTO,
} from '../dto/admin-user-interview.dto';
import { AdminLlmService } from './admin-llm.service';
import { inflateRawSync } from 'zlib';

/** 访谈大纲（与运营提供的《付费用户电话访谈 提问大纲》一致）。 */
export const USER_INTERVIEW_OUTLINE: Array<{ no: number; question: string }> = [
  { no: 1, question: '你的年龄？' },
  { no: 2, question: '你的聊天对象？' },
  { no: 3, question: 'ta 离世的原因？' },
  { no: 4, question: 'ta 离世了多久？' },
  { no: 5, question: '用天之灵产品有多久？' },
  { no: 6, question: '是否打算长期使用？' },
  { no: 7, question: '哪里触动？' },
  { no: 8, question: '哪里出戏？' },
  { no: 9, question: '改进建议与想法。' },
  { no: 10, question: '刷到天之灵产品的节点？（日常 or 节日）' },
  {
    no: 11,
    question: '什么时候用得最多？（一天内的时段 / 某个阶段）',
  },
  { no: 12, question: '那个瞬间付了费？' },
  { no: 13, question: '对功能都了解吗？用过哪些。' },
  { no: 14, question: '用过小使者功能吗？知道它是做什么的吗？' },
  { no: 15, question: '你觉得它的形象如何？它的回复你满意吗？' },
  { no: 16, question: '有无主动聊起过自己使用 AI 对话亲人的经历？' },
  { no: 17, question: '是否会推荐？' },
  { no: 18, question: '觉得对方会是什么反应。（反应预测）' },
  { no: 19, question: '「激励机制」与「主动分享」之间的关系？' },
  { no: 20, question: '对礼物寄送的场景模拟是否感兴趣？' },
  {
    no: 21,
    question: '主动收到亲人消息的意愿（什么场景、什么方式、什么频率？）',
  },
  { no: 22, question: '对社区动态的感受。' },
  { no: 23, question: '什么情况下会发动态？' },
  { no: 24, question: '是否愿意分享 ta 的故事，让更多人了解到？' },
  { no: 25, question: '真人采访 or AI 故事改编。' },
];

/** 表单分组（仅前端展示用，按大纲题号顺序切分）。 */
export const USER_INTERVIEW_SECTIONS: Array<{
  title: string;
  from: number;
  to: number;
}> = [
  { title: '基本信息', from: 1, to: 4 },
  { title: '使用情况', from: 5, to: 6 },
  { title: '触动与建议', from: 7, to: 9 },
  { title: '获取与付费', from: 10, to: 13 },
  { title: '小使者', from: 14, to: 15 },
  { title: '分享与推荐', from: 16, to: 19 },
  { title: '主动触达与礼物', from: 20, to: 21 },
  { title: '社区与故事分享', from: 22, to: 25 },
];

const MAX_TRANSCRIPT_CHARS = 200000;
const MAX_DOCX_BYTES = 20 * 1024 * 1024;
const MAX_LLM_INPUT_CHARS = 120000;

interface RawAnswer {
  no?: number | string;
  question?: string;
  answer?: string;
  quotes?: unknown;
}

@Provide()
export class AdminUserInterviewService {
  @InjectEntityModel(UserInterviewEntity)
  interviewRepo: MongoRepository<UserInterviewEntity>;

  @Inject()
  adminLlmService: AdminLlmService;

  @Logger()
  logger: ILogger;

  async listByUser(userId: string) {
    const items = await this.interviewRepo.find({
      where: { userId: new ObjectId(userId) } as never,
      order: { interviewDate: 'DESC', createdAt: 'DESC' } as never,
    });
    return items.map(item => this.toRecord(item));
  }

  async create(dto: CreateUserInterviewDTO) {
    const transcript = this.normalizeTranscript(dto.transcript);
    const now = new Date();
    const interviewDate = dto.interviewDate || this.formatDate(now);
    const entity = this.interviewRepo.create({
      userId: new ObjectId(dto.userId),
      title: dto.title?.trim() || `${interviewDate} 用户访谈`,
      interviewDate,
      transcript,
      transcriptFileName: dto.transcriptFileName?.trim() || undefined,
      answers: [],
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    } as never);
    const saved = await this.interviewRepo.save(entity as never);
    return this.toRecord(saved as unknown as UserInterviewEntity);
  }

  async update(id: string, dto: UpdateUserInterviewDTO) {
    const entity = await this.getEntity(id);
    if (dto.title !== undefined) {
      entity.title = dto.title.trim();
    }
    if (dto.interviewDate !== undefined) {
      entity.interviewDate = dto.interviewDate.trim();
    }
    if (dto.transcript !== undefined) {
      entity.transcript = this.normalizeTranscript(dto.transcript);
    }
    if (dto.answers !== undefined) {
      entity.answers = this.normalizeAnswers(
        dto.answers,
        USER_INTERVIEW_OUTLINE
      );
    }
    entity.updatedAt = new Date();
    const saved = await this.interviewRepo.save(entity as never);
    return this.toRecord(saved as unknown as UserInterviewEntity);
  }

  async remove(id: string) {
    const entity = await this.getEntity(id);
    await this.interviewRepo.remove(entity as never);
    return { id, deleted: true };
  }

  /** 调 LLM 按大纲整理逐字稿 → 结构化表单。 */
  async structure(id: string) {
    const entity = await this.getEntity(id);
    const transcript = entity.transcript?.trim();

    if (!transcript) {
      throw new AppError(
        'INTERVIEW_TRANSCRIPT_EMPTY',
        '逐字稿为空，无法整理',
        400
      );
    }

    const prompt = this.buildStructurePrompt(transcript);
    const raw = await this.adminLlmService.generateText(prompt, {
      systemPrompt:
        '你是用户研究助手。只根据逐字稿原文回答，不臆测、不补充常识；' +
        '逐字稿没提到的题目，answer 写「未提及」。输出必须是 JSON。',
      temperature: 0,
      maxTokens: 8000,
      responseFormat: 'json_object',
    });

    if (!raw) {
      entity.lastError = 'LLM 未返回内容（模型未配置或调用失败）';
      entity.updatedAt = new Date();
      await this.interviewRepo.save(entity as never);
      throw new AppError(
        'INTERVIEW_LLM_FAILED',
        'AI 整理失败：模型未返回内容，请检查后台 LLM 配置后重试',
        502
      );
    }

    let parsed: unknown;
    try {
      parsed = this.parseJsonLoose(raw);
    } catch (error) {
      entity.lastError = `LLM 返回不是合法 JSON：${String(
        (error as Error)?.message || error
      ).slice(0, 300)}`;
      entity.updatedAt = new Date();
      await this.interviewRepo.save(entity as never);
      throw new AppError(
        'INTERVIEW_LLM_BAD_JSON',
        'AI 返回格式异常，请重试',
        502
      );
    }

    const rawAnswers = Array.isArray((parsed as { answers?: unknown })?.answers)
      ? ((parsed as { answers: RawAnswer[] }).answers as RawAnswer[])
      : Array.isArray(parsed)
      ? (parsed as RawAnswer[])
      : [];

    const answers = this.normalizeAnswers(
      rawAnswers.map(item => ({ ...item })),
      USER_INTERVIEW_OUTLINE
    );

    entity.answers = answers;
    entity.status = 'structured';
    entity.model = this.adminLlmService.currentModel() || undefined;
    entity.structuredAt = new Date();
    entity.lastError = undefined;
    entity.updatedAt = new Date();
    await this.interviewRepo.save(entity as never);

    return this.toRecord(entity);
  }

  /** docx 逐字稿转纯文本（不引入第三方库，直接解析 zip + document.xml）。 */
  async extractDocx(dto: ExtractInterviewDocxDTO) {
    const buffer = Buffer.from(
      (dto.base64 || '').replace(/^data:[^;]+;base64,/, ''),
      'base64'
    );

    if (!buffer.length) {
      throw new AppError('INTERVIEW_DOCX_EMPTY', '文件为空', 400);
    }
    if (buffer.length > MAX_DOCX_BYTES) {
      throw new AppError('INTERVIEW_DOCX_TOO_LARGE', '文件超过 20MB', 400);
    }

    const xml = this.readZipEntry(buffer, 'word/document.xml');
    if (!xml) {
      throw new AppError(
        'INTERVIEW_DOCX_INVALID',
        '无法解析 docx，请确认文件格式或改用 txt',
        400
      );
    }

    const text = this.extractDocxText(xml.toString('utf8'));
    if (!text.trim()) {
      throw new AppError('INTERVIEW_DOCX_NO_TEXT', 'docx 中没有可用文字', 400);
    }

    return {
      fileName: dto.fileName?.trim() || '',
      chars: text.length,
      text: text.slice(0, MAX_TRANSCRIPT_CHARS),
    };
  }

  buildStructurePrompt(transcript: string) {
    const outline = USER_INTERVIEW_OUTLINE.map(
      item => `${item.no}. ${item.question}`
    ).join('\n');
    const clipped =
      transcript.length > MAX_LLM_INPUT_CHARS
        ? `${transcript.slice(0, MAX_LLM_INPUT_CHARS)}\n（逐字稿过长，已截断）`
        : transcript;

    return [
      '下面是《付费用户电话访谈 提问大纲》和一份访谈逐字稿。',
      '请按大纲题号逐题整理访谈对象在逐字稿中的回答。',
      '',
      '要求：',
      '1. 只写逐字稿里明确说过的内容，不要推断、不要编造；',
      '2. 每题的 answer 用 1~3 句话概括，尽量保留原话中的关键措辞；',
      '3. 逐字稿没有涉及的题目，answer 填「未提及」；',
      '4. quotes 填 1~3 条能支撑该答案的原话（逐字稿原文，可截取），没有就留空数组；',
      '5. 只输出 JSON，不要 markdown 代码块，格式：',
      '{"answers":[{"no":1,"question":"...","answer":"...","quotes":["..."]}]}',
      '6. answers 必须包含 1~25 全部题号。',
      '',
      '【大纲】',
      outline,
      '',
      '【逐字稿】',
      clipped,
    ].join('\n');
  }

  private normalizeTranscript(value: string) {
    const text = (value || '')
      .replace(/\r\n/g, '\n')
      .split(String.fromCharCode(0))
      .join('')
      .trim();
    return text.slice(0, MAX_TRANSCRIPT_CHARS);
  }

  private normalizeAnswers(
    rawAnswers: Array<Record<string, unknown>>,
    outline: Array<{ no: number; question: string }>
  ): UserInterviewAnswer[] {
    const byNo = new Map<number, UserInterviewAnswer>();

    for (const item of rawAnswers) {
      const no = this.toQuestionNo(item.no);
      if (!no || no < 1 || no > outline.length) continue;
      const question =
        `${item.question || ''}`.trim() ||
        outline.find(entry => entry.no === no)?.question ||
        '';
      const answer = `${item.answer ?? ''}`.trim();
      const quotes = Array.isArray(item.quotes)
        ? item.quotes
            .map(quote => `${quote ?? ''}`.trim())
            .filter(Boolean)
            .slice(0, 5)
        : [];
      byNo.set(no, { no, question, answer, quotes });
    }

    return outline.map(entry => {
      const existing = byNo.get(entry.no);
      return {
        no: entry.no,
        question: existing?.question || entry.question,
        answer: existing?.answer || '未提及',
        quotes: existing?.quotes?.length ? existing.quotes : undefined,
      };
    });
  }

  private toQuestionNo(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    const match = `${value ?? ''}`.match(/\d+/);
    return match ? Number(match[0]) : null;
  }

  private parseJsonLoose(raw: string): unknown {
    const text = raw.trim();
    const withoutFence = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    try {
      return JSON.parse(withoutFence);
    } catch {
      const start = withoutFence.indexOf('{');
      const end = withoutFence.lastIndexOf('}');
      if (start >= 0 && end > start) {
        return JSON.parse(withoutFence.slice(start, end + 1));
      }
      throw new Error('no json object found');
    }
  }

  private async getEntity(id: string) {
    if (!ObjectId.isValid(id)) {
      throw new AppError('INTERVIEW_NOT_FOUND', '访谈记录不存在', 404);
    }
    const entity = await this.interviewRepo.findOne({
      where: { _id: new ObjectId(id) } as never,
    });
    if (!entity) {
      throw new AppError('INTERVIEW_NOT_FOUND', '访谈记录不存在', 404);
    }
    return entity;
  }

  /** 读取 zip 中的一个文件（仅支持 store/deflate，docx 足够用）。 */
  private readZipEntry(buffer: Buffer, wantedName: string): Buffer | null {
    const eocdOffset = this.findEndOfCentralDirectory(buffer);
    if (eocdOffset < 0) return null;

    const entryCount = buffer.readUInt16LE(eocdOffset + 10);
    let offset = buffer.readUInt32LE(eocdOffset + 16);

    for (let i = 0; i < entryCount; i += 1) {
      if (offset + 46 > buffer.length) return null;
      if (buffer.readUInt32LE(offset) !== 0x02014b50) return null;

      const method = buffer.readUInt16LE(offset + 10);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const localOffset = buffer.readUInt32LE(offset + 42);
      const name = buffer
        .subarray(offset + 46, offset + 46 + nameLength)
        .toString('utf8');

      if (name === wantedName) {
        return this.readZipLocalEntry(
          buffer,
          localOffset,
          method,
          compressedSize
        );
      }

      offset += 46 + nameLength + extraLength + commentLength;
    }

    return null;
  }

  private readZipLocalEntry(
    buffer: Buffer,
    localOffset: number,
    method: number,
    compressedSize: number
  ): Buffer | null {
    if (localOffset + 30 > buffer.length) return null;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) return null;

    const nameLength = buffer.readUInt16LE(localOffset + 26);
    const extraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + nameLength + extraLength;
    const dataEnd = Math.min(dataStart + compressedSize, buffer.length);
    const data = buffer.subarray(dataStart, dataEnd);

    if (method === 0) return data;
    if (method === 8) {
      try {
        return inflateRawSync(data);
      } catch {
        return null;
      }
    }
    return null;
  }

  private findEndOfCentralDirectory(buffer: Buffer): number {
    const minOffset = Math.max(0, buffer.length - 65557);
    for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
      if (buffer.readUInt32LE(offset) === 0x06054b50) {
        return offset;
      }
    }
    return -1;
  }

  private extractDocxText(xml: string): string {
    const withoutTables = xml
      .replace(/<w:tab[^>]*\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n');
    const text = withoutTables.replace(/<[^>]+>/g, '');
    return this.decodeXmlEntities(text)
      .split('\n')
      .map(line => line.replace(/[ \t]+/g, ' ').trim())
      .filter(line => line.length > 0)
      .join('\n')
      .slice(0, MAX_TRANSCRIPT_CHARS);
  }

  private decodeXmlEntities(value: string): string {
    return value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
      .replace(/&amp;/g, '&');
  }

  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private toRecord(entity: UserInterviewEntity) {
    return {
      id: this.idOf(entity),
      userId: `${entity.userId ?? ''}`,
      title: entity.title || '',
      interviewDate: entity.interviewDate || '',
      transcript: entity.transcript || '',
      transcriptFileName: entity.transcriptFileName || '',
      transcriptChars: (entity.transcript || '').length,
      answers: Array.isArray(entity.answers) ? entity.answers : [],
      status: entity.status || 'draft',
      model: entity.model || '',
      structuredAt: entity.structuredAt || null,
      lastError: entity.lastError || '',
      createdAt: entity.createdAt || null,
      updatedAt: entity.updatedAt || null,
    };
  }

  private idOf(entity: UserInterviewEntity): string {
    const raw = entity as unknown as { _id?: unknown; id?: unknown };
    return `${raw._id ?? raw.id ?? ''}`;
  }
}
