/**
 * R00 程序层探针：不改模型、只喂"人为构造的模型输出"，量出现有解析/归并的真实行为。
 * 用来回答"模型 raw 正确、程序是否把它改错/删掉"。
 * 用法：npx ts-node --transpile-only -P scripts/return-extract-v2/tsconfig.json \
 *        scripts/return-extract-v2/probe-parser.ts
 */
import { parseOpenItemExtractionOutput } from '../../src/service/memory/memory-open-item-extraction';
import { MemoryEventEngine } from '../../src/service/memory/memory-event.engine';
import { MongoObjectId } from '@tzl/entities';

const messages = [
  {
    messageId: 'm1',
    content: '妈妈明天上午做手术，我在医院陪着',
    occurredAt: '2026-09-10T12:00:00Z',
  },
  {
    messageId: 'm2',
    content: '我下周要去医院复查',
    occurredAt: '2026-09-09T12:00:00Z',
  },
  {
    messageId: 'm3',
    content: '我下周要去医院复查',
    occurredAt: '2026-09-01T12:00:00Z',
  },
  {
    messageId: 'm4',
    content: '嗯，下午最后一台',
    occurredAt: '2026-09-10T12:05:00Z',
  },
  {
    messageId: 'm5',
    content:
      '我下周一要去医院复查，顺便把药开了，还要问医生能不能停药，另外把报告拿了，最后交完费再约下次时间，我下周一要去医院复查结果',
    occurredAt: '2026-09-12T12:00:00Z',
  },
];

const probes: Array<{ id: string; intent: string; raw: unknown }> = [
  {
    id: 'P1-short-quote',
    intent: '模型给出正确但很短的引文（7 字）是否被删',
    raw: {
      items: [
        {
          messageId: 'm1',
          quote: '妈妈明天做手术',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
        },
      ],
    },
  },
  {
    id: 'P2-relocate-same-text',
    intent: '声明 m3、引文实际在 m1 时是否被静默改源',
    raw: {
      items: [
        {
          messageId: 'm3',
          quote: '妈妈明天上午做手术',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
        },
      ],
    },
  },
  {
    id: 'P3-quote-not-found',
    intent: '引文在任何消息里都找不到',
    raw: {
      items: [
        {
          messageId: 'm4',
          quote: '这句话根本不存在于任何消息里哦',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
        },
      ],
    },
  },
  {
    id: 'P4-declared-ok',
    intent: '声明的 messageId 与引文一致时不得改源',
    raw: {
      items: [
        {
          messageId: 'm1',
          quote: '妈妈明天上午做手术',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
        },
      ],
    },
  },
  {
    id: 'P5-more-than-four',
    intent: '输出 6 条时第 5、6 条是否被静默丢弃',
    raw: {
      items: [
        '我下周一要去医院复查',
        '顺便把药开了',
        '还要问医生能不能停药',
        '另外把报告拿了',
        '最后交完费再约下次时间',
        '我下周一要去医院复查', // 重复内容，用于观察是否算两条
      ].map(quote => ({
        messageId: 'm5',
        quote,
        topicKey: '就医',
        state: 'awaiting_result',
        importance: 3,
      })),
    },
  },
  {
    id: 'P6-state-resolved',
    intent: '模型输出"已完成/取消/拒谈"这类状态会被怎样处理',
    raw: {
      items: [
        {
          messageId: 'm1',
          quote: '妈妈手术做完了',
          topicKey: '就医',
          state: 'resolved',
          importance: 3,
        },
      ],
    },
  },
  {
    id: 'P7-topic-not-allowed',
    intent: '类别不在白名单',
    raw: {
      items: [
        {
          messageId: 'm1',
          quote: '妈妈明天上午做手术',
          topicKey: '情感',
          state: 'awaiting_result',
          importance: 3,
        },
      ],
    },
  },
  {
    id: 'P8-whitespace-normalize',
    intent: '引文与原文只差空白/标点规范化',
    raw: {
      items: [
        {
          messageId: 'm1',
          quote: '妈妈 明天上午做手术',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
        },
      ],
    },
  },
  {
    id: 'P9-calendar-exempt',
    intent: '纪念日不需要人和时间标记',
    raw: {
      items: [
        {
          messageId: 'm1',
          quote: '快百天了',
          topicKey: '纪念日',
          state: 'awaiting_result',
          importance: 1,
        },
      ],
    },
  },
  {
    id: 'P11-six-long-quotes',
    intent: '6 条都合法时是否静默只留 4 条',
    raw: {
      items: [
        '我下周一要去医院复查',
        '顺便把药开了',
        '还要问医生能不能停药',
        '另外把报告拿了',
        '最后交完费再约下次时间',
        '我下周一要去医院复查结果',
      ].map(quote => ({
        messageId: 'm5',
        quote,
        topicKey: '就医',
        state: 'awaiting_result',
        importance: 3,
      })),
    },
  },
  {
    id: 'P10-past-only',
    intent: '只有回忆、没有将来动作',
    raw: {
      items: [
        {
          messageId: 'm1',
          quote: '去年那次手术你陪了我半个月',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
        },
      ],
    },
  },
];

