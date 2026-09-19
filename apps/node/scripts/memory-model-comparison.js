#!/usr/bin/env node
'use strict';
/**
 * 记忆「未了结事项抽取」模型对比：qwen-plus vs DeepSeek Flash。
 *
 * 离线评测脚本，只读 prompt 构造函数与输出解析函数，不写任何业务数据。
 * 设计为在生产 tzl_node 容器内执行（那里有 openai 依赖和编译产物）：
 *
 *   docker cp apps/node/scripts/memory-model-comparison.js tzl_node:/workspace/apps/node/
 *   docker exec -w /workspace/apps/node tzl_node node /workspace/apps/node/memory-model-comparison.js
 *
 * 依赖的环境变量（容器内已有）：
 *   DASHSCOPE_API_KEY      百炼通道，用于 qwen-plus / deepseek-v4-flash
 *   NODE_MEMORY_API_KEY    DeepSeek 官方通道密钥
 *   NODE_MEMORY_BASE_URL   默认 https://api.deepseek.com
 *   DEEPSEEK_OFFICIAL_MODEL 默认 deepseek-flash
 *   MEMORY_EXTRACTION_DIST  编译产物路径，默认 /workspace/apps/node/dist/service/memory/memory-open-item-extraction.js
 *
 * 输出：每个方案一行 SUMMARY（准确率 / tp-fp-fn-tn / token / 缓存命中 / 耗时），
 *       以及一行 DETAIL JSON 明细。
 */

const OpenAI = require('openai');
const {
  OPEN_ITEM_EXTRACTION_SYSTEM_PROMPT,
  buildOpenItemExtractionPrompt,
  parseOpenItemExtractionOutput,
} = require(
  process.env.MEMORY_EXTRACTION_DIST ||
    '/workspace/apps/node/dist/service/memory/memory-open-item-extraction.js'
);

const DASHSCOPE_BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

const PROVIDERS = [
  {
    name: 'qwen-plus',
    model: 'qwen-plus',
    client: new OpenAI({
      apiKey: process.env.DASHSCOPE_API_KEY,
      baseURL: DASHSCOPE_BASE,
      timeout: 300000,
      maxRetries: 0,
    }),
  },
  {
    name: 'deepseek-v4-flash百炼-思考开',
    model: 'deepseek-v4-flash',
    thinking: undefined,
    client: new OpenAI({
      apiKey: process.env.DASHSCOPE_API_KEY,
      baseURL: DASHSCOPE_BASE,
      timeout: 300000,
      maxRetries: 0,
    }),
  },
  {
    name: 'deepseek官方-思考开',
    model: process.env.DEEPSEEK_OFFICIAL_MODEL || 'deepseek-flash',
    thinking: undefined,
    client: new OpenAI({
      apiKey: process.env.NODE_MEMORY_API_KEY,
      baseURL: process.env.NODE_MEMORY_BASE_URL || 'https://api.deepseek.com',
      timeout: 300000,
      maxRetries: 0,
    }),
  },
  {
    name: 'deepseek官方-思考关',
    model: process.env.DEEPSEEK_OFFICIAL_MODEL || 'deepseek-flash',
    thinking: { type: 'disabled' },
    client: new OpenAI({
      apiKey: process.env.NODE_MEMORY_API_KEY,
      baseURL: process.env.NODE_MEMORY_BASE_URL || 'https://api.deepseek.com',
      timeout: 300000,
      maxRetries: 0,
    }),
  },
];

// expect: true=应该抽出未了结事项；false=不该抽
const CASES = [
  { text: '我下周三要去医院复查心脏，医生说可能要住院观察几天', expect: true },
  { text: '我下个月要开始准备考研了，学校还没定下来', expect: true },
  { text: '我明天要去面试一份新工作，还在等结果', expect: true },
  { text: '我答应我妈这个月把老房子重新装修一下，还没动工', expect: true },
  { text: '我跟对象说好年底领证，日子还没定', expect: true },
  { text: '我准备从下周一开始戒烟', expect: true },
  { text: '还在等医院的检查结果，说是这周五出来', expect: true },
  { text: '我七八岁的时候，那会哥还没结婚', expect: false },
  { text: '今天送闺女上大学回来了', expect: false },
  { text: '我感觉你没走，我想你了', expect: false },
  { text: '准备去上班了', expect: false },
  { text: '没事了，已经出院了', expect: false },
  { text: '有点肚子不舒服，过会儿应该就好了', expect: false },
  { text: '他34岁了还没结婚', expect: false },
  { text: '别问了，我不想提', expect: false },
];

