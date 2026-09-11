#!/usr/bin/env node
/**
 * 订单关系 LLM 回填测试脚本。
 *
 * 用法：
 *   node scripts/test-relationship-llm-backfill.js                  # 测试 LLM 连通性 + prompt
 *   node scripts/test-relationship-llm-backfill.js <userId> <agentId>  # 测试指定用户/智能体的实际关系推断
 *
 * 环境变量：
 *   ADMIN_LLM_API_KEY / NODE_CHAT_API_KEY / NODE_MINIMAX_API_KEY  LLM API Key
 *   ADMIN_LLM_BASE_URL / NODE_CHAT_BASE_URL / NODE_MINIMAX_BASE_URL  LLM Base URL
 *   ADMIN_LLM_MODEL / NODE_CHAT_MODEL                                LLM 模型名
 *   MONGO_URI                                                          MongoDB 连接串（测试实际推断时需要）
 */

const RELATIONSHIP_TAGS = [
  '父女', '父子', '母女', '母子', '爷孙', '奶孙',
  '夫妻', '恋人', '兄妹', '姐弟', '姐妹', '兄弟',
];

function getConfig() {
  return {
    apiKey: process.env.ADMIN_LLM_API_KEY || process.env.NODE_CHAT_API_KEY || process.env.NODE_MINIMAX_API_KEY || '',
    baseURL: process.env.ADMIN_LLM_BASE_URL || process.env.NODE_CHAT_BASE_URL || process.env.NODE_MINIMAX_BASE_URL || 'https://api.minimax.io/v1',
    model: process.env.ADMIN_LLM_MODEL || process.env.NODE_CHAT_MODEL || 'MiniMax-M2.5',
    mongoUri: process.env.MONGO_URI || 'mongodb://admin:qwerasdf@tzl_mongo:27017/tzl?authSource=admin',
  };
}

