import {
  PersonTemporalAssertionConfidence,
  PersonTemporalCalendar,
  PersonTemporalDurationUnit,
  PersonTemporalExpressionKind,
  PersonTemporalPrecision,
  PersonTemporalResolutionCertainty,
  PersonTemporalRitual,
} from '@tzl/entities';

export interface ParsedDepartureTimeAssertion {
  expressionKind: PersonTemporalExpressionKind;
  calendar: PersonTemporalCalendar;
  numericValue?: number;
  numericMin?: number;
  numericMax?: number;
  durationUnit?: PersonTemporalDurationUnit;
  approximate: boolean;
  isCorrection: boolean;
  ritual?: PersonTemporalRitual;
  ritualNominalDay?: number;
  normalizedExactDate?: Date;
  normalizedStart?: Date;
  normalizedEnd?: Date;
  normalizedYear?: number;
  normalizedMonth?: number;
  normalizedDay?: number;
  precision: PersonTemporalPrecision;
  confidence: PersonTemporalAssertionConfidence;
  resolutionCertainty: PersonTemporalResolutionCertainty;
  derivationRule: string;
}

const DEPARTURE_PATTERN = /离开|走了|走的|去世|离世|过世|不在了|忌日|祭日/;
const DIRECT_AGENT_PATTERN =
  /(?:你|您).{0,16}(?:离开|走|去世|离世|过世|不在)|(?:离开|走|去世|离世|过世).{0,10}(?:你|您)/;
const DIRECT_RITUAL_PATTERN =
  /(?:你|您)(?:的)?(?:头七|头7|一七|二七|2七|三七|3七|五七|5七|七七|7七|百日|百天|100天)/;
const QUESTION_PATTERN =
  /[?？吗]|(?:什么|哪年|哪月|哪天|几月|几号|什么时候|多久|多少年|对不对|是不是)|(?:你|您)?(?:是|在)?几(?:年|个月|月|天)前(?:离开|走|去世|离世|过世)|(?:离开|走|去世|离世|过世|不在)(?:已经|有)?几年(?:了|啦)?$/;
const NEGATION_PATTERN =
  /(?:你|您).{0,12}(?:没有|没|不是).{0,8}(?:离开|走|去世|离世|过世)/;
const THIRD_PERSON_DEPARTURE_PATTERN =
  /(?:他|她|他们|她们).{0,16}(?:离开|走|去世|离世|过世)/;
const AGENT_RELATIVE_DEPARTURE_PATTERN =
  /(?:你|您)(?:的)?(?:爸爸|妈妈|父亲|母亲|爷爷|奶奶|外公|外婆|哥哥|姐姐|弟弟|妹妹|儿子|女儿|孩子|丈夫|妻子|老公|老婆).{0,16}(?:离开|走|去世|离世|过世)/;
const CORRECTION_PATTERN =
  /(?:不是|不对|记错|错了|应该是|应是|改成|别再说).{0,32}(?:是|为|在|改成)/;
const APPROXIMATE_PATTERN =
  /大概|大约|差不多|好像|可能|左右|前后|来年|多年|多月|多天|快|将近|接近|至少|不到|超过/;
const EXACT_DURATION_PATTERN = /整整|正好|恰好|到今天|周年|一天不差/;

export const AGENT_DEPARTURE_TIME_SIGNAL_PATTERN =
  /离开|走了|走的|去世|离世|过世|不在了|忌日|祭日|头\s*7|头七|一七|二七|三七|五七|七七|百日|百天|周年|年头/;
export const IMPLICIT_DEPARTURE_TIME_SIGNAL_PATTERN =
  /(?:已经|都有|有|差不多|大约|大概|整整|正好|恰好|将近|快|超过|不到)?\s*[0-9零〇一二两三四五六七八九十百千]+\s*(?:年|个?月|周|星期|天|年头)|头\s*7|头七|一七|二七|三七|五七|七七|百日|百天/;

