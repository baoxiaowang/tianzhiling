/**
 * CPU/召回诊断：隔离本地候选验证（不联网、不连库、不调用模型）。
 *
 * 左栏"current"：从生产提交 a237b35 用 git show 取纯函数，按 ES2020 转译后在 vm 里运行，
 *                复现生产自动入口的触发/过滤/排序/限额行为。
 * 右栏"candidate"：本任务的最小候选（保留原话语义检索、不因缺字面词硬删、原话优先、修正上限）。
 *
 * 用法：node apps/node/scripts/memory-recall-candidate/run-cases.cjs
 */
const cp = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const COMMIT = 'a237b35fd60179df95fa0620ebdc3ea8ce6e9fcf';
const ts = require(path.join(REPO, 'apps/node/node_modules/typescript'));

function source(file) {
  return cp.execFileSync('git', ['show', `${COMMIT}:${file}`], { cwd: REPO, encoding: 'utf8' });
}

function transpile(file) {
  return ts.transpileModule(source(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

function loadModule(code, requireImpl) {
  const module = { exports: {} };
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module) { ${code}\n})`,
    { filename: 'prod-module.js' }
  );
  wrapper(module.exports, requireImpl, module);
  return module.exports;
}

function pickNames(file, names) {
  const src = source(file);
  const ast = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  return ast.statements
    .filter(
      statement =>
        names.includes(statement.name?.text) ||
        statement.declarationList?.declarations.some(declaration =>
          names.includes(declaration.name.text)
        )
    )
    .map(statement => statement.getText(ast))
    .join('\n');
}

// ---- 载入生产纯函数 ----
const memoryTopics = loadModule(transpile('apps/node/src/service/agents/memory-topics.ts'), () => {
  throw new Error('unexpected require in memory-topics');
});
const memoryValue = loadModule(transpile('apps/node/src/service/agents/memory-value.ts'), id => {
  if (id === '@tzl/entities') return { AgentProfileFactType: {}, MemoryGovernance: {} };
  if (id === 'node:crypto') return require('node:crypto');
  throw new Error(`unexpected require ${id}`);
});
const retrievalKeys = loadModule(
  transpile('apps/node/src/service/memory/memory-retrieval-keys.ts'),
  id => {
    if (id.endsWith('memory-value')) return memoryValue;
    if (id.endsWith('memory-topics')) return memoryTopics;
    throw new Error(`unexpected require ${id}`);
  }
);

const ctxCode = pickNames('apps/node/src/service/agents/agent.context.ts', [
  'RETRIEVAL_KEY_ALTERNATIVES',
  'isKeyLinkedEvidence',
  'memoryEvidenceCore',
  'SELF_HARM_SIGNAL_PATTERN',
  'MEMORY_EVIDENCE_QUESTION_PATTERN',
  'isPersonAlignedEvidence',
  'isInjectableMemoryEvidence',
  'MEMORY_EVIDENCE_ACK_PATTERN',
  'AUTO_MEMORY_MIN_EVIDENCE_CHARACTERS',
  'AUTO_MEMORY_RETRIEVAL_CANDIDATES',
  'AUTO_MEMORY_INJECT_LIMIT',
]);
const ctxTranspiled = ts.transpileModule(
  `const { buildMemoryRetrievalQuery } = require('../memory/memory-retrieval-keys');
   const { HABIT_TOPIC_KEYS } = require('../agents/memory-topics');
   const { isEmotionalValue, kinshipGroupsIn } = require('../agents/memory-value');
   ${ctxCode}
   Object.assign(module.exports, {
     RETRIEVAL_KEY_ALTERNATIVES, isKeyLinkedEvidence, memoryEvidenceCore,
     SELF_HARM_SIGNAL_PATTERN, MEMORY_EVIDENCE_QUESTION_PATTERN, isPersonAlignedEvidence,
     isInjectableMemoryEvidence, MEMORY_EVIDENCE_ACK_PATTERN,
     AUTO_MEMORY_MIN_EVIDENCE_CHARACTERS, AUTO_MEMORY_RETRIEVAL_CANDIDATES,
     AUTO_MEMORY_INJECT_LIMIT,
   });`,
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText;
const agentContext = loadModule(
  ctxTranspiled,
  id => {
    if (id.endsWith('memory-retrieval-keys')) return retrievalKeys;
    if (id.endsWith('memory-topics')) return memoryTopics;
    if (id.endsWith('memory-value')) return memoryValue;
    throw new Error(`unexpected require ${id}`);
  }
);

const current = {
  buildQuery: retrievalKeys.buildMemoryRetrievalQuery,
  isKeyLinked: agentContext.isKeyLinkedEvidence,
  isInjectable: agentContext.isInjectableMemoryEvidence,
  minChars: agentContext.AUTO_MEMORY_MIN_EVIDENCE_CHARACTERS,
  candidates: agentContext.AUTO_MEMORY_RETRIEVAL_CANDIDATES,
  injectLimit: agentContext.AUTO_MEMORY_INJECT_LIMIT,
  core: agentContext.memoryEvidenceCore,
};

// 忠实再现 retrieve.service 的选条：person 在前、同来源 raw 被剔除、封顶 min(limit,8)
function currentSelect(memories, limit) {
  const byScore = [...memories].sort((a, b) => (b.score || 0) - (a.score || 0));
  const activePerson = byScore.filter(m => m.personId);
  const activeRaw = byScore.filter(m => !m.personId && m.memoryKind === 'raw_episode');
  const personSelected = [];
  const seenP = new Set();
  for (const m of activePerson) {
    const key = m.sourceMessageId || m.id;
    if (seenP.has(key)) continue;
    seenP.add(key);
    personSelected.push(m);
    if (personSelected.length >= Math.max(1, Math.min(limit, 8))) break;
  }
  const preferredRaw = activeRaw.filter(
    m => !personSelected.some(s => String(s.sourceMessageId) === String(m.sourceMessageId))
  );
  const seen = new Set();
  const seenText = new Set();
  const out = [];
  for (const m of [...personSelected, ...preferredRaw]) {
    const text = (m.searchableText || '').replace(/\s+/g, '').toLowerCase();
    const key = m.sourceMessageId || m.id;
    if (!text || seen.has(key) || seenText.has(text)) continue;
    seen.add(key);
    seenText.add(text);
    out.push(m);
    if (out.length >= Math.max(1, Math.min(limit, 8))) break;
  }
  return out;
}

// ---- 最小候选 ----
const CANDIDATE_INJECT_LIMIT = 3;
function candidateQuery(currentUserText, extractedKeys) {
  // 语义检索输入保留用户原始表达；键只作附加信号，不因词表未命中就禁止查询。
  const text = (currentUserText || '').trim();
  if (text) return text;
  return (extractedKeys || '').trim();
}
function candidateInjectable(content, currentQuery) {
  const core = current.core(content);
  if (core.length < current.minChars) return { keep: false, reason: 'trivial_fragment' };
  if ((content || '').trim() === (currentQuery || '').trim()) return { keep: false, reason: 'self' };
  if (agentContext.SELF_HARM_SIGNAL_PATTERN.test(content))
    return { keep: false, reason: 'self_harm' };
  if (agentContext.MEMORY_EVIDENCE_ACK_PATTERN.test(core))
    return { keep: false, reason: 'pure_ack' };
  // 不再因"没有同一个字面词 / 人物不一致 / 是问句 / 情绪"直接删除；交给主模型结合原话判断。
  return { keep: true, reason: 'kept_for_model' };
}
function candidateSelect(memories, limit) {
  const bySource = new Map();
  for (const m of memories) {
    const key = m.sourceMessageId || m.id;
    const cur = bySource.get(key);
    if (!cur) {
      bySource.set(key, m);
      continue;
    }
    const curRaw = cur.memoryKind === 'raw_episode';
    const mRaw = m.memoryKind === 'raw_episode';
    if (mRaw && !curRaw) bySource.set(key, m);
  }
  const seenText = new Set();
  const out = [];
  for (const m of bySource.values()) {
    const text = (m.searchableText || '').replace(/\s+/g, '').toLowerCase();
    if (!text || seenText.has(text)) continue;
    seenText.add(text);
    out.push(m);
    if (out.length >= Math.max(1, Math.min(limit, 10))) break;
  }
  return out;
}

// ---- 构造诊断对（构造，非真实失败率） ----
const cases = [
  {
    id: 'D1-monitor',
    note: '构造：真实开发材料 TR-03 的监考原话',
    currentText: '我明天监考美术',
    old: [{ id: 'o1', sourceMessageId: 's1', memoryKind: 'raw_episode', personId: null, score: 0.9, searchableText: '明天我监考 美术 今天忙到好晚～' }],
  },
  {
    id: 'D2-throat',
    note: '构造：真实开发材料 TR-05 的嗓子原话',
    currentText: '嗓子好多了',
    old: [{ id: 'o1', sourceMessageId: 's1', memoryKind: 'raw_episode', personId: null, score: 0.88, searchableText: '爷爷，我今天嗓子好了一点了，你能不能在天上再保佑我再好一点呢' }],
  },
  {
    id: 'D3-school',
    note: '构造：换一种说法的上学/回校',
    currentText: '我明天去上学',
    old: [{ id: 'o1', sourceMessageId: 's1', memoryKind: 'raw_episode', personId: null, score: 0.8, searchableText: '已经把行李收拾好了，后天坐高铁回学校' }],
  },
  {
    id: 'D4-that-thing',
    note: '构造：指代“那个事”',
    currentText: '上次那个事终于办妥了',
    old: [{ id: 'o1', sourceMessageId: 's1', memoryKind: 'raw_episode', personId: null, score: 0.7, searchableText: '我明天坐高铁回去读书' }],
  },
  {
    id: 'D5-kin-only',
    note: '构造：带称呼但具体出行信息被键表丢掉',
    currentText: '爸爸我明天坐高铁回去读书',
    old: [{ id: 'o1', sourceMessageId: 's1', memoryKind: 'raw_episode', personId: null, score: 0.8, searchableText: '我明天坐高铁回去读书' }],
  },
  {
    id: 'D6-same-source-raw',
    note: '构造：同一来源既有抽取条又有原话，检查谁被保留',
    currentText: '我明天去上学',
    old: [
      { id: 'p1', sourceMessageId: 'same', memoryKind: 'open_item', personId: 'person-1', score: 0.95, searchableText: '用户计划去上学' },
      { id: 'r1', sourceMessageId: 'same', memoryKind: 'raw_episode', personId: null, score: 0.9, searchableText: '我收拾行李呢准备上学了，明天去' },
    ],
  },
  {
    id: 'D7-limit10',
    note: '构造：10 条候选，检查请求 10 条时的实际封顶',
    currentText: '我明天去上学',
    old: Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`,
      sourceMessageId: `s${i}`,
      memoryKind: 'raw_episode',
      personId: null,
      score: 0.9 - i * 0.01,
      searchableText: `第${i}条旧原话，关于行李和学校的事情`,
    })),
  },
  {
    id: 'D8-fragment',
    note: '构造：纯应答碎片，应该被两边都丢掉',
    currentText: '我明天去上学',
    old: [{ id: 'o1', sourceMessageId: 's1', memoryKind: 'raw_episode', personId: null, score: 0.9, searchableText: '嗯' }],
  },
  {
    id: 'D9-emotion-fact',
    note: '构造：情绪句里夹着事实（有没有见最后一面）',
    currentText: '我爸爸是什么样的人',
    old: [{ id: 'o1', sourceMessageId: 's1', memoryKind: 'raw_episode', personId: null, score: 0.85, searchableText: '你走的时候我都没见你最后一面' }],
  },
];

