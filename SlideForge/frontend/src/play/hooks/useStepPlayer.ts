import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlayStep } from "../types/slide";
import { totalTimelineMs } from "../utils/stepResolver";

function isPauseStep(s: PlayStep | undefined): boolean {
  if (!s) return false;
  if (s.kind === "pause") return true;
  return !s.audio_url?.trim();
}

/**
 * 每段一条独立音频；pause / 无音频 URL 时用定时推进，clip 索引即当前 step。
 */
type StepRange = {
  start: number;
  end: number;
};

type StepPlayerOptions = {
  useTimelineClock?: boolean;
  /** 导出录屏：每帧用 audio.currentTime 推进时间轴，避免 timeupdate 过稀导致画面慢于口播 */
  highResAudioClock?: boolean;
  /** 在当前段播放时提前预加载下一段音频，减少段间 canplay 等待造成的累计滞后 */
  preloadNextClip?: boolean;
  /** 最后一段口播 audio 自然结束（不含 pause 步） */
  onLastAudioClipEnded?: () => void;
};

type ExportSyncSample = {
  event: "audio_ended" | "pause_timeout";
  index: number;
  kind: string;
  expected_clip_ms: number;
  actual_clip_ms: number;
  clip_drift_ms: number;
  expected_global_ms: number;
  actual_global_ms: number;
  global_drift_ms: number;
  at_perf_ms: number;
};

type ExportSyncWindow = Window & {
  __SLIDEFORGE_EXPORT_SYNC_LOGS?: ExportSyncSample[];
};

function pushExportSyncSample(sample: ExportSyncSample) {
  if (typeof window === "undefined") return;
  const w = window as ExportSyncWindow;
  const list = w.__SLIDEFORGE_EXPORT_SYNC_LOGS ?? [];
  list.push(sample);
  if (list.length > 2000) {
    list.splice(0, list.length - 2000);
  }
  w.__SLIDEFORGE_EXPORT_SYNC_LOGS = list;
}

function logTransitionSample(
  event: ExportSyncSample["event"],
  index: number,
  step: PlayStep | undefined,
  actualClipMs: number
) {
  if (!step) return;
  const expectedClipMs = Math.max(0, step.duration_ms || 0);
  const normalizedActual = Math.max(0, actualClipMs);
  const expectedGlobal = step.start_ms + expectedClipMs;
  const actualGlobal = step.start_ms + normalizedActual;
  pushExportSyncSample({
    event,
    index,
    kind: step.kind || "",
    expected_clip_ms: Math.round(expectedClipMs),
    actual_clip_ms: Math.round(normalizedActual),
    clip_drift_ms: Math.round(normalizedActual - expectedClipMs),
    expected_global_ms: Math.round(expectedGlobal),
    actual_global_ms: Math.round(actualGlobal),
    global_drift_ms: Math.round(actualGlobal - expectedGlobal),
    at_perf_ms: Math.round(performance.now()),
  });
}

function clampRange(
  steps: PlayStep[],
  range?: StepRange
): StepRange {
  if (steps.length === 0) return { start: 0, end: 0 };
  const max = steps.length - 1;
  const start = Math.max(0, Math.min(range?.start ?? 0, max));
  const end = Math.max(start, Math.min(range?.end ?? max, max));
  return { start, end };
}

function resolveStepAtMs(steps: PlayStep[], ms: number, range: StepRange): number {
  if (steps.length === 0) return 0;
  for (let i = range.start; i <= range.end; i++) {
    const s = steps[i];
    if (!s) continue;
    const end = s.start_ms + Math.max(0, s.duration_ms || 0);
    if (ms < end) return i;
  }
  return range.end;
}

