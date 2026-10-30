import {
  extractPersonAddressCorrection,
  PersonAddressService,
} from '../../src/service/agents/person-address.service';

describe('person address correction parser', () => {
  it.each([
    ['不是小蹦蛋儿，是小蹦得儿', '小蹦蛋儿', '小蹦得儿'],
    ['别叫小蹦蹬儿，叫小蹦得儿', '小蹦蹬儿', '小蹦得儿'],
    ['小蹦得儿，不是小蹦蛋儿', '小蹦蛋儿', '小蹦得儿'],
  ])('parses %s', (text, oldName, newName) => {
    expect(extractPersonAddressCorrection(text)).toEqual({ oldName, newName });
  });

  it('ignores ordinary mentions', () => {
    expect(extractPersonAddressCorrection('小蹦得儿今天很乖')).toBeNull();
  });
});

describe('PersonAddressService normalizeText', () => {
  it('replaces banned variants with the canonical address', async () => {
    const service = new PersonAddressService();
    service.logger = { info: jest.fn(), warn: jest.fn() } as never;
    service.redisService = {
      hgetall: jest.fn().mockResolvedValue({
        小蹦蛋儿: '小蹦得儿',
        小蹦蹬儿: '小蹦得儿',
      }),
    } as never;

    const result = await service.normalizeText({
      userId: '665000000000000000000901',
      text: '小蹦蹬儿和小蹦蛋儿',
    });

    expect(result.text).toBe('小蹦得儿和小蹦得儿');
    expect(result.replaced.sort()).toEqual(['小蹦蛋儿', '小蹦蹬儿']);
  });
});
