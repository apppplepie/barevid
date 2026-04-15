import {
  type SyntheticEvent,
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStepPlayer } from "../hooks/useStepPlayer";
import type { PlaySlide, StepAction } from "../types/slide";
import {
  activeSentenceIndex,
  parseDoubaoSentenceCues,
} from "../utils/narrationAlignment";
import { foldVisibleElements, pickActivePage } from "../utils/stepResolver";
import { ElementRenderer } from "./ElementRenderer";
import { SlideView } from "./SlideView";
import { buildDeckIframeSrcDoc } from "../utils/deckIframeDoc";

function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}:${String(r).padStart(2, "0")}` : `${r}s`;
}

function formatClockAlways(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalS = Math.floor(ms / 1000);
  const m = Math.floor(totalS / 60);
  const r = totalS % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function mediaErrorLabel(el: HTMLAudioElement): string {
  const err = el.error;
  if (!err) return "音频加载失败";
  switch (err.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return "播放已中止";
    case MediaError.MEDIA_ERR_NETWORK:
      return "网络错误，请检查 /media 或网络";
    case MediaError.MEDIA_ERR_DECODE:
      return "音频解码失败";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "不支持该音频格式";
    default:
      return "音频播放出错";
  }
}

const MANUAL_NAV_NEXT_KEYS = new Set([
  "ArrowRight",
  "ArrowDown",
  " ",
  "PageDown",
  "Enter",
]);
const MANUAL_NAV_PREV_KEYS = new Set(["ArrowLeft", "ArrowUp", "PageUp"]);

/** 手动翻页：焦点在 iframe 内时父 window 收不到 keydown，需在 iframe 内同步监听（capture） */
function handleManualNavKeydown(
  e: KeyboardEvent,
  goNext: () => void,
  goPrev: () => void,
  opts?: { stopPropagation?: boolean },
): void {
  if (MANUAL_NAV_NEXT_KEYS.has(e.key)) {
    e.preventDefault();
    if (opts?.stopPropagation) e.stopPropagation();
    goNext();
  } else if (MANUAL_NAV_PREV_KEYS.has(e.key)) {
    e.preventDefault();
    if (opts?.stopPropagation) e.stopPropagation();
    goPrev();
  }
}

export function SlidePlayer({
  deckTitle,
  slide,
  autoPlay,
  useTimelineClock = false,
  exportMode = false,
  manualMode = false,
  showNativeCaption = true,
  /** false 时在 iframe 内显示 deck 自带讲稿区 */
  hideDeckNarrationChrome = true,
}: {
  deckTitle: string;
  slide: PlaySlide;
  autoPlay?: boolean;
  useTimelineClock?: boolean;
  exportMode?: boolean;
  /** 手动放映模式：隐藏音频/时间轴控件，只保留大页翻页按钮 + 键盘导航 */
  manualMode?: boolean;
  showNativeCaption?: boolean;
  hideDeckNarrationChrome?: boolean;
}) {
  const steps = slide.steps;
  const pageMeta = slide.pageMeta ?? [];
  const [scope, setScope] = useState<"deck" | "page">("deck");
  const [selectedPageIndex, setSelectedPageIndex] = useState(0);
  /** 当前跟哪条轨：左侧详情与底部高亮随所选轨道切换（无「默认口播」） */
  const [detailFocus, setDetailFocus] = useState<"video" | "audio">("video");

  const selectedPage = pageMeta[selectedPageIndex];

  const range =
    scope === "page" && selectedPage
      ? {
          start: selectedPage.firstStepIndex,
          end: Math.max(
            selectedPage.firstStepIndex,
            selectedPage.lastStepIndex
          ),
        }
      : undefined;
  const rangeStart = range?.start ?? 0;
  const rangeEnd = range?.end ?? Math.max(0, steps.length - 1);

  const markExportPlaybackDone = useCallback(() => {
    if (!exportMode || typeof window === "undefined") return;
    const w = window as Window & {
      __SLIDEFORGE_EXPORT_DONE_AT_MS?: number;
    };
    w.__SLIDEFORGE_EXPORT_DONE_AT_MS = Math.round(performance.now());
  }, [exportMode]);

  const {
    audioRef,
    currentStep,
    globalMs,
    totalMs,
    isPlaying,
    play,
    pause,
    restart,
    goNext,
    goPrev,
    goTo,
    onTimeUpdate,
    onEnded,
    onPlay,
    onPause,
  } = useStepPlayer(steps, range, {
    useTimelineClock,
    highResAudioClock: exportMode,
    preloadNextClip: exportMode,
    onLastAudioClipEnded: exportMode ? markExportPlaybackDone : undefined,
  });

  /** 任一步有真实 mp3：句级对齐字幕 + 第二轨标题为「音频轨道」；无配音时仍展示口播占位轨 */
  const manifestHasAudio = useMemo(
    () =>
      steps.some(
        (s) => s.kind !== "pause" && Boolean((s.audio_url || "").trim()),
      ),
    [steps],
  );
  const showNarrationTimeline = steps.length > 0;

  useEffect(() => {
    if (!manifestHasAudio) {
      setDetailFocus("video");
    }
  }, [manifestHasAudio]);

  const [audioErr, setAudioErr] = useState<string | null>(null);
  /** 浏览器实测时长（秒），用于修正与 manifest duration_ms 不一致 */
  const [liveClipDurMs, setLiveClipDurMs] = useState(0);
  const [visualReady, setVisualReady] = useState(false);
  const deckIframeRef = useRef<HTMLIFrameElement | null>(null);
  const iframeReadyDelayTimerRef = useRef<number | null>(null);
  const captionLinesRef = useRef<HTMLDivElement | null>(null);
  const autoPlayedRef = useRef(false);
  const prevPlayingRef = useRef(false);
  const activePage = useMemo(
    () => pickActivePage(slide.pageMeta ?? [], currentStep),
    [slide.pageMeta, currentStep]
  );
  const domStage = Boolean(activePage.html?.trim());
  const activeSectionIndex = steps[currentStep]?.section_index ?? 0;

  useEffect(() => {
    setAudioErr(null);
    setLiveClipDurMs(0);
  }, [currentStep]);

  useEffect(() => {
    autoPlayedRef.current = false;
  }, [steps]);

  useEffect(() => {
    // DOM 舞台依赖 iframe 首次加载；非 DOM 舞台可直接视为 ready。
    setVisualReady(!domStage);
    if (iframeReadyDelayTimerRef.current != null) {
      window.clearTimeout(iframeReadyDelayTimerRef.current);
      iframeReadyDelayTimerRef.current = null;
    }
  }, [domStage, steps]);

  useEffect(() => {
    return () => {
      if (iframeReadyDelayTimerRef.current != null) {
        window.clearTimeout(iframeReadyDelayTimerRef.current);
        iframeReadyDelayTimerRef.current = null;
      }
    };
  }, []);

  /**
   * iframe onLoad 仅表示 HTML 文档加载完成，但 CSS/字体/布局/绘制可能尚未结束。
   * 此回调在 onLoad 后：等 iframe 内字体就绪 → 两帧 rAF（确保浏览器完成绘制）→
   * 额外等待 2s，再标记 visualReady，使 autoplay 在画面稳定后开始。
   */
  const handleIframeLoad = useCallback(
    (_e: SyntheticEvent<HTMLIFrameElement>) => {
      const iframe = deckIframeRef.current;
      if (!iframe) {
        setVisualReady(true);
        return;
      }
      const iframeWin = iframe.contentWindow;
      const iframeDoc = iframe.contentDocument;
      if (!iframeWin || !iframeDoc) {
        setVisualReady(true);
        return;
      }
      const afterPaint = () => {
        // 双 rAF：第一帧调度，第二帧确认合成器已绘制
        iframeWin.requestAnimationFrame(() => {
          iframeWin.requestAnimationFrame(() => {
            if (iframeReadyDelayTimerRef.current != null) {
              window.clearTimeout(iframeReadyDelayTimerRef.current);
            }
            iframeReadyDelayTimerRef.current = window.setTimeout(() => {
              setVisualReady(true);
              iframeReadyDelayTimerRef.current = null;
            }, 2000);
          });
        });
      };
      // 先等 iframe 内字体全部就绪
      if (iframeDoc.fonts?.ready) {
        iframeDoc.fonts.ready.then(afterPaint).catch(afterPaint);
      } else {
        afterPaint();
      }
    },
    []
  );

  const markExportStarted = useCallback(() => {
    if (!exportMode || typeof window === "undefined") return;
    const w = window as Window & {
      __SLIDEFORGE_EXPORT_STARTED_AT_MS?: number;
      __SLIDEFORGE_EXPORT_DONE_AT_MS?: number;
      __SLIDEFORGE_EXPORT_CLOCK_MODE?: "audio" | "timeline";
      __SLIDEFORGE_EXPORT_SYNC_LOGS?: unknown[];
    };
    if (typeof w.__SLIDEFORGE_EXPORT_STARTED_AT_MS !== "number") {
      w.__SLIDEFORGE_EXPORT_STARTED_AT_MS = Math.round(performance.now());
      // 每次导出启动时重置同步诊断日志，避免读到上一轮残留。
      w.__SLIDEFORGE_EXPORT_SYNC_LOGS = [];
    }
    w.__SLIDEFORGE_EXPORT_CLOCK_MODE = useTimelineClock ? "timeline" : "audio";
    delete w.__SLIDEFORGE_EXPORT_DONE_AT_MS;
  }, [exportMode, useTimelineClock]);

  useEffect(() => {
    if (!autoPlay || autoPlayedRef.current) return;
    if (!steps.length) return;
    if (domStage && !visualReady) return;
    autoPlayedRef.current = true;
    const firstStep = steps[rangeStart];
    const firstStepNeedsImmediateClock =
      !firstStep ||
      firstStep.kind === "pause" ||
      !firstStep.audio_url?.trim();
    if (firstStepNeedsImmediateClock) {
      // 首段无音频时不会触发 onPlaying，需在启动时立即打点。
      markExportStarted();
    }
    play();
  }, [
    autoPlay,
    domStage,
    markExportStarted,
    play,
    rangeStart,
    steps,
    steps.length,
    visualReady,
  ]);

  useEffect(() => {
    if (!exportMode || typeof window === "undefined") {
      prevPlayingRef.current = isPlaying;
      return;
    }
    const becameStoppedAtEnd =
      prevPlayingRef.current &&
      !isPlaying &&
      steps.length > 0 &&
      currentStep >= Math.max(0, steps.length - 1);
    if (becameStoppedAtEnd) {
      const w = window as Window & {
        __SLIDEFORGE_EXPORT_DONE_AT_MS?: number;
      };
      w.__SLIDEFORGE_EXPORT_DONE_AT_MS = Math.round(performance.now());
    }
    prevPlayingRef.current = isPlaying;
  }, [currentStep, exportMode, isPlaying, steps.length]);

  const sectionHtml = useMemo(() => {
    if (!domStage) return "";
    const html = activePage.html || "";
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const styles = Array.from(
        doc.querySelectorAll("style,link[rel=\"stylesheet\"]")
      )
        .map((el) => el.outerHTML)
        .join("\n");
      const sectionKey = `section-${activeSectionIndex}`;
      const section = doc.querySelector(`[data-key="${sectionKey}"]`);
      if (section) {
        return `${styles}${section.outerHTML}`;
      }
      return html;
    } catch {
      return html;
    }
  }, [domStage, activePage.html, activeSectionIndex]);

  const deckBaseHref = useMemo(() => {
    if (typeof window === "undefined") return "/";
    return `${window.location.origin}/`;
  }, []);

  useLayoutEffect(() => {
    if (!domStage) return;
    const iframe = deckIframeRef.current;
    if (!iframe) return;
    iframe.srcdoc = buildDeckIframeSrcDoc(sectionHtml, deckBaseHref, {
      hideNarrationChrome: hideDeckNarrationChrome,
    });
  }, [domStage, sectionHtml, deckBaseHref, hideDeckNarrationChrome]);

  const visible = useMemo(
    () => foldVisibleElements(slide.legacyActions, currentStep),
    [slide.legacyActions, currentStep]
  );

  const activePageIndex = useMemo(() => {
    if (!pageMeta.length) return 0;
    const idx = pageMeta.findIndex((p) => p.page_id === activePage.page_id);
    return idx >= 0 ? idx : 0;
  }, [activePage.page_id, pageMeta]);

  useEffect(() => {
    if (activePageIndex !== selectedPageIndex) {
      setSelectedPageIndex(activePageIndex);
    }
  }, [activePageIndex, selectedPageIndex]);

  // 手动模式：大页跳转
  const goNextPage = useCallback(() => {
    const next = pageMeta[activePageIndex + 1];
    if (next) goTo(next.firstStepIndex);
  }, [pageMeta, activePageIndex, goTo]);

  const goPrevPage = useCallback(() => {
    const prev = pageMeta[activePageIndex - 1];
    if (prev) goTo(prev.firstStepIndex);
  }, [pageMeta, activePageIndex, goTo]);

  /**
   * 滚动当前 iframe 页面；滚到顶/底时才真正翻页。
   * iframe 用 srcdoc + allow-same-origin，可直接访问 contentDocument。
   */
  const scrollOrNext = useCallback(() => {
    const iframe = deckIframeRef.current;
    if (domStage && iframe) {
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      if (doc && win) {
        const el = doc.scrollingElement ?? doc.documentElement;
        const h = el.clientHeight;
        // 对齐到下一个整屏边界（100vh snap）
        const nextTop = Math.ceil((el.scrollTop + 1) / h) * h;
        if (nextTop < el.scrollHeight - 8) {
          win.scrollTo({ top: nextTop, behavior: "smooth" });
          return;
        }
      }
    }
    goNextPage();
  }, [domStage, goNextPage]);

  const scrollOrPrev = useCallback(() => {
    const iframe = deckIframeRef.current;
    if (domStage && iframe) {
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      if (doc && win) {
        const el = doc.scrollingElement ?? doc.documentElement;
        const h = el.clientHeight;
        // 对齐到上一个整屏边界
        const prevTop = Math.floor((el.scrollTop - 1) / h) * h;
        if (prevTop > 0) {
          win.scrollTo({ top: prevTop, behavior: "smooth" });
          return;
        }
        if (el.scrollTop > 8) {
          win.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
      }
    }
    goPrevPage();
  }, [domStage, goPrevPage]);

  // 手动模式：始终在 window 挂键盘监听，不依赖焦点
  useEffect(() => {
    if (!manualMode) return;
    const onKeyWindow = (e: KeyboardEvent) => {
      handleManualNavKeydown(e, scrollOrNext, scrollOrPrev);
    };
    window.addEventListener("keydown", onKeyWindow);
    return () => window.removeEventListener("keydown", onKeyWindow);
  }, [manualMode, scrollOrNext, scrollOrPrev]);

  const scopeStartMs =
    scope === "page" && selectedPage
      ? steps[selectedPage.firstStepIndex]?.start_ms ?? 0
      : 0;
  const scopeEndMs =
    scope === "page" && selectedPage
      ? (steps[selectedPage.lastStepIndex]?.start_ms ?? 0) +
        (steps[selectedPage.lastStepIndex]?.duration_ms ?? 0)
      : totalMs;
  const scopeTotalMs = Math.max(0, scopeEndMs - scopeStartMs);
  const scopeElapsedMs = Math.max(0, globalMs - scopeStartMs);
  const scopeProgress =
    scopeTotalMs > 0 ? Math.min(100, (scopeElapsedMs / scopeTotalMs) * 100) : 0;

  const scopeStepIndices = useMemo(() => {
    const out: number[] = [];
    for (let i = rangeStart; i <= rangeEnd; i++) {
      if (steps[i]) out.push(i);
    }
    return out;
  }, [steps, rangeStart, rangeEnd]);

  const cur = steps[currentStep];
  const hasAudioClip =
    Boolean(cur?.audio_url?.trim()) && cur?.kind !== "pause";
  const clipElapsedMs = cur ? Math.max(0, globalMs - cur.start_ms) : 0;
  const clipTotalMs = cur?.duration_ms ?? 0;
  const clipTotalForUi =
    hasAudioClip && liveClipDurMs > 0 ? liveClipDurMs : clipTotalMs;
  const clipProgressPct =
    hasAudioClip && clipTotalForUi > 0
      ? Math.min(100, (clipElapsedMs / clipTotalForUi) * 100)
      : 0;

  const captionTitle = (cur?.subtitle || "").trim();
  const captionBody =
    cur?.kind === "pause" ? "" : (cur?.narration_text || "").trim();

  const sentenceCues = useMemo(() => {
    if (!cur || cur.kind === "pause") return null;
    return parseDoubaoSentenceCues(cur.narration_alignment);
  }, [cur]);

  const activeCueIndex =
    sentenceCues && sentenceCues.length > 0 && hasAudioClip
      ? activeSentenceIndex(sentenceCues, clipElapsedMs)
      : -1;

  useLayoutEffect(() => {
    const root = captionLinesRef.current;
    if (!root || activeCueIndex < 0) return;
    const el = root.children[activeCueIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [activeCueIndex, currentStep]);

  // 手动放映模式：简洁翻页 footer
  if (manualMode) {
    return (
      <SlideView
        deckTitle={deckTitle}
        footer={
          <div className="sf-controls sf-controls--manual">
            <div className="sf-manual-nav">
              <button
                type="button"
                className="sf-btn sf-btn-ghost sf-manual-btn"
                onClick={goPrevPage}
                disabled={activePageIndex <= 0}
                aria-label="上一页"
              >
                ← 上一页
              </button>
              <span className="sf-manual-page-label">
                {activePageIndex + 1} / {pageMeta.length}
                {pageMeta[activePageIndex]?.title
                  ? `  ${pageMeta[activePageIndex].title}`
                  : ""}
              </span>
              <button
                type="button"
                className="sf-btn sf-manual-btn"
                onClick={goNextPage}
                disabled={activePageIndex >= pageMeta.length - 1}
                aria-label="下一页"
              >
                下一页 →
              </button>
            </div>
            <p className="sf-manual-hint">
              方向键、空格、PgUp/PgDn、Enter 翻页；点击画面上任意处下一页
            </p>
          </div>
        }
      >
        <div className="sf-play-main sf-play-main--manual">
          <div className="sf-play-main-right">
            <div className="sf-play-main-body">
              {domStage ? (
                <div className="sf-manual-deck-shell">
                  <iframe
                    ref={deckIframeRef}
                    title={activePage.title || "Deck"}
                    className="sf-deck-iframe sf-html-stage"
                    aria-live="polite"
                    tabIndex={-1}
                    sandbox="allow-scripts allow-same-origin allow-forms"
                    onLoad={handleIframeLoad}
                    style={{ pointerEvents: "none" }}
                  />
                </div>
              ) : (
                <div
                  className="sf-manual-legacy-stage"
                  role="presentation"
                >
                  {Object.entries(visible).map(([k, action]) => (
                    <Fragment key={k}>
                      <ElementRenderer action={action as StepAction} />
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        {/* 悬浮翻页按钮，始终在最顶层 */}
        <div className="sf-manual-float-nav">
          <button
            type="button"
            className="sf-manual-float-btn"
            onClick={scrollOrPrev}
            disabled={activePageIndex <= 0}
            aria-label="上一页"
          >
            ‹
          </button>
          <span className="sf-manual-float-label">
            {activePageIndex + 1} / {pageMeta.length}
          </span>
          <button
            type="button"
            className="sf-manual-float-btn sf-manual-float-btn--next"
            onClick={scrollOrNext}
            disabled={activePageIndex >= pageMeta.length - 1}
            aria-label="下一页"
          >
            ›
          </button>
        </div>
      </SlideView>
    );
  }

  return (
    <SlideView
      deckTitle={deckTitle}
      footer={
        <div className="sf-controls">
          <div className="sf-scope-row">
            <label className="sf-scope-label" htmlFor="sf-play-scope">
              放映范围
            </label>
            <select
              id="sf-play-scope"
              className="sf-select"
              value={scope}
              onChange={(e) => {
                const next = e.currentTarget.value === "page" ? "page" : "deck";
                setScope(next);
                if (next === "page" && selectedPage) {
                  goTo(selectedPage.firstStepIndex);
                }
              }}
            >
              <option value="deck">整份讲稿</option>
              <option value="page">当前大页</option>
            </select>
            <label className="sf-scope-label" htmlFor="sf-play-page">
              大页
            </label>
            <select
              id="sf-play-page"
              className="sf-select"
              value={selectedPageIndex}
              onChange={(e) => {
                const idx = Number(e.currentTarget.value);
                if (!Number.isFinite(idx)) return;
                const nextPage = pageMeta[idx];
                if (!nextPage) return;
                setSelectedPageIndex(idx);
                goTo(nextPage.firstStepIndex);
              }}
            >
              {pageMeta.map((p, idx) => (
                <option key={p.page_id} value={idx}>
                  {p.title || `第 ${idx + 1} 页`}
                </option>
              ))}
            </select>
          </div>
          <audio
            ref={audioRef}
            controls
            preload="auto"
            onTimeUpdate={onTimeUpdate}
            onEnded={onEnded}
            onPlay={() => {
              setAudioErr(null);
              onPlay();
            }}
            onPlaying={() => {
              // 有音频首段以真正开始出声时刻作为导出零点，避免固定相位偏移。
              markExportStarted();
            }}
            onPause={onPause}
            onLoadedData={() => setAudioErr(null)}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              setLiveClipDurMs(
                Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : 0
              );
            }}
            onDurationChange={(e) => {
              const d = e.currentTarget.duration;
              setLiveClipDurMs(
                Number.isFinite(d) && d > 0 ? Math.round(d * 1000) : 0
              );
            }}
            onError={(e) => {
              const el = e.currentTarget;
              setAudioErr(mediaErrorLabel(el));
            }}
            style={{ width: "100%" }}
          />
          {audioErr ? (
            <p className="sf-audio-err" role="alert">
              {audioErr}
              {cur?.audio_url ? (
                <>
                  {" "}
                  <span className="sf-audio-url">{cur.audio_url}</span>
                </>
              ) : null}
            </p>
          ) : null}
          <div
            className={`sf-timeline-row${detailFocus === "video" ? " sf-timeline-row--focus-video" : ""}`}
          >
            <div className="sf-progress-label sf-progress-label--timeline">
              视频轨道
              <span className="sf-timeline-hint">点选片段 → 左侧跟画面/页结构</span>
            </div>
            <div className="sf-progress-row sf-progress-row--timeline">
              <div
                className="sf-timeline-track"
                role="group"
                aria-label="视频轨道分段"
              >
                <div
                  className="sf-timeline-underlay"
                  style={{ width: `${scopeProgress}%` }}
                  aria-hidden
                />
                {scopeTotalMs > 0
                  ? scopeStepIndices.map((i) => {
                      const st = steps[i];
                      if (!st) return null;
                      const left =
                        ((st.start_ms - scopeStartMs) / scopeTotalMs) * 100;
                      const width = Math.max(
                        0.45,
                        (st.duration_ms / scopeTotalMs) * 100
                      );
                      return (
                        <button
                          key={`v-${i}`}
                          type="button"
                          className={`sf-timeline-seg sf-timeline-seg--video${i === currentStep ? " sf-timeline-seg--current" : ""}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`视频段 ${i + 1} · ${st.subtitle || st.kind}`}
                          aria-current={i === currentStep ? "true" : undefined}
                          onClick={() => {
                            setDetailFocus("video");
                            goTo(i);
                          }}
                        />
                      );
                    })
                  : null}
              </div>
              <span className="sf-time">
                {scope === "page"
                  ? `${formatClock(scopeElapsedMs)} / ${formatClock(scopeTotalMs)}`
                  : `${formatClock(globalMs)} / ${formatClock(totalMs)}`}
              </span>
            </div>
          </div>
          {showNarrationTimeline ? (
            <div
              className={`sf-timeline-row${detailFocus === "audio" ? " sf-timeline-row--focus-audio" : ""}`}
            >
              <div className="sf-progress-label sf-progress-label--timeline">
                {manifestHasAudio ? "音频轨道" : "口播轨道"}
                <span className="sf-timeline-hint">
                  {manifestHasAudio
                    ? "点选片段 → 左侧跟口播"
                    : "无配音 · 占位时长 · 点选片段"}
                </span>
              </div>
              <div className="sf-progress-row sf-progress-row--timeline">
                <div
                  className="sf-timeline-track"
                  role="listbox"
                  aria-label={
                    manifestHasAudio ? "音频轨道分段" : "口播占位分段"
                  }
                >
                  <div
                    className="sf-timeline-underlay"
                    style={{ width: `${scopeProgress}%` }}
                    aria-hidden
                  />
                  {scopeTotalMs > 0
                    ? scopeStepIndices.map((i) => {
                        const st = steps[i];
                        if (!st) return null;
                        const left =
                          ((st.start_ms - scopeStartMs) / scopeTotalMs) * 100;
                        const width = Math.max(
                          0.45,
                          (st.duration_ms / scopeTotalMs) * 100
                        );
                        return (
                          <button
                            key={`a-${i}`}
                            type="button"
                            className={`sf-timeline-seg sf-timeline-seg--audio${i === currentStep ? " sf-timeline-seg--current" : ""}`}
                            style={{ left: `${left}%`, width: `${width}%` }}
                            title={`音频段 ${i + 1} · ${st.subtitle || st.kind}`}
                            aria-current={i === currentStep ? "true" : undefined}
                            onClick={() => {
                              setDetailFocus("audio");
                              goTo(i);
                            }}
                          />
                        );
                      })
                    : null}
                </div>
              </div>
            </div>
          ) : null}
          <div className="sf-progress-label">
            本段进度{cur?.subtitle ? ` · ${cur.subtitle}` : ""}
          </div>
          <div className="sf-progress-row">
            <div
              className="sf-progress-bar sf-progress-bar--clip"
              role="progressbar"
              aria-valuenow={Math.round(clipProgressPct)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="sf-progress-fill sf-progress-fill--clip"
                style={{ width: `${clipProgressPct}%` }}
              />
            </div>
            <span className="sf-time">
              {hasAudioClip
                ? `${formatClockAlways(clipElapsedMs)} / ${formatClockAlways(clipTotalForUi)}`
                : cur?.kind === "pause" || !hasAudioClip
                  ? `停顿 ${formatClock(clipTotalMs)}`
                  : "—"}
            </span>
          </div>
          <div className="sf-btn-row">
            <button
              type="button"
              className="sf-btn"
              onClick={() => {
                if (!hasAudioClip) {
                  // 当前段无音频时不会触发 onPlaying，需即时打点。
                  markExportStarted();
                }
                play();
              }}
            >
              播放
            </button>
            <button
              type="button"
              className="sf-btn sf-btn-ghost"
              onClick={() => pause()}
            >
              暂停
            </button>
            <button
              type="button"
              className="sf-btn sf-btn-ghost"
              onClick={() => restart()}
            >
              重播
            </button>
            <button
              type="button"
              className="sf-btn sf-btn-ghost"
              onClick={() => goPrev()}
              disabled={currentStep <= rangeStart}
            >
              上一段
            </button>
            <button
              type="button"
              className="sf-btn sf-btn-ghost"
              onClick={() => goNext()}
              disabled={currentStep >= rangeEnd}
            >
              下一段
            </button>
            <span className="sf-step-label">
              {scope === "page"
                ? `段 ${currentStep - rangeStart + 1} / ${rangeEnd - rangeStart + 1}`
                : `段 ${currentStep + 1} / ${steps.length}`}
              {isPlaying ? " · 播放中" : ""}
            </span>
          </div>
        </div>
      }
    >
      <div className="sf-play-main">
        {showNativeCaption && steps.length > 0 ? (
          <aside
            className={`sf-caption-bar sf-detail-panel${cur?.kind === "pause" ? " sf-caption-bar--muted" : ""}${detailFocus === "video" || !manifestHasAudio ? " sf-detail-panel--video" : " sf-detail-panel--audio"}`}
            aria-label={
              detailFocus === "video" || !manifestHasAudio
                ? "视频轨道详情"
                : "口播与字幕详情"
            }
          >
            {detailFocus === "video" || !manifestHasAudio ? (
              <>
                <div className="sf-caption-title">视频轨道</div>
                {cur?.kind === "pause" ? (
                  <div className="sf-caption-text">停顿（画面保持当前板块）</div>
                ) : (
                  <>
                    <div className="sf-detail-kv">
                      <span className="sf-detail-k">页</span>
                      <span className="sf-detail-v">
                        {activePage.title?.trim() ||
                          `页面 ${activePage.page_id || "—"}`}
                      </span>
                    </div>
                    <div className="sf-detail-kv">
                      <span className="sf-detail-k">板块</span>
                      <span className="sf-detail-v">
                        section-{cur?.section_index ?? 0}
                      </span>
                    </div>
                    {captionTitle ? (
                      <div className="sf-detail-kv">
                        <span className="sf-detail-k">段落</span>
                        <span className="sf-detail-v">{captionTitle}</span>
                      </div>
                    ) : null}
                    {(cur?.narration_brief || "").trim() ? (
                      <div className="sf-detail-brief-wrap">
                        <span className="sf-detail-k">提要</span>
                        <p className="sf-detail-brief">
                          {String(cur?.narration_brief).trim()}
                        </p>
                      </div>
                    ) : (
                      <p className="sf-caption-text sf-detail-muted">
                        （本段无结构化提要）
                      </p>
                    )}
                    {!manifestHasAudio &&
                    (cur?.narration_text || "").trim() ? (
                      <div className="sf-detail-brief-wrap sf-detail-narration-full">
                        <span className="sf-detail-k">口播全文</span>
                        <p className="sf-detail-brief">
                          {(cur?.narration_text || "").trim()}
                        </p>
                      </div>
                    ) : null}
                  </>
                )}
              </>
            ) : (
              <>
                {captionTitle ? (
                  <div className="sf-caption-title">{captionTitle}</div>
                ) : (
                  <div className="sf-caption-title">口播</div>
                )}
                {cur?.kind === "pause" ? (
                  <div className="sf-caption-text">停顿</div>
                ) : sentenceCues &&
                  sentenceCues.length > 0 &&
                  hasAudioClip ? (
                  <div className="sf-caption-lines" ref={captionLinesRef}>
                    {sentenceCues.map((s, i) => (
                      <p
                        key={`${currentStep}-${i}-${s.start_ms}`}
                        className={
                          i === activeCueIndex
                            ? "sf-caption-sentence sf-caption-sentence--active"
                            : "sf-caption-sentence"
                        }
                      >
                        {s.text}
                      </p>
                    ))}
                  </div>
                ) : (
                  <div className="sf-caption-text">
                    {captionBody || "（暂无口播文案）"}
                  </div>
                )}
              </>
            )}
          </aside>
        ) : null}
        <div className="sf-play-main-right">
          <div className="sf-play-main-body">
            {domStage ? (
              <iframe
                ref={deckIframeRef}
                title={activePage.title || "Deck"}
                className="sf-deck-iframe sf-html-stage"
                aria-live="polite"
                sandbox="allow-scripts allow-same-origin allow-forms"
                onLoad={handleIframeLoad}
              />
            ) : (
              Object.entries(visible).map(([k, action]) => (
                <Fragment key={k}>
                  <ElementRenderer action={action as StepAction} />
                </Fragment>
              ))
            )}
          </div>
        </div>
      </div>
    </SlideView>
  );
}
