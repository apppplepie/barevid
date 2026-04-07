import { useState, useEffect, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Users, Database, Clock, Terminal, ShieldAlert, Cpu, Video, Briefcase, ShoppingCart, QrCode, Mail, ExternalLink, Heart } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const CyberCard = ({ children, className = "", delay = 0, themeColor = "primary" }: { children: ReactNode, className?: string, delay?: number, themeColor?: "secondary" | "primary" | "muted" }) => {
  const themeMap = {
    primary: {
      border: "border-primary/30 hover:border-primary/60",
      corner: "border-primary/80",
      gradient: "from-primary/10",
      scan: "bg-primary/50"
    },
    secondary: {
      border: "border-secondary/30 hover:border-secondary/60",
      corner: "border-secondary/80",
      gradient: "from-secondary/10",
      scan: "bg-secondary/50"
    },
    muted: {
      border: "border-white/20 hover:border-white/40",
      corner: "border-white/50",
      gradient: "from-white/5",
      scan: "bg-white/30"
    }
  };

  const t = themeMap[themeColor];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, filter: 'blur(5px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay }}
      className={`relative bg-black/60 backdrop-blur-md border ${t.border} p-5 group overflow-hidden flex flex-col transition-colors ${className}`}
      style={{ clipPath: 'polygon(0 0, calc(100% - 15px) 0, 100% 15px, 100% 100%, 15px 100%, 0 calc(100% - 15px))' }}
    >
      <div className={`absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 ${t.corner}`} />
      <div className={`absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 ${t.corner}`} />
      <div className={`absolute inset-0 bg-gradient-to-br ${t.gradient} to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none`} />
      <div className={`absolute top-0 left-0 w-full h-[1px] ${t.scan} opacity-0 group-hover:opacity-100 group-hover:animate-[scan_2s_linear_infinite] pointer-events-none`} />
      <div className="relative z-10 h-full flex flex-col">
        {children}
      </div>
    </motion.div>
  );
};

const StatBox = ({ title, value, sub, icon: Icon, colorClass }: any) => (
  <div className="bg-white/5 border border-white/10 p-4 rounded-sm relative overflow-hidden group hover:border-white/30 transition-colors">
    <div className={`absolute top-0 left-0 w-1 h-full ${colorClass} opacity-50 group-hover:opacity-100 transition-opacity`} />
    <div className="flex justify-between items-start mb-2">
      <span className="text-white/50 font-mono text-[10px] uppercase tracking-widest">{title}</span>
      <Icon size={14} className="text-white/30 group-hover:text-white/80 transition-colors" />
    </div>
    <div className="text-2xl font-black text-white tracking-tighter">{value}</div>
    <div className="text-[10px] font-mono text-white/40 mt-1">{sub}</div>
  </div>
);

