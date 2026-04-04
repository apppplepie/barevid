/** 与 GET /api/projects/:id 的 outline、ManualWorkflowDialogs 一致 */

export type OutlineNodeApi = {
  id: number;
  node_kind: string;
  title: string | null;
  children?: OutlineNodeApi[];
  content?: {
    narration_text?: string | null;
    narration_brief?: string | null;
  } | null;
};

export type ScriptPage = {
  page_node_id: number;
  main_title: string;
  segments: {
    step_node_id: number;
    subtitle: string;
    narration_text: string;
    narration_brief: string | null;
  }[];
};

export function outlineToPages(outline: OutlineNodeApi[]): ScriptPage[] {
  const pages: ScriptPage[] = [];
  for (const page of outline) {
    if (page.node_kind !== 'page') continue;
    const segments: ScriptPage['segments'] = [];
    for (const ch of page.children || []) {
      if (ch.node_kind !== 'step') continue;
      segments.push({
        step_node_id: ch.id,
        subtitle: (ch.title || '').trim(),
        narration_text: (ch.content?.narration_text || '').trim(),
        narration_brief: (ch.content?.narration_brief || '').trim() || null,
      });
    }
    pages.push({
      page_node_id: page.id,
      main_title: (page.title || '').trim(),
      segments,
    });
  }
  return pages;
}

/**
 * 纯文本：大标题 → 各段小标题 + 口播正文；可选附带概括行。
 */
export function buildNarrationPlainText(
  pages: ScriptPage[],
  includeBrief: boolean,
): string {
  const lines: string[] = [];
  for (let pi = 0; pi < pages.length; pi++) {
    const pg = pages[pi];
    const title = pg.main_title.trim() || `大标题 ${pi + 1}`;
    lines.push(`【${title}】`);
    lines.push('');
    for (const seg of pg.segments) {
      const st = seg.subtitle.trim();
      if (st) lines.push(st);
      lines.push(seg.narration_text.trim());
      if (includeBrief && seg.narration_brief?.trim()) {
        lines.push(`〔概括〕${seg.narration_brief.trim()}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n').trim();
}

export function scriptPagesHaveBrief(pages: ScriptPage[]): boolean {
  return pages.some((pg) => pg.segments.some((s) => (s.narration_brief || '').trim() !== ''));
}
