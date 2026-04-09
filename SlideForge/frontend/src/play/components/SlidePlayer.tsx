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


export function SlidePlayer({
  deckTitle,
  slide,
  autoPlay,
  useTimelineClock = false,
  exportMode = false,
  showNativeCaption = true,
  /** false 时在 iframe 内显示 deck 自带讲稿区 */
  hideDeckNarrationChrome = true,
}: {
  deckTitle: string;
  slide: PlaySlide;
  autoPlay?: boolean;
  useTimelineClock?: boolean;
  exportMode?: boolean;
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
    onLastAudioClipEnded: exportMode ? markExportPlaybackDone : undefined,
  });

  const [audioErr, setAudioErr] = useState<string | null>(null);
  /** 浏览器实测时长（秒），用于修正与 manifest duration_ms 不一致 */
  const [liveClipDurMs, setLiveClipDurMs] = useState(0);
  const [visualReady, setVisualReady] = useState(false);
  const deckIframeRef = useRef<HTMLIFrameElement | null>(null);
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
  }, [domStage, steps]);

  /**
   * iframe onLoad 仅表示 HTML 文档加载完成，但 CSS/字体/布局/绘制可能尚未结束。
   * 此回调在 onLoad 后：等 iframe 内字体就绪 → 两帧 rAF（确保浏览器完成绘制）→
   * 才标记 visualReady，使 autoplay 逻辑真正在画面渲染完毕后才开始播放音频。
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
            setVisualReady(true);
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
    };
    if (typeof w.__SLIDEFORGE_EXPORT_STARTED_AT_MS !== "number") {
      w.__SLIDEFORGE_EXPORT_STARTED_AT_MS = Math.round(performance.now());
    }
    delete w.__SLIDEFORGE_EXPORT_DONE_AT_MS;
  }, [exportMode]);

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
          <div
            className={`sf-timeline-row${detailFocus === "audio" ? " sf-timeline-row--focus-audio" : ""}`}
          >
            <div className="sf-progress-label sf-progress-label--timeline">
              音频轨道
              <span className="sf-timeline-hint">点选片段 → 左侧跟口播</span>
            </div>
            <div className="sf-progress-row sf-progress-row--timeline">
              <div
                className="sf-timeline-track"
                role="listbox"
                aria-label="音频轨道分段"
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
            className={`sf-caption-bar sf-detail-panel${cur?.kind === "pause" ? " sf-caption-bar--muted" : ""}${detailFocus === "video" ? " sf-detail-panel--video" : " sf-detail-panel--audio"}`}
            aria-label={
              detailFocus === "video" ? "视频轨道详情" : "口播与字幕详情"
            }
          >
            {detailFocus === "video" ? (
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
                ) : sentenceCues && sentenceCues.length > 0 ? (
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