export function hasAgentDepartureTimeSignal(options: {
  text: string;
  implicitCurrentAgent?: boolean;
}): boolean {
  const text = normalizeText(options.text);
  return Boolean(
    text &&
      (AGENT_DEPARTURE_TIME_SIGNAL_PATTERN.test(text) ||
        (options.implicitCurrentAgent &&
          IMPLICIT_DEPARTURE_TIME_SIGNAL_PATTERN.test(text)))
  );
}

export function needsAgentDepartureTimeSemanticJudgment(options: {
  text: string;
  referenceAt: Date;
  implicitCurrentAgent?: boolean;
}): boolean {
  return (
    hasAgentDepartureTimeSignal(options) && !parseAgentDepartureTime(options)
  );
}

export function extractAgentDepartureTimeRelevantText(
  value: string,
  implicitCurrentAgent = false
): string {
  const source = value.replace(/\s+/gu, ' ').trim().slice(0, 500);
  if (!source) return '';
  const sentences = source
    .split(/(?<=[。！？!?；;\n])/u)
    .map(item => item.trim())
    .filter(Boolean);
  const matchedIndexes = sentences
    .map((sentence, index) =>
      hasAgentDepartureTimeSignal({
        text: sentence,
        implicitCurrentAgent,
      })
        ? index
        : -1
    )
    .filter(index => index >= 0);
  if (!matchedIndexes.length) return source.slice(0, 240);

  const selected = new Set<number>();
  for (const index of matchedIndexes) {
    if (index > 0) selected.add(index - 1);
    selected.add(index);
    if (index + 1 < sentences.length) selected.add(index + 1);
  }
  return Array.from(selected)
    .sort((left, right) => left - right)
    .map(index => sentences[index])
    .join(' ')
    .slice(0, 240);
}

export function parseAgentDepartureTime(options: {
  text: string;
  referenceAt: Date;
  implicitCurrentAgent?: boolean;
}): ParsedDepartureTimeAssertion | null {
  const text = normalizeText(options.text);
  if (!text || !Number.isFinite(options.referenceAt.getTime())) return null;

  const isCorrection = CORRECTION_PATTERN.test(text);
  if (QUESTION_PATTERN.test(text)) return null;
  if (NEGATION_PATTERN.test(text) && !isCorrection) return null;
  if (THIRD_PERSON_DEPARTURE_PATTERN.test(text) && !isCorrection) return null;
  if (AGENT_RELATIVE_DEPARTURE_PATTERN.test(text) && !isCorrection) return null;
  if (
    !options.implicitCurrentAgent &&
    !DIRECT_AGENT_PATTERN.test(text) &&
    !DIRECT_RITUAL_PATTERN.test(text)
  ) {
    return null;
  }
  if (
    !DEPARTURE_PATTERN.test(text) &&
    !DIRECT_RITUAL_PATTERN.test(text) &&
    !options.implicitCurrentAgent
  ) {
    return null;
  }

  return (
    parseExactGregorianDate(text, options.referenceAt, isCorrection) ||
    parseExactRelativeDay(
      text,
      options.referenceAt,
      isCorrection,
      options.implicitCurrentAgent
    ) ||
    parseRitualMilestone(text, options.referenceAt, isCorrection) ||
    parsePartialGregorianDate(text, options.referenceAt, isCorrection) ||
    parseFuzzyRelativeDuration(
      text,
      options.referenceAt,
      isCorrection,
      options.implicitCurrentAgent
    ) ||
    parseRelativeDuration(
      text,
      options.referenceAt,
      isCorrection,
      options.implicitCurrentAgent
    ) ||
    parseLunarExpression(text, options.referenceAt, isCorrection) ||
    parsePartialYear(text, isCorrection, options.referenceAt)
  );
}

