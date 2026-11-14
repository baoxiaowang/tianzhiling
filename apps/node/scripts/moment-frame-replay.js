/* eslint-disable */
// 离线回放：只读，不写库。
// LIMIT=10000 DAYS=30 node scripts/moment-frame-replay.js
const { MongoClient, ObjectId } = require('mongodb');
const {
  resolveMomentFrame,
  applyMomentFrameToSegments,
} = require('../dist/service/agents/moment-frame.js');

const LIMIT = Number(process.env.LIMIT || 10000);
const DAYS = Number(process.env.DAYS || 30);

(async () => {
  const uri = `mongodb://${encodeURIComponent(process.env.NODE_MONGO_USERNAME)}:${encodeURIComponent(process.env.NODE_MONGO_PASSWORD)}@${process.env.NODE_MONGO_HOST}:${process.env.NODE_MONGO_PORT}/${process.env.NODE_MONGO_DB}?authSource=${process.env.NODE_MONGO_AUTH_SOURCE}`;
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.NODE_MONGO_DB);
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const messages = await db
    .collection('message')
    .find({
      role: { $in: ['user', 'assistant'] },
      isArchived: { $ne: true },
      content: { $type: 'string' },
      createdAt: { $gte: since },
    })
    .sort({ createdAt: 1 })
    .limit(LIMIT)
    .toArray();

  const byConversation = new Map();
  const counts = {};
  let landingTurns = 0;
  let uninvitedSecondBubble = 0;
  const samples = [];
  for (const message of messages) {
    const conversationId = String(message.conversationId);
    const history = byConversation.get(conversationId) || [];
    if (message.role === 'user') {
      const frame = resolveMomentFrame({
        currentQuery: String(message.content || ''),
        recentMessages: history,
        isDeceased: true,
      });
      counts[frame.momentType] = (counts[frame.momentType] || 0) + 1;
      if (frame.primaryNeed === 'land' && frame.bubbleBudget === 1) {
        landingTurns++;
        const sample = applyMomentFrameToSegments(
          ['进屋了就好，先缓一缓。', '我记着你爱吃的番茄炒蛋味儿呢'],
          frame
        );
        if (sample.length > 1) uninvitedSecondBubble++;
      }
      if (samples.length < 10 && frame.momentType !== 'ordinary') {
        samples.push({
          at: message.createdAt,
          text: String(message.content || '').slice(0, 100),
          frame,
        });
      }
    }
    history.push({
      role: message.role,
      content: String(message.content || ''),
    });
    byConversation.set(conversationId, history.slice(-10));
  }

  // 单独核对 b8a4 的实际“进屋了”回合
  const b8a4Conversation = new ObjectId('6af2abcd56eca3f487028e11');
  const b8a4Recent = await db
    .collection('message')
    .find({
      conversationId: b8a4Conversation,
      role: { $in: ['user', 'assistant'] },
      content: { $type: 'string' },
      createdAt: { $lt: new Date('2026-11-14T12:14:36.989Z') },
      isArchived: { $ne: true },
    })
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray();
  const b8a4Frame = resolveMomentFrame({
    currentQuery: '进屋了',
    recentMessages: b8a4Recent.reverse(),
    isDeceased: true,
  });
  const b8a4Segments = applyMomentFrameToSegments(
    ['昂，进屋就好，把外套脱了缓一缓，', '我记着你爱吃的番茄炒蛋味儿呢'],
    b8a4Frame
  );

  console.log(
    JSON.stringify(
      {
        messages: messages.length,
        counts,
        landingTurns,
        uninvitedSecondBubble,
        samples,
        b8a4: { frame: b8a4Frame, segments: b8a4Segments },
      },
      null,
      1
    )
  );
  await client.close();
})().catch(error => {
  console.error(error);
  process.exit(1);
});