async function callLlm(prompt, systemPrompt, config) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const resp = await fetch(`${config.baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0,
      max_tokens: 512,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`LLM HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

function parseRelationship(raw) {
  if (!raw) return '';
  const cleaned = raw.replace(/[「」""''\s。.,，]/g, '').trim();
  for (const tag of RELATIONSHIP_TAGS) {
    if (cleaned.includes(tag)) return tag;
  }
  return '';
}

async function testLlmConnectivity(config) {
  console.log('=== 测试 1: LLM 连通性 ===');
  console.log('BaseURL:', config.baseURL);
  console.log('Model:', config.model);
  console.log('API Key:', config.apiKey ? `${config.apiKey.slice(0, 6)}...` : '(未设置)');
  console.log();

  try {
    const result = await callLlm('请回复"连接成功"三个字。', undefined, config);
    console.log('LLM 响应:', result);
    console.log('结果:', result.includes('连接成功') ? 'PASS' : 'FAIL');
  } catch (err) {
    console.log('结果: FAIL -', err.message);
  }
  console.log();
}

async function testPromptInference(config) {
  console.log('=== 测试 2: 关系推断 Prompt（模拟聊天内容） ===');
  console.log();

  const testCases = [
    {
      name: '父女关系',
      chat: '爸爸，我好想你啊。\n今天我去了我们以前常去的那个公园。\n爸，你在那边还好吗？\n我昨天梦到你了，你还是那么慈祥。\n爸爸，女儿永远爱你。',
      expected: '父女',
    },
    {
      name: '母子关系',
      chat: '妈妈，今天是你的生日。\n妈，我给你做了你最爱吃的红烧肉。\n妈妈，你在天堂一定要好好的。\n儿子好想你啊妈。\n妈，我现在工作很顺利，你放心。',
      expected: '母子',
    },
    {
      name: '夫妻关系',
      chat: '老婆，今天是我们结婚十周年。\n亲爱的，我好想你。\n老婆，你走了以后家里空荡荡的。\n宝贝，我永远爱你。\n妻子，你在那边要照顾好自己。',
      expected: '夫妻',
    },
    {
      name: '无法判断',
      chat: '今天天气真好。\n我吃了一碗面。\n看了个电影。\n晚安。',
      expected: '未知',
    },
  ];

  const systemPrompt = `你是一个亲属关系分析助手。根据用户与逝去亲人的聊天记录，判断用户与逝者的关系。

只能从以下标签中选择一个：${RELATIONSHIP_TAGS.join('、')}。

如果聊天内容不足以判断关系，返回"未知"。
只输出关系标签，不要输出任何解释或其他内容。`;

  let passCount = 0;
  for (const tc of testCases) {
    const prompt = `以下是用户与逝者的聊天记录（用户发送的消息）：

${tc.chat}

请判断用户与逝者的关系。只输出一个关系标签或"未知"。`;

    try {
      const raw = await callLlm(prompt, systemPrompt, config);
      const parsed = parseRelationship(raw) || '未知';
      const pass = parsed === tc.expected;
      if (pass) passCount++;
      console.log(`[${pass ? 'PASS' : 'FAIL'}] ${tc.name}: 期望="${tc.expected}", 实际="${parsed}" (原始="${raw}")`);
    } catch (err) {
      console.log(`[FAIL] ${tc.name}: 错误 - ${err.message}`);
    }
  }

  console.log();
  console.log(`Prompt 测试结果: ${passCount}/${testCases.length} 通过`);
  console.log();
}

async function testRealInference(userId, agentId, config) {
  console.log('=== 测试 3: 实际用户/智能体关系推断 ===');
  console.log('userId:', userId);
  console.log('agentId:', agentId);
  console.log();

  // 连接 MongoDB 查询聊天记录
  let mongoClient;
  try {
    const { MongoClient } = await import('mongodb');
    mongoClient = new MongoClient(config.mongoUri);
    await mongoClient.connect();
    console.log('MongoDB 连接成功');

    const db = mongoClient.db();
    const messages = await db.collection('message')
      .find({
        userId: new (await import('mongodb')).ObjectId(userId),
        agentId: new (await import('mongodb')).ObjectId(agentId),
        role: 'user',
        type: 'text',
        status: 'sent',
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray();

    console.log(`找到 ${messages.length} 条用户消息`);
    if (!messages.length) {
      console.log('无聊天记录，无法推断关系');
      return;
    }

    // 按时间正序拼接
    const sorted = messages.reverse();
    const texts = [];
    let totalChars = 0;
    for (const msg of sorted) {
      const text = (msg.content || '').trim();
      if (!text) continue;
      if (totalChars + text.length > 8000) break;
      texts.push(text);
      totalChars += text.length;
    }

    console.log(`用于分析的消息: ${texts.length} 条, ${totalChars} 字符`);
    console.log('前3条消息预览:');
    texts.slice(0, 3).forEach((t, i) => console.log(`  ${i + 1}. ${t.slice(0, 80)}`));
    console.log();

    const systemPrompt = `你是一个亲属关系分析助手。根据用户与逝去亲人的聊天记录，判断用户与逝者的关系。

只能从以下标签中选择一个：${RELATIONSHIP_TAGS.join('、')}。

如果聊天内容不足以判断关系，返回"未知"。
只输出关系标签，不要输出任何解释或其他内容。`;

    const prompt = `以下是用户与逝者的聊天记录（用户发送的消息）：

${texts.join('\n')}

请判断用户与逝者的关系。只输出一个关系标签或"未知"。`;

    const raw = await callLlm(prompt, systemPrompt, config);
    const parsed = parseRelationship(raw) || '未知';
    console.log(`推断结果: "${parsed}" (原始响应: "${raw}")`);
  } catch (err) {
    console.log('测试失败:', err.message);
  } finally {
    if (mongoClient) await mongoClient.close().catch(() => {});
  }
  console.log();
}

async function main() {
  const config = getConfig();
  const args = process.argv.slice(2);

  if (!config.apiKey) {
    console.log('警告: 未设置 LLM API Key，测试可能失败。');
    console.log('请设置环境变量: ADMIN_LLM_API_KEY 或 NODE_CHAT_API_KEY 或 NODE_MINIMAX_API_KEY');
    console.log();
  }

  await testLlmConnectivity(config);
  await testPromptInference(config);

  if (args.length >= 2) {
    await testRealInference(args[0], args[1], config);
  } else {
    console.log('提示: 传入 <userId> <agentId> 可测试实际用户的关系推断。');
  }
}

main().catch(err => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
