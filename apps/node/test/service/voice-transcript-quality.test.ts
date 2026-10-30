import { assessVoiceTranscriptQuality } from '../../src/service/agents/voice-transcript-quality';

describe('voice transcript quality', () => {
  it('keeps normal dialect-heavy transcripts', () => {
    expect(
      assessVoiceTranscriptQuality(
        '老公，你走了十天，我就像你走了几十年，度日如年，时时刻刻思念你。',
        17320
      )
    ).toEqual({ lowQuality: false });
  });

  it('marks sparse transcripts as low quality', () => {
    expect(assessVoiceTranscriptQuality('嗯。', 12000)).toEqual({
      lowQuality: true,
      reason: 'sparse',
    });
  });

  it('marks filler-heavy transcripts as low quality', () => {
    expect(
      assessVoiceTranscriptQuality('嗯嗯啊哦那个就是啊然后嗯嗯', 9000)
    ).toEqual({ lowQuality: true, reason: 'filler' });
  });
});
