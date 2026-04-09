/** 下一次演示页生成请求附带 beta 视觉提示（读一次即清除） */
const LS_KEY = 'slideforge_deck_beta_visual_once';

export function armDeckBetaVisualOnce(): void {
  try {
    localStorage.setItem(LS_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function isDeckBetaVisualArmed(): boolean {
  try {
    return localStorage.getItem(LS_KEY) === '1';
  } catch {
    return false;
  }
}

/** 再点一次可关闭；返回切换后的状态（已武装为 true） */
export function toggleDeckBetaVisual(): boolean {
  try {
    if (localStorage.getItem(LS_KEY) === '1') {
      localStorage.removeItem(LS_KEY);
      return false;
    }
    localStorage.setItem(LS_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** 若已武装则返回 `?beta_visual=1` 并清除标记，否则返回空串 */
export function consumeDeckBetaVisualQuery(): string {
  try {
    if (localStorage.getItem(LS_KEY) !== '1') return '';
    localStorage.removeItem(LS_KEY);
    return '?beta_visual=1';
  } catch {
    return '';
  }
}
