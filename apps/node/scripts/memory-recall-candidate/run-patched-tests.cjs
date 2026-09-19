/**
 * 修正后的测试：直接调用"已应用补丁的隔离副本"里的实际函数，不再另写候选逻辑。
 *
 * 补丁位置：.task-evidence/cpu-recall-20260915/candidate-src/（= prod-src + proposed.patch）
 * 覆盖要求里的两种情况：
 *   - 空检索键（不再直接不检索）；
 *   - 有称呼但具体事情被删掉（查询保留完整表达）。
 * 另验证：短回复不新增搜索、同来源原话优先且不挤掉其他人物命中、请求 10 条给到 10。
 *
 * 用法：node apps/node/scripts/memory-recall-candidate/run-patched-tests.cjs
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const EVID = path.join(REPO, '.task-evidence/cpu-recall-20260915');
const PATCHED = path.join(EVID, 'candidate-src');
const PROD = path.join(EVID, 'prod-src');
const ts = require(path.join(REPO, 'apps/node/node_modules/typescript'));

function read(file) {
  return fs.readFileSync(file, 'utf8');
}
function loadModule(code, requireImpl) {
  const module = { exports: {} };
  const wrapper = vm.runInThisContext(
    `(function (exports, require, module) { ${code}\n})`,
    { filename: 'patched-module.js' }
  );
  wrapper(module.exports, requireImpl, module);
  return module.exports;
}
function transpileText(code) {
  return ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}
function pick(file, names) {
  const src = read(file);
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

// 未改动的依赖：从冒烟副本（prod-src）取
const memoryTopics = loadModule(transpileText(read(path.join(PROD, 'apps/node/src/service/agents/memory-topics.ts'))), () => {
  throw new Error('unexpected require in memory-topics');
});
const memoryValue = loadModule(transpileText(read(path.join(PROD, 'apps/node/src/service/agents/memory-value.ts'))), id => {
  if (id === '@tzl/entities') return { AgentProfileFactType: {}, MemoryGovernance: {} };
  if (id === 'node:crypto') return require('node:crypto');
  throw new Error(`unexpected require ${id}`);
});
const retrievalKeys = loadModule(
  transpileText(read(path.join(PROD, 'apps/node/src/service/memory/memory-retrieval-keys.ts'))),
  id => {
    if (id.endsWith('memory-value')) return memoryValue;
    if (id.endsWith('memory-topics')) return memoryTopics;
    throw new Error(`unexpected require ${id}`);
  }
);

// 已打补丁的 agent.context.ts：只取相关声明，其余依赖注入
const ctxNames = [
  'resolveSemanticRetrievalQuery',
  'shouldTriggerMemoryRetrieval',
  'hasEnoughSubstance',
  'isInjectableMemoryEvidenceLoose',
  'memoryEvidenceCore',
  'MEMORY_EVIDENCE_ACK_PATTERN',
  'SELF_HARM_SIGNAL_PATTERN',
  'AUTO_MEMORY_MIN_EVIDENCE_CHARACTERS',
  'AUTO_MEMORY_MIN_CORE_CHARACTERS',
  'AUTO_MEMORY_MIN_QUERY_CHARACTERS',
];
const ctx = loadModule(
  transpileText(
    `const { buildMemoryRetrievalQuery } = require('../memory/memory-retrieval-keys');
     const { HABIT_TOPIC_KEYS } = require('../agents/memory-topics');
     const { isEmotionalValue, kinshipGroupsIn } = require('../agents/memory-value');
     ${pick(path.join(PATCHED, 'apps/node/src/service/agents/agent.context.ts'), ctxNames)}
     Object.assign(module.exports, ${JSON.stringify(ctxNames)}.reduce((acc, n) => { acc[n] = eval(n); return acc; }, {}));`
  ),
  id => {
    if (id.endsWith('memory-retrieval-keys')) return retrievalKeys;
    if (id.endsWith('memory-topics')) return memoryTopics;
    if (id.endsWith('memory-value')) return memoryValue;
    throw new Error(`unexpected require ${id}`);
  }
);

// 已打补丁的 retrieve.service.ts
const retrieve = loadModule(
  transpileText(
    `${pick(path.join(PATCHED, 'apps/node/src/service/rag/retrieve.service.ts'), [
      'MAX_SELECTED_MEMORIES',
      'orderMemoriesRawFirst',
      'selectRelevantMemoriesPure',
    ])}`
  ),
  id => {
    throw new Error(`unexpected require ${id}`);
  }
);

const assertions = [];
const assert = (name, ok, detail) => assertions.push({ name, ok: Boolean(ok), detail });

// ---- 情况一：空检索键 ----
{
  const text = '我明天监考美术';
  const keys = retrievalKeys.buildMemoryRetrievalQuery(text);
  const trigger = ctx.shouldTriggerMemoryRetrieval(keys, text);
  const query = ctx.resolveSemanticRetrievalQuery(keys, text);
  assert('空检索键仍会检索', keys === '' && trigger === true, JSON.stringify({ keys, trigger, query }));
  assert('空检索键时用完整原话查询', query === text, query);
}

// ---- 情况二：有称呼但具体事情被删掉 ----
{
  const text = '爸爸我明天坐高铁回去读书';
  const keys = retrievalKeys.buildMemoryRetrievalQuery(text);
  const query = ctx.resolveSemanticRetrievalQuery(keys, text);
  assert(
    '有关键词时查询仍保留具体事情',
    keys === '爸 爸爸' && query === text && query.includes('高铁'),
    JSON.stringify({ keys, query })
  );
}

// ---- 短回复不新增搜索 ----
{
  const t1 = ctx.shouldTriggerMemoryRetrieval('', '嗯');
  const t2 = ctx.shouldTriggerMemoryRetrieval('', '好的');
  const t3 = ctx.shouldTriggerMemoryRetrieval('', '我明天坐高铁回去读书');
  assert('短回复不触发检索、实句触发', t1 === false && t2 === false && t3 === true, JSON.stringify({ t1, t2, t3 }));
}

// ---- 不过滤语义相关候选 ----
{
  const keep = ctx.isInjectableMemoryEvidenceLoose('已经把行李收拾好了，后天坐高铁回学校', '我明天去上学');
  const dropAck = ctx.isInjectableMemoryEvidenceLoose('嗯', '我明天去上学');
  assert('不再因缺字面键删候选、仍丢纯碎片', keep === true && dropAck === false, JSON.stringify({ keep, dropAck }));
}

// ---- 同来源原话优先，但不挤掉其他人物精确命中 ----
{
  const personSelected = [
    { id: 'p-same', sourceMessageId: 'same', searchableText: '用户计划去上学' },
    { id: 'p-other', sourceMessageId: 'other', searchableText: '另一位亲人的旧事' },
  ];
  const activeRaw = [
    { id: 'r-same', sourceMessageId: 'same', searchableText: '我收拾行李呢准备上学了，明天去' },
  ];
  const ordered = retrieve.orderMemoriesRawFirst(personSelected, activeRaw).map(m => m.id);
  assert(
    '原话优先且保留其他人物精确命中',
    ordered[0] === 'r-same' && ordered.includes('p-other') && !ordered.includes('p-same'),
    JSON.stringify(ordered)
  );
}

// ---- 请求 10 条给到 10 ----
{
  const memories = Array.from({ length: 10 }, (_, i) => ({
    id: `r${i}`,
    sourceMessageId: `s${i}`,
    searchableText: `第${i}条旧原话，关于行李和学校`,
  }));
  const selected = retrieve.selectRelevantMemoriesPure(memories, 10);
  assert('请求 10 条实际给到 10', selected.length === 10 && retrieve.MAX_SELECTED_MEMORIES === 10, `len=${selected.length}`);
}

// ---- 写入侧：事实+情绪/祈愿被整句排除在原话索引之外（复现，未修） ----
{
  const pureFact = memoryValue.isFactBearingUtterance('爸爸明天去医院复查');
  const factPlusEmotion = memoryValue.isFactBearingUtterance('爸爸明天去医院复查，你保佑他，我好想他');
  assert(
    '写入侧复现：事实句可入索引、事实+情绪/祈愿被排除',
    pureFact === true && factPlusEmotion === false,
    JSON.stringify({ pureFact, factPlusEmotion })
  );
}

const output = {
  date: new Date().toISOString(),
  patchedSource: 'candidate-src (= prod-src + proposed.patch)',
  note: '直接调用补丁后的实际函数；构造用例只证明机制，不代表真实召回效果',
  assertions,
  allPassed: assertions.every(a => a.ok),
};
fs.writeFileSync(path.join(__dirname, 'patched-tests-result.json'), JSON.stringify(output, null, 2) + '\n');
for (const a of assertions) console.log(`${a.ok ? 'PASS' : 'FAIL'} ${a.name} :: ${a.detail}`);
console.log(output.allPassed ? 'ALL PASSED' : 'SOME FAILED');
