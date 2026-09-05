import {
  PersonTemporalCalendar,
  PersonTemporalExpressionKind,
  PersonTemporalPrecision,
  PersonTemporalResolutionCertainty,
  PersonTemporalRitual,
} from '@tzl/entities';
import { parseAgentDepartureTime } from '../../src/service/agents/person-temporal-memory';

const REFERENCE = new Date('2026-09-05T02:00:00.000Z');

describe('parseAgentDepartureTime', () => {
  it('records an explicit Gregorian departure date exactly', () => {
    expect(
      parseAgentDepartureTime({
        text: '你是2025年5月16日走的',
        referenceAt: REFERENCE,
      })
    ).toMatchObject({
      expressionKind: PersonTemporalExpressionKind.exactDate,
      calendar: PersonTemporalCalendar.gregorian,
      normalizedExactDate: new Date('2025-05-16T00:00:00.000Z'),
      precision: PersonTemporalPrecision.exactDay,
      resolutionCertainty: PersonTemporalResolutionCertainty.explicitExact,
    });
  });

  it('derives an exact date only from exact relative wording', () => {
    expect(
      parseAgentDepartureTime({
        text: '你是20天前走的',
        referenceAt: REFERENCE,
      })
    ).toMatchObject({
      numericValue: 20,
      normalizedExactDate: new Date('2026-08-16T00:00:00.000Z'),
      resolutionCertainty: PersonTemporalResolutionCertainty.derivedExact,
    });
  });

  it('keeps a bare round year count as a wide estimate', () => {
    expect(
      parseAgentDepartureTime({
        text: '你离开已经20年了',
        referenceAt: REFERENCE,
      })
    ).toMatchObject({
      numericValue: 20,
      approximate: true,
      normalizedYear: 2006,
      normalizedStart: new Date('2004-01-01T00:00:00.000Z'),
      normalizedEnd: new Date('2008-12-31T00:00:00.000Z'),
      precision: PersonTemporalPrecision.yearRange,
      resolutionCertainty: PersonTemporalResolutionCertainty.estimatedRange,
    });
  });

  it('preserves head-seven as a ritual range instead of an exact date', () => {
    expect(
      parseAgentDepartureTime({
        text: '今天是你的头七',
        referenceAt: REFERENCE,
      })
    ).toMatchObject({
      expressionKind: PersonTemporalExpressionKind.ritualMilestone,
      ritual: PersonTemporalRitual.touqi,
      ritualNominalDay: 7,
      normalizedStart: new Date('2026-08-29T00:00:00.000Z'),
      normalizedEnd: new Date('2026-08-30T00:00:00.000Z'),
      precision: PersonTemporalPrecision.ritualRange,
    });
    expect(
      parseAgentDepartureTime({
        text: '今天是你的头 7',
        referenceAt: REFERENCE,
      })
    ).toMatchObject({
      ritual: PersonTemporalRitual.touqi,
      ritualNominalDay: 7,
    });
  });

  it('normalizes two-digit years but keeps lunar expressions unresolved', () => {
    expect(
      parseAgentDepartureTime({
        text: '95年您38岁去世的',
        referenceAt: REFERENCE,
        implicitCurrentAgent: true,
      })
    ).toMatchObject({
      normalizedYear: 1995,
      precision: PersonTemporalPrecision.year,
    });
    expect(
      parseAgentDepartureTime({
        text: '你是2025年正月二十七离开的',
        referenceAt: REFERENCE,
      })
    ).toMatchObject({
      calendar: PersonTemporalCalendar.lunar,
      normalizedYear: 2025,
      resolutionCertainty: PersonTemporalResolutionCertainty.unresolved,
    });
  });

  it('preserves useful Gregorian partial dates without inventing missing fields', () => {
    expect(
      parseAgentDepartureTime({
        text: '你是2025年5月走的',
        referenceAt: REFERENCE,
      })
    ).toMatchObject({
      normalizedYear: 2025,
      normalizedMonth: 5,
      normalizedStart: new Date('2025-05-01T00:00:00.000Z'),
      normalizedEnd: new Date('2025-05-31T00:00:00.000Z'),
      precision: PersonTemporalPrecision.yearMonth,
    });
    const monthDay = parseAgentDepartureTime({
      text: '你是5月16号走的',
      referenceAt: REFERENCE,
    });
    expect(monthDay).toMatchObject({
      normalizedMonth: 5,
      normalizedDay: 16,
      precision: PersonTemporalPrecision.monthDay,
    });
    expect(monthDay?.normalizedYear).toBeUndefined();
  });

  it('rejects questions, negations, and third-person departure dates', () => {
    for (const text of [
      '你是什么时候走的',
      '你是2025年5月16日走的吗',
      '不是2025年5月16日，是2025年5月18日走的吗',
      '你没有离开我',
      '他在2025年5月16日走的',
      '你妈妈在2025年5月16日走的',
    ]) {
      expect(
        parseAgentDepartureTime({ text, referenceAt: REFERENCE })
      ).toBeNull();
    }
  });

  it('uses the corrected date rather than the rejected date', () => {
    expect(
      parseAgentDepartureTime({
        text: '不是2025年5月16日，你是2025年5月18日走的',
        referenceAt: REFERENCE,
      })
    ).toMatchObject({
      isCorrection: true,
      normalizedExactDate: new Date('2025-05-18T00:00:00.000Z'),
    });
  });
});
