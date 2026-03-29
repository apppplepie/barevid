import { AudioSegmentData, ClipData, ClipNode, PageData } from '../types';

export const PAGES: PageData[] = [
  {
    id: 'page-overview',
    title: 'Neoncast Mission Control',
    subtitle: 'System pulse, build cadence, and delivery notes.',
    kind: 'overview',
    accent: 'from-cyan-400/20 via-blue-500/10 to-zinc-950',
    metrics: [
      { label: 'Episodes', value: '42', delta: '+3 this week' },
      { label: 'Avg Watch', value: '18.4m', delta: '+6.2%' },
      { label: 'Queue Health', value: '97%', delta: 'Stable' },
    ],
    bullets: [
      'Auto-cut is aligned to narration beats.',
      'Render queue is under 3 minutes.',
      'Voice pack: Atlas v2 with clarity boost.',
    ],
  },
  {
    id: 'page-signals',
    title: 'Audience Signal Grid',
    subtitle: 'Sentiment, retention, and heat map.',
    kind: 'signals',
    accent: 'from-purple-500/20 via-fuchsia-500/10 to-zinc-950',
    metrics: [
      { label: 'Retention', value: '71%', delta: '+4.1%' },
      { label: 'Peak Replay', value: '3.2x', delta: 'Segment 2' },
      { label: 'Live Mentions', value: '128', delta: '+28' },
    ],
    chart: [12, 22, 18, 30, 42, 38, 55, 62, 58, 74, 68, 80],
    bullets: [
      'Audience spikes align with the demo timeline.',
      'High replay on the neural rendering breakdown.',
      'Next edit: tighten the intro by 12 seconds.',
    ],
  },
  {
    id: 'page-ops',
    title: 'Release Ops Console',
    subtitle: 'Launch steps and risk checklist.',
    kind: 'ops',
    accent: 'from-emerald-400/20 via-teal-500/10 to-zinc-950',
    metrics: [
      { label: 'Build', value: 'Green', delta: 'All checks passed' },
      { label: 'Deploy', value: 'Staged', delta: 'ETA 08:20' },
      { label: 'Fallback', value: 'Ready', delta: 'Snapshot v41' },
    ],
    bullets: [
      'CDN warm-up queued.',
      'Social teasers scheduled.',
      'Backup rendering node online.',
    ],
  },
];

export const AUDIO_SEGMENTS: AudioSegmentData[] = [
  {
    id: 'seg-01',
    pageId: 'page-overview',
    title: 'System Check',
    script:
      'Welcome back to Neoncast. We start with a full system pulse and the latest delivery rhythm.',
    durationMs: 9000,
  },
  {
    id: 'seg-02',
    pageId: 'page-overview',
    title: 'Pipeline Snapshot',
    script:
      'Scene assembly is synced to narration beats, with automatic cut logic tuned for clarity.',
    durationMs: 11000,
  },
  {
    id: 'seg-03',
    pageId: 'page-overview',
    title: 'Queue Status',
    script:
      'Render queue depth is healthy. We are holding under three minutes end to end.',
    durationMs: 8000,
  },
  {
    id: 'seg-04',
    pageId: 'page-signals',
    title: 'Retention Rise',
    script:
      'Audience retention climbed again. Segment two is responsible for most of the lift.',
    durationMs: 10000,
  },
  {
    id: 'seg-05',
    pageId: 'page-signals',
    title: 'Replay Heat',
    script:
      'Replay density peaks during the neural rendering breakdown. That clip is a keeper.',
    durationMs: 12000,
  },
  {
    id: 'seg-06',
    pageId: 'page-signals',
    title: 'Next Edit',
    script:
      'We should tighten the intro by twelve seconds to keep the pacing crisp.',
    durationMs: 9000,
  },
  {
    id: 'seg-07',
    pageId: 'page-ops',
    title: 'Release Prep',
    script:
      'The build is green. We are staging deploy with a safety snapshot ready.',
    durationMs: 10000,
  },
  {
    id: 'seg-08',
    pageId: 'page-ops',
    title: 'Launch Steps',
    script:
      'CDN warm-up is queued, social teasers are scheduled, and backup nodes are online.',
    durationMs: 12000,
  },
];

function formatDurationMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export function buildTimelineClips(): { clips: ClipData[]; totalDurationMs: number } {
  const totalDurationMs = AUDIO_SEGMENTS.reduce(
    (acc, seg) => acc + seg.durationMs,
    0
  );
  const safeTotal = Math.max(1, totalDurationMs);
  let cursorMs = 0;

  const segmentsWithTiming = AUDIO_SEGMENTS.map((seg) => {
    const startMs = cursorMs;
    const start = (startMs / safeTotal) * 100;
    const width = (seg.durationMs / safeTotal) * 100;
    cursorMs += seg.durationMs;
    return { ...seg, startMs, start, width };
  });

  const audioClips: ClipData[] = segmentsWithTiming.map((seg) => ({
    id: seg.id,
    type: 'audio',
    label: seg.title,
    start: seg.start,
    width: seg.width,
    duration: formatDurationMs(seg.durationMs),
    content: seg.script,
    pageId: seg.pageId,
    locked: true,
  }));

  const pageOrder: string[] = [];
  segmentsWithTiming.forEach((seg) => {
    if (!pageOrder.includes(seg.pageId)) pageOrder.push(seg.pageId);
  });

  const pageMap = new Map(PAGES.map((page) => [page.id, page]));

  const videoClips: ClipData[] = pageOrder.map((pageId) => {
    const page = pageMap.get(pageId);
    const pageSegments = segmentsWithTiming.filter((seg) => seg.pageId === pageId);
    const startMs = pageSegments[0]?.startMs ?? 0;
    const durationMs = pageSegments.reduce(
      (acc, seg) => acc + seg.durationMs,
      0
    );
    const start = (startMs / safeTotal) * 100;
    const width = (durationMs / safeTotal) * 100;
    const nodes: ClipNode[] = pageSegments.map((seg) => ({
      id: `node-${seg.id}`,
      title: seg.title,
      time: seg.start,
    }));

    return {
      id: `video-${pageId}`,
      type: 'video',
      label: page?.title || pageId,
      start,
      width,
      duration: formatDurationMs(durationMs),
      content: page?.subtitle || 'Web page segment',
      style: page?.kind,
      nodes,
      pageId,
      locked: true,
    };
  });

  return {
    clips: [...videoClips, ...audioClips],
    totalDurationMs,
  };
}
