import { ClipData, ClipType } from '../types';

const DEFAULT_EPSILON = 1e-4;

/**
 * 时间轴命中使用半开区间 [start, end)，避免边界时命中到上一个片段。
 * 在 100% 末端做一次兜底，保证最后一段可命中。
 */
export function findClipAtTime(
  clips: ClipData[],
  type: ClipType,
  timePercent: number,
  epsilon = DEFAULT_EPSILON,
): ClipData | undefined {
  const trackClips = clips
    .filter((clip) => clip.type === type)
    .sort((a, b) => a.start - b.start || a.width - b.width);

  if (!trackClips.length) return undefined;

  const t = Math.max(0, Math.min(100, timePercent));
  for (const clip of trackClips) {
    const start = clip.start;
    const end = clip.start + clip.width;
    if (t + epsilon < start) break;
    if (t >= start - epsilon && t < end - epsilon) {
      return clip;
    }
  }

  if (t >= 100 - epsilon) {
    return trackClips[trackClips.length - 1];
  }

  return undefined;
}