function parseExactGregorianDate(
  text: string,
  referenceAt: Date,
  isCorrection: boolean
): ParsedDepartureTimeAssertion | null {
  const matches = [
    ...text.matchAll(
      /((?:19|20)\d{2}|\d{2})\s*[年./-]\s*(1[0-2]|0?[1-9])\s*[月./-]\s*(3[01]|[12]\d|0?[1-9])\s*[日号]?/g
    ),
  ].filter(match => isDepartureDateMatch(text, match));
  const relativeYearMatches = [
    ...text.matchAll(
      /(今年|去年)\s*(1[0-2]|0?[1-9])\s*月\s*(3[01]|[12]\d|0?[1-9])\s*[日号]/g
    ),
  ];
  let year: number | undefined;
  let month: number | undefined;
  let day: number | undefined;
  let rule = 'explicit_gregorian_date_v1';

  if (matches.length) {
    const match = matches[matches.length - 1];
    year = resolveStatedYear(match[1], referenceAt);
    month = Number(match[2]);
    day = Number(match[3]);
    if (match[1].length === 2) rule = 'short_year_exact_date_resolution_v1';
  } else if (relativeYearMatches.length) {
    const match = relativeYearMatches[relativeYearMatches.length - 1];
    const reference = toShanghaiParts(referenceAt);
    year = match[1] === '去年' ? reference.year - 1 : reference.year;
    month = Number(match[2]);
    day = Number(match[3]);
    rule = 'explicit_relative_year_gregorian_date_v1';
  }
  if (!year || !month || !day) return null;
  const exactDate = makeDateOnly(year, month, day);
  if (!exactDate) return null;

  return {
    expressionKind: PersonTemporalExpressionKind.exactDate,
    calendar: PersonTemporalCalendar.gregorian,
    approximate: false,
    isCorrection,
    normalizedExactDate: exactDate,
    normalizedStart: exactDate,
    normalizedEnd: exactDate,
    normalizedYear: year,
    normalizedMonth: month,
    normalizedDay: day,
    precision: PersonTemporalPrecision.exactDay,
    confidence: PersonTemporalAssertionConfidence.confirmed,
    resolutionCertainty:
      matches.length && String(matches[matches.length - 1][1]).length === 2
        ? PersonTemporalResolutionCertainty.derivedExact
        : PersonTemporalResolutionCertainty.explicitExact,
    derivationRule: rule,
  };
}

function parseExactRelativeDay(
  text: string,
  referenceAt: Date,
  isCorrection: boolean,
  implicitCurrentAgent = false
): ParsedDepartureTimeAssertion | null {
  const departureSuffix = '(?:离开|走|去世|离世|过世)';
  const relativeWord = text.match(
    implicitCurrentAgent
      ? new RegExp(`(前天|昨天)(?:${departureSuffix})?`)
      : new RegExp(`(前天|昨天)${departureSuffix}`)
  );
  const numeric = text.match(
    implicitCurrentAgent
      ? new RegExp(
          `([0-9零〇一二两三四五六七八九十百千]+)\\s*天前(?:${departureSuffix})?`
        )
      : new RegExp(
          `([0-9零〇一二两三四五六七八九十百千]+)\\s*天前${departureSuffix}`
        )
  );
  const days = relativeWord
    ? relativeWord[1] === '昨天'
      ? 1
      : 2
    : numeric
    ? parseChineseNumber(numeric[1])
    : undefined;
  if (!days || days < 1 || days > 50000) return null;
  const exactDate = shiftDateOnly(referenceAt, -days);
  const parts = toUtcDateParts(exactDate);
  return {
    expressionKind: PersonTemporalExpressionKind.relativeDuration,
    calendar: PersonTemporalCalendar.gregorian,
    numericValue: days,
    durationUnit: PersonTemporalDurationUnit.day,
    approximate: false,
    isCorrection,
    normalizedExactDate: exactDate,
    normalizedStart: exactDate,
    normalizedEnd: exactDate,
    normalizedYear: parts.year,
    normalizedMonth: parts.month,
    normalizedDay: parts.day,
    precision: PersonTemporalPrecision.exactDay,
    confidence: PersonTemporalAssertionConfidence.confirmed,
    resolutionCertainty: PersonTemporalResolutionCertainty.derivedExact,
    derivationRule: 'reference_date_minus_exact_days_v1',
  };
}

