#!/usr/bin/env node
/**
 * 离世日期回填 dry-run（只读）。
 *
 * 目标：在不写任何生产数据的前提下，找出“没有精确离世日期、但历史原话里
 * 可能提到过离世时间”的 agent，输出候选和置信度，供人工抽样复核。
 *
 * 设计：
 * - 只读 Mongo，不调用模型，不写库；
 * - 先按 agent 缺失 deathDate / person_temporal_profile 过滤，再用最近消息活跃度
 *   缩小范围，最后只查命中死亡词的消息；
 * - 规则只做高置信度的时间归一化，模糊表达单独标低置信度；
 * - 输出写服务器 /tmp，stdout 只打印聚合统计，避免把原文带进日志。
 *
 * 用法（容器内）：
 *   node /tmp/backfill-departure-dates-dry-run.js --days=365
 *   node /tmp/backfill-departure-dates-dry-run.js --days=365 --stats-only
 *   node /tmp/backfill-departure-dates-dry-run.js --days=730 --include-vague
 */

const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const DEFAULT_OUTPUT = '/tmp/tzl-departure-backfill-dry-run.json';
const DAY_MS = 86_400_000;

const DEATH_MARKER =
  /(?:走(?:了|的|那天|的时候|后)|离开(?:我们|我|大家|这个世界|人世)?|去世|过世|离世|不在了|没在了|人没了|头七|三七|五七|七七|百日|百天|周年|忌日|祭日)/;
const HARD_DEATH_MARKER =
  /(?:走(?:了|的|那天|的时候|后)|去世|过世|离世|不在了|没在了|人没了)/;
const LEAVE_PLACE_PATTERN =
  /离开(?:家|公司|学校|医院|单位|这里|那里|北京|上海|广州|深圳|老家)/;
const NEGATION_OR_HYPOTHETICAL =
  /(?:没有|没|不是|并未|未曾|如果|要是|假如|万一|是否|是不是|好像|似乎|听说).{0,8}(?:走|离开|去世|过世|离世)/;
const NON_PERSON_ANNIVERSARY =
  /(?:结婚|生日|开业|公司|入职|在一起|恋爱|分手|毕业|周年庆|工作|创业|项目|开店)/;

