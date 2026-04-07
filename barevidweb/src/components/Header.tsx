import { motion } from 'motion/react';
import { Github, Terminal, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LanguageSwitcher } from './LanguageSwitcher';

export function Header() {
  const { t } = useTranslation();

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#050505]/60 backdrop-blur-xl supports-[backdrop-filter]:bg-[#050505]/40">
      <div className="absolute bottom-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
      
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Left: Logo */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-3 text-xl font-black tracking-tighter group cursor-pointer"
        >
          <div className="w-8 h-8 bg-primary/10 flex items-center justify-center rounded border border-primary/30 group-hover:border-primary/80 group-hover:shadow-[0_0_15px_rgba(176,38,255,0.4)] transition-all duration-300">
            <Terminal className="text-primary w-4 h-4" />
          </div>
          <span className="text-white uppercase tracking-widest text-lg">
            Bare<span className="text-primary">Vid</span>
          </span>
        </motion.div>
        
        {/* Right: Actions */}
        <motion.div 
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-2 md:gap-4"
        >
          <LanguageSwitcher />
          
          <div className="h-4 w-px bg-white/10 mx-2 hidden sm:block"></div>

          <a 
            href="https://github.com" 
            target="_blank" 
            rel="noreferrer"
            className="flex items-center justify-center p-2 text-white/60 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10 rounded transition-all"
            title="GitHub"
          >
            <Github size={18} />
          </a>

          <a 
            href="https://blog.example.com" 
            target="_blank" 
            rel="noreferrer"
            className="flex items-center justify-center p-2 text-white/60 hover:text-white hover:bg-white/5 border border-transparent hover:border-white/10 rounded transition-all"
            title="Blog"
          >
            <Globe size={18} />
          </a>

          <button className="ml-2 px-6 py-2 bg-primary/10 border border-primary/50 text-white hover:bg-primary hover:border-primary transition-all rounded text-xs font-bold uppercase tracking-widest shadow-[0_0_15px_rgba(176,38,255,0.15)] hover:shadow-[0_0_25px_rgba(176,38,255,0.5)] relative overflow-hidden group">
            <span className="relative z-10">{t('hero.freeTrial')}</span>
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-[200%] transition-transform duration-700 ease-in-out" />
          </button>
        </motion.div>
      </div>
    </header>
  );
}