function parsePartialGregorianDate(
  text: string,
  referenceAt: Date,
  isCorrection: boolean
): ParsedDepartureTimeAssertion | null {
  if (/(?:农历|阴历)/.test(text)) return null;

  const yearMonthMatches = [
    ...text.matchAll(
      /((?:19|20)\d{2}|今年|去年)\s*年?\s*(1[0-2]|0?[1-9])\s*月(?!\s*(?:3[01]|[12]\d|0?[1-9])\s*[日号])/g
    ),
  ].filter(match => isDepartureDateMatch(text, match));
  if (yearMonthMatches.length) {
    const match = yearMonthMatches[yearMonthMatches.length - 1];
    const referenceYear = toShanghaiParts(referenceAt).year;
    const year =
      match[1] === '今年'
        ? referenceYear
        : match[1] === '去年'
        ? referenceYear - 1
        : Number(match[1]);
    const month = Number(match[2]);
    return {
      expressionKind: PersonTemporalExpressionKind.partialDate,
      calendar: PersonTemporalCalendar.gregorian,
      approximate: false,
      isCorrection,
      normalizedStart: makeDateOnly(year, month, 1) || undefined,
      normalizedEnd:
        makeDateOnly(year, month, daysInMonth(year, month)) || undefined,
      normalizedYear: year,
      normalizedMonth: month,
      precision: PersonTemporalPrecision.yearMonth,
      confidence: PersonTemporalAssertionConfidence.confirmed,
      resolutionCertainty: PersonTemporalResolutionCertainty.estimatedRange,
      derivationRule: 'explicit_gregorian_year_month_v1',
    };
  }

  const monthDayMatches = [
    ...text.matchAll(
      /(1[0-2]|0?[1-9])\s*月\s*(3[01]|[12]\d|0?[1-9])\s*[日号]/g
    ),
  ].filter(match => isDepartureDateMatch(text, match));
  if (monthDayMatches.length) {
    const match = monthDayMatches[monthDayMatches.length - 1];
    const month = Number(match[1]);
    const day = Number(match[2]);
    if (day > daysInMonth(2000, month)) return null;
    return {
      expressionKind: PersonTemporalExpressionKind.partialDate,
      calendar: PersonTemporalCalendar.gregorian,
      approximate: false,
      isCorrection,
      normalizedMonth: month,
      normalizedDay: day,
      precision: PersonTemporalPrecision.monthDay,
      confidence: PersonTemporalAssertionConfidence.confirmed,
      resolutionCertainty: PersonTemporalResolutionCertainty.unresolved,
      derivationRule: 'explicit_gregorian_month_day_without_year_v1',
    };
  }

  const monthMatches = [
    ...text.matchAll(/(1[0-2]|0?[1-9])\s*月(?!个|\s*\d)/g),
  ].filter(match => isDepartureDateMatch(text, match));
  if (!monthMatches.length) return null;
  const month = Number(monthMatches[monthMatches.length - 1][1]);
  return {
    expressionKind: PersonTemporalExpressionKind.partialDate,
    calendar: PersonTemporalCalendar.gregorian,
    approximate: false,
    isCorrection,
    normalizedMonth: month,
    precision: PersonTemporalPrecision.month,
    confidence: PersonTemporalAssertionConfidence.confirmed,
    resolutionCertainty: PersonTemporalResolutionCertainty.unresolved,
    derivationRule: 'explicit_gregorian_month_without_year_v1',
  };
}

