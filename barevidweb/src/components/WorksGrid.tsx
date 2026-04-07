import { Fragment } from 'react';
import { motion } from 'motion/react';
import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type WorkEntry = { id: number; ratio: string; video: string; title: string };

function cssAspectRatioFromLabel(ratio: string): string {
  const parts = ratio.split(':').map((s) => Number.parseFloat(s.trim()));
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n) && n > 0)) {
    return `${parts[0]} / ${parts[1]}`;
  }
  return '4 / 5';
}

function WorkCard({ work }: { work: WorkEntry }) {
  return (
    <div
      className="relative w-full group overflow-hidden bg-white/5 border border-white/10 p-2 shrink-0"
      style={{ aspectRatio: cssAspectRatioFromLabel(work.ratio) }}
    >
      <div className="w-full h-full relative overflow-hidden">
        <video
          src={work.video}
          className="w-full h-full object-cover filter grayscale opacity-40 group-hover:grayscale-0 group-hover:opacity-100 transition-all duration-700 group-hover:scale-110"
          muted
          loop
          playsInline
          autoPlay
          preload="metadata"
          aria-label={work.title}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-5">
          <div className="flex justify-between items-end">
            <div>
              <span className="font-black text-white tracking-widest uppercase text-lg block mb-1">{work.title}</span>
              <span className="text-[10px] text-primary font-mono bg-primary/10 px-2 py-1 border border-primary/30">{work.ratio} • NEURAL_RENDER</span>
            </div>
            <button type="button" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white backdrop-blur-md border border-white/30 hover:bg-primary hover:border-primary transition-colors">
              <Play size={16} fill="currentColor" className="ml-1" />
            </button>
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

  const works: WorkEntry[] = [
    { id: 1, ratio: '9:16', video: '/vidsrc/1.mp4', title: t('works.videos.neonRain') },
    { id: 2, ratio: '16:9', video: '/vidsrc/2.mp4', title: t('works.videos.cyberCity') },
    { id: 3, ratio: '16:9', video: '/vidsrc/3.mp4', title: t('works.videos.alleyway') },
    { id: 4, ratio: '4:3', video: '/vidsrc/4.mp4', title: t('works.videos.hologram') },
    { id: 5, ratio: '16:9', video: '/vidsrc/5.mp4', title: t('works.videos.dataStream') },
    { id: 6, ratio: '1:1', video: '/vidsrc/6.mp4', title: t('works.videos.synthwave') },
  ];

  const col1Works = [works[0], works[1], works[2]];
  const col2Works = [works[3], works[4], works[5]];

  return (
    <section id="works" className="h-screen w-full snap-start snap-always relative overflow-hidden flex items-center border-y border-white/5">
      {/* Vertical Side Text */}
      <div className="absolute right-4 top-1/2 -translate-y-1/2 rotate-90 origin-right text-[10px] font-mono text-white/20 tracking-[0.5em] uppercase whitespace-nowrap hidden lg:block z-0">
        {t('works.sideText')}
      </div>

      <div className="max-w-7xl mx-auto w-full h-full px-6 flex flex-col md:flex-row items-center gap-12 relative z-10 py-20">
        
        {/* Left: Scrolling Gallery */}
        <div className="w-full md:w-7/12 h-[60vh] md:h-[85vh] relative overflow-hidden flex gap-4 md:gap-6 mask-image-vertical">
           {/* Column 1 (Scrolls Up) */}
           <div className="flex-1 overflow-hidden">
             <div className="flex flex-col animate-marquee-up hover:[animation-play-state:paused]">
                <div className="flex flex-col gap-4 md:gap-6 pb-4 md:pb-6">
                  {col1Works.map((work) => (
                    <Fragment key={`col1-a-${work.id}`}>
                      <WorkCard work={work} />
                    </Fragment>
                  ))}
                </div>
                <div className="flex flex-col gap-4 md:gap-6 pb-4 md:pb-6">
                  {col1Works.map((work) => (
                    <Fragment key={`col1-b-${work.id}`}>
                      <WorkCard work={work} />
                    </Fragment>
                  ))}
                </div>
             </div>
           </div>
           
           {/* Column 2 (Scrolls Down) */}
           <div className="flex-1 overflow-hidden">
             <div className="flex flex-col animate-marquee-down hover:[animation-play-state:paused]">
                <div className="flex flex-col gap-4 md:gap-6 pb-4 md:pb-6">
                  {col2Works.map((work) => (
                    <Fragment key={`col2-a-${work.id}`}>
                      <WorkCard work={work} />
                    </Fragment>
                  ))}
                </div>
                <div className="flex flex-col gap-4 md:gap-6 pb-4 md:pb-6">
                  {col2Works.map((work) => (
                    <Fragment key={`col2-b-${work.id}`}>
                      <WorkCard work={work} />
                    </Fragment>
                  ))}
                </div>
             </div>
           </div>
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
             <div className="font-mono text-primary text-xs tracking-[0.3em] mb-6 flex items-center gap-3">
               <span className="w-12 h-[1px] bg-primary"></span>
               {t('works.archiveRecords')}
             </div>
             
             <h2 className="text-5xl md:text-7xl font-black uppercase tracking-tighter leading-[0.85] mb-8">
               <span className="text-transparent bg-clip-text bg-gradient-to-b from-white to-white/40">{t('works.title1')}</span><br/>
               <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">{t('works.title2')}</span>
             </h2>
             
             <div className="text-white/60 font-mono text-sm leading-relaxed mb-10 border-l-2 border-primary/30 pl-5 relative">
               <div className="absolute -left-[2px] top-0 w-[2px] h-8 bg-primary" />
               {t('works.subtitle')}
               <br/><br/>
               <span className="text-white/40">{t('works.description')}</span>
             </div>
             
             {/* Decorative stats */}
             <div className="flex gap-10 font-mono text-xs text-white/40 border-t border-white/10 pt-6">
               <div>
                 <div className="text-white/80 mb-1 tracking-widest">{t('works.totalRendered')}</div>
                 <div className="text-lg text-white font-bold">89,412</div>
               </div>
               <div>
                 <div className="text-white/80 mb-1 tracking-widest">{t('works.avgGenTime')}</div>
                 <div className="text-lg text-primary font-bold">1.42s</div>
               </div>
               <div className="hidden sm:block">
                 <div className="text-white/80 mb-1 tracking-widest">{t('works.resolution')}</div>
                 <div className="text-lg text-secondary font-bold">4K_UHD</div>
               </div>
             </div>
           </motion.div>
        </div>
      </div>

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