function main() {
  const rows: any[] = [];
  for (const probe of probes) {
    const parsed = parseOpenItemExtractionOutput(
      JSON.stringify(probe.raw),
      messages
    );
    const declared =
      (probe.raw as any).items?.map((item: any) => item.messageId) || [];
    const kept = parsed.candidates.map(candidate => candidate.messageId);
    const relocated =
      parsed.candidates.length > 0 &&
      declared.length > 0 &&
      parsed.candidates.some(
        (candidate, index) => candidate.messageId !== declared[index]
      );
    rows.push({
      probe: probe.id,
      intent: probe.intent,
      declaredItems: declared.length,
      keptItems: parsed.candidates.length,
      rejected: parsed.rejected.map(item => item.reason),
      keptMessageIds: kept,
      静默改源: relocated,
      keptQuotes: parsed.candidates.map(candidate =>
        candidate.quote.slice(0, 20)
      ),
    });
  }
  console.log(JSON.stringify(rows, null, 2));

  // 归并层探针：同话题同主体但内容不同的两件事会不会被并
  void (async () => {
    const engine = new MemoryEventEngine();
    const items: any[] = [];
    const repo = {
      rows: items,
      async find() {
        return this.rows;
      },
      async findOne(options: any) {
        return this.rows.find(
          (row: any) => row.fingerprint === options.where.fingerprint
        );
      },
      async save(entity: any) {
        const row = { ...entity };
        if (!row.id)
          row.id = new MongoObjectId(
            String(this.rows.length + 1).padStart(24, '0')
          );
        const index = this.rows.findIndex(
          (item: any) => String(item.id) === String(row.id)
        );
        if (index === -1) this.rows.push(row);
        else this.rows[index] = row;
        return row;
      },
    };
    (engine as any).itemModel = repo;
    (engine as any).groupModel = repo;
    (engine as any).messageModel = repo;
    const userId = '6aa000000000000000000001';
    await engine.applyExtractedOpenItems({
      userId,
      conversationId: '6aa000000000000000000010',
      agentId: '6aa000000000000000000011',
      candidates: [
        {
          messageId: 'm1',
          quote: '爸爸明天做手术',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
          subjectRef: '爸爸',
          occurredAt: new Date('2026-09-10T12:00:00Z'),
        },
      ],
      now: new Date('2026-09-10T12:00:00Z'),
    });
    await engine.applyExtractedOpenItems({
      userId,
      conversationId: '6aa000000000000000000010',
      agentId: '6aa000000000000000000011',
      candidates: [
        {
          messageId: 'm2',
          quote: '爸爸后天去复查牙齿',
          topicKey: '就医',
          state: 'awaiting_result',
          importance: 3,
          subjectRef: '爸爸',
          occurredAt: new Date('2026-09-11T12:00:00Z'),
        },
      ],
      now: new Date('2026-09-11T12:00:00Z'),
    });
    console.log(
      JSON.stringify(
        {
          探针: 'M1-同主体不同事件是否被并',
          库存条数: items.length,
          摘要: items.map((row: any) => row.summary),
          证据数: items.map((row: any) => (row.sourceMessageIds || []).length),
        },
        null,
        2
      )
    );
  })();
}

main();
