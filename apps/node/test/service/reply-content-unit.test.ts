import {
  buildContentUnitPrompt,
  collectContentUnits,
  findContentUnitEchoes,
  hasContentUnitEcho,
  type ContentUnit,
} from '../../src/service/agents/reply-content-unit';
import { buildReplyBrief } from '../../src/service/agents/reply-brief.service';

describe('reply content units', () => {
  it('collects concrete objects and anchors while filtering emotional fillers', () => {
    const units = collectContentUnits({
      objectPlan: {
        objects: [
          { ref: 'o1', mention: '你女婿', kind: 'other_person', binding: 'unknown', confidence: 'low' },
          { ref: 'o2', mention: '你', kind: 'agent', binding: 'agent', confidence: 'high' },
          { ref: 'o3', mention: '想你', kind: 'family', binding: 'unknown', confidence: 'low' },
        ],
        focusRefs: ['o1', 'o3'],
        ambiguousMentions: [],
      },
      anchors: [
        { text: '前两天下班回家莫名眼眶红了', importance: 'high' },
        { text: '我哭着说想爸爸', importance: 'medium' },
      ],
    });

    expect(units).toEqual([
      { kind: 'person', text: '你女婿', source: 'utterance' },
      { kind: 'state', text: '前两天下班回家莫名眼眶红了', source: 'utterance' },
      { kind: 'state', text: '我哭着说想爸爸', source: 'utterance' },
    ]);
  });

  it('prefers semantic content units and falls back to object and reading anchors', () => {
    const units = collectContentUnits({
      plannedUnits: [
        { kind: 'event', text: '前两天下班回家莫名眼眶红了', importance: 'high' },
        { kind: 'person', text: '你女婿', importance: 'high' },
      ],
      objectPlan: {
        objects: [
          { ref: 'o1', mention: '你女婿', kind: 'other_person', binding: 'unknown', confidence: 'high' },
          { ref: 'o2', mention: '你', kind: 'agent', binding: 'agent', confidence: 'high' },
        ],
        focusRefs: ['o1'],
        ambiguousMentions: [],
      },
      anchors: [
        { text: '我哭着说想爸爸', importance: 'medium' },
      ],
    });

    expect(units).toEqual([
      { kind: 'event', text: '前两天下班回家莫名眼眶红了', source: 'utterance' },
      { kind: 'person', text: '你女婿', source: 'utterance' },
      { kind: 'state', text: '我哭着说想爸爸', source: 'utterance' },
    ]);
  });

  it('keeps at most four distinct units and ignores empty anchors', () => {
    const units = collectContentUnits({
      objectPlan: {
        objects: [
          { ref: 'o1', mention: '姐姐', kind: 'family', binding: 'unknown', confidence: 'low' },
          { ref: 'o2', mention: '孩子', kind: 'family', binding: 'unknown', confidence: 'low' },
          { ref: 'o3', mention: '老房子', kind: 'place', binding: 'unknown', confidence: 'low' },
          { ref: 'o4', mention: '照片', kind: 'keepsake', binding: 'unknown', confidence: 'low' },
          { ref: 'o5', mention: '你', kind: 'agent', binding: 'agent', confidence: 'high' },
        ],
        focusRefs: ['o1', 'o2', 'o3', 'o4', 'o5'],
        ambiguousMentions: [],
      },
      anchors: [
        { text: '姐姐说孩子也想你', importance: 'high' },
        { text: '老房子还在', importance: 'high' },
      ],
    });

    expect(units).toHaveLength(4);
    expect(new Set(units.map(unit => unit.text)).size).toBe(4);
  });

  it('builds a prompt that asks the model to answer the concrete thing first', () => {
    const units: ContentUnit[] = [
      { kind: 'person', text: '你女婿', source: 'utterance' },
      { kind: 'event', text: '下班莫名掉眼泪', source: 'utterance' },
    ];
    const prompt = buildContentUnitPrompt(units);

    expect(prompt).toContain('person:"你女婿"');
    expect(prompt).toContain('event:"下班莫名掉眼泪"');
    expect(prompt).toContain('先照着其中一件具体的事回应');
    expect(prompt).toContain('不要跳过这些事');
  });

  it('recognizes when a reply echoes a short mention or a long anchor fragment', () => {
    const units: ContentUnit[] = [
      { kind: 'person', text: '你女婿', source: 'utterance' },
      { kind: 'state', text: '前两天下班回家莫名眼眶红了，我哭着说想爸爸', source: 'utterance' },
    ];

    expect(
      findContentUnitEchoes('你女婿也跟着哭了，爸知道你想我', units)
    ).toEqual([units[0]]);

    expect(
      hasContentUnitEcho('你下班回家时眼眶红了，爸心里都懂', units)
    ).toBe(true);
  });

  it('does not treat a generic comfort reply as an echo when no concrete unit is present', () => {
    const units: ContentUnit[] = [
      { kind: 'state', text: '你女婿问怎么了', source: 'utterance' },
      { kind: 'state', text: '我哭着说想爸爸', source: 'utterance' },
    ];

    expect(hasContentUnitEcho('爸听着心里揪得慌，你别一个人扛着', units)).toBe(false);
  });

  it('injects the concrete-content instruction into the reply brief', () => {
    const brief = buildReplyBrief({
      currentQuery: '前两天下班回家莫名眼眶红了，你女婿问怎么了，我哭着说想爸爸',
      intent: {
        intents: [
          {
            target: 'agent',
            timeScope: 'current',
            intent: 'express_longing',
            subIntent: 'grief_support',
            confidence: 0.9,
          },
        ],
        reading: {
          primaryNeed: '希望爸爸看见自己最近的难过',
          emotionalSource: '想爸爸',
          relationshipSignal: '亲近',
          relationshipStance: 'comfort_without_claim',
          anchors: [
            { text: '前两天下班回家莫名眼眶红了', importance: 'high' },
            { text: '你女婿问怎么了', importance: 'high' },
            { text: '我哭着说想爸爸', importance: 'medium' },
          ],
          corrections: [],
          negations: [],
          questionsToAnswer: [],
          uncertainties: [],
          suggestedTone: '安稳、亲近',
        },
        objectPlan: {
          objects: [
            { ref: 'o1', mention: '你女婿', kind: 'other_person', binding: 'unknown', confidence: 'high' },
            { ref: 'o2', mention: '你', kind: 'agent', binding: 'agent', confidence: 'high' },
          ],
          focusRefs: ['o1'],
          ambiguousMentions: [],
        },
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.9,
        source: 'semantic_model',
      },
    });

    expect(brief.contentUnits).toEqual([
      { kind: 'person', text: '你女婿', source: 'utterance' },
      { kind: 'state', text: '前两天下班回家莫名眼眶红了', source: 'utterance' },
      { kind: 'state', text: '你女婿问怎么了', source: 'utterance' },
      { kind: 'state', text: '我哭着说想爸爸', source: 'utterance' },
    ]);
    expect(brief.prompt).toContain('本轮用户说了具体的事');
    expect(brief.prompt).toContain('person:"你女婿"');
    expect(brief.prompt).toContain('先照着其中一件具体的事回应');
  });
});
