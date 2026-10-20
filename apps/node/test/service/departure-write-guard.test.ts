import { isDepartureDateWriteEnabled } from '../../src/service/memory-write-guard';

describe('departure date write guard', () => {
  it('only enables the narrow departure-date write when explicitly set', () => {
    for (const value of ['true', 'TRUE', '1', 'yes']) {
      expect(
        isDepartureDateWriteEnabled({
          DEPARTURE_DATE_WRITE_ENABLED: value,
        } as never)
      ).toBe(true);
    }
    expect(isDepartureDateWriteEnabled({} as never)).toBe(false);
    expect(
      isDepartureDateWriteEnabled({
        DEPARTURE_DATE_WRITE_ENABLED: 'false',
      } as never)
    ).toBe(false);
  });
});