function runCase(c) {
  const extracted = current.buildQuery(c.currentText);
  const currentQuery = extracted; // 生产：抽不出键就不检索
  const currentTriggered = Boolean(currentQuery);
  const candidateQ = candidateQuery(c.currentText, extracted);
  const candidateTriggered = Boolean(candidateQ);

  const currentInjectable = c.old.map(m => ({
    id: m.id,
    injected: currentTriggered ? current.isInjectable(m.searchableText, c.currentText) : false,
  }));
  const candidateInjectable = c.old.map(m => ({
    id: m.id,
    keep: candidateInjectableCheck(m.searchableText, candidateQ).keep,
  }));

  const currentSelected = currentSelect(c.old, current.candidates);
  const candidateSelected = candidateSelect(c.old, current.candidates);

  return {
    id: c.id,
    note: c.note,
    currentText: c.currentText,
    extractedKeys: extracted,
    current: {
      triggered: currentTriggered,
      queryUsed: currentQuery,
      injectableIds: currentInjectable.filter(x => x.injected).map(x => x.id),
      selectedIds: currentSelected.map(m => m.id),
      selectedCount: currentSelected.length,
      injectLimit: current.injectLimit,
    },
    candidate: {
      triggered: candidateTriggered,
      queryUsed: candidateQ,
      injectableIds: candidateInjectable.filter(x => x.keep).map(x => x.id),
      selectedIds: candidateSelected.map(m => m.id),
      selectedCount: candidateSelected.length,
      projectedInjectLimit: Math.min(CANDIDATE_INJECT_LIMIT, candidateSelected.length),
    },
  };
}

