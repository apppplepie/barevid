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
};

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
  const audioRef = useRef<HTMLAudioElement | null>(null);
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
        if (i < safeRange.end) {
          const next = steps[i + 1];
          setGlobalMs((next?.start_ms ?? 0) + 0);
          return i + 1;
        }
        setIsPlaying(false);
        return i;
      });
    }, dur);
    return () => window.clearTimeout(t);
  }, [isPlaying, safeIndex, safeRange.end, steps, useTimelineClock]);

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
      if (i < safeRange.end) {
        const next = steps[i + 1];
        setGlobalMs(next?.start_ms ?? 0);
        // 自然结束时先触发 pause，onPause 曾把 isPlaying 置 false；这里恢复以便下一段自动播放
        setIsPlaying(true);
        return i + 1;
      }
      setIsPlaying(false);
      return i;
    });
  }, [safeRange.end, steps, useTimelineClock]);

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
