/**
 * R00 起使用的对照评分：把"参考标注/场景期望"与"模型原始输出 + 解析结果 + 入库投影"逐层对照。
 * 语义正确性最终由人复核 diff.md；这里的数字只用于定位错误发生在哪一层。
 */

interface ReferenceEvent {
  kind: string;
  description: string;
  subject: string;
  evidenceIds: string[];
  state?: string;
  action?: string;
  targetItemId?: string;
  precision?: string;
  rawText?: string;
}

interface FragmentRef {
  fragmentId: string;
  mandatory: ReferenceEvent[];
  optional: ReferenceEvent[];
  forbidden: Array<{ description: string; why: string; evidenceIds: string[] }>;
  ambiguities?: string;
}

const CALENDAR = '纪念日';

function toFragmentRef(fragment: any): FragmentRef {
  const expected = fragment.expected;
  if (expected) {
    const convert = (rows: any[] = []): ReferenceEvent[] =>
      rows.map(row => ({
        kind: row.kind,
        description: row.description,
        subject:
          typeof row.subject === 'string'
            ? row.subject
            : row.subject?.label || '未知',
        evidenceIds:
          row.evidenceIds || (row.evidence || []).map((e: any) => e.messageId),
        state: row.state,
        action: row.action,
        targetItemId: row.targetItemId,
        precision: row.eventTime?.precision,
        rawText: row.eventTime?.rawText,
      }));
    return {
      fragmentId: fragment.fragmentId,
      mandatory: convert(expected.mandatory),
      optional: convert(expected.optional),
      forbidden: (expected.forbidden || []).map((row: any) => ({
        description: row.description,
        why: row.why,
        evidenceIds: row.evidenceIds || [],
      })),
      ambiguities: '',
    };
  }
  const reference = fragment.reference || {};
  const convert = (rows: any[] = []): ReferenceEvent[] =>
    rows.map(row => ({
      kind: row.kind,
      description: row.description,
      subject: row.subject?.label || '未知',
      evidenceIds: (row.evidence || []).map((e: any) => e.messageId),
      precision: row.eventTime?.precision,
      rawText: row.eventTime?.rawText,
    }));
  return {
    fragmentId: fragment.fragmentId,
    mandatory: convert(reference.mandatory),
    optional: convert(reference.optional),
    forbidden: (reference.forbidden || []).map((row: any) => ({
      description: row.description,
      why: row.why,
      evidenceIds: (row.evidence || []).map((e: any) => e.messageId),
    })),
    ambiguities: reference.ambiguities || '',
  };
}

function matchCandidate(reference: ReferenceEvent, candidate: any): boolean {
  const evidenceHit = reference.evidenceIds.includes(candidate.messageId);
  if (!evidenceHit) return false;
  const candidateIsCalendar = candidate.topicKey === CALENDAR;
  if (reference.kind === 'calendar') return candidateIsCalendar;
  return !candidateIsCalendar;
}

