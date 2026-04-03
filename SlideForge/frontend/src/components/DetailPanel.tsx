import { Fragment, useMemo, useState, useRef, useLayoutEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, Monitor, Sparkles, ListTree, ChevronRight } from 'lucide-react';
import { ClipData } from '../types';
import { findPlayStepOnPageAtMs, type PlayStep } from '../data/playManifest';
import { activeSentenceIndex, parseDoubaoSentenceCues } from '../utils/narrationAlignment';
import { apiFetch } from '../api';

export function DetailPanel({
  width,
  clip,
  surface,
  onSeek,
  isGenerating,
  currentTime = 0,
  totalDurationMs = 100000,
  projectId,
  onAudioResynthStart,
  onAudioResynthEnd,
  onAudioResynthSuccess,
  onDeckPageRegenSubmitted,
  onDeckPageRegenExportInvalidate,
  onDeckPageRegenExportRevert,
  deckRegenerating,
  deckRegeneratingPageNodeId,
  onNotify,
  playback,
}: {
  width?: number;
  clip: ClipData;
  /** 由 App 根据「选中视频 / 选中音频或未选」决定展示页面属性还是音频属性 */
  surface: 'page' | 'audio';
  onSeek?: (time: number) => void;
  isGenerating?: boolean;
  currentTime?: number;
  totalDurationMs?: number;
  projectId?: number | null;
  onAudioResynthStart?: () => void;
  onAudioResynthEnd?: () => void;
  onAudioResynthSuccess?: () => void;
  onDeckPageRegenSubmitted?: (pageNodeId: number) => void;
  onDeckPageRegenExportInvalidate?: (projectId: number) => void;
  onDeckPageRegenExportRevert?: (projectId: number) => void;
  deckRegenerating?: boolean;
  deckRegeneratingPageNodeId?: number | null;
  onNotify?: (message: string) => void;
  playback?: {
    steps: PlayStep[];
    currentStepIndex: number;
    globalMs: number;
    totalMs: number;
    isPlaying: boolean;
  };
}) {
  if (isGenerating) {
    return (
      <div
        style={{ width: width || 320, maxWidth: '100%' }}
        className="relative z-10 flex min-h-0 max-w-full min-w-0 shrink-0 flex-col items-center justify-center self-stretch overflow-hidden border-r border-zinc-800 light:border-slate-200 bg-zinc-900/60 light:bg-white/90 text-sm text-zinc-600 light:text-slate-400"
      >
        等待生成...
      </div>
    );
  }

  return (
    <div
      style={{ width: width || 320, maxWidth: '100%' }}
      className="relative z-10 flex min-h-0 max-w-full min-w-0 shrink-0 flex-col self-stretch overflow-hidden border-r border-zinc-800 light:border-slate-200 bg-zinc-900/60 light:bg-white/90"
    >
      <AnimatePresence mode="wait">
        {surface === 'audio' ? (
          <Fragment key={`a-${clip.id}`}>
            <AudioDetails
              clip={clip}
              currentTime={currentTime}
              totalDurationMs={totalDurationMs}
              projectId={projectId}
              onAudioResynthStart={onAudioResynthStart}
              onAudioResynthEnd={onAudioResynthEnd}
              onAudioResynthSuccess={onAudioResynthSuccess}
              onNotify={onNotify}
              playback={playback}
            />
          </Fragment>
        ) : (
          <Fragment key={`p-${clip.id}`}>
            <PageDetails
              clip={clip}
              onSeek={onSeek}
              playback={playback}
              totalDurationMs={totalDurationMs}
              projectId={projectId}
              onDeckPageRegenSubmitted={onDeckPageRegenSubmitted}
              onDeckPageRegenExportInvalidate={onDeckPageRegenExportInvalidate}
              onDeckPageRegenExportRevert={onDeckPageRegenExportRevert}
              deckRegenerating={deckRegenerating}
              deckRegeneratingPageNodeId={deckRegeneratingPageNodeId}
              onNotify={onNotify}
            />
          </Fragment>
        )}
      </AnimatePresence>
    </div>
  );
}