function parseRelativeDuration(
  text: string,
  referenceAt: Date,
  isCorrection: boolean,
  implicitCurrentAgent = false
): ParsedDepartureTimeAssertion | null {
  const matches: RegExpMatchArray[] = [
    ...text.matchAll(
      /(?:离开|走了|去世|离世|过世|不在了)[^，。！？!?]{0,12}?([0-9零〇一二两三四五六七八九十百千]+)\s*(?:个)?(年头|年|个?月|周|星期|天)(?:前|了|啦|左右|多|来)?/g
    ),
    ...text.matchAll(
      /([0-9零〇一二两三四五六七八九十百千]+)\s*(?:个)?(年头|年|个?月|周|星期|天)(?:前|了|啦|左右|多|来)?[^，。！？!?]{0,12}?(?:离开|走|去世|离世|过世|不在)/g
    ),
  ];
  if (implicitCurrentAgent && !matches.length) {
    const implicitMatch = text.match(
      /(?:已经|都|有|差不多|大约|大概|将近|快)?\s*([0-9零〇一二两三四五六七八九十百千]+)\s*(?:个)?(年头|年|个?月|周|星期|天)(?:前|了|啦|左右|多|来)?(?:[，。！？!?]|$)/
    );
    if (implicitMatch) matches.push(implicitMatch);
  }
  if (!matches.length) return null;
  const match = matches[matches.length - 1];
  const statedValue = parseChineseNumber(match[1]);
  if (!statedValue || statedValue < 1 || statedValue > 50000) return null;
  const isWeek = match[2].includes('周') || match[2].includes('星期');
  const value = isWeek ? statedValue * 7 : statedValue;
  const unit = match[2].includes('年')
    ? PersonTemporalDurationUnit.year
    : match[2].includes('月')
    ? PersonTemporalDurationUnit.month
    : PersonTemporalDurationUnit.day;
  if (
    unit === PersonTemporalDurationUnit.year &&
    (value >= 200 || /\d{2,4}年[^，。！？!?]{0,10}\d{1,3}岁/.test(match[0]))
  ) {
    return null;
  }
  const explicitlyExact = EXACT_DURATION_PATTERN.test(text);
  const approximate = APPROXIMATE_PATTERN.test(text) || !explicitlyExact;
  const bounds = resolveDurationBounds(text, value);

  if (explicitlyExact) {
    const exactDate =
      unit === PersonTemporalDurationUnit.day
        ? shiftDateOnly(referenceAt, -value)
        : unit === PersonTemporalDurationUnit.month
        ? shiftDateOnlyByMonths(referenceAt, -value)
        : shiftDateOnlyByYears(referenceAt, -value);
    const parts = toUtcDateParts(exactDate);
    return {
      expressionKind: PersonTemporalExpressionKind.relativeDuration,
      calendar: PersonTemporalCalendar.gregorian,
      numericValue: value,
      numericMin: value,
      numericMax: value,
      durationUnit: unit,
      approximate: false,
      isCorrection,
      normalizedExactDate: exactDate,
      normalizedStart: exactDate,
      normalizedEnd: exactDate,
      normalizedYear: parts.year,
      normalizedMonth: parts.month,
      normalizedDay: parts.day,
      precision: PersonTemporalPrecision.exactDay,
      confidence: PersonTemporalAssertionConfidence.confirmed,
      resolutionCertainty: PersonTemporalResolutionCertainty.derivedExact,
      derivationRule:
        unit === PersonTemporalDurationUnit.day
          ? isWeek
            ? 'reference_date_minus_exact_elapsed_weeks_as_days_v1'
            : 'reference_date_minus_exact_elapsed_days_v1'
          : unit === PersonTemporalDurationUnit.month
          ? 'reference_date_minus_exact_elapsed_months_v1'
          : 'reference_date_minus_exact_anniversary_years_v1',
    };
  }

  const range = buildDurationRange(
    referenceAt,
    bounds.minimum,
    bounds.maximum,
    unit
  );
  return {
    expressionKind: PersonTemporalExpressionKind.relativeDuration,
    calendar: PersonTemporalCalendar.gregorian,
    numericValue: value,
    numericMin: bounds.minimum,
    numericMax: bounds.maximum,
    durationUnit: unit,
    approximate,
    isCorrection,
    normalizedStart: range.start,
    normalizedEnd: range.end,
    normalizedYear: range.centerYear,
    precision:
      unit === PersonTemporalDurationUnit.year
        ? PersonTemporalPrecision.yearRange
        : PersonTemporalPrecision.approximateDuration,
    confidence: PersonTemporalAssertionConfidence.confirmed,
    resolutionCertainty: PersonTemporalResolutionCertainty.estimatedRange,
    derivationRule: `reference_date_minus_bare_${unit}_range_v1`,
  };
}