function candidateInjectableCheck(content, currentText) {
  const core = current.core(content);
  if (core.length < current.minChars) return { keep: false, reason: 'trivial_fragment' };
  if ((content || '').trim() === (currentText || '').trim()) return { keep: false, reason: 'self' };
  if (agentContext.SELF_HARM_SIGNAL_PATTERN.test(content))
    return { keep: false, reason: 'self_harm' };
  if (agentContext.MEMORY_EVIDENCE_ACK_PATTERN.test(core))
    return { keep: false, reason: 'pure_ack' };
  return { keep: true, reason: 'kept_for_model' };
}

const results = cases.map(runCase);

// ---- 断言 ----
const assertions = [];
function assert(name, ok, detail) {
  assertions.push({ name, ok: Boolean(ok), detail });
}
const byId = Object.fromEntries(results.map(r => [r.id, r]));
assert('D1 空键导致自动入口不检索（复现）', byId['D1-monitor'].current.triggered === false && byId['D1-monitor'].candidate.triggered === true, JSON.stringify({ current: byId['D1-monitor'].current.queryUsed, candidate: byId['D1-monitor'].candidate.queryUsed }));
assert('D2 嗓子句空键（复现）', byId['D2-throat'].current.triggered === false && byId['D2-throat'].candidate.triggered === true, '');
assert('D3 换说法被字面键过滤（复现）+ 候选保留', byId['D3-school'].current.injectableIds.length === 0 && byId['D3-school'].candidate.injectableIds.includes('o1'), '');
assert('D4 指代句空键（复现）', byId['D4-that-thing'].current.triggered === false && byId['D4-that-thing'].candidate.triggered === true, '');
assert('D5 只按称呼检索（复现）', byId['D5-kin-only'].current.queryUsed === '爸 爸爸' && byId['D5-kin-only'].candidate.queryUsed.indexOf('高铁') >= 0, byId['D5-kin-only'].candidate.queryUsed);
assert('D6 同来源原话被剔除（复现）+ 候选保留原话', !byId['D6-same-source-raw'].current.selectedIds.includes('r1') && byId['D6-same-source-raw'].candidate.selectedIds.includes('r1'), JSON.stringify({ current: byId['D6-same-source-raw'].current.selectedIds, candidate: byId['D6-same-source-raw'].candidate.selectedIds }));
assert('D7 请求 10 条实际封顶 8（复现）+ 候选给到 10', byId['D7-limit10'].current.selectedCount === 8 && byId['D7-limit10'].candidate.selectedCount === 10, JSON.stringify({ current: byId['D7-limit10'].current.selectedCount, candidate: byId['D7-limit10'].candidate.selectedCount }));
assert('D8 碎片两边都丢', byId['D8-fragment'].candidate.injectableIds.length === 0, '');
assert('D9 情绪句夹事实：生产过滤、候选保留', byId['D9-emotion-fact'].current.injectableIds.length === 0 && byId['D9-emotion-fact'].candidate.injectableIds.includes('o1'), '');

const output = {
  commit: COMMIT,
  scope: 'production pure functions + isolated candidate；零 API/数据库调用',
  productionConstants: {
    AUTO_MEMORY_RETRIEVAL_CANDIDATES: current.candidates,
    AUTO_MEMORY_INJECT_LIMIT: current.injectLimit,
    AUTO_MEMORY_MIN_EVIDENCE_CHARACTERS: current.minChars,
    selectRelevantMemoriesHardCap: 8,
    candidateInjectLimit: CANDIDATE_INJECT_LIMIT,
  },
  results,
  assertions,
  allPassed: assertions.every(a => a.ok),
};
const outFile = path.join(__dirname, 'result.json');
fs.writeFileSync(outFile, JSON.stringify(output, null, 2) + '\n');
for (const a of assertions) console.log(`${a.ok ? 'PASS' : 'FAIL'} ${a.name}${a.detail ? ' :: ' + a.detail : ''}`);
console.log(output.allPassed ? 'ALL PASSED' : 'SOME FAILED');
console.log(`written ${outFile}`);
