import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { Github, Terminal, Cpu, TrendingUp, Infinity as InfinityIcon } from 'lucide-react';

export function Pricing() {
  const { t } = useTranslation();

  return (
    <section id="pricing" className="h-screen w-full snap-start snap-always pt-16 px-6 relative flex flex-col justify-center">
      <div className="max-w-5xl mx-auto w-full">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="bg-surface border border-primary/30 rounded-lg overflow-hidden shadow-[0_0_30px_rgba(176,38,255,0.1)]"
        >
          <div className="grid md:grid-cols-2">
            <div className="p-8 md:p-12 border-b md:border-b-0 md:border-r border-primary/20 flex flex-col justify-center relative bg-black/20">
              {/* Decorative corner */}
              <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-primary/50"></div>
              
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-primary/10 border border-primary/30 text-primary text-[10px] font-mono tracking-widest uppercase w-fit mb-6">
                <span className="w-1.5 h-1.5 bg-primary animate-pulse"></span>
                {t('pricing.openSourceProtocol')}
              </div>

              <h3 className="text-3xl font-black mb-4 uppercase tracking-tighter text-white">
                {t('pricing.zeroMarkup')}<br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">{t('pricing.rawCompute')}</span>
              </h3>
              
              <p className="text-white/50 text-sm mb-8 font-mono leading-relaxed">
                {t('pricing.notCommercial')}
              </p>
              
              <div className="space-y-3 mb-8 font-mono text-xs">
                <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-sm">
                  <span className="text-white/70 flex items-center gap-2"><Cpu size={14} className="text-primary"/> {t('pricing.llmInference')}</span>
                  <span className="text-secondary font-bold">{t('pricing.atCost')}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-white/5 border border-white/5 rounded-sm">
                  <span className="text-white/70 flex items-center gap-2"><Cpu size={14} className="text-primary"/> {t('pricing.visionGen')}</span>
                  <span className="text-secondary font-bold">{t('pricing.atCost')}</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-primary/10 border border-primary/20 rounded-sm">
                  <span className="text-primary flex items-center gap-2">{t('pricing.platformFee')}</span>
                  <span className="text-primary font-bold text-sm">$0.00</span>
                </div>
              </div>

              <div className="flex gap-4 mt-auto">
                <a href="https://github.com" target="_blank" rel="noreferrer" className="flex-1 py-3 bg-white/5 border border-white/10 text-white text-center font-bold font-mono text-xs uppercase tracking-wider hover:bg-white/10 transition-colors flex items-center justify-center gap-2">
                  <Github size={14} />
                  {t('pricing.sourceCode')}
                </a>
                <a href="#" className="flex-1 py-3 bg-primary/10 border border-primary/50 text-primary text-center font-bold font-mono text-xs uppercase tracking-wider hover:bg-primary hover:text-white transition-all shadow-[0_0_15px_rgba(176,38,255,0.2)] hover:shadow-[0_0_25px_rgba(176,38,255,0.5)] flex items-center justify-center gap-2">
                  <Terminal size={14} />
                  {t('pricing.selfHost')}
                </a>
              </div>
            </div>
            
            <div className="p-8 md:p-12 bg-primary/5 flex flex-col justify-center relative overflow-hidden">
              {/* Background glow */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full bg-secondary/5 blur-[100px] rounded-full pointer-events-none" />
              
              <div className="relative w-full aspect-[4/3] bg-background/80 backdrop-blur-sm border border-primary/30 rounded-lg p-4 md:p-6 flex flex-col shadow-[0_0_30px_rgba(0,243,255,0.1)]">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
                  <div className="text-xs font-mono text-primary uppercase tracking-wider">{t('pricing.costVsDuration')}</div>
                  <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 text-[10px] font-mono uppercase">
                    <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500/80"></span> {t('pricing.industryStandard')}</div>
                    <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-secondary shadow-[0_0_8px_#00f3ff]"></span> {t('pricing.bareVid')}</div>
                  </div>
                </div>
                
                <div className="flex-1 relative w-full h-full">
                  <svg viewBox="0 0 400 300" className="w-full h-full overflow-visible">
                    <defs>
                      <filter id="glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="6" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                      </filter>
                      <filter id="glow-red" x="-20%" y="-20%" width="140%" height="140%">
                        <feGaussianBlur stdDeviation="4" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                      </filter>
                      <linearGradient id="area-cyan" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#00f3ff" stopOpacity="0.2" />
                        <stop offset="100%" stopColor="#00f3ff" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    
                    {/* Grid lines */}
                    <g stroke="currentColor" className="text-primary/10" strokeWidth="1">
                      <line x1="40" y1="200" x2="380" y2="200" strokeDasharray="4 4" />
                      <line x1="40" y1="140" x2="380" y2="140" strokeDasharray="4 4" />
                      <line x1="40" y1="80" x2="380" y2="80" strokeDasharray="4 4" />
                      
                      <line x1="125" y1="260" x2="125" y2="20" strokeDasharray="4 4" />
                      <line x1="210" y1="260" x2="210" y2="20" strokeDasharray="4 4" />
                      <line x1="295" y1="260" x2="295" y2="20" strokeDasharray="4 4" />
                    </g>

                    {/* Axes */}
                    <g stroke="currentColor" className="text-muted/50" strokeWidth="2">
                      <line x1="40" y1="260" x2="380" y2="260" />
                      <line x1="40" y1="260" x2="40" y2="20" />
                    </g>

                    {/* Labels */}
                    <text x="210" y="290" fill="currentColor" className="text-muted text-[10px] font-mono" textAnchor="middle">{t('pricing.videoLength')}</text>
                    <text x="15" y="140" fill="currentColor" className="text-muted text-[10px] font-mono" textAnchor="middle" transform="rotate(-90 15 140)">{t('pricing.cost')}</text>

                    {/* Competitor Line (Exponential) */}
                    <motion.path 
                      initial={{ pathLength: 0, opacity: 0 }}
                      whileInView={{ pathLength: 1, opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 1.5, ease: "easeIn" }}
                      d="M 40 255 Q 320 250, 380 10" 
                      fill="none" 
                      stroke="#ef4444" 
                      strokeWidth="4" 
                      filter="url(#glow-red)"
                    />
                    
                    {/* BareVid Area */}
                    <motion.path 
                      initial={{ opacity: 0 }}
                      whileInView={{ opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 1, delay: 1 }}
                      d="M 40 260 L 380 245 L 380 260 Z" 
                      fill="url(#area-cyan)" 
                    />

                    {/* BareVid Line (Linear) */}
                    <motion.path 
                      initial={{ pathLength: 0, opacity: 0 }}
                      whileInView={{ pathLength: 1, opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 1.5, ease: "linear", delay: 0.2 }}
                      d="M 40 260 L 380 245" 
                      fill="none" 
                      stroke="#00f3ff" 
                      strokeWidth="4" 
                      filter="url(#glow-cyan)"
                    />
                    
                    {/* Intersection Point / Highlight */}
                    <motion.circle
                      initial={{ scale: 0, opacity: 0 }}
                      whileInView={{ scale: 1, opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: 1.7, type: "spring" }}
                      cx="380" cy="245" r="4" fill="#00f3ff"
                    />
                    <motion.circle
                      initial={{ scale: 0, opacity: 0 }}
                      whileInView={{ scale: 1, opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: 1.7, type: "spring" }}
                      cx="380" cy="10" r="4" fill="#ef4444"
                    />
                  </svg>
                </div>
              </div>

              {/* Advantage Highlights */}
              <div className="mt-6 flex flex-col gap-3 relative z-10">
                <div className="flex items-start gap-3 p-3 bg-black/40 border border-red-500/20 rounded-sm">
                  <TrendingUp className="text-red-500 shrink-0 mt-0.5" size={16} />
                  <div>
                    <div className="text-xs font-bold text-red-400 mb-1 uppercase tracking-wider">{t('pricing.industryTrap')}</div>
                    <div className="text-[10px] text-white/50 font-mono leading-relaxed">
                      {t('pricing.industryTrapDesc')}
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 bg-primary/10 border border-primary/30 rounded-sm shadow-[0_0_15px_rgba(0,243,255,0.1)]">
                  <InfinityIcon className="text-primary shrink-0 mt-0.5" size={16} />
                  <div>
                    <div className="text-xs font-bold text-primary mb-1 uppercase tracking-wider">{t('pricing.trueLinearScaling')}</div>
                    <div className="text-[10px] text-primary/70 font-mono leading-relaxed">
                      {t('pricing.trueLinearScalingDesc')} <span className="text-white/30 hover:text-white/80 transition-colors cursor-help" title={t('pricing.softCappedTooltip')}>{t('pricing.softCapped')}</span>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
