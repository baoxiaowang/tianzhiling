/**
 * Backfill quota_trigger_event collection:
 * 1. Existing warned users → type: warned
 * 2. Heavy users (>100 msgs, never warned) → type: heavyUser
 *
 * Usage: node scripts/backfill-quota-trigger-events.js
 * Safe to run multiple times (deduplicates by userId+agentId+triggerType+day)
 */
const { MongoClient } = require('./apps/node/node_modules/mongodb');

const MONGO = 'mongodb://admin:qwerasdf@1.13.18.200:17271/tzl?authSource=admin&directConnection=true';
const BATCH = 200;

function bjDayStart(ts) {
  const d = new Date(ts);
  d.setUTCHours(16, 0, 0, 0); // Beijing midnight = UTC 16:00 previous day
  d.setUTCDate(d.getUTCDate() - (d.getUTCHours() < 16 ? 1 : 0));
  return d;
}

async function main() {
  const client = new MongoClient(MONGO, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('tzl');
  const msg = db.collection('message');
  const events = db.collection('quota_trigger_event');

  // --- Part 1: Warned events ---
  console.log('=== Part 1: Backfilling warned events ===');
  
  const warnedUsers = await msg.aggregate([
    { $match: { quotaWarned: true, role: 'user' } },
    { $group: {
      _id: { uid: '$userId', aid: '$agentId' },
      firstWarn: { $min: '$createdAt' },
      warnCount: { $sum: 1 }
    } },
    { $sort: { firstWarn: 1 } }
  ]).toArray();

  console.log(`Found ${warnedUsers.length} warned user+agent pairs`);
  
  let inserted = 0, skipped = 0;
  for (const w of warnedUsers) {
    const dayStart = bjDayStart(w.firstWarn);
    const dayEnd = new Date(dayStart.getTime() + 86400000);
    
    // Count msgs that day
    const dayMsgs = await msg.countDocuments({
      userId: w._id.uid, agentId: w._id.aid, role: 'user', status: 'sent',
      createdAt: { $gte: dayStart, $lt: dayEnd }
    });
    
    // Lifetime count
    const lifetimeMsgs = await msg.countDocuments({
      userId: w._id.uid, agentId: w._id.aid, role: 'user', status: 'sent',
      createdAt: { $lt: dayEnd }
    });
    
    // Check if already exists
    const existing = await events.findOne({
      userId: w._id.uid, agentId: w._id.aid,
      triggerType: 'warned',
      triggeredAt: { $gte: dayStart, $lt: dayEnd }
    });
    
    if (existing) {
      skipped++;
      continue;
    }
    
    // Get first warned message for metadata
    const firstWarnMsg = await msg.findOne({
      userId: w._id.uid, agentId: w._id.aid,
      quotaWarned: true, role: 'user',
      createdAt: { $gte: dayStart, $lt: dayEnd }
    }, { sort: { createdAt: 1 } });
    
    await events.insertOne({
      userId: w._id.uid,
      agentId: w._id.aid,
      triggerType: 'warned',
      triggeredAt: w.firstWarn,
      dayMsgs,
      lifetimeMsgs,
      triggered: true,
      matchedConditions: firstWarnMsg?.replyQuotaTriggerDecision?.matchedConditions || [],
      warnCount: w.warnCount,
    });
    inserted++;
    
    if (inserted % 50 === 0) {
      console.log(`  warned progress: ${inserted}/${warnedUsers.length}`);
    }
  }
  console.log(`  warned: ${inserted} inserted, ${skipped} skipped (already exist)`);

  // --- Part 2: Heavy users ---
  console.log('\n=== Part 2: Backfilling heavyUser events ===');
  
  const heavyUsers = await msg.aggregate([
    { $match: { role: 'user' } },
    { $group: {
      _id: { uid: '$userId', aid: '$agentId' },
      totalMsgs: { $sum: 1 },
      firstMsg: { $min: '$createdAt' },
      lastMsg: { $max: '$createdAt' }
    } },
    { $match: { totalMsgs: { $gte: 100 } } },
    { $sort: { totalMsgs: -1 } },
    { $limit: 200 }
  ]).toArray();

  console.log(`Found ${heavyUsers.length} heavy user+agent pairs (>=100 msgs)`);
  
  let heavyInserted = 0, heavySkipped = 0;
  for (const h of heavyUsers) {
    // Skip if already warned (will be tracked as warned, not heavyUser)
    const wasWarned = await msg.findOne({
      userId: h._id.uid, agentId: h._id.aid,
      quotaWarned: true, role: 'user'
    });
    if (wasWarned) {
      heavySkipped++;
      continue;
    }
    
    // Check if already recorded
    const existing = await events.findOne({
      userId: h._id.uid, agentId: h._id.aid,
      triggerType: 'heavyUser'
    });
    
    if (existing) {
      heavySkipped++;
      continue;
    }
    
    const lastDay = bjDayStart(h.lastMsg);
    const dayMsgs = await msg.countDocuments({
      userId: h._id.uid, agentId: h._id.aid, role: 'user', status: 'sent',
      createdAt: { $gte: lastDay, $lt: new Date(lastDay.getTime() + 86400000) }
    });
    
    await events.insertOne({
      userId: h._id.uid,
      agentId: h._id.aid,
      triggerType: 'heavyUser',
      triggeredAt: h.lastMsg,
      dayMsgs,
      lifetimeMsgs: h.totalMsgs,
      triggered: false,
      matchedConditions: [],
      warnCount: 0,
    });
    heavyInserted++;
    
    if (heavyInserted % 50 === 0) {
      console.log(`  heavyUser progress: ${heavyInserted}/${heavyUsers.length}`);
    }
  }
  console.log(`  heavyUser: ${heavyInserted} inserted, ${heavySkipped} skipped`);
  
  // Summary
  const totalEvents = await events.countDocuments({});
  console.log(`\n=== Done ===`);
  console.log(`Total quota_trigger_event documents: ${totalEvents}`);
  console.log(`  warned: ${await events.countDocuments({ triggerType: 'warned' })}`);
  console.log(`  heavyUser: ${await events.countDocuments({ triggerType: 'heavyUser' })}`);
  
  await client.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