function AudioDetails({
  clip,
  currentTime,
  totalDurationMs,
  projectId,
  onAudioResynthStart,
  onAudioResynthEnd,
  onAudioResynthSuccess,
  onNotify,
  playback,
}: {
  clip: ClipData;
  currentTime: number;
  totalDurationMs: number;
  projectId?: number | null;
  onAudioResynthStart?: () => void;
  onAudioResynthEnd?: () => void;
  onAudioResynthSuccess?: () => void;
  onNotify?: (message: string) => void;
  playback?: {
    steps: PlayStep[];
    currentStepIndex: number;
    globalMs: number;
    totalMs: number;
    isPlaying: boolean;
  };
}) {
  const [resynthBusy, setResynthBusy] = useState(false);
  const fallbackProgress =
    clip.width > 0
      ? Math.max(0, Math.min(1, (currentTime - clip.start) / clip.width))
      : 0;

  const step = playback?.steps.find((s) => s.clip_id === clip.id);
  const isActiveStep =
    step && playback ? playback.currentStepIndex === step.step : false;
  const clipDurationMs =
    step?.duration_ms ?? (clip.width / 100) * totalDurationMs;
  const clipElapsedMs = isActiveStep && step && playback
    ? Math.max(0, Math.min(clipDurationMs, playback.globalMs - step.start_ms))
    : fallbackProgress * clipDurationMs;
  const progress =
    clipDurationMs > 0 ? Math.min(1, clipElapsedMs / clipDurationMs) : 0;

  const currentSecondsInClip = Math.floor(clipElapsedMs / 1000);

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const secs = (totalSeconds % 60).toString().padStart(2, '0');
    return `00:${mins}:${secs}`;
  };

  const sentenceCues = useMemo(() => {
    if (!step?.narration_alignment) return null;
    return parseDoubaoSentenceCues(step.narration_alignment);
  }, [step?.narration_alignment]);

  const activeCueIndex =
    sentenceCues && isActiveStep
      ? activeSentenceIndex(sentenceCues, clipElapsedMs)
      : -1;

  const captionScrollRef = useRef<HTMLDivElement>(null);
  const cueLineRefs = useRef<(HTMLDivElement | null)[]>([]);

  useLayoutEffect(() => {
    if (activeCueIndex < 0 || !sentenceCues?.length) return;
    const row = cueLineRefs.current[activeCueIndex];
    const panel = captionScrollRef.current;
    if (!row || !panel) return;
    row.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [activeCueIndex, sentenceCues]);

  const handleResynthesizeAudio = useCallback(async () => {
    if (projectId == null || !Number.isFinite(projectId)) {
      onNotify?.('未关联项目，无法配音。');
      return;
    }
    const m = /^step-(\d+)$/.exec(clip.id);
    const stepNodeId = m ? Number(m[1]) : NaN;
    if (!Number.isFinite(stepNodeId)) {
      onNotify?.('当前不是有效的口播轴片段。');
      return;
    }
    const st = playback?.steps.find((s) => s.clip_id === clip.id);
    if (!st || st.kind === 'pause') {
      onNotify?.('停顿段不支持重新配音。');
      return;
    }

    setResynthBusy(true);
    onAudioResynthStart?.();
    try {
      const resp = await apiFetch<{
        reused_existing?: boolean;
        message?: string;
      }>(`/api/projects/${projectId}/outline-nodes/${stepNodeId}/resynthesize-audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (resp?.reused_existing) {
        onNotify?.(resp.message || '该段音频已就绪，无需重新配音。');
      } else {
        onAudioResynthSuccess?.();
      }
    } catch (e) {
      onNotify?.(e instanceof Error ? e.message : String(e));
    } finally {
      onAudioResynthEnd?.();
      setResynthBusy(false);
    }
  }, [
    projectId,
    clip.id,
    playback?.steps,
    onAudioResynthStart,
    onAudioResynthEnd,
    onAudioResynthSuccess,
    onNotify,
  ]);

  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: 20 }} 
      transition={{ duration: 0.2 }}
      className="absolute inset-0 flex min-h-0 min-w-0 flex-col gap-6 overflow-hidden p-4"
    >
      <div className="flex shrink-0 min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 font-medium text-purple-400">
          <div className="shrink-0 rounded-md border border-purple-500/20 bg-purple-500/10 p-1.5">
            <Mic className="h-4 w-4" />
          </div>
          <span className="min-w-0 truncate">音频属性</span>
        </div>
        <button
          type="button"
          disabled={resynthBusy}
          onClick={() => void handleResynthesizeAudio()}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-purple-600 px-3 text-xs font-medium text-white shadow-[0_0_15px_rgba(168,85,247,0.3)] transition-all hover:bg-purple-500 hover:shadow-[0_0_20px_rgba(168,85,247,0.5)] disabled:pointer-events-none disabled:opacity-50 sm:px-3.5 sm:text-sm"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
          <span className="whitespace-nowrap">{resynthBusy ? '生成中…' : '重新生成'}</span>
        </button>
      </div>

      <div className="flex flex-col gap-3 shrink-0">
        <div className="flex items-center justify-between text-xs font-medium text-zinc-500 light:text-slate-500 uppercase tracking-wider">
          <span>播放</span>
          <span className="text-purple-400">{formatTime(currentSecondsInClip)} / {clip.duration}</span>
        </div>
        <div className="flex h-10 items-center rounded-lg border border-zinc-800/80 light:border-slate-200 bg-zinc-950 light:bg-slate-50 px-3">
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-zinc-700 light:bg-slate-200">
            <div
              className="absolute left-0 top-0 h-full rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.45)] transition-[width] duration-75"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex shrink-0 items-center justify-between text-xs font-medium uppercase tracking-wider text-zinc-500 light:text-slate-500">
          <span>实时字幕</span>
        </div>
        <div className="flex min-h-[120px] min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-800/80 light:border-slate-200 bg-zinc-950/50 light:bg-slate-50 text-sm text-zinc-300 light:text-slate-700 break-words">
          {sentenceCues && sentenceCues.length > 0 ? (
            <div
              ref={captionScrollRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 pr-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <div className="flex flex-col gap-2">
                {sentenceCues.map((cue, idx) => (
                  <div
                    key={`${cue.start_ms}-${idx}`}
                    ref={(el) => {
                      cueLineRefs.current[idx] = el;
                    }}
                    className={
                      idx === activeCueIndex
                        ? 'scroll-mt-0 rounded border border-purple-500/30 bg-purple-500/20 px-1.5 py-0.5 text-zinc-100'
                        : 'rounded border border-transparent px-1.5 py-0.5 text-zinc-500 light:text-slate-400'
                    }
                  >
                    {cue.text}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="shrink-0 p-3 text-zinc-400 light:text-slate-600">
              {step?.narration_text || clip.content || 'No narration available.'}
            </div>
          )}
        </div>
      </div>


    </motion.div>
  );
}

function formatSecondsFromTimelinePercent(percent: number, totalMs: number): string {
  const s = (percent / 100) * (totalMs / 1000);
  if (!Number.isFinite(s) || s < 0) return '—';
  const t = Math.round(s * 10) / 10;
  return Number.isInteger(t) ? `${t}秒` : `${t.toFixed(1)}秒`;
}

function PageDetails({
  clip,
  onSeek,
  playback,
  totalDurationMs,
  projectId,
  onDeckPageRegenSubmitted,
  onDeckPageRegenExportInvalidate,
  onDeckPageRegenExportRevert,
  deckRegenerating = false,
  deckRegeneratingPageNodeId = null,
  onNotify,
}: {
  clip: ClipData;
  onSeek?: (time: number) => void;
  playback?: {
    steps: PlayStep[];
    globalMs: number;
  };
  totalDurationMs: number;
  projectId?: number | null;
  onDeckPageRegenSubmitted?: (pageNodeId: number) => void;
  onDeckPageRegenExportInvalidate?: (projectId: number) => void;
  onDeckPageRegenExportRevert?: (projectId: number) => void;
  deckRegenerating?: boolean;
  deckRegeneratingPageNodeId?: number | null;
  onNotify?: (message: string) => void;
}) {
  const [nodesExpanded, setNodesExpanded] = useState(true);
  const [pageGenBusy, setPageGenBusy] = useState(false);
  const currentPageNodeId = useMemo(() => {
    if (clip.type !== 'video' || !clip.pageId) return null;
    const pm = /^page-(\d+)$/.exec(clip.pageId);
    const id = pm ? Number(pm[1]) : NaN;
    return Number.isFinite(id) ? id : null;
  }, [clip.type, clip.pageId]);
  const deckRegeneratingOnCurrentPage =
    deckRegenerating &&
    currentPageNodeId != null &&
    deckRegeneratingPageNodeId != null &&
    currentPageNodeId === deckRegeneratingPageNodeId;
  const effectivePageGenBusy = pageGenBusy || deckRegeneratingOnCurrentPage;

  const pageContextBrief = useMemo(() => {
    if (clip.type !== 'video' || !clip.pageId) {
      return '';
    }
    if (!playback?.steps.length) {
      return '（尚未加载时间轴 / play-manifest，无法匹配口播提要）';
    }
    const st = findPlayStepOnPageAtMs(
      playback.steps,
      clip.pageId,
      playback.globalMs,
    );
    if (!st) {
      return ' ';
    }
    if (st.kind === 'pause') {
      return '（本段为停顿，无口播提要）';
    }
    const b = (st.narration_brief || '').trim();
    if (b) return b;
    return '（本段暂无 narration_brief，可在后端提纲/结构化文案中为该段填写 brief）';
  }, [clip.type, clip.pageId, playback?.steps, playback?.globalMs]);

  const handleRegenerateDeckPage = useCallback(async () => {
    if (projectId == null || !Number.isFinite(projectId)) {
      onNotify?.('未关联项目，无法生成页面。');
      return;
    }
    if (clip.type !== 'video' || !clip.pageId) {
      onNotify?.('当前不是演示大页，无法重新生成。');
      return;
    }
    if (!Number.isFinite(currentPageNodeId)) {
      onNotify?.('无法解析页面节点 id。');
      return;
    }
    setPageGenBusy(true);
    onDeckPageRegenExportInvalidate?.(projectId);
    try {
      await apiFetch(
        `/api/projects/${projectId}/outline-nodes/${currentPageNodeId}/generate-deck-page`,
        { method: 'POST' },
      );
      onDeckPageRegenSubmitted?.(currentPageNodeId);
    } catch (e) {
      onDeckPageRegenExportRevert?.(projectId);
      onNotify?.(e instanceof Error ? e.message : String(e));
    } finally {
      setPageGenBusy(false);
    }
  }, [
    projectId,
    clip.type,
    clip.pageId,
    currentPageNodeId,
    onDeckPageRegenSubmitted,
    onDeckPageRegenExportInvalidate,
    onDeckPageRegenExportRevert,
    onNotify,
  ]);

  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }} 
      animate={{ opacity: 1, x: 0 }} 
      exit={{ opacity: 0, x: 20 }} 
      transition={{ duration: 0.2 }}
      className="absolute inset-0 flex min-w-0 flex-col gap-6 overflow-y-auto p-4 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
    >
      <div className="flex shrink-0 min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 font-medium text-blue-400">
          <div className="shrink-0 rounded-md border border-blue-500/20 bg-blue-500/10 p-1.5">
            <Monitor className="h-4 w-4" />
          </div>
          <span className="min-w-0 truncate">页面属性</span>
        </div>
        <button
          type="button"
          disabled={effectivePageGenBusy}
          onClick={() => void handleRegenerateDeckPage()}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-medium text-white shadow-[0_0_15px_rgba(59,130,246,0.3)] transition-all hover:bg-blue-500 hover:shadow-[0_0_20px_rgba(59,130,246,0.5)] disabled:pointer-events-none disabled:opacity-50 sm:px-3.5 sm:text-sm"
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
          <span className="whitespace-nowrap">{effectivePageGenBusy ? '提交中…' : '重新生成'}</span>
        </button>
      </div>

      <div className="flex flex-col gap-3 shrink-0">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wider text-zinc-500 light:text-slate-500">
            <span>页面上下文</span>
            <span className="font-mono normal-case tracking-normal text-blue-400">
              {clip.duration}
            </span>
          </div>
          {/* <p className="text-[10px] leading-snug text-zinc-600">
            与放映模式一致：预览随音频时间切换页内板块；此处展示当前时间轴片段对应的口播提要（narration_brief）。
          </p> */}
        </div>
        <textarea
          readOnly
          value={pageContextBrief}
          rows={1}
          className="min-h-32 max-h-64 w-full min-w-0 resize-none overflow-y-auto rounded-lg border border-zinc-800/80 light:border-slate-200 bg-zinc-950 light:bg-slate-50 p-3 text-sm leading-relaxed text-zinc-300 light:text-slate-700 [field-sizing:content]"
        />
      </div>

      <div className="flex flex-col gap-3 shrink-0">
        <button
          type="button"
          onClick={() => setNodesExpanded(!nodesExpanded)}
          className="flex w-full items-center justify-between text-left text-xs font-medium uppercase tracking-wider text-zinc-500 light:text-slate-500 transition-colors hover:text-zinc-300 light:hover:text-slate-700"
        >
          <div className="flex items-center gap-1">
            <motion.div animate={{ rotate: nodesExpanded ? 90 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronRight className="w-3 h-3" />
            </motion.div>
            <span>片段节点</span>
          </div>
          <ListTree className="w-3 h-3 text-zinc-500" />
        </button>
        <AnimatePresence initial={false}>
  {nodesExpanded && (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className="overflow-hidden"
    >
      <div className="relative pl-3 pt-1.5 pb-1">

        <div className="flex flex-col gap-1.5">
          {clip.nodes?.map((node) => (
            <button
              type="button"
              key={node.id}
              onClick={() => onSeek?.(node.time)}
              className="group relative flex w-full min-w-0 items-center gap-3 rounded-xl p-2 text-left transition-all duration-150 hover:bg-zinc-800/40 light:hover:bg-slate-100/80 focus:outline-none focus:ring-1 focus:ring-blue-500/40 focus:ring-offset-0"
            >
              {/* 圆形指示器 - 内嵌圆环，悬浮时变为实心光晕 */}
              <div className="relative z-10 flex h-2.5 w-2.5 shrink-0 items-center justify-center">
                <div className="h-2 w-2 rounded-full border border-zinc-500 light:border-slate-300 bg-zinc-900 light:bg-white transition-all duration-150 group-hover:border-blue-400 group-hover:bg-blue-500/20" />
              </div>

              {/* 节点标题 */}
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-400 light:text-slate-500 transition-colors duration-150 group-hover:text-zinc-200 light:group-hover:text-slate-800">
                {node.title}
              </span>

              {/* 时间戳 */}
              <span className="ml-auto font-mono text-[11px] tabular-nums text-zinc-600 light:text-slate-400 transition-colors duration-150 group-hover:text-blue-400/80">
                {formatSecondsFromTimelinePercent(node.time, totalDurationMs)}
              </span>
            </button>
          ))}

          {(!clip.nodes || clip.nodes.length === 0) && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-700/60 light:border-slate-300/60 bg-zinc-800/20 light:bg-slate-100/50 px-3 py-2 text-xs text-zinc-500 light:text-slate-400">
              <span className="i-lucide:inbox h-3.5 w-3.5 opacity-50" /> {/* 需要确保图标库支持，或直接使用文字符号 */}
              <span>暂无节点</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )}
</AnimatePresence>
      </div>

      <div className="flex-1" />
    </motion.div>
  );
}
