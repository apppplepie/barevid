import { Fragment, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Play, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type ManifestVideo = { file: string; ratio?: string };
type VidsrcManifest = { videos?: ManifestVideo[] };

type WorkEntry = { id: number; ratio: string; video: string; title: string };

function cssAspectRatioFromLabel(ratio: string): string {
  const parts = ratio.split(':').map((s) => Number.parseFloat(s.trim()));
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    return `${parts[0]} / ${parts[1]}`;
  }
  return '16 / 9';
}

function titleFromFilename(file: string): string {
  const base = file.replace(/^.*[/\\]/, '');
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function ratioLabelFromPixels(w: number, h: number): string {
  const g = gcd(w, h);
  return `${Math.round(w / g)}:${Math.round(h / g)}`;
}

function WorkCard({ work, onOpen }: { work: WorkEntry; onOpen: () => void }) {
  const { t } = useTranslation();
  const [pixelAspect, setPixelAspect] = useState<{ w: number; h: number } | null>(null);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="relative w-full group overflow-hidden bg-white/5 border border-white/10 p-2 shrink-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-black rounded-sm"
      style={{
        aspectRatio: pixelAspect
          ? `${pixelAspect.w} / ${pixelAspect.h}`
          : cssAspectRatioFromLabel(work.ratio),
      }}
    >
      <div className="w-full h-full relative overflow-hidden">
        <video
          src={work.video}
          className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
          muted
          loop
          playsInline
          autoPlay
          preload="metadata"
          aria-label={work.title}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth > 0 && v.videoHeight > 0) {
              setPixelAspect({ w: v.videoWidth, h: v.videoHeight });
            }
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-5 pointer-events-none">
          <div className="flex justify-between items-end gap-2">
            <div className="min-w-0">
              <span className="font-black text-white tracking-wide text-base md:text-lg block mb-1 break-words">{work.title}</span>
              <span className="text-xs text-primary font-mono bg-primary/10 px-2 py-1 border border-primary/30">
                {(pixelAspect ? ratioLabelFromPixels(pixelAspect.w, pixelAspect.h) : work.ratio)} • {t('works.clipBadge')}
              </span>
            </div>
            <span className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white backdrop-blur-md border border-white/30 group-hover:bg-primary group-hover:border-primary transition-colors">
              <Play size={16} fill="currentColor" className="ml-1" />
            </span>
          </div>
        </div>
      </div>
      <div className="absolute top-0 left-0 w-3 h-3 border-t-2 border-l-2 border-primary/50" />
      <div className="absolute bottom-0 right-0 w-3 h-3 border-b-2 border-r-2 border-secondary/50" />
    </div>
  );
}

