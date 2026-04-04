import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Clock, LayoutTemplate, Loader2, Lock } from 'lucide-react';
import { PageData } from '../types';
import { buildDeckIframeSrcDoc } from '../utils/deckIframeDoc';
import type { WorkflowStep } from './WorkflowProgressBar';

/** 大页尚无 HTML、deck 为 idle：区分「等流水线生成」与「文本/母版上游未就绪」 */
export type DeckPageIdleOverlay = {
  kind: 'queued' | 'blocked';
  subtitle: string;
  upstreamBusy?: boolean;
};

export function computeDeckPageIdleOverlay(
  steps: WorkflowStep[] | undefined,
): DeckPageIdleOverlay {
  const defaultQueued: DeckPageIdleOverlay = {
    kind: 'queued',
    subtitle: '演示页尚未生成，请等待流水线处理该大页。',
  };
  if (!steps?.length) return defaultQueued;

  const text = steps.find((s) => s.id === 'text');
  const master = steps.find((s) => s.id === 'deck_master');

  if (text?.state === 'error') {
    return {
      kind: 'blocked',
      subtitle:
        '「文本结构化」失败，请先在顶栏该步骤上重试，再生成大页演示。',
    };
  }
  if (text?.state !== 'success') {
    if (text?.state === 'running') {
      return {
        kind: 'blocked',
        subtitle: '文案结构生成中，请先完成「文本结构化」。',
        upstreamBusy: true,
      };
    }
    return {
      kind: 'blocked',
      subtitle: '请先完成「文本结构化」后，大页演示才可生成。',
    };
  }

  if (master) {
    if (master.state === 'error') {
      return {
        kind: 'blocked',
        subtitle:
          '「演示母版」失败，请先在顶栏该步骤上重试，再生成大页演示。',
      };
    }
    if (master.state !== 'success') {
      if (master.state === 'running') {
        return {
          kind: 'blocked',
          subtitle: '演示母版生成中，完成后即可生成场景页。',
          upstreamBusy: true,
        };
      }
      return {
        kind: 'blocked',
        subtitle: '请先完成「演示母版」后，大页演示才可生成。',
      };
    }
  }

  return defaultQueued;
}