export function useStepPlayer(
  steps: PlayStep[],
  range?: StepRange,
  options?: StepPlayerOptions
) {
  const useTimelineClock = Boolean(options?.useTimelineClock);
  const highResAudioClock = Boolean(options?.highResAudioClock);
  const preloadNextClip = Boolean(options?.preloadNextClip);
  const onLastAudioClipEndedRef = useRef(options?.onLastAudioClipEnded);
  onLastAudioClipEndedRef.current = options?.onLastAudioClipEnded;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preloadAudioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const clockStartPerfRef = useRef(0);
  const clockStartGlobalMsRef = useRef(0);
  const lastCommitPerfRef = useRef(0);
  const [clipIndex, setClipIndex] = useState(0);
  const [globalMs, setGlobalMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  isPlayingRef.current = isPlaying;

  const totalMs = useMemo(() => totalTimelineMs(steps), [steps]);

  const safeRange = useMemo(() => clampRange(steps, range), [steps, range]);
  const safeIndex = Math.min(
    Math.max(clipIndex, safeRange.start),
    safeRange.end
  );
  const currentStep = steps.length === 0 ? 0 : safeIndex;

  const stepsRef = useRef(steps);
  stepsRef.current = steps;
  const safeIndexRef = useRef(safeIndex);
  safeIndexRef.current = safeIndex;

  useEffect(() => {
    if (steps.length === 0) return;
    if (clipIndex < safeRange.start || clipIndex > safeRange.end) {
      setClipIndex(safeRange.start);
      setGlobalMs(steps[safeRange.start]?.start_ms ?? 0);
    }
  }, [clipIndex, safeRange.start, safeRange.end, steps]);

  useEffect(() => {
    if (useTimelineClock) return;
    const el = audioRef.current;
    if (!el || steps.length === 0) return;
    const s = steps[safeIndex];
    if (!s) return;
    if (isPauseStep(s)) {
      el.pause();
      el.removeAttribute("src");
      el.load();
      return;
    }
    el.pause();
    el.src = s.audio_url;
    el.preload = "auto";
    el.load();
  }, [steps, safeIndex, useTimelineClock]);

  useEffect(() => {
    if (useTimelineClock || !preloadNextClip) return;
    if (steps.length === 0) return;
    if (safeIndex >= safeRange.end) return;

    let nextAudioUrl = "";
    for (let i = safeIndex + 1; i <= safeRange.end; i++) {
      const st = steps[i];
      if (!st || isPauseStep(st)) continue;
      const candidate = st.audio_url?.trim() || "";
      if (candidate) {
        nextAudioUrl = candidate;
      }
      break;
    }
    if (!nextAudioUrl) return;

    try {
      const p = new Audio();
      p.preload = "auto";
      p.src = nextAudioUrl;
      p.load();
      preloadAudioRef.current = p;
    } catch {
      preloadAudioRef.current = null;
    }

    return () => {
      const p = preloadAudioRef.current;
      if (!p) return;
      try {
        p.removeAttribute("src");
        p.load();
      } catch {
        // ignore preload cleanup failure
      }
      preloadAudioRef.current = null;
    };
  }, [preloadNextClip, safeIndex, safeRange.end, steps, useTimelineClock]);

  /** load() 异步完成前调用 play() 会失败；等 canplay 再播。 */
  useEffect(() => {
    if (useTimelineClock) return;
    const el = audioRef.current;
    if (!el || steps.length === 0) return;
    const s = steps[safeIndex];
    if (!s || isPauseStep(s)) return;

    if (!isPlaying) {
      el.pause();
      return;
    }

    const tryPlay = () => {
      const a = audioRef.current;
      if (!a || !isPlayingRef.current) return;
      void a.play().catch(() => {});
    };

    if (el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      tryPlay();
    } else {
      el.addEventListener("canplay", tryPlay, { once: true });
    }

    return () => {
      el.removeEventListener("canplay", tryPlay);
    };
  }, [isPlaying, safeIndex, steps, useTimelineClock]);

  /** 导出录屏：timeupdate 过稀时 globalMs 滞后于真实播放，画面/字幕会慢于口播 */
  useEffect(() => {
    if (useTimelineClock || !highResAudioClock) return;
    if (!isPlaying) return;

    let rafId = 0;
    const tick = () => {
      if (!isPlayingRef.current) return;
      const el = audioRef.current;
      const idx = safeIndexRef.current;
      const st = stepsRef.current[idx];
      if (el && st && !isPauseStep(st)) {
        setGlobalMs(st.start_ms + el.currentTime * 1000);
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [isPlaying, useTimelineClock, highResAudioClock, safeIndex]);

  useEffect(() => {
    if (!useTimelineClock) return;
    if (!isPlaying) return;
    if (steps.length === 0) return;

    const endStep = steps[safeRange.end];
    const endMs = (endStep?.start_ms ?? 0) + Math.max(0, endStep?.duration_ms ?? 0);
    clockStartPerfRef.current = performance.now();
    clockStartGlobalMsRef.current = globalMs;
    lastCommitPerfRef.current = 0;

    const tick = (now: number) => {
      if (!isPlayingRef.current) return;
      if (lastCommitPerfRef.current > 0 && now - lastCommitPerfRef.current < 33) {
        rafRef.current = window.requestAnimationFrame(tick);
        return;
      }
      lastCommitPerfRef.current = now;
      const elapsed = now - clockStartPerfRef.current;
      const nextGlobal = Math.min(endMs, clockStartGlobalMsRef.current + elapsed);
      const nextIndex = resolveStepAtMs(steps, nextGlobal, safeRange);
      setGlobalMs(nextGlobal);
      setClipIndex((prev) => (prev === nextIndex ? prev : nextIndex));
      if (nextGlobal >= endMs) {
        setIsPlaying(false);
        return;
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [globalMs, isPlaying, safeRange, steps, useTimelineClock]);

  useEffect(() => {
    if (useTimelineClock) return;
    if (!isPlaying) return;
    const s = steps[safeIndex];
    if (!s || !isPauseStep(s)) return;

    const dur = Math.max(50, s.duration_ms || 0);
    const t = window.setTimeout(() => {
      setClipIndex((i) => {
        if (highResAudioClock) {
          const endedStep = steps[i];
          logTransitionSample("pause_timeout", i, endedStep, dur);
        }
        if (i < safeRange.end) {
          const next = steps[i + 1];
          setGlobalMs((next?.start_ms ?? 0) + 0);
          return i + 1;
        }
        onLastAudioClipEndedRef.current?.();
        setIsPlaying(false);
        return i;
      });
    }, dur);
    return () => window.clearTimeout(t);
  }, [
    highResAudioClock,
    isPlaying,
    safeIndex,
    safeRange.end,
    steps,
    useTimelineClock,
  ]);

  const syncGlobalMs = useCallback(() => {
    const el = audioRef.current;
    if (!el || steps.length === 0) return;
    const s = steps[safeIndex];
    if (!s) return;
    if (isPauseStep(s)) return;
    setGlobalMs(s.start_ms + el.currentTime * 1000);
  }, [steps, safeIndex]);

  const onTimeUpdate = useCallback(() => {
    if (useTimelineClock) return;
    syncGlobalMs();
  }, [syncGlobalMs, useTimelineClock]);

  const onEnded = useCallback(() => {
    if (useTimelineClock) return;
    setClipIndex((i) => {
      if (highResAudioClock) {
        const endedStep = steps[i];
        const actualClipMs = (audioRef.current?.currentTime ?? 0) * 1000;
        logTransitionSample("audio_ended", i, endedStep, actualClipMs);
      }
      if (i < safeRange.end) {
        const next = steps[i + 1];
        setGlobalMs(next?.start_ms ?? 0);
        // 自然结束时先触发 pause，onPause 曾把 isPlaying 置 false；这里恢复以便下一段自动播放
        setIsPlaying(true);
        return i + 1;
      }
      onLastAudioClipEndedRef.current?.();
      setIsPlaying(false);
      return i;
    });
  }, [highResAudioClock, safeRange.end, steps, useTimelineClock]);

  const play = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    if (!useTimelineClock) {
      audioRef.current?.pause();
    }
    setIsPlaying(false);
  }, [useTimelineClock]);

  const restart = useCallback(() => {
    setIsPlaying(false);
    setClipIndex(safeRange.start);
    const el = audioRef.current;
    if (el && !useTimelineClock) {
      el.pause();
      el.currentTime = 0;
    }
    setGlobalMs(steps[safeRange.start]?.start_ms ?? 0);
  }, [safeRange.start, steps, useTimelineClock]);

  const goNext = useCallback(() => {
    setClipIndex((i) => {
      if (i >= safeRange.end) return i;
      const n = steps[i + 1];
      setGlobalMs(n?.start_ms ?? 0);
      return i + 1;
    });
  }, [safeRange.end, steps]);

  const goPrev = useCallback(() => {
    setClipIndex((i) => {
      if (i <= safeRange.start) return i;
      const n = steps[i - 1];
      setGlobalMs(n?.start_ms ?? 0);
      return i - 1;
    });
  }, [safeRange.start, steps]);

  const goTo = useCallback(
    (index: number) => {
      if (steps.length === 0) return;
      const clamped = Math.min(
        Math.max(index, safeRange.start),
        safeRange.end
      );
      setClipIndex(clamped);
      setGlobalMs(steps[clamped]?.start_ms ?? 0);
    },
    [safeRange.end, safeRange.start, steps]
  );

  useEffect(() => {
    const s = steps[safeIndex];
    if (!s || !isPauseStep(s)) return;
    if (isPlaying) {
      setGlobalMs(s.start_ms);
    }
  }, [safeIndex, steps, isPlaying]);

  return {
    audioRef,
    clipIndex: safeIndex,
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
    onPlay: () => setIsPlaying(true),
    onPause: () => {
      const el = audioRef.current;
      if (el?.ended) return;
      setIsPlaying(false);
    },
  };
}
