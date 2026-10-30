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

import { selectProgrammaticAddress } from '../../src/service/agents/person-address.shared';

describe('programmatic address selection', () => {
  const child = {
    preferredName: '小蹦得儿',
    realName: '小蹦得儿',
    aliases: ['小朵朵'],
    relationToUser: '女儿',
  };

  it('uses the name the user mentioned this turn', () => {
    expect(selectProgrammaticAddress(child, '小朵朵今天乖不乖')).toBe('小朵朵');
  });

  it('falls back to preferredName when no allowed name is mentioned', () => {
    expect(selectProgrammaticAddress(child, '今天家里都好吗')).toBe('小蹦得儿');
  });

  it('can use the relation term when that is what the user used', () => {
    expect(selectProgrammaticAddress(child, '闺女最近怎么样')).toBe('闺女');
  });
});

describe('PersonAddressService correction keeps valid aliases', () => {
  it('only rejects the corrected variant and preserves other names', async () => {
    const service = new PersonAddressService();
    service.logger = { info: jest.fn(), warn: jest.fn() } as never;
    const saved = [];
    const person = {
      id: 'person-1',
      realName: '小蹦得儿',
      preferredName: '小蹦得儿',
      aliases: ['小朵朵'],
      sourceText: '',
    };
    service.knownPersonModel = {
      find: jest.fn().mockResolvedValue([person]),
      save: jest.fn(async value => {
        saved.push(value);
        return value;
      }),
    } as never;
    service.redisService = {
      hgetall: jest.fn().mockResolvedValue({ 小蹦蛋儿: '小蹦得儿' }),
      hset: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
    } as never;

    await service.applyCorrectionFromUserText({
      userId: '665000000000000000000902',
      text: '不是小蹦蛋儿，是小蹦得儿',
    });

    expect(person.preferredName).toBe('小蹦得儿');
    expect(person.aliases).toEqual(['小朵朵']);
    expect(service.redisService.hset).toHaveBeenCalledWith(
      expect.stringContaining('bans'),
      '小蹦蛋儿',
      '小蹦得儿'
    );
  });
});
