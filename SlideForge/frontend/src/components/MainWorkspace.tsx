import {
  useMemo,
  useRef,
  useCallback,
  useState,
  useEffect,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Maximize2,
  Minimize2,
  MonitorPlay,
  Loader2,
  AlertTriangle,
  Play,
  Pause,
} from 'lucide-react';
import { WorkflowStep } from './WorkflowProgressBar';

/** 仅文本+配音决定能否进入时间轴工作台 */
const TIMELINE_GATE_STEP_IDS = new Set(['text', 'audio']);
import { ClipData, PageData } from '../types';
import { PageRenderer } from './PageRenderer';
import {
  findPlayStepOnPageAtMs,
  findPlayStepAtGlobalMs,
  type PlayStep,
} from '../data/playManifest';
import { findClipAtTime } from '../utils/timelineHit';
import {
  activeSentenceIndex,
  parseDoubaoSentenceCues,
} from '../utils/narrationAlignment';

function formatClock(totalSeconds: number) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function MainWorkspace({
  steps,
  timelineUnlocked = false,
  currentTime = 0,
  clips = [],
  pages = [],
  timelineLoading = false,
  screenSize,
  playSteps = [],
  globalMs = 0,
  isPlaying = false,
  onTogglePlay,
  onSeek,
  totalDurationMs = 0,
  showSubtitles = false,
}: {
  steps?: WorkflowStep[];
  /** 文本+配音已成功：显示时间轴与主工作台（演示页可逐页加载中） */
  timelineUnlocked?: boolean;
  currentTime?: number;
  clips?: ClipData[];
  pages?: PageData[];
  /** 从后端拉取 play-manifest / 构建时间轴 */
  timelineLoading?: boolean;
  screenSize?: string;
  /** 与放映模式一致：按全局时间切换当前页内 section */
  playSteps?: PlayStep[];
  globalMs?: number;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
  /** 时间轴百分比 0–100，与底部 Timeline 一致 */
  onSeek?: (timePercent: number) => void;
  totalDurationMs?: number;
  /** 在预览画面底部叠加当前口播字幕（与时间轴同步） */
  showSubtitles?: boolean;
}) {
  const gateSteps =
    steps?.filter((s) => TIMELINE_GATE_STEP_IDS.has(s.id)) ?? [];
  const activeGateStep =
    gateSteps.find((s) => s.state === 'running' || s.state === 'error') ||
    gateSteps.find((s) => s.state === 'pending');

  const activeVideoClip = findClipAtTime(clips, 'video', currentTime);
  const activeAudioClip = findClipAtTime(clips, 'audio', currentTime);
  const activePlayStep = useMemo(
    () => findPlayStepAtGlobalMs(playSteps, globalMs),
    [playSteps, globalMs],
  );
  const activePageId =
    activeVideoClip?.pageId || activeAudioClip?.pageId || activePlayStep?.pageId;
  const activePage = pages.find((p) => p.id === activePageId);

  const deckSectionIndex = useMemo(() => {
    const pageId = activePageId;
    if (!pageId || !playSteps.length) return 0;
    const st = findPlayStepOnPageAtMs(playSteps, pageId, globalMs);
    return st?.section_index ?? 0;
  }, [activePageId, playSteps, globalMs]);

  /**
   * 与 frontend SlidePlayer / export_video 一致：豆包字级时间戳 → 句级 cue，
   * 用本段内 elapsed（globalMs - step.start_ms）高亮当前一句。
   */
  const subtitleLine = useMemo(() => {
    const st = activePlayStep;
    if (!st || st.kind === 'pause') return '';
    const clipElapsedMs = Math.max(0, globalMs - st.start_ms);
    const sentenceCues = parseDoubaoSentenceCues(st.narration_alignment);
    if (sentenceCues && sentenceCues.length > 0) {
      const idx = activeSentenceIndex(sentenceCues, clipElapsedMs);
      const cue = sentenceCues[idx];
      return (cue?.text ?? '').trim();
    }
    return (st.narration_text || '').trim();
  }, [activePlayStep, globalMs]);

  const previewShellRef = useRef<HTMLDivElement>(null);
  const fsProgressRef = useRef<HTMLDivElement>(null);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  /** 与 PageRenderer 内 deck 缩放后画布同宽，用于字幕条对齐 */
  const [deckViewportPx, setDeckViewportPx] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const onDeckViewportPxChange = useCallback(
    (size: { width: number; height: number } | null) => {
      setDeckViewportPx(size);
    },
    [],
  );

  useEffect(() => {
    setDeckViewportPx(null);
  }, [activePage?.id]);

  const handleTogglePreviewFullscreen = useCallback(() => {
    const el = previewShellRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      const el = previewShellRef.current;
      setIsPreviewFullscreen(el != null && document.fullscreenElement === el);
    };
    document.addEventListener('fullscreenchange', sync);
    sync();
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const playbackReady =
    Boolean(onTogglePlay && onSeek && totalDurationMs > 0);

  const subtitleBottomClass =
    isPreviewFullscreen && playbackReady ? 'bottom-20 sm:bottom-24' : 'bottom-4 sm:bottom-5';

  useEffect(() => {
    if (!isPreviewFullscreen || !playbackReady || !onTogglePlay) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const el = e.target as HTMLElement | null;
      if (el?.closest('button, [href], input, textarea, select, [contenteditable="true"]')) {
        return;
      }
      e.preventDefault();
      onTogglePlay();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPreviewFullscreen, playbackReady, onTogglePlay]);

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const track = fsProgressRef.current;
      if (!track || !onSeek) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      const x = clientX - rect.left;
      const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
      onSeek(pct);
    },
    [onSeek],
  );

  const handleFsProgressMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!playbackReady) return;
      e.preventDefault();
      e.stopPropagation();
      seekFromClientX(e.clientX);
      const onMove = (ev: MouseEvent) => seekFromClientX(ev.clientX);
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [playbackReady, seekFromClientX],
  );

  const showInitialPipelineGate =
    !timelineUnlocked && Boolean(activeGateStep);

  if (showInitialPipelineGate) {
    const isError = activeGateStep.state === 'error';
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center bg-zinc-950 relative">
        <div className="flex flex-col items-center gap-4">
          {isError ? (
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-500" />
            </div>
          ) : (
            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          )}
          <div className="text-center">
            <h3 className="text-lg font-medium text-zinc-200">
              {isError
                ? `${activeGateStep.label} 出错`
                : `正在处理：${activeGateStep.label}…`}
            </h3>
            <p className="text-sm text-zinc-500 mt-1">
              {isError
                ? '可在顶部进度条该步骤上点击重试。'
                : '可能需要一点时间。'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (timelineLoading) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center bg-zinc-950 relative">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
          <div className="text-center">
            <h3 className="text-lg font-medium text-zinc-200">加载时间轴...</h3>
            <p className="text-sm text-zinc-500 mt-1">从服务器同步音频片段...</p>
          </div>
        </div>
      </div>
    );
  }

  /** 预览区子树内滚动条隐藏（iframe 内文档另见 deckIframeDoc） */
  const previewNoScrollbar =
    '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar]:w-0 [&_*]:[scrollbar-width:none] [&_*]:[-ms-overflow-style:none] [&_*::-webkit-scrollbar]:h-0 [&_*::-webkit-scrollbar]:w-0';

  return (
    <div
      className={`flex min-h-0 min-w-0 flex-1 flex-col bg-zinc-950 relative ${previewNoScrollbar}`}
    >
      {/* Preview Area */}
      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden p-4 ${previewNoScrollbar}`}
      >
        <div
          ref={previewShellRef}
          className={`flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden border border-zinc-800 bg-black shadow-2xl relative group ${previewNoScrollbar} ${
            isPreviewFullscreen ? 'rounded-none' : 'rounded-xl'
          }`}
        >
          {/* Web Page Preview Surface */}
          <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 to-zinc-950 opacity-70" />

          <div
            className={`absolute inset-0 flex min-h-0 min-w-0 items-center justify-center overflow-hidden p-3 sm:p-4 ${
              isPreviewFullscreen && playbackReady ? 'pb-20 sm:pb-24' : ''
            }`}
          >
            <div className="relative flex h-full w-full min-h-0 min-w-0 max-h-full max-w-full items-center justify-center overflow-hidden">
              {activePage ? (
                <div className="h-full w-full min-h-0 min-w-0 max-h-full max-w-full overflow-hidden [&_.sf-neoncast-deck-iframe]:pointer-events-none">
                  <PageRenderer
                    page={activePage}
                    screenSize={screenSize}
                    sectionIndex={deckSectionIndex}
                    onDeckViewportPxChange={onDeckViewportPxChange}
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 text-zinc-600">
                  <MonitorPlay className="w-16 h-16 text-zinc-700" />
                  <span className="text-sm">没有活动页面</span>
                </div>
              )}
            </div>

            {/* Audio-driven step marker */}
            {activeAudioClip && (
              <div className="pointer-events-none absolute top-3 left-3 z-10 max-w-[calc(100%-1.5rem)] truncate rounded-full border border-zinc-700/60 bg-zinc-900/80 px-2.5 py-1 text-[11px] font-mono text-zinc-200 backdrop-blur sm:top-4 sm:left-4 sm:px-3 sm:text-xs">
                {activeAudioClip.label}
              </div>
            )}

            {showSubtitles && subtitleLine ? (
              <div
                className={`pointer-events-none absolute z-[25] max-h-[28%] ${subtitleBottomClass} ${
                  deckViewportPx
                    ? 'left-1/2 max-w-full -translate-x-1/2 px-2'
                    : 'left-3 right-3 w-auto sm:left-4 sm:right-4'
                }`}
                style={
                  deckViewportPx
                    ? { width: `${deckViewportPx.width}px` }
                    : undefined
                }
              >
                <p
                  className="px-3 py-2 text-center text-xs font-medium leading-relaxed text-white sm:px-4 sm:text-base [text-shadow:1px_1px_0_#000,-1px_-1px_0_#000,1px_-1px_0_#000,-1px_1px_0_#000,0_1px_0_#000,0_-1px_0_#000,1px_0_0_#000,-1px_0_0_#000]"
                >
                  {subtitleLine}
                </p>
              </div>
            ) : null}
          </div>
          
          {/* Overlay Controls */}
          <div className="absolute bottom-3 left-3 right-3 z-20 flex min-w-0 items-center justify-end gap-2 opacity-0 transition-opacity group-hover:opacity-100 sm:bottom-4 sm:left-4 sm:right-4">
            {/* 音量 UI 暂不需要，保留结构便于以后接 audioRef
            <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700/50 bg-zinc-900/80 p-1.5 backdrop-blur-md">
              <button type="button" className="shrink-0 rounded-md p-1.5 text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white">
                <Volume2 className="h-4 w-4" />
              </button>
              <div className="h-1 w-20 shrink-0 overflow-hidden rounded-full bg-zinc-700 sm:w-24">
                <div className="h-full w-2/3 bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
              </div>
            </div>
            */}
            <button
              type="button"
              onClick={handleTogglePreviewFullscreen}
              title={isPreviewFullscreen ? '退出全屏' : '全屏预览'}
              className="shrink-0 rounded-lg border border-zinc-700/50 bg-zinc-900/80 p-1.5 text-zinc-300 backdrop-blur-md transition-colors hover:bg-zinc-700 hover:text-white"
            >
              {isPreviewFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* 全屏时底部浮动播放条 */}
          {isPreviewFullscreen && playbackReady ? (
            <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-40 flex min-w-0 items-center gap-3 border-t border-zinc-800/80 bg-zinc-950/90 px-4 py-3 backdrop-blur-md sm:gap-4 sm:px-6 sm:py-4">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTogglePlay?.();
                }}
                title={isPlaying ? '暂停（空格）' : '播放（空格）'}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-purple-500/40 bg-purple-600/90 text-white shadow-[0_0_20px_rgba(168,85,247,0.35)] transition-colors hover:bg-purple-500"
              >
                {isPlaying ? (
                  <Pause className="h-5 w-5 fill-current" />
                ) : (
                  <Play className="h-5 w-5 fill-current pl-0.5" />
                )}
              </button>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div
                  ref={fsProgressRef}
                  role="slider"
                  tabIndex={0}
                  aria-valuenow={Math.round(currentTime)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  onMouseDown={handleFsProgressMouseDown}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowLeft' && onSeek) {
                      e.preventDefault();
                      onSeek(Math.max(0, currentTime - 2));
                    }
                    if (e.key === 'ArrowRight' && onSeek) {
                      e.preventDefault();
                      onSeek(Math.min(100, currentTime + 2));
                    }
                  }}
                  className="relative h-2 w-full cursor-pointer rounded-full bg-zinc-800"
                >
                  <div
                    className="absolute left-0 top-0 h-full rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]"
                    style={{ width: `${currentTime}%` }}
                  />
                </div>
                <div className="flex justify-between font-mono text-[10px] text-zinc-500 sm:text-xs">
                  <span>{formatClock(globalMs / 1000)}</span>
                  <span>{formatClock(totalDurationMs / 1000)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTogglePreviewFullscreen();
                }}
                title="退出全屏"
                className="shrink-0 rounded-lg border border-zinc-700/60 bg-zinc-900/90 p-2 text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