export function ServerStatus() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState(3);

  useEffect(() => {
    const interval = setInterval(() => {
      setTasks(prev => Math.max(0, prev + (Math.random() > 0.5 ? 1 : -1)));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section id="status" className="min-h-screen w-full snap-start snap-always pt-20 pb-12 px-4 md:px-6 relative overflow-hidden flex flex-col justify-center">
      <div className="max-w-6xl mx-auto w-full relative z-10 flex flex-col h-full">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-end justify-between mb-8 gap-4 border-b border-primary/20 pb-4">
          <div>
            <h2 className="text-3xl md:text-4xl font-black tracking-tighter uppercase relative inline-block">
              <span className="relative text-white glitch-text" data-text={t('status.nodeStatus1') + t('status.nodeStatus2')}>
                {t('status.nodeStatus1')}<span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">{t('status.nodeStatus2')}</span>
              </span>
            </h2>
          </div>
          <div className="hidden md:flex flex-col items-end font-mono text-[10px] text-secondary/70">
            <span>{t('status.indieDevMode')}</span>
            <span>{t('status.coffeeLevel')}</span>
          </div>
        </div>

        {/* Telemetry Data (No Charts, Just Hard Data) */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
          <StatBox title={t('status.deepseekBalance')} value="$1.42" sub={t('status.apiKeyActive')} icon={Database} colorClass="bg-primary" />
          <StatBox title={t('status.doubaoBalance')} value="¥34.50" sub={t('status.volcengineActive')} icon={Cpu} colorClass="bg-secondary" />
          <StatBox title={t('status.pendingTasks')} value={tasks} sub={t('status.serverQueue')} icon={Clock} colorClass="bg-white/50" />
          <StatBox title={t('status.registeredUsers')} value="14,203" sub={t('status.dbAuthRecords')} icon={Users} colorClass="bg-primary/70" />
          <StatBox title={t('status.totalProjects')} value="89,412" sub={t('status.renderedVideos')} icon={Video} colorClass="bg-secondary/70" />
        </div>

        {/* The "Real Talk" Indie Dev Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-1">
          
          {/* Mercenary / Friend's Shop */}
          <CyberCard delay={0.1} themeColor="secondary">
            <div className="flex items-center gap-3 mb-4 text-secondary">
              <ShoppingCart size={24} />
              <h3 className="font-black tracking-widest uppercase text-lg">{t('status.proxyService')}</h3>
            </div>
            <p className="text-sm text-white/70 font-mono mb-4 flex-1">
              {t('status.proxyDesc1')} 
              <br/><br/>
              <span className="text-white/50 text-xs">{t('status.proxyDesc2')}</span>
            </p>
            <a href="#" className="flex items-center justify-center gap-2 w-full py-3 bg-secondary/10 border border-secondary/50 text-secondary hover:bg-secondary hover:text-black transition-all font-bold uppercase tracking-widest text-xs">
              {t('status.visitStore')} <ExternalLink size={14} />
            </a>
          </CyberCard>

          {/* Hire Me */}
          <CyberCard delay={0.2} themeColor="primary">
            <div className="flex items-center gap-3 mb-4 text-primary">
              <Briefcase size={24} />
              <h3 className="font-black tracking-widest uppercase text-lg">{t('status.hireDev')}</h3>
            </div>
            <p className="text-sm text-white/70 font-mono mb-4 flex-1">
              {t('status.hireDesc1')}
              <br/><br/>
              <span className="text-white/50 text-xs">{t('status.hireDesc2')}</span>
            </p>
            <a href="mailto:necromancerappplepie@gmail.com" className="flex items-center justify-center gap-2 w-full py-3 bg-primary/10 border border-primary/50 text-primary hover:bg-primary hover:text-black transition-all font-bold uppercase tracking-widest text-xs">
              <Mail size={14} /> necromancerappplepie@gmail.com
            </a>
          </CyberCard>

          {/* Donate / Sponsor */}
          <CyberCard delay={0.3} themeColor="secondary">
            <div className="flex items-center gap-3 mb-4 text-secondary">
              <Heart size={24} />
              <h3 className="font-black tracking-widest uppercase text-lg">{t('status.systemFunding')}</h3>
            </div>
            <p className="text-sm text-white/70 font-mono mb-4 flex-1">
              {t('status.fundingDesc1')}
              <br/><br/>
              <span className="text-secondary/80 text-xs font-bold">{t('status.totalSupported')}</span>
              <br/>
              <span className="text-white/50 text-xs">{t('status.fundingDesc2')}</span>
            </p>
            <div className="flex gap-2">
              <button className="flex-1 flex items-center justify-center gap-2 py-3 bg-secondary/10 border border-secondary/50 text-secondary hover:bg-secondary hover:text-black transition-all font-bold uppercase tracking-widest text-xs">
                <QrCode size={14} /> {t('status.scan')}
              </button>
              <a href="#" className="flex-1 flex items-center justify-center gap-2 py-3 bg-secondary/10 border border-secondary/50 text-secondary hover:bg-secondary hover:text-black transition-all font-bold uppercase tracking-widest text-xs">
                {t('status.donate')} <ExternalLink size={14} />
              </a>
            </div>
          </CyberCard>

        </div>

      </div>

      <style>{`
        @keyframes scan {
          0% { transform: translateY(0); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(100%); opacity: 0; }
        }
      `}</style>
    </section>
  );
}
