import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Clock, LayoutTemplate, Loader2 } from 'lucide-react';
import { PageData } from '../types';
import { buildDeckIframeSrcDoc } from '../utils/deckIframeDoc';

function DeckPageStatePlaceholder({
  page,
  variant,
  subtitle,
}: {
  page: PageData;
  variant: 'loading' | 'idle';
  subtitle: string;
}) {
  const busy = variant === 'loading';
  return (
    <div className="flex min-h-0 min-w-0 h-full w-full flex-col items-center justify-center gap-4 bg-gradient-to-br from-zinc-950 to-black light:from-slate-100 light:to-slate-50 p-6 text-center text-zinc-100 light:text-slate-900">
      <div
        className={`flex h-16 w-16 items-center justify-center rounded-2xl border ${
          busy
            ? 'border-zinc-700/80 light:border-slate-300 bg-zinc-900/80 light:bg-white'
            : 'border-amber-500/40 bg-amber-500/10 light:border-amber-400/50 light:bg-amber-50/90'
        }`}
      >
        {busy ? (
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" aria-hidden />
        ) : (
          <Clock
            className="h-8 w-8 text-amber-400 light:text-amber-700"
            strokeWidth={2}
            aria-hidden
          />
        )}
      </div>
      <div className="max-w-md space-y-2">
        <div className="flex items-center justify-center gap-2 text-xs uppercase tracking-[0.2em] text-sf-muted">
          <LayoutTemplate className="h-3.5 w-3.5" aria-hidden />
          演示页
        </div>
        <p
          className={`text-base font-semibold ${
            busy
              ? 'text-blue-200 light:text-blue-800'
              : 'text-amber-200 light:text-amber-900'
          }`}
        >
          {busy ? '进行中' : '待操作'}
        </p>
        <h2 className="text-lg font-semibold text-zinc-100 light:text-slate-900 sm:text-xl">{page.title}</h2>
        <p className="text-sm text-zinc-400 light:text-slate-600">{subtitle}</p>
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
  /** 与顶栏 workflow 一致：任一步 running 则预览无 HTML 时显示「进行中」，否则「待操作」 */
  workflowRunning = false,
}: {
  page: PageData;
  screenSize?: string;
  sectionIndex?: number;
  onDeckViewportPxChange?: (size: { width: number; height: number } | null) => void;
  workflowRunning?: boolean;
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

  return (
    <DeckPageStatePlaceholder
      page={page}
      variant={workflowRunning ? 'loading' : 'idle'}
      subtitle={
        workflowRunning
          ? '请稍候。'
          : '请在顶部制作进度条或「制作流程」中继续（手动流程需点击开始）。'
      }
    />
  );
}

function SignalsPage({ page }: { page: PageData }) {
  return (
    <div className="flex min-h-0 min-w-0 h-full w-full max-w-full flex-col gap-6 overflow-x-hidden overflow-y-auto overscroll-contain bg-gradient-to-br from-zinc-950 to-black light:from-slate-100 light:to-slate-50 p-6 text-zinc-100 light:text-slate-900 [-ms-overflow-style:none] [scrollbar-width:none] sm:p-10 [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar]:w-0">
      <header className="min-w-0">
        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500 light:text-slate-500">
          信号
        </p>
        <h2 className="truncate text-2xl font-semibold sm:text-3xl">{page.title}</h2>
        {page.subtitle ? (
          <p className="text-sm text-zinc-400 light:text-slate-600 mt-2 max-w-xl">
            {page.subtitle}
          </p>
        ) : null}
      </header>

      <section className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
        {(page.metrics || []).map((metric) => (
          <div
            key={metric.label}
            className="min-w-0 rounded-xl border border-zinc-800 light:border-slate-200 bg-zinc-900/50 light:bg-white/90 p-4 shadow-sm light:shadow-slate-200/50"
          >
            <p className="text-xs text-zinc-500 light:text-slate-500 uppercase tracking-wider">
              {metric.label}
            </p>
            <p className="text-2xl font-semibold mt-2">{metric.value}</p>
            {metric.delta ? (
              <p className="text-xs text-purple-300 light:text-purple-700 mt-1">{metric.delta}</p>
            ) : null}
          </div>
        ))}
      </section>

      <section className="grid min-w-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[2fr,1fr]">
        <div className="rounded-2xl border border-zinc-800 light:border-slate-200 bg-zinc-900/40 light:bg-slate-50/95 p-6">
          <h3 className="text-sm font-semibold text-zinc-200 light:text-slate-800 mb-4">
            热度曲线
          </h3>
          <div className="flex items-end gap-2 h-40">
            {(page.chart || []).map((value, idx) => (
              <div
                key={`${value}-${idx}`}
                className="flex-1 rounded-full bg-gradient-to-t from-fuchsia-500/30 to-purple-400/80"
                style={{ height: `${Math.max(10, value)}%` }}
              />
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-800 light:border-slate-200 bg-zinc-900/40 light:bg-slate-50/95 p-6">
          <h3 className="text-sm font-semibold text-zinc-200 light:text-slate-800 mb-3">
            洞察
          </h3>
          <ul className="text-sm text-zinc-400 light:text-slate-600 space-y-2">
            {(page.bullets || []).map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-purple-400 light:bg-purple-500" />
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
    <div className="flex min-h-0 min-w-0 h-full w-full max-w-full flex-col gap-6 overflow-x-hidden overflow-y-auto overscroll-contain bg-gradient-to-br from-zinc-950 to-black light:from-slate-100 light:to-slate-50 p-6 text-zinc-100 light:text-slate-900 [-ms-overflow-style:none] [scrollbar-width:none] sm:p-10 [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar]:w-0">
      <header className="min-w-0">
        <p className="text-xs uppercase tracking-[0.3em] text-zinc-500 light:text-slate-500">
          发布运维
        </p>
        <h2 className="truncate text-2xl font-semibold sm:text-3xl">{page.title}</h2>
        {page.subtitle ? (
          <p className="text-sm text-zinc-400 light:text-slate-600 mt-2 max-w-xl">
            {page.subtitle}
          </p>
        ) : null}
      </header>

      <section className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
        {(page.metrics || []).map((metric) => (
          <div
            key={metric.label}
            className="min-w-0 rounded-xl border border-zinc-800 light:border-slate-200 bg-zinc-900/50 light:bg-white/90 p-4 shadow-sm light:shadow-slate-200/50"
          >
            <p className="text-xs text-zinc-500 light:text-slate-500 uppercase tracking-wider">
              {metric.label}
            </p>
            <p className="text-2xl font-semibold mt-2">{metric.value}</p>
            {metric.delta ? (
              <p className="text-xs text-emerald-300 light:text-emerald-700 mt-1">{metric.delta}</p>
            ) : null}
          </div>
        ))}
      </section>

      <section className="min-w-0 flex-1 rounded-2xl border border-zinc-800 light:border-slate-200 bg-zinc-900/40 light:bg-slate-50/95 p-4 sm:p-6">
        <h3 className="text-sm font-semibold text-zinc-200 light:text-slate-800 mb-3">
          检查清单
        </h3>
        <ul className="text-sm text-zinc-400 light:text-slate-600 space-y-2">
          {(page.bullets || []).map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-400 light:bg-emerald-500" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
