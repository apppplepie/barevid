import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PlayStep } from '../data/playManifest';

function isPauseStep(s: PlayStep | undefined): boolean {
  if (!s) return false;
  if (s.kind === 'pause') return true;
  return !s.audio_url?.trim();
}

type StepRange = {
  start: number;
  end: number;
};

function clampRange(steps: PlayStep[], range?: StepRange): StepRange {
  if (steps.length === 0) return { start: 0, end: 0 };
  const max = steps.length - 1;
  const start = Math.max(0, Math.min(range?.start ?? 0, max));
  const end = Math.max(start, Math.min(range?.end ?? max, max));
  return { start, end };
}

function totalTimelineMs(steps: PlayStep[]): number {
  if (steps.length === 0) return 0;
  const last = steps[steps.length - 1];
  return last.start_ms + Math.max(0, last.duration_ms);
}

export function useStepPlayer(steps: PlayStep[], range?: StepRange) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
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
    const el = audioRef.current;
    if (!el || steps.length === 0) return;
    const s = steps[safeIndex];
    if (!s) return;
    if (isPauseStep(s)) {
      el.pause();
      el.removeAttribute('src');
      el.load();
      return;
    }
    el.pause();
    el.src = s.audio_url;
    el.preload = 'auto';
    el.load();
  }, [steps, safeIndex]);

  useEffect(() => {
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
      el.addEventListener('canplay', tryPlay, { once: true });
    }

    return () => {
      el.removeEventListener('canplay', tryPlay);
    };
  }, [isPlaying, safeIndex, steps]);

  useEffect(() => {
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
  }, [isPlaying, safeIndex, safeRange.end, steps]);

  const syncGlobalMs = useCallback(() => {
    const el = audioRef.current;
    if (!el || steps.length === 0) return;
    const s = steps[safeIndex];
    if (!s) return;
    if (isPauseStep(s)) return;
    setGlobalMs(s.start_ms + el.currentTime * 1000);
  }, [steps, safeIndex]);

  const onTimeUpdate = useCallback(() => {
    syncGlobalMs();
  }, [syncGlobalMs]);

  const onEnded = useCallback(() => {
    setClipIndex((i) => {
      if (i < safeRange.end) {
        const next = steps[i + 1];
        setGlobalMs(next?.start_ms ?? 0);
        setIsPlaying(true);
        return i + 1;
      }
      setIsPlaying(false);
      return i;
    });
  }, [safeRange.end, steps]);

  const play = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const restart = useCallback(() => {
    setIsPlaying(false);
    setClipIndex(safeRange.start);
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    setGlobalMs(steps[safeRange.start]?.start_ms ?? 0);
  }, [safeRange.start, steps]);

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

  const seekToMs = useCallback(
    (targetMs: number) => {
      if (steps.length === 0) return;
      const clampedMs = Math.max(0, Math.min(targetMs, totalMs));
      let index = steps.length - 1;
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const end = s.start_ms + Math.max(0, s.duration_ms);
        if (clampedMs >= s.start_ms && clampedMs < end) {
          index = i;
          break;
        }
      }
      setClipIndex(index);
      setGlobalMs(clampedMs);
      const el = audioRef.current;
      const s = steps[index];
      if (el && s && !isPauseStep(s)) {
        const offsetMs = Math.max(0, clampedMs - s.start_ms);
        el.currentTime = offsetMs / 1000;
      }
    },
    [steps, totalMs]
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
    seekToMs,
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
