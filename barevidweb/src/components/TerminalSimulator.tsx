import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Terminal, Cpu, Sparkles, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type TerminalSimulatorProps = {
  /** 若传入，中间区域循环播放该视频，仍保留上下浮动面板与日志动画 */
  videoSrc?: string;
};

export function TerminalSimulator({ videoSrc }: TerminalSimulatorProps) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const heroVideoRef = useRef<HTMLVideoElement>(null);
  const [heroPlaybackStarted, setHeroPlaybackStarted] = useState(false);

  useEffect(() => {
    setHeroPlaybackStarted(false);
  }, [videoSrc]);

  useEffect(() => {
    const duration = 7000;
    const interval = 50;
    const steps = duration / interval;
    let currentStep = 0;

    const logSequence = [
      { p: 5, text: `> ${t('terminal.logs.0', 'Analyzing request parameters...')}` },
      { p: 15, text: `> ${t('terminal.logs.1', 'Extracting keywords...')}` },
      { p: 25, text: `> ${t('terminal.logs.2', 'Initializing DeepSeek reasoning engine...')}` },
      { p: 40, text: `> ${t('terminal.logs.3', 'Generating scene prompts...')}` },
      { p: 55, text: `> ${t('terminal.logs.4', 'Allocating GPU resources...')}` },
      { p: 70, text: `> ${t('terminal.logs.5', 'Rendering frames...')}` },
      { p: 85, text: `> ${t('terminal.logs.6', 'Assembling video sequence...')}` },
      { p: 98, text: `> ${t('terminal.logs.7', 'Finalizing output...')}` },
      { p: 100, text: `> ${t('terminal.logs.8', 'Video generated successfully!')}` }
    ];

    const timer = setInterval(() => {
      currentStep++;
      const currentProgress = Math.min(100, (currentStep / steps) * 100);
      setProgress(currentProgress);

      // Add logs based on progress
      const currentLog = logSequence.slice().reverse().find(l => currentProgress >= l.p);
      if (currentLog) {
        setLogs(prev => {
          if (prev[prev.length - 1] !== currentLog.text) {
            return [...prev.slice(-3), currentLog.text]; // Keep last 4 logs
          }
          return prev;
        });
      }

      if (currentStep >= steps) clearInterval(timer);
    }, interval);

    return () => clearInterval(timer);
  }, [t]);

  const isComplete = progress >= 100;

  const showHeroLoader = Boolean(videoSrc && (!isComplete || !heroPlaybackStarted));

  /** Hero 视频：等底部日志跑完再播放 */
  useEffect(() => {
    if (!videoSrc) return;
    const el = heroVideoRef.current;
    if (!el) return;
    if (isComplete) {
      void el.play().catch(() => {});
    } else {
      el.pause();
      try {
        el.currentTime = 0;
      } catch {
        /* metadata 未就绪时 seek 可能失败 */
      }
    }
  }, [videoSrc, isComplete]);

  return (
    <div className="relative w-full aspect-[4/5] md:aspect-square lg:aspect-[4/3] max-w-2xl mx-auto mt-12 lg:mt-0 flex items-center justify-center z-10">
      
      {/* Floating Prompt HUD (Top Left) */}
      <motion.div 
        initial={{ opacity: 0, x: -20, y: -20 }}
        animate={{ opacity: 1, x: 0, y: [0, -8, 0] }}
        transition={{ y: { repeat: Infinity, duration: 4, ease: "easeInOut" }, opacity: { duration: 0.6 } }}
        className="absolute -top-4 left-4 right-4 md:top-8 md:-left-24 lg:-left-32 md:right-auto z-30 bg-background/50 backdrop-blur-xl border border-secondary/40 p-4 rounded-lg shadow-[0_8px_32px_rgba(0,243,255,0.15)] md:max-w-[280px]"
      >
        <div className="flex items-center gap-2 text-sm text-secondary mb-2 font-mono uppercase tracking-wider">
          <Sparkles size={16} className="animate-pulse" />
          {t('terminal.targetPrompt')}
        </div>
        <div className="text-white text-base font-medium leading-relaxed">
          "{t('terminal.promptText')}"
        </div>
      </motion.div>

      {/* Main Video/Render Container (Center) */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="absolute inset-y-16 inset-x-0 md:inset-12 bg-surface border border-primary/30 rounded-xl overflow-hidden z-20 shadow-[0_0_50px_rgba(176,38,255,0.2)] flex items-center justify-center"
      >
        {videoSrc ? (
          <>
            <video
              ref={heroVideoRef}
              src={videoSrc}
              className="absolute inset-0 h-full w-full object-cover"
              muted
              loop
              playsInline
              preload="metadata"
              aria-label="BareVid demo"
              onPlaying={() => setHeroPlaybackStarted(true)}
            />
            <div
              className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/90 pointer-events-none transition-opacity duration-500 ${
                showHeroLoader ? 'opacity-100' : 'opacity-0'
              }`}
              aria-busy={showHeroLoader}
              aria-hidden={!showHeroLoader}
            >
              <Loader2 className="h-11 w-11 text-secondary animate-spin" strokeWidth={2} aria-hidden />
            </div>
          </>
        ) : (
          <AnimatePresence mode="wait">
            {!isComplete ? (
              <motion.div 
                key="rendering"
                exit={{ opacity: 0, scale: 1.05 }}
                className="absolute inset-0 flex flex-col items-center justify-center bg-background"
              >
                {/* Grid Background */}
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#b026ff1a_1px,transparent_1px),linear-gradient(to_bottom,#b026ff1a_1px,transparent_1px)] bg-[size:2rem_2rem] opacity-30" />
                
                {/* Scanning Line */}
                <motion.div 
                  animate={{ y: ['-100%', '400%'] }} 
                  transition={{ duration: 2.5, repeat: Infinity, ease: 'linear' }}
                  className="absolute top-0 left-0 w-full h-1/4 bg-gradient-to-b from-transparent via-secondary/20 to-transparent z-0" 
                />

                {/* Progress Circle */}
                <div className="relative z-10 flex flex-col items-center">
                  <div className="relative w-32 h-32 flex items-center justify-center">
                    <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                      <circle cx="50" cy="50" r="45" fill="none" stroke="currentColor" className="text-surface-hover" strokeWidth="2" />
                      <motion.circle 
                        cx="50" cy="50" r="45" fill="none" stroke="currentColor" 
                        className="text-primary" strokeWidth="2"
                        strokeDasharray="283"
                        strokeDashoffset={283 - (283 * progress) / 100}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute text-3xl font-bold font-mono text-white">
                      {Math.round(progress)}%
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2 text-primary font-mono text-base uppercase tracking-widest animate-pulse">
                    <Cpu size={16} />
                    {t('terminal.rendering')}
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                key="complete"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 group"
              >
                <img 
                  src="https://images.unsplash.com/photo-1515630278258-407f66498911?q=80&w=800&auto=format&fit=crop" 
                  alt="Generated Cyberpunk City" 
                  className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-background/20 group-hover:bg-background/10 transition-colors flex items-center justify-center">
                  <motion.button 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", delay: 0.3 }}
                    className="w-20 h-20 rounded-full bg-secondary/90 flex items-center justify-center text-background backdrop-blur-md hover:scale-110 hover:bg-secondary transition-all shadow-[0_0_30px_rgba(0,243,255,0.6)]"
                  >
                    <Play size={40} fill="currentColor" className="ml-2" />
                  </motion.button>
                </div>
                <div className="absolute top-4 right-4 px-3 py-1.5 bg-background/80 backdrop-blur-md rounded-sm text-sm font-mono text-secondary border border-secondary/30">
                  16:9 • 4K
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </motion.div>

      {/* Floating Terminal Logs (Bottom Right) */}
      <motion.div 
        initial={{ opacity: 0, x: 20, y: 20 }}
        animate={{ opacity: 1, x: 0, y: [0, 8, 0] }}
        transition={{ y: { repeat: Infinity, duration: 5, ease: "easeInOut" }, opacity: { duration: 0.6, delay: 0.2 } }}
        className="absolute -bottom-4 left-4 right-4 md:-bottom-12 md:-right-8 md:left-auto z-30 bg-background/50 backdrop-blur-xl border border-primary/40 rounded-lg p-4 shadow-[0_8px_32px_rgba(176,38,255,0.15)] md:w-[340px] h-[160px] flex flex-col"
      >
        <div className="flex items-center gap-2 text-sm text-primary mb-3 font-mono border-b border-primary/20 pb-2">
          <Terminal size={16} />
          BAREVID terminal
        </div>
        <div className="flex-1 overflow-hidden flex flex-col justify-end gap-1.5 font-mono text-sm">
          <AnimatePresence initial={false}>
            {logs.map((log, i) => (
              <motion.div
                key={`${log}-${i}`}
                initial={{ opacity: 0, x: -10, height: 0 }}
                animate={{ opacity: i === logs.length - 1 ? 1 : 0.5, x: 0, height: 'auto' }}
                className={`${
                  i === logs.length - 1 
                    ? isComplete ? 'text-green-400 font-bold' : 'text-white' 
                    : 'text-muted'
                }`}
              >
                {log}
              </motion.div>
            ))}
          </AnimatePresence>
          {!isComplete && (
            <motion.div 
              animate={{ opacity: [1, 0] }} 
              transition={{ repeat: Infinity, duration: 0.8 }}
              className="w-2 h-3 bg-secondary mt-1"
            />
          )}
        </div>
      </motion.div>

    </div>
  );
}
