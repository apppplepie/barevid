/**
 * 与后端 `app.utils.narration_length` 一致：秒 → 口播汉字量粗算（200～260 字/分钟）。
 * 修改时请同步更新后端。
 */
export const NARRATION_SECONDS_MIN = 10;
/** 与后端一致：最长 60 分钟 */
export const NARRATION_SECONDS_MAX = 3600;

/** 自定义口播体量：填分钟 */
export const NARRATION_CUSTOM_MINUTES_MIN = 1;
export const NARRATION_CUSTOM_MINUTES_MAX = 60;

const MIN_CPM = 200;
const MAX_CPM = 260;
const MID_CPM = 230;

export function clampNarrationSeconds(seconds: number): number {
  const s = Math.trunc(seconds);
  return Math.min(NARRATION_SECONDS_MAX, Math.max(NARRATION_SECONDS_MIN, s));
}

export function narrationCharEstimate(seconds: number): {
  seconds: number;
  minChars: number;
  maxChars: number;
  midChars: number;
} {
  const s = clampNarrationSeconds(seconds);
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
