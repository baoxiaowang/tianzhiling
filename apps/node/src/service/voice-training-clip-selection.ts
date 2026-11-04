/**
 * 声音训练只能使用同一个说话人的素材。
 *
 * 上传的视频里经常同时有用户和亲人两个人在说话；切出来的片段即使都被
 * “审核通过”，混在一起训练也会让克隆音色串到另一个人。
 * 这里按说话人聚类，只保留时长最多的那一组；没有 speakerId 时保持原样。
 */
export interface SpeakerTaggedClip {
  speakerId?: string;
  durationSeconds?: number;
  qualityScore?: number;
}

export function selectDominantSpeakerClips<T extends SpeakerTaggedClip>(
  clips: T[]
): T[] {
  if (clips.length <= 1) return clips;

  const tagged = clips.filter(clip => Boolean(clip.speakerId?.trim()));
  if (!tagged.length) return clips;

  const groups = new Map<string, T[]>();
  for (const clip of tagged) {
    const speakerId = clip.speakerId!.trim();
    const group = groups.get(speakerId) || [];
    group.push(clip);
    groups.set(speakerId, group);
  }

  if (groups.size <= 1) return tagged;

  const score = (group: T[]) =>
    group.reduce(
      (total, clip) =>
        total + Math.max(1, Number(clip.durationSeconds) || 1),
      0
    );

  let dominant: T[] = [];
  for (const group of groups.values()) {
    if (score(group) > score(dominant)) dominant = group;
  }
  return dominant;
}