function parseFuzzyRelativeDuration(
  text: string,
  referenceAt: Date,
  isCorrection: boolean,
  implicitCurrentAgent = false
): ParsedDepartureTimeAssertion | null {
  const match = text.match(
    /(?:(十|二十|三十|四十|五十|六十|七十|八十|九十)?几)\s*(年|个?月|周|星期|天)(?:前|了|啦)?/
  );
  if (!match) return null;
  if (!implicitCurrentAgent && !DEPARTURE_PATTERN.test(text)) return null;

  const base = match[1] ? parseChineseNumber(match[1]) || 0 : 0;
  const statedMinimum = base ? base + 1 : 2;
  const statedMaximum = base ? base + 9 : 9;
  const isWeek = match[2].includes('周') || match[2].includes('星期');
  const minimum = isWeek ? statedMinimum * 7 : statedMinimum;
  const maximum = isWeek ? statedMaximum * 7 : statedMaximum;
  const unit = match[2].includes('年')
    ? PersonTemporalDurationUnit.year
    : match[2].includes('月')
    ? PersonTemporalDurationUnit.month
    : PersonTemporalDurationUnit.day;
  const range = buildDurationRange(referenceAt, minimum, maximum, unit);

  return {
    expressionKind: PersonTemporalExpressionKind.relativeDuration,
    calendar: PersonTemporalCalendar.gregorian,
    numericMin: minimum,
    numericMax: maximum,
    durationUnit: unit,
    approximate: true,
    isCorrection,
    normalizedStart: range.start,
    normalizedEnd: range.end,
    normalizedYear: range.centerYear,
    precision:
      unit === PersonTemporalDurationUnit.year
        ? PersonTemporalPrecision.yearRange
        : PersonTemporalPrecision.approximateDuration,
    confidence: PersonTemporalAssertionConfidence.confirmed,
    resolutionCertainty: PersonTemporalResolutionCertainty.estimatedRange,
    derivationRule: isWeek
      ? 'reference_date_minus_fuzzy_weeks_as_days_range_v1'
      : `reference_date_minus_fuzzy_${unit}_range_v1`,
  };
}

function parsePartialYear(
  text: string,
  isCorrection: boolean,
  referenceAt = new Date()
): ParsedDepartureTimeAssertion | null {
  const matches = [
    ...text.matchAll(
      /((?:19|20)\d{2}|\d{2})\s*年[^，。！？!?]{0,12}(?:离开|走|去世|离世|过世)|(?:离开|走|去世|离世|过世)[^，。！？!?]{0,12}((?:19|20)\d{2}|\d{2})\s*年/g
    ),
  ];
  if (!matches.length) return null;
  const match = matches[matches.length - 1];
  const token = match[1] || match[2];
  const year = resolveStatedYear(token, referenceAt);
  return {
    expressionKind: PersonTemporalExpressionKind.partialDate,
    calendar: PersonTemporalCalendar.gregorian,
    approximate: APPROXIMATE_PATTERN.test(text),
    isCorrection,
    normalizedStart: makeDateOnly(year, 1, 1) || undefined,
    normalizedEnd: makeDateOnly(year, 12, 31) || undefined,
    normalizedYear: year,
    precision: PersonTemporalPrecision.year,
    confidence: PersonTemporalAssertionConfidence.confirmed,
    resolutionCertainty: PersonTemporalResolutionCertainty.estimatedRange,
    derivationRule:
      token.length === 2
        ? 'short_year_century_resolution_v1'
        : 'explicit_gregorian_year_v1',
  };
}