export function scoreRun(
  fragments: any[],
  results: any[],
  meta: {
    mode: string;
    model: string;
    dataset: string;
    split: string;
    tag: string;
    outDir: string;
  }
) {
  const byId = new Map(results.map(record => [record.fragmentId, record]));
  const referenceRows = fragments.map(fragment => ({
    fragment,
    reference: loadFragmentReference(fragment),
  }));

  let mandatoryTotal = 0;
  let mandatoryMatched = 0;
  let optionalTotal = 0;
  let optionalMatched = 0;
  let actionRequired = 0;
  let actionSatisfied = 0;
  let candidateTotal = 0;
  let candidateMatched = 0;
  let candidateUnmatched = 0;
  let forbiddenHits = 0;
  let jsonInvalid = 0;
  let truncated = 0;
  let modelFailed = 0;
  let emptyInput = 0;
  let declaredEvidence = 0;
  let declaredExact = 0;
  let relocated = 0;
  let quoteNotFound = 0;
  let programLoss = 0;
  let rawItems = 0;
  let parsedItems = 0;
  const rejectReasons: Record<string, number> = {};
  const createdTotal = { created: 0, updated: 0, skipped: 0 };
  const perLayer: Record<string, number> = {
    '输入被窗口/过滤丢掉消息的片段': 0,
    'raw 引文与声明 ID 不符（会被静默改源）': 0,
    'raw 引文在输入里找不到（被解析拒绝）': 0,
    'raw JSON 非法': 0,
    '输出被截断（finish_reason=length）': 0,
    模型原始有项但解析后全被拒: 0,
    '需要更新/关闭却只能新建（协议缺口）': 0,
  };
  const diffLines: string[] = [
    `# ${meta.mode} / ${meta.model} / ${meta.dataset}-${meta.split} 对照明细`,
    '',
    '每条：参考必收 → 是否命中；随后是模型实际输出的候选（类别/引文前 24 字）与拒绝原因。',
    '',
  ];

  for (const { fragment, reference } of referenceRows) {
    const record = byId.get(fragment.fragmentId);
    const diff: string[] = [
      `## ${fragment.fragmentId}${
        fragment.scenarioId ? ` (${fragment.scenarioId})` : ''
      }`,
      '',
    ];
    if (!record) {
      diff.push('- 无运行记录');
      diffLines.push(...diff);
      continue;
    }
    if (record.status === 'model_failed') {
      modelFailed += 1;
      diff.push(`- 模型调用失败：${record.error}`);
    }
    if (record.status === 'empty_input') emptyInput += 1;
    if (record.droppedByWindow > 0)
      perLayer['输入被窗口/过滤丢掉消息的片段'] += 1;

    const audit = record.rawAudit || {};
    if (audit.jsonValid === false && record.status !== 'model_failed') {
      jsonInvalid += 1;
      perLayer['raw JSON 非法'] += 1;
    }
    if (record.finishReason === 'length') {
      truncated += 1;
      perLayer['输出被截断（finish_reason=length）'] += 1;
    }
    rawItems += audit.itemsDeclared || 0;
    declaredEvidence +=
      (audit.quoteExactInDeclaredId || 0) +
      (audit.quoteFoundInOtherMessageOnly || 0) +
      (audit.quoteNotFound || 0);
    declaredExact += audit.quoteExactInDeclaredId || 0;
    relocated += audit.quoteFoundInOtherMessageOnly || 0;
    quoteNotFound += audit.quoteNotFound || 0;
    if ((audit.quoteFoundInOtherMessageOnly || 0) > 0) {
      perLayer['raw 引文与声明 ID 不符（会被静默改源）'] += 1;
    }
    if ((audit.quoteNotFound || 0) > 0)
      perLayer['raw 引文在输入里找不到（被解析拒绝）'] += 1;

    const candidates = record.candidates || [];
    parsedItems += candidates.length;
    if ((audit.itemsDeclared || 0) > 0 && candidates.length === 0) {
      perLayer['模型原始有项但解析后全被拒'] += 1;
    }
    programLoss += Math.max(
      0,
      (audit.quoteExactInDeclaredId || 0) - candidates.length
    );
    for (const rejected of record.rejected || []) {
      rejectReasons[rejected.reason] =
        (rejectReasons[rejected.reason] || 0) + 1;
    }
    candidateTotal += candidates.length;

    const matchedCandidateIndex = new Set<number>();

    const summarize = (
      event: ReferenceEvent,
      matched: boolean,
      candidate?: any
    ) => {
      const evidence = event.evidenceIds.join(',');
      const target = candidate
        ? `候选[${candidate.topicKey}] ${String(candidate.quote).slice(0, 24)}`
        : '未命中';
      return `- ${matched ? '✅' : '❌'} ${event.kind}｜${
        event.description
      }｜主体=${event.subject}｜证据=${evidence}${
        event.action ? `｜动作=${event.action}` : ''
      } → ${target}`;
    };

    for (const event of reference.mandatory) {
      mandatoryTotal += 1;
      let matched = false;
      let matchedCandidate: any;
      candidates.forEach((candidate: any, index: number) => {
        if (matched) return;
        if (matchCandidate(event, candidate)) {
          matched = true;
          matchedCandidate = candidate;
          matchedCandidateIndex.add(index);
        }
      });
      if (matched) mandatoryMatched += 1;
      if (event.action) {
        actionRequired += 1;
        const operationMatch = (record.operations || []).find(
          (operation: any) =>
            event.evidenceIds.includes(operation.evidence?.[0]?.messageId) ||
            operation.targetItemId === event.targetItemId
        );
        const actionEquivalent =
          !!operationMatch &&
          (operationMatch.action === event.action ||
            (event.action === 'resolve_or_update' &&
              ['resolve', 'update'].includes(operationMatch.action)) ||
            (event.action === 'update' && operationMatch.action === 'update'));
        if (actionEquivalent) actionSatisfied += 1;
        else perLayer['需要更新/关闭却只能新建（协议缺口）'] += 1;
        diff.push(
          summarize(event, matched, matchedCandidate) +
            `｜动作识别=${operationMatch ? operationMatch.action : '未输出'}`
        );
        continue;
      }
      if (false) {
        const seededHex = record.seededIds?.[event.targetItemId || ''];
        const storageItem = (record.storageItems || []).find(
          (item: any) => item.id === seededHex || item.id === event.targetItemId
        );
        const changed =
          storageItem &&
          (storageItem.state === event.state ||
            storageItem.evidenceCount > (event.evidenceIds.length || 0) ||
            matched);
        if (changed) actionSatisfied += 1;
        else perLayer['需要更新/关闭却只能新建（协议缺口）'] += 1;
      }
      diff.push(summarize(event, matched, matchedCandidate));
    }
    for (const event of reference.optional) {
      optionalTotal += 1;
      let matched = false;
      candidates.forEach((candidate: any, index: number) => {
        if (matched) return;
        if (matchCandidate(event, candidate)) {
          matched = true;
          matchedCandidateIndex.add(index);
        }
      });
      if (matched) optionalMatched += 1;
      diff.push(
        `- ${matched ? '✅(optional)' : '➖(optional 未收)'} ${
          event.description
        }`
      );
    }
    candidates.forEach((candidate: any, index: number) => {
      if (matchedCandidateIndex.has(index)) candidateMatched += 1;
      else candidateUnmatched += 1;
    });
    for (const forbidden of reference.forbidden) {
      const hit = candidates.some(
        (candidate: any) =>
          forbidden.evidenceIds.length &&
          forbidden.evidenceIds.includes(candidate.messageId)
      );
      if (hit) forbiddenHits += 1;
      diff.push(
        `- ${hit ? '⚠️ 命中禁收' : '⛔未命中禁收'} ${forbidden.description}`
      );
    }
    createdTotal.created += record.written?.created || 0;
    createdTotal.updated += record.written?.updated || 0;
    createdTotal.skipped += record.written?.skipped || 0;

    diff.push('', '**模型实际输出：**');
    if (!candidates.length) diff.push('- （空）');
    for (const candidate of candidates) {
      diff.push(
        `- [${candidate.topicKey}/${candidate.state}] ${String(
          candidate.quote
        ).slice(0, 40)}（${candidate.messageId}）`
      );
    }
    if ((record.rejected || []).length) {
      diff.push(
        `- 被拒：${record.rejected.map((item: any) => item.reason).join('、')}`
      );
    }
    diff.push(
      `- 入库：新建${record.written?.created || 0} 更新${
        record.written?.updated || 0
      } 跳过${record.written?.skipped || 0}；库存${
        (record.storageItems || []).length
      }条`
    );
    diff.push('');
    diffLines.push(...diff);
  }

  const metrics = {
    fragments: fragments.length,
    必收事件召回: mandatoryTotal
      ? `${mandatoryMatched}/${mandatoryTotal} = ${(
          (mandatoryMatched / mandatoryTotal) *
          100
        ).toFixed(1)}%`
      : 'n/a',
    可选事件命中: optionalTotal ? `${optionalMatched}/${optionalTotal}` : 'n/a',
    更新动作正确率: actionRequired
      ? `${actionSatisfied}/${actionRequired} = ${(
          (actionSatisfied / actionRequired) *
          100
        ).toFixed(1)}%`
      : 'n/a',
    输出候选总数: candidateTotal,
    命中参考的候选: candidateMatched,
    无参考对应候选: candidateUnmatched,
    禁收命中条数: forbiddenHits,
    'raw 声明证据数': declaredEvidence,
    'raw 引文完全自洽': declaredExact,
    'raw 引文被静默改源条数': relocated,
    'raw 引文找不到条数': quoteNotFound,
    'raw JSON 非法片段': jsonInvalid,
    输出截断片段: truncated,
    模型失败片段: modelFailed,
    空输入片段: emptyInput,
    模型原始项数: rawItems,
    解析后候选数: parsedItems,
    程序额外损失条目估计: programLoss,
    拒绝原因: rejectReasons,
    入库合计: createdTotal,
    分层计数: perLayer,
  };

  return {
    meta,
    metrics,
    diffMarkdown: diffLines.join('\n'),
  };
}

function loadFragmentReference(fragment: any): FragmentRef {
  if (fragment.expected) return toFragmentRef({ ...fragment, reference: null });
  const reference = labelIndex().get(fragment.fragmentId);
  return toFragmentRef({
    fragmentId: fragment.fragmentId,
    reference: reference || { mandatory: [], optional: [], forbidden: [] },
  });
}

let labelCache: Map<string, any> | undefined;

function labelIndex(): Map<string, any> {
  if (labelCache) return labelCache;
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(
    path.resolve(__dirname, '../../../..'),
    '.task-evidence/return-extraction-v2/private/labels'
  );
  const map = new Map<string, any>();
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      if (!file.startsWith('labels-') || !file.endsWith('.jsonl')) continue;
      for (const line of fs
        .readFileSync(path.join(dir, file), 'utf8')
        .split('\n')) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          map.set(row.fragmentId, row);
        } catch {
          /* 未完成的标注行忽略 */
        }
      }
    }
  }
  labelCache = map;
  return map;
}
