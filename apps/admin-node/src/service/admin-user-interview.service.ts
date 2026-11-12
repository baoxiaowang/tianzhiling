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
  ExtractInterviewPdfDTO,
  UpdateUserInterviewDTO,
} from '../dto/admin-user-interview.dto';
import { AdminLlmService } from './admin-llm.service';
import { inflateRawSync } from 'zlib';

/* eslint-disable @typescript-eslint/no-var-requires */
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js') as {
  getDocument(input: {
    data: Uint8Array;
    isEvalSupported?: boolean;
    useSystemFonts?: boolean;
  }): { promise: Promise<PdfDocumentLike> };
};

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

interface PdfPageLike {
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
}

interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  destroy(): Promise<void>;
}

/** 访谈大纲（与运营提供的《付费用户电话访谈 提问大纲》一致）。 */
export const USER_INTERVIEW_OUTLINE: Array<{ no: number; question: string }> = [
  { no: 1, question: '你的年龄？' },
  { no: 2, question: '你的聊天对象？' },
  { no: 3, question: 'ta 离世的原因？' },
  { no: 4, question: 'ta 离世了多久？' },
  { no: 5, question: '用天之灵产品有多久？' },
  { no: 6, question: '是从哪里了解到我们的产品呢？' },
  { no: 7, question: '是平日还是节假日？' },
  { no: 8, question: '什么时候用得比较多？' },
  {
    no: 9,
    question:
      '对功能都了解吗？（发图片 / 语音 / 声音模型 / 合照 / 动态）用过哪些。',
  },
  { no: 10, question: '哪个瞬间付的费？' },
  { no: 11, question: '是否打算长期使用？' },
  { no: 12, question: '对话中有没有很触动的地方？' },
  { no: 13, question: '使用中有没有出戏的地方？' },
  { no: 14, question: '改进想法与建议。' },
  { no: 15, question: '有用过小使者吗？了解它的功能吗？' },
  { no: 16, question: '它的形象如何？它的回复你满意吗？' },
  { no: 17, question: '有无主动聊起过自己使用 AI 对话亲人？' },
  { no: 18, question: '如果让你做推荐，你觉得对方的反应是什么样的？' },
  { no: 19, question: '平台激励是否会影响你主动推荐的意愿？' },
  { no: 20, question: '是否能接受电子寄送礼物 / 祭品？' },
  {
    no: 21,
    question: '场景设计如果像送快递一样，把礼物送给天堂的亲人，你觉得如何？',
  },
  { no: 22, question: '是否愿意主动收到亲人的消息。（场景、频率？）' },
  { no: 23, question: '对动态的感受。' },
  { no: 24, question: '什么情况下会发动态？' },
  {
    no: 25,
    question: '是否愿意面对面分享 ta 的故事，让更多人了解到？（999 答谢）',
  },
];

/** 表单分组（仅前端展示用，按大纲题号顺序切分）。 */
export const USER_INTERVIEW_SECTIONS: Array<{
  title: string;
  from: number;
  to: number;
}> = [
  { title: '基本信息', from: 1, to: 4 },
  { title: '了解与使用', from: 5, to: 8 },
  { title: '功能与付费', from: 9, to: 11 },
  { title: '体验与建议', from: 12, to: 14 },
  { title: '小使者', from: 15, to: 16 },
  { title: '分享与推荐', from: 17, to: 19 },
  { title: '礼物与主动消息', from: 20, to: 22 },
  { title: '社区与故事分享', from: 23, to: 25 },
];

const MAX_TRANSCRIPT_CHARS = 200000;
const MAX_DOCX_BYTES = 20 * 1024 * 1024;
const MAX_LLM_INPUT_CHARS = 120000;
const MAX_PDF_PAGES = 200;

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
      maxTokens: 12000,
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

  /** PDF 逐字稿转纯文本（pdfjs-dist，支持中文 PDF 的 ToUnicode 映射）。 */
  async extractPdf(dto: ExtractInterviewPdfDTO) {
    const buffer = Buffer.from(
      (dto.base64 || '').replace(/^data:[^;]+;base64,/, ''),
      'base64'
    );

    if (!buffer.length) {
      throw new AppError('INTERVIEW_PDF_EMPTY', '文件为空', 400);
    }
    if (buffer.length > MAX_DOCX_BYTES) {
      throw new AppError('INTERVIEW_PDF_TOO_LARGE', '文件超过 20MB', 400);
    }
    if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new AppError('INTERVIEW_PDF_INVALID', '不是有效的 PDF 文件', 400);
    }

    let pdf: PdfDocumentLike;
    try {
      pdf = await pdfjs.getDocument({
        data: new Uint8Array(buffer),
        isEvalSupported: false,
        useSystemFonts: true,
      }).promise;
    } catch (error) {
      this.logger?.warn?.(
        '[user-interview] parse pdf failed: %s',
        (error as Error)?.message || String(error)
      );
      throw new AppError(
        'INTERVIEW_PDF_INVALID',
        'PDF 解析失败，请确认文件未加密或改用 docx/txt',
        400
      );
    }

    const parts: string[] = [];
    try {
      const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = content.items
          .map(item => `${item.str || ''}${item.hasEOL ? '\n' : ''}`)
          .join('');
        parts.push(pageText);
      }
    } finally {
      await pdf.destroy().catch(() => undefined);
    }

    const text = this.normalizeExtractedText(parts.join('\n'));
    if (!text.trim()) {
      throw new AppError(
        'INTERVIEW_PDF_NO_TEXT',
        'PDF 里没有提取到文字（可能是扫描件），请提供可复制文字的 PDF 或改用 docx/txt',
        400
      );
    }

    return {
      fileName: dto.fileName?.trim() || '',
      chars: text.length,
      pages: pdf.numPages,
      text: text.slice(0, MAX_TRANSCRIPT_CHARS),
    };
  }

  private normalizeExtractedText(raw: string) {
    return raw
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map(line => line.replace(/[ \t]+/g, ' ').trim())
      .filter(line => line.length > 0)
      .join('\n');
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
      '请按大纲题号逐题整理访谈对象在逐字稿中的回答，做成回访记录。',
      '',
      '整理要求：',
      '1. 只写逐字稿里明确说过的内容，不推断、不编造；',
      '2. 每题的 answer 要完整覆盖逐字稿中与该题相关的信息：具体数字（年龄、时长、价格、频率）、场景、原因、情绪和顾虑；用 2~4 句，可用「；」并列要点，不要只写一句空泛概括；',
      '3. 用户表达痛点、不满、顾虑的地方（例如方言/声音像不像、怕沉迷、怕更伤心、被家人劝阻）必须写进对应的「触动 / 出戏 / 改进建议」题里；',
      '4. 逐字稿里用户明确说「没有 / 不知道 / 没留意 / 要求不高」时，answer 要如实写「明确表示……」，不要写成「未提及」；只有逐字稿完全没聊到这个话题才写「未提及」；',
      '5. 频率、时间类问题要写出具体频率（例如「一个月一两次」「下午摆摊空闲时」）；',
      '6. quotes 填 1~3 条能支撑该答案的原话（逐字稿原文，每条不超过 60 字），没有就留空数组；',
      '7. 只输出 JSON，不要 markdown 代码块，answers 必须覆盖 1~25 全部题号，格式：',
      '{"answers":[{"no":1,"question":"...","answer":"...","quotes":["..."]}]}',
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