const CHINESE_DIGITS = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function parseChineseNumber(value) {
  if (/^\d+$/.test(value)) return Number(value);
  let total = 0;
  let current = 0;
  for (const char of value) {
    if (char === '百') {
      total += (current || 1) * 100;
      current = 0;
    } else if (char === '十') {
      total += (current || 1) * 10;
      current = 0;
    } else if (CHINESE_DIGITS[char]) {
      current = CHINESE_DIGITS[char];
    }
  }
  return total + current;
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function dateKey(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return undefined;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate()
  )}`;
}

function parseDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((value || '').trim());
  if (!match) return undefined;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  );
  if (
    date.getUTCFullYear() !== Number(match[1]) ||
    date.getUTCMonth() + 1 !== Number(match[2]) ||
    date.getUTCDate() !== Number(match[3])
  ) {
    return undefined;
  }
  return date;
}

function shiftDays(value, days) {
  const d = new Date(value);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function shiftMonths(value, months) {
  const d = new Date(value);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

function shiftYears(value, years) {
  return shiftMonths(value, years * 12);
}

function rangeAround(center, beforeDays, afterDays) {
  return {
    estimatedStart: dateKey(shiftDays(center, -beforeDays)),
    estimatedEnd: dateKey(shiftDays(center, afterDays)),
  };
}

const FUTURE_PLAN_PATTERN =
  /(?:等|那天|时候|回去|去看你|给你做|准备|打算|计划|改天|以后|下次|过几天)/;
const ALMOST_PATTERN = /(?:快|马上|就要|差不多|将近|不到|还差|差几天|快过|快到了|赶不上|来不及|没能|错过)/;
const PLANNING_PATTERN =
  /(?:本来|原计划|打算|计划|准备|说好|约好|要去|要给|去买|结果)/;
const NON_DEATH_DATE_CONTEXT =
  /(?:出生|生日|结婚|入院|住院|手术|出院|毕业|入职|上班|开学)/;
const NON_DEPARTURE_MILESTONE =
  /(?:宝宝|孩子|出生|满月|百天照|新生儿|婴儿|百日宴)/;

function extractOffset(clause) {
  if (/大后天/.test(clause)) return { days: 3, precise: true };
  if (/后天/.test(clause)) return { days: 2, precise: true };
  if (/明天|明日/.test(clause)) return { days: 1, precise: true };
  if (/今天|今日/.test(clause)) return { days: 0, precise: true };
  if (/昨天|昨日/.test(clause)) return { days: -1, precise: true };
  if (/前天/.test(clause)) return { days: -2, precise: true };
  if (/前几天/.test(clause)) return { days: -3, precise: false };
  if (/过几天|过两天/.test(clause)) return { days: 3, precise: false };
  const plus = /(?:还有|再有|差)\s*(\d{1,3}|[一二两三四五六七八九十百]+)\s*天/.exec(
    clause
  );
  if (plus) {
    return { days: parseChineseNumber(plus[1]), precise: true };
  }
  const after = /(\d{1,3}|[一二两三四五六七八九十百]+)\s*天后/.exec(clause);
  if (after) {
    return { days: parseChineseNumber(after[1]), precise: true };
  }
  if (/刚过|刚过完|过了|已经过/.test(clause)) {
    return { days: -1, precise: false };
  }
  return undefined;
}

function findDeathMarker(clause) {
  return DEATH_MARKER.exec(clause);
}

function dateContextAllowed(clause, match) {
  const marker = findDeathMarker(clause);
  if (!marker) return false;
  const start = match.index;
  const end = start + match[0].length;
  const markerStart = marker.index;
  const distance =
    end <= markerStart
      ? markerStart - end
      : start >= markerStart
      ? start - markerStart
      : 0;
  if (distance > 20) return false;
  if (PLANNING_PATTERN.test(clause.slice(0, start))) return false;
  if (NON_DEATH_DATE_CONTEXT.test(clause.slice(end, end + 12))) return false;
  return true;
}

function buildCandidate(options) {
  const strongSubject =
    options.subjectHint === 'second_person' ||
    options.subjectHint === 'agent_name';
  const confidence =
    !strongSubject && options.confidence === 'high'
      ? 'medium'
      : options.confidence;
  return {
    kind: options.kind,
    confidence,
    score: options.score,
    matched: options.matched,
    subjectHint: options.subjectHint || 'unspecified',
    snippet: options.snippet,
    ...(options.exactDate ? { exactDate: options.exactDate } : {}),
    ...(options.estimatedStart ? { estimatedStart: options.estimatedStart } : {}),
    ...(options.estimatedEnd ? { estimatedEnd: options.estimatedEnd } : {}),
  };
}

function hintFromText(text, names) {
  if (/你|您/.test(text)) return 'second_person';
  if (names.some(name => name && text.includes(name))) return 'agent_name';
  if (
    /(?:我)?(?:爸|妈|父亲|母亲|爷爷|奶奶|外公|外婆|姥姥|姥爷|公公|婆婆|老公|老婆|丈夫|妻子|儿子|女儿|哥哥|姐姐|弟弟|妹妹)/.test(
      text
    )
  ) {
    return 'other_person';
  }
  return 'unspecified';
}

function subjectHint(clause, names) {
  const marker = findDeathMarker(clause);
  if (marker) {
    // 先看死亡词附近的主语，避免“老爸也走了……你下葬”被整句里的“你”带偏。
    const before = clause.slice(Math.max(0, marker.index - 12), marker.index);
    const after = clause.slice(
      marker.index + marker[0].length,
      marker.index + marker[0].length + 4
    );
    const local = hintFromText(before + after, names);
    if (local !== 'unspecified') return local;
  }
  return hintFromText(clause, names);
}

function scoreFor(kind, confidence, hint) {
  const base = {
    exact: 100,
    partial_date: 70,
    day: 82,
    milestone: 76,
    month: 62,
    year: 52,
    relative_year: 36,
    vague: 18,
  }[kind] || 0;
  const hintScore =
    hint === 'second_person' ? 14 : hint === 'agent_name' ? 10 : hint === 'other_person' ? -22 : 0;
  return base + hintScore + (confidence === 'high' ? 8 : confidence === 'medium' ? 0 : -8);
}

function extractFromClause(clause, referenceAt, names, includeVague) {
  if (!DEATH_MARKER.test(clause)) return undefined;
  if (NEGATION_OR_HYPOTHETICAL.test(clause)) return undefined;
  if (!HARD_DEATH_MARKER.test(clause) && LEAVE_PLACE_PATTERN.test(clause)) {
    return undefined;
  }

  const hint = subjectHint(clause, names);
  const matchedClause = clause.slice(0, 160);

  // 1. 完整公历日期：他 2023 年 10 月 8 日走的
  const dateMatch =
    /((?:19|20)\d{2}|\d{2})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*[日号]?/.exec(
      clause
    );
  if (dateMatch && dateContextAllowed(clause, dateMatch)) {
    let y = Number(dateMatch[1]);
    if (dateMatch[1].length === 2) {
      y += y <= 30 ? 2000 : 1900;
    }
    const m = Number(dateMatch[2]);
    const d = Number(dateMatch[3]);
    const exact = new Date(Date.UTC(y, m - 1, d));
    const valid =
      exact.getUTCFullYear() === y &&
      exact.getUTCMonth() + 1 === m &&
      exact.getUTCDate() === d;
    if (valid && exact.getTime() <= referenceAt.getTime()) {
      const confidence = 'high';
      return buildCandidate({
        kind: 'exact',
        confidence,
        score: scoreFor('exact', confidence, hint),
        matched: dateMatch[0],
        subjectHint: hint,
        snippet: matchedClause,
        exactDate: dateKey(exact),
      });
    }
  }

  // 1b. 只有月日：10 月 8 日走的；年份按“去年/前年/今年”或最近过去推断
  const partialMatch = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/.exec(clause);
  if (partialMatch && dateContextAllowed(clause, partialMatch)) {
    const m = Number(partialMatch[1]);
    const d = Number(partialMatch[2]);
    const relative = /(去年|前年|今年)/.exec(clause);
    let y = referenceAt.getUTCFullYear();
    if (relative) {
      y -= relative[1] === '去年' ? 1 : relative[1] === '前年' ? 2 : 0;
    }
    let exact = new Date(Date.UTC(y, m - 1, d));
    if (exact.getTime() > referenceAt.getTime() && !relative) {
      exact = new Date(Date.UTC(y - 1, m - 1, d));
    }
    const valid =
      exact.getUTCMonth() + 1 === m && exact.getUTCDate() === d;
    if (valid && exact.getTime() <= referenceAt.getTime()) {
      const confidence = 'medium';
      return buildCandidate({
        kind: 'partial_date',
        confidence,
        score: scoreFor('partial_date', confidence, hint),
        matched: partialMatch[0],
        subjectHint: hint,
        snippet: matchedClause,
        exactDate: dateKey(exact),
      });
    }
  }

  // 2. 周年/忌日：三周年、五七、百日
  const anniversary =
    /(\d{1,3}|[一二两三四五六七八九十百]+)\s*(?:个)?\s*周年/.exec(clause) ||
    /(\d{1,3}|[一二两三四五六七八九十百]+)\s*(?:个)?\s*年\s*(?:忌日|祭日)/.exec(
      clause
    );
  if (
    anniversary &&
    !NON_PERSON_ANNIVERSARY.test(clause) &&
    !/过完[^。！？\n]{0,8}周年[^。！？\n]{0,8}那年/.test(clause) &&
    !/周年[^。！？\n]{0,6}那年/.test(clause)
  ) {
    const years = parseChineseNumber(anniversary[1]);
    const offset = extractOffset(clause);
    if (!offset && FUTURE_PLAN_PATTERN.test(clause)) {
      // “过几天/等我周年回去看你”没有明确偏移，不能把消息日当周年日。
    } else if (years >= 1 && years <= 100) {
      const eventAt = shiftDays(referenceAt, offset ? offset.days : 0);
      const center = shiftYears(eventAt, -years);
      const range = rangeAround(center, 30, 30);
      const confidence = 'medium';
      return buildCandidate({
        kind: 'year',
        confidence,
        score: scoreFor('year', confidence, hint) + 10,
        matched: anniversary[0],
        subjectHint: hint,
        snippet: matchedClause,
        ...range,
      });
    }
  }

  const milestone =
    /(头七|头7|一七|二七|三七|五七|七七|百日|百天|100天)/.exec(clause);
  if (milestone) {
    const map = {
      头七: 7,
      头7: 7,
      一七: 7,
      二七: 14,
      三七: 21,
      五七: 35,
      七七: 49,
      百日: 100,
      百天: 100,
      '100天': 100,
    };
    const day = map[milestone[1]];
    const offset = extractOffset(clause);
    const almost = ALMOST_PATTERN.test(clause);
    if (
      NON_DEPARTURE_MILESTONE.test(clause) &&
      !HARD_DEATH_MARKER.test(clause)
    ) {
      return undefined;
    }
    if (offset || !FUTURE_PLAN_PATTERN.test(clause)) {
      // 含当天算法：头七 = 离开后第 7 天，所以离世日 = 仪式日 - (day - 1)
      const eventAt = shiftDays(referenceAt, offset ? offset.days : 0);
      const center = shiftDays(eventAt, -(day - 1));
      const uncertain = almost || (offset && !offset.precise);
      const range = uncertain
        ? rangeAround(center, 5, 5)
        : rangeAround(center, 1, 1);
      const explicitDeath = HARD_DEATH_MARKER.test(clause);
      const weakSubject =
        hint !== 'second_person' && hint !== 'agent_name';
      const confidence =
        uncertain || (!explicitDeath && weakSubject) ? 'medium' : 'high';
      return buildCandidate({
        kind: 'milestone',
        confidence,
        score: scoreFor('milestone', confidence, hint),
        matched: milestone[0],
        subjectHint: hint,
        snippet: matchedClause,
        ...range,
      });
    }
  }

  // 2b. 半年：走了半年
  const halfYear = /(?:走(?:了|的|后)|离开(?:我们|我|大家|这个世界|人世)?|去世|过世|离世)(?:已经|都|快|马上|就|整整|正好|差不多|大概|有)?\s*半年/.exec(
    clause
  );
  if (halfYear) {
    const center = shiftMonths(referenceAt, -6);
    const range = rangeAround(center, 15, 15);
    const confidence = 'medium';
    return buildCandidate({
      kind: 'month',
      confidence,
      score: scoreFor('month', confidence, hint),
      matched: halfYear[0],
      subjectHint: hint,
      snippet: matchedClause,
      ...range,
    });
  }

  // 3. 明确时长：走了 N 天 / N 个月 / N 年
  const durationMatch =
    /(?:走(?:了|的|后)|离开(?:我们|我|大家|这个世界|人世)?|去世|过世|离世)(?:已经|都|快|马上|就|整整|正好|差不多|大概|有)?\s*(\d{1,3}|[一二两三四五六七八九十百]+)\s*(天|日|个?多?月|年)/.exec(
      clause
    );
  if (durationMatch) {
    const value = parseChineseNumber(durationMatch[1]);
    const unit = durationMatch[2];
    if (value > 0) {
      if (unit === '天' || unit === '日') {
        const center = shiftDays(referenceAt, -value);
        const range = rangeAround(center, 1, 1);
        const confidence = value <= 100 ? 'high' : 'medium';
        return buildCandidate({
          kind: 'day',
          confidence,
          score: scoreFor('day', confidence, hint),
          matched: durationMatch[0],
          subjectHint: hint,
          snippet: matchedClause,
          ...range,
        });
      }
      if (unit.endsWith('月')) {
        const center = shiftMonths(referenceAt, -value);
        const isMore = /多/.test(durationMatch[0]);
        const range = isMore
          ? rangeAround(center, 30, 0)
          : rangeAround(center, 15, 15);
        const confidence = 'medium';
        return buildCandidate({
          kind: 'month',
          confidence,
          score: scoreFor('month', confidence, hint),
          matched: durationMatch[0],
          subjectHint: hint,
          snippet: matchedClause,
          ...range,
        });
      }
      if (unit === '年') {
        const center = shiftYears(referenceAt, -value);
        const range = rangeAround(center, 182, 182);
        const confidence = value <= 5 ? 'medium' : 'low';
        return buildCandidate({
          kind: 'year',
          confidence,
          score: scoreFor('year', confidence, hint),
          matched: durationMatch[0],
          subjectHint: hint,
          snippet: matchedClause,
          ...range,
        });
      }
    }
  }

  // 4. 去年/前年/今年 + 死亡词：只能给到年份范围
  const relativeYear = /(去年|前年|今年)/.exec(clause);
  if (relativeYear) {
    const year = referenceAt.getUTCFullYear() - (relativeYear[1] === '去年' ? 1 : relativeYear[1] === '前年' ? 2 : 0);
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year, 11, 31));
    if (end.getTime() <= referenceAt.getTime()) {
      const confidence = 'low';
      return buildCandidate({
        kind: 'relative_year',
        confidence,
        score: scoreFor('relative_year', confidence, hint),
        matched: relativeYear[0],
        subjectHint: hint,
        snippet: matchedClause,
        estimatedStart: dateKey(start),
        estimatedEnd: dateKey(end),
      });
    }
  }

  // 5. 模糊多年：只在显式 includeVague 时输出，默认跳过
  if (includeVague) {
    const vague = /(十几年|二十多年|好几年|很多年|几年)/.exec(clause);
    if (vague) {
      const years = vague[1] === '十几年' ? 15 : vague[1] === '二十多年' ? 25 : 5;
      const center = shiftYears(referenceAt, -years);
      const range = rangeAround(center, 365 * 5, 365 * 5);
      const confidence = 'low';
      return buildCandidate({
        kind: 'vague',
        confidence,
        score: scoreFor('vague', confidence, hint),
        matched: vague[0],
        subjectHint: hint,
        snippet: matchedClause,
        ...range,
      });
    }
  }

  return undefined;
}

/**
 * 从一条消息中抽取离世时间候选。
 * @param {string} text
 * @param {Date} referenceAt
 * @param {{names?: string[], includeVague?: boolean}} options
 * @returns {Array<object>}
 */
function extractDepartureCandidates(text, referenceAt, options = {}) {
  const content = String(text || '').slice(0, 4000);
  if (!content || !DEATH_MARKER.test(content)) return [];
  const names = (options.names || []).filter(Boolean);
  const includeVague = Boolean(options.includeVague);
  const clauses = content
    .split(/[。！？!?；;\n，,]/)
    .map(value => value.trim())
    .filter(Boolean);
  const results = [];
  for (const clause of clauses) {
    const candidate = extractFromClause(
      clause,
      referenceAt,
      names,
      includeVague
    );
    if (candidate) results.push(candidate);
  }
  return results;
}

function pickBest(candidates) {
  if (!candidates.length) return undefined;
  return candidates.slice().sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return 0;
  })[0];
}

function parseArgs(argv) {
  const args = {
    days: 365,
    statsOnly: false,
    includeVague: false,
    output: DEFAULT_OUTPUT,
    maxMessagesPerAgent: 40,
    batchSize: 120,
    sample: 10,
    verbose: false,
    limitAgents: 0,
  };
  for (const raw of argv.slice(2)) {
    if (raw === '--stats-only') args.statsOnly = true;
    else if (raw === '--include-vague') args.includeVague = true;
    else if (raw === '--verbose') args.verbose = true;
    else if (raw.startsWith('--days=')) args.days = Number(raw.slice(7)) || args.days;
    else if (raw.startsWith('--output=')) args.output = raw.slice(9);
    else if (raw.startsWith('--max-messages-per-agent='))
      args.maxMessagesPerAgent = Number(raw.slice(25)) || args.maxMessagesPerAgent;
    else if (raw.startsWith('--batch-size='))
      args.batchSize = Number(raw.slice(13)) || args.batchSize;
    else if (raw.startsWith('--sample=')) args.sample = Number(raw.slice(9)) || args.sample;
    else if (raw.startsWith('--limit-agents='))
      args.limitAgents = Number(raw.slice(15)) || args.limitAgents;
  }
  return args;
}

function mongoOptionsFromEnv() {
  const host = process.env.NODE_MONGO_HOST || 'tzl_mongo';
  const port = Number(process.env.NODE_MONGO_PORT || 27017);
  const database = process.env.NODE_MONGO_DB || 'tzl';
  const authSource = process.env.NODE_MONGO_AUTH_SOURCE || 'admin';
  const username = process.env.NODE_MONGO_USERNAME || 'admin';
  const password = process.env.NODE_MONGO_PASSWORD || 'qwerasdf';
  return { host, port, database, authSource, username, password };
}

async function connect() {
  if (process.env.MONGODB_URI) {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    return { client, db: client.db() };
  }
  const options = mongoOptionsFromEnv();
  const client = new MongoClient(`mongodb://${options.host}:${options.port}`, {
    auth: { username: options.username, password: options.password },
    authSource: options.authSource,
    directConnection: true,
    maxPoolSize: 4,
    serverSelectionTimeoutMS: 10_000,
  });
  await client.connect();
  return { client, db: client.db(options.database) };
}

