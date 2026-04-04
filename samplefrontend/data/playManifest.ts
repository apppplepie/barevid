import { ClipData, ClipNode, PageData, type PageDeckStatus } from '../types';

function normalizeDeckStatus(raw: string | undefined | null): PageDeckStatus {
  const v = (raw || 'idle').trim().toLowerCase();
  if (v === 'generating') return 'generating';
  if (v === 'failed') return 'failed';
  if (v === 'ready') return 'ready';
  return 'idle';
}

export type PlayManifestStep = {
  step_id: number;
  timeline_index: number;
  section_index: number;
  kind: string;
  title: string;
  narration_text: string;
  /** 与口播对应的提要，供编辑区 Page Context 展示 */
  narration_brief?: string | null;
  narration_alignment?: unknown;
  audio_url: string;
  duration_ms: number;
  start_ms: number;
};

export type PlayManifestPage = {
  page_id: number;
  title: string;
  html: string;
  steps: PlayManifestStep[];
  page_deck_status?: string;
  page_deck_error?: string | null;
};

export type PlayManifest = {
  project_id: number;
  title: string;
  /** 与 projects.deck_page_size 一致，供编辑区放映预览与录屏对齐 */
  deck_page_size?: string;
  pages: PlayManifestPage[];
};

export type PlayStep = {
  step: number;
  step_id: number;
  clip_id: string;
  /** 与 ClipData.pageId 一致，如 page-12 */
  pageId: string;
  start_ms: number;
  duration_ms: number;
  audio_url: string;
  subtitle: string;
  kind?: 'step' | 'pause';
  section_index: number;
  narration_text?: string;
  narration_brief?: string;
  narration_alignment?: unknown;
};

const FALLBACK_STEP_MS = 3000;

/** 当前全局时间落在该页上的那条时间轴 step（含 pause） */
export function findPlayStepOnPageAtMs(
  steps: PlayStep[],
  pageId: string | undefined,
  globalMs: number,
): PlayStep | undefined {
  if (!pageId || !steps.length) return undefined;
  return steps.find(
    (s) =>
      s.pageId === pageId &&
      globalMs >= s.start_ms &&
      globalMs < s.start_ms + s.duration_ms,
  );
}

/** 当前全局时间所在的时间轴 step（含 pause），用于预览区字幕等 */
export function findPlayStepAtGlobalMs(
  steps: PlayStep[],
  globalMs: number,
): PlayStep | undefined {
  if (!steps.length) return undefined;
  return steps.find(
    (s) => globalMs >= s.start_ms && globalMs < s.start_ms + s.duration_ms,
  );
}

function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

/**
 * 与 mockData.buildTimelineClips 一致：音频段驱动总时长；视频轨按「大页」聚合，节点对齐每段起点。
 */
export function buildTimelineFromPlayManifest(manifest: PlayManifest): {
  clips: ClipData[];
  totalDurationMs: number;
  pages: PageData[];
  steps: PlayStep[];
} {
  type Seg = {
    id: string;
    pageId: string;
    title: string;
    script: string;
    durationMs: number;
    kind: string;
    audioUrl?: string;
    startMs: number;
  };

  const segments: Seg[] = [];
  const steps: PlayStep[] = [];
  let cursorMs = 0;
  let stepIndex = 0;

  for (const page of manifest.pages || []) {
    const pageId = `page-${page.page_id}`;
    for (const st of page.steps || []) {
      const rawMs = Number(st.duration_ms) || 0;
      const durationMs = rawMs > 0 ? rawMs : FALLBACK_STEP_MS;
      const title =
        st.kind === 'pause'
          ? (st.title || '').trim() || 'Pause'
          : (st.title || '').trim() || 'Step';
      const script =
        st.kind === 'step' ? (st.narration_text || '').trim() : '';
      const startMs = cursorMs;
      cursorMs += durationMs;
      const clipId = `step-${st.step_id}`;
      segments.push({
        id: `step-${st.step_id}`,
        pageId,
        title,
        script,
        durationMs,
        kind: st.kind,
        audioUrl: (st.audio_url || '').trim() || undefined,
        startMs,
      });
      const briefRaw = st.narration_brief;
      const narrationBrief =
        typeof briefRaw === 'string' ? briefRaw.trim() : '';
      steps.push({
        step: stepIndex,
        step_id: st.step_id,
        clip_id: clipId,
        pageId,
        start_ms: startMs,
        duration_ms: durationMs,
        audio_url: (st.audio_url || '').trim(),
        subtitle: title,
        kind: st.kind === 'pause' ? 'pause' : 'step',
        section_index: Number(st.section_index) || 0,
        narration_text: script,
        narration_brief: narrationBrief || undefined,
        narration_alignment: st.narration_alignment,
      });
      stepIndex += 1;
    }
  }

  const safeTotal = Math.max(1, segments.reduce((a, s) => a + s.durationMs, 0));

  const audioClips: ClipData[] = segments.map((seg) => ({
    id: seg.id,
    type: 'audio',
    label: seg.title,
    start: (seg.startMs / safeTotal) * 100,
    width: (seg.durationMs / safeTotal) * 100,
    duration: formatDurationMs(seg.durationMs),
    content: seg.script || (seg.kind === 'pause' ? '(pause)' : ''),
    pageId: seg.pageId,
    locked: true,
    audioUrl: seg.audioUrl,
  }));

  const pageOrder: string[] = [];
  for (const p of manifest.pages || []) {
    const pid = `page-${p.page_id}`;
    if (!pageOrder.includes(pid)) pageOrder.push(pid);
  }

  const videoClips: ClipData[] = [];
  for (const pageId of pageOrder) {
    const page = (manifest.pages || []).find((p) => `page-${p.page_id}` === pageId);
    if (!page) continue;
    const pageSegments = segments.filter((s) => s.pageId === pageId);
    const startMs = pageSegments[0]?.startMs ?? 0;
    const durationMs = pageSegments.reduce((a, s) => a + s.durationMs, 0);
    const start = (startMs / safeTotal) * 100;
    const width = (durationMs / safeTotal) * 100;
    const nodes: ClipNode[] = pageSegments.map((seg) => ({
      id: `node-${seg.id}`,
      title: seg.title,
      time: (seg.startMs / safeTotal) * 100,
    }));

    videoClips.push({
      id: `video-${pageId}`,
      type: 'video',
      label: page.title || 'Page',
      start,
      width,
      duration: formatDurationMs(durationMs),
      content: (page.html || '').trim() ? 'Deck HTML' : 'No deck HTML yet',
      pageId,
      nodes,
      locked: true,
    });
  }

  const pages: PageData[] = (manifest.pages || []).map((p) => {
    const htmlTrim = (p.html || '').trim();
    const rawDs = normalizeDeckStatus(p.page_deck_status);
    const deckStatus: PageDeckStatus =
      htmlTrim && rawDs !== 'failed' ? 'ready' : rawDs;
    const err = (p.page_deck_error || '').trim();
    return {
      id: `page-${p.page_id}`,
      title: p.title || 'Page',
      subtitle: undefined,
      kind: 'overview' as const,
      accent: 'from-zinc-800/40 via-zinc-900/20 to-zinc-950',
      html: htmlTrim || undefined,
      deckStatus,
      deckError: err || undefined,
    };
  });

  return {
    clips: [...videoClips, ...audioClips],
    totalDurationMs: safeTotal,
    pages,
    steps,
  };
}
