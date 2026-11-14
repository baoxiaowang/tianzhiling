import { DepartureDurationService } from '../../src/service/agents/departure-duration.service';

describe('DepartureDurationService ritual day', () => {
  const deathDate = new Date('2026-10-09T00:00:00.000Z');
  const service = new DepartureDurationService();

  it('counts the death day as ritual day 1 for 五七', () => {
    expect(
      service.checkNodeReminder(
        deathDate,
        new Date('2026-11-11T10:00:00.000Z')
      )
    ).toBe('明天是五七');
    expect(
      service.checkNodeReminder(
        deathDate,
        new Date('2026-11-12T10:00:00.000Z')
      )
    ).toBe('今天是五七');
    expect(
      service.checkNodeReminder(
        deathDate,
        new Date('2026-11-13T10:00:00.000Z')
      )
    ).toBeNull();
  });

  it('keeps head seven and hundred days in the same inclusive convention', () => {
    expect(
      service.checkNodeReminder(deathDate, new Date('2026-10-15T10:00:00.000Z'))
    ).toBe('今天是头七');
    expect(
      service.checkNodeReminder(deathDate, new Date('2027-01-15T10:00:00.000Z'))
    ).toBe('明天是百日');
  });
});