function DeckPageStatePlaceholder({
  page,
  variant,
  subtitle,
  blockedBusy = false,
}: {
  page: PageData;
  variant: 'loading' | 'waiting' | 'blocked' | 'error';
  subtitle: string;
  /** variant=blocked 且上游步骤正在进行中（如母版生成中） */
  blockedBusy?: boolean;
}) {
  return (
    <div className="sf-deck-state-placeholder flex min-h-0 min-w-0 h-full w-full flex-col items-center justify-center gap-4 bg-gradient-to-br from-zinc-950 to-zinc-900 p-6 text-center text-zinc-100 sf-text-primary">
      <div
        className={`flex h-16 w-16 items-center justify-center rounded-2xl border ${
          variant === 'error'
            ? 'border-red-500/30 bg-red-500/10'
            : variant === 'waiting'
              ? 'border-cyan-500/35 bg-cyan-950/40'
              : 'border-zinc-700/80 bg-zinc-900/80'
        }`}
      >
        {variant === 'error' ? (
          <AlertTriangle className="h-8 w-8 text-red-400" aria-hidden />
        ) : variant === 'waiting' ? (
          <Clock
            className="h-8 w-8 text-cyan-200/95"
            strokeWidth={2}
            aria-hidden
          />
        ) : variant === 'blocked' ? (
          blockedBusy ? (
            <Loader2 className="h-8 w-8 animate-spin text-zinc-400" aria-hidden />
          ) : (
            <Lock className="h-8 w-8 text-zinc-500" strokeWidth={2} aria-hidden />
          )
        ) : (
          <Loader2 className="h-8 w-8 animate-spin text-sky-400" aria-hidden />
        )}
      </div>
      <div className="max-w-md space-y-2">
        <div className="flex items-center justify-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
          <LayoutTemplate className="h-3.5 w-3.5" aria-hidden />
          演示页
        </div>
        <h2 className="text-lg font-semibold text-zinc-100 sm:text-xl">{page.title}</h2>
        <p className="text-sm text-zinc-400">{subtitle}</p>
        {variant === 'error' && page.deckError ? (
          <p className="sf-deck-state-error-detail rounded-lg border border-red-500/20 bg-red-950/30 px-3 py-2 text-left text-xs leading-relaxed text-red-100/90">
            {page.deckError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** 与 backend services.deck._PAGE_SIZE_META 一致 */
const BASE_SIZES: Record<string, { w: number; h: number }> = {
  '16:9': { w: 1920, h: 1080 },
  '4:3': { w: 1024, h: 768 },
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
};

function resolveBaseSize(screenSize?: string) {
  if (!screenSize) return BASE_SIZES['16:9'];
  return BASE_SIZES[screenSize] || BASE_SIZES['16:9'];
}

export function PageRenderer({
  page,
  screenSize,
  /** 与 frontend 放映模式一致：按 `data-key="section-N"` 切换页内板块 */
  sectionIndex = 0,
  /** 缩放后画布在屏幕上的像素尺寸（与 iframe 视觉区域一致），供字幕等叠层对齐 */
  onDeckViewportPxChange,
  /** 与顶栏步骤对齐：idle 大页是「等生成」还是「文本/母版未就绪」 */
  deckPageIdleOverlay,
}: {
  page: PageData;
  screenSize?: string;
  sectionIndex?: number;
  onDeckViewportPxChange?: (size: { width: number; height: number } | null) => void;
  deckPageIdleOverlay?: DeckPageIdleOverlay | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const deckIframeRef = useRef<HTMLIFrameElement | null>(null);
  const viewportCbRef = useRef(onDeckViewportPxChange);
  viewportCbRef.current = onDeckViewportPxChange;
  const [scale, setScale] = useState(1);
  const base = resolveBaseSize(screenSize);
  const domStage = Boolean(page.html?.trim());

  useEffect(() => {
    if (!page.html?.trim()) {
      viewportCbRef.current?.(null);
    }
  }, [page.html]);

  useLayoutEffect(() => {
    if (!domStage) return;
    const host = hostRef.current;
    if (!host) return;
    const updateScale = () => {
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const next = Math.min(rect.width / base.w, rect.height / base.h);
      const s = Number.isFinite(next) && next > 0 ? next : 1;
      setScale(s);
      viewportCbRef.current?.({
        width: base.w * s,
        height: base.h * s,
      });
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(host);
    return () => observer.disconnect();
  }, [domStage, base.w, base.h]);

  const sectionHtml = useMemo(() => {
    if (!domStage) return '';
    const html = page.html || '';
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const styles = Array.from(
        doc.querySelectorAll('style,link[rel="stylesheet"]'),
      )
        .map((el) => el.outerHTML)
        .join('\n');
      const sectionKey = `section-${sectionIndex}`;
      const section = doc.querySelector(`[data-key="${sectionKey}"]`);
      if (section) {
        return `${styles}${section.outerHTML}`;
      }
      return html;
    } catch {
      return html;
    }
  }, [domStage, page.html, sectionIndex]);

  const deckBaseHref = useMemo(() => {
    if (typeof window === 'undefined') return '/';
    return `${window.location.origin}/`;
  }, []);

  useLayoutEffect(() => {
    if (!domStage) return;
    const iframe = deckIframeRef.current;
    if (!iframe) return;
    iframe.srcdoc = buildDeckIframeSrcDoc(sectionHtml, deckBaseHref, {
      hideNarrationChrome: false,
    });
  }, [domStage, sectionHtml, deckBaseHref]);

  if (page.html?.trim()) {
    return (
      <div
        ref={hostRef}
        className="relative h-full w-full overflow-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        <div
          className="absolute left-1/2 top-1/2"
          style={{
            width: `${base.w}px`,
            height: `${base.h}px`,
            transform: `translate(-50%, -50%) scale(${scale})`,
            transformOrigin: 'center center',
          }}
        >
          <iframe
            ref={deckIframeRef}
            title={page.title}
            className="sf-neoncast-deck-iframe h-full w-full border-0 bg-transparent"
            aria-live="polite"
            sandbox="allow-scripts allow-same-origin allow-forms"
          />
        </div>
      </div>
    );
  }

  if (page.kind === 'signals') {
    return <SignalsPage page={page} />;
  }
  if (page.kind === 'ops') {
    return <OpsPage page={page} />;
  }
  if (page.deckStatus != null) {
    if (page.deckStatus === 'failed') {
      return (
        <DeckPageStatePlaceholder
          page={page}
          variant="error"
          subtitle="该页演示生成失败，可在侧栏或工作流中重试。"
        />
      );
    }
    if (page.deckStatus === 'generating') {
      return (
        <DeckPageStatePlaceholder
          page={page}
          variant="loading"
          subtitle="正在生成该页演示画面…"
        />
      );
    }
    const overlay =
      deckPageIdleOverlay ?? computeDeckPageIdleOverlay(undefined);
    if (overlay.kind === 'blocked') {
      return (
        <DeckPageStatePlaceholder
          page={page}
          variant="blocked"
          blockedBusy={overlay.upstreamBusy}
          subtitle={overlay.subtitle}
        />
      );
    }
    return (
      <DeckPageStatePlaceholder
        page={page}
        variant="waiting"
        subtitle={overlay.subtitle}
      />
    );
  }
  return <OverviewPage page={page} />;
}

function OverviewPage({ page }: { page: PageData }) {
  return (
    <div className="sf-deck-faux-page flex min-h-0 min-w-0 h-full w-full max-w-full flex-col gap-6 overflow-x-hidden overflow-y-auto overscroll-contain bg-gradient-to-br from-zinc-950 to-zinc-900 p-6 text-zinc-100 [-ms-overflow-style:none] [scrollbar-width:none] sm:p-10 [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar]:w-0">
      <header className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
            Overview
          </p>
          <h2 className="truncate text-2xl font-semibold sm:text-3xl">{page.title}</h2>
          {page.subtitle ? (
            <p className="text-sm text-zinc-400 mt-2 max-w-xl">
              {page.subtitle}
            </p>
          ) : null}
        </div>
        <div className="sf-chip-neutral shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 font-mono text-[10px] sm:px-4 sm:py-2 sm:text-xs">
          自动同步
        </div>
      </header>

      <section className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
        {(page.metrics || []).map((metric) => (
          <div
            key={metric.label}
            className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
          >
            <p className="text-xs text-zinc-500 uppercase tracking-wider">
              {metric.label}
            </p>
            <p className="text-2xl font-semibold mt-2">{metric.value}</p>
            {metric.delta ? (
              <p className="text-xs text-zinc-400 mt-1">{metric.delta}</p>
            ) : null}
          </div>
        ))}
      </section>

      <section className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-6">
        <h3 className="text-sm font-semibold text-zinc-200 mb-3">
          实时笔记
        </h3>
        <ul className="text-sm text-zinc-400 space-y-2">
          {(page.bullets || []).map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-cyan-400" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function SignalsPage({ page }: { page: PageData }) {
  return (
    <div className="sf-deck-faux-page flex min-h-0 min-w-0 h-full w-full max-w-full flex-col gap-6 overflow-x-hidden overflow-y-auto overscroll-contain bg-gradient-to-br from-zinc-950 to-zinc-900 p-6 text-zinc-100 [-ms-overflow-style:none] [scrollbar-width:none] sm:p-10 [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar]:w-0">
      <header className="min-w-0">
        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
          信号
        </p>
        <h2 className="truncate text-2xl font-semibold sm:text-3xl">{page.title}</h2>
        {page.subtitle ? (
          <p className="text-sm text-zinc-400 mt-2 max-w-xl">
            {page.subtitle}
          </p>
        ) : null}
      </header>

      <section className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
        {(page.metrics || []).map((metric) => (
          <div
            key={metric.label}
            className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
          >
            <p className="text-xs text-zinc-500 uppercase tracking-wider">
              {metric.label}
            </p>
            <p className="text-2xl font-semibold mt-2">{metric.value}</p>
            {metric.delta ? (
              <p className="text-xs text-purple-300 mt-1">{metric.delta}</p>
            ) : null}
          </div>
        ))}
      </section>

      <section className="grid min-w-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[2fr,1fr]">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
          <h3 className="text-sm font-semibold text-zinc-200 mb-4">
            热度曲线
          </h3>
          <div className="flex items-end gap-2 h-40">
            {(page.chart || []).map((value, idx) => (
              <div
                key={`${value}-${idx}`}
                className="sf-signals-chart-bar flex-1 rounded-full bg-gradient-to-t from-fuchsia-500/30 to-purple-400/80"
                style={{ height: `${Math.max(10, value)}%` }}
              />
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
          <h3 className="text-sm font-semibold text-zinc-200 mb-3">
            洞察
          </h3>
          <ul className="text-sm text-zinc-400 space-y-2">
            {(page.bullets || []).map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-purple-400" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function OpsPage({ page }: { page: PageData }) {
  return (
    <div className="sf-deck-faux-page flex min-h-0 min-w-0 h-full w-full max-w-full flex-col gap-6 overflow-x-hidden overflow-y-auto overscroll-contain bg-gradient-to-br from-zinc-950 to-zinc-900 p-6 text-zinc-100 [-ms-overflow-style:none] [scrollbar-width:none] sm:p-10 [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar]:w-0">
      <header className="min-w-0">
        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500">
          发布运维
        </p>
        <h2 className="truncate text-2xl font-semibold sm:text-3xl">{page.title}</h2>
        {page.subtitle ? (
          <p className="text-sm text-zinc-400 mt-2 max-w-xl">
            {page.subtitle}
          </p>
        ) : null}
      </header>

      <section className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
        {(page.metrics || []).map((metric) => (
          <div
            key={metric.label}
            className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4"
          >
            <p className="text-xs text-zinc-500 uppercase tracking-wider">
              {metric.label}
            </p>
            <p className="text-2xl font-semibold mt-2">{metric.value}</p>
            {metric.delta ? (
              <p className="text-xs text-emerald-300 mt-1">{metric.delta}</p>
            ) : null}
          </div>
        ))}
      </section>

      <section className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4 sm:p-6">
        <h3 className="text-sm font-semibold text-zinc-200 mb-3">
          检查清单
        </h3>
        <ul className="text-sm text-zinc-400 space-y-2">
          {(page.bullets || []).map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
