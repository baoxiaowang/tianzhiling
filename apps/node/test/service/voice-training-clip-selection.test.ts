import { selectDominantSpeakerClips } from '../../src/service/voice-training-clip-selection';

describe('voice training clip speaker selection', () => {
  it('keeps only the speaker with the most training duration', () => {
    const clips = [
      { speakerId: '1-0', durationSeconds: 9 },
      { speakerId: '1-0', durationSeconds: 7 },
      { speakerId: '1-1', durationSeconds: 5 },
      { speakerId: '1-1', durationSeconds: 4 },
    ];
    expect(selectDominantSpeakerClips(clips)).toEqual([
      { speakerId: '1-0', durationSeconds: 9 },
      { speakerId: '1-0', durationSeconds: 7 },
    ]);
  });

  it('keeps all clips when speaker labels are absent', () => {
    const clips = [
      { durationSeconds: 9 },
      { durationSeconds: 7 },
    ];
    expect(selectDominantSpeakerClips(clips)).toEqual(clips);
  });

  it('does not mix a female clip into a male voice training set', () => {
    const clips = [
      { speakerId: '1-0', durationSeconds: 8.57 },
      { speakerId: '1-0', durationSeconds: 3.71 },
      { speakerId: '1-0', durationSeconds: 5.6 },
      { speakerId: '1-0', durationSeconds: 6.2 },
      { speakerId: '1-0', durationSeconds: 6.53 },
      { speakerId: '1-1', durationSeconds: 5.29 },
      { speakerId: '1-0', durationSeconds: 6.75 },
    ];
    const selected = selectDominantSpeakerClips(clips);
    expect(selected).toHaveLength(6);
    expect(selected.every(clip => clip.speakerId === '1-0')).toBe(true);
  });
});