function parseRitualMilestone(
  text: string,
  referenceAt: Date,
  isCorrection: boolean
): ParsedDepartureTimeAssertion | null {
  const match = text.match(
    /(今天|明天|昨天)?(?:正好|刚好|是|到了|到)?(?:你的|您的)?(头七|头7|一七|二七|2七|三七|3七|五七|5七|七七|7七|百日|百天|100天)/
  );
  if (!match) return null;
  const ritualMap: Record<
    string,
    { ritual: PersonTemporalRitual; nominalDay: number }
  > = {
    头七: { ritual: PersonTemporalRitual.touqi, nominalDay: 7 },
    头7: { ritual: PersonTemporalRitual.touqi, nominalDay: 7 },
    一七: { ritual: PersonTemporalRitual.touqi, nominalDay: 7 },
    二七: { ritual: PersonTemporalRitual.erqi, nominalDay: 14 },
    '2七': { ritual: PersonTemporalRitual.erqi, nominalDay: 14 },
    三七: { ritual: PersonTemporalRitual.sanqi, nominalDay: 21 },
    '3七': { ritual: PersonTemporalRitual.sanqi, nominalDay: 21 },
    五七: { ritual: PersonTemporalRitual.wuqi, nominalDay: 35 },
    '5七': { ritual: PersonTemporalRitual.wuqi, nominalDay: 35 },
    七七: { ritual: PersonTemporalRitual.qiqi, nominalDay: 49 },
    '7七': { ritual: PersonTemporalRitual.qiqi, nominalDay: 49 },
    百日: { ritual: PersonTemporalRitual.hundredDays, nominalDay: 100 },
    百天: { ritual: PersonTemporalRitual.hundredDays, nominalDay: 100 },
    '100天': { ritual: PersonTemporalRitual.hundredDays, nominalDay: 100 },
  };
  const milestone = ritualMap[match[2]];
  const anchorShift = match[1] === '明天' ? 1 : match[1] === '昨天' ? -1 : 0;
  const anchor = shiftDateOnly(referenceAt, anchorShift);
  const hasAnchor = Boolean(match[1]);
  return {
    expressionKind: PersonTemporalExpressionKind.ritualMilestone,
    calendar: PersonTemporalCalendar.unknown,
    approximate: true,
    isCorrection,
    ritual: milestone.ritual,
    ritualNominalDay: milestone.nominalDay,
    ...(hasAnchor
      ? {
          normalizedStart: shiftDateOnly(anchor, -milestone.nominalDay),
          normalizedEnd: shiftDateOnly(anchor, -(milestone.nominalDay - 1)),
        }
      : {}),
    precision: hasAnchor
      ? PersonTemporalPrecision.ritualRange
      : PersonTemporalPrecision.unknown,
    confidence: PersonTemporalAssertionConfidence.confirmed,
    resolutionCertainty: hasAnchor
      ? PersonTemporalResolutionCertainty.estimatedRange
      : PersonTemporalResolutionCertainty.unresolved,
    derivationRule: hasAnchor
      ? 'ritual_milestone_inclusive_count_range_v1'
      : 'ritual_milestone_without_anchor_v1',
  };
}

function parseLunarExpression(
  text: string,
  referenceAt: Date,
  isCorrection: boolean
): ParsedDepartureTimeAssertion | null {
  const lunar = text.match(
    /((?:19|20)\d{2}|今年|去年)?\s*(?:年)?\s*(?:(正|冬|腊|一|二|三|四|五|六|七|八|九|十|十一|十二)月(?:初|廿|二十|三十)?[一二三四五六七八九十\d]{1,3}|大年初一(?:前一天)?)/
  );
  if (!lunar || !DEPARTURE_PATTERN.test(text)) return null;
  const referenceYear = toShanghaiParts(referenceAt).year;
  const yearToken = lunar[1];
  const year = yearToken
    ? yearToken === '今年'
      ? referenceYear
      : yearToken === '去年'
      ? referenceYear - 1
      : Number(yearToken)
    : undefined;
  return {
    expressionKind: PersonTemporalExpressionKind.partialDate,
    calendar: PersonTemporalCalendar.lunar,
    approximate: false,
    isCorrection,
    normalizedYear: year,
    precision: year
      ? PersonTemporalPrecision.dayRange
      : PersonTemporalPrecision.unknown,
    confidence: PersonTemporalAssertionConfidence.confirmed,
    resolutionCertainty: PersonTemporalResolutionCertainty.unresolved,
    derivationRule: 'lunar_expression_preserved_unconverted_v1',
  };
}

