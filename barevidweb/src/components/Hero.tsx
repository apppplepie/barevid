import { motion } from 'motion/react';
import { TerminalSimulator } from './TerminalSimulator';
import { Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BAREVID_APP_URL, BAREVID_REPO_URL } from '../externalLinks';

const HERO_VIDEO_SRC = '/vidsrc/Hero.mp4';

export function Hero() {
  const { t } = useTranslation();

  return (
    <section id="hero" className="h-screen w-full snap-start pt-16 px-6 flex items-center relative overflow-hidden">
      <div className="max-w-7xl mx-auto w-full grid lg:grid-cols-2 gap-12 items-center">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex flex-col gap-6"
        >
          <div className="inline-block px-3 py-1 border border-white/10 bg-white/5 text-white/70 text-sm font-mono w-fit rounded-sm uppercase tracking-widest">
            {t('hero.badge')}
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold leading-tight">
            <span className="glitch-text block" data-text={t('hero.title1')}>{t('hero.title1')}</span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">
              {t('hero.title2')}
            </span>
          </h1>
          
          <p className="text-xl text-muted max-w-lg leading-relaxed whitespace-pre-line">
            {t('hero.description')}
          </p>
          
          <div className="flex flex-wrap items-center gap-4 mt-4">
            <a
              href={BAREVID_APP_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 bg-white text-black font-bold uppercase tracking-wider hover:bg-white/90 transition-colors rounded-sm shadow-[0_0_20px_rgba(255,255,255,0.15)]"
            >
              <Play size={18} fill="currentColor" />
              {t('hero.initSequence')}
            </a>
            <a
              href={BAREVID_REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="px-6 py-3 border border-muted text-muted hover:text-white hover:border-white transition-colors font-mono text-base uppercase tracking-wider rounded-sm"
            >
              {t('hero.viewDocs')}
            </a>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="relative w-full max-w-2xl mx-auto mt-12 lg:mt-0 lg:mx-0 lg:max-w-none lg:justify-self-end min-h-0"
        >
          <div className="absolute -inset-1 bg-gradient-to-r from-primary to-secondary blur-xl opacity-20 rounded-lg pointer-events-none" />
          <TerminalSimulator videoSrc={HERO_VIDEO_SRC} />
        </motion.div>
      </div>
    </section>
  );
}
