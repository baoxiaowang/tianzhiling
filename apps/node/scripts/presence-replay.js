/* eslint-disable */
// 离线回放：只读历史消息，推断 presence_state，不写库。
// 用法：LIMIT=5000 node scripts/presence-replay.js
const { MongoClient } = require('mongodb');
const {
  extractPresenceSignals,
  derivePresenceState,
} = require('../dist/service/agents/presence-state.js');

const LIMIT = Number(process.env.LIMIT || 5000);
const DAYS = Number(process.env.DAYS || 30);

(async () => {
  const uri = `mongodb://${encodeURIComponent(process.env.NODE_MONGO_USERNAME)}:${encodeURIComponent(process.env.NODE_MONGO_PASSWORD)}@${process.env.NODE_MONGO_HOST}:${process.env.NODE_MONGO_PORT}/${process.env.NODE_MONGO_DB}?authSource=${process.env.NODE_MONGO_AUTH_SOURCE}`;
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(process.env.NODE_MONGO_DB);
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
  const cursor = db
    .collection('message')
    .find({
      role: 'user',
      isArchived: { $ne: true },
      content: { $type: 'string' },
      createdAt: { $gte: since },
    })
    .sort({ createdAt: 1 })
    .limit(LIMIT);

  const states = new Map();
  const counts = {
    messages: 0,
    signalMessages: 0,
    strongPhysical: 0,
    mediumPhysical: 0,
    reject: 0,
    emotional: 0,
    ritual: 0,
    symbolic: 0,
    meta: 0,
    proactive: 0,
    hypotheticalPhysicalFalsePositive: 0,
  };
  const samples = { physical: [], reject: [], ritual: [], meta: [] };
  const finalStates = {};

  for await (const message of cursor) {
    counts.messages++;
    const text = String(message.content || '').trim();
    if (!text) continue;
    const signals = extractPresenceSignals(text);
    if (!signals.length) continue;
    counts.signalMessages++;
    for (const signal of signals) {
      if (signal.dimension === 'physical' && signal.value === 'literal') counts.strongPhysical++;
      else if (signal.dimension === 'physical' && signal.value === 'imaginal') counts.mediumPhysical++;
      else if (signal.dimension === 'physical' && signal.value === 'reject') counts.reject++;
      else if (signal.dimension === 'contact' && signal.signal === 'presence.emotional') counts.emotional++;
      else if (signal.dimension === 'contact' && signal.signal === 'presence.ritual') counts.ritual++;
      else if (signal.dimension === 'contact' && signal.signal === 'presence.symbolic') counts.symbolic++;
      else if (signal.dimension === 'reality') counts.meta++;
      else if (signal.dimension === 'initiation') counts.proactive++;
    }
    if (
      signals.some(signal => signal.dimension === 'physical') &&
      /如果|要是|假如|梦里|托梦|下辈子|来生/.test(text)
    ) {
      counts.hypotheticalPhysicalFalsePositive++;
    }
    if (signals.some(signal => signal.value === 'reject')) {
      if (samples.reject.length < 8) samples.reject.push(text.slice(0, 180));
    } else if (signals.some(signal => signal.dimension === 'physical')) {
      if (samples.physical.length < 8) samples.physical.push(text.slice(0, 180));
    } else if (signals.some(signal => signal.signal === 'presence.ritual')) {
      if (samples.ritual.length < 8) samples.ritual.push(text.slice(0, 180));
    } else if (signals.some(signal => signal.dimension === 'reality')) {
      if (samples.meta.length < 8) samples.meta.push(text.slice(0, 180));
    }
    const key = `${message.userId}:${message.agentId}`;
    const previous = states.get(key);
    const next = derivePresenceState({
      previous: previous || null,
      signals,
      sourceMessageId: String(message.id),
      now: new Date(message.createdAt),
    });
    if (next) states.set(key, next);
  }

  for (const state of states.values()) {
    const key = `${state.physicalExpectation}/${state.contactChannel}/${state.initiation}/${state.realityFraming}`;
    finalStates[key] = (finalStates[key] || 0) + 1;
  }

  console.log(
    JSON.stringify(
      {
        limit: LIMIT,
        days: DAYS,
        counts,
        stateCount: states.size,
        finalStates,
        samples,
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