export function WorksGrid() {
  const { t } = useTranslation();
  const [lightbox, setLightbox] = useState<WorkEntry | null>(null);
  const [works, setWorks] = useState<WorkEntry[]>([]);
  const [galleryState, setGalleryState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/vidsrc/manifest.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as VidsrcManifest;
        if (cancelled) return;
        const list: WorkEntry[] = (data.videos ?? []).map((v, i) => ({
          id: i,
          video: `/vidsrc/${encodeURIComponent(v.file)}`,
          title: titleFromFilename(v.file),
          ratio: (v.ratio && v.ratio.trim()) || '16:9',
        }));
        setWorks(list);
        setGalleryState('ready');
      } catch {
        if (!cancelled) setGalleryState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightbox]);

  const mid = Math.ceil(works.length / 2);
  let col1Works = works.slice(0, mid);
  let col2Works = works.slice(mid);
  if (works.length === 1) {
    col2Works = col1Works;
  }

  return (
    <section id="works" className="h-screen w-full snap-start relative overflow-hidden flex items-center border-y border-white/5">
      {/* Vertical Side Text */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 rotate-90 origin-right text-xs font-mono text-white/20 tracking-[0.5em] uppercase whitespace-nowrap hidden lg:block z-0">
        {t('works.sideText')}
      </div>

      <div className="max-w-7xl mx-auto w-full h-full px-6 flex flex-col md:flex-row items-center gap-12 relative z-10 py-20">

        {/* Left: Scrolling Gallery (videos from public/vidsrc via manifest.json) */}
        <div className="w-full md:w-7/12 h-[60vh] md:h-[85vh] relative overflow-hidden flex gap-4 md:gap-6 mask-image-vertical">
          {galleryState === 'loading' && (
            <div className="flex-1 flex items-center justify-center font-mono text-sm text-white/40 px-4 text-center">
              {t('works.loadingShowcase')}
            </div>
          )}
          {galleryState === 'error' && (
            <div className="flex-1 flex items-center justify-center font-mono text-sm text-white/50 px-4 text-center leading-relaxed">
              {t('works.manifestError')}
            </div>
          )}
          {galleryState === 'ready' && works.length === 0 && (
            <div className="flex-1 flex items-center justify-center font-mono text-sm text-white/45 px-4 text-center leading-relaxed">
              {t('works.noVideos')}
            </div>
          )}
          {galleryState === 'ready' && works.length > 0 && (
            <>
              {/* Column 1 (Scrolls Up) */}
              <div className="flex-1 overflow-hidden min-h-0">
                <div className="flex flex-col animate-marquee-up hover:[animation-play-state:paused]">
                  <div className="flex flex-col gap-4 md:gap-6 pb-4 md:pb-6">
                    {col1Works.map((work) => (
                      <Fragment key={`col1-a-${work.id}-${work.video}`}>
                        <WorkCard work={work} onOpen={() => setLightbox(work)} />
                      </Fragment>
                    ))}
                  </div>
                  <div className="flex flex-col gap-4 md:gap-6 pb-4 md:pb-6">
                    {col1Works.map((work) => (
                      <Fragment key={`col1-b-${work.id}-${work.video}`}>
                        <WorkCard work={work} onOpen={() => setLightbox(work)} />
                      </Fragment>
                    ))}
                  </div>
                </div>
              </div>

              {/* Column 2 (Scrolls Down) */}
              <div className="flex-1 overflow-hidden min-h-0">
                <div className="flex flex-col animate-marquee-down hover:[animation-play-state:paused]">
                  <div className="flex flex-col gap-4 md:gap-6 pb-4 md:pb-6">
                    {col2Works.map((work) => (
                      <Fragment key={`col2-a-${work.id}-${work.video}`}>
                        <WorkCard work={work} onOpen={() => setLightbox(work)} />
                      </Fragment>
                    ))}
                  </div>
                  <div className="flex flex-col gap-4 md:gap-6 pb-4 md:pb-6">
                    {col2Works.map((work) => (
                      <Fragment key={`col2-b-${work.id}-${work.video}`}>
                        <WorkCard work={work} onOpen={() => setLightbox(work)} />
                      </Fragment>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right: Text & Typography */}
        <div className="w-full md:w-5/12 flex flex-col justify-center relative">
          <div className="absolute -right-10 -top-10 w-40 h-40 bg-primary/20 blur-[80px] rounded-full pointer-events-none" />

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="font-mono text-primary text-sm tracking-[0.3em] mb-6 flex items-center gap-3">
              <span className="w-12 h-[1px] bg-primary"></span>
              {t('works.archiveRecords')}
            </div>

            <h2 className="text-5xl md:text-7xl font-black uppercase tracking-tighter leading-[0.85] mb-8">
              <span className="text-transparent bg-clip-text bg-gradient-to-b from-white to-white/40">{t('works.title1')}</span><br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">{t('works.title2')}</span>
            </h2>

            <div className="text-white/60 font-mono text-base leading-relaxed mb-10 border-l-2 border-primary/30 pl-5 relative">
              <div className="absolute -left-[2px] top-0 w-[2px] h-8 bg-primary" />
              {t('works.subtitle')}
              <br /><br />
              <span className="text-white/40">{t('works.description')}</span>
            </div>

            {/* Workflow highlights */}
            <div className="flex flex-wrap gap-x-10 gap-y-6 font-mono text-sm text-white/40 border-t border-white/10 pt-6">
              <div className="min-w-[10rem] max-w-[14rem]">
                <div className="text-white/80 mb-1 tracking-widest">{t('works.stat2Label')}</div>
                <div className="text-base text-primary font-bold leading-snug">{t('works.stat2Value')}</div>
              </div>
              <div className="min-w-[10rem] max-w-[14rem]">
                <div className="text-white/80 mb-1 tracking-widest">{t('works.stat3Label')}</div>
                <div className="text-base text-secondary font-bold leading-snug">{t('works.stat3Value')}</div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/92 p-4 md:p-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="works-lightbox-title"
          onClick={() => setLightbox(null)}
        >
          <div
            className="relative w-full max-w-5xl max-h-[90vh] flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h3 id="works-lightbox-title" className="text-lg font-black tracking-wide text-white truncate pr-2">
                {lightbox.title}
              </h3>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="shrink-0 w-10 h-10 rounded-sm border border-white/20 flex items-center justify-center text-white hover:bg-white/10 hover:border-white/40 transition-colors"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="rounded-sm overflow-hidden border border-white/10 bg-black w-full max-h-[min(80vh,calc(100vw-2rem))] flex items-center justify-center min-h-[12rem]">
              <video
                key={lightbox.video}
                src={lightbox.video}
                className="max-h-[min(80vh,calc(100vw-2rem))] max-w-full w-auto h-auto object-contain"
                controls
                playsInline
                autoPlay
              />
            </div>
          </div>
        </div>
      )}

      <style>{`
        .mask-image-vertical {
          mask-image: linear-gradient(to bottom, transparent, black 10%, black 90%, transparent);
          -webkit-mask-image: linear-gradient(to bottom, transparent, black 10%, black 90%, transparent);
        }
        @keyframes marquee-up {
          0% { transform: translateY(0); }
          100% { transform: translateY(-50%); }
        }
        @keyframes marquee-down {
          0% { transform: translateY(-50%); }
          100% { transform: translateY(0); }
        }
        .animate-marquee-up {
          animation: marquee-up 25s linear infinite;
        }
        .animate-marquee-down {
          animation: marquee-down 30s linear infinite;
        }
      `}</style>
    </section>
  );
}
