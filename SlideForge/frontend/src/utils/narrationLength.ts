/**
 * 与后端 `app.utils.narration_length` 一致：秒 → 口播汉字量粗算（200～260 字/分钟）。
 * 修改时请同步更新后端。
 */
export const NARRATION_SECONDS_MIN = 10;
/** 未传入 cap 时 clamp 的兜底上限（秒）；实际以上传 `narrationCapSeconds` 为准 */
export const NARRATION_SECONDS_MAX = 3600;

/** 自定义口播体量：填分钟 */
export const NARRATION_CUSTOM_MINUTES_MIN = 1;
export const NARRATION_CUSTOM_MINUTES_MAX = 15;

const MIN_CPM = 180;
const MAX_CPM = 240;
const MID_CPM = 210;

export function clampNarrationSeconds(
  seconds: number,
  capSeconds: number = NARRATION_SECONDS_MAX,
): number {
  const s = Math.trunc(seconds);
  const cap = Math.max(NARRATION_SECONDS_MIN, capSeconds);
  return Math.min(cap, Math.max(NARRATION_SECONDS_MIN, s));
}

export function narrationCharEstimate(
  seconds: number,
  capSeconds: number = NARRATION_SECONDS_MAX,
): {
  seconds: number;
  minChars: number;
  maxChars: number;
  midChars: number;
} {
  const s = clampNarrationSeconds(seconds, capSeconds);
  const minChars = Math.floor((s * MIN_CPM) / 60);
  const maxChars = Math.floor((s * MAX_CPM) / 60);
  const midChars = Math.round((s * MID_CPM) / 60);
  return {
    seconds: s,
    minChars,
    maxChars: Math.max(minChars, maxChars),
    midChars,
  };
}
