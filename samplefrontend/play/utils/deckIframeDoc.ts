const PRESENTER_HIDE_STYLE = `<style id="sf-presenter-hide">.narration,.speaker-notes,.sf-narration,[data-role="narration"]{display:none!important}</style>`;

export type DeckIframeOptions = {
  /** 与原先 .sf-play-present .sf-html-stage 规则一致，在 iframe 内隐藏讲稿区 */
  hideNarrationChrome?: boolean;
};

/**
 * 将抽离的 deck 片段包成独立文档并写入 iframe srcdoc，避免样式注入宿主页面。
 * baseHref 一般为 `origin + "/"`，便于片段内相对路径解析。
 */
export function buildDeckIframeSrcDoc(
  fragmentHtml: string,
  baseHref: string,
  options?: DeckIframeOptions,
): string {
  const base = baseHref.endsWith('/') ? baseHref : `${baseHref}/`;
  const hide =
    options?.hideNarrationChrome === true ? PRESENTER_HIDE_STYLE : '';
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/><base href="${base}"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>html,body{margin:0;padding:0;width:100%;min-height:100%;box-sizing:border-box}*{box-sizing:inherit}</style></head><body>${hide}${fragmentHtml}</body></html>`;
}
