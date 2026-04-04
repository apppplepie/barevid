const PRESENTER_HIDE_STYLE = `<style id="sf-presenter-hide">.narration,.speaker-notes,.sf-narration,[data-role="narration"]{display:none!important}</style>`;

export type DeckIframeOptions = {
  hideNarrationChrome?: boolean;
};

export function buildDeckIframeSrcDoc(
  fragmentHtml: string,
  baseHref: string,
  options?: DeckIframeOptions,
): string {
  const base = baseHref.endsWith('/') ? baseHref : `${baseHref}/`;
  const hide =
    options?.hideNarrationChrome === true ? PRESENTER_HIDE_STYLE : '';
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/><base href="${base}"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>html,body{margin:0;padding:0;width:100%;height:100%;min-height:100%;box-sizing:border-box;overflow:hidden;scrollbar-width:none;-ms-overflow-style:none}html::-webkit-scrollbar,body::-webkit-scrollbar{width:0;height:0;display:none}*{box-sizing:inherit}</style></head><body>${hide}${fragmentHtml}</body></html>`;
}