function buildDurationRange(
  referenceAt: Date,
  minimum: number,
  maximum: number,
  unit: PersonTemporalDurationUnit
): { start: Date; end: Date; centerYear?: number } {
  const centerValue = Math.round((minimum + maximum) / 2);
  if (unit === PersonTemporalDurationUnit.day) {
    const oldest = shiftDateOnly(referenceAt, -maximum);
    const newest = shiftDateOnly(referenceAt, -minimum);
    return {
      start: oldest,
      end: newest,
      centerYear: toUtcDateParts(shiftDateOnly(referenceAt, -centerValue)).year,
    };
  }
  if (unit === PersonTemporalDurationUnit.month) {
    const oldest = shiftDateOnlyByMonths(referenceAt, -maximum);
    const newest = shiftDateOnlyByMonths(referenceAt, -minimum);
    return {
      start: shiftDateOnly(oldest, -15),
      end: shiftDateOnly(newest, 15),
      centerYear: toUtcDateParts(
        shiftDateOnlyByMonths(referenceAt, -centerValue)
      ).year,
    };
  }
  const referenceYear = toShanghaiParts(referenceAt).year;
  const centerYear = referenceYear - centerValue;
  return {
    start: makeDateOnly(referenceYear - maximum, 1, 1) as Date,
    end: makeDateOnly(referenceYear - minimum, 12, 31) as Date,
    centerYear,
  };
}

function resolveDurationBounds(
  text: string,
  value: number
): { minimum: number; maximum: number } {
  const uncertainty = Math.min(
    5,
    value % 5 === 0 ? Math.max(1, Math.round(value * 0.1)) : 1
  );
  if (/快|将近|接近|不到/.test(text)) {
    return { minimum: Math.max(1, value - uncertainty), maximum: value };
  }
  if (/至少|超过/.test(text)) {
    return { minimum: value, maximum: value + uncertainty };
  }
  return {
    minimum: Math.max(1, value - uncertainty),
    maximum: value + uncertainty,
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, '').trim().slice(0, 500);
}

function isDepartureDateMatch(text: string, match: RegExpMatchArray): boolean {
  const index = match.index ?? -1;
  if (index < 0) return false;
  const before = text.slice(Math.max(0, index - 18), index);
  const after = text.slice(
    index + match[0].length,
    index + match[0].length + 18
  );
  if (/(?:今天|现在|今天日期|当前日期)(?:是|为)?$/.test(before)) {
    return false;
  }
  return (
    /(?:离开|走|去世|离世|过世)/.test(after) ||
    /(?:离开|走|去世|离世|过世)(?:于|在|是)?$/.test(before)
  );
}

function parseChineseNumber(value: string): number | undefined {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
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
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let current = 0;
  for (const char of value) {
    if (char in digits) {
      current = digits[char];
      continue;
    }
    const unit = units[char];
    if (!unit) return undefined;
    total += (current || 1) * unit;
    current = 0;
  }
  return total + current || undefined;
}

function toShanghaiParts(value: Date): {
  year: number;
  month: number;
  day: number;
} {
  const shifted = new Date(value.getTime() + 8 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function toUtcDateParts(value: Date): {
  year: number;
  month: number;
  day: number;
} {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

function makeDateOnly(year: number, month: number, day: number): Date | null {
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year &&
    value.getUTCMonth() === month - 1 &&
    value.getUTCDate() === day
    ? value
    : null;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftDateOnly(value: Date, days: number): Date {
  const parts = toShanghaiParts(value);
  const date = makeDateOnly(parts.year, parts.month, parts.day) as Date;
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function shiftDateOnlyByMonths(value: Date, months: number): Date {
  const parts = toShanghaiParts(value);
  const result = makeDateOnly(parts.year, parts.month, 1) as Date;
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)
  ).getUTCDate();
  result.setUTCDate(Math.min(parts.day, lastDay));
  return result;
}

function shiftDateOnlyByYears(value: Date, years: number): Date {
  const parts = toShanghaiParts(value);
  return (
    makeDateOnly(parts.year + years, parts.month, parts.day) ||
    (makeDateOnly(parts.year + years, parts.month, parts.day - 1) as Date)
  );
}

function resolveStatedYear(value: string, referenceAt: Date): number {
  const numeric = Number(value);
  if (value.length !== 2) return numeric;
  const currentTwoDigits = toShanghaiParts(referenceAt).year % 100;
  return numeric <= currentTwoDigits ? 2000 + numeric : 1900 + numeric;
}