async function runOne(client, model, text, thinking) {
  const messages = [
    { messageId: 'm1', content: text, occurredAt: new Date().toISOString() },
  ];
  const prompt = buildOpenItemExtractionPrompt(messages);
  const startedAt = Date.now();
  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    top_p: 0.1,
    max_tokens: 1200,
    ...(thinking ? { thinking } : {}),
    messages: [
      { role: 'system', content: OPEN_ITEM_EXTRACTION_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
  });
  const msg = completion.choices?.[0]?.message || {};
  const parsed = parseOpenItemExtractionOutput(msg.content || '', messages);
  const usage = completion.usage || {};
  return {
    extracted: parsed.candidates.length > 0,
    finishReason: completion.choices?.[0]?.finish_reason,
    hasReasoning: Boolean(msg.reasoning_content),
    ms: Date.now() - startedAt,
    promptTokens: usage.prompt_tokens || 0,
    cachedTokens:
      (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) ||
      usage.prompt_cache_hit_tokens ||
      0,
    cacheMissTokens:
      usage.prompt_cache_miss_tokens ||
      Math.max((usage.prompt_tokens || 0) -
        ((usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) ||
          usage.prompt_cache_hit_tokens || 0), 0),
    completionTokens: usage.completion_tokens || 0,
    reasoningTokens:
      (usage.completion_tokens_details &&
        usage.completion_tokens_details.reasoning_tokens) ||
      0,
  };
}

async function runProvider(p) {
  const rows = [];
  for (let i = 0; i < CASES.length; i++) {
    const item = CASES[i];
    try {
      const r = await runOne(p.client, p.model, item.text, p.thinking);
      rows.push({ ...item, ...r, ok: r.extracted === item.expect });
    } catch (error) {
      const message = error && error.message ? error.message.slice(0, 200) : 'error';
      rows.push({ ...item, ok: false, error: message, extracted: false, promptTokens: 0,
        cachedTokens: 0, cacheMissTokens: 0, completionTokens: 0, reasoningTokens: 0, ms: 0 });
      process.stderr.write(`  ${p.name} #${i + 1} ERROR ${message}\n`);
    }
  }
  const pos = rows.filter(r => r.expect);
  const neg = rows.filter(r => !r.expect);
  const tp = pos.filter(r => r.extracted).length;
  const fn = pos.filter(r => !r.extracted).length;
  const fp = neg.filter(r => r.extracted).length;
  const tn = neg.filter(r => !r.extracted).length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const sum = k => rows.reduce((a, r) => a + (r[k] || 0), 0);
  return {
    name: p.name, model: p.model, thinking: p.thinking,
    accuracy: (tp + tn) / rows.length, precision, recall,
    f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
    tp, fp, fn, tn, errors: rows.filter(r => r.error).length,
    promptTokens: sum('promptTokens'), cachedTokens: sum('cachedTokens'),
    cacheMissTokens: sum('cacheMissTokens'), completionTokens: sum('completionTokens'),
    reasoningTokens: sum('reasoningTokens'),
    avgMs: rows.filter(r => !r.error).length
      ? Math.round(rows.filter(r => !r.error).reduce((a, r) => a + r.ms, 0) / rows.filter(r => !r.error).length)
      : 0,
    maxMs: Math.max(...rows.map(r => r.ms || 0)),
    rows,
  };
}

(async () => {
  const results = [];
  for (const p of PROVIDERS) {
    process.stderr.write(`[run] ${p.name} model=${p.model}\n`);
    results.push(await runProvider(p));
  }
  for (const r of results) {
    console.log(
      `SUMMARY ${r.name} model=${r.model} thinking=${r.thinking ? JSON.stringify(r.thinking) : 'default'} accuracy=${(r.accuracy * 100).toFixed(1)}% ` +
        `p=${(r.precision * 100).toFixed(1)}% r=${(r.recall * 100).toFixed(1)}% f1=${(r.f1 * 100).toFixed(1)}% ` +
        `tp=${r.tp} fp=${r.fp} fn=${r.fn} tn=${r.tn} errors=${r.errors} ` +
        `prompt=${r.promptTokens} cached=${r.cachedTokens} miss=${r.cacheMissTokens} ` +
        `completion=${r.completionTokens} reasoning=${r.reasoningTokens} ` +
        `cacheHit=${((r.promptTokens ? r.cachedTokens / r.promptTokens : 0) * 100).toFixed(1)}% ` +
        `avgMs=${r.avgMs} maxMs=${r.maxMs}`
    );
  }
  console.log('DETAIL ' + JSON.stringify(results));
})().catch(e => { console.error('ERR ' + (e && e.message)); process.exit(1); });
