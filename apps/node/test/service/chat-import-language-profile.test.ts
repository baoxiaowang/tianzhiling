import {
  ChatImportLanguageProfile,
  mergeChatImportLanguageProfile,
} from '@tzl/shared';

const DIMENSIONS: Array<keyof ChatImportLanguageProfile> = [
  'sentenceLength',
  'modalParticles',
  'replyBubblePattern',
  'directness',
  'emotionalExpression',
  'addressStyle',
  'distinctiveRhythm',
];

function buildProfile(
  prefix: string
): Required<ChatImportLanguageProfile> {
  return {
    sentenceLength: `${prefix}：多为8至20字的消息`,
    modalParticles: `${prefix}：习惯使用呀、呢等语气词`,
    replyBubblePattern: `${prefix}：一次回复平均连续发送2个气泡`,
    directness: `${prefix}：表达较为直接`,
    emotionalExpression: `${prefix}：情绪表达以日常回应为主`,
    addressStyle: `${prefix}：习惯直接叫名字`,
    distinctiveRhythm: `${prefix}：长短句交替`,
  };
}

const STRONG_BATCH = { batchId: 'batch-strong', confidence: 0.82 };
const WEAK_BATCH = { batchId: 'batch-weak', confidence: 0.48 };

function buildSources(source: { batchId: string; confidence: number }) {
  const sources: Record<
    string,
    { batchId: string; confidence: number }
  > = {};
  for (const dimension of DIMENSIONS) {
    sources[dimension] = { ...source };
  }
  return sources;
}

describe('mergeChatImportLanguageProfile', () => {
  it('does not let a weak later batch overwrite reliable adopted dimensions', () => {
    const strong = buildProfile('强批');
    const merged = mergeChatImportLanguageProfile({
      previousLanguageProfile: strong,
      previousLanguageProfileSources: buildSources(STRONG_BATCH),
      previousConfidence: 0.82,
      incomingLanguageProfile: buildProfile('弱批'),
      incomingConfidence: 0.48,
      incomingBatchId: 'batch-weak',
    });

    expect(merged.languageProfile).toEqual(strong);
    expect(merged.confidence).toBe(0.82);
    for (const dimension of DIMENSIONS) {
      expect(merged.languageProfileSources[dimension]).toEqual(STRONG_BATCH);
    }
  });

  it('fills dimensions the reliable previous result left empty without touching adopted ones', () => {
    const previous: ChatImportLanguageProfile = buildProfile('强批');
    delete previous.directness;
    const merged = mergeChatImportLanguageProfile({
      previousLanguageProfile: previous,
      previousLanguageProfileSources: {
        sentenceLength: { ...STRONG_BATCH },
      },
      previousConfidence: 0.82,
      incomingLanguageProfile: buildProfile('弱批'),
      incomingConfidence: 0.48,
      incomingBatchId: 'batch-weak',
    });

    // 空维度补上弱批值，来源记为弱批
    expect(merged.languageProfile.directness).toBe('弱批：表达较为直接');
    expect(merged.languageProfileSources.directness).toEqual(WEAK_BATCH);
    // 已采用维度仍是强批值，来源不变
    for (const dimension of DIMENSIONS) {
      if (dimension === 'directness') continue;
      expect(merged.languageProfile[dimension]).toBe(previous[dimension]);
    }
    expect(merged.languageProfileSources.sentenceLength).toEqual(STRONG_BATCH);
    expect(merged.confidence).toBe(0.82);
  });

  it('lets a stronger later batch overwrite weak adopted dimensions', () => {
    const weak = buildProfile('弱批');
    const merged = mergeChatImportLanguageProfile({
      previousLanguageProfile: weak,
      previousLanguageProfileSources: buildSources(WEAK_BATCH),
      previousConfidence: 0.48,
      incomingLanguageProfile: buildProfile('强批'),
      incomingConfidence: 0.82,
      incomingBatchId: 'batch-strong',
    });

    expect(merged.languageProfile).toEqual(buildProfile('强批'));
    expect(merged.confidence).toBe(0.82);
    for (const dimension of DIMENSIONS) {
      expect(merged.languageProfileSources[dimension]).toEqual(STRONG_BATCH);
    }
  });

  it('never lowers the overall confidence below the previous value', () => {
    const merged = mergeChatImportLanguageProfile({
      previousLanguageProfile: buildProfile('强批'),
      previousConfidence: 0.82,
      incomingLanguageProfile: buildProfile('弱批'),
      incomingConfidence: 0.48,
      incomingBatchId: 'batch-weak',
    });

    expect(merged.confidence).toBe(0.82);
  });

  it('records the winning batch for every filled dimension', () => {
    const merged = mergeChatImportLanguageProfile({
      incomingLanguageProfile: buildProfile('首批'),
      incomingConfidence: 0.48,
      incomingBatchId: 'batch-first',
    });

    expect(merged.confidence).toBe(0.48);
    for (const dimension of DIMENSIONS) {
      expect(merged.languageProfileSources[dimension]).toEqual({
        batchId: 'batch-first',
        confidence: 0.48,
      });
    }
  });
});
