/**
 * 历史订单 relationship 字段回填脚本。
 * 遍历所有已付款且 relationship 为空的订单，用三级回退推断关系并写入。
 * 用法：docker exec tzl_admin_node node /workspace/backfill-relationship.js
 */
const { MongoClient, ObjectId } = require('mongodb');

const MONGO_URI = 'mongodb://admin:qwerasdf@tzl_mongo:27017/tzl?authSource=admin';

function firstSegment(value) {
  return String(value || '').split(/[，,、/]/)[0]?.trim() || '';
}

function relationshipFromCall(call) {
  if (/爸爸|父亲|老爸|老爹|爹|爸/.test(call)) return '父女';
  if (/妈妈|母亲|老妈|妈咪|娘|妈/.test(call)) return '母女';
  if (/爷爷|姥爷|外公|外姥|姨爹|嗲嗲/.test(call)) return '爷孙';
  if (/奶奶|姥姥|外婆|婆婆/.test(call)) return '奶孙';
  if (/老公|老婆|丈夫|妻子|先生|夫人|爱人/.test(call)) return '夫妻';
  if (/哥哥|哥/.test(call)) return '兄妹';
  if (/姐姐|姐/.test(call)) return '姐妹';
  return '';
}

function inferFromKeywords(agent) {
  if (!agent) return '';
  const called = firstSegment(agent.iCallAgent);
  const callsUser = firstSegment(agent.agentCallMe);
  const text = `${called} ${agent.name || ''} ${agent.description || ''}`;
  const maleChild = /儿子|弟弟|小宝/.test(callsUser);
  if (/爸爸|父亲|老爸|老爹|爹|爸/.test(text)) return maleChild ? '父子' : '父女';
  if (/妈妈|母亲|老妈|妈咪|娘|妈/.test(text)) return maleChild ? '母子' : '母女';
  if (/爷爷|姥爷|外公|外姥|姨爹|嗲嗲/.test(text)) return '爷孙';
  if (/奶奶|姥姥|外婆|阿姨|姑姑|二姨|小姑|姨夫|婆婆/.test(text)) return '奶孙';
  if (/老公|老婆|丈夫|妻子|先生|夫人|爱人/.test(text)) return '夫妻';
  if (/前任|男朋友|女朋友|恋人/.test(text)) return '恋人';
  if (/哥哥|哥/.test(called)) return /弟弟|弟/.test(callsUser) ? '兄弟' : '兄妹';
  if (/姐姐|姐/.test(called)) return /弟弟|弟/.test(callsUser) ? '姐弟' : '姐妹';
  if (/儿子|小宝/.test(callsUser)) return '母子';
  if (/女儿|闺女|姑娘|妞妞/.test(callsUser)) return '母女';
  return '';
}

function inferFromFacts(facts) {
  if (!facts || !facts.length) return '';
  // 1. 直接关系标签
  const direct = facts.find(f => f.key === '用户与逝去亲人的关系');
  if (direct?.value) {
    const first = direct.value.split(/[\/／、,，\s]/)[0]?.trim();
    if (first && first !== '未知' && first.length <= 4) return first;
  }
  // 2. identity.relationship（规则提取）
  const identityRel = facts.find(f => f.key === 'identity.relationship');
  if (identityRel?.value) {
    const match = identityRel.value.match(/当前角色是用户的(.+)/);
    if (match?.[1]) {
      const mapped = relationshipFromCall(match[1]);
      if (mapped) return mapped;
    }
  }
  // 3. "称呼"字段
  const call = facts.find(f => f.key === '称呼');
  if (call?.value) {
    const mapped = relationshipFromCall(call.value);
    if (mapped) return mapped;
  }
  // 4. 其他 relationship 事实
  for (const fact of facts) {
    if (fact.type !== 'relationship') continue;
    if (fact.key === '用户与逝去亲人的关系' || fact.key === '称呼') continue;
    const mapped = relationshipFromCall(fact.value || '');
    if (mapped) return mapped;
  }
  return '';
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('tzl');

  const orders = await db.collection('order').find({
    paidAt: { $exists: true, $ne: null },
    $or: [{ relationship: { $exists: false } }, { relationship: '' }, { relationship: null }],
  }).toArray();

  console.log(`Found ${orders.length} paid orders without relationship`);

  // 批量查 agents
  const agentIds = [...new Set(orders.map(o => o.agentId).filter(Boolean))];
  const agents = await db.collection('agent').find({ _id: { $in: agentIds } }).toArray();
  const agentMap = new Map(agents.map(a => [a._id.toString(), a]));

  // 批量查 facts
  const userIds = [...new Set(orders.map(o => o.userId).filter(Boolean))];
  const facts = await db.collection('agent_profile_fact').find({
    userId: { $in: userIds },
    agentId: { $in: agentIds },
    status: { $in: ['active', 'candidate'] },
    $or: [
      { type: 'relationship' },
      { type: 'identity', key: 'identity.relationship' },
    ],
  }).toArray();

  const factMap = new Map();
  for (const f of facts) {
    const key = `${f.userId.toString()}|${f.agentId.toString()}`;
    if (!factMap.has(key)) factMap.set(key, []);
    factMap.get(key).push(f);
  }

  let updated = 0;
  let identified = 0;
  const bulkOps = [];

  for (const order of orders) {
    const agent = order.agentId ? agentMap.get(order.agentId.toString()) : null;
    let rel = '';

    // 1. 关键词
    rel = inferFromKeywords(agent);
    // 2. 记忆事实
    if (!rel && order.userId && order.agentId) {
      const key = `${order.userId.toString()}|${order.agentId.toString()}`;
      rel = inferFromFacts(factMap.get(key));
    }
    // 3. iCallAgent 兜底
    if (!rel && agent?.iCallAgent) {
      rel = relationshipFromCall(agent.iCallAgent);
    }

    if (rel) {
      identified++;
      bulkOps.push({
        updateOne: {
          filter: { _id: order._id },
          update: { $set: { relationship: rel, updatedAt: new Date() } },
        },
      });
    } else {
      // 未识别的也写空字符串，避免重复处理
      bulkOps.push({
        updateOne: {
          filter: { _id: order._id },
          update: { $set: { relationship: '', updatedAt: new Date() } },
        },
      });
    }
    updated++;

    if (bulkOps.length >= 200) {
      await db.collection('order').bulkWrite(bulkOps);
      bulkOps.length = 0;
    }
  }

  if (bulkOps.length) {
    await db.collection('order').bulkWrite(bulkOps);
  }

  console.log(`Done. Updated ${updated} orders, identified ${identified}, remaining unidentified ${updated - identified}`);
  await client.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
