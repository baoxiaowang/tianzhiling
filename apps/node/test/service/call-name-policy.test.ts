import { ConversationEmotionPrimary } from '@tzl/entities';
import {
  resolveCallNamePool,
  selectCallName,
} from '../../src/service/agents/call-name-policy';

describe('resolveCallNamePool', () => {
  it('keeps the configured order and prepends the dynamic name', () => {
    expect(resolveCallNamePool('女儿，闺女', '宝贝')).toEqual([
      '宝贝',
      '女儿',
      '闺女',
    ]);
  });

  it('returns an empty pool for empty input', () => {
    expect(resolveCallNamePool(undefined, undefined)).toEqual([]);
  });
});

describe('selectCallName', () => {
  const pool = ['老婆', '媳妇', '宝贝'];

  it('uses the primary name when there is no reply context', () => {
    expect(selectCallName(pool)).toBe('老婆');
    expect(selectCallName(pool, {})).toBe('老婆');
  });

  it('always uses the only name when the pool has a single entry', () => {
    expect(selectCallName(['老婆'], { scene: 'miss_longing' })).toBe('老婆');
    expect(selectCallName(['老婆'], { scene: 'grief_crisis' })).toBe('老婆');
  });

  it('uses the primary name in stable scenes', () => {
    expect(selectCallName(pool, { scene: 'grief_crisis' })).toBe('老婆');
    expect(selectCallName(pool, { scene: 'departure_blame' })).toBe('老婆');
    expect(selectCallName(pool, { scene: 'correction' })).toBe('老婆');
  });

  it('uses the second name in everyday scenes', () => {
    expect(selectCallName(pool, { scene: 'smalltalk' })).toBe('媳妇');
    expect(selectCallName(pool, { scene: 'daily_update' })).toBe('媳妇');
  });

  it('uses the third name in intimate scenes', () => {
    expect(selectCallName(pool, { scene: 'miss_longing' })).toBe('宝贝');
    expect(selectCallName(pool, { scene: 'dream_companionship' })).toBe('宝贝');
  });

  it('falls back when the pool is shorter than the tier', () => {
    expect(selectCallName(['老婆', '媳妇'], { scene: 'miss_longing' })).toBe(
      '媳妇'
    );
    expect(selectCallName(['老婆'], { scene: 'smalltalk' })).toBe('老婆');
  });

  it('locks the primary name when the emotion is crisis risk', () => {
    expect(
      selectCallName(pool, {
        scene: 'miss_longing',
        emotion: ConversationEmotionPrimary.crisisRisk,
      })
    ).toBe('老婆');
  });

  it('treats attachment emotions as intimate even without a scene', () => {
    expect(
      selectCallName(pool, { emotion: ConversationEmotionPrimary.attachment })
    ).toBe('宝贝');
    expect(
      selectCallName(pool, {
        emotion: ConversationEmotionPrimary.expectingPresence,
      })
    ).toBe('宝贝');
  });

  it('keeps stable scenes ahead of warm emotions', () => {
    expect(
      selectCallName(pool, {
        scene: 'grief_crisis',
        emotion: ConversationEmotionPrimary.attachment,
      })
    ).toBe('老婆');
  });

  it('returns an empty string for an empty pool', () => {
    expect(selectCallName([], { scene: 'smalltalk' })).toBe('');
  });
});