function printSummary(stats, output, sample, args) {
  console.log('[departure-dry-run] stats', JSON.stringify(stats, null, 2));
  console.log(`[departure-dry-run] output=${output}`);
  if (args.statsOnly) return;
  const candidates = sample || [];
  for (const item of candidates) {
    console.log(
      `[sample] agent=${item.agentId} kind=${item.kind} confidence=${item.confidence} score=${item.score} subject=${item.subjectHint} exact=${item.exactDate || '-'} range=${item.estimatedStart || '-'}..${item.estimatedEnd || '-'} matched=${JSON.stringify(item.matched)}`
    );
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const startedAt = Date.now();
  const cutoff = new Date(startedAt - args.days * DAY_MS);
  const cutoffId = ObjectId.createFromTime(Math.floor(cutoff.getTime() / 1000));

  console.log(
    `[departure-dry-run] start days=${args.days} statsOnly=${args.statsOnly} includeVague=${args.includeVague}`
  );
  const { client, db } = await connect();
  try {
    const agents = await db
      .collection('agent')
      .find(
        {
          status: 1,
          messengerOfAgentId: { $exists: false },
          $or: [{ deathDate: null }, { deathDate: { $exists: false } }],
        },
        {
          projection: {
            name: 1,
            realName: 1,
            iCallAgent: 1,
            createdUserId: 1,
            departureDuration: 1,
            updatedAt: 1,
          },
        }
      )
      .toArray();
    const missingAgents = new Map(
      agents.map(agent => [String(agent._id), agent])
    );
    console.log(`[departure-dry-run] missing_death_agents=${agents.length}`);

    const profiles = await db
      .collection('person_temporal_profile')
      .find(
        {
          subjectType: 'agent',
          eventType: 'death',
          $or: [
            { exactDate: { $type: 'date' } },
            { estimatedStart: { $type: 'date' } },
            { estimatedEnd: { $type: 'date' } },
          ],
        },
        { projection: { subjectId: 1 } }
      )
      .toArray();
    const covered = new Set(profiles.map(profile => String(profile.subjectId)));
    for (const id of covered) missingAgents.delete(id);
    console.log(
      `[departure-dry-run] profile_covered=${covered.size} remaining_after_profile=${missingAgents.size}`
    );

    const activeRows = await db
      .collection('message')
      .aggregate(
        [
          {
            $match: {
              _id: { $gte: cutoffId },
              role: 'user',
              status: 'sent',
            },
          },
          {
            $group: {
              _id: '$agentId',
              count: { $sum: 1 },
              last: { $max: '$createdAt' },
            },
          },
        ],
        { allowDiskUse: true, maxTimeMS: 120_000 }
      )
      .toArray();
    const activeIds = [];
    for (const row of activeRows) {
      const id = String(row._id);
      if (missingAgents.has(id)) activeIds.push(id);
    }
    console.log(
      `[departure-dry-run] active_candidate_agents=${activeIds.length} (active_rows=${activeRows.length})`
    );

    const stats = {
      generatedAt: new Date().toISOString(),
      days: args.days,
      totalAgents: await db.collection('agent').countDocuments({}),
      missingDeathAgents: agents.length,
      profileCovered: covered.size,
      remainingAfterProfile: missingAgents.size,
      activeAgents: activeRows.length,
      activeCandidateAgents: activeIds.length,
      loadedMessages: 0,
      matchedMessages: 0,
      candidates: 0,
      byConfidence: { high: 0, medium: 0, low: 0 },
      byKind: {},
      elapsedMs: 0,
    };

    if (args.statsOnly) {
      stats.elapsedMs = Date.now() - startedAt;
      printSummary(stats, args.output, [], args);
      return;
    }

    const ids = args.limitAgents > 0 ? activeIds.slice(0, args.limitAgents) : activeIds;
    const bestByAgent = new Map();
    const messages = db.collection('message');

    for (let offset = 0; offset < ids.length; offset += args.batchSize) {
      const batch = ids.slice(offset, offset + args.batchSize);
      const docs = await messages
        .find(
          {
            agentId: {
              $in: batch.map(id => new ObjectId(id)),
            },
            role: 'user',
            status: 'sent',
            _id: { $gte: cutoffId },
            content: {
              $regex:
                '走了|离开|去世|过世|离世|不在了|没在了|人没了|头七|三七|五七|七七|百日|百天|周年|忌日|祭日',
            },
          },
          {
            projection: {
              agentId: 1,
              userId: 1,
              conversationId: 1,
              content: 1,
              createdAt: 1,
              sourceOccurredAt: 1,
            },
          }
        )
        .sort({ createdAt: -1 })
        .batchSize(500)
        .toArray();

      stats.loadedMessages += docs.length;
      const perAgentCount = new Map();
      for (const doc of docs) {
        const agentId = String(doc.agentId);
        const agent = missingAgents.get(agentId);
        if (!agent) continue;
        const count = perAgentCount.get(agentId) || 0;
        if (count >= args.maxMessagesPerAgent) continue;
        perAgentCount.set(agentId, count + 1);
        const referenceAt =
          doc.sourceOccurredAt instanceof Date
            ? doc.sourceOccurredAt
            : doc.createdAt instanceof Date
            ? doc.createdAt
            : new Date(doc.createdAt);
        if (!Number.isFinite(referenceAt.getTime())) continue;
        const names = [agent.name, agent.realName, agent.iCallAgent].filter(
          Boolean
        );
        const candidates = extractDepartureCandidates(doc.content, referenceAt, {
          names,
          includeVague: args.includeVague,
        });
        if (!candidates.length) continue;
        stats.matchedMessages++;
        const best = pickBest(candidates);
        if (!best) continue;
        const existing = bestByAgent.get(agentId);
        if (!existing || best.score > existing.score) {
          bestByAgent.set(agentId, {
            agentId,
            userId: String(doc.userId || agent.createdUserId || ''),
            agentName: agent.name || '',
            messageId: String(doc._id),
            conversationId: String(doc.conversationId || ''),
            messageAt: referenceAt.toISOString(),
            ...best,
          });
        }
      }
      if (args.verbose) {
        console.log(
          `[departure-dry-run] batch ${offset + batch.length}/${ids.length} docs=${docs.length} agents=${bestByAgent.size}`
        );
      }
    }

    const candidates = Array.from(bestByAgent.values()).sort(
      (a, b) => b.score - a.score
    );
    stats.candidates = candidates.length;
    for (const item of candidates) {
      stats.byConfidence[item.confidence] =
        (stats.byConfidence[item.confidence] || 0) + 1;
      stats.byKind[item.kind] = (stats.byKind[item.kind] || 0) + 1;
    }
    stats.elapsedMs = Date.now() - startedAt;

    const payload = { stats, candidates };
    fs.writeFileSync(args.output, JSON.stringify(payload, null, 2), {
      mode: 0o600,
    });
    printSummary(stats, args.output, candidates.slice(0, args.sample), args);
  } finally {
    await client.close();
  }
}

module.exports = {
  extractDepartureCandidates,
  parseChineseNumber,
  shiftMonths,
  shiftYears,
  dateKey,
};

if (require.main === module) {
  main().catch(error => {
    console.error('[departure-dry-run] fatal', error);
    process.exit(1);
  });
}
