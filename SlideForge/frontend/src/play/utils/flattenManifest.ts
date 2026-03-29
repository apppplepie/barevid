import type {
  PlayManifest,
  PlayPageMeta,
  PlaySlide,
  PlayStep,
  StepAction,
} from '../types/slide';

/**
 * 将 API 的 pages[] 压成 SlidePlayer 用的单轨 PlaySlide（全局 step 下标与 deck 一致）。
 */
export function flattenManifestForPlayer(manifest: PlayManifest): PlaySlide {
  let start = 0;
  let ti = 0;
  const steps: PlayStep[] = [];
  const legacyActions: Record<string, StepAction[]> = {};
  const pageMeta: PlayPageMeta[] = [];

  for (const page of manifest.pages) {
    const pageId = `page-${page.page_id}`;
    const html = (page.html ?? '').trim();
    const hasPageHtml = Boolean(html);
    const firstStepIndex = ti;

    if (page.steps.length === 0) {
      pageMeta.push({
        page_id: page.page_id,
        title: page.title,
        html,
        firstStepIndex: ti,
        lastStepIndex: ti - 1,
      });
      continue;
    }

    for (const st of page.steps) {
      const baseDur = Math.max(0, st.duration_ms ?? 0);
      const effectiveDur =
        st.kind === 'pause' && baseDur === 0 ? 500 : baseDur;
      const subtitle =
        (st.title || '').trim() ||
        (st.kind === 'pause' ? '（停顿）' : '（无小标题）');

      const briefRaw =
        st.kind === 'step' && st.narration_brief != null
          ? String(st.narration_brief).trim()
          : '';
      steps.push({
        step: ti,
        start_ms: start,
        duration_ms: effectiveDur,
        audio_url: st.audio_url || '',
        subtitle,
        kind: st.kind,
        pageId,
        section_index:
          typeof st.section_index === 'number' ? st.section_index : 0,
        narration_text:
          st.kind === 'step' ? (st.narration_text || '').trim() : undefined,
        narration_brief: briefRaw || undefined,
        narration_alignment:
          st.kind === 'step' ? st.narration_alignment : undefined,
      });

      if (!hasPageHtml) {
        legacyActions[String(ti)] = [
          {
            type: 'add',
            target: `subtitle-${ti}`,
            content: subtitle,
          },
        ];
      }

      start += effectiveDur;
      ti++;
    }

    const lastStepIndex = ti - 1;
    pageMeta.push({
      page_id: page.page_id,
      title: page.title,
      html,
      firstStepIndex,
      lastStepIndex,
    });
  }

  return { id: 1, title: manifest.title, steps, legacyActions, pageMeta };
}
